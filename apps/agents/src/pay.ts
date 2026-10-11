import { createLeashFetch, type LeashResult } from "@leash/client";
import type { Env } from "./env.js";
import type { Child } from "./chain.js";
import { fmt, log, txLink } from "./util.js";

export type Actor = {
  name: string;
  nodeId: bigint;
  fetch: ReturnType<typeof createLeashFetch>;
};

export function makeActor(env: Env, c: Child, forceBroadcast = false): Actor {
  if (c.id === undefined) throw new Error(`${c.name} has no node id yet`);
  return {
    name: c.name,
    nodeId: c.id,
    fetch: createLeashFetch({ nodePrivateKey: c.privateKey, wallet: env.wallet, rpcUrl: env.rpcUrl, forceBroadcast }),
  };
}

export function describe(r: LeashResult, decimals: number): string {
  const price = r.price ? fmt(r.price.amount, decimals) : "free";
  if (r.paid) return `${price}  PAID  tx ${txLink(r.paid.txHash)}`;
  if (r.blocked) {
    const args = r.blocked.args.length ? `(${r.blocked.args.join(",")})` : "";
    return `${price}  BLOCKED ${r.blocked.name}${args}: ${r.blocked.reason}${r.blocked.txHash ? `  tx ${txLink(r.blocked.txHash)}` : "  (rejected off-chain)"}`;
  }
  if (r.ok) return `${price}  ok (HTTP ${r.status}, no payment)`;
  return `${price}  FAILED HTTP ${r.status}: ${String(typeof r.data === "string" ? r.data : JSON.stringify(r.data)).slice(0, 200)}`;
}

/** One paid (or attempted) call, logged as: node, tool, price, result. */
export async function call(
  actor: Actor,
  tool: string,
  url: string,
  decimals: number,
  init?: { forceBroadcast?: boolean },
): Promise<LeashResult> {
  const r = await actor.fetch(url, init);
  log(`${actor.name} (node ${actor.nodeId})  ${tool.padEnd(13)} ${describe(r, decimals)}`);
  return r;
}
