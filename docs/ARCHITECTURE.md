# Architecture

This document describes what is in the repository today. For the deployed address and live links, see the [README](../README.md).

## Components

pnpm workspace with these parts:

| Path | What it is |
| --- | --- |
| `contracts/` | Foundry. `src/LeashWallet.sol`, `src/ILeashWallet.sol` (frozen interface), `src/mocks/MockAUSD.sol`, tests in `test/`, `test/fork/`, `test/audit/`, and `script/Deploy.s.sol`, `script/Smoke.s.sol`. |
| `packages/abi/` | Generated ABIs and `deployments/base-sepolia.json` (chain id, AUSD address, LeashWallet address, deploy block, transaction hashes). |
| `packages/leash-client/` | Hand-rolled x402 v2 client. Signs ERC-3009 authorizations with `from = LeashWallet` using a node key. Includes golden-vector tests. |
| `apps/facilitator/` | Express and viem. Endpoints: `GET /supported`, `POST /verify`, `POST /settle`, `GET /events` (SSE), `POST /demo/bypass`, `POST /delegate` (relays `createChild`), `POST /admin/*` (owner actions, guarded by `ADMIN_TOKEN`). |
| `apps/seller/` | Express with a hand-rolled x402 flow. `GET /search`, `GET /scrape`, `GET /listings/sax-42` (labeled test fixture for prompt injection), `GET /premium-intel` (pays to a non-allowlisted payee). |
| `apps/agents/` | Orchestrator and sub-agents using the Anthropic SDK. `DEMO_SCRIPTED` mode replays fixed beats and logs them as `[SCRIPTED]`. Live mode uses `claude-sonnet-5-5`, chosen at boot from `/v1/models`. |
| `apps/dashboard/` | Next.js App Router, Tailwind, viem. Shows the delegation tree with spent and cap bars, the payment log, a blocked lane, and owner controls (pause, unpause, raise cap). |

## Contract state

Each node has: `key`, `parent`, `depth`, `cap`, `spent`, `maxPerCall`, `expiry`, `paused`, `restricted`. Node ids start at 1. Id 0 means "no parent" for the root, and "global" in `PayeeNotAllowed(0)`.

Wallet-wide state:

- `AUSD` and `owner` (immutable).
- `floor`, the minimum balance the wallet must keep after a payment.
- `allowlist[payee]`, the global payee allowlist.
- `nodeAllow[id][payee]`, the per-node allowlist, enforced when a node is `restricted`.
- `nodeOfKey[key]`, the node that owns a signing key.
- `usedDelegation[structHash]`, which blocks replay of `createChild` messages.

Constants: `MAX_DEPTH = 2`, `TWA_TYPEHASH` (the ERC-3009 `TransferWithAuthorization` typehash), `CREATE_CHILD_TYPEHASH`, `PAUSE_CHILD_TYPEHASH`, and `APPROVAL_SALT = keccak256("leash.approval.v1")`.

## Payment path: `settle()`

`settle(to, value, validAfter, validBefore, nonce, signature)` runs under `nonReentrant` (transient reentrancy guard) and does the following:

1. Compute the ERC-3009 struct hash with `from = LeashWallet`, then the EIP-712 digest using AUSD's `DOMAIN_SEPARATOR()`.
2. Recover the signer with OpenZeppelin `ECDSA.recoverCalldata`. Low-s is enforced and malformed signatures revert.
3. Map the signer to a node with `nodeOfKey`. Unknown signers revert `UnknownAgent(signer)`.
4. Check the global allowlist for `to`. Failure reverts `PayeeNotAllowed(0)`.
5. Walk from the signer's node up to the root. At each node, check in order: `paused`, `expiry`, `maxPerCall`, the node allowlist if `restricted`, and the remaining budget (`spent + value <= cap`). Then add `value` to `spent`. Any failure reverts with that node's id.
6. Check that the wallet balance is at least `value + floor`. Failure reverts `BelowFloor()`.
7. Store `1` in transient storage (EIP-1153) at a slot derived from the digest and `APPROVAL_SALT`.
8. Call `AUSD.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature)`, using the bytes-signature overload (selector `0xcf092995`).
9. Clear the transient slot and emit `Paid(id, to, value, nonce)`.

Because every check and the `spent` update happen before step 8, a revert anywhere in the chain leaves no partial charge.

## Approval gate: `isValidSignature`

AUSD calls `isValidSignature(digest, signature)` (ERC-1271) when it verifies the authorization. The wallet returns the magic value `0x1626ba7e` only if:

- `msg.sender` is AUSD, and
- the transient slot for this exact digest is set, which only happens inside `settle()`.

Otherwise it returns `0xffffffff`. The function is `view` and reads transient storage with `TLOAD` only, so it cannot be used to sign permits or other messages outside a `settle()` in progress. A direct call to AUSD with the same authorization fails because the flag is not set.

## Tree management

- **`createRoot(key, cap, maxPerCall, expiry)`**: owner only. Creates a depth-0 node.
- **`createChild(ChildParams, parentSig)`**: anyone can relay. The `CreateChild` EIP-712 message must be signed by the parent node's key and must not be past its `deadline`. The message is single-use (`usedDelegation`). The parent must exist, must not be paused or expired, and the new depth must not exceed `MAX_DEPTH`. The child's limits must fit inside the parent's. The child key goes through key hygiene: not zero, not the owner, not the wallet, and not already a node key. Errors include `BadDelegation`, `Paused`, `Expired`, `TooDeep`, `ChildExceedsParent`, and `KeyInUse`.
- **`pauseChild(target, nonce, deadline, ancestorSig)`**: anyone can relay. The `PauseChild` message must be signed by a strict ancestor's key. Pausing a node pauses its subtree for payments.
- **Owner actions**: `pause`, `unpause`, `raiseCap`, `setAllow`, `setFloor`, `withdraw`. All are `onlyOwner`. Actions on a nonexistent node revert `UnknownAgent(address(0))`.

The interface in `src/ILeashWallet.sol` is frozen. Errors and events are declared there.

## Off-chain flow

1. The orchestrator holds the root key. It creates sub-agent nodes by signing `CreateChild` messages, which the facilitator relays through `POST /delegate`.
2. A sub-agent calls a seller endpoint. The seller answers `402` with the payee, amount, and asset.
3. The client signs an ERC-3009 authorization with the node's key and retries the request with it.
4. The facilitator's `/settle` submits `LeashWallet.settle()`. It does not send the authorization to AUSD.
5. The seller returns the resource once settlement succeeds.
6. The dashboard reads onchain events and the facilitator's SSE stream (`GET /events`). Log queries use chunks of at most 190 blocks starting at the deploy block, because the public RPC rejects larger `eth_getLogs` ranges.

Known gaps in this flow are listed in the README under "Security notes and known limitations".

## Testing

- `contracts/`: 51 unit tests, 5 fork tests against live AUSD on Base Sepolia (`test/fork/*`), and 3 adversarial audit tests (`test/audit/`).
- `packages/leash-client`: golden-vector tests that compare the client's digests with the contract's.
- Gas: `settle()` median 144,059 gas in the fork tests. A live paid call used 144,071 gas.

## Decisions

Design decisions and their rationale are recorded in `DECISIONS.md` in the repository root.
