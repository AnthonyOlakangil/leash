# Decisions

## D-001 Primary payment path (14:28)
Decision: settle() -> AUSD.transferWithAuthorization(bytes signature overload, 0xcf092995) -> ERC-1271 isValidSignature gated by an EIP-1153 transient approval flag set only inside settle().
Rationale: keeps x402's default eip3009 rail, lets a stateful contract enforce decrementing hierarchical budgets and payee allowlists, and makes the token itself refuse direct-to-token bypass.
Alternatives rejected: view-only ERC-1271 digest rebuild (no running counter, cannot decrement a budget, see x402 issue #2641); MetaMask erc7710 (needs a delegation smart account plus DelegationManager, too much surface for a 3-hour build).
Consequences: requires a Leash-aware facilitator that calls settle(); requires AUSD testnet to support the bytes overload with 1271 fallback (P0 gate). Fallback B if not.

## D-002 P0 gate passed, Path A (14:35)
Decision: proceed with Path A (settle -> AUSD bytes 3009 -> ERC-1271 transient approval).
Rationale: live AUSD (proxy 0xa901..22dC, impl 0xc1e3..12da) contains 0xcf092995; impl-slot flag bits 160/164/165/168/169 all 0; eip712Domain "Agora Dollar"/"1"/84532; decimals 6; DOMAIN_SEPARATOR 0x5a85...e8bb. Fork test (5/5) on live AUSD: settle moves balance, same sig direct to AUSD reverts InvalidSignature(), replay reverts, isValidSignature 0xffffffff outside settle. settle gas median 144,059.
Alternatives rejected: Fallback B (not needed).
Consequences: bypass demo beat (5) is live. ETH budget: relayer funded with 0.00015 ETH (not 0.02) because DEPLOYER held only 0.0004 ETH; at 0.006 gwei this covers ~150 settles.

## D-003 Errors for edge cases inside the frozen interface (14:35)
Decision: invalid keys (zero/owner/wallet/reused) revert KeyInUse; owner actions on a nonexistent node revert UnknownAgent(address(0)); createChild under a paused/expired parent reverts Paused/Expired.
Rationale: no new error types after the interface freeze.

## D-004 Council gate 1 result (14:44)
Decision: gate passed, no BLOCKERs. Contract checklist items 1-5 OK. Fixing off-chain SHOULDs now: (1) force-broadcast must not skip payTo/amount/asset/from checks in /settle, (2) front-run detection in all blocked branches, (3) TS golden-vector test incl. PauseChild. NITs accepted as known limitations (README): child-key capture by a hostile sibling is griefing-only; createRoot lacks sanity requires (owner-only); force/bypass endpoints unauthenticated (demo only).
Rationale: none of the NITs can move funds outside a node's policy; contract redeploy not needed.

## D-005 Public RPC getLogs limit (14:44)
Decision: all log queries use <= 190-block chunks starting at deployBlock.
Rationale: sepolia.base.org rejects eth_getLogs spans over 200 blocks; found by running the dashboard live against an anvil fork.

## D-006 Fork integration before live deploy (14:40)
Decision: run the full stack (facilitator, seller, agents scripted + LLM, dashboard) against an anvil fork of Base Sepolia with real AUSD before spending live gas. All 9 scripted beats passed; LLM mode completed (model declined the injection on its own; scripted mode demonstrates the onchain block). Found and fixed: forced tool_choice unsupported by claude-sonnet-5-5; getLogs range.

## D-007 Stale reads on the public RPC (14:48)
Decision: agents wait until getNode reflects an owner unpause (+3s), and facilitator retries a failed delegate/admin simulation once after 2.5s. Payments are unaffected (demo payments use forceBroadcast, so the chain decides).
Rationale: first live LLM run failed createChild with Paused(1) right after a mined unpause; sepolia.base.org is load-balanced and one backend can lag a block.

## D-008 Fresh wallet per recording; rehearsal found a stale-read expiry bug (14:58)
Decision: `pnpm fresh-wallet` deploys a new LeashWallet (payees allowlisted, 5 AUSD, no root) so beat 1 creates the root on camera and all bars start empty. The original verified deployment 0xD6a92b451468f1f4decA6Fa27Fd8c367163D653c stays the canonical address in the README.
Rationale: the first one-command rehearsal on a fresh wallet read the just-created root as an empty node (stale RPC backend), so children were delegated with expiry 0 and every payment correctly reverted Expired(node) onchain. Fixed in agents (wait for the root to be visible, refuse past expiry). Second rehearsal: all 9 beats passed.
Consequences: the contract accepts a child expiry already in the past (it is <= parent); harmless (that child can never pay), listed as a known limitation.

## D-009 SHOULD items (15:02)
Decision: raise-cap step-up ships (dashboard "Raise cap" button + scripted beat 8). ElevenLabs TTS cut: no ELEVENLABS_API_KEY / VOICE_ID. Vercel dashboard: pending user `vercel login`; a hosted dashboard would run chain-only (no local facilitator SSE, no owner buttons).

## D-010 Wrap-up SHOULD items (15:15)
Decision: (a) ElevenLabs TTS skipped: ELEVENLABS_API_KEY and VOICE_ID are not set. (b) Dashboard deployed to Vercel as a read-only chain view: https://leash-dashboard-rho.vercel.app (reads the recording wallet from Base Sepolia).
Rationale: built locally with LEASH_NO_DOTENV=1 and only public addresses in the environment (the Vercel CLI would otherwise upload .env), output scanned for every secret value (clean), then `vercel deploy --prebuilt` from the repo root (pnpm monorepo needs rootDirectory apps/dashboard).
Consequences: hosted owner buttons and the off-chain Blocked lane events need the local facilitator; the local demo is the full experience.

## D-011 Pre-public secret scan (15:11)
Decision: no history rewrite needed. No sk-ant or Context.dev key prefix, and no .env secret value (API keys, ADMIN_TOKEN, deployer/relayer/root private keys) appears in any commit. The 45 unique 64-hex strings in history are tx hashes, typehashes, storage slots, event topics, the domain separator, and a public test-only golden key; none derives to a project account. .env, .env.fork and apps/agents/.keys.json were never committed. Added deny rules for reading/printing .env to .claude/settings.json and CLAUDE.md.

## D-012 Control-room UI polish (15:37)
Decision: styling-only pass (frontend-engineer, commit 947a38c) plus two display fixes by the lead: the PAUSED badge no longer covers spent/cap amounts, and facilitator owner-action/delegation events already present in chain logs are no longer shown twice. Verified with Playwright screenshots at 1440x900 against a throwaway wallet after a full scripted run (live SSE, Blocked lane filled) and the empty recording state. Recording uses `pnpm services:prod` (built dashboard, no dev overlay). New recording wallet 0x01a38451fdE9CeA24cDF3Ee212af6b0950645417 (verified); Vercel redeployed to it.

## D-013 Product redesign of the dashboard (15:57)
Decision: replaced the control-room look with a product layout (sidebar, breadcrumb top bar, KPI cards, delegation tree rows with pills and kebab menus, tabbed Activity table) on a soft dark Geist design system. Built in a separate git worktree so the running production dashboard (which serves apps/dashboard/.next) was never disturbed. Verified with Playwright at 1440x900: empty state, a full scripted run on throwaway wallet 0xEf42Ce218a6c78Bc5dFEAa6ec5ce2bA32132cBf7 with live SSE, the Blocked tab, and the kebab menu (Escape closes). Tertiary text raised to #8a8b93 for WCAG AA. New recording wallet 0xf7c239E1AeB8C418557349561572Ef42D3933B02; Vercel redeployed.

## D-014 Hosted demo replay instead of a hosted runner (18:40)
Decision: the hosted dashboard gets a "Watch demo" button (and `?replay=1` link) that replays one recorded scripted run beat by beat: wallet 0x7c37Cf64c2D7757f943cD4182e4e21ac91896810, its 14 onchain logs plus the 21 facilitator events from that run (apps/dashboard/lib/replay-data.json, built by apps/dashboard/scripts/make-replay.mts). The live view still opens on the fresh wallet 0x10671B5437539Fc35474416626E854d38d2648eF (5.00 AUSD, no agents).
Rationale: a judge-runnable hosted demo would need the owner, relayer and agent keys on Vercel behind a public endpoint that sends transactions; that was refused as a credential and remote-execution risk. The replay needs no keys and sends nothing, and every row still links to its real Base Sepolia transaction.
Alternatives rejected: hosted runner with server-held testnet keys (security, and the keys hold under one run of test ETH); tunnel to the local services (depends on a laptop staying online).
Consequences: the replay is labeled as a replay in the status bar and narration strip, and the node menus are read-only during it. Only builds with NEXT_PUBLIC_LEASH_REPLAY=1 show it, so the local recording UI is unchanged.
