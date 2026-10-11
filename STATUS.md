# Status

Phase: P2 (deploy + first real paid call). Updated 14:47 PT. ~25 min ahead of plan.

## Done
- P0 gate PASSED on live AUSD (D-002); fork test 5/5
- P1: 51 unit tests green; ABI exported to packages/abi; golden vectors; council gate 1 passed, no BLOCKERs (D-004)
- Full stack integration on an anvil fork: all 9 scripted beats + one LLM run (D-006)
- LeashWallet deployed + verified on Blockscout: 0xD6a92b451468f1f4decA6Fa27Fd8c367163D653c (deployBlock 47993332)
  - deploy 0x2fdd5b584dd303a394f3e568382bf387f49cc197e7e0546b81363b17c5c0f647
  - createRoot 0x6310ed5271f401cb01de5574fb2a923b3d3c18e6b4cc804008cb73a0dcb02690
  - fund 5 AUSD 0xa40802c355addb40714ce601367568a6bad26784276e2bb95814af3372f4bee8
  - Blockscout: https://base-sepolia.blockscout.com/address/0xD6a92b451468f1f4decA6Fa27Fd8c367163D653c

## In progress
- facilitator-engineer: council SHOULD fixes (force path re-checks requirements, front-run, golden-vector TS test)
- frontend-engineer: feed render bug, 1440x900 fit, node naming

## Next
- First real paid request (402 -> paid -> 200, Paid event) + one decoded block on live chain, push
- P3: pnpm demo live end to end, LLM mode once

## Blockers
- None. ETH: DEPLOYER ~0.000236, RELAYER 0.00015.

## P2 proof (14:45)
- Real paid request: /search 402 -> paid -> 200, Paid event: https://sepolia.basescan.org/tx/0x92f81d12dbfb1308da96788864dcde293b1068f1039352dbdd35cce1ca005048 (gas 144,071)
- Decoded block: /premium-intel -> settle reverted PayeeNotAllowed(0) onchain: https://sepolia.basescan.org/tx/0xf1548f0b1fc7ccb4ec7e4aa437cb12a85d883f9c6a13e507b4114bb3e5a36a16
