# Decisions

Append-only log of scope and architecture decisions for Ratio. Newest entry
at the bottom. Do not edit or delete past entries; add a new one that
supersedes it instead.

<!-- Format:
## YYYY-MM-DD: <short title>
<what was decided and why, 2-4 sentences>
-->

## 2026-10-03: G1 approved; the name is Ratio
The founder approved the brief in chat (AskUserQuestion) under the working title Plumb, with the note "Approved but also plan to address the 3 risks". The founder then chose the name Ratio (in Latin, both reason and proportion): `ratio.voidvision.org`. The risk plan is `docs/RISKS.md`.

## 2026-10-03: the vision model is on-device MediaPipe, on the processor
The Gemini free tier fails V3 (free-tier content may be human-reviewed and used for training), and Workers AI vision models are neither deterministic nor large enough on the free allocation. MediaPipe's pose landmarker and multiclass selfie segmenter (Apache 2.0) run in the tab on the CPU delegate. They measure; a versioned rulebook advises. No model writes advice.

## 2026-10-03: design language under Fable, decided in chat
At the founder's request the design language was made by the Studio designer on Fable. The founder's decisions: an atelier-and-geometer world; dark first with a designed light theme; a plumb-line drop (a damped pendulum) as the signature motion; exactly three earned accents (measured line, near the golden section, borderline).

## 2026-10-03: colour theory is half the engine
The founder asked that colour combination count as much as proportion. The engine carries four colour rules over the outfit's area-weighted palette: Matsuda's harmony templates (adapted to the OKLCH wheel), value structure, 60-30-10 shares and chroma with Albers' vibration. Personal colour (hair and skin contrast, undertone) was approved as palette input only, never a label for the person, and waits for the Monk-scale fixtures and their per-band accuracy gate (risk R2).

## 2026-10-03: Spark released
release/2026.10.03-1 on ratio.voidvision.org, contract 17/17. Stage moved to blueprint. The contract runner was transplanted from Dial for bursts via workers.dev.

## 2026-10-03: suggest looks and try them, on device, without an image model
The founder asked for outfit suggestions with a way to try them, without image models. The engine suggests by applying a fixed set of moves (tuck, belt, a colour swap for one piece, a darker lower piece, a muted voice, an accent) to the measured bins and re-reading each candidate with the whole rulebook; it ranks by improvement and drops any look that fixes one rule by breaking another. Trying a look recolours the photo's garment pixels in OKLab (each pixel keeps its own offset from its swatch, so folds and texture stay real); a tuck or a belt is shown on a chalk figure and by the break mark, never painted onto the photo. Built as a Blueprint spike on a branch (founder decision): nothing releases until G2, and the build slot stays with Dial. `look_tried` is counted; the per-event day ceiling moves from 4,000 to 3,000 to keep the worst-case D1 writes at 12.6% of the account.

## 2026-10-04: product plan decisions
The founder decided four plan questions in chat, each as recommended (plan: https://claude.ai/artifact/FZ5BWa4pKbzdo8QgZ4ukPh). Charter amendment: suggested looks and "try it" belong to the Read surface (photo recolour in the tab, chalk figure for proportion moves; no generated images, no body reshaping, no shopping links), replacing the brief's "no virtual try-on". The wardrobe is in v1 inside Read, opt-in and kept in this browser only. The first visit gets one public-domain sample photo, staged by hash like the models. After G2 the Rulebook page is built first.

## 2026-10-04: Dial on hold; Ratio takes the build slot
The founder put Dial on hold (archived, nothing torn down; Board gate `dial-hold`). The one build slot (R-07) is free for Ratio once G2 is signed.

## 2026-10-04: four UX design decisions (chat)
The sample is a painted full-length portrait of an adult in the public domain: Jacques-Louis David, The Emperor Napoleon in His Study at the Tuileries (1812). The Blue Boy was set aside because its sitter is a child and Ratio is for adults. The sample is staged by hash like the models and credited under the photo and on saved cards. A look is compared with a chalk wipe on the photo, worn left and look right, moved by a drag or a range control. "Save as card" draws a 4:5 card on Paper in the tab: the photo at rest, the readings, the palette, the hash and one site line. "Take a photo" opens the phone's own camera, shown only on touch screens, with a framing tip.

## 2026-10-04: premium redesign under Fable, and its four decisions
At the founder's request a Fable designer redesigned the UI within Cloth and Chalk: an app frame with a full-height photo stage, a reading sheet (phone: peek, half, full, flung with velocity; desktop: a side panel), the read pipeline in a Web Worker, physical motion everywhere, and a Lighthouse check in CI (mobile performance 99, accessibility 100). Decided in chat, each as built: the peek shows the hero numeral and its eyebrow only; the desktop split is stage 61.8% and panel 38.2%; offline caching waits for its own ticket with release-safe invalidation; trying a look on a phone drops the sheet to half.

## 2026-10-04: G2 signed off; occasion in v1
The founder signed off G2 in chat (Board gate `ratio-g2`) with the designer's defaults: Rules drills are closed until opened (`rule_opened` counts an opening), and the Card stays "printed" after download and redraws when new outfits are saved. The wardrobe keeps the reading and the chalk figure only, never the photo or a thumbnail. The Face hero numeral is length to width. The occasion chip comes into v1 (charter amendment, Board gate `ratio-charter-occasion`): optional work, evening or weekend, weighting the rules by a fixed table shown on the Rulebook page; the same photo and occasion always give the same reading. Ratio moves to build (Dial is on hold). The first ticket is the Rulebook page.

## 2026-10-04: Rulebook built (T1); rule_opened counted; per-event ceiling 2,500
The Rulebook page `/rules` renders every card from RULEBOOK at build time, with live instruments and the visitor's last read marked from this tab's sessionStorage (binned measurements and line labels only, never pixels; disclosed on the privacy page). `rule_opened` is the fourth client event, so the per-event day ceiling moves from 3,000 to 2,500 to keep the worst-case D1 writes at 14.0% of the account, under the 15% cap. Face and Card are tabs that open a "not yet built" drop cloth until their tickets ship.

## 2026-10-04: engine 0.6.0, read trust (T2)
From Noor's pass on the real build. The read uses only the person the pose found: the connected component of the segmenter's mask holding their shoulders, hips and knees, clipped to a corridor round the skeleton when they touch someone; one plain line says when other people are in the photo and where the read person stands, by thirds of the frame, and another when the pose could not single the person out (a known limit in docs/RISKS.md). A look's colour change is shown on the photo only when at least 60% of the cloth it would paint is the read person's, it moves at least 25% of the piece and 1% of their garment area; otherwise the chalk figure alone shows it, and its card says the photo is as worn. Shares are apportioned by largest remainder (they sum to 1.00, each within 0.05 of its measure); harmony, shares and chroma read colours that share a plain name as one, as every list on screen does, while value keeps each colour's own lightness; advice quotes only numbers its Measured line or its rule's edges show; the three looks hold at most one hue family (red, earth, green, blue, violet, neutral) per piece, and a tuck or belt takes at most two of the three slots while a look without it also helps.
