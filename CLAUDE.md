# CLAUDE.md: Leash (B@BHacks 2.0, UC Berkeley, Sun Oct 11 2026)

## HARD DEADLINE: 5:00pm PT submission. Submit by 4:45pm (platform needs 15 min).
Timeline (PT), non-negotiable:
- 2:15-2:35  P0  Scaffold + gate checks on real AUSD (fork test), all scaffolds in parallel
- 2:35-3:10  P1  Contract complete + tests; services built in parallel against mock ABI
- 3:10       Council gate 1 (protocol-auditor, 10 min max)
- 3:10-3:35  P2  Deploy + verify on Base Sepolia, fund wallet, first real paid x402 call + one decoded block
- 3:35-4:00  P3  Agents live, injection + bypass demos, dashboard live, DEMO_SCRIPTED mode
- 4:00       FEATURE FREEZE. Bug fixes only.
- 4:00-4:30  User records 2-minute video on a known-good run
- 4:30-4:45  README final, repo public, dashboard on Vercel, submit
If any phase overruns by more than 10 minutes, cut the lowest-priority SHOULD item and log it in DECISIONS.md. Never let a SHOULD item delay a MUST item.

## What we are building
Leash is a spending allowance for AI agents that they can split among sub-agents, with the rules enforced onchain at every payment.

A LeashWallet contract holds AUSD on Base Sepolia. Nodes form a delegation tree (root = orchestrator, max 3 levels: root depth 0, child depth 1, grandchild depth 2). Each node has: key, parent, depth, cap, spent, maxPerCall, expiry, paused, restricted (+ optional per-node payee allowlist).

Payment flow:
1. Agent node key signs a standard ERC-3009 TransferWithAuthorization with from = LeashWallet.
2. Our facilitator submits it to LeashWallet.settle(), never directly to AUSD.
3. settle() recovers the signer, maps it to a node, walks every ancestor checking paused/expiry/maxPerCall/node allowlist/budget, increments spent at every level, checks the balance floor, sets a transient approval flag for that exact digest, calls AUSD.transferWithAuthorization(..., bytes signature) (selector 0xcf092995), clears the flag, emits Paid.
4. AUSD ecrecovers the agent's 65-byte sig, gets the agent key (not the wallet), falls back to ERC-1271 and staticcalls LeashWallet.isValidSignature(digest, sig). The wallet returns 0x1626ba7e ONLY if msg.sender == AUSD AND the transient flag for that digest is set.
5. Anyone submitting the agent's signature directly to AUSD fails, because no flag is set. This is a demo beat.

Why this is novel (the only claim we make): ERC-1271 is normally a stateless "did I sign this" check. Leash makes it a stateful spending gate using EIP-1153 transient storage, so the default x402 eip3009 rail gets payee allowlists, per-call caps, decrementing hierarchical budgets, expiry, and a subtree kill switch, and the token itself refuses any bypass. This answers the open question in x402 GitHub issue #2641 (view-only 1271 "can't decrement" a budget).

## Non-negotiable correctness rules
- AUSD Base Sepolia: 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC. Faucet: 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C (try `requestFunds(address)`; if it fails, read the ABI on Basescan/Blockscout).
- Chain: Base Sepolia, chainId 84532, x402 network id "eip155:84532". Default RPC https://sepolia.base.org (backup: user-provided Alchemy/QuickNode).
- AUSD EIP-712 domain: name "Agora Dollar", version "1", chainId 84532, verifyingContract = AUSD. NEVER "AUSD". Verify with eip712Domain() in P0 and at service boot; fail loudly on mismatch.
- TRANSFER_WITH_AUTHORIZATION_TYPEHASH = 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267 = keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"). Unit-test it.
- Read decimals() from the token; never assume 6.
- validAfter = now - 5 (AUSD requires block.timestamp > validAfter strictly). validBefore = now + 120. Nonces are random 32 bytes (crypto.getRandomValues), never counters (nonce namespace is shared by all nodes since the authorizer is the wallet).
- isValidSignature is `view`, uses TLOAD only (TSTORE is illegal in STATICCALL), requires msg.sender == AUSD, never validates anything except a digest flagged inside settle(). This also means the wallet can never sign permits.
- Transient slot = keccak256(abi.encode(digest, APPROVAL_SALT)), APPROVAL_SALT = keccak256("leash.approval.v1"). Use OpenZeppelin ReentrancyGuardTransient on settle().
- Every payment checks and increments EVERY ancestor. At child creation: child cap <= parent cap, maxPerCall <= parent, expiry <= parent, depth <= 2. A restricted parent's child may only list payees the parent allows.
- Key hygiene: createRoot/createChild revert if key is zero, owner, this, or already used (nodeOfKey[key] != 0).
- Delegations: EIP-712 domain {name "Leash", version "1", chainId, verifyingContract = wallet}; struct includes nonce + deadline; usedDelegation[structHash] prevents replay.
- pauseChild signer must be a strict ancestor of the target. Only owner can unpause, raiseCap, setAllow, setFloor, withdraw.
- Use OZ ECDSA.recover (low-s enforced).
- Foundry: solc 0.8.28, evm_version = "cancun", via_ir = false unless stack-too-deep forces it (log decision).
- Custom errors: UnknownAgent(address), PayeeNotAllowed(uint256 node) (node 0 = global list), OverPerCall(uint256), OverBudget(uint256), Expired(uint256), Paused(uint256), BelowFloor(), TooDeep(), ChildExceedsParent(), BadDelegation(), KeyInUse(), NotAncestor(), NotOwner().
- Events: NodeCreated(id, parent, key, cap, maxPerCall, expiry), Paid(id, to, value, nonce), NodePaused(id, by), NodeUnpaused(id), CapRaised(id, oldCap, newCap), AllowSet(payee, allowed).
- Views: getNode(id), remaining(id) (min over ancestors of cap - spent), nodeCount().
- Secrets live only in .env (gitignored). Never print private keys to the terminal or logs. Never cat/read/print .env or any .env.* copy, and never run `env`/`printenv`; check a key's presence with `grep -c '^NAME=.' .env` and load values with `set -a; source .env; set +a` inside the command that needs them. Never commit .env. Run `git grep -nE "0x[a-fA-F0-9]{64}"` and a check for API key prefixes before every push.

## settle() order (normative)
1. nonReentrant.
2. structHash = keccak256(abi.encode(TWA_TYPEHASH, address(this), to, value, validAfter, validBefore, nonce)).
3. digest = keccak256(abi.encodePacked("\x19\x01", AUSD.DOMAIN_SEPARATOR(), structHash)).
4. signer = ECDSA.recover(digest, sig); id = nodeOfKey[signer]; if 0 revert UnknownAgent(signer).
5. if !allowlist[to] revert PayeeNotAllowed(0).
6. for n = id up to root: Paused(n) / Expired(n) (block.timestamp >= expiry) / OverPerCall(n) / restricted && !nodeAllow[n][to] -> PayeeNotAllowed(n) / spent + value > cap -> OverBudget(n); then spent += value.
7. if AUSD.balanceOf(this) < value + floor revert BelowFloor().
8. tstore(slot, 1); AUSD.transferWithAuthorization(address(this), to, value, validAfter, validBefore, nonce, sig); tstore(slot, 0).
9. emit Paid(id, to, value, nonce).

## Fallback ladder (decide fast, log in DECISIONS.md)
- A (target): settle -> AUSD bytes 3009 -> 1271 transient approval.
- B (testnet AUSD lacks 0xcf092995, or signature verification/transfers paused, or fork test fails by 2:35): settle keeps every check, enforces its own usedNonce + validity window + agent signature, and calls AUSD.transfer(to, value). Lose only the bypass demo. Tell the user in one line.
- C (no AUSD obtainable): MockAUSD with identical Solady SignatureCheckerLib logic deployed on Base Sepolia; disclose in README.
- D (x402 package friction > 15 min): hand-rolled x402 v2 (headers PAYMENT-REQUIRED / PAYMENT-SIGNATURE, base64 JSON). The client is hand-rolled by default anyway.
- E (LLM flakiness): DEMO_SCRIPTED=1 deterministic replay, labeled.

## Things we must never claim (README, UI copy, pitch)
- "Enforced by the dollar itself" (the token asks our contract).
- "A bad payment can't be signed" (the agent can sign anything; the chain refuses it).
- "No protocol changes" (our facilitator calls settle()).
- "First to do agent delegation" (MetaMask Delegation Framework / ERC-7710, and x402's erc7710 method exist).
- "ERC-8366 standard" (it is a draft PR, ethereum/ERCs #1929).
- Any statistic without a source.

## Repo layout (pnpm workspaces)
contracts/              Foundry: src/LeashWallet.sol, src/mocks/MockAUSD.sol, test/, test/fork/, script/Deploy.s.sol, script/Smoke.s.sol
packages/abi/           generated ABIs + deployments/base-sepolia.json (addresses, tx hashes)
packages/leash-client/  hand-rolled x402 v2 client: signs 3009 with from = LeashWallet using a node key
apps/facilitator/       Express + viem: GET /supported, POST /verify, POST /settle, GET /events (SSE), POST /demo/bypass, POST /delegate (relays createChild), POST /admin/* (owner actions, ADMIN_TOKEN)
apps/seller/            Express, hand-rolled x402: GET /search, GET /scrape, GET /listings/sax-42 (free injection fixture), GET /premium-intel (payTo = ATTACKER)
apps/agents/            orchestrator + sub-agents (Anthropic SDK), DEMO_SCRIPTED mode
apps/dashboard/         Next.js App Router + Tailwind + viem: tree with spent/cap bars, payment log, Blocked lane, owner controls (pause, unpause, raise cap)
docs/DEMO.md            shot list + 2-minute script
DECISIONS.md  STATUS.md  README.md  .env.example

## Prices and demo parameters
- Seller prices: /search 0.02 AUSD (payTo PAYEE_SEARCH), /scrape 0.05 AUSD (payTo PAYEE_SCRAPE), /premium-intel 0.05 AUSD (payTo ATTACKER, NOT allowlisted).
- Root (orchestrator): cap 1.00, maxPerCall 0.10, expiry 23:59 PT today.
- Children: searcher-1 and searcher-2 cap 0.25; searcher-3 cap 0.25 restricted to PAYEE_SEARCH only.
- Global allowlist: PAYEE_SEARCH, PAYEE_SCRAPE.
- Fund LeashWallet with 5 AUSD. floor = 0.

## Commands
pnpm i | pnpm -r build | pnpm -r test
cd contracts && forge build && forge test -vvv
forge test --fork-url $BASE_SEPOLIA_RPC_URL --match-path "test/fork/*" -vvv
forge snapshot
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
forge verify-contract <addr> src/LeashWallet.sol:LeashWallet --chain 84532 --verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/ (no key needed; Etherscan v2 key optional)
cast code $AUSD --rpc-url $BASE_SEPOLIA_RPC_URL | grep -c cf092995
cast call $AUSD "eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])" --rpc-url $BASE_SEPOLIA_RPC_URL
cast storage $AUSD 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url $BASE_SEPOLIA_RPC_URL
pnpm --filter facilitator dev | pnpm --filter seller dev | pnpm --filter agents demo | pnpm --filter dashboard dev
One-command local demo: `pnpm demo` (starts facilitator, seller, dashboard concurrently; then runs agents).

## Keys (already generated in .env, TESTNET ONLY; do not regenerate)
DEPLOYER (= OWNER; the only address the user funds with Base Sepolia ETH), RELAYER (fund from DEPLOYER via cast send, 0.02 ETH), PAYEE_SEARCH, PAYEE_SCRAPE, ATTACKER (address only), ROOT_AGENT (orchestrator node key). If any is missing, generate with `cast wallet new` and append. Agent node keys are generated at runtime by the orchestrator and stored in apps/agents/.keys.json (gitignored).

## Conventions
- Conventional commits: feat|fix|test|chore|docs|refactor(scope): summary. Commit after every green test or working slice (every 10-15 min). Subagents commit only their own paths (git add <paths> && git commit). If .git/index.lock exists, wait 2s and retry. Push to origin after each phase.
- DECISIONS.md entry format: `## D-### <title> (HH:MM)` then Decision / Rationale / Alternatives rejected / Consequences.
- STATUS.md: update at every phase boundary and blocker: phase, done, in progress, blockers, next, URLs, contract addresses, tx hashes.
- Never fake what a judge checks. Hard-coded flows are allowed only in DEMO_SCRIPTED mode and must be labeled in logs and README.
- Avoid em dashes in README and UI prose.

## Models and effort
- Main thread (lead/orchestrator): Opus 5.5, effort high. Ultracode OFF for the whole build (its orchestration overhead does not fit a 3-hour deadline).
- Run independent subagents in parallel (several Agent calls in one message). Use the roster below; do not override their model/effort.

## Subagent roster (.claude/agents/)
- solidity-engineer (opus, high): contracts/, packages/abi
- protocol-auditor (opus, xhigh): read-only review + adversarial tests in test/audit/
- facilitator-engineer (sonnet, high): apps/facilitator, apps/seller, packages/leash-client
- agent-engineer (sonnet, high): apps/agents
- frontend-engineer (sonnet, medium): apps/dashboard
- demo-director (sonnet, high): read-only judge's-eye review, docs/DEMO.md
- docs-writer (haiku, low): README.md, docs/
Council = protocol-auditor + demo-director. Findings triaged BLOCKER / SHOULD / NIT. BLOCKERs fixed before next phase. Council review is time-boxed to 10 minutes.

## Phase gates
P0 (by 2:35): `cast code` contains cf092995; impl-slot flag bits 164 (transfers paused) and 165 (signature verification paused) are off; eip712Domain name "Agora Dollar" version "1" chainId 84532; decimals read; fork test passes: settle succeeds and moves balance, same sig direct to AUSD reverts, replay reverts, transient storage works. Gas recorded. Else Fallback B.
P1 (by 3:10): all unit tests green incl. every custom error, depth 1/2/3 happy paths, sibling spend hitting parent OverBudget, delegation replay/deadline/wrong signer/exceeds parent/too deep/key reuse, isValidSignature outside settle and wrong msg.sender. ABI exported. Council gate 1 passed.
P2 (by 3:35): LeashWallet deployed + verified on Blockscout, funded with AUSD, root created, one real paid seller request (402 -> paid -> 200, Paid event), one decoded block.
P3 (by 4:00): full demo sequence runs end to end twice (LLM mode once, DEMO_SCRIPTED once). Dashboard shows every beat.
FREEZE 4:00.

## Demo beats (docs/DEMO.md must make every one visible, each onchain event with a Basescan link)
1. Owner creates orchestrator (1 AUSD cap, 0.10 per call, expires tonight).
2. Orchestrator spawns 3 searchers at 0.25 each via signed delegations (no gas), searcher-3 search-only.
3. Paid searches/scrapes; bars fill at child and parent.
4. A scraped listing (/listings/sax-42, labeled test fixture) hides an instruction to buy "verification" at /premium-intel, whose payTo is ATTACKER; agent signs; facilitator force-broadcasts; settle reverts PayeeNotAllowed on Basescan; Blocked lane shows it.
5. Same raw signature sent straight to AUSD via /demo/bypass; token rejects it.
6. A searcher hits OverBudget(node).
7. (SHOULD) Owner raises that searcher's cap from the dashboard; it continues.
8. Owner pauses orchestrator; all children blocked with Paused(1).

## Scope
MUST: contract + tests + fork gate, deploy/verify, facilitator, seller (3 routes, Context.dev live), leash-client, orchestrator + 3 sub-agents, dashboard (tree, payments, Blocked lane, pause), injection + bypass + OverBudget + pause demos, DEMO_SCRIPTED, README.
SHOULD (only if on schedule at 3:45): raise-cap step-up button; ElevenLabs TTS prompt for the step-up (POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, header xi-api-key); dashboard deployed to Vercel reading chain.
CUT: ERC-8004, hosted backend services, ZK, Gemini, audit anchoring.

## Asking the user
Ask only for what you cannot obtain: API keys, Base Sepolia ETH funding, Vercel token, GitHub auth if `gh auth status` fails. Batch everything into ONE message at the start with exact env var names. Never block on a missing key: keep building with mocks and wire the key in when it arrives. Ask before irreversible actions only: making the repo public and the final submission (the user submits).
