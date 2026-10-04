# Personas

The people every UX pass is run as. A user-sim takes one of these names, its traits and its test, and walks the real build (or, at G2, the mocks) in a real browser. Founder, 2026-10-04: "define a super user and evaluate UX from their perspective", and keep optimising the UX holistically and often.

| | Who | Uses Ratio | Their test | Watch for |
|---|---|---|---|---|
| **Noor, the super user** | 29, capsule-wardrobe devotee, stylist in training. Knows the golden section and colour theory. | 5 to 10 reads a week. Laptop on Sunday nights (keyboard first), phone in fitting rooms (weak signal). | Read several outfits quickly, compare them, keep the good ones, plan the week by occasion, print the Style Card. | Speed on the third and tenth read; motion that becomes a tax; teaching copy that becomes clutter; keyboard paths; comparing and returning to reads; numbers and words that disagree. |
| **Sam, the first-timer** | 31, posts outfits for strangers to judge; phone first; no design vocabulary. | Once or twice, from a link. | Is this outfit good, and what one thing should change? | Jargon in the first view; a verdict before any number; one obvious action; "use my own photo". |
| **Mara, the professional** | 44, a working stylist and former colour-analysis consultant. | Judges whether to recommend Ratio to clients. | Would she say this to a client, and is the colour theory right? | Wrong or oversimplified theory; anything that reads as judging the body; a paid card that feels padded or claims to be colour analysis. |

Every persona is an adult, judged only on the clothes. A UX pass that finds something judging the person stops the pass: it is fixed before anything else.

## The UX cadence

- **Every pull request**: the `screens` CI job shoots the real build at 375 and 1280 and runs Lighthouse. The Chief of Staff looks at the shots before merging.
- **After every second merged ticket** (and before any release): a holistic UX pass. Noor walks the latest build in full; Sam and Mara walk only what changed. Findings are ranked by how many reads they would improve, the top ones become tickets, and the pass is recorded on the Board roadmap as "UX pass N" with its scorecard.
- **Before G3**: all three personas walk the preview end to end; their logs go into the launch packet unedited.
