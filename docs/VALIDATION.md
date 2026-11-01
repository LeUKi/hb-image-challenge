# Validation · 2026-11-01

## Passed locally

- Node 22.20.0; React 19.3.1; TanStack Start 1.169.4 / Router 1.170.46; Vite 8.3.5; Wrangler 4.156.0.
- ESLint and `tsc --noEmit` passed.
- Vitest: 25 backend tests in 4 files. Real SQLite statements validate atomic reservation, idempotency and nonce consumption. JWT tests generate and verify actual ES256 signatures. AI/R2 are explicit test doubles; no inference was performed.
- Default-platform JWT regression tests accept correctly signed official-site page/judge tokens without `HB_SITE`, reject foreign issuers, and retain strict explicit override validation. Local simulator overrides remain available.
- Platform-request regressions require Workers-supported `redirect: 'manual'`, reject redirects without following them, and cover failed connections, non-success responses, invalid JSON and mismatched packets. Public author metadata uses an internal UUID; ownership is verified through the signed JWT's numeric `sender`, and the trusted activity response must match its signed `hongbao`.
- Official hongbao kit: 22 judge tests passed; `npm run judge:check` ended with `可以去网站部署了`.
- Client and Worker SSR bundles built successfully using the Cloudflare Vite adapter. No Nitro or separate Node server.
- Built Worker ran locally in workerd. Initial HTML already contains the title, challenge, upload interface and linked stylesheet; CSS requests returned 200.
- Headless Chrome: 1440px / 390px / 320px, no horizontal overflow; valid/invalid file selection, image removal, route navigation and author ID form validation passed. No browser exceptions or hydration errors. The typography correction also checks visible body/control text at 16px minimum, 48px image selection / 44px removal targets, and initially visible instructions that can collapse and reopen.
- Official `judge:page -- --shot --port 8850`: wide, phone and open drawer screenshots generated; SDK connected; no page errors or failed resource loads. Screenshots are local, ignored artifacts under `shots/`.
- D1 initial migration applied successfully to local storage.
- A local workerd probe reproduced the live upload blocker: `redirect: 'error'` throws before sending the request. The same public activity request with `manual` returned HTTP 200. The corrected `loadChallenge` also parsed that live activity's real parameters, including its five-attempt limit, using a local diagnostic identity fixture. This diagnostic reads only public metadata; it does not authenticate a production player, upload an image, invoke AI or award money.
- Deploy template declarations checked against Cloudflare's documented rules: `OWNER_ID` is the only declared public app variable; `HB_SITE` defaults to the official platform in server code. The local config sample moved out of the recognized root secret-example filenames to `docs/local-worker-config.example`; no root `.dev.vars.example` or `.env.example` remains. Both source and generated deployment configuration retain `workers_dev: true` and `preview_urls: false`: the production address is enabled and version preview addresses are disabled. These settings do not control the platform's Enable Preview Builds checkbox. These checks verify the local configuration, not the account's live routing state or a completed Cloudflare deployment wizard.
- Production dependency audit: 0 reported vulnerabilities. The full development tree currently reports 11 moderate findings propagated from a minimatch advisory in lint tooling. No incompatible forced dependency downgrade was applied.

## Limits of this evidence

- No production Worker, R2 bucket or D1 database was provisioned by this development run.
- Real Workers AI latency, scoring quality, Neuron usage and Worker CPU usage are unmeasured.
- The official Deploy button is configured but has not been walked through against a fresh Cloudflare account. Its resource provisioning and first R2 activation are unverified here.
- Production hongbao JWT and money transfer have not been exercised. Simulator screenshots establish SDK/layout integration, not real scoring or payment.
- The backend deliberately reads the real platform's `/api/activities/:id` to obtain trusted rules. The pinned official simulator does not provide that public activity endpoint. Full upload testing against only that simulator therefore needs a trusted local fixture adapter or upstream support; this repository does not relax validation to accept player-supplied rules.
- The build emits a CSS sourcemap warning from Vite's CSS processing. SSR HTML and actual stylesheet delivery were checked successfully.

## Reproduce

```sh
npm ci
cp docs/local-worker-config.example .dev.vars
# Set OWNER_ID in .dev.vars to your LINUX DO numeric user ID.
npm run db:local
npm run check
npm run preview
# In a separate terminal:
npm run smoke
npm run judge:page -- --shot --port 8850
```

`smoke` uses a locally installed Chrome; set `CHROME_PATH` and `BASE_URL` if needed.
