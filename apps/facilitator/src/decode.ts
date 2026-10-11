import { type Hex, decodeErrorResult, isHex } from "viem";
import { leashWalletAbi } from "@leash/abi";

export type Decoded = { name: string; args: string[]; reason: string };

export const REASONS: Record<string, string> = {
  PayeeNotAllowed: "Recipient is not on this agent's allowlist",
  OverBudget: "Agent budget exhausted",
  OverPerCall: "Payment above this agent's per-call limit",
  Paused: "Agent or a parent is paused",
  Expired: "Allowance expired",
  UnknownAgent: "Signer is not a Leash agent",
  BelowFloor: "Wallet balance would fall below the configured floor",
  TooDeep: "Delegation tree is too deep (max 3 levels)",
  ChildExceedsParent: "Child limits exceed the parent's limits",
  BadDelegation: "Delegation is invalid, expired, replayed or signed by the wrong key",
  KeyInUse: "That key is already used by a Leash node (or is a reserved address)",
  NotAncestor: "Signer is not an ancestor of the target node",
  NotOwner: "Only the wallet owner can do that",
};
export const BYPASS_REASON = "AUSD rejected it: the signature is only valid inside Leash settle()";

function collectHex(err: unknown, seen = new Set<unknown>()): Hex[] {
  const out: Hex[] = [];
  let cur: any = err;
  let depth = 0;
  while (cur && typeof cur === "object" && !seen.has(cur) && depth++ < 12) {
    seen.add(cur);
    if (typeof cur.data === "string" && isHex(cur.data) && cur.data.length >= 10) out.push(cur.data);
    if (cur.data && typeof cur.data === "object" && typeof cur.data.data === "string" && isHex(cur.data.data)) out.push(cur.data.data);
    if (typeof cur.raw === "string" && isHex(cur.raw)) out.push(cur.raw);
    cur = cur.cause;
  }
  return out;
}

/** Decode a LeashWallet custom error out of a viem error (simulate or call). */
export function decodeLeashError(err: unknown): Decoded | undefined {
  // viem ContractFunctionRevertedError already carries decoded data when the abi has the error
  let cur: any = err;
  for (let i = 0; cur && i < 12; i++, cur = cur.cause) {
    const d = cur.data;
    if (d && typeof d === "object" && typeof d.errorName === "string") {
      const args = (d.args ?? []).map((a: unknown) => String(a));
      return { name: d.errorName, args, reason: REASONS[d.errorName] ?? d.errorName };
    }
  }
  for (const data of collectHex(err)) {
    try {
      const r = decodeErrorResult({ abi: leashWalletAbi, data });
      const args = ((r.args as readonly unknown[] | undefined) ?? []).map((a) => String(a));
      return { name: r.errorName, args, reason: REASONS[r.errorName] ?? r.errorName };
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** Best-effort plain message for non-Leash reverts (AUSD errors, RPC failures). */
export function shortMessage(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return (e.shortMessage || e.message || String(err)).split("\n")[0].slice(0, 300);
}

export function unknownDecoded(err: unknown): Decoded {
  return { name: "Unknown", args: [], reason: shortMessage(err) };
}
