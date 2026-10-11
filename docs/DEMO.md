# Leash: 2-minute demo shot list

Recording setup: dashboard at http://localhost:3000 (1440x900, browser zoom 100%), served by `pnpm services:prod`, with the terminal visible for the `[SCRIPTED]` lines. One continuous take. Leave the Activity card on the **All** tab during the run.

Honest framing (say it, do not hide it): the run is `DEMO_SCRIPTED=1` and every terminal line is labeled `[SCRIPTED]`. The scripted agent follows the injected instruction deterministically. In LLM mode (claude-sonnet-5-5, run live on Base Sepolia) the model declined the injection on its own in our runs, so we do not claim the model fell for it. The chain is the backstop either way: the agent can sign anything, and the chain refuses what is outside the policy. Everything else is real: Base Sepolia, real AUSD, real reverts with Basescan links. The `/listings/sax-42` page is a labeled test fixture.

## Real timing (from /tmp/rehearsal2.log events, fresh wallet)

The scripted run takes about 60 s end to end: about 5 s boot, then T+0 s (createRoot) to T+55 s (last Paused block). Event offsets from createRoot:

| T+ | Event |
| --- | --- |
| 0 s | createRoot (beat 1) |
| 6-9 s | 3 createChild (beat 2) |
| 12-17 s | search, scrape, search paid (beat 3) |
| 22.5 s | searcher-2 scrape of the fixture paid, then 25 s `PayeeNotAllowed` blocked on /premium-intel (beat 4) |
| 28 s | bypass rejected by AUSD (beat 5) |
| 31.5 s | searcher-3 `PayeeNotAllowed(4)` (beat 6) |
| 35-39 s | 3 scrapes paid, 42 s `OverBudget(3)` (beat 7) |
| 46 s | `CapRaised`, 48 s paid again (beat 8) |
| 50.5 s | root paused, 52-54 s three `Paused(1)` blocks (beat 9) |

Start `pnpm --filter agents demo` at about 0:10 so createRoot lands near 0:15.

## Shot list

Layout: left sidebar (Overview), top bar (Leash, "Treasury / Agent wallet", Base Sepolia pill, wallet address, Live dot), four KPI cards (Balance, Spent today, Blocked attempts, Active agents), then **Delegation tree** (left card) and **Activity** (right card, tabs All / Payments / Blocked). CLAUDE.md has 8 beats; the script has 9 (script beat 6, searcher-3's restricted payee, is a free extra).

| Video time | Beat | Where on screen | Voiceover |
| --- | --- | --- | --- |
| 0:00-0:14 | Hook | Empty Overview: Balance 5.00 AUSD, Spent today 0.00, Blocked attempts 0, Active agents 0. Tree: "No agents yet". Activity: "No activity yet". Press Enter in the terminal at about 0:10. | "Agents now pay for APIs on their own. The scary failure is a prompt injection that sends money to an attacker in a perfectly valid transfer." |
| 0:14-0:20 | 1. Owner creates orchestrator | Delegation tree: `orchestrator` row appears, 0.00 / 1.00 AUSD, per-call 0.10, expiry tonight, Active pill. Activity: a Created row. Active agents goes to 1. | "The owner gives the orchestrator an allowance: one AUSD, ten cents a call, expires tonight." |
| 0:20-0:26 | 2. Three searchers | Tree: `searcher-1`, `searcher-2`, `searcher-3` rows nest under it with connector lines, 0.00 / 0.25 each; searcher-3's caption reads "Search only". Active agents goes to 4. | "It splits that allowance among three sub-agents with signed delegations. The orchestrator pays no gas." |
| 0:26-0:36 | 3. Paid calls | Activity: rows with Paid pills, Search API 0.02 and Scrape API 0.05. Spent today climbs. In the tree, the searcher bar and the orchestrator bar both move. | "Every payment is charged at the child and at every ancestor, so the parent bar fills too." |
| 0:36-0:44 | 4. Injection blocked | Activity: a row for `searcher-2` to `ATTACKER`, Blocked pill, "Recipient is not on this agent's allowlist", code `PayeeNotAllowed(0)`. Blocked attempts goes to 1. | "searcher-2 scrapes a listing with a hidden instruction: buy 'verification' from an attacker. In this scripted run the agent follows it. The agent can sign anything. The chain refuses what's outside the policy." |
| 0:44-0:52 | 5. Bypass | Activity: searcher-2 to counterparty `AUSD`, Rejected pill, "AUSD rejected direct submission outside Leash settle()", code `BypassRejected()`. | "Send that same signature straight to AUSD and it fails too. AUSD asks our wallet through ERC-1271, and the wallet only says yes inside its own checks." |
| 0:52-0:56 | 6 (extra). Search-only agent | Activity: `searcher-3` blocked with `PayeeNotAllowed(4)`. | "A search-only sub-agent cannot pay the scrape API either." |
| 0:56-1:04 | 7. OverBudget | Tree: searcher-2's bar turns amber near 0.25 / 0.25. Activity: Blocked row `OverBudget(3)`, "Agent budget exhausted". | "Spend past its own cap and the next payment reverts with OverBudget." |
| 1:04-1:10 | 8. Raise cap | Tree: searcher-2 now reads x / 0.40 AUSD. Activity: Cap raised row, then a new Paid row from searcher-2. | "The owner raises its cap, and it keeps working." |
| 1:10-1:16 | 9. Pause | Tree: orchestrator pill Paused, the three searchers show Parent paused, bars grey. Activity: three `Paused(1)` Blocked rows. Active agents drops to 0. | "One pause on the orchestrator and the whole subtree stops." |
| 1:16-1:24 | Recap | Click the **Blocked** tab in Activity: every refused payment in one list (PayeeNotAllowed, AUSD rejected direct submission, OverBudget, Paused). Then open the kebab menu on `searcher-2` to show Pause and Raise cap; press Escape without choosing (choosing sends a real owner transaction). | "Every refusal is onchain, with a reason. The owner controls each agent from here." |
| 1:24-1:40 | Proof | Click the external-link icon on the `PayeeNotAllowed(0)` row and on the "AUSD rejected direct submission" row (or switch to the prepared Basescan tabs): status Fail on Base Sepolia. | "Both of those are real transactions that reverted on Base Sepolia." |
| 1:40-1:55 | Close | Back on Overview. | "Leash: a spending allowance for AI agents that they can split among sub-agents, enforced onchain at every payment." |

Pacing: the run does not wait for the voiceover. If you run long, record the voiceover separately, or cut the beat 6 line first.

## Pre-recording checklist

1. Services: `pnpm services:prod` is running (facilitator :4020, seller :4021, built dashboard :3000) and the facilitator printed the current wallet address.
2. Browser: 1440x900, zoom 100% (Cmd-0), other tabs closed, hard reload http://localhost:3000. The top bar must show the **Live** dot without "(chain only)". If it says "(chain only)", reload; blocked rows come from the live event stream.
3. Empty state: Balance 5.00 AUSD, Spent today 0.00, Blocked attempts 0, Active agents 0, "No agents yet". Activity tab set to **All**.
4. Terminal: large font (18 pt or more), wide window, `pnpm --filter agents demo` typed but not run. Never show `.env`, `env` or `printenv` on screen.
5. Backup Basescan tabs in a second window: injection block https://sepolia.basescan.org/tx/0x3d3952e0e045aaf573b48af2ed3b85f891b2ec9806d81d5df81cbe9fd4914cf6 and bypass rejection https://sepolia.basescan.org/tx/0xfe6134808d686cf39f454c843ff6cd3453856bfeef7f2733b7ab1e9c9ef94bfc
6. During beat 4 (about 0:36), confirm the Blocked row for ATTACKER appears and Blocked attempts goes to 1.
7. Do Not Disturb on; hide bookmarks bar.

## Fallback plan if a beat fails mid-recording

- Do not fix on camera. Stop the take.
- Reset: Ctrl-C the services, `pnpm fresh-wallet` (deploys, verifies, funds, archives events), `pnpm services:prod`, hard reload, confirm the empty state and the Live dot, then run the demo again. Never re-run the demo on the same wallet: caps are partly spent and the story reads wrong.
- If the dashboard misbehaves, record the terminal plus the Basescan tabs; every beat is printed in the terminal.

## What not to say (CLAUDE.md never-claim list)

Do not say: "enforced by the dollar itself", "a bad payment can't be signed", "no protocol changes", "first to do agent delegation", "ERC-8366 standard" (draft PR #1929), or any statistic without a source. Say instead: the token asks our wallet through ERC-1271; the agent can sign anything and the chain refuses it; it needs a Leash-aware facilitator that calls `settle()`.
