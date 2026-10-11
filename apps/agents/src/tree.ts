import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { Env } from "./env.js";
import { type Pc, adminPost, atomic, facPost, getNode, loadOrCreateKeys, nodeIdOfKey, signCreateChild, type Child, type ChildSpec, type DelegationPayload } from "./chain.js";
import { endOfTodayPT, fmt, log, txLink } from "./util.js";

export type Ctx = {
  env: Env;
  pc: Pc;
  decimals: number;
  dry: boolean;
  fresh: boolean;
  root: ReturnType<typeof privateKeyToAccount>;
  rootId: bigint;
  rootExpiry: bigint;
};

export function childSpecs(env: Env, decimals: number): ChildSpec[] {
  const cap = atomic("0.25", decimals);
  const maxPerCall = atomic("0.10", decimals);
  return [
    { name: "searcher-1", cap, maxPerCall, restricted: false, payees: [] },
    { name: "searcher-2", cap, maxPerCall, restricted: false, payees: [] },
    { name: "searcher-3", cap, maxPerCall, restricted: true, payees: [env.payeeSearch] },
  ];
}

export function makeChildren(env: Env, decimals: number, dry: boolean, fresh: boolean): Child[] {
  const specs = childSpecs(env, decimals);
  const keys = loadOrCreateKeys(env.wallet, specs.map((s) => s.name), fresh || dry, !dry);
  return specs.map((spec) => ({ name: spec.name, spec, privateKey: keys[spec.name], account: privateKeyToAccount(keys[spec.name]) }));
}

/** Beat 1 (owner): ensure the root node exists (and is not left paused by a previous run). */
export async function ensureRoot(ctx: Pick<Ctx, "env" | "pc" | "decimals" | "root">): Promise<{ rootId: bigint; rootExpiry: bigint }> {
  const { env, pc, decimals, root } = ctx;
  let id = await nodeIdOfKey(pc, env, root.address);
  if (id === 0n) {
    const expiry = endOfTodayPT();
    log(`owner -> facilitator /admin/createRoot key=${root.address} cap=${fmt(atomic("1.00", decimals), decimals)} maxPerCall=${fmt(atomic("0.10", decimals), decimals)} expiry=${new Date(Number(expiry) * 1000).toISOString()} (23:59 PT today)`);
    const r = await adminPost(env, "/admin/createRoot", { key: root.address, cap: atomic("1.00", decimals), maxPerCall: atomic("0.10", decimals), expiry });
    if (!r.body.ok) throw new Error(`createRoot failed: ${JSON.stringify(r.body.error ?? r.body)}`);
    log(`root created  tx ${txLink(r.body.txHash)}`);
    id = r.body.id ? BigInt(r.body.id) : await nodeIdOfKey(pc, env, root.address);
    if (id === 0n) throw new Error("createRoot reported ok but nodeOfKey(root) is still 0");
  } else {
    log(`root already exists as node ${id}`);
  }
  const node = await getNode(pc, env, id);
  if (node.paused) {
    log(`root node ${id} is paused from a previous run; owner unpauses it`);
    const r = await adminPost(env, "/admin/unpause", { id });
    if (!r.body.ok) throw new Error(`unpause failed: ${JSON.stringify(r.body.error ?? r.body)}`);
    log(`unpaused  tx ${txLink(r.body.txHash)}`);
    // The public RPC is load-balanced; wait until reads reflect the unpause before the facilitator simulates createChild.
    for (let i = 0; i < 15 && (await getNode(pc, env, id)).paused; i++) await new Promise((res) => setTimeout(res, 1000));
    await new Promise((res) => setTimeout(res, 3000));
  }
  return { rootId: id, rootExpiry: node.expiry };
}

/** Beat 2: orchestrator signs CreateChild for each searcher (child expiry = root expiry) and relays via /delegate. */
export async function createChildren(ctx: Ctx, children: Child[]): Promise<void> {
  for (const c of children) {
    const payload = await signCreateChild(ctx.env, ctx.root, ctx.rootId, c, ctx.rootExpiry);
    const { message: _m, ...body } = payload;
    const r = await facPost<{ ok: boolean; txHash?: Hex; childId?: string; error?: unknown }>(ctx.env, "/delegate", body);
    if (!r.body.ok) throw new Error(`delegate ${c.name} failed (HTTP ${r.status}): ${JSON.stringify(r.body.error ?? r.body)}`);
    c.id = r.body.childId ? BigInt(r.body.childId) : await nodeIdOfKey(ctx.pc, ctx.env, c.account.address);
    log(`orchestrator delegated ${c.name} -> node ${c.id} cap=${fmt(c.spec.cap, ctx.decimals)} maxPerCall=${fmt(c.spec.maxPerCall, ctx.decimals)}${c.spec.restricted ? " restricted=[PAYEE_SEARCH]" : ""}  tx ${txLink(r.body.txHash)}`);
  }
}

export async function dryDelegations(ctx: Ctx, children: Child[]): Promise<void> {
  for (const [i, c] of children.entries()) {
    const payload: DelegationPayload & { message?: unknown } = await signCreateChild(ctx.env, ctx.root, ctx.rootId, c, ctx.rootExpiry);
    delete payload.message;
    log(`signed delegation ${c.name} (child address ${c.account.address}, NOT sent):`);
    console.log(JSON.stringify(payload, null, 2).split("\n").map((l) => "    " + l).join("\n"));
  }
}
