# Leash: 2-minute demo shot list

Recording setup: dashboard at http://localhost:3000 (1440x900, browser zoom 100%) on the left or full screen, terminal 2 visible for the `[SCRIPTED]` lines. One continuous take.

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

The script has 9 beats; CLAUDE.md lists 8 (script beat 6, searcher-3 restricted payee, is extra and is a free "per-node allowlist" proof). Mapping below.

| Video time | Script beat (CLAUDE.md beat) | Dashboard (region) | Terminal line to point at | Voiceover |
| --- | --- | --- | --- | --- |
| 0:00-0:14 | Hook (none) | Full dashboard, empty: header shows `Live`, wallet balance 5.00 AUSD, tree says "No nodes yet", Payments "Waiting for the first payment", Blocked "Nothing blocked yet". | Terminal 2 idle, command typed but not run. Press Enter at about 0:10. | "Agents now pay for APIs on their own. The scary failure is a prompt injection that sends money to an attacker in a perfectly valid transfer." |
| 0:14-0:20 | 1 (1) Owner creates orchestrator | Tree: orchestrator #1 card appears, `0.00 / 1.00`, Max/call 0.10, Expires about 8h. Payments feed: "Allowance created for orchestrator". | `[SCRIPTED] --- beat 1/9`, then `root created tx https://sepolia.basescan.org/tx/...` | "The owner gives the orchestrator an allowance: one AUSD, ten cents a call, expires tonight." |
| 0:20-0:26 | 2 (2) Three searchers, no gas | Tree: searcher-1, searcher-2, searcher-3 nest under it, each `0.00 / 0.25`; searcher-3 has the violet "Search API only" chip. | `orchestrator delegated searcher-1 -> node 2 ... restricted=[PAYEE_SEARCH]` | "It splits that allowance among three sub-agents with signed delegations. The orchestrator pays no gas." |
| 0:26-0:34 | 3 (3) Paid calls fill bars | Payments: green rows with `0.02` and `0.05`. Bars fill at the searcher and at the orchestrator (parent) at the same time. | `searcher-1 (node 2) search 0.02 AUSD PAID tx ...` | "Every payment is charged at the child and at every ancestor, so the parent bar fills too." |
| 0:36-0:44 | 4 (4) Injection blocked | Blocked lane (right column): first red row "Recipient is not on this agent's allowlist", `searcher-2 tried to pay ATTACKER 0.05 AUSD`, chip `PayeeNotAllowed(0)`, Basescan link. This must visibly fill at about T+25 s. | `searcher-2 read the listing (865 chars). [SCRIPTED] the injected instruction is followed deterministically here; in live mode the model decides.` then `... premium-intel 0.05 AUSD BLOCKED PayeeNotAllowed(0)` | "searcher-2 scrapes a listing with a hidden instruction: buy 'verification' from an attacker. The agent can sign anything. The chain refuses what's outside the policy." Say "scripted" here, e.g. "In this scripted run the agent follows it." |
| 0:44-0:52 | 5 (5) Bypass straight to AUSD | Blocked lane: second red row "AUSD rejected it: the signature is only valid inside Leash settle()", "Direct call to AUSD with a captured signature". | `bypass: same signature sent straight to AUSD -> ok=false reverted=true` | "Send that same signature straight to AUSD and it fails too. AUSD asks our wallet through ERC-1271, and the wallet only says yes inside its own checks." |
| 0:52-0:56 | 6 (extra) Restricted searcher-3 | Blocked lane: third row `PayeeNotAllowed(4)` for searcher-3. | `searcher-3 (node 4) scrape 0.05 AUSD BLOCKED PayeeNotAllowed(4)` | "A search-only sub-agent cannot pay the scrape API either." |
| 0:56-1:04 | 7 (6) OverBudget | Tree: searcher-2 bar goes amber, then `0.20 / 0.25`; Blocked lane row `OverBudget(3)`, "Agent budget exhausted". | `searcher-2 (node 3) scrape 0.05 AUSD BLOCKED OverBudget(3)` | "Spend past its own cap and the next payment reverts with OverBudget." |
| 1:04-1:10 | 8 (7) Owner raises cap | Tree: searcher-2 shows `/ 0.40`; Payments: "searcher-2 cap raised 0.25 to 0.40 AUSD" then a green `0.05` row. | `owner raised searcher-2 cap to 0.40 AUSD tx ...` then `scrape ... PAID` | "The owner raises its cap, and it keeps working." |
| 1:10-1:16 | 9 (8) Pause the orchestrator | Tree: every card turns grey, `PAUSED` on the orchestrator and `PARENT PAUSED` on the three searchers. Blocked lane: three `Paused(1)` rows. | `owner paused root node 1 tx ...`, then three `BLOCKED Paused(1)` lines, then `done.` | "One pause on the orchestrator and the whole subtree stops." |
| 1:16-1:36 | Proof (links) | Switch to two prepared browser tabs (see checklist): the `PayeeNotAllowed` revert and the bypass revert on Basescan (status Fail). Alternatively click the Basescan links in the Blocked lane. | None. | "Both of those are real transactions that reverted on Base Sepolia. Here is the settle call refused with PayeeNotAllowed, and here is AUSD rejecting the bypass." |
| 1:36-2:00 | Close | Back on the dashboard, grey tree. | None. | "Leash: a spending allowance for AI agents that they can split among sub-agents, enforced onchain at every payment." Optional one-liner before it: "The wallet keeps decrementing budgets and allowlists in an ERC-1271 check that only passes inside settle(), so the default x402 eip3009 rail gets the controls with an unmodified token. Delegation systems like MetaMask's framework and ERC-7710 already exist; this is the stateful 1271 gate on the eip3009 rail." |

Pacing note: if the voiceover runs long, the run does not wait. Either record the voiceover separately over the screen capture, or trim the beat 6 and beat 8 lines first (they are SHOULD-level).

## Pre-recording checklist

Order matters. The facilitator reads `LEASH_WALLET` and `data/events.jsonl` at boot, so run the fresh wallet before starting services.

1. Stop any running `pnpm services` / `pnpm demo` (Ctrl-C). The rehearsal services are bound to the rehearsal wallet and hold its events in memory.
2. `pnpm fresh-wallet` and wait for the success output. It deploys LeashWallet, allowlists the 2 payees, funds 5 AUSD, creates no root, archives `data/events.jsonl`, and rewrites `LEASH_WALLET` in `.env` and `packages/abi/deployments/base-sepolia.json`.
3. Run the `verify:` command the script prints (Blockscout, no key). Without it the new wallet's reverts show as a bare "Fail" with no decoded error name.
4. Terminal 1: `pnpm services`. Wait for the facilitator line `AUSD domain verified: "Agora Dollar" v1 chain 84532` and the printed wallet address, and confirm it is the new wallet.
5. Browser: close all other tabs and windows, set 1440x900, zoom 100% (Cmd-0), hard reload http://localhost:3000, and wait for the pill to say `Live` (not `Live (chain only)`, not `Mock data`). If it says `(chain only)` the Blocked lane will not fill: reload.
6. Check the empty state: wallet balance 5.00 AUSD, "No nodes yet", "Nothing blocked yet". If anything from the rehearsal is visible, you did not restart services after the fresh wallet.
7. ETH budget (checked 15:16 PT): DEPLOYER 0.000134 ETH, RELAYER 0.000159 ETH, gas price about 0.006 gwei. A clean run costs the relayer about 0.000015 ETH and a fresh-wallet reset costs the deployer about 0.00002 ETH, so there is room for several takes.
8. Terminal 2: large font (at least 18 pt), dark theme, window sized so lines are not wrapped (they are long: use a wide window). Type `pnpm --filter agents demo` but do not press Enter. Never run `env`, `cat .env` or anything that prints keys on camera.
9. Basescan tabs, in a second window or off-screen so they do not show during the run:
   - Tab A: a `PayeeNotAllowed` revert. Known-good verified-wallet fallback (original wallet, source verified): https://sepolia.basescan.org/tx/0xf1548f0b1fc7ccb4ec7e4aa437cb12a85d883f9c6a13e507b4114bb3e5a36a16
   - Tab B: the bypass revert on AUSD. Known-good fallback: https://sepolia.basescan.org/tx/0xfe6134808d686cf39f454c843ff6cd3453856bfeef7f2733b7ab1e9c9ef94bfc
   - Better: right after the run, open the live run's own links by clicking `Basescan 0x...` in the first two Blocked rows, then switch to those. Keep the fallbacks open in case Basescan is slow to index.
10. Eyeball during beat 4 (about 0:36): the Blocked lane must fill with the red `PayeeNotAllowed(0)` row, with `ATTACKER` named. If it stays empty and terminal 2 printed `BLOCKED`, the dashboard SSE is not connected: reload and re-run from the fallback plan.
11. Screen recording: capture the dashboard and terminal 2 together; hide notifications (Do Not Disturb), bookmarks bar and the macOS menu bar clock if possible.

## Fallback plan if a beat fails mid-recording

- Do not try to fix on camera. Stop the take.
- If it was only a visual problem (lane empty, page stuck): reload the browser. The dashboard backfills the tree and payments from the chain, but the Blocked lane only fills from live events, so a re-run on the same wallet needs a fresh wallet anyway.
- Full reset: Ctrl-C terminal 1, `pnpm fresh-wallet`, optionally the verify command, `pnpm services`, hard reload the dashboard, confirm `Live` and the empty state, then `pnpm --filter agents demo`. Expect about 3 to 4 minutes per reset.
- Do not re-run `demo` on the same wallet: the script unpauses an existing root, but the bars and Blocked lane will already be populated and the 0.25 caps are partly spent, so beat 7 hits OverBudget early and the story reads wrong.
- If the chain or RPC is slow and one tx hangs, wait out one 30 s timeout once; then reset as above. Two failed takes in a row: cut to the best partial take plus the prepared Basescan tabs, and say plainly in the voiceover that it is a scripted replay.
- If the dashboard is unusable, record terminal 2 only and show the Basescan tabs. The terminal lines carry every beat.

## What not to say (CLAUDE.md never-claim list)

Do not say: "enforced by the dollar itself", "a bad payment can't be signed", "no protocol changes", "first to do agent delegation", "ERC-8366 standard" (draft PR #1929), or any statistic without a source. Say instead: the token asks our wallet through ERC-1271; the agent can sign anything and the chain refuses it; it needs a Leash-aware facilitator that calls `settle()`.
