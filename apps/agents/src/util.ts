import { formatUnits, type Hex } from "viem";

export const BASESCAN_TX = "https://sepolia.basescan.org/tx/";

let prefix = "";
export function setPrefix(p: string) {
  prefix = p;
}
export function log(line: string) {
  console.log(prefix ? `${prefix} ${line}` : line);
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fmt(units: bigint | string, decimals: number): string {
  return `${formatUnits(BigInt(units), decimals)} AUSD`;
}
export function txLink(h?: Hex | string): string {
  return h ? `${BASESCAN_TX}${h}` : "(no tx)";
}
export function randomUint256(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return BigInt("0x" + Buffer.from(b).toString("hex"));
}
export function nowSec(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/** Unix seconds for 23:59:00 today in America/Los_Angeles. */
export function endOfTodayPT(now = new Date()): bigint {
  const tz = "America/Los_Angeles";
  const parts = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
        .formatToParts(d)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
  const p = parts(now);
  const guess = Date.UTC(p.year, p.month - 1, p.day, 23, 59, 0);
  const g = parts(new Date(guess));
  const asUtc = Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute, g.second);
  const offset = asUtc - guess; // local wall clock minus UTC at that instant
  return BigInt(Math.floor((guess - offset) / 1000));
}

export function jsonSafe(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}
