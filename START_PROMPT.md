You are the lead engineer for Leash at B@BHacks 2.0. HARD DEADLINE: 5:00pm PT; I submit at 4:45pm. Run `date` now and at every phase boundary. If behind schedule, cut SHOULD items, never MUST items.

Read CLAUDE.md fully, then .claude/agents/*.md. CLAUDE.md rules override your defaults. .env already holds testnet keys (DEPLOYER/OWNER, RELAYER, ROOT_AGENT, payee and attacker addresses) and an ADMIN_TOKEN; never print private keys and do not regenerate them.

You orchestrate. Delegate implementation to the subagents and launch independent ones in parallel (several Agent calls in one message). You run at effort high; ultracode stays off. Use plan mode only for the 2-minute P0 plan below.

STEP 1 (by 2:20, do in parallel):
a. `git init`, first commit with the kit files. Create DECISIONS.md (D-001: primary path = settle -> AUSD bytes 3009 -> ERC-1271 transient approval; rejected: view-only 1271 digest rebuild (no running counter), MetaMask erc7710 (needs a delegation smart account and DelegationManager)) and STATUS.md. Create a task list mirroring the CLAUDE.md phases. If `gh auth status` works, `gh repo create leash --private --source . --push`.
b. Tooling: node >= 20, pnpm (`npm i -g pnpm` if missing), forge/cast (`curl -L https://foundry.paradigm.xyz | bash` then `~/.foundry/bin/foundryup` if missing). Scaffold the pnpm workspace (root package.json with `pnpm demo` using concurrently, pnpm-workspace.yaml, tsconfig base).
c. `claude mcp add --transport http agora https://docs.agora.finance/_mcp/server` and `npx skills add https://docs.context.dev --skill context-dev --yes`. If either fails, log it and move on.
d. Check `cast balance $DEPLOYER_ADDRESS --rpc-url $BASE_SEPOLIA_RPC_URL`. Then send me ONE message: which of ANTHROPIC_API_KEY / CONTEXT_DEV_API_KEY / ELEVENLABS_API_KEY are empty in .env (check emptiness without printing values), and whether DEPLOYER has Base Sepolia ETH (give the address and https://portal.cdp.coinbase.com/products/faucet). Keep working; never block on a key. Once DEPLOYER has ETH: send 0.02 ETH to RELAYER and call the AUSD faucet `requestFunds(address)` for DEPLOYER (check the faucet ABI on Blockscout if that signature fails).

STEP 2, P0 gate (by 2:35). Yourself: `cast code` grep cf092995; `cast storage` the EIP-1967 impl slot and decode bits 160/164/165/168/169; `eip712Domain()`; `DOMAIN_SEPARATOR()`; `decimals()`. In parallel launch:
- solidity-engineer: contracts scaffold, full LeashWallet, MockAUSD, test/fork/AusdGate.t.sol, run the fork test.
- facilitator-engineer: packages/leash-client, apps/facilitator, apps/seller against the CLAUDE.md interface.
- frontend-engineer: apps/dashboard with mock data in the final data shapes.
- agent-engineer: apps/agents, DEMO_SCRIPTED first.
At 2:35 decide: gate passed -> path A; failed -> Fallback B. Log D-002 and tell me in one line.

STEP 3, P1 (to 3:10): unit tests green, ABI exported to packages/abi, services switched to packages/abi. Council gate 1: protocol-auditor reviews (10 min). Fix every BLOCKER, then commit.

STEP 4, P2 (to 3:35): deploy + verify on Blockscout, fund LeashWallet with 5 AUSD, createRoot for ROOT_AGENT, write LEASH_WALLET into .env and packages/abi/deployments/base-sepolia.json, start facilitator and seller, prove one real paid request (402 -> paid -> 200 with a Paid event) and one decoded block. Push.

STEP 5, P3 (to 4:00): `pnpm demo` runs all 8 CLAUDE.md demo beats end to end in DEMO_SCRIPTED mode, and LLM mode completes at least once; the dashboard shows every beat with Basescan links. At 3:45, only if on schedule, do SHOULD items in this order: raise-cap button, ElevenLabs TTS prompt, dashboard on Vercel.

4:00 FEATURE FREEZE. Run demo-director and docs-writer in parallel (README, docs/DEMO.md). Reset to a clean state for recording (fresh child nodes or a fresh wallet so the bars start empty). Then tell me "READY TO RECORD" with the exact commands, the URL to open, and the shot list.

4:30: secret scan (`git grep -nE "0x[a-fA-F0-9]{64}"`, API key prefixes), final push, then ask me before making the repo public.

Commit small and often with conventional commits. Update STATUS.md at each phase boundary and DECISIONS.md for every non-trivial choice. Stop and ask only for secrets you truly cannot obtain, making the repo public, and the final submission. Start now.
