# SECURITY.md — FirstLight

## 1. Scope & ethics guardrails

FirstLight supports humanitarian logistics, damage assessment, access analysis, and operational briefing only. Explicitly out of scope and not implemented: targeting, offensive intelligence, surveillance of individuals, sensitive-person inference, and autonomous dispatch. Every operational recommendation must remain reviewable, explainable, uncertainty-aware, and subject to authorized human approval. Routes flagged `requiresFieldVerification` are never auto-dispatched.

## 2. Authentication model (honest status)

**Pilot (current):** out-of-band account tokens seeded by `prisma/seed.ts`, stored as SHA-256 hashes; login mints 192-bit bearer tokens (also hash-stored). Sessions: 24 h TTL, server-side revocation on logout, per-request expiry check. This is a demo-grade credential mechanism for the open-data pilot and is labeled as such in the login UI and login response.

**Production path (designed seam):** OIDC/SAML with MFA. Only `login()` in `src/lib/server/auth.ts` changes — sessions, the capability lattice, and every resolver's checks stay identical. All five pilot roles (observer/analyst/reviewer/approver/admin) already exercise the production lattice.

## 3. Authorization

- Capability matrix (`CAPABILITIES`) is the single source of truth; resolvers check capabilities, never scattered role strings.
- Organization isolation on every query; cross-tenant object access returns **404** (not 403) to avoid existence leaks.
- Two-person rule: sitrep approver must differ from the draft generator; approval freezes the claim set by SHA-256.

## 4. Transport & request hardening

- Server build sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic off).
- Uniform error envelope: machine `code`, safe `message`, `requestId`; internals (SQL, provider URLs, stack traces) never leak to clients (logged server-side only).
- Zod validation at every boundary; 64 KB body cap; method allowlist.
- Fixed-window rate limiting: 20/min on auth endpoints, 300/min general (in-memory; Redis is the documented scale seam).

## 5. Provider egress (SSRF & supply chain)

- All adapter I/O goes through `resilientFetch`: **HTTPS-only**, per-adapter **host allowlists** (wildcard-supported), remote URLs from provider payloads re-checked against them.
- AbortController timeouts; bounded response bodies (Content-Length pre-check + post-read cap); content-type validation; retries with exponential backoff + jitter honoring `Retry-After`.
- Provider secrets are server-side env vars only (`FIRSTLIGHT_*`), never `NEXT_PUBLIC_*`; never logged.
- Blocked dependencies (e.g. FIRMS token) fail closed with 503 `blocked_dependency` — never simulated data.

## 6. Data integrity

- **Audit chain:** append-only `AuditEvent` rows; per-org gap-free sequence; each hash covers prevHash+seq+action+entity+canonical payload+timestamp. `POST /api/audit/verify` walks and re-verifies the chain; tamper/splice/deletion are detected (tested).
- **Claims:** each sitrep claim hash = SHA-256(tool : canonical(params) : canonical(value)); the claim SET hash freezes at approval; any post-hoc claim edit breaks the stored hash.
- **Exports:** every artifact records SHA-256 + size + approval state; offline bundles validate per-layer checksums, expiry, revocation, and staleness on import.
- The v2.1 client-side FNV-1a checksums remain only as labeled demo compatibility — they are explicitly not a security control.

## 7. Privacy & data protection

- Pilot data: public open-data feeds + labeled synthetic layers; no personal data is ingested.
- High-resolution imagery, field reports, photos, device tracks, and any PII require a DPIA (`docs/templates/DPIA_TEMPLATE.md` pattern from the governance docs) before ingestion; data minimization and retention schedules apply (below).
- Retention: ingestion attempts and audit events are retained for incident forensics; sessions expire at 24 h; offline bundles carry explicit `expiresAt` + revocation; sitrep approvals are frozen indefinitely (they are the record of what was distributed).

## 8. Threat model (summary)

| Threat | Vector | Mitigation |
|---|---|---|
| Credential theft | bearer interception | HTTPS-only egress/ingress, short TTL, server revocation, hash-only storage; MFA deferred to OIDC phase |
| Privilege escalation | role confusion | capability lattice checked in dispatch (inside the error envelope); org-scoped queries |
| Cross-tenant leakage | ID guessing | 404 existence hiding; org filter on every read |
| SSRF via provider URLs | malicious catalog payload | host allowlist re-validation on every upstream call |
| Provider poisoning | malformed/malicious payloads | Zod + adapter `validate()` gates; failures recorded, never promoted |
| Audit tampering | DB edit by insider | SHA-256 chain, verify endpoint, append-only discipline |
| Bundle misuse in the field | stolen device | expiry + revocation + import-side validation |
| Replay/stale decisions | concurrent review writes | optimistic concurrency (`stale_version` 409) |
| Oversized/hostile requests | body bombs | 64 KB cap, rate limits, method allowlist |

## 9. Incident response (runbook summary)

1. **Revoke sessions** of affected accounts (`User.revokedAt` / session revocation).
2. **Freeze distribution**: revoked bundles; new sitrep versions supersede drafts (approved ones stay frozen as evidence).
3. **Verify integrity**: `POST /api/audit/verify`; compare export checksums.
4. **Contain egress**: unset provider tokens; adapters fail closed.
5. Full procedures: `OPERATIONS_RUNBOOK.md` §Incidents.

## 10. Responsible disclosure

Report vulnerabilities privately to the repository owner (GitHub security advisories). Please do not open public issues for security findings. We will acknowledge within 72 hours and coordinate fixes.

## 11. Known limitations (honest list)

- Pilot tokens are printed by the seed script — rotate before any shared deployment.
- In-memory rate limiting is per-node (single-node pilot).
- No container image scanning / dependency SBOM pipeline yet (CI runs lint/type/test/build; add `bun audit` to the pipeline next).
- No antivirus scanning for uploads (no upload path exists yet).
