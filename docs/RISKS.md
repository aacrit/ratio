# Risk plan

The brief's three top risks, each with its mitigation, an enforcer and the phase that delivers it. The founder asked for this plan at G1 (2026-10-03). A risk without an enforcer is a wish.

## R1. Taste is not all maths

The rulebook can give stiff or wrong advice, because proportion and harmony are only part of what makes an outfit work.

| Mitigation | Enforcer | When |
|---|---|---|
| Every rule cites its source and states its band edges in the public Rulebook (`/rules`). | A test that every rule id in `web/src/engine/rules.ts` has a Rulebook entry with a source. | Forge |
| A labelled fixture set of 60 public-domain or CC-licensed full-figure photos (Wikimedia Commons, pinned by URL and SHA-256, never in git). Two people label each one independently with the band they would give it, plus agree/disagree with each advice line. | CI scores the engine against the labels: proportion band agreement ≥ 85%, and 0 advice lines both labellers reject. | Blueprint (labels), Forge (CI) |
| A stylist persona joins the user-sim at G2 and on the preview before G3, judging whether each line is advice a professional would give. | User-sim report in the G2 and G3 packets. | G2, G3 |
| Rules say "keep it" as readily as they say "change it". Advice is never manufactured to look useful. | A fixture test: a golden-section outfit gets no change advice. | Spark (synthetic), Forge (photos) |
| The feedback widget asks one question under each read: "Was this useful?" The answer is an aggregate count per rule id, never stored with the photo. | `/e` counts `advice_useful` and `advice_not_useful` by rule. A rule under 50% useful after 200 votes goes to review. | Forge |

## R2. Bias and sensitivity

Segmentation and colour readings may work less well on some skin tones, hair types and body shapes. Photos of bodies are sensitive.

| Mitigation | Enforcer | When |
|---|---|---|
| The fixture set is balanced across the 10 Monk Skin Tone scale bands (6 photos per band), and across body shapes and ages (adults only). | CI reports accuracy per Monk band. The gate fails if any band's segmentation success or proportion agreement is more than 10 points below the overall rate. The G3 packet shows the table. | Forge, G3 |
| Garment colour is sampled only from pixels labelled clothes, never skin. Undertone (Face, later) picks palettes and is never shown as a label for the person. | A test that colour sampling reads no skin-category pixel. Copy lint on the Face rulebook. | Spark (clothes only), Face ticket |
| No storage, no upload, no account. The photo exists only in the tab's memory and is dropped when the tab closes. | CSP `connect-src 'self'`; a test that no code path posts image bytes; a Playwright zero-egress run before G3 (Dial's pattern). | Spark (CSP), Proof (zero-egress) |
| Copy never judges the body or the person (V4). | `JUDGING_WORDS` copy lint over every line the rulebook can produce (`tests/engine.test.ts`). | Spark |
| Adults only: the upload step says so plainly, and Ratio refuses nothing silently. | The privacy page and the upload copy, checked by the contract. | Forge |
| Several people in one photo: Ratio reads only the person the pose found (the mask component holding their shoulders, hips and knees, clipped to a corridor round the skeleton when they touch someone) and says which one it read. **Known limit:** when the pose's joints land on no person pixels, Ratio cannot separate that person; it reads the corridor alone and says so plainly ("Ratio could not separate the person it read; if others are in the photo, crop to one."). People who overlap within the corridor are not told apart. | `web/src/engine/person.ts` with `tests/read-trust.test.ts`; a recolour shows on the photo only when it passes `honesty` in `web/src/tryon/recolour.ts`. | Forge (T2) |

## R3. Determinism across devices

"Same photo, same advice" must hold on every device, but floating-point arithmetic in the models can differ by processor.

| Mitigation | Enforcer | When |
|---|---|---|
| One numeric path: the WASM SIMD runtime only, the processor delegate only, never the graphics chip. | `web/src/vision.ts` sets `delegate: "CPU"`; `scripts/fetch-models.mjs` stages only the SIMD runtime. | Spark |
| Our own resampler instead of the browser's canvas scaling. | `web/src/engine/resample.ts`, with exact-output tests. | Spark |
| Measurements rounded to fixed bins before any rule reads them; the reading hash covers only the engine version and the bins. | `tests/engine.test.ts` (same input, same reading and hash). | Spark |
| A value within half a bin of a band edge is marked "borderline" on screen with both readings, instead of flipping silently. | A unit test per band edge. | Spark (proportion), Forge (all rules) |
| Golden hashes for the fixture photos (the first-visit sample plus p1 and p2) in Chromium, Firefox and WebKit. | `scripts/fixture-hashes.mjs`, launching its own Chromium, Firefox and WebKit against a local preview, reads each fixture through the real UI path and compares the reading hash and its bins with `fixtures.lock.json`; a fast unit test (`tests/fixtures-lock.test.ts`) separately catches an `ENGINE_VERSION` bump with a stale lock. Both run in the `determinism` job, a prerequisite of the `gate` job (`.github/workflows/gate.yml`), so a disagreement blocks merge the same way a red `gate` does. Chromium is read on Linux (`ubuntu-latest`); Chromium, Firefox and WebKit are read on macOS (`macos-latest`), so x86 and ARM are held to the same hashes (Linux WebKit gives the read worker no WebGL2, which MediaPipe needs even on the CPU delegate). Each fixture is read in a fresh browser context and only the reading its own upload produced counts; two fixtures with one hash fail both the check and `--update`. Every browser the lock lists as `ok` is enforced. **Known limit:** a browser that cannot run the models at all (every fixture failing with the same error) is recorded in the lock as `"<browser>": "unsupported: <measured reason>"` and excluded from agreement, never marked passing; `--update` writes that record over an `ok` only when `--allow-unsupported <browser>` names it, so it is a reviewed edit to the lock, never automatic. | Forge (T5) |
| The browser never decodes, rotates or colour-manages a photo: engines decode the same JPEG to different pixels (Safari's ImageIO against libjpeg-turbo) and convert tagged photos differently (every iPhone photo is tagged). | `web/src/decode.ts` (MozJPEG, png crate and libwebp as WebAssembly from pinned npm packages, served from this origin), `web/src/engine/orient.ts` (EXIF orientation) and `web/src/engine/icc.ts` (profile on integer tables); `tests/decode.test.ts`, `tests/colour-profile.test.ts`; the fixture hashes above hold the three engines to the same pixels end to end. | Forge (T5, founder decision 2026-10-05) |
| The engine version is printed with every reading, so an engine change explains a changed hash. | The read screen shows `ratio-engine/x.y.z`. | Spark |
