# EdgeProxy — public ingress (highest risk)

Inherits all global rules from `~/.config/opencode/AGENTS.md`, including **§8 Public ingress specifics**.
Project threat model and full findings: `./SECURITY.md` and `/home/omega/Dev/SECURITY.md`.

## Stack

Go gateway + Bun/TypeScript dashboard + Docker + Firebase.

## What matters

This is a **public entry point** into the machine. Attack chain to cut at every link:
*exposed service → information leak → command injection → credentials in a file → lateral movement → privilege escalation.*

- `/internal/*` handlers (`/internal/certs`, `/internal/certs/issue`, `/internal/sessions`, `/internal/tunnels/sync`) must not be reachable from the public listener — separate loopback/unix-socket listener, or strong shared secret + mTLS.
- Tunnel auth is **deny by default**: no "no tunnels configured ⇒ allow", no `AuthToken == "" ⇒ allow`.
- Tokens: 32+ random bytes, constant-time compare, hashed at rest. No MD5-derived identifiers as auth.
- Tunnel port `4242`: authenticate before session registration; rate-limit; log attempts.
- Dashboard (`:3000`) is an admin surface — never published unauthenticated; bind loopback in compose.
- ACME must never issue for domains the caller does not control.
- Redact `Authorization` / tokens in logs and telemetry snapshots.

## Open findings

- **HIGH** — TLS certificates are self-signed; not publicly trusted. Replace with publicly trusted certs for browser-facing use.
- **MEDIUM** — tunnel wire is plain TCP by default; enable `-tunnel-tls` (and mTLS via `-tunnel-ca`) for production.
- **MEDIUM** — single admin credential; no multi-user login, MFA or per-tenant authorization.
- **LOW** — base images in Dockerfiles are tagged (not pinned by digest); consider digest pinning for supply chain.
- **LOW** — no DAST in CI; fuzz targets exist but are not run in CI.
