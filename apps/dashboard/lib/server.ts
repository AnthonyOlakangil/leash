import { createPublicClient, http, erc20Abi, type Address, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { leashWalletAbi, deployment } from "@leash/abi";
import type { ChainLog, ChainState, UiNode } from "./types";

export function walletAddress(): Address | undefined {
  const a = process.env.NEXT_PUBLIC_LEASH_WALLET || process.env.LEASH_WALLET || (deployment as any).leashWallet;
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Address) : undefined;
}
export function payeeLabels(): Record<string, string> {
  const m: Record<string, string> = {};
  const add = (v: string | undefined, l: string) => { if (v) m[v.toLowerCase()] = l; };
  add(process.env.PAYEE_SEARCH_ADDRESS, "Search API");
  add(process.env.PAYEE_SCRAPE_ADDRESS, "Scrape API");
  add(process.env.ATTACKER_ADDRESS, "ATTACKER");
  return m;
}
export const facilitatorUrl = () => process.env.FACILITATOR_URL || "http://localhost:4020";

let client: PublicClient | undefined;
function pc() {
  return (client ??= createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
  }) as PublicClient);
}

// Log cache lives in the server process so each poll only fetches new blocks.
const cache = { logs: new Map<string, ChainLog>(), next: 0n, ts: new Map<bigint, number>(), decimals: undefined as number | undefined };

async function blockTs(n: bigint) {
  let t = cache.ts.get(n);
  if (t === undefined) {
    const b = await pc().getBlock({ blockNumber: n });
    t = Number(b.timestamp) * 1000;
    cache.ts.set(n, t);
  }
  return t;
}

const LOG_CHUNK = 190n;

async function syncLogs(wallet: Address) {
  const c = pc();
  const latest = await c.getBlockNumber();
  if (cache.next === 0n) {
    const dep = BigInt((deployment as any).deployBlock || 0);
    cache.next = dep > 0n ? dep : latest > 1500n ? latest - 1500n : 0n;
  }
  while (cache.next <= latest) {
    // Public Base Sepolia RPC caps eth_getLogs at a 200-block range.
    const to = cache.next + LOG_CHUNK < latest ? cache.next + LOG_CHUNK : latest;
    const logs = await c.getContractEvents({ address: wallet, abi: leashWalletAbi, fromBlock: cache.next, toBlock: to });
    for (const l of logs as any[]) {
      const a = l.args ?? {};
      const base = { txHash: l.transactionHash, ts: await blockTs(l.blockNumber), logIndex: l.logIndex };
      let e: ChainLog | undefined;
      switch (l.eventName) {
        case "Paid": e = { kind: "Paid", id: String(a.id), to: a.to, value: String(a.value), nonce: a.nonce, ...base }; break;
        case "NodeCreated": e = { kind: "NodeCreated", id: String(a.id), parent: String(a.parent), key: a.key, cap: String(a.cap), maxPerCall: String(a.maxPerCall), expiry: String(a.expiry), ...base }; break;
        case "NodePaused": e = { kind: "NodePaused", id: String(a.id), by: a.by, ...base }; break;
        case "NodeUnpaused": e = { kind: "NodeUnpaused", id: String(a.id), ...base }; break;
        case "CapRaised": e = { kind: "CapRaised", id: String(a.id), oldCap: String(a.oldCap), newCap: String(a.newCap), ...base }; break;
      }
      if (e) cache.logs.set(`${l.transactionHash}:${l.logIndex}`, e);
    }
    cache.next = to + 1n;
  }
}

export async function readState(wallet: Address): Promise<ChainState> {
  const c = pc();
  const ausd = ((await c.readContract({ address: wallet, abi: leashWalletAbi, functionName: "AUSD" })) as Address);
  cache.decimals ??= Number(await c.readContract({ address: ausd, abi: erc20Abi, functionName: "decimals" }));
  const [count, balance] = await Promise.all([
    c.readContract({ address: wallet, abi: leashWalletAbi, functionName: "nodeCount" }) as Promise<bigint>,
    c.readContract({ address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
  ]);
  const nodes: UiNode[] = await Promise.all(
    Array.from({ length: Number(count) }, (_, i) => i + 1).map(async (id) => {
      const n = (await c.readContract({ address: wallet, abi: leashWalletAbi, functionName: "getNode", args: [BigInt(id)] })) as any;
      return {
        id, key: n.key, parent: String(n.parent), depth: String(n.depth), cap: String(n.cap), spent: String(n.spent),
        maxPerCall: String(n.maxPerCall), expiry: String(n.expiry), paused: n.paused, restricted: n.restricted,
      };
    }),
  );
  await syncLogs(wallet);
  const logs = [...cache.logs.values()].sort((a, b) => a.ts - b.ts || a.logIndex - b.logIndex).slice(-300);
  return { mode: "live", wallet, decimals: cache.decimals, balance: String(balance), labels: payeeLabels(), nodes, logs };
}
