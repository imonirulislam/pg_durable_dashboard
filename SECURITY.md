# Security

## Reporting a vulnerability

Please report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(Security → Report a vulnerability) rather than opening a public issue. Expect
an acknowledgement within a few days.

## What this app is, security-wise

Read this before deploying it anywhere other than your own machine.

**It has no authentication of its own.** There are no users, sessions, or API
keys. Anyone who can reach the port can read every workflow on every configured
database, and add or remove connections. Access control is entirely up to what
you put in front of it.

**It stores database credentials.** Connections added through the UI are kept in
SQLite (`$DATA_DIR/connections.db`), with the password encrypted using
AES-256-GCM. The key comes from `APP_SECRET`; if that is unset, the server
generates one at `$DATA_DIR/secret.key` (mode 0600) and warns on startup. Set
`APP_SECRET` from a secret manager for any real deployment. Passwords are never
returned to the browser by any endpoint.

**It will connect to hosts it is told to connect to.** The connection form takes
a host from the browser, which makes the server an SSRF vector if it is exposed:
someone could ask it to open TCP connections to internal addresses and learn
something from the error messages. Set `ALLOWED_DB_HOSTS` to an explicit
allowlist to close that off.

**It only reads.** Every data route wraps a single `df.*` read function — no
route writes to a monitored database. The connection store is the only thing
this app writes to.

## Deploying it safely

- Bind to loopback (the default: `HOST=127.0.0.1`) and publish the container
  port to `127.0.0.1` only. In the image `HOST` is `0.0.0.0` because a container
  cannot be reached otherwise, so the published port is the real control.
- Put an authenticating proxy in front if it needs to be reachable — Cloudflare
  Access, oauth2-proxy, or your own SSO gateway. Terminate HTTPS there.
- Set `APP_SECRET` and `ALLOWED_DB_HOSTS`.
- Use `sslmode=verify-full` for any database not on localhost. `require`
  encrypts but does **not** verify the certificate, so it does not protect
  against an active attacker.
- Prefer a per-user database role over a shared superuser where you can.
  pg_durable applies row-level security scoped to `submitted_by = current_user`,
  so a non-superuser sees only its own instances — which limits the blast radius
  of the dashboard being reachable, at the cost of a fleet-wide view.

## Verifying a release

Images are signed with Sigstore keyless signing; the signing identity is the
publishing workflow, so there is no long-lived key to trust:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/imonirulislam/pg_durable_dashboard/.github/workflows/release.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/imonirulislam/pg_durable_dashboard:latest
```

A signature proves where an image came from. It does not make an exposed,
unauthenticated dashboard safe.

## Supported versions

Pre-1.0: fixes land on the latest release only.
