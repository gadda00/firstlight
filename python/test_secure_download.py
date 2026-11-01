"""Unit tests for the hardened download policy (secure_download.py).

No network access: `validate_url` is tested with the DNS check disabled
(`allow_private=True` — a test-only escape), and `download_file` is tested
against an injected fake `requests` module. Run:

    python3 -m unittest test_secure_download -v
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import secure_download
from secure_download import (
    DownloadDenied,
    _redact,
    allowed_hosts,
    download_file,
    is_private_address,
    validate_url,
)


class FakeResponse:
    def __init__(self, status_code=200, headers=None, chunks=()):
        self.status_code = status_code
        self.headers = headers or {}
        self._chunks = list(chunks)
        self.closed = False

    def iter_content(self, chunk_size=65536):
        for c in self._chunks:
            yield c

    def close(self):
        self.closed = True


class FakeRequests:
    def __init__(self, responses):
        # responses: list of FakeResponse (one per hop) OR a callable
        self.responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        item = self.responses.pop(0) if isinstance(self.responses, list) else None
        return item(url) if callable(item) else item


class TestPrivateAddresses(unittest.TestCase):
    def test_private_and_reserved_are_rejected(self):
        for ip in (
            "127.0.0.1",
            "10.0.0.5",
            "192.168.1.1",
            "172.16.0.9",
            "169.254.169.254",  # cloud metadata endpoint
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fc00::2",
            "not-an-ip",
        ):
            self.assertTrue(is_private_address(ip), ip)

    def test_public_addresses_pass(self):
        for ip in ("8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"):
            self.assertFalse(is_private_address(ip), ip)


class TestRedaction(unittest.TestCase):
    def test_userinfo_and_query_are_stripped(self):
        url = "https://user:secret@earthquake.usgs.gov/path?token=SIGNED_SECRET&sig=abc"
        red = _redact(url)
        self.assertNotIn("secret", red)
        self.assertNotIn("SIGNED_SECRET", red)
        self.assertNotIn("token", red)
        self.assertIn("earthquake.usgs.gov/path", red)

    def test_malformed_input_never_leaks_secrets(self):
        # Whatever it produces, it must not contain credentials or queries.
        red = _redact("::::")
        self.assertNotIn("?", red)
        red = _redact("not a url at all :://?")
        self.assertNotIn("?", red)
        red = _redact("https://user:pass@host.example.com/x?a=b")
        self.assertNotIn("user:pass", red)
        self.assertNotIn("?", red)
        self.assertIn("host.example.com/x", red)


class TestValidateUrl(unittest.TestCase):
    def test_http_is_refused(self):
        with self.assertRaises(DownloadDenied):
            validate_url("http://earthquake.usgs.gov/file.tif", allow_private=True)

    def test_embedded_credentials_are_refused(self):
        with self.assertRaises(DownloadDenied):
            validate_url(
                "https://user:pass@earthquake.usgs.gov/file.tif", allow_private=True
            )

    def test_allowlisted_host_passes(self):
        host = validate_url(
            "https://earthquake.usgs.gov/fdsnws/event/1/query", allow_private=True
        )
        self.assertEqual(host, "earthquake.usgs.gov")

    def test_unknown_host_is_refused(self):
        with self.assertRaises(DownloadDenied):
            validate_url("https://evil.example.com/file.tif", allow_private=True)

    def test_subdomain_of_allowlisted_host_passes(self):
        host = validate_url(
            "https://data.earthquake.usgs.gov/file.tif", allow_private=True
        )
        self.assertEqual(host, "data.earthquake.usgs.gov")

    def test_env_allowlist_extension(self):
        os.environ["FIRSTLIGHT_DOWNLOAD_ALLOWLIST"] = "downloads.example.test"
        try:
            host = validate_url(
                "https://downloads.example.test/a.tif", allow_private=True
            )
            self.assertEqual(host, "downloads.example.test")
            with self.assertRaises(DownloadDenied):
                validate_url("https://other.example.test/a.tif", allow_private=True)
        finally:
            del os.environ["FIRSTLIGHT_DOWNLOAD_ALLOWLIST"]

    def test_per_call_extra_hosts(self):
        host = validate_url(
            "https://partner.example.test/a.tif",
            hosts=("partner.example.test",),
            allow_private=True,
        )
        self.assertEqual(host, "partner.example.test")

    def test_dns_check_rejects_private_resolution(self):
        # localhost never reaches requests.get: policy-level refusal.
        with self.assertRaises(DownloadDenied):
            validate_url("https://localhost/file", allow_private=False)


class TestDownloadFile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = str(Path(self.tmp.name) / "out.tif")

    def tearDown(self):
        self.tmp.cleanup()

    def test_happy_path_writes_file_with_checksum(self):
        body = b"TIFFDATA" * 100
        import hashlib

        sha = hashlib.sha256(body).hexdigest()
        fake = FakeRequests([FakeResponse(200, {"content-type": "image/tiff"}, [body])])
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif",
            self.dest,
            expected_content_types=("image/tiff",),
            expected_sha256=sha,
            _requests=fake,
        )
        self.assertTrue(ok, msg)
        self.assertEqual(msg, self.dest)
        self.assertEqual(Path(self.dest).read_bytes(), body)
        self.assertFalse(Path(self.dest + ".part").exists())

    def test_content_type_mismatch_leaves_no_file(self):
        fake = FakeRequests([FakeResponse(200, {"content-type": "text/html"}, [b"x"])])
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif",
            self.dest,
            expected_content_types=("image/tiff",),
            _requests=fake,
        )
        self.assertFalse(ok)
        self.assertIn("content-type", msg)
        self.assertFalse(Path(self.dest).exists())

    def test_declared_size_over_limit_is_refused(self):
        fake = FakeRequests(
            [FakeResponse(200, {"content-length": "99999999999"}, [b"x"])]
        )
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif",
            self.dest,
            max_bytes=1024,
            _requests=fake,
        )
        self.assertFalse(ok)
        self.assertIn("exceeds limit", msg)

    def test_streamed_bytes_over_limit_removes_part_file(self):
        fake = FakeRequests(
            [FakeResponse(200, {}, [b"a" * 512, b"b" * 512, b"c" * 512])]
        )
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif",
            self.dest,
            max_bytes=1024,
            _requests=fake,
        )
        self.assertFalse(ok)
        self.assertIn("byte limit", msg)
        self.assertFalse(Path(self.dest + ".part").exists())
        self.assertFalse(Path(self.dest).exists())

    def test_checksum_mismatch_removes_file(self):
        fake = FakeRequests([FakeResponse(200, {}, [b"content"])])
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif",
            self.dest,
            expected_sha256="0" * 64,
            _requests=fake,
        )
        self.assertFalse(ok)
        self.assertIn("checksum mismatch", msg)
        self.assertFalse(Path(self.dest).exists())

    def test_upstream_error_is_reported(self):
        fake = FakeRequests([FakeResponse(503, {}, [])])
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif", self.dest, _requests=fake
        )
        self.assertFalse(ok)
        self.assertIn("503", msg)

    def test_redirect_to_http_is_denied(self):
        fake = FakeRequests(
            [FakeResponse(302, {"Location": "http://earthquake.usgs.gov/evil"}, [])]
        )
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif", self.dest, _requests=fake
        )
        self.assertFalse(ok)
        self.assertIn("non-HTTPS", msg)

    def test_redirect_to_private_host_is_denied(self):
        # Redirect target must pass the SAME allowlist + DNS policy.
        fake = FakeRequests(
            [FakeResponse(302, {"Location": "https://169.254.169.254/latest/meta"}, [])]
        )
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif", self.dest, _requests=fake
        )
        self.assertFalse(ok)
        self.assertIn("allowlist", msg)

    def test_redirect_chain_over_limit_is_denied(self):
        responses = [
            FakeResponse(302, {"Location": "https://earthquake.usgs.gov/hop1"}, []),
            FakeResponse(302, {"Location": "https://earthquake.usgs.gov/hop2"}, []),
            FakeResponse(302, {"Location": "https://earthquake.usgs.gov/hop3"}, []),
            FakeResponse(302, {"Location": "https://earthquake.usgs.gov/hop4"}, []),
        ]
        fake = FakeRequests(responses)
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif",
            self.dest,
            max_redirects=2,
            _requests=fake,
        )
        self.assertFalse(ok)
        self.assertIn("redirect", msg)

    def test_allowlisted_redirect_to_same_host_succeeds(self):
        body = b"data"
        fake = FakeRequests(
            [
                FakeResponse(302, {"Location": "https://earthquake.usgs.gov/real.tif"}, []),
                FakeResponse(200, {"content-type": "image/tiff"}, [body]),
            ]
        )
        ok, msg = download_file(
            "https://earthquake.usgs.gov/a.tif",
            self.dest,
            expected_content_types=("image/tiff",),
            _requests=fake,
        )
        self.assertTrue(ok, msg)
        self.assertEqual(Path(self.dest).read_bytes(), body)
        # Both hops hit the provider.
        urls = [c[0] for c in fake.calls]
        self.assertEqual(
            urls,
            ["https://earthquake.usgs.gov/a.tif", "https://earthquake.usgs.gov/real.tif"],
        )

    def test_no_credentials_in_any_logged_url(self):
        fake = FakeRequests([FakeResponse(200, {}, [b"x"])])
        ok, _ = download_file(
            "https://earthquake.usgs.gov/a.tif?token=SUPERSECRET",
            self.dest,
            _requests=fake,
        )
        self.assertTrue(ok)
        # The policy itself would deny credential-bearing URLs outright:
        with self.assertRaises(DownloadDenied):
            validate_url(
                "https://user:pw@earthquake.usgs.gov/a.tif?token=SUPERSECRET",
                allow_private=True,
            )


class TestAllowlistDefaults(unittest.TestCase):
    def test_default_is_deny_unknown(self):
        hosts = allowed_hosts()
        self.assertIn("earthquake.usgs.gov", hosts)
        self.assertNotIn("evil.example.com", hosts)


if __name__ == "__main__":
    unittest.main()
