// Replay of one real recorded run (lib/replay-data.json, built by scripts/make-replay.mts).
// Nothing here talks to the chain or signs anything: it re-derives the dashboard state from the
// recorded onchain logs and facilitator events, revealing them on a compressed clock.
import data from "./replay-data.json";
import type { ChainLog, ChainState, LeashEvent, UiNode } from "./types";

export const REPLAY_WALLET = data.wallet;

export const BEAT_TITLES = [
  "Owner creates the orchestrator: 1.00 AUSD cap, 0.10 per call, expires tonight",
  "Orchestrator delegates 0.25 to each of 3 searchers with signed delegations; searcher-3 is search-only",
  "Searchers pay for search and scrape calls over x402; spend counts at the agent and its parent",
  "A scraped listing hides an instruction to pay an attacker; settle() reverts PayeeNotAllowed onchain",
  "The same signature is sent straight to AUSD; the token rejects it outside Leash settle()",
  "searcher-3 tries to pay the scrape API; its own allowlist blocks it",
  "searcher-2 keeps scraping until its 0.25 budget runs out: OverBudget",
  "Owner raises searcher-2's cap to 0.40; its next call goes through",
  "Owner pauses the orchestrator; every agent below it is blocked",
];

type Step = { at: number; beat: number; ev: LeashEvent };

const events = (data.events as LeashEvent[]).slice().sort((a, b) => a.ts - b.ts);
const logs = data.logs as ChainLog[];

/** Beat of each recorded event, from the order the scripted demo runs its beats. */
function beatsOf(evs: LeashEvent[]): number[] {
  const out: number[] = [];
  let b = 1;
  for (const e of evs) {
    const err = e.error?.name;
    if (e.kind === "admin" && e.detail?.startsWith("createRoot")) b = 1;
    else if (e.kind === "delegation") b = 2;
    else if (e.kind === "blocked" && err === "PayeeNotAllowed" && e.error?.args?.[0] === "0") b = 4;
    else if (e.kind === "bypass") b = 5;
    else if (e.kind === "blocked" && err === "PayeeNotAllowed") b = 6;
    else if (e.kind === "admin" && e.detail?.startsWith("raiseCap")) b = 8;
    else if (e.kind === "admin" && e.detail?.startsWith("pause")) b = 9;
    else if (e.kind === "paid") b = b < 3 ? 3 : b >= 4 && b <= 6 ? 7 : b;
    out.push(b);
  }
  // The listing scrape that precedes the attacker payment opens beat 4.
  const firstInjection = out.indexOf(4);
  if (firstInjection > 0 && evs[firstInjection - 1].kind === "paid") out[firstInjection - 1] = 4;
  return out;
}

const LEAD_MS = 1200; // pause before the first event
const BEAT_GAP_MS = 1600; // extra pause when a new beat starts, so the narration can be read
const MIN_GAP_MS = 700;
const MAX_GAP_MS = 2200;

const STEPS: Step[] = (() => {
  const beats = beatsOf(events);
  let at = LEAD_MS;
  return events.map((ev, i) => {
    if (i > 0) {
      at += Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, ev.ts - events[i - 1].ts));
      if (beats[i] !== beats[i - 1]) at += BEAT_GAP_MS;
    }
    return { at, beat: beats[i], ev };
  });
})();

export const REPLAY_TOTAL_MS = STEPS[STEPS.length - 1].at + 1500;

/** First moment each beat is on screen (for the progress bar). */
export const BEAT_STARTS = BEAT_TITLES.map((_, i) => STEPS.find((s) => s.beat === i + 1)?.at ?? 0);

export type ReplayFrame = { state: ChainState; events: LeashEvent[]; beat: number; done: boolean };

/** Dashboard state `elapsed` ms into a replay that started at wall-clock `startedAt`. */
export function replayFrame(startedAt: number, elapsed: number): ReplayFrame {
  const shown = STEPS.filter((s) => s.at <= elapsed);
  const tsOfTx = new Map<string, number>();
  for (const s of shown) if (s.ev.txHash) tsOfTx.set(s.ev.txHash, startedAt + s.at);
  const visibleLogs = logs
    .filter((l) => tsOfTx.has(l.txHash))
    .map((l) => ({ ...l, ts: tsOfTx.get(l.txHash)! }));

  // Keep each agent's time-to-expiry as it was during the recording.
  const rootCreated = logs.find((l) => l.kind === "NodeCreated" && l.parent === "0")?.ts ?? events[0].ts;
  const shiftSec = Math.floor((startedAt - rootCreated) / 1000);

  const nodes: UiNode[] = [];
  for (const n of data.nodes) {
    const created = visibleLogs.find((l) => l.kind === "NodeCreated" && l.id === String(n.id));
    if (!created || created.kind !== "NodeCreated") continue;
    nodes.push({
      id: n.id, key: n.key, parent: n.parent, depth: n.depth, maxPerCall: n.maxPerCall, restricted: n.restricted,
      expiry: String(Number(n.expiry) + shiftSec), cap: created.cap, spent: "0", paused: false,
    });
  }
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  let paidTotal = 0n;
  for (const l of visibleLogs.slice().sort((a, b) => a.ts - b.ts || a.logIndex - b.logIndex)) {
    if (l.kind === "Paid") {
      paidTotal += BigInt(l.value);
      // settle() increments spent at the paying node and every ancestor.
      for (let n = byId.get(l.id); n; n = byId.get(n.parent)) n.spent = String(BigInt(n.spent) + BigInt(l.value));
    } else if (l.kind === "CapRaised") {
      const n = byId.get(l.id);
      if (n) n.cap = l.newCap;
    } else if (l.kind === "NodePaused" || l.kind === "NodeUnpaused") {
      const n = byId.get(l.id);
      if (n) n.paused = l.kind === "NodePaused";
    }
  }

  const state: ChainState = {
    mode: "live",
    wallet: data.wallet,
    decimals: data.decimals,
    balance: String(BigInt(data.startBalance) - paidTotal),
    labels: data.labels,
    nodes,
    logs: visibleLogs,
  };
  const evs = shown.map((s) => ({ ...s.ev, ts: startedAt + s.at }));
  const beat = shown.length ? shown[shown.length - 1].beat : 0;
  return { state, events: evs, beat, done: elapsed >= REPLAY_TOTAL_MS };
}
