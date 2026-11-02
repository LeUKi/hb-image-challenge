# Validation · 2026-11-02

## Shared result viewer and packet-wide image deduplication

- Successful scoring resets the file input, form value, filename and upload preview. It opens the gallery's existing viewer with the local image, the actual matching and NSFW scores, the target interval, Clef Omni model name and known pixel dimensions. Missing safety scores remain unknown and covered. No extra inference, fabricated labels, confidence field or generated explanation was added.
- The viewer owns the selected result's reward and submission actions; the background keeps a compact latest-score summary. Closing or refreshing does not automatically submit or reopen a result. Older own gallery records use an authenticated, abortable, identity-scoped read before offering submission; selecting someone else's record offers no reward action. Existing claimed, settled, ended and unresolved-submission guards remain in force. This does not add multiple rewards per player.
- If image saving is disabled, a just-scored image remains viewable through a local blob for the current page only. Selecting another file, changing the numeric player or leaving the page releases it. After reload, only the saved scoring record is available.
- The built-page browser harness passes the scored-file reset, summary/gallery reopening, refresh without an automatic popup, unsaved local-image recovery boundary, selected historical result submission and reactive duplicate error cases. Fixed 320/390/1440px contexts verify readable details and no horizontal overflow; short 640px viewports can scroll to the submit button. Layout screenshots are recorded without resizing the same interaction fixture or capturing an over-height iframe element.
- The full official-simulator browser flow also passes: a 35% record can be closed, reopened and submitted through the common viewer; a subsequent 75% record awards 5.50 simulated LDC and remains completed after refresh. Ordinary platform `me` broadcasts hide private content during identity verification but retain the selection for the same numeric actor. Actual identity changes clear it before painting. Both browser suites finish without uncaught page or hydration errors; deliberately rejected duplicate requests and dropped like responses produce expected network errors.
- Migration `0004_image_dedup.sql` reserves `(hongbao, image_sha256)` atomically with the player's attempt. It backfills existing ready/processing records without deleting historical copies. Concurrent players can start only one inference/storage pair for identical file bytes. A rejected duplicate still consumes an attempt, returns its remaining count, exposes no original result or identity and creates no gallery item. Replaying its idempotency key does not consume another attempt. Confirmed processing failure releases only its own claim; an unresolved crashed operation is not automatically expired.
- Focused SQLite/API tests cover same-player and cross-player duplicates, nine concurrent players, concurrent idempotent requests, exhausted limits, no-storage uploads, cross-packet reuse, failed-operation release and historical backfill. The official-simulator API flow additionally passes with real local D1 triggers, R2 and signed identities: a different player uses their final attempt on a duplicate, gets zero remaining, cannot discover the original result and cannot repeat AI work by replaying that request.
- Deduplication is byte-exact. Cropping, re-encoding or otherwise changing file contents can produce a different hash. Player copy contains no advance duplicate warning; only an actual rejected upload produces the short consumed-attempt message.

## Batched anonymous likes

- Cards and image details have a heart and anonymous count. Each tap updates locally; it does not fetch images, open the image dialog or change ordering. An outbox stores unsent taps, an immutable in-flight batch and its deadline in actor-scoped session storage when available. Ordinary reloads restore the same state. A per-page actor cache also prevents an old request from overwriting a replacement outbox after an account switch.
- The first tap fixes a 30-second deadline; continued tapping does not postpone it. Pending taps use one bounded batch per 30 seconds, combined with gallery reads in `POST /api/gallery`. Passive viewers keep the existing visible 60-second fallback; hidden pages stop scheduled work. Taps made while a request is in flight remain pending after its acknowledgement.
- Migration `0003_gallery_likes.sql` adds the aggregate, immutable batch ledger and numeric-player gate. One D1 batch transaction applies deduplication, increments and the 30-second gate. Duplicate UUID payloads are acknowledged without adding again; changed payloads return 409. The same player shares the gate across tabs. Read-only `receiptFor` recovers a lost acknowledgement without another write batch.
- Gallery reads, watched old cards and like targets share the same server visibility predicate. Hidden, private, cross-activity, missing and unfinished targets expose no counts and are uniformly rejected. There is no public voter list. Likes cannot change scores, rewards or attempt limits.
- **40 new focused tests** cover the client outbox and server API, including deadline persistence, in-flight taps, corrupt/unavailable storage, bounded batch fairness, replay/conflict, transaction rollback, serialized concurrent gates, privacy and receipt recovery. These tests use SQLite and mocked authentication where appropriate; the official-simulator API smoke additionally verifies real D1 with signed official identities.
- The official SDK browser harness passes **six new likes scenarios**, in addition to its 18 lifecycle scenarios: 300 taps plus a tap at 29.9 seconds produce one batch at the original deadline; passive counts refresh without another write; images and geometry remain stable; in-flight taps survive; lost responses recover without doubling; reload preserves the deadline; an offscreen target after 220 loaded records receives its confirmed base count; same-name numeric accounts keep separate outboxes. The deliberate dropped-response test emits an expected network error; there are no uncaught page or hydration errors.
- A final likes-only browser pass also verifies a 9,999-like counter beside a 100% score at 320 / 360 / 390 / 1440px. Their bounds do not overlap, the heart retains a 44px touch target and the page has no horizontal overflow. The narrow layout places the heart at the upper left.
- The unmodified official simulator with real local D1/R2 passes both the API and browser flows. The API test stores 300 likes once, rejects a new batch inside the gate, recovers its receipt without writes and allows an independent numeric account. Real browser clicks immediately show five likes, then persist in **one** scheduled batch. That same 30-second sync obtains all shared records after activity end (measured 30.2 seconds in this run); passive viewers still use the 60-second fallback.
- Frontend batching limits ordinary interactions. Requests made directly against the endpoint still reach the Worker; this change does not claim edge-level abuse protection. Closing a tab before sync is not guaranteed to preserve its session outbox. Restricted storage falls back to memory.

The judge source and fingerprint are unchanged. Existing deployments must update the Worker and apply the new D1 migration; the default deploy script already applies migrations. No production deployment or real AI call is part of this verification.

## Verified changes

- `npm run check` passes ESLint, TypeScript, **121 application tests in 14 files**, the client and Worker SSR builds, **44 official judge tests**, and the official judge source check. The latter reports `可以去网站部署了`. Node 22.20.0, Vite 8.3.5 and Wrangler 4.156.0 were used.
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
- A different numeric player uploads those same bytes and consumes their final attempt, receives a 409 duplicate response with zero remaining, and does not add a gallery record. Replaying the same idempotency key preserves zero remaining and reveals neither the original result ID nor its score. The next distinct upload still receives the next mock score, confirming no duplicate inference took place.
- A subsequent 75% upload maps the 70–80% interval to 1–10 LDC, and the real judge settles **5.50 simulated LDC**. The exact accepted result ID and gallery grant appear only in the player's private view.
- A refreshed identity plus that private grant unlocks ten records and the permitted original images, while restoring the latest upload and three remaining attempts.
- A different numeric identity cannot borrow the grant. A page JWT cannot call the judge-only result endpoint. Public activity state contains no grant.

The official kit does not provide the production public activity endpoint. The adapter supplies that endpoint only inside the local script from trusted simulator state; the deployed Worker has no fixture route, mock AI branch or authentication bypass. The kit broadcasts updates to the participants of one multi-player host page. Separate simulator host tabs do not subscribe to each other's changes.

## Rendered UI checks

`npm run smoke` passes with the built SSR Worker: HTML and linked stylesheets return 200; 1440 / 390 / 320px layouts fit; visible body text and controls stay at least 16px; selection, invalid files, removal, first-use guidance and modal help work. The player page has no navigation bar. The author setup form remains reachable at `/setup` and its numeric ID validation works.

`scripts/participant-smoke.mjs` passes **30 scenarios**, using the official SDK across two virtual origins with simulated platform responses. These cover the new shared viewer, short-screen layouts, historical own results and duplicate errors, a real file chooser on the first click, first-click NSFW reveal, same-name account changes, late uploads/submissions/record queries, a manually retried verification outage with only one upload, unresolved submissions without automatic retries, completion restoration and the six likes scenarios above. Browser errors are empty at 320 / 390 / 1440px. This harness does not prove the real backend or payment path.

`scripts/simulator-smoke.mjs` exercises the actual official simulator, production upload handler and local storage in Chrome. It checks anonymous score cards, NSFW preferences, modal closing, upload and claim restoration, green/white scores, automatic insertion, fixed columns, scroll anchoring, mobile widths and activity end. It also compares the actual page/gallery bounds before and after locking background scroll; hidden scrollbars must not cause horizontal movement or width changes. A shorter column insertion at the bottom must preserve the first visible reading card, with temporary space released on returning to the top. Screenshots are local ignored evidence under `shots/`.

The full official-simulator browser script passes. It performs real signed uploads and settles the 75% result at 5.50 simulated LDC, verifies first-click file selection, inserts another participant's new image via the official SDK, and checks actual scroll geometry. The earlier run without pending likes obtained all eleven records on its visible 60-second fallback (60.2 seconds). This run also verifies real clicks and one scheduled like batch; that combined request obtains the full gallery 30.2 seconds after activity end. The backend permission changes immediately; neither observation establishes instant full-gallery unlock for an already-open page.

## Deployment boundary

This iteration changes application source, the database schema, documentation and simulator tooling. Existing services need the Worker update and D1 migrations through `0004_image_dedup.sql`; the normal deployment script applies them. The judge artifacts retain their previous source and fingerprint. Verification does not publish a new Worker or update the separately stored public judge on the hongbao site.

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
