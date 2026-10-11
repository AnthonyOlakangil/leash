# Shared interfaces (lead, frozen 14:31). Code against these; report any needed change to the lead.

Repo root: /Users/anthonyolakangil/Desktop/leash. Load env with dotenv from the repo-root `.env`.
Contract: contracts/src/ILeashWallet.sol. TS: `@leash/abi` (packages/abi) exports leashWalletAbi, ausdAbi, typed-data
type objects (transferWithAuthorizationTypes, createChildTypes, pauseChildTypes), leashDomain(wallet), deployment.
LeashWallet address: `process.env.LEASH_WALLET || deployment.leashWallet` (empty until P2 ~15:15; handle gracefully).
Live facts (verified 14:30): AUSD decimals 6; eip712Domain = "Agora Dollar","1",84532,AUSD;
DOMAIN_SEPARATOR 0x5a85328c8aae02b57a5bc1fb1848cb2fb9ccbdc204c554a4db199b13fed1e8bb.
All bigint amounts cross HTTP/JSON as decimal strings in atomic units.

## Package names (root scripts use --filter <name>)
@leash/abi (packages/abi), @leash/client (packages/leash-client), facilitator (apps/facilitator, port 4020),
seller (apps/seller, port 4021), agents (apps/agents), dashboard (apps/dashboard, port 3000).
Workspace deps: "@leash/abi": "workspace:*". TS run with tsx (no build step needed for packages; main = src/index.ts).

## @leash/client
```ts
createLeashFetch(opts: { nodePrivateKey: Hex; wallet: Address; rpcUrl: string; forceBroadcast?: boolean })
  => (url: string, init?: RequestInit & { forceBroadcast?: boolean }) => Promise<LeashResult>
type LeashResult = {
  status: number; ok: boolean; data: unknown;                // parsed JSON body (or text)
  price?: { amount: string; payTo: Address; resource: string };
  paid?: { txHash: Hex; payer: Address };                    // from PAYMENT-RESPONSE
  blocked?: { name: string; args: string[]; reason: string; txHash?: Hex };  // decoded LeashWallet error
  authorization?: { from; to; value; validAfter; validBefore; nonce };     // strings
  signature?: Hex;                                           // kept so the bypass demo can replay it
}
buildTransferAuthorization(...) / signTransferAuthorization(...)  // exported typed-data builder (shared with tests)
```
Force broadcast: client sends header `x-leash-force-broadcast: 1` with the PAYMENT-SIGNATURE retry; seller forwards
`forceBroadcast: true` to facilitator /settle and does not stop on a failed /verify.

## Seller (4021) responses
- unpaid: 402 + header PAYMENT-REQUIRED (base64 JSON, x402 v2) and the same object as JSON body.
- paid: 200 + header PAYMENT-RESPONSE (base64 {success, transaction, network, payer}) + JSON result.
- blocked: 402 + JSON body `{ error: "payment_blocked", decoded: { name, args, reason }, txHash? }`.
Routes: GET /search?q=, GET /scrape?url=, GET /listings/sax-42 (free HTML fixture), GET /premium-intel (payTo ATTACKER).

## Facilitator (4020)
- GET /supported, POST /verify {paymentPayload, paymentRequirements}, POST /settle {paymentPayload, paymentRequirements, forceBroadcast?}
  -> {success, transaction?, network, payer?, errorReason?, decoded?: {name,args,reason}}
- POST /delegate
  `{ "type":"createChild", "child":{parentId,key,cap,maxPerCall,expiry,restricted,payees,nonce,deadline}, "signature":"0x.." }`
  `{ "type":"pauseChild", "target", "nonce", "deadline", "signature" }`
  -> `{ ok, txHash?, childId?, error?: {name,args,reason} }`
- POST /admin/createRoot {key,cap,maxPerCall,expiry} | /admin/pause {id} | /admin/unpause {id} | /admin/raiseCap {id,newCap} | /admin/setAllow {payee,allowed}
  header `x-admin-token: $ADMIN_TOKEN` -> `{ ok, txHash?, id?, error? }`
- POST /demo/bypass { authorization, signature } -> `{ ok:false, txHash, reverted:true, reason }`
- GET /events (SSE, `data: <json>\n\n`; replays last 200 from data/events.jsonl on connect). Event shape:
```ts
type LeashEvent = {
  id: string; ts: number;                                     // ms
  kind: "paid" | "blocked" | "bypass" | "delegation" | "admin";
  nodeId?: string; payee?: Address; payeeLabel?: "Search API" | "Scrape API" | "ATTACKER" | string;
  amount?: string;                                            // atomic units
  txHash?: Hex;                                               // present when it reached chain (paid, or broadcast revert)
  error?: { name: string; args: string[]; reason: string };   // reason = plain English (see frontend brief)
  detail?: string;                                            // e.g. "createChild searcher-1 (node 2)", "pause node 1"
  scripted?: boolean;
}
```

## Plain-English reasons (facilitator fills error.reason; dashboard displays)
PayeeNotAllowed "Recipient is not on this agent's allowlist" | OverBudget "Agent budget exhausted" |
OverPerCall "Payment above this agent's per-call limit" | Paused "Agent or a parent is paused" | Expired "Allowance expired" |
UnknownAgent "Signer is not a Leash agent" | bypass "AUSD rejected it: the signature is only valid inside Leash settle()".

## Demo parameters
Root: cap 1.00 AUSD, maxPerCall 0.10, expiry 23:59 PT today. Children: searcher-1/2 cap 0.25 maxPerCall 0.10;
searcher-3 cap 0.25 restricted to [PAYEE_SEARCH]. Global allowlist: PAYEE_SEARCH, PAYEE_SCRAPE. Prices: /search 0.02,
/scrape 0.05, /premium-intel 0.05 (ATTACKER). Basescan: https://sepolia.basescan.org/tx/<hash>.
