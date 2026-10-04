# Charter

At most 5 surfaces for v1. Any surface added later needs a charter amendment.

| Surface | Why | Justifying user event | Kill date |
|---|---|---|---|
| **Read** `/` | Drop a full-length photo; it is measured in the tab and read against the rulebook, with the measurement drawn over the photo and a reading hash. Suggested looks and "try it" (amended 2026-10-04): the photo recoloured in the tab and proportion moves on a standard chalk figure; no generated images, no body reshaping, no shopping links. The wardrobe (opt-in, this browser only) lives here too | `reading_completed` | 2026-12-31 |
| **Face** `/face` | Hair (face proportions → length, parting, volume), makeup (undertone and contrast → palette), expression (a portrait note). Never a verdict on the person | `face_reading_completed` (Forge) | 2026-12-31 |
| **Rulebook** `/rules` | Every rule, its maths, its band edges, its sources and its version (V1: show the method) | `rule_opened` (Forge) | 2026-12-31 |
| **Style Card** `/card` | 3 to 5 photos into a printable personal reference, built in the tab; $12 once via Polar | `card_exported` | 2027-02-28 |
| Worker | `/e`, licence check, Polar webhook | Polar order | 2027-02-28 |
| `/privacy.html` | Disclosure for the aggregate-count telemetry, the feedback form, the rate limit, and that photos never leave the tab; linked from the home page | `page_view` (same page load as home) | tied to the product's own kill date |

## Kill criteria

Aggregate counts in D1 (`/e`'s `event_counts`), plus payment-provider orders if money changes hands; nothing per person.

- 2026-12-31: fewer than 1,000 `reading_completed` in total → archive.
- 2027-02-28: 0 Style Card orders (Polar) → drop the card; reads stay free.
- `reading_completed` counts a read whose advice was shown, never a page view or a refused photo.

Reading the counts: every count is capped by its daily ceiling, and a browser-sent one can be inflated by anyone who posts to `/e`. So the G4 packet shows each count's day-level spikes (days at or near a ceiling, or far above the usual day) next to the totals, and a total carried by a spike is read as suspect, not as progress.

## Not in v1

- Accounts or sign-in.
- Payments until the Style Card ticket (Forge).
- Any photo upload or server storage, accounts, generated try-on images, shopping or affiliate links, body or attractiveness scores, garment naming with a large fashion model, video, a native app.
- Any LLM feature (it needs a charter amendment and the plugin's free-provider add-on).
- Anything the brief marked "Not in v1" (see `reports/briefs/ratio.md`, gitignored, on the Chief of Staff's side).

## Workflows: 3 (gate, verify-production, branch-prune)
