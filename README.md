![EdgeProxy banner](assets/banner.png)

# EdgeProxy

**Go-based network infrastructure software** · vpn.how

A self-hosted edge reverse proxy with a binary multiplexing tunnel, a Go CLI agent, a Node.js control plane and a React dashboard. Built as a reference implementation for high-throughput ingress, tunnel authorization and live telemetry.

![EdgeProxy screenshot](assets/screenshot.png)

> **Status:** reference / self-hosted implementation. It is not a multi-tenant SaaS and has not been through an external security audit. Read [Limitations](#limitations) before exposing it to the internet.

## Architecture

```text
Internet ──▶ Go gateway (:80/:443) ──▶ binary tunnel (:4242) ──▶ Go agent ──▶ local service
                    │
                    └── private IPC (:8081, shared secret + Docker network)
                                   │
                        Node.js control plane + React dashboard (:3000, loopback)
                                   │
                              Firestore (Admin SDK)
```

- **Data plane (Go):** public HTTP/HTTPS ingress, subdomain routing, per-IP token-bucket limiting, SNI TLS termination, and the multiplexed tunnel wire.
- **Agent (Go):** authenticates with a per-tunnel token, forwards HTTP requests to a local port, and reports telemetry.
- **Control plane (Node.js/Express):** owns tunnel/token lifecycle, certificates metadata, telemetry aggregation and the dashboard API. It never proxies customer traffic.
- **Dashboard (React/Vite):** live topology, tunnels, traffic, rate limiter, certificates and database views.
- **Storage (Firebase Admin SDK):** optional. Without credentials the control plane runs with in-memory state only.

## Project layout

```text
gateway/        Go ingress gateway (proxy, protocol, limiter, cert manager)
agent/          Go CLI agent (client, stream demuxer, metrics)
src/            React dashboard + Node control-plane modules
src/server/     Firestore access, security primitives and unit tests
db/             Optional PostgreSQL reference schema (not used at runtime)
server.ts       Express control plane
docker-compose.yml
```

## Requirements

- Go **1.22+**
- Node.js **20+** and npm
- Docker + Docker Compose (optional)
- A Firebase service account if you want persistence

## Quick start (local)

```bash
git clone git@github.com:ItOmegaDev/EdgeProxy.git
cd EdgeProxy

cp .env.example .env
# Local loopback use: EDGEPROXY_API_KEY may stay empty.
# Generate the private gateway IPC secret:
openssl rand -hex 32   # EDGEPROXY_INTERNAL_SECRET
# For remote/Docker access, also generate an admin key:
openssl rand -hex 32   # EDGEPROXY_API_KEY

npm ci
make build              # Go gateway + agent + dashboard
```

Run the gateway and control plane in separate terminals:

```bash
# Terminal 1 — public ingress on 8080/8443, agent tunnel on 4242
./bin/edgeproxy-gateway \
  -http-port 8080 -tls-port 8443 -tunnel-port 4242 \
  -internal-addr 127.0.0.1:8081 \
  -domain edgeproxy.mesh

# Terminal 2 — control plane + dashboard
npm run dev
```

Open `http://localhost:3000`. The control plane binds `127.0.0.1` by default.

### Create a tunnel and connect an agent

```bash
# The response includes the agent token exactly once.
curl -X POST http://127.0.0.1:3000/api/tunnels \
  -H "Authorization: Bearer $EDGEPROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"demo","localPort":3000}'
```

```bash
./bin/edgeproxy-agent \
  -gateway 127.0.0.1:4242 \
  -subdomain demo \
  -port 3000 \
  -token 'edg_tok_...' \
  -domain edgeproxy.mesh
```

Only the SHA-256 hash of the agent token is stored in the database and sent to the gateway. If a token is lost, rotate it:

```bash
curl -X POST http://127.0.0.1:3000/api/tunnels/<id>/rotate-token \
  -H "Authorization: Bearer $EDGEPROXY_API_KEY"
```

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `HOST`, `PORT` | Control-plane bind address and port. Non-loopback requires an API key. |
| `EDGEPROXY_API_KEY` | Admin bearer key (≥ 24 URL-safe chars). Required for remote access. |
| `EDGEPROXY_ALLOWED_ORIGINS` | Extra allowed browser origins (comma-separated). |
| `EDGEPROXY_INTERNAL_SECRET` | Shared secret for the gateway's private `/internal/*` IPC. |
| `GATEWAY_INTERNAL_URL` | Gateway IPC base URL (default `http://127.0.0.1:8081`). |
| `GATEWAY_PUBLIC_URL` | Gateway public HTTP ingress used by the traffic probe. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service-account JSON (raw or base64). |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service-account JSON. |
| `FIREBASE_PROJECT_ID` | Project ID for ADC (or explicit project selection). |
| `SEED_ADMIN_API_KEY` | Optional first admin record; only its hash is stored. |
| `GEMINI_API_KEY` | Optional server-side AI diagnostics. |

### Authentication model

- **With `EDGEPROXY_API_KEY`:** every `/api/*` route except `/api/health` requires `Authorization: Bearer <key>`. WebSocket clients pass the key as the second `Sec-WebSocket-Protocol` value.
- **Without a key:** the API is accepted only from loopback; mutations additionally require `X-EdgeProxy-CSRF: 1`. A non-loopback `HOST` without a key aborts startup.
- Browser origins are checked against the request host (plus `EDGEPROXY_ALLOWED_ORIGINS`).
- From the dashboard console, persist a key for the session with:

  ```js
  localStorage.setItem("edgeproxy_api_key", "<key>");
  ```

## Docker

```bash
cp .env.example .env
# set EDGEPROXY_API_KEY and EDGEPROXY_INTERNAL_SECRET
docker compose up -d --build
```

- Gateway: public `80`, `443`, `4242`; private IPC `8081` (Docker network only).
- Dashboard: published as `127.0.0.1:3000` only. Use an SSH tunnel:

  ```bash
  ssh -L 3000:127.0.0.1:3000 user@server
  ```

- Certificates persist in the `edge-certs` volume. They are **self-signed**.

## Gateway CLI flags

```text
-http-port          Public HTTP ingress port (default 80)
-tls-port           Public HTTPS ingress port with SNI TLS (default 443)
-tunnel-port        Agent tunnel port (default 4242)
-domain             Base wildcard domain (default edgeproxy.mesh)
-rps / -burst       Per-IP token bucket (default 100 / 150)
-internal-addr      Private IPC address (default 127.0.0.1:8081)
-internal-secret    Shared secret for private IPC (required to enable it)
-cert-dir           TLS certificate directory (default ./certs)
-tunnel-tls         Enable TLS on the tunnel wire (default false)
-tunnel-cert        PEM certificate for the tunnel listener (optional)
-tunnel-key         PEM private key for the tunnel listener (optional)
-tunnel-ca          CA bundle to verify agent client certs (enables mTLS)
-tunnel-max-conns   Max concurrent agent connections (default 1024)
-acme              Enable Let's Encrypt (requires -tags acme build)
-acme-domains      Comma-separated domains for ACME
-acme-email        Contact email for ACME registration
-acme-cache        ACME certificate cache dir (default ./acme-cache)
```

## Observability

- Prometheus metrics: `GET /metrics` on the private IPC listener (`:8081`), including active tunnels, goroutines, heap usage and per-tunnel byte counters.
- Profiling: `/debug/pprof/*` (index, cmdline, profile, symbol, trace) behind the same shared-secret auth.
- Agent telemetry: per-tunnel RPS, latency percentiles, bytes in/out, error count, reported every 5 s via `FrameMetrics`.

## Testing, benchmarks and CI

```bash
make test        # go vet + go test + node tests + tsc
make bench       # Go micro-benchmarks (framing, routing, authorization)
make fuzz        # Fuzz wire protocol parser and subdomain validator
make security    # gitleaks over the working tree
npm run build
```

CI (`.github/workflows/ci.yml`) runs Go build/vet/race tests, TypeScript checks, unit tests, the production build and a gitleaks secret scan.

### Benchmarks and fuzzing

```bash
# Go micro-benchmarks (framing, routing, authorization)
cd gateway && go test ./... -bench=. -benchmem

# Fuzz the wire protocol parser and subdomain validator
cd gateway && go test ./protocol/ -fuzz=FuzzReadFrame -fuzztime=30s
cd gateway && go test ./proxy/ -fuzz=FuzzValidSubdomain -fuzztime=30s
```

#### Reference results (Go 1.22, AMD64, 12 cores)

| Benchmark | ns/op | MB/s | B/op | allocs/op |
| --- | --- | --- | --- | --- |
| `ReadFrame` (1 KB payload) | 594 | 1739 | 1136 | 4 |
| `Encode` (1 KB payload) | 460 | 2245 | 1152 | 1 |
| `ValidSubdomain` | 4.6 | — | 0 | 0 |
| `VerifyAuthorization` | 419 | — | 192 | 3 |

These are micro-benchmarks of the hot path; end-to-end RPS/p99 depend on network, local service and hardware.

## Security notes

The following controls are implemented:

- Firestore rules deny **all** direct client access; the server uses the Firebase **Admin SDK**.
- Tunnel/agent tokens are 256-bit CSPRNG values; only SHA-256 hashes are stored and compared in constant time.
- The gateway denies tunnel registration by default: no configured tunnel, inactive tunnel, empty hash or invalid token all fail.
- `/internal/*` handlers live on a separate listener, require a shared secret, and are never attached to the public ingress.
- Control-plane input is validated (subdomain, ports, protocols, IPs, query shape) and error responses do not leak internals.
- Secrets are redacted from users/collection APIs.
- Request bodies are capped at 1 MB; security headers and a production CSP are set.

See [`SECURITY.md`](SECURITY.md) for the threat model and deployment checklist.

## Limitations

- **TLS is self-signed by default.** The gateway generates ECDSA certificates for the edge mesh; they are not trusted by browsers. For publicly trusted certs, build with `-tags acme` and run with `-acme -acme-domains ...` (Let's Encrypt). Do not present the default as public ACME/Let's Encrypt.
- **The tunnel wire (`:4242`) supports optional TLS.** Enable it with `-tunnel-tls` on the gateway (and `-tunnel-tls` on the agent). By default it is plain TCP for backwards compatibility; run it on a trusted network or enable TLS/mTLS for production. The agent token authenticates the tunnel but, when TLS is off, does not encrypt it.
- **Single-admin authorization.** There is no user login or per-tenant RBAC; the control plane is an admin surface.
- **The PostgreSQL schema in `db/` is optional reference material.** The running control plane uses Firestore (or memory).
- **Fuzzing is available locally** (`go test -fuzz=...`); CI runs unit tests, type checks and a secret scan. DAST is not yet wired into CI.

## License

[MIT](LICENSE)

---

Made by **ItOmegaDev** · https://github.com/ItOmegaDev/EdgeProxy

---

## Українською

EdgeProxy — self-hosted edge reverse proxy: Go-шлюз обробляє публічний трафік, Go-агент тунелює локальні сервіси, Node.js/React відповідають за керування та телеметрію.

Швидкий старт:

```bash
cp .env.example .env
# заповніть EDGEPROXY_API_KEY та EDGEPROXY_INTERNAL_SECRET (openssl rand -hex 32)
npm ci && make build
./bin/edgeproxy-gateway -http-port 8080 -tls-port 8443 -tunnel-port 4242
npm run dev
```

Важливо:

- Панель за замовчуванням слухає `127.0.0.1`; для віддаленого доступу задайте `EDGEPROXY_API_KEY`.
- Firestore-правила закриті повністю; сервер працює через Admin SDK.
- Токени агентів зберігаються лише як SHA-256-хеш.
- TLS у шлюзі **самопідписаний**; тунель `:4242` за замовчуванням — звичайний TCP, але можна увімкнути TLS/mTLS через `-tunnel-tls`.
- PostgreSQL-схема в `db/` є довідковою; робоче сховище — Firestore (або пам'ять).
