# Decisions

## D-001 Primary payment path (14:28)
Decision: settle() -> AUSD.transferWithAuthorization(bytes signature overload, 0xcf092995) -> ERC-1271 isValidSignature gated by an EIP-1153 transient approval flag set only inside settle().
Rationale: keeps x402's default eip3009 rail, lets a stateful contract enforce decrementing hierarchical budgets and payee allowlists, and makes the token itself refuse direct-to-token bypass.
Alternatives rejected: view-only ERC-1271 digest rebuild (no running counter, cannot decrement a budget, see x402 issue #2641); MetaMask erc7710 (needs a delegation smart account plus DelegationManager, too much surface for a 3-hour build).
Consequences: requires a Leash-aware facilitator that calls settle(); requires AUSD testnet to support the bytes overload with 1271 fallback (P0 gate). Fallback B if not.
