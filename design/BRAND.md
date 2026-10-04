# Ratio: design language

Law for builders. Ink & Momentum is the grammar (type voices, earned accents, spring motion, copy voice). This file is Ratio's own say: hues and their meanings, one texture, named motion presets, the stage and the sheet, depth and light, a hero per surface, the logomark. `design/tokens.css` is the only file that may hold a colour literal; `scripts/lint-design.mjs` enforces it.

## The world: Cloth and Chalk

A master tailor's cutting table crossed with a geometer's notebook. Charcoal worsted on the table, chalk for everything the app writes, a cloth tape for what it measures, the aged brass of a section compass for what lands on the mark, red chalk for what to check before cutting. Sources: the tailor's chalk and tape, the drafting table, Polykleitos' canon, Dürer's measured figures, Le Corbusier's Modulor, the golden-section compass. Not a fashion app: no pink, no beige, no photos of models, no scores.

Posture: dense and still. One hero per surface, detail on demand. The app waits with its instruments, never with a spinner. The person's photo is the only colour on the screen; the interface is cloth, chalk and three instruments. It behaves like an instrument too: the photo stays where it is, the reading comes to the hand, and everything that moves has weight.

## Colour

Six source hexes, everything else derived in OKLch. Token names are roles (Cloth names); in Paper they hold paper values.

| Role | Cloth | Meaning, the only reason it may appear |
|---|---|---|
| `--color-bg` worsted | `#141922` | the page, the cutting table |
| `--color-surface` lining | `#1b212b` | panels, the sheet, the photo well |
| `--color-cream` chalk | `#ece6d8` | text, construction lines, buttons, links, focus, errors, loading: everything the app writes |
| `--color-tape` | `#e3c77e` | **a measurement**: a line or numeral read from the photo (0.49 : 0.51, 30°, 1.3×) |
| `--color-section` verdigris | `#7fc0a4` | **near the golden section**, or on the mark of a rule: the tick lights, a "near the section" note appears |
| `--color-borderline` red chalk | `#dc7a62` | **borderline**: within half a bin of a threshold; both readings are shown and this marks the pair |

Exactly three accents (founder, 2026-10-03). There is no error hue, no success hue, no brand hue: errors are chalk prose that say what happened and what to do; buttons are chalk on worsted; the mark is chalk with a tape bob. Over a photo, every stroke and numeral sits on `--color-halo` (worsted at 85%); only tape and chalk may be text there, section and borderline are strokes, and their words live in the sheet. The hero numeral in the sheet head takes the colour of its state: tape, verdigris on the mark, red chalk when borderline.

**Paper** (light theme, `data-theme="paper"`, follows the device by default, and the theme the Style Card prints from): chalk paper, worsted ink, accents darkened in lightness only. Contrast pairs for both themes are listed in `tokens.css`; every text pair is above 4.5:1.

## Texture: one layer

The worsted weave: a 2:1 twill drawn as an 8px diagonal hatch (`--texture-weave`) on the page ground only, at 5% by night and 3.5% by day. Never on panels, never on the sheet, never on the photo, never in print.

## Depth and light

One lamp, above the table and a little forward. It shows in three places and nowhere else:

- **The pool on the cloth** (`--light-stage-tone`): a soft radial lift of the lining tone on the stage ground, centred a third of the way down, where the figure stands. It is the only gradient in the app.
- **The photo on the cloth** (`--shadow-photo`): a tight contact shadow and a long soft one in the worsted's own dark, never grey, 4px radius. Nothing else on the stage casts a shadow.
- **The sheet over the stage** (`--shadow-sheet`, `--edge-sheet`): the sheet is the lining at 97% with a lit top edge (chalk at 10%) and a shadow upward onto the cloth, so it reads as a plane resting over the table. On a wide screen it is a side panel with a hairline, no shadow: it sits beside the stage, not over it.

Panels inside the sheet (a look card, the trying card) are `--color-surface-raised` with a hairline border and no shadow: paper on paper. Cards are 10px, the sheet 20px, controls 6px.

## Stage and sheet

The Read surface is an app frame, not a page (founder, 2026-10-04): a bar, a stage and a sheet.

- **The bar** (52px): the mark with the plumb drop, the name, and one action at most ("Read another" while a photo is read).
- **The stage** fills the rest of the height and never scrolls away. Before a photo it is the drop cloth: the chalk figure under the lamp, one line, the actions. With a photo it is the photo well: the photo fitted to the room above the sheet, with the loading tape, a status line or the compare control in the foot beneath it. The whole stage accepts a drop.
- **The sheet** holds everything that is read: the hero numeral and its eyebrow, the verdict, the palette, the looks, the argument, the hash, then feedback and the foot. On a phone it rides over the stage with three resting places: **peek** (the grip and the hero row), **half** (the viewport's half: verdict, palette, the first look), **full** (8px under the bar, and only then does it scroll inside). A drag follows the finger one to one, resists past the ends, and a release carries its velocity into the `sheet` spring. As the sheet rises the stage scales the photo (transform only) to the room above it, so the photo is always in view. From 1024 up the sheet is the side panel on the right, `--split-panel` (38.2%) wide: the stage keeps the major section, and the layout sits on the division it teaches.
- Trying a look drops the sheet to half, so the photo and the wipe are in hand. The chalk figure dressed as the look rides in the sheet head beside "As worn".
- The sheet's `ratio:snap` event is the one hook tests may use to place it.

## Performance is a design rule

The first screen is interactive in under a second on a mid-range phone: the page ships the frame and the chalk figure, nothing else. The models (24 MB, once) download on the first sign of intent (a pointer on the stage, a focus in the cloth, a drag over it), never on load, and the download shows its MB. The models, the measuring, the rulebook and the recolour run in the read worker (`web/src/read.worker.ts`), so the page's thread only draws. Only transform and opacity animate; springs draw the canvas at most once a frame. The screens workflow runs Lighthouse (mobile) and fails under 95 for performance or accessibility.

## Type

- **Fraunces** (display): the name, the drop title, the verdict, look titles, the lede. `font-variation-settings: "opsz" 144, "SOFT" 0, "WONK" 0`: a crisp cut, the opposite of Dial's soft lamp. Emphasis is italic, never bold.
- **Inter** (structure): labels, advice prose, buttons. Advice never exceeds `--measure-reading` (64ch).
- **JetBrains Mono** (data): every numeral, with `tabular-nums`. A ratio pair is one element, `<span data-ratio>0.38 : 0.62</span>`, thin spaces (U+2009) round the colon, never wrapped apart. The rule's target follows in parentheses, muted: `0.38 : 0.62 (0.382)`. Angles carry the degree sign (`30°`), multipliers the multiplication sign (`1.3×`, never `x`). A reading hash is mono, muted, 4 hex characters shown, the full hash on hover. The hero numeral is the first reading's measurement at 2 to 2.6rem, weight 500.

## Motion presets

Springs are stiffness / damping / mass. JS integrates them (`v += (-k·x − c·v) / m · dt`, with the release velocity as the starting speed where a finger let go); CSS uses the `linear()` step response in `tokens.css`, simulated from the same numbers. Reduced motion renders every final state at once.

| Preset | Tier | Numbers | Settle | What it says |
|---|---|---|---|---|
| `plumb` | signature | 120 / 8 / 1.3, released from 14° | 2200 ms (visibly still at 1300) | the read has begun: a weighted line falls from the crown of the figure and swings once past vertical |
| `chalk` | standard | 600 px/s, `cubic-bezier(0.3, 0, 0.2, 1)`, 180 to 900 ms | by length | a measurement line is being drawn by a hand |
| `lands` | standard | 180 / 32 / 1.4 (critically damped) | 870 ms | a numeral has arrived: it counts up, heavy and without overshoot (a measurement never shows a value it did not read), and flashes `--color-tape-glow` behind it. The hero numeral and every row numeral count the same way; a tried look counts each changed numeral from its old value |
| `glide` | standard | 90 / 19 / 1 (critically damped) | 1000 ms | the break mark slides to the what-if position (0.49 to 0.38 when the advice shows the tuck); the wipe glides to the middle when a look arrives; a chalk mark never bounces |
| `sheet` | standard | 420 / 38 / 1 (zeta 0.93) | 380 ms | the sheet moves to a resting place with the finger's release velocity; it arrives, it never bounces |
| `fling` | standard | 160 / 24 / 1 (zeta 0.95) | 640 ms | the wipe let go mid drag carries on and settles where friction would stop it (`x + v · 0.18 s`) |
| `arrive` | standard | 300 / 24 / 1 (zeta 0.69, one small overshoot) | 640 ms | a card is put down on the table: look cards 80 ms apart, the photo settling onto the cloth |
| `settle` | micro | 600 / 35 / 1 | 430 ms | a button or chip was pressed (scale 0.97 and back) |
| `argument` | standard | 70 ms stagger between rows, `--dur-normal` rise of 8px; 200 ms between the three parts of a reading | per reading | the readings arrive in order: the measurement, then the rule, then the advice |
| `breathe` | standard | opacity 0.4 to 0.85 over 3000 ms | until done | indeterminate waiting (the models at work on a photo): the status line breathes |
| `hard-cut` | | 0 ms | | reduced motion, and every state change that is not one of the above |

The read sequence: the photo settles onto the cloth the moment it is decoded (`arrive`), the status breathes while the models work, then `plumb` (0 ms) → `chalk` for each line from 700 ms, in measurement order → `lands` for the numeral on the photo and, with it, the hero numeral and the row numerals → `argument` for the sheet. Downloads are never indeterminate: the model files show MB loaded on a tape that extends at the real rate, in tape numerals.

## Body language

- **Measure first, then the rule, then the advice.** Every reading is three lines in that order and never collapses the first two.
- **Borderline is said, not hidden.** "Borderline: 0.35 reads as a third (0.333) or the section (0.382). Both are shown." Red chalk marks the pair; the advice gives both.
- **Never the person.** The subject of every sentence is a garment, a cut, a hem, a hue, a part, a palette. No scores, no "flaws", no "slimming", no body talk, no mood verdicts. A copy lint holds the forbidden list.
- **Waiting shows its work.** "Loading the measuring models, 12.4 of 25.1 MB." Then "Measuring." Then the plumb line.
- **Privacy is stated where it matters.** On the drop cloth, once: "It stays in this tab." Not repeated as a badge.
- **Less at entry.** Peek shows one numeral and its eyebrow; half adds the verdict and the first look; the argument waits at full.

## Copy voice

Precise, warm, unhurried; a tailor explaining a chalk mark. No exclamation marks, no em dashes, no cheerleading, no "AI". Buttons are verbs. Errors say what happened and how to fix it. Sample lines:

- Drop a full-length photo. It stays in this tab.
- Loading the measuring models, 12.4 of 25.1 MB.
- The hem sits at the hip. The figure splits 0.49 : 0.51.
- A front tuck moves the break to 0.38 : 0.62, near the golden section (0.382), and shows the high rise you chose.
- Loose over straight. Keep one fitted: tuck, or a boxy cropped tee that ends at the waistband.
- Tee hue 30°, denim 215°: near-complementary (185°). Value contrast high; it works.
- Borderline: 0.35 reads as a third (0.333) or the section (0.382). Both are shown.
- No full figure found. Use a photo that shows head to feet, facing the camera.
- This browser can't run the models. Open the photo in Chrome, Firefox or Safari 16 or later.
- Same photo, same reading. a3f2 · rulebook 1.0.
- Buttons: Read a photo · Try the sample · Take a photo · Try it · As worn · Show the tuck · Save as card · Read another

## Heroes, one per surface

| Surface | Hero | Everything else |
|---|---|---|
| Read `/` | the photo on the stage with the overlay: tape, break mark, section tick; before a photo, the chalk figure under the lamp with the plumb line hanging | the sheet: hero numeral, verdict, palette, looks, the argument as drill rows, the hash |
| Face `/face` | the face oval with its three horizontal divisions and the length : width ratio | hair, makeup and expression readings as drill rows; palette as a stacked bar |
| Rulebook `/rules` | the open rule's diagram, live: drag the break along a line and watch the ratio and which band it lands in | the list of rules, each a drill row with its constants, sources and version |
| Style Card `/card` | the card itself, at 1 : 1.618, in Paper | the photo tray (3 to 5 slots), the export button |

## Logomark

A square frame (Vitruvius' square) with a plumb line dropping from the top edge to a small filled bob at 0.618 of the height. Chalk strokes, 1.6px at 24px, round caps; the bob is the one filled element and the only tape in the mark. In the app it animates with `plumb` once on load, in the bar; in print and at 16px it hangs straight with the bob only. Wordmark: "Ratio" in Fraunces, opsz 144, weight 400, with "reason and proportion" beside it in mono eyebrow. Endorsed "a voidvision production".

## Iconography and components

Hand-drawn glyphs, 24px, 1.6px stroke, round caps, no fills except a tape bob. Cards: raised lining on the sheet, 10px radius, 14 to 16px padding, one idea each. Drill rows: title with its state word in mono eyebrow, right-aligned mono measurement in tape (verdigris on the mark, red chalk when borderline), the argument beneath. Buttons: chalk fill, worsted label, 44px minimum (36px for the small size inside the sheet), `settle` on press. The compare control: a 2px chalk track with a chalk thumb, and the same line drawn on the photo with its grip. Focus: 2px chalk ring, 2px offset. Empty states: one Fraunces line, one muted sentence, one chalk action.
