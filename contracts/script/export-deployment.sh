#!/usr/bin/env bash
# Writes packages/abi/deployments/base-sepolia.json from the latest Deploy.s.sol broadcast.
# Usage (from repo root or anywhere): bash contracts/script/export-deployment.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
run="$here/broadcast/Deploy.s.sol/84532/run-latest.json"
out="$here/../packages/abi/deployments/base-sepolia.json"
[ -f "$run" ] || { echo "no broadcast at $run" >&2; exit 1; }
jq '{
  chainId: 84532,
  ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  leashWallet: ([.transactions[] | select(.transactionType=="CREATE" and .contractName=="LeashWallet") | .contractAddress][0]),
  deployBlock: ([.receipts[] | .blockNumber | (if type == "string" then (ltrimstr("0x") | explode | reduce .[] as $c (0; . * 16 + (if $c >= 97 then $c - 87 elif $c >= 65 then $c - 55 else $c - 48 end))) else . end)] | min),
  txs: {
    deploy:        ([.transactions[] | select(.transactionType=="CREATE")][0].hash),
    setAllowSearch:([.transactions[] | select(.function=="setAllow(address,bool)")][0].hash),
    setAllowScrape:([.transactions[] | select(.function=="setAllow(address,bool)")][1].hash),
    createRoot:    ([.transactions[] | select(.function=="createRoot(address,uint256,uint256,uint256)")][0].hash),
    fund:          ([.transactions[] | select(.function=="transfer(address,uint256)")][0].hash)
  }
}' "$run" > "$out"
cat "$out"
