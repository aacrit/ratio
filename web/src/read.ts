// One read, start to finish: decode the photo in the tab, reduce it with our
// own resampler, let the models see it, measure, apply the rulebook, hash.
// Nothing here touches the network except the models' first load from this
// origin; the photo itself never leaves the tab.

import { readingHash } from "./engine/hash";
import { type MeasureFailure, type OutfitMeasure, measureOutfit } from "./engine/measure";
import { extractPalette, type Swatch } from "./engine/palette";
import { downsample, type Pixels } from "./engine/resample";
import { type OutfitReading, readOutfit } from "./engine/rules";
import { decode, see } from "./vision";

export interface Read {
  pixels: Pixels;
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

export async function readPhoto(file: Blob): Promise<Read | ReadFailure> {
  let full: Pixels;
  try {
    full = await decode(file);
  } catch {
    return "not_an_image";
  }
  const pixels = downsample(full);
  let seen;
  try {
    seen = await see(pixels);
  } catch {
    return "models_failed";
  }
  if (seen.mask.width !== pixels.width || seen.mask.height !== pixels.height) return "models_failed";
  const measure = measureOutfit(pixels, seen.mask, seen.pose);
  if (typeof measure === "string") return measure;
  const palette = extractPalette(pixels, seen.mask, measure);
  const reading = readOutfit(measure, palette);
  const hash = await readingHash({ engine: reading.engine, bins: reading.bins });
  return { pixels, measure, palette, reading, hash };
}
