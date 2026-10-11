# Status

Phase: P1 (contract tests, ABI export, services). Updated 14:36 PT. On schedule.

## Done
- Kit, git, pnpm workspace, private repo AnthonyOlakangil/leash-build (empty public `leash` repo exists; untouched)
- Tooling: node 26, pnpm 12, foundry; Agora MCP added
- P0 gate PASSED on live AUSD (D-002): cf092995 present, pause bits off, domain "Agora Dollar"/"1"/84532, decimals 6; fork test 5/5; settle gas ~144k
- Frozen interface: contracts/src/ILeashWallet.sol, docs/INTERFACES.md, @leash/abi
- DEPLOYER holds 10,000 AUSD (faucet tx 0x996244139de7f84c1086d814013ec0a0369d5ed358372677b7dca6eeec312a05); RELAYER funded 0.00015 ETH (tx 0x941d30ed44d6502c1510065ce48b55b29bb1eac8b0a021bfbc7ae8145486fa8e)

## In progress
- solidity-engineer: unit tests, ABI export, Deploy.s.sol (due 15:05)
- facilitator-engineer: leash-client, facilitator, seller (due 15:10)
- frontend-engineer: dashboard (mock first, due 15:15)
- agent-engineer: agents, DEMO_SCRIPTED first (due 15:15)

## Blockers
- None. ETH is thin (DEPLOYER ~0.00025, RELAYER 0.00015); optional top-up requested. ELEVENLABS key empty (SHOULD item only).

## Next
- 15:05 council gate 1 (protocol-auditor), 15:10 P2 deploy

## Addresses
- AUSD 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC (Base Sepolia)
- DEPLOYER 0xd6B7A3469b12be5E93c244a36f73deE7f31fdFdc, RELAYER 0x3138FD3BeB2Bb4c604F5282D73891e6cd40671cB
- LeashWallet: not deployed
