import { createPublicClient, http, keccak256, encodePacked, type Address, type Hex, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { leashWalletAbi, ausdAbi, createChildTypes, leashDomain, AUSD_DOMAIN_NAME, AUSD_DOMAIN_VERSION, CHAIN_ID } from "@leash/abi";
import type { Env } from "./env.js";
import { KEYS_FILE } from "./env.js";
import { jsonSafe, nowSec, randomUint256 } from "./util.js";

export type ChildSpec = { name: string; cap: bigint; maxPerCall: bigint; restricted: boolean; payees: Address[] };
export type Child = { name: string; privateKey: Hex; account: PrivateKeyAccount; spec: ChildSpec; id?: bigint };
export type DelegationPayload = {
  type: "createChild";
  child: Record<string, string | boolean | string[]>;
  signature: Hex;
};

export function publicClient(env: Env) {
  return createPublicClient({ chain: baseSepolia, transport: http(env.rpcUrl) });
}
export type Pc = ReturnType<typeof publicClient>;

/** Boot check: AUSD eip712Domain must be "Agora Dollar"/"1"/84532; returns token decimals (read, never assumed). */
export async function bootChecks(env: Env, pc: Pc): Promise<{ decimals: number }> {
  const d = await pc.readContract({ address: env.ausd, abi: ausdAbi, functionName: "eip712Domain" });
  const [, name, version, chainId, verifying] = d as readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];
  if (name !== AUSD_DOMAIN_NAME || version !== AUSD_DOMAIN_VERSION || Number(chainId) !== CHAIN_ID || verifying.toLowerCase() !== env.ausd.toLowerCase()) {
    throw new Error(`AUSD eip712Domain mismatch: got ${name}/${version}/${chainId}/${verifying}`);
  }
  const decimals = Number(await pc.readContract({ address: env.ausd, abi: ausdAbi, functionName: "decimals" }));
  const code = await pc.getCode({ address: env.wallet });
  if (!code || code === "0x") throw new Error(`No contract code at LEASH_WALLET ${env.wallet} on Base Sepolia`);
  return { decimals };
}

export function atomic(amount: string, decimals: number): bigint {
  const [i, f = ""] = amount.split(".");
  return BigInt(i + f.padEnd(decimals, "0").slice(0, decimals));
}

export const payeesHash = (payees: Address[]): Hex => keccak256(encodePacked(["address[]"], [payees]));

export async function signCreateChild(env: Env, parent: PrivateKeyAccount, parentId: bigint, c: Child, expiry: bigint): Promise<DelegationPayload & { message: Record<string, string> }> {
  const nonce = randomUint256();
  const deadline = nowSec() + 600n;
  const message = {
    parentId,
    key: c.account.address,
    cap: c.spec.cap,
    maxPerCall: c.spec.maxPerCall,
    expiry,
    restricted: c.spec.restricted,
    payeesHash: payeesHash(c.spec.payees),
    nonce,
    deadline,
  };
  const signature = await parent.signTypedData({
    domain: leashDomain(env.wallet),
    types: createChildTypes,
    primaryType: "CreateChild",
    message,
  });
  return {
    type: "createChild",
    child: {
      parentId: parentId.toString(),
      key: c.account.address,
      cap: c.spec.cap.toString(),
      maxPerCall: c.spec.maxPerCall.toString(),
      expiry: expiry.toString(),
      restricted: c.spec.restricted,
      payees: c.spec.payees,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    },
    signature,
    message: jsonSafe({ ...message, payeesHash: message.payeesHash }) as Record<string, string>,
  };
}

export type FacResp<T = Record<string, unknown>> = { status: number; body: T };
export async function facPost<T = Record<string, any>>(env: Env, path: string, body: unknown, admin = false): Promise<FacResp<T>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (admin) headers["x-admin-token"] = env.adminToken;
  let res: Response;
  try {
    res = await fetch(env.facilitatorUrl + path, { method: "POST", headers, body: JSON.stringify(jsonSafe(body)) });
  } catch (e) {
    throw new Error(`Facilitator unreachable at ${env.facilitatorUrl}${path}: ${(e as Error).message}`);
  }
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed as T };
}

export const adminPost = (env: Env, path: string, body: unknown) => facPost<{ ok: boolean; txHash?: Hex; id?: string; error?: any }>(env, path, body, true);

/** Persistent child keys. Bound to the wallet so a redeploy never reuses used keys. */
export function loadOrCreateKeys(wallet: Address, names: string[], fresh: boolean, persist: boolean): Record<string, Hex> {
  if (!fresh && existsSync(KEYS_FILE)) {
    try {
      const j = JSON.parse(readFileSync(KEYS_FILE, "utf8"));
      if (j.wallet?.toLowerCase() === wallet.toLowerCase() && names.every((n) => j.keys?.[n])) return j.keys;
    } catch {}
  }
  const keys = Object.fromEntries(names.map((n) => [n, generatePrivateKey()])) as Record<string, Hex>;
  if (persist) writeFileSync(KEYS_FILE, JSON.stringify({ wallet, keys }, null, 2), { mode: 0o600 });
  return keys;
}

export async function nodeIdOfKey(pc: Pc, env: Env, key: Address): Promise<bigint> {
  return (await pc.readContract({ address: env.wallet, abi: leashWalletAbi, functionName: "nodeOfKey", args: [key] })) as bigint;
}
export async function getNode(pc: Pc, env: Env, id: bigint) {
  return (await pc.readContract({ address: env.wallet, abi: leashWalletAbi, functionName: "getNode", args: [id] })) as {
    key: Address; parent: bigint; depth: bigint; cap: bigint; spent: bigint; maxPerCall: bigint; expiry: bigint; paused: boolean; restricted: boolean;
  };
}
