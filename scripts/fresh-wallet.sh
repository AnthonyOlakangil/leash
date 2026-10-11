#!/usr/bin/env bash
# Deploy a fresh LeashWallet for a clean demo recording: allowlist the two payees, fund 5 AUSD,
# but do NOT create the root (beat 1 of the demo creates it on camera).
# Updates LEASH_WALLET in .env and packages/abi/deployments/base-sepolia.json, archives facilitator events.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
set -a; source .env; set +a
R="$BASE_SEPOLIA_RPC_URL"
if [ -n "${RESUME_WALLET:-}" ] && [ -n "${RESUME_DEPLOY_TX:-}" ]; then
  W="$RESUME_WALLET"; DEPLOY_TX="$RESUME_DEPLOY_TX"   # resume after a partial run
else
  cd contracts
  OUT=$(forge create src/LeashWallet.sol:LeashWallet --rpc-url "$R" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
    --constructor-args "$AUSD_ADDRESS" "$DEPLOYER_ADDRESS")
  W=$(echo "$OUT" | awk '/Deployed to:/ {print $3}')
  DEPLOY_TX=$(echo "$OUT" | awk '/Transaction hash:/ {print $3}')
  cd "$ROOT"
fi
[ -n "$W" ] || { echo "deploy failed"; exit 1; }
BLOCK=$(cast receipt "$DEPLOY_TX" blockNumber --rpc-url "$R")
# Explicit nonces: the public RPC is load-balanced and can hand back a stale nonce right after a mined tx.
NONCE=$(cast nonce "$DEPLOYER_ADDRESS" --block pending --rpc-url "$R")
send() {
  local out; out=$(cast send "$@" --nonce "$NONCE" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R")
  NONCE=$((NONCE + 1))
  echo "$out" | grep -qE '^status +1' || { echo "tx failed: $*" >&2; exit 1; }
  LAST_TX=$(echo "$out" | awk '/^transactionHash/ {print $2}')
}
send "$W" "setAllow(address,bool)" "$PAYEE_SEARCH_ADDRESS" true; A1=$LAST_TX
send "$W" "setAllow(address,bool)" "$PAYEE_SCRAPE_ADDRESS" true; A2=$LAST_TX
send "$AUSD_ADDRESS" "transfer(address,uint256)" "$W" 5000000; F=$LAST_TX
sed -i '' "s|^LEASH_WALLET=.*|LEASH_WALLET=$W|" .env
cat > packages/abi/deployments/base-sepolia.json <<JSON
{
  "chainId": 84532,
  "ausd": "$AUSD_ADDRESS",
  "leashWallet": "$W",
  "deployBlock": $BLOCK,
  "txs": {
    "deploy": "$DEPLOY_TX",
    "setAllowSearch": "$A1",
    "setAllowScrape": "$A2",
    "fund": "$F"
  }
}
JSON
mkdir -p data/archive
[ -f data/events.jsonl ] && mv data/events.jsonl "data/archive/events.$(date +%H%M%S).jsonl" || true
rm -f apps/agents/.keys.json
echo "fresh LeashWallet $W (block $BLOCK), funded 5 AUSD, payees allowlisted, no root yet"
echo "verify: cd contracts && forge verify-contract $W src/LeashWallet.sol:LeashWallet --chain 84532 --verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/ --constructor-args \$(cast abi-encode 'constructor(address,address)' $AUSD_ADDRESS $DEPLOYER_ADDRESS)"
