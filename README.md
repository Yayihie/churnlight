# Churnlight

**Who to save this week — with the reason and what to do.**

Churnlight is a churn early-warning tool for small customer success teams.
Every Monday it tells you which accounts are at risk, *why* in plain words,
and the *next action* to take. No dashboards, no black-box AI scores, no
admin setup — just a list you can act on.

## For non-technical users (the easy way)

1. Open your terminal and type: `npm start` (or ask whoever installed it to do that).
2. Churnlight opens at **http://localhost:8788**.
3. **Drag your CSV exports** onto the page — whatever you have:
   - `accounts.csv` (account id, name, mrr, renewal date, last contact)
   - `payments.csv` (Stripe export: account, date, status, amount)
   - `tickets.csv` (support tickets: account, date, subject, status, age)
   - `usage.csv` (product usage: account, date, metric, value)
   - `meetings.csv` (account, date, status: held / cancelled / no_show)
   - `champions.csv` (account, date, note — e.g. "VP Ops left for competitor")
   Missing files are fine — it works with whatever you drop in.
4. Click **Find my at-risk customers**. You get a card per account: why
   it's at risk, what to do, and a risk score.
5. **Download the Monday email** (HTML) and attach it, or **copy the
   Markdown** and paste it into your team Slack channel.

## For technical users (CLI)

```bash
npm run build
node dist/cli.js --data ./my-exports --out ./digests --format both
# add --today 2026-11-25 for a deterministic run, or --config my-rules.json
```

## How the risk rules work (transparent by design)

| Rule | Fires when | Weight |
|---|---|---|
| Champion gone | A champion exit is logged | 8 |
| Renewal + no contact | Renewal within 30 days, no CSM contact in 14 days | 7 |
| Failed payments | 2+ failed payments (recoverable churn) | 7 |
| Usage drop | Usage down 40%+ vs the prior window | 6 |
| Cancelled meetings | 2+ cancelled / no-show meetings in 60 days | 6 |
| Stale ticket | Open ticket older than 14 days | 5 |

Score ≥ 12 = **CRITICAL**, ≥ 5 = **WATCH**. Every threshold is adjustable
in the app (the "Adjust the rules" panel) or via a JSON config — no code.

## Development

```bash
npm install
npm test        # 17 tests, vitest
npm run build   # tsc → dist/
npm start       # build + web app on :8788
```

## Free vs Pro (open-core)

Churnlight is open source and free forever. The Pro features' code is in
this repo too — they unlock with a signed license key
(`CHURNLIGHT_LICENSE_KEY`, Ed25519-verified by `src/license.ts`):

| | Free | Pro ($49/mo) |
|---|---|---|
| Web app, drag-and-drop CSVs | ✅ | ✅ |
| All 6 risk rules + sliders | ✅ | ✅ |
| Markdown + HTML digests | ✅ | ✅ |
| **Stripe auto-connect** (pull payments, no CSV exports) | — | ✅ |
| **Monday email on autopilot** (Resend, 8:00 AM weekly) | — | ✅ |
| **Hosted** — nothing to install or keep running | — | ✅ |

Buy a key at https://churnlight.dev — set up in two minutes:

```bash
export CHURNLIGHT_LICENSE_KEY=<your key>
npm start
```

## License

MIT
