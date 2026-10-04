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
