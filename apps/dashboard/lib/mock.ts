import type { ChainLog, ChainState, LeashEvent, UiNode } from "./types";

const U = 1_000_000n; // 6 decimals
const A = {
  search: "0x5eA2c0000000000000000000000000000000A001",
  scrape: "0x5c2a9e0000000000000000000000000000000B002",
  attacker: "0xA77AcC0000000000000000000000000000000dEd",
  wallet: "0x1EA5400000000000000000000000000000001eA5",
};
const LABELS: Record<string, string> = {
  [A.search.toLowerCase()]: "Search API", [A.scrape.toLowerCase()]: "Scrape API", [A.attacker.toLowerCase()]: "ATTACKER",
};
const hex = (n: number) => "0x" + Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const key = (i: number) => `0x${String(i).repeat(40).slice(0, 40)}`;

export function mockInitial(now = Date.now()): { state: ChainState; events: LeashEvent[] } {
  const exp = String(Math.floor(now / 1000) + 5 * 3600);
  const mk = (id: number, parent: number, depth: number, cap: bigint, spent: bigint, restricted = false): UiNode => ({
    id, key: key(id), parent: String(parent), depth: String(depth), cap: String(cap), spent: String(spent),
    maxPerCall: String(U / 10n), expiry: exp, paused: false, restricted,
  });
  const nodes = [mk(1, 0, 0, U, 150_000n), mk(2, 1, 1, U / 4n, 70_000n), mk(3, 1, 1, U / 4n, 50_000n), mk(4, 1, 1, U / 4n, 30_000n, true)];
  const t = (s: number) => now - s * 1000;
  const logs: ChainLog[] = [
    { kind: "NodeCreated", id: "1", parent: "0", key: key(1), cap: String(U), maxPerCall: String(U / 10n), expiry: exp, txHash: hex(64), ts: t(300), logIndex: 0 },
    { kind: "NodeCreated", id: "2", parent: "1", key: key(2), cap: String(U / 4n), maxPerCall: String(U / 10n), expiry: exp, txHash: hex(64), ts: t(280), logIndex: 0 },
    { kind: "NodeCreated", id: "3", parent: "1", key: key(3), cap: String(U / 4n), maxPerCall: String(U / 10n), expiry: exp, txHash: hex(64), ts: t(279), logIndex: 0 },
    { kind: "NodeCreated", id: "4", parent: "1", key: key(4), cap: String(U / 4n), maxPerCall: String(U / 10n), expiry: exp, txHash: hex(64), ts: t(278), logIndex: 0 },
    { kind: "Paid", id: "2", to: A.search, value: "20000", nonce: hex(64), txHash: hex(64), ts: t(120), logIndex: 0 },
    { kind: "Paid", id: "3", to: A.scrape, value: "50000", nonce: hex(64), txHash: hex(64), ts: t(90), logIndex: 0 },
    { kind: "Paid", id: "4", to: A.search, value: "20000", nonce: hex(64), txHash: hex(64), ts: t(60), logIndex: 0 },
  ];
  const events: LeashEvent[] = [
    { id: "m1", ts: t(250), kind: "delegation", detail: "createChild searcher-1 (node 2)" },
    { id: "m2", ts: t(45), kind: "blocked", nodeId: "3", payee: A.attacker, payeeLabel: "ATTACKER", amount: "50000", txHash: hex(64),
      error: { name: "PayeeNotAllowed", args: ["0"], reason: "Recipient is not on this agent's allowlist" } },
    { id: "m3", ts: t(30), kind: "bypass", txHash: hex(64), payee: A.attacker, payeeLabel: "ATTACKER", amount: "50000",
      error: { name: "bypass", args: [], reason: "AUSD rejected it: the signature is only valid inside Leash settle()" } },
    { id: "m4", ts: t(15), kind: "blocked", nodeId: "2", payee: A.search, payeeLabel: "Search API", amount: "20000",
      error: { name: "OverBudget", args: ["2"], reason: "Agent budget exhausted" } },
    { id: "m5", ts: t(8), kind: "blocked", nodeId: "4", payee: A.search, payeeLabel: "Search API", amount: "20000",
      error: { name: "Paused", args: ["1"], reason: "Agent or a parent is paused" } },
  ];
  return { state: { mode: "mock", wallet: A.wallet, decimals: 6, balance: String(5n * U - 150_000n), labels: LABELS, nodes, logs }, events };
}

let seq = 100;
/** Advance the mock one step: mostly payments, sometimes a block. Mutates copies, returns new state. */
export function mockTick(s: ChainState, ev: LeashEvent[], step: number, now = Date.now()): { state: ChainState; events: LeashEvent[] } {
  const nodes = s.nodes.map((n) => ({ ...n }));
  let logs = s.logs; let events = ev; let balance = BigInt(s.balance ?? "0");
  const kids = nodes.filter((n) => n.parent === "1");
  const n = kids[step % kids.length];
  const scrape = step % 3 === 0 && !n.restricted;
  const price = scrape ? 50_000n : 20_000n;
  const to = scrape ? A.scrape : A.search;
  const label = scrape ? "Scrape API" : "Search API";
  const root = nodes[0];
  const full = BigInt(n.spent) + price > BigInt(n.cap);
  const rootFull = BigInt(root.spent) + price > BigInt(root.cap);
  if (step % 7 === 6) {
    events = [...events, { id: `m${seq++}`, ts: now, kind: "blocked", nodeId: n.id.toString(), payee: A.attacker, payeeLabel: "ATTACKER", amount: "50000", txHash: hex(64),
      error: { name: "PayeeNotAllowed", args: ["0"], reason: "Recipient is not on this agent's allowlist" } }];
  } else if (root.paused || n.paused) {
    events = [...events, { id: `m${seq++}`, ts: now, kind: "blocked", nodeId: String(n.id), payee: to, payeeLabel: label, amount: String(price),
      error: { name: "Paused", args: [root.paused ? "1" : String(n.id)], reason: "Agent or a parent is paused" } }];
  } else if (full || rootFull) {
    const who = full ? n.id : 1;
    events = [...events, { id: `m${seq++}`, ts: now, kind: "blocked", nodeId: String(n.id), payee: to, payeeLabel: label, amount: String(price),
      error: { name: "OverBudget", args: [String(who)], reason: "Agent budget exhausted" } }];
  } else {
    n.spent = String(BigInt(n.spent) + price); root.spent = String(BigInt(root.spent) + price); balance -= price;
    logs = [...logs, { kind: "Paid", id: String(n.id), to, value: String(price), nonce: hex(64), txHash: hex(64), ts: now, logIndex: 0 }];
  }
  return { state: { ...s, nodes, logs: logs.slice(-300), balance: String(balance) }, events: events.slice(-200) };
}

/** Mock owner actions, so the buttons work in mock mode too. */
export function mockAdmin(s: ChainState, action: string, id: number, newCap?: string, now = Date.now()): ChainState {
  const nodes = s.nodes.map((n) => ({ ...n }));
  const n = nodes.find((x) => x.id === id)!;
  let log: ChainLog;
  if (action === "pause") { n.paused = true; log = { kind: "NodePaused", id: String(id), by: s.wallet ?? "", txHash: hex(64), ts: now, logIndex: 0 }; }
  else if (action === "unpause") { n.paused = false; log = { kind: "NodeUnpaused", id: String(id), txHash: hex(64), ts: now, logIndex: 0 }; }
  else { const old = n.cap; n.cap = newCap!; log = { kind: "CapRaised", id: String(id), oldCap: old, newCap: newCap!, txHash: hex(64), ts: now, logIndex: 0 }; }
  return { ...s, nodes, logs: [...s.logs, log] };
}
