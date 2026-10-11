import { formatUnits } from "viem";
export function fmt(v: string | bigint | undefined, decimals: number, max = 4): string {
  if (v === undefined) return "-";
  const s = formatUnits(BigInt(v), decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, max).replace(/0+$/, "").padEnd(2, "0");
  return `${i}.${frac}`;
}
export function short(a?: string) { return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ""; }
export function countdown(expirySec: number, nowMs: number): string {
  let s = Math.floor(expirySec - nowMs / 1000);
  if (s <= 0) return "expired";
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}
export function ago(ts: number, now: number) {
  const d = Math.max(0, Math.floor((now - ts) / 1000));
  return d < 60 ? `${d}s ago` : `${Math.floor(d / 60)}m ago`;
}
export const REASONS: Record<string, string> = {
  PayeeNotAllowed: "Recipient is not on this agent's allowlist",
  OverBudget: "Agent budget exhausted",
  OverPerCall: "Payment above this agent's per-call limit",
  Paused: "Agent or a parent is paused",
  Expired: "Allowance expired",
  UnknownAgent: "Signer is not a Leash agent",
  bypass: "AUSD rejected it: the signature is only valid inside Leash settle()",
};
