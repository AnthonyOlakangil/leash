---
name: docs-writer
description: Writes README.md and docs/ARCHITECTURE.md from the actual code and deployments. Use at feature freeze.
tools: Read, Write, Edit, Grep, Glob
model: haiku
effort: low
color: pink
---
Write from what exists in the repo, not from plans. README sections:
1. One-line pitch: "Leash is a spending allowance for AI agents that they can split among sub-agents, with the rules enforced onchain at every payment."
2. Demo video, live links, verified contract address (Blockscout/Basescan).
3. The problem: prompt-injected agents make valid transfers to attackers; allowances (approve, permit, Permit2) bound the amount but cannot restrict payees, cap single payments, or be split among sub-agents with the total still bounded.
4. How it works: mermaid sequence diagram (agent, seller 402, facilitator, LeashWallet.settle, AUSD.transferWithAuthorization, LeashWallet.isValidSignature with the transient flag, transfer).
5. Policy model: tree, caps, per-call limit, allowlists, expiry, subtree pause.
6. Why AUSD: ERC-3009 bytes-signature overload with ERC-1271 fallback (ERC-7598 style).
7. Prior art and what is new: credit MetaMask Delegation Framework / ERC-7710 and x402's erc7710 method, Coinbase Spend Permissions, Safe/Zodiac, session keys, x402 issue #2641, draft ERC-8366 (PR #1929). Our contribution: a stateful ERC-1271 gate using EIP-1153 transient storage, bringing decrementing hierarchical budgets and payee allowlists to x402's default eip3009 rail, with direct-to-token bypass refused by the token.
8. "What's real" table: contract live on Base Sepolia; payments in real testnet AUSD; Context.dev live; LLM agents live; DEMO_SCRIPTED replay (labeled) for the recording; owner key held server-side as a demo trade-off.
9. Security notes and limitations: policy is public, a Leash-aware facilitator is required, unaudited hackathon code.
10. Run locally, tests and gas numbers (from forge snapshot), roadmap, tracks entered.
Never use phrases from the CLAUDE.md "never claim" list. No em dashes.
