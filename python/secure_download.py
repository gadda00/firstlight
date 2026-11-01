"""FirstLight — hardened provider file downloader.

Shared egress policy for the Python worker, mirroring the TypeScript
adapter client (src/lib/server/adapters/http-client.ts):

  - HTTPS only (plain HTTP refused),
  - explicit provider host allowlist (default: DENY ALL),
  - SSRF protection: DNS resolution happens BEFORE the request and every
    resolved address is checked against private/loopback/link-local/
    reserved ranges; redirects are re-validated the same way,
  - bounded redirects (default 3),
  - bounded response size, streamed to a `.part` file and atomically
    renamed only when complete (no partial files posing as data),
  - optional expected content-type check,
  - optional SHA-256 checksum verification,
  - connect/read timeouts; GET only (idempotent),
  - logged URLs are ALWAYS redacted (userinfo and query strings removed —
    signed URLs and credentials must never reach the logs).

This module deliberately has NO celery/worker dependencies so the policy
can be unit-tested anywhere (see test_secure_download.py).
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import os
import socket
import tempfile
from pathlib import Path
from typing import Optional, Sequence, Tuple
from urllib.parse import urlsplit

logger = logging.getLogger("firstlight.secure_download")

DEFAULT_MAX_BYTES = 512 * 1024 * 1024  # 512 MiB — raster-sized, bounded
DEFAULT_MAX_REDIRECTS = 3
DEFAULT_CONNECT_TIMEOUT = 15.0
DEFAULT_READ_TIMEOUT = 120.0

#: Hosts trusted by default (public open-data providers actually used by
#: the adapters). Extend with FIRSTLIGHT_DOWNLOAD_ALLOWLIST="host,host2".
DEFAULT_ALLOWED_HOSTS = (
    "earthquake.usgs.gov",
    "api.planet.com",
    "scihub.copernicus.eu",
    "download.sentinel-1.eo.esa.int",
    "services.sentinel-hub.com",
    "api.openweathermap.org",
    "firms.modaps.eosdis.nasa.gov",
    "nwis.waterservices.usgs.gov",
    "api.weather.gov",
    "www.weather.gov",
)


class DownloadDenied(Exception):
    """Raised when a URL violates the egress policy (never retried)."""


def _redact(url: str) -> str:
    """Strip userinfo and query string — safe-for-logs form of a URL."""
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
        netloc = host if not parts.port else f"{host}:{parts.port}"
        return f"{parts.scheme}://{netloc}{parts.path}"
    except Exception:
        return "<unparseable-url>"


def allowed_hosts(extra: Optional[Sequence[str]] = None) -> Tuple[str, ...]:
    """Effective allowlist: DEFAULT_ALLOWED_HOSTS + env extension."""
    env_hosts = os.getenv("FIRSTLIGHT_DOWNLOAD_ALLOWLIST", "")
    merged = set(DEFAULT_ALLOWED_HOSTS)
    if env_hosts.strip():
        merged.update(h.strip().lower() for h in env_hosts.split(",") if h.strip())
    if extra:
        merged.update(h.strip().lower() for h in extra if h.strip())
    return tuple(sorted(merged))


def is_private_address(ip_text: str) -> bool:
    """True for loopback/private/link-local/reserved/unspecified targets."""
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        return True  # unparseable address is treated as hostile
    flags = (
        ip.is_private,
        ip.is_loopback,
        ip.is_link_local,
        ip.is_reserved,
        ip.is_multicast,
        ip.is_unspecified,
        getattr(ip, "is_broadcast", False),
    )
    return any(flags)


def resolve_public_host(host: str) -> str:
    """Resolve `host` and return its first public IP; raise DownloadDenied
    when resolution fails or every address is private/reserved (SSRF)."""
    if not host:
        raise DownloadDenied("empty host")
    if host.lower() in ("localhost",):
        raise DownloadDenied("localhost is not an allowed upstream")
    try:
        addrinfo = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise DownloadDenied(f"DNS resolution failed for host: {exc}") from exc
    public = None
    for entry in addrinfo:
        ip_text = entry[4][0]
        if is_private_address(ip_text):
            # A host with ANY private address is refused outright — mixed
            # DNS rebinding answers must not slip through on a later entry.
            raise DownloadDenied(f"host resolves to a private/reserved address ({ip_text})")
        public = public or ip_text
    if public is None:
        raise DownloadDenied("host has no usable addresses")
    return public


def validate_url(
    url: str,
    hosts: Optional[Sequence[str]] = None,
    allow_private: bool = False,
) -> str:
    """Policy gate for ONE URL (initial request or a redirect target).

    Returns the hostname on success; raises DownloadDenied otherwise.
    With allow_private=True the DNS check is skipped — used ONLY for the
    in-process unit tests, never in production paths.
    """
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise DownloadDenied(f"refusing non-HTTPS scheme: {parts.scheme or '<none>'}")
    host = (parts.hostname or "").lower()
    if not host:
        raise DownloadDenied("URL has no host")
    if parts.username or parts.password:
        raise DownloadDenied("URL must not embed credentials")
    effective_hosts = allowed_hosts(extra=hosts)
    if host not in effective_hosts and not any(
        host.endswith("." + h) for h in effective_hosts if not h.startswith("*")
    ):
        raise DownloadDenied(f"host '{host}' is not in the download allowlist")
    if not allow_private:
        resolve_public_host(host)
    return host


def download_file(
    url: str,
    destination: str,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    expected_content_types: Optional[Sequence[str]] = None,
    expected_sha256: Optional[str] = None,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    hosts: Optional[Sequence[str]] = None,
    timeout: Tuple[float, float] = (DEFAULT_CONNECT_TIMEOUT, DEFAULT_READ_TIMEOUT),
    _requests=None,
) -> Tuple[bool, str]:
    """Stream a provider file to `destination` under the full egress policy.

    Returns (ok, message). On success message is the destination path and
    the file is complete (atomic rename from `<destination>.part`). On
    failure no file is left behind and the message is the redacted reason.
    """
    requests = _requests or __import__("requests")
    destination_path = Path(destination)
    part_path = destination_path.with_name(destination_path.name + ".part")

    try:
        current_url = url
        response = None
        for _hop in range(max_redirects + 1):
            validate_url(current_url, hosts=hosts)
            response = requests.get(
                current_url,
                stream=True,
                timeout=timeout,
                allow_redirects=False,
            )
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                response.close()
                if not location:
                    return False, "redirect without Location header"
                # Resolve relative redirects against the current URL.
                from urllib.parse import urljoin

                current_url = urljoin(current_url, location)
                continue
            break
        else:  # pragma: no cover — loop exhausted
            return False, f"more than {max_redirects} redirects"

        if response is None:
            return False, "no response"

        if response.status_code >= 400:
            code = response.status_code
            response.close()
            return False, f"upstream responded {code}"

        content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
        if expected_content_types and content_type not in [c.lower() for c in expected_content_types]:
            response.close()
            return False, f"unexpected content-type '{content_type or '<none>'}'"

        declared = response.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > max_bytes:
            response.close()
            return False, f"declared size {declared} exceeds limit {max_bytes}"

        hasher = hashlib.sha256()
        written = 0
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(part_path, "wb") as fh:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > max_bytes:
                        raise DownloadDenied(
                            f"response exceeded byte limit {max_bytes}"
                        )
                    hasher.update(chunk)
                    fh.write(chunk)
        finally:
            response.close()

        if expected_sha256 and hasher.hexdigest() != expected_sha256.lower():
            part_path.unlink(missing_ok=True)
            return False, "checksum mismatch"

        part_path.replace(destination_path)
        logger.info(
            "downloaded %s -> %s (%d bytes, sha256=%s)",
            _redact(current_url),
            destination_path,
            written,
            hasher.hexdigest()[:16],
        )
        return True, str(destination_path)

    except DownloadDenied as exc:
        part_path.unlink(missing_ok=True)
        logger.warning("download denied: %s", str(exc))
        return False, str(exc)
    except Exception as exc:  # network/timeout/IO — redacted reason only
        part_path.unlink(missing_ok=True)
        logger.error("download failed: %s (%s)", _redact(url), type(exc).__name__)
        return False, f"{type(exc).__name__}: {str(exc)[:200]}"
