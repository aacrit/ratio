# Ratio: design spec (G2)

Studio, 2026-10-04, on top of the premium redesign (`spike/suggest-try`). Law: `design/BRAND.md` (Cloth and Chalk) under Ink & Momentum. Mocks: `design/mocks/{read,face,rules,card}.html` on the shared frame `design/mocks/frame.css`; CI shoots each at 375, 768 and 1280 (`scripts/mock-shots.mjs`). Copy here is final; a builder copies it verbatim. No exclamation marks, no em dashes, no judgement of the person.

Breakpoints: phone (to 767), tablet (768 to 1023), desktop (1024 up, the stage 61.8% beside the sheet 38.2%). Everything is dark-first with the Paper theme following the device; the Style Card is always Paper.

## The bar and its tabs (every surface)

**Job.** Say where you are and let you move, in 52 px, without taking the stage.

**Layout.** Left: the mark (plumb drop on load) and "Ratio" (the eyebrow "reason and proportion" from 768; the name hidden under 420). Centre-left: four tabs, Inter 500 0.92 rem, 44 px minimum touch width, in a scrollable strip if the bar is too narrow: **Read · Face · Rules · Card**. Right: at most one action ("Read another" while a photo is read, on Read and Face; nothing on Rules and Card).

**Motion.** One chalk underline, 2 px, slides and resizes to the chosen tab with `underline` (420 / 41 / 1, critically damped, 420 ms). The current tab is chalk, the others chalk-muted; hover is a colour transition over `--dur-fast`. Reduced motion: the underline jumps.

**Copy.** Tabs: `Read` `Face` `Rules` `Card`. Action: `Read another`. `aria-current="page"` on the current tab; the nav is labelled `Surfaces`.

**Surfaces that are not yet built** (Face before its ticket): the tab opens the page's drop cloth with the line `Face arrives after the Rulebook. Read an outfit meanwhile.` and the action `Read an outfit`. Never a dead tab.

## Read `/` (as built, plus the wardrobe)

**Job.** Read one full-length photo in the tab and show the measurement, the rule and the advice; let you try a look and keep the read.

**Layout** as built (BRAND, Stage and sheet). Phone: the stage holds the photo above a sheet with three resting places (peek: hero numeral and eyebrow; half: verdict, palette, the first look; full: the argument). Tablet: the same, with 24 px gutters in the sheet. Desktop: stage left, side panel right.

**States and copy.**
- Idle (drop cloth): `Drop a full-length photo. It stays in this tab.` / `One person, standing, head to feet, facing the camera. Adults only. Ratio reads the outfit: proportion and colour.` Buttons `Read a photo` `Try the sample` `Take a photo` (touch only, with the tip `For a full-length photo, ask someone to stand three steps back with the phone at waist height, your head to your feet in the frame.`). `The sample is a painting: Jacques-Louis David, Napoleon in his study, 1812.`
- Loading: `Loading the measuring models, 12.4 of 25.1 MB.` on a tape at the real rate. Fetching the sample: `Fetching the sample.`
- Measuring: `Measuring.` breathing; the photo already on the cloth (`arrive`).
- Errors (chalk prose under the photo, the cloth returns): `No full figure found. Use a photo that shows head to feet, facing the camera.` / `This browser can't run the models. Open the photo in Chrome, Firefox or Safari 16 or later.` / `The measuring models did not load. Check the connection and try again; they download once, then stay in the browser.` / `The sample did not load. Check the connection and try again.`
- Read: hero numeral (tape; verdigris on the mark; red chalk borderline), eyebrow `Proportion, on the mark`, verdict (the proportion line's first sentence), palette strip, `Looks to try` (`3 looks the rules prefer, judged by the same rulebook. Try one on the photo.` or `The rules would change nothing here. Every reading is on the mark or fine, so the look stands as it is.`), `The reading` rows (Measured, Rule, Advice, and `Borderline` with `This measurement sits on the edge between two bands, so a slightly different photo may read the other way. Both readings apply.`), credit, hash line `Same photo, same reading. 12eb · ratio-engine/0.4.0`.
- Trying a look: the chalk figure card `Trying a look` with the look's title and `Colour changes show on the photo, in the tab. A tuck or a belt shows on the chalk figure and by the break mark, never painted onto the photo.`, button `As worn`; the wipe (`AS WORN` left, `THE LOOK` right); changed rows get a chalk rule and `Was fine, now on the mark.`; hash line `Trying a look. Same look, same reading. 89f0 · ratio-engine/0.4.0`. The section mark on the tape lights at 0.618 when the break is near the section from below, at 0.382 when from above (today's overlay lights only 0.382: change at Forge).
- Hash-line actions: `Save as card` (`Drawing the card.` → `Saved` → back; failure `Could not draw the card`) and `Keep in my wardrobe`.

**The wardrobe within Read (founder, 2026-10-04: opt-in, this browser only, deletable).**
- First press of `Keep in my wardrobe` opens an inline ask under the hash line (a chalk rule on its left, never a modal): `The wardrobe stays in this browser. It keeps the reading (the numbers, the palette, the chalk figure), never the photo. Three or more kept reads can make a Style Card. Delete any of them from Card.` Buttons `Keep this read` `Not now`. The ask shows once per browser; after a Keep it never returns.
- Kept: the button becomes `Kept` (disabled, chalk outline) and a line under the hash reads `In your wardrobe, 3 of 5. Open Card.` (`Open Card` is a link). The sixth keep replaces the oldest, said as `In your wardrobe, 5 of 5. The oldest read was replaced.`
- Keeping while a look is tried keeps the look's reading, titled by the look; as worn keeps `As worn`. A kept read holds: title, hash, engine version, date, bins, lines, the chalk figure's inputs. Never pixels. Storage: IndexedDB, origin-scoped; nothing is sent. `web/privacy.html` must gain a line at Forge: the wardrobe is the one thing the browser stores, by your choice, and never the photo.
- Storage refused (private mode, quota): `This browser would not keep the read. The wardrobe needs a browser that allows site storage.`

**Motion.** As built: `arrive`, `breathe`, `plumb`, `chalk`, `lands`, `glide`, `sheet`, `fling`, `argument`, `settle`. The wardrobe ask arrives with `arrive`; `Kept` is a hard cut.

## Face `/face`

**Job.** Read one head-and-shoulders portrait: the face's proportions as the input, hair choices as the advice, one portrait note. Never a verdict on the face, never a score.

**Hero.** The portrait on the stage with the face oval (dashed chalk construction line), the tape from hairline to chin with the canon's thirds (⅓ ⅔ in muted chalk), the four measured divisions across the face in tape (hairline, brow, nose base, chin) with each third's share as a numeral to the right, the width line at the cheekbones, and the length-to-width ratio as the hero numeral by the tape. Layout, sheet and breakpoints as Read.

**Input.** A separate portrait photo (founder: a face in a full-length photo is too small to measure honestly). Face landmarker (478 points, 52 blendshapes) and the multiclass segmenter's hair mask, on the CPU delegate; no skin pixel is read until R2 passes.

**States and copy.**
- Idle: `Drop a head-and-shoulders photo. It stays in this tab.` / `One adult, facing the camera, hair and shoulders in the frame. Ratio reads the hair against the face's proportions, and adds a portrait note. Never a verdict on the face.` Buttons `Read a portrait` `Try the sample` `Take a photo` (tip: `Hold the phone at eye level, an arm's length away, with the hair and the shoulders in the frame.`). `The sample is a painting: Albrecht Dürer, Self-portrait at 28, 1500.`
- Loading and measuring as Read (`Loading the measuring models, 3.1 of 3.9 MB.` the face model is small; `Measuring.`).
- Errors: `No face found facing the camera. Use a portrait with the whole face in the frame, head on.` / `More than one face in the frame. Ratio reads one portrait at a time.` / browser and model errors as Read.
- Read (the mock): hero `1.62×`, eyebrow `Length to width, on the mark`, verdict `Width at the sides is what a 1.62× oval asks for, and the hair as worn carries it there.` Rows, each Measured / Rule / Advice:
  1. **Volume** `1.62× · sides 2.40×` on the mark. Measured `Face length 1.62× its width (hairline to chin, over the widest line at the cheekbones). Hair 2.40× the face width at the cheekbones, 0.22 of the face length above the hairline.` Rule `Volume answers proportion: width at the sides shortens the read of a long oval, height at the crown lengthens a short one. Between 1.40 and 1.60 either works.` Advice `Width at the sides is what a 1.62× oval asks for, and the hair as worn carries it there. Keep the volume at the sides; a cut that stacks height at the crown would stretch the read.` Edges: below 1.40 height at the crown; 1.40 to 1.60 either; 1.60 and above width at the sides; the hair gives width at 1.30× the face width or more, height at 0.15 of the face length or more. Bins 0.02 and 0.05.
  2. **Thirds** `0.26 · 0.38 · 0.36` fine. Measured `Hairline to brow 0.26, brow to nose base 0.38, nose base to chin 0.36 of the face length.` Rule `The canon divides the face into three equal parts: hairline to brow, brow to nose base, nose base to chin. Hair can move the first line; nothing else moves.` Advice `The upper third is the shortest, so the visible hairline is the one to keep. Hair parted or swept back without a fringe shows the full third, as worn; a fringe would shorten it further.` (When the upper third is the longest: `The upper third is the longest. A fringe that lands at the brow, or a parting with volume forward, moves the visible line down and evens the thirds.`)
  3. **Parting** `centre · 0.50` fine. Measured `The parting meets the hairline at 0.50 of the face width.` Rule `A centre parting mirrors the two halves of the face and reads as still; a parting at the third (0.33 or 0.67) sets the hair asymmetrically and reads as movement.` Advice `Centred, with length on both sides, the parting makes the symmetry this portrait is built on. Keep it for a formal portrait; move it to 0.33 for a less formal one.` No parting found: `No parting read: the hair meets the hairline as one line.`
  4. **Length** `0.62 below the chin` fine. Measured `The hair ends 0.62 face lengths below the chin, past the shoulder line.` Rule `Where the hair ends is a horizontal line the eye reads with the chin and the shoulders: at the jaw it widens, at the collarbone it lengthens, below the shoulder it frames.` Advice `Ending below the shoulders, the hair frames the face and the collar instead of cutting across either. Keep the ends below the shoulder line or above the jaw; between the two, the line competes with the chin.` Edges: at the jaw to 0.05; to the collarbone 0.05 to 0.40; below the shoulder 0.40 and above.
  5. **Expression** `smile 0.04 · eyes 0.62` a portrait note. Measured `Blendshape scores, each 0 to 1: mouth smile 0.04, eyes open 0.62, brow raise 0.00. Level gaze at the camera.` Rule `A note for the portrait, never about the person: what the expression does for the picture. A smile that reaches the eyes reads as warm; a closed mouth and a level gaze read as formal.` Advice `A level gaze and a closed mouth: the formal portrait. Keep it for that. For a warm headshot, a smile that reaches the eyes, with both scores up.` Only for portraits; never on Read.
  6. **Personal colour** `after the accuracy check`, state `not yet`, muted: `Hair-to-skin contrast and undertone, as input to a palette and never as a label. It arrives after the skin-tone accuracy check (R2): until the fixture set scores evenly across all ten Monk bands, Ratio does not read skin.` When it arrives: a stacked palette bar and `Contrast ΔL 0.48 · undertone warm` as palette input only; never a season or a name for the person.
- Credit (sample): `Albrecht Dürer, Self-portrait at Twenty-eight (Self-portrait in a fur-trimmed robe), 1500. Alte Pinakothek, Munich. Public domain, via Wikimedia Commons.` Hash line `Same photo, same reading. 5b1d · ratio-engine/0.4.0 · face/0.1`. Actions `Save as card` `Keep in my wardrobe` (a portrait read counts for the Style Card's hair line, not for its break).
- Sources for the drill rows on Rules: Vitruvius, De architectura III.1; Dürer, Vier Bücher von menschlicher Proportion (1528); MediaPipe Face Landmarker blendshapes. Edges uncalibrated until R1's portrait fixtures exist: the eyebrow says so.

**Motion.** `arrive`, `breathe`; then `plumb` from the crown of the oval, `chalk` draws the tape, then the four divisions top to bottom, then the width line; `lands` for the hero numeral and the thirds; `argument` for the rows. `face_reading_completed` fires when the rows show.

**Not done well within the constraints, said plainly.** Makeup as a surface of its own (the brief's "makeup palette") depends on skin reading and waits with personal colour; the mock shows only the waiting row.

## Rulebook `/rules`

**Job.** Show every rule's method: its statement, a live instrument, its edges, its maths and its sources, with your last read marked (V1).

**Layout.** A scrolling page under the bar, one column at `min(100%, 960px)`: head (eyebrow `The rulebook · ratio-engine/0.4.0`, title `Seven rules, each with its maths, its edges and its source.`, lede `Every reading is held against these and nothing else. Drag an instrument to see where a band ends. Your last read in this tab is marked on each one.`, the chip `Your last read, as worn · 12eb · today` with `Clear`). Then seven cards in reading order. Phone: instrument above the words. Tablet and desktop: instrument left (256 px; 320 px for the proportion hero), words right. Each card: eyebrow (rule name · `calibrated` or `calibrated: no, first estimates` in red chalk), the rule in Fraunces, the `Yours` line (measurement in tape, verdigris on the mark, red chalk borderline, with the state word), and a drill `The maths, the edges, the sources` (closed; opening it counts `rule_opened`). The proportion drill is open in the mock to show the anatomy.

**Instruments** (BRAND, Instrument anatomy): a handle follows the hand one to one, the numeral updates as it moves (no count: it is your hand), band names and edges sit beside the scale, your value is a fixed verdigris tick labelled `yours …`. 1. Proportion: the chalk figure with the tape and the five bands; drag the break line (live in the mock; the text under `Yours` reads `Drag the line: 0.46, halves.`). 2. Volume: two scales (upper piece × shoulders with fitted / straight / loose at 1.15 and 1.40; legs at the knee with narrow / straight / wide at 0.60 and 0.85). 3. Leg line: lower piece and shoes on one lightness scale, the ΔL bracket, the 0.12 edge drawn as a length; `yours, as worn: no shoes measured` when they were not. 4. Harmony: the OKLCH hue ring (muted, chroma 0.09), the fitted template's sector, each hue as a dot in its own colour, a dot outside the sector ringed in red chalk with `105°, 11° outside`. 5. Value: each colour's lightness on one scale, the range bracket, the low / medium / high edges drawn as lengths. 6. Shares: the 60-30-10 reference bar with two draggable dividers above your bar in your colours. 7. Chroma: each colour on the chroma scale with the neutral (0.02) and saturated (0.11) edges, and a worked vibration pair.

**States.** No read in this tab: the chip reads `Read a photo and your values appear on each instrument.` with the action `Read a photo`; every `Yours` line reads `not read yet` and the instruments start at their band's middle. With a read: as the mock. A rule not measured (no shoes): `not read as worn: the shoes were not found in the frame.` Uncalibrated rules carry the drill note `The edges are first estimates. The labelled fixture set (risk R1) sets them, and this line changes to "calibrated" when it has.` Engine change: the chip adds `read with ratio-engine/0.3.0; the rulebook is now 0.4.0`.

**Motion.** Cards `arrive` 80 ms apart on first paint (at most 7). Instruments: hand-held, `settle` on the handle; crossing an edge flashes the band name's glow for `--dur-fast`. Reduced motion: no stagger, no flash.

## Style Card `/card`

**Job.** Show what the wardrobe's reads have in common, as one printed page, and sell it honestly: $12 once, with the free path beside it.

**Hero.** The card itself on the stage, 1 : 1.618 portrait, always Paper (`--card-*` tokens), `width: min(100%, 420px)` (460 on desktop), fitted to the room. Sheet (phone: below; desktop: the panel): hero numeral = reads kept, the wardrobe list, the offer.

**The card's content** (built in the tab from 3 to 5 kept reads; a portrait read contributes only a hair line): masthead `Ratio` / `STYLE CARD` and `3 reads · 2026-10-04`; **Your break** with the reads' chalk figures and their breaks, `Near the golden section from below (0.618) in 3 of 3 reads. A long upper piece over a short lower one is your division; keep the lower block narrow.`; **Volume** `Loose over narrow in 2 of 3, straight over narrow in 1. One full piece over a narrow leg is the pairing that holds.`; **Colour families that fit** (swatches with names) `The lower pieces and accents the rules preferred in your looks: a cool lower piece under a warm neutral, with one saturated accent.`; **Contrast level** `High. Light over dark in every read, the weight low and the figure grounded. range 0.74 · 0.70 · 0.66`; **Your palette** (strip) `cream (105°), black, charcoal, navy (255°), oxblood (25°). What recurs across your reads, by area.`; foot `12eb · 89f0 · 3c7a · ratio-engine/0.4.0` and `ratio.voidvision.org · made in the tab`. A line that holds in fewer than 2 of the reads is left out, never padded. Under the card: `A preview at screen size. The download is the same card at print size.`

**Sheet copy.** Eyebrow `Your wardrobe · this browser only`. Each kept read: its chalk figure, title (`As worn` or the look's title), `0.64 : 0.36 · 12eb · 2026-10-04`, its palette, `Delete` (deletes at once; the line under the list says `Deleted. The card redraws from what is left.`). Under the list: `Each kept read is the reading and its chalk figure, never the photo. Up to 5; the oldest is replaced after that. Read another and keep it.` Offer: `One page of what repeats across your reads, on paper: your break, your volumes, the colour families that fit, your contrast level, your palette. Every rule in it is free in single reads and on Rules; the card is the pattern, not new advice.`

**States.**
- Fewer than 3 reads: hero `2`, eyebrow `reads kept, one more for a card`, verdict `Keep one more read and the card can be drawn.`; the stage shows the card's dashed outline with `The card needs 3 to 5 reads.` / `2 kept. Read another outfit and keep it, and the card is drawn here.`; the offer ends with `The card is drawn from 3 to 5 reads. Keep one more from Read.` and `Read another`. Zero reads: hero `0`, `reads kept`, `Keep three reads from Read and the card is drawn here.`
- Ready: hero `3`, `reads kept, enough for a card`, verdict `The card is what repeats across your reads: the break, the volumes, the colour families, the contrast.`; `$12, once. Drawn in this tab; the photos never leave it.`; buttons `Get the Style Card, $12` (chalk) and `Save a free single-read card` (ghost, to Read); fine print `Paid through Polar. The licence is a signed token kept in this browser, so the download works here without an account. Single-read cards stay free: Save as card under any read.`
- Paying (Polar checkout in a new tab; the page waits): `Finishing the payment in the Polar tab. This page updates when it is done.` with `Cancel`.
- Payment failed: `The payment did not complete, and nothing was charged. Try again, or save a free single-read card from Read.` with the ready buttons.
- Paid: `Paid. The card is yours to download.`; `Download for print`; `2400 × 3883 px at 300 dpi: 8 × 13 in, or A4 with margins. Download again any time from this browser.`
- Printed (downloaded): `Downloaded ratio-style-card-12eb.png.` / `Print it at 8 × 13 in, or A4 with margins. Download again any time from this browser; keep more reads and the card redraws.` `card_exported` fires here.
- Licence lost (new browser): the ready state plus `Paid before? The licence lives in the browser you paid from. Open Card there, or write to us with the order number.`
- Payment mock only until the Polar ask is answered (founder ask open): the mock's state switch stands in for it.

**Motion.** The card `arrive`s when drawn or redrawn; the hero numeral `lands`; a deleted read leaves with `--ease-whip` over `--dur-fast`; state lines are hard cuts.

## Anti-slop checklist, per surface

| Surface | 1 template? | 2 accents earned | 3 numerals mono tabular | 4 copy | 5 motion means state | 6 space |
|---|---|---|---|---|---|---|
| Bar and tabs | no: four words and a chalk line | chalk only | n/a | verbs and nouns, no cliché | underline = where you are | 52 px, one action |
| Read | no: stage and sheet, the photo the only colour | tape, verdigris, red chalk by rule | yes, `data-ratio` pairs | audited: no exclamation, no dash | each preset names a state | peek shows one numeral |
| Face | no: the oval and thirds are the subject's own geometry | same three | yes | audited; never the face judged | plumb, chalk, lands, argument | one hero numeral, six rows on demand |
| Rules | no: instruments, not a dashboard grid (one column) | verdigris = yours or on the mark; red chalk = uncalibrated or outside | yes, edges in mono | audited | hand-held, no decoration | drill closed by default |
| Card | no: one Paper object and a list | verdigris for the recurring break only | yes, print size in mono | audited; the free path said twice | arrive on draw, lands on the count | card alone on the stage |

Result: pass on all five, with two watch items for the verifier: the Rules page at 375 must show the hero instrument whole without horizontal scroll, and the Card's Paper text must keep 4.5:1 (`--card-muted` on `--card-paper` is 5.40).
