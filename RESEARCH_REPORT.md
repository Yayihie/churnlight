# CSM Software Complaint Mining — Reddit Research (Nov 2026)

Method: web_search thread discovery + Arctic Shift API (real-browser path) for 4
r/CustomerSuccess threads → 160 comments mined. Thread IDs: 1j1p2ao ("Gainsight
is terrible and a waste"), 1k4j8nh ("I hate Gainsight"), 17nj5jj ("Affordable
Customer Success Platform"), 1oel3wm ("Are CS Platforms worth it?").

## What CSMs actually complain about (by mention count)

1. **Admin/setup burden (32 mentions)** — platforms need dedicated admins,
   Salesforce contractor hours, months-long rollouts. "I'm now a GS Admin, and
   a SF admin, and the Success team is back to working through their inboxes."
2. **Pricing (27 mentions)** — Gainsight/ChurnZero/Planhat cost far more than
   small teams can pay; Planhat quoted "over 100k" for a 10-CSM team; even
   Vitally "way over budget" for a 5-6 CSM startup.
3. **Leaders-oriented UX (18 mentions)** — "Gainsight lost sight of who their
   software was primarily servicing… IC level CSMs." "Countless manual admin
   tasks just to get leadership visibility." "Nothing more than a CTA prompt
   used by leaders struggling to justify their existence to the board."
4. **Spreadsheet fallback (17 mentions)** — "I've yet to see a CS tool that I
   couldn't build better in a spreadsheet." Small teams run on spreadsheets +
   CRM exports; consolidating data and simple triggers is "time consuming and
   creates pain from an ops and execution standpoint."
5. **Click-depth / UX (10 mentions)** — "I counted 27 clicks just to get to the
   point where I can finally hit submit." "So. Many. Damn. Clicks." 11 clicks
   where Outlook needed 3.
6. **Double data entry (8)** — logging the same thing in SF and GS: "It's like
   driving two cars at once, you only need one."
7. **AI add-on fatigue (5)** — AI features are paywalled extras, not core;
   extraction of information is impossible without them.

## Cross-check vs. incumbent positioning
- Gainsight: market leader, priced that way, needs "a ton of tech administration."
- ChurnZero: "expensive!"; Vitally: "more for smaller companies" but "high touch
  for front line CSMs and you need some Ops resource dedicated to keep it running."
- Consistent verdict: every platform assumes an ops function + 5-figure budget.

## GitHub prior art (wedge check)
Searched `customer success platform` and `churn prediction customer`: no real
open-source CS tool exists — only ML notebooks (telecom/bank churn datasets) and
junk repos. The open-source CS platform lane is empty. Churnlight has no
comparable OSS competitor.

## Where Churnlight already fits
- "Free, no admin, drop exports" → directly answers burdens #1, #2, #6.
- Rules-based, transparent (no AI magic) → fits AI skepticism #7.
- Punchy UI with reason + action per account → answers #5.

## What the research says v2 should add (priority order)
1. **CRM export adapters** — one-click CSV export guides for Salesforce/HubSpot
   so "spreadsheet people" don't have to shape data manually (answers #4).
2. **Health-score transparency** — show the exact rules and weights, editable in
   the UI (already partly there via sliders; make weights visible per account).
3. **Weekly digest by default** — scheduler exists; make the hosted version ask
   for an email on first run and arm it (no env vars on hosted).

## Verdict
The original wedge (free, open-source, no-admin churn early-warning) is exactly
what these threads ask for and has zero OSS competition. Keep building it.
