# Validation · 2026-11-01

## Verified changes

- `npm run check` passes ESLint, TypeScript, **71 application tests in 11 files**, the client and Worker SSR builds, **44 official judge tests**, and the official judge source check. The latter reports `可以去网站部署了`. Node 22.20.0, Vite 8.3.5 and Wrangler 4.156.0 were used.
- Backend tests use real SQLite statements for atomic attempt reservation, idempotency, frozen rules and pagination. Identity tests generate and verify ES256 signatures. Gallery tests cover cross-player and cross-packet permissions, grants bound to a numeric identity, private legacy uploads, explicit sharing consent, and image endpoint permissions.
- Clef input tests verify separate matching and fixed NSFW questions in the same call. Missing or invalid NSFW answers remain unknown, rather than being treated as safe. These are schema and parsing checks; real model accuracy is not measured.
- Reward tests cover interval endpoints, narrow ranges, hundredths of a score, integer-cent flooring, equal score bounds, fixed rewards, older frozen configurations and final-pool truncation. Judge verification failures do not consume an image result; a recovered service can accept the same result on a later manual submission.
- Client tests cover participant states, unresolved submissions, identity expiry, private image headers, NSFW covers, gallery merging, stable column assignment, and late responses from a previous participant. Tokens remain in memory and authenticated requests; image links use local blob URLs.

## Official simulator and real local storage

`npm run simulator` builds the actual Worker SSR application and starts the unmodified official kit, a local-only activity adapter, and Wrangler's local D1/R2 bindings. The adapter runs the production API handler. Page and judge tokens are signed by the official simulator and validated through the normal product authentication code. Remote AI bindings and secret files are absent from the local simulation environment.

AI is an explicit local substitute, and every simulated page is labeled accordingly. Seed illustrations are original, harmless PNG files generated in this repository. The mock scores demonstrate behavior and are unrelated to the visual content of a player's own upload. No real inference or payment occurs.

`node scripts/simulator-api-smoke.mjs` passes against a fresh simulator:

- The initial gallery contains six anonymous, shared records outside the target interval, including one harmless NSFW-cover demonstration. Authenticated image reads retrieve the actual PNG bytes from private local R2.
- A 35% upload can be restored before judge submission, with four attempts remaining. Its submission awards nothing and does not unlock others' successful images.
- A subsequent 75% upload maps the 70–80% interval to 1–10 LDC, and the real judge settles **5.50 simulated LDC**. The exact accepted result ID and gallery grant appear only in the player's private view.
- A refreshed identity plus that private grant unlocks ten records and the permitted original images, while restoring the latest upload and three remaining attempts.
- A different numeric identity cannot borrow the grant. A page JWT cannot call the judge-only result endpoint. Public activity state contains no grant.

The official kit does not provide the production public activity endpoint. The adapter supplies that endpoint only inside the local script from trusted simulator state; the deployed Worker has no fixture route, mock AI branch or authentication bypass. The kit broadcasts updates to the participants of one multi-player host page. Separate simulator host tabs do not subscribe to each other's changes.

## Rendered UI checks

`npm run smoke` passes with the built SSR Worker: HTML and linked stylesheets return 200; 1440 / 390 / 320px layouts fit; visible body text and controls stay at least 16px; selection, invalid files, removal, first-use guidance and modal help work. The player page has no navigation bar. The author setup form remains reachable at `/setup` and its numeric ID validation works.

`scripts/participant-smoke.mjs` passes **18 scenarios**, using the official SDK across two virtual origins with simulated platform responses. These cover a real file chooser on the first click, first-click NSFW reveal, same-name account changes, late uploads/submissions/record queries, a manually retried verification outage with only one upload, unresolved submissions without automatic retries, and completion restoration. Browser errors are empty at 320 / 390 / 1440px. This harness does not prove the real backend or payment path.

`scripts/simulator-smoke.mjs` exercises the actual official simulator, production upload handler and local storage in Chrome. It checks anonymous score cards, NSFW preferences, modal closing, upload and claim restoration, green/white scores, automatic insertion, fixed columns, scroll anchoring, mobile widths and activity end. It also compares the actual page/gallery bounds before and after locking background scroll; hidden scrollbars must not cause horizontal movement or width changes. A shorter column insertion at the bottom must preserve the first visible reading card, with temporary space released on returning to the top. Screenshots are local ignored evidence under `shots/`.

The full official-simulator browser script passes. It performs real signed uploads and settles the 75% result at 5.50 simulated LDC, verifies first-click file selection, inserts another participant's new image via the official SDK, and checks actual scroll geometry. In the final end-of-activity check, the backend immediately allows all eleven shared records, while the already-open frontend obtains them on its visible 60-second fallback (measured 60.2 seconds). The activity-ended notice and upload closure arrive earlier; full-gallery unlock should not be described as instant in an already-open page.

## Deployment boundary

This iteration changes local source, the judge artifacts, documentation and simulator tooling. It does not publish a new Worker or update the separately stored public judge on the hongbao site.

The template continues to declare only the `OWNER_ID` application variable. `HB_SITE` defaults to the official platform; AI/R2/D1 use author-owned bindings. Source and generated deployment configuration retain `workers_dev: true` and `preview_urls: false`. Cloudflare's separate Enable Preview Builds checkbox is not controlled by the latter setting.

Real Workers AI scoring quality, latency, Neuron use and Worker CPU use remain unmeasured. This run does not establish production JWT/payment behavior, first-time Cloudflare resource activation, or a fresh account's Deploy Button flow. Vite still emits its upstream CSS sourcemap warning; built HTML, actual styles and rendered layouts were tested.

## Reproduce

```sh
npm ci
npm run check
npm run simulator:start
# From another terminal, against the fresh seeded instance:
node scripts/simulator-api-smoke.mjs
# Stop/restart the simulator to reset local data, then:
node scripts/simulator-smoke.mjs
# UI state harness and standalone SSR/layout checks:
node scripts/participant-smoke.mjs
npm run smoke
```

`npm run simulator` builds before starting; `simulator:start` reuses the last build. Restart after stateful checks to restore a fresh player experience. `SIMULATOR_PORT` changes the kit's host/page ports; service ports 5173/5175 must also be free. Chrome checks use a local installation; `CHROME_PATH`, `BASE_URL`, `SIMULATOR_URL` and `SERVICE_URL` can override the corresponding local defaults. Stateful simulator smoke checks reject non-local HTTP targets.
