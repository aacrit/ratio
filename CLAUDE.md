# CLAUDE.md

Product law for **Ratio** (`ratio`). The Agentique plugin (installed via
`.claude/settings.json`) runs this product's org. This file holds law only,
capped at 150 lines, no history.

## What this is

Ratio is a single-purpose web product served at `https://ratio.voidvision.org`.
See `CHARTER.md` for its surfaces and kill dates, and `contract.yaml` for what
"serving correctly" means in a script.

Ratio reads a photo with the mathematics of design. On-device models
measure; a versioned rulebook advises. Three laws:

1. **The photo never leaves the tab.** No upload path exists. The models and
   their WASM runtime are staged from pinned hashes by
   `scripts/fetch-models.mjs` and served from this origin (`/mp`); CSP
   `connect-src 'self'`. Nothing about a photo is sent, stored or counted
   except `reading_completed`.
2. **Same photo, same advice.** The CPU delegate only (`web/src/vision.ts`),
   our own resampler (`web/src/engine/resample.ts`), measurements rounded to
   bins before any rule reads them, and a reading hash over the engine
   version and the bins (`web/src/engine/hash.ts`). A change to a rule or a
   bin bumps `ENGINE_VERSION` in `web/src/engine/rules.ts`. Values within
   half a bin of a band edge are shown as borderline, never flipped silently.
3. **Judge the choice, never the person.** Advice names a garment choice
   (tuck, hem, colour, shoes, parting, palette), never the body or face. No
   scores. `JUDGING_WORDS` in `web/src/engine/rules.ts` is linted over every
   line the rulebook can produce (`tests/engine.test.ts`).

**UX cadence.** Personas and cadence live in `design/personas.md`: every PR is screenshotted in CI; after every second merged ticket, and before any release, a holistic UX pass is run as Noor (the super user), with Sam and Mara on what changed. Findings become tickets, and the pass is logged on the Board roadmap.

No model writes advice: models only measure. An LLM is never on the read
path. The risk plan and its enforcers are in `docs/RISKS.md`; the design
language is law in `design/BRAND.md`.

## Fixed constraints

- **$0 running cost.** Everything fits the free tiers declared in `budget.yaml`.
- **No SSR.** Static frontend (`web/`, built to a generated dist directory)
  served by Workers Static Assets, plus one Worker (`worker/src/index.ts`)
  for `/e`, `/feedback`, `/healthz` and API routes. Only those routes run the
  Worker (`assets.run_worker_first` in `wrangler.jsonc`): a static asset must
  never cost an invocation. A new Worker route is added to that list.
- **Free quotas are account-wide.** Every D1 write path sits behind a day
  ceiling that writes nothing once reached (`worker/src/events.ts`), and the
  ceilings' worst case stays within the share `budget.yaml` states
  (`tests/hardening.test.ts` recomputes it from `wrangler.jsonc`). A new
  write path adds its ceiling and a line in `worker/src/config.ts`'s
  worstCaseDailyWrites. Every Worker request passes the per-client rate
  limit in `worker/src/guard.ts` (IPv6 per /64, never stored).
- **Web baseline.** Every response carries the security headers and CSP from
  `scripts/lib/csp.mjs` (static files through the build's `_headers`, the
  Worker through `worker/src/headers.ts`). POSTs are same-origin JSON only.
- **Data:** D1 only, schema in `migrations/0001_events.sql`. No R2, no KV
  writes, unless a charter amendment adds a surface that needs them.
- **Telemetry is aggregate counts only.** `/e` bumps a same-day, same-name
  counter in `event_counts`; there is no per-visit row, no anonymous id, and
  no cookie or local storage. No third-party analytics script (including
  Cloudflare Web Analytics) is added by default; adding one needs a charter
  amendment and a V3 check.
- **Success event.** `contract.yaml`'s success_event is the product's core
  action completing, sent from where it completes, and the one count
  `CHARTER.md`'s kill criteria name. Never page views or feedback.
  `scripts/lint-events.mjs` fails the gate otherwise.
- **Nothing loads from another origin.** Fonts are self-hosted
  (`design/fonts.css`); the CSP allows this origin only. Invocation logs are
  off. `web/privacy.html` says only what the code does: every claim is
  paired with its code in `tests/privacy-page.test.ts`, changed together.
- **No LLM feature** by default. One needs a charter amendment and the
  plugin's LLM add-on (free providers under a daily cap), never the Claude
  subscription.
- **Design:** `design/tokens.css` is the only file that may define a color.
  Ink & Momentum grammar is law; see the plugin's `ink-and-momentum` skill.
- **Production deploys** only via the plugin's `/release` skill, only from a
  release/* tag. This repo has no deploy workflow.

## Non-negotiables

1. No merge to `main` without a green `gate` job (`.github/workflows/gate.yml`).
2. Every ticket maps to a `CHARTER.md` row (see the plugin's `/ship` skill).
3. Secrets are never tracked; see `.githooks/pre-commit`.
4. Reports go to a gitignored reports directory or the Board page, never the repo root.
5. `/e` accepts only the event names `contract.yaml` lists under events.allowed.

## Commands

- `npm run dev`: Vite dev server plus `wrangler dev`.
- `npm run build`: production build to dist/, build tag injected.
- `npm run gate`: the full gate (typecheck, build, tests, lint-size, lint-workflows,
  lint-design, lint-docs, lint-events, gate-selftest). Must pass before any merge.
- `npm run contract -- --url <url>`: run `contract.yaml` against a live URL.
  Checks marked `requires: deployed` show SKIP on localhost and must PASS
  on the preview.
- `npm run scan-history`: scan full git history for leaked secrets.
