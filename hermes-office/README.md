This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Connection reliability (Hermes Gateway)

MINPOP has two independent links, shown separately in the UI header:

- **Gateway** — the Next.js server holds one `HermesClient` that opens a single
  WebSocket to `ws://127.0.0.1:9119/api/ws?token=…`. Transient drops reconnect
  with capped exponential backoff (1s → 15s). A rejected token (HTTP 401/403)
  is treated as a permanent auth failure: the retry loop stops so it cannot
  hammer the Gateway, and a sanitized recovery hint is shown.
- **SSE** — each browser tab opens `GET /api/hermes/events` (`text/event-stream`).
  Every tab subscribes to the same single upstream `HermesClient`; connecting
  more tabs does **not** open additional WebSocket connections.

### Session token lifecycle

In loopback/headless mode the Gateway mints a fresh dashboard session token on
every start and injects the current value into its root HTML as
`window.__HERMES_SESSION_TOKEN__` (`hermes_cli/web_server.py::_resolve_session_token`).
`HERMES_SESSION_TOKEN` in `.env.local` must match that value. After a Gateway
restart the old `.env.local` token is stale and the WebSocket upgrade fails with
401/403.

### Recovering from a stale token

1. Read the current token from the Gateway root HTML (never commit or paste it
   into source):

   ```powershell
   (Invoke-WebRequest http://localhost:9119/).Content
   # copy the value of window.__HERMES_SESSION_TOKEN__
   ```

2. Write it to `HERMES_SESSION_TOKEN` in `hermes-office/.env.local`
   (git-ignored).
3. Restart the Next.js dev server — the environment is read once at boot.
4. Verify home returns 200, the **Gateway** badge is `up`, and SSE delivers a
   state frame.

### Optional: pin the token across Gateway restarts

The Gateway reads `HERMES_DASHBOARD_SESSION_TOKEN` at startup
(`_resolve_session_token`) and will use it instead of minting a random value.
Setting it in the Gateway's launch environment (or `~/.hermes/.env` for a
manually launched gateway) makes the token stable, so `.env.local` never goes
stale. This is documented in the Gateway's
`website/docs/reference/environment-variables.md`.

Security note: a pinned token does not rotate, so use a strong random value,
keep it loopback-only, never commit it, and keep `.env.local` ignored. If in
doubt, prefer the per-start token plus the recovery procedure above.
