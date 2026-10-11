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
