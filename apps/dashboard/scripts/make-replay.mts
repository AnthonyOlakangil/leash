// Usage: tsx scripts/make-replay.mts <wallet> <deployBlock> <events.jsonl> lib/replay-data.json
// Builds the replay recording for one real run: chain logs + node info from Base Sepolia, facilitator events from the archive.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { leashWalletAbi, ausdAbi, AUSD_ADDRESS } from "@leash/abi";

const [wallet, deployBlockStr, eventsFile, outFile] = process.argv.slice(2) as [Address, string, string, string];
const pc = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const deployBlock = BigInt(deployBlockStr);
const events = readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const lastTs = Math.max(...events.map((e: any) => e.ts));
const head = await pc.getBlockNumber();
const logs: any[] = [];
const tsCache = new Map<bigint, number>();
for (let from = deployBlock; from <= head; from += 190n) {
  const to = from + 189n < head ? from + 189n : head;
  const chunk = await pc.getContractEvents({ address: wallet, abi: leashWalletAbi, fromBlock: from, toBlock: to });
  for (const l of chunk as any[]) {
    if (!tsCache.has(l.blockNumber)) tsCache.set(l.blockNumber, Number((await pc.getBlock({ blockNumber: l.blockNumber })).timestamp) * 1000);
    const a = l.args ?? {};
    const base = { txHash: l.transactionHash, ts: tsCache.get(l.blockNumber)!, logIndex: l.logIndex };
    if (l.eventName === "Paid") logs.push({ kind: "Paid", id: String(a.id), to: a.to, value: String(a.value), nonce: a.nonce, ...base });
    else if (l.eventName === "NodeCreated") logs.push({ kind: "NodeCreated", id: String(a.id), parent: String(a.parent), key: a.key, cap: String(a.cap), maxPerCall: String(a.maxPerCall), expiry: String(a.expiry), ...base });
    else if (l.eventName === "NodePaused") logs.push({ kind: "NodePaused", id: String(a.id), by: a.by, ...base });
    else if (l.eventName === "NodeUnpaused") logs.push({ kind: "NodeUnpaused", id: String(a.id), ...base });
    else if (l.eventName === "CapRaised") logs.push({ kind: "CapRaised", id: String(a.id), oldCap: String(a.oldCap), newCap: String(a.newCap), ...base });
  }
  if (logs.length && tsCache.size && Math.max(...tsCache.values()) > lastTs + 120_000) break;
}
const count = Number(await pc.readContract({ address: wallet, abi: leashWalletAbi, functionName: "nodeCount" }));
const nodes = [];
for (let id = 1; id <= count; id++) {
  const n: any = await pc.readContract({ address: wallet, abi: leashWalletAbi, functionName: "getNode", args: [BigInt(id)] });
  nodes.push({ id, key: n.key, parent: String(n.parent), depth: String(n.depth), maxPerCall: String(n.maxPerCall), expiry: String(n.expiry), restricted: n.restricted });
}
const decimals = Number(await pc.readContract({ address: AUSD_ADDRESS, abi: ausdAbi, functionName: "decimals" }));
const labels: Record<string, string> = {};
for (const e of events) if (e.payee && e.payeeLabel) labels[e.payee.toLowerCase()] = e.payeeLabel;
const evTx = new Set(events.map((e: any) => e.txHash).filter(Boolean));
const orphan = logs.filter((l) => !evTx.has(l.txHash));
const out = { wallet, deployBlock: Number(deployBlock), decimals, startBalance: String(5n * 10n ** BigInt(decimals)), labels, nodes, logs, events };
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`nodes=${nodes.length} logs=${logs.length} events=${events.length} chainLogsWithoutEvent=${orphan.length} labels=${Object.values(labels).join(",")}`);
