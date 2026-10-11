# Leash: submission

**Title:** Leash

**Tagline:** A spending allowance for AI agents that they can split among sub-agents, with the rules enforced onchain at every payment.

**Description (~150 words):**
AI agents now pay for APIs on their own, and the scary failure is a prompt injection that sends money to an attacker in a perfectly valid transfer. Leash is a LeashWallet contract on Base Sepolia that holds AUSD for a tree of agents. The owner gives an orchestrator an allowance; the orchestrator splits it among sub-agents with signed delegations, no gas. Every x402 payment goes through `settle()`, which checks payee allowlists, per-call limits, expiry, pause, and the budget of every ancestor, then calls AUSD's ERC-3009 `transferWithAuthorization`. AUSD asks the wallet through ERC-1271, and the wallet answers yes only inside its own `settle()`, using an EIP-1153 transient flag. So the agent can sign anything, the chain refuses what is outside the policy, and replaying the signature straight to AUSD fails too. Demo: a scripted, labeled run where an injected listing tries to pay an attacker and is blocked onchain; LLM agents (Claude) and Context.dev search run live.

**Tracks to tick:** Most Technically Impressive, Best Use of AUSD, YZi Labs, Context.dev

**GitHub:** https://github.com/AnthonyOlakangil/leash

**Live link:** https://leash-dashboard-rho.vercel.app (read-only chain view; the full demo runs locally). Contract live and verified on Base Sepolia: https://base-sepolia.blockscout.com/address/0xD6a92b451468f1f4decA6Fa27Fd8c367163D653c#code (demo recording wallet: https://base-sepolia.blockscout.com/address/0xf7c239E1AeB8C418557349561572Ef42D3933B02#code)

**YouTube URL:** 
