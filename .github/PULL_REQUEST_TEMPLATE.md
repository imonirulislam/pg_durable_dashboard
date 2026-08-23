## What this changes

<!-- And why. If it's a bug fix, what the wrong behaviour was. -->

## Checks

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` passes in
      each package you touched
- [ ] Tested against a real pg_durable — `demo/` brings one up if you don't have
      one handy

## If this touches any of these, say how you checked it

- [ ] **Stored credentials or `APP_SECRET`** — `KEY_SALT` unchanged? (Changing it
      makes every saved password undecryptable.)
- [ ] **TLS / sslmode handling** — does the mode the UI displays still match what
      gets enforced?
- [ ] **What the server can reach** — binding, CORS, accepted hosts. This API has
      no authentication of its own, so widening its reach is a security change.
- [ ] **The execution graph** — does the rendered node and edge count still match
      what `df.instance_nodes()` returns, including an `IF`'s condition node?
