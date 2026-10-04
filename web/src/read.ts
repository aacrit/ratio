// One read, start to finish, inside the read worker: decode the photo,
// reduce it with our own resampler, let the models see it, measure, apply
// the rulebook, hash. Nothing here touches the network except the models'
// first load from this origin; the photo itself never leaves the tab.
//
// Two sizes of the photo come out: the reading size (512 on the long side,
// what the models and the rules see, the determinism law) and a display
// size for the stage, so the hero photo stays sharp on a large screen.

import { readingHash } from "./engine/hash";
import { type Mask, type MeasureFailure, type OutfitMeasure, measureOutfit } from "./engine/measure";
import { extractPalette, type Swatch } from "./engine/palette";
import { type Side, isolatePerson } from "./engine/person";
import { downsample, type Pixels } from "./engine/resample";
import { type OutfitReading, readOutfit } from "./engine/rules";
import { decode, see } from "./vision";

/** The long side the photo is shown at: three times the reading size, enough for a 1280 stage at 2x. */
export const DISPLAY_SIZE = 1536;

export interface Read {
  /** The photo at reading size (the models' and the rules' input). */
  pixels: Pixels;
  /** The photo at display size, for the stage and the card. */
  display: Pixels;
  /** The segmenter's categories for the read person only (engine/person.ts), kept in the tab for "try it" (never sent anywhere). */
  mask: Mask;
  /** The segmenter's categories for everyone in the photo, for the recolour's honesty check. */
  fullMask: Mask;
  /** Other sizeable people in the photo, and where the read person stands among them. */
  others: number;
  side: Side | null;
  /** True when the pose could not single out the person in the mask (docs/RISKS.md). */
  unsure: boolean;
  measure: OutfitMeasure;
  palette: Swatch[];
  reading: OutfitReading;
  hash: string;
}

export type ReadFailure = MeasureFailure | "not_an_image" | "models_failed";

export const FAILURE_COPY: Record<ReadFailure, string> = {
  no_figure: "No full figure found. Use a photo of one person standing, head to feet, facing the camera.",
  feet_not_in_frame: "The feet are out of frame. Proportion is measured head to foot, so the whole figure needs to be in the photo. Hair, makeup and expression reads arrive in a later release.",
  no_clothes: "The garments could not be told apart from the background. A plainer background and even light help.",
  not_an_image: "That file could not be opened as a photo. JPEG, PNG and WebP work.",
  models_failed: "The measuring models did not load. Check the connection and try again; they download once, then stay in the browser.",
};

export interface ReadHooks {
  /** Called as soon as the photo is decoded, before the models see it: the stage can show it at once. */
  onPhoto?: (display: Pixels) => void;
}

export async function readPhoto(file: Blob, hooks: ReadHooks = {}): Promise<Read | ReadFailure> {
  let full: Pixels;
  try {
    full = await decode(file);
  } catch {
    return "not_an_image";
  }
  const display = downsample(full, DISPLAY_SIZE);
  hooks.onPhoto?.(display);
  const pixels = downsample(full);
  let seen;
  try {
    seen = await see(pixels);
  } catch {
    return "models_failed";
  }
  if (seen.mask.width !== pixels.width || seen.mask.height !== pixels.height) return "models_failed";
  // The read person only: no one else's pixels enter the measure, the palette or a recolour.
  const person = isolatePerson(seen.mask, seen.pose);
  const measure = measureOutfit(pixels, person.mask, seen.pose);
  if (typeof measure === "string") return measure;
  const palette = extractPalette(pixels, person.mask, measure);
  const reading = readOutfit(measure, palette);
  const hash = await readingHash({ engine: reading.engine, bins: reading.bins });
  return { pixels, display, mask: person.mask, fullMask: seen.mask, others: person.others, side: person.side, unsure: person.unsure, measure, palette, reading, hash };
}
