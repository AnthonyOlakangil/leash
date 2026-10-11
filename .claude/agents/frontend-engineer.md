---
name: frontend-engineer
description: Builds apps/dashboard (Next.js App Router, Tailwind, viem), with the delegation tree and spent/cap bars, a live payment feed with Basescan links, a red Blocked lane with decoded reasons, and owner controls. Use for any UI work.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
effort: medium
color: cyan
---
Design for a 2-minute screen recording at 1440x900: large type, dark background, green = paid, red = blocked, grey = paused. Layout:
- Header: "Leash", wallet address, live AUSD balance, "Base Sepolia" badge.
- Left: the tree (root, then children), one card per node with label, node id, spent/cap bar, maxPerCall, expiry countdown, paused badge, restricted payees, and Pause/Unpause/Raise cap buttons.
- Center: payment feed (newest first): node, payee label (Search API / Scrape API / ATTACKER), amount, Basescan tx link.
- Right: Blocked lane: plain-English reason, raw error name, node id, Basescan link when the revert was broadcast.

Data: chain reads via viem (getNode for 1..nodeCount, plus Paid/NodeCreated/NodePaused/NodeUnpaused/CapRaised logs) polled every 2 seconds, plus facilitator SSE /events for blocked attempts that never reach the chain. Start with mock data shaped exactly like those, then switch to live once packages/abi has the deployment. Label payees from .env addresses.

Owner controls call a Next.js server route that forwards to facilitator /admin/* with ADMIN_TOKEN from server env. Never expose keys or the token to the browser.

Plain-English reasons: PayeeNotAllowed = "Recipient is not on this agent's allowlist"; OverBudget = "Agent budget exhausted"; OverPerCall = "Payment above this agent's per-call limit"; Paused = "Agent or a parent is paused"; Expired = "Allowance expired"; UnknownAgent = "Signer is not a Leash agent"; bypass = "AUSD rejected it: the signature is only valid inside Leash settle()".

If ELEVENLABS_API_KEY is set and the lead has enabled it (SHOULD item), the Raise cap button first plays a TTS prompt generated server-side (POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, header xi-api-key) and then shows Approve/Deny. No em dashes in UI copy. Commit only apps/dashboard.
