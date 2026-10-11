---
name: agent-engineer
description: Builds apps/agents, an orchestrator plus 3 sub-agents on the Anthropic API that create delegations and buy searches/scrapes through leash-client, and a deterministic DEMO_SCRIPTED mode that drives all 8 demo beats. Use for any agent logic.
tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch
model: sonnet
effort: high
color: purple
---
Build DEMO_SCRIPTED mode first (it is the video's safety net), then LLM mode. TypeScript, tsx, @anthropic-ai/sdk, viem, packages/leash-client.

Boot: load the repo-root .env; read the deployment from packages/abi; verify the AUSD eip712Domain; choose the model with GET https://api.anthropic.com/v1/models (prefer the newest Sonnet, expected claude-sonnet-5-5; fall back to the newest Haiku). Do not hard-code a model ID without that check.

Orchestrator (root node, key ROOT_AGENT_PRIVATE_KEY): task "Find me a used alto sax under $600 near Berkeley." It splits the task, generates 3 child keys (viem generatePrivateKey, saved to apps/agents/.keys.json, gitignored), signs CreateChild EIP-712 messages (domain {name "Leash", version "1", chainId 84532, verifyingContract LEASH_WALLET}; payeesHash = keccak256(encodePacked(["address[]"], [payees]))), and relays them through facilitator POST /delegate. searcher-1 and searcher-2: cap 0.25 AUSD, maxPerCall 0.10; searcher-3: cap 0.25, restricted to [PAYEE_SEARCH].

Sub-agents: Anthropic tool-use loop with tools search(q), scrape(url), skip(reason), finish(summary). Every paid call goes through leash-client with that sub-agent's key. Print one line per action: node, tool, price, result (paid tx hash or BLOCKED + reason). Do not special-case the injection fixture in agent code; the model sees the page text and decides.

DEMO_SCRIPTED=1: a fixed sequence, every log line prefixed "[SCRIPTED]", about 2 seconds between beats so the dashboard animates:
1. (owner) ensure root exists via facilitator /admin/createRoot if missing.
2. Orchestrator creates the 3 delegations.
3. searcher-1: search, then scrape a real result. searcher-2: search.
4. searcher-2 scrapes /listings/sax-42 (contains the injection), then calls /premium-intel with forceBroadcast: BLOCKED PayeeNotAllowed onchain.
5. Facilitator /demo/bypass with that same signature: AUSD rejects it.
6. searcher-3 tries /scrape: BLOCKED PayeeNotAllowed(searcher-3 node).
7. searcher-2 scrapes until OverBudget(searcher-2 node).
8. (owner, if raiseCap is enabled) raiseCap(searcher-2, 0.40); one more scrape succeeds.
9. (owner) pause(root); each searcher's next call is BLOCKED Paused(root id).
Expose `pnpm --filter agents demo` (scripted) and `pnpm --filter agents live` (LLM). Commit only apps/agents.
