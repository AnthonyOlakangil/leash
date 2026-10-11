"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChainState, LeashEvent } from "../lib/types";
import { BASESCAN_TX } from "../lib/types";
import { mockAdmin, mockInitial, mockTick } from "../lib/mock";
import { ago, countdown, fmt, REASONS, short } from "../lib/format";

const EMPTY: ChainState = { mode: "mock", decimals: 6, labels: {}, nodes: [], logs: [] };
const NAMES: Record<number, string> = { 1: "orchestrator", 2: "searcher-1", 3: "searcher-2", 4: "searcher-3" };
const nameOf = (id: string | number) => NAMES[Number(id)] ?? `node ${id}`;

type FeedItem = { key: string; ts: number; tone: "paid" | "info" | "admin"; title: string; sub?: string; amount?: string; tx?: string };

export default function Dashboard() {
  const [state, setState] = useState<ChainState>(EMPTY);
  const [events, setEvents] = useState<LeashEvent[]>([]);
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(false);
  const [sse, setSse] = useState(false);
  const [toast, setToast] = useState<string>("");
  const step = useRef(0);
  const mockRef = useRef<{ state: ChainState; events: LeashEvent[] }>({ state: EMPTY, events: [] });

  // Decide mode once from the server, then poll (live) or animate (mock).
  useEffect(() => {
    let stop = false; let timers: ReturnType<typeof setInterval>[] = [];
    (async () => {
      const first: ChainState = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json()).catch(() => EMPTY);
      if (stop) return;
      if (first.mode === "live") {
        setLive(true); setState(first); setReady(true);
        timers.push(setInterval(async () => {
          const s = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
          if (s && !stop) setState(s);
        }, 2000));
      } else {
        const m = mockInitial();
        setState({ ...m.state, labels: m.state.labels }); setEvents(m.events); setReady(true);
        mockRef.current = m;
        timers.push(setInterval(() => {
          mockRef.current = mockTick(mockRef.current.state, mockRef.current.events, step.current++, Date.now());
          setState(mockRef.current.state); setEvents(mockRef.current.events);
        }, 3000));
      }
    })();
    timers.push(setInterval(() => setNow(Date.now()), 1000));
    return () => { stop = true; timers.forEach(clearInterval); };
  }, []);

  // Facilitator SSE (live mode only).
  useEffect(() => {
    if (!live) return;
    const es = new EventSource("/api/events");
    es.onopen = () => setSse(true);
    es.onerror = () => setSse(false);
    es.onmessage = (m) => {
      try {
        const e: LeashEvent = JSON.parse(m.data);
        setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e].slice(-300)));
      } catch {}
    };
    return () => es.close();
  }, [live]);

  const d = state.decimals;
  const label = (addr?: string, fallback?: string) => (addr && state.labels[addr.toLowerCase()]) || fallback || short(addr);

  const feed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];
    const seen = new Set<string>();
    for (const l of state.logs) {
      seen.add(l.txHash);
      if (l.kind === "Paid") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "paid", title: `${nameOf(l.id)} paid ${label(l.to)}`, amount: l.value, tx: l.txHash, sub: short(l.to) });
      else if (l.kind === "NodeCreated") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "admin", title: `Allowance created for ${nameOf(l.id)}`, sub: `cap ${fmt(l.cap, d)} AUSD`, tx: l.txHash });
      else if (l.kind === "NodePaused") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "admin", title: `${nameOf(l.id)} paused`, tx: l.txHash });
      else if (l.kind === "NodeUnpaused") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "admin", title: `${nameOf(l.id)} unpaused`, tx: l.txHash });
      else if (l.kind === "CapRaised") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "admin", title: `${nameOf(l.id)} cap raised`, sub: `${fmt(l.oldCap, d)} to ${fmt(l.newCap, d)} AUSD`, tx: l.txHash });
    }
    for (const e of events) {
      if (e.kind === "paid" && !(e.txHash && seen.has(e.txHash)))
        items.push({ key: e.id, ts: e.ts, tone: "paid", title: `${nameOf(e.nodeId ?? "")} paid ${label(e.payee, e.payeeLabel)}`, amount: e.amount, tx: e.txHash });
      else if (e.kind === "delegation" || e.kind === "admin")
        items.push({ key: e.id, ts: e.ts, tone: "info", title: e.detail ?? e.kind, tx: e.txHash });
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 40);
  }, [state.logs, events, state.labels, d]);

  const blocked = useMemo(() => events.filter((e) => e.kind === "blocked" || e.kind === "bypass").sort((a, b) => b.ts - a.ts).slice(0, 20), [events]);
  const nodes = state.nodes;
  const roots = nodes.filter((n) => n.parent === "0");
  const childrenOf = (id: number) => nodes.filter((n) => n.parent === String(id));

  async function act(action: "pause" | "unpause" | "raiseCap", id: number) {
    const n = nodes.find((x) => x.id === id)!;
    const newCap = action === "raiseCap" ? String(BigInt(n.cap) + 250_000n) : undefined;
    if (state.mode === "mock") { mockRef.current = { ...mockRef.current, state: mockAdmin(mockRef.current.state, action, id, newCap) }; setState(mockRef.current.state); setToast(`${action} node ${id} (mock)`); }
    else {
      const r = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id, newCap }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "network" }));
      setToast(r.ok ? `${action} node ${id} sent` : `${action} failed: ${typeof r.error === "string" ? r.error : r.error?.reason ?? "error"}`);
    }
    setTimeout(() => setToast(""), 3500);
  }

  if (!ready) return <div className="p-10 text-xl text-zinc-400">Loading...</div>;

  return (
    <div className="min-h-screen p-6 flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 pb-4">
        <h1 className="text-5xl font-bold tracking-tight">Leash</h1>
        <span className="mono text-zinc-400 text-lg">{state.wallet ? short(state.wallet) : "no wallet yet"}</span>
        <div className="text-2xl"><span className="text-zinc-500 text-base mr-2">Wallet balance</span><b className="text-emerald-400">{fmt(state.balance, d)}</b> <span className="text-zinc-400">AUSD</span></div>
        <div className="ml-auto flex items-center gap-3">
          <span className="rounded-full border border-blue-500/50 bg-blue-500/10 text-blue-300 px-4 py-1 text-base">Base Sepolia</span>
          {state.mode === "mock"
            ? <span className="rounded-full border border-amber-500/50 bg-amber-500/10 text-amber-300 px-4 py-1 text-base">Mock data</span>
            : <span className="rounded-full border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 px-4 py-1 text-base flex items-center gap-2"><i className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />Live{sse ? "" : " (chain only)"}</span>}
        </div>
      </header>
      {state.error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 px-4 py-2">Chain read failed: {state.error}</div>}
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-800 border border-zinc-600 px-5 py-3 text-lg shadow-xl z-10">{toast}</div>}

      <main className="grid gap-5 grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] flex-1">
        <section>
          <h2 className="text-2xl font-semibold mb-3 text-zinc-300">Delegation tree</h2>
          <div className="flex flex-col gap-3">
            {nodes.length === 0 && <p className="text-zinc-500 text-lg">No nodes yet. The owner creates the orchestrator first.</p>}
            {roots.map((r) => (
              <div key={r.id} className="flex flex-col gap-3">
                <NodeCard n={r} d={d} now={now} labels={state.labels} onAct={act} />
                {childrenOf(r.id).map((c) => (
                  <div key={c.id} className="ml-8 border-l-2 border-zinc-700 pl-4"><NodeCard n={c} d={d} now={now} labels={state.labels} onAct={act} parentPaused={r.paused} /></div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-zinc-300">Payments</h2>
          <ul className="flex flex-col gap-2">
            {feed.map((f) => (
              <li key={f.key} className={`slidein rounded-lg border px-4 py-3 ${f.tone === "paid" ? "border-emerald-500/30 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/60"}`}>
                <div className="flex items-baseline gap-3">
                  <span className={`text-lg ${f.tone === "paid" ? "text-emerald-300" : "text-zinc-300"}`}>{f.title}</span>
                  {f.amount && <b className="ml-auto text-2xl text-emerald-400">{fmt(f.amount, d)}</b>}
                </div>
                <div className="flex gap-3 text-sm text-zinc-500 mt-1">
                  <span>{ago(f.ts, now)}</span>{f.sub && <span className="mono">{f.sub}</span>}
                  {f.tx && <a className="ml-auto text-sky-400 hover:underline" href={BASESCAN_TX + f.tx} target="_blank" rel="noreferrer">Basescan {short(f.tx)}</a>}
                </div>
              </li>
            ))}
            {feed.length === 0 && <p className="text-zinc-500 text-lg">Waiting for the first payment.</p>}
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-red-300">Blocked</h2>
          <ul className="flex flex-col gap-2">
            {blocked.map((e) => {
              const name = e.error?.name ?? "Blocked";
              return (
                <li key={e.id} className="slidein rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3">
                  <div className="text-xl text-red-200 font-medium">{e.error?.reason ?? REASONS[name] ?? name}</div>
                  <div className="mt-1 text-base text-zinc-300">
                    {e.kind === "bypass" ? "Direct call to AUSD with a captured signature" : `${nameOf(e.nodeId ?? "")} tried to pay ${label(e.payee, e.payeeLabel)}`}
                    {e.amount ? ` ${fmt(e.amount, d)} AUSD` : ""}
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm mt-2 items-center">
                    <span className="mono rounded bg-red-500/20 text-red-300 px-2 py-0.5">{name}({e.error?.args?.join(", ") ?? ""})</span>
                    {e.nodeId && <span className="text-zinc-400">node {e.nodeId}</span>}
                    <span className="text-zinc-500">{ago(e.ts, now)}</span>
                    {e.txHash && <a className="ml-auto text-sky-400 hover:underline" href={BASESCAN_TX + e.txHash} target="_blank" rel="noreferrer">Basescan {short(e.txHash)}</a>}
                  </div>
                </li>
              );
            })}
            {blocked.length === 0 && <p className="text-zinc-500 text-lg">Nothing blocked yet.</p>}
          </ul>
        </section>
      </main>
    </div>
  );
}

function NodeCard({ n, d, now, labels, onAct, parentPaused }: { n: ChainState["nodes"][number]; d: number; now: number; labels: Record<string, string>; onAct: (a: "pause" | "unpause" | "raiseCap", id: number) => void; parentPaused?: boolean }) {
  const cap = BigInt(n.cap); const spent = BigInt(n.spent);
  const pct = cap === 0n ? 0 : Number((spent * 10000n) / cap) / 100;
  const paused = n.paused || !!parentPaused;
  const expired = Number(n.expiry) * 1000 <= now;
  const payee = n.restricted ? Object.entries(labels).filter(([, l]) => l === "Search API").map(([, l]) => l) : [];
  return (
    <div className={`rounded-xl border p-4 ${paused ? "border-zinc-600 bg-zinc-800/50 text-zinc-400" : "border-zinc-700 bg-zinc-900"}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl font-semibold">{nameOf(n.id)}</span>
        <span className="mono text-zinc-500">#{n.id}</span>
        {paused && <span className="rounded bg-zinc-600 text-zinc-100 px-2 py-0.5 text-sm">{n.paused ? "PAUSED" : "PARENT PAUSED"}</span>}
        {expired && <span className="rounded bg-red-500/30 text-red-200 px-2 py-0.5 text-sm">EXPIRED</span>}
        {n.restricted && <span className="rounded bg-violet-500/20 text-violet-300 px-2 py-0.5 text-sm">Restricted{payee.length ? `: ${payee.join(", ")} only` : ""}</span>}
        <span className="ml-auto text-xl"><b className={paused ? "text-zinc-300" : "text-emerald-400"}>{fmt(n.spent, d)}</b><span className="text-zinc-500"> / {fmt(n.cap, d)} AUSD</span></span>
      </div>
      <div className="mt-3 h-3 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full transition-all duration-700 ${paused ? "bg-zinc-500" : pct >= 90 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-base text-zinc-400">
        <span>Max per call {fmt(n.maxPerCall, d)}</span>
        <span>Expires in {countdown(Number(n.expiry), now)}</span>
      </div>
      <div className="mt-3 flex gap-2">
        {n.paused
          ? <Btn onClick={() => onAct("unpause", n.id)}>Unpause</Btn>
          : <Btn onClick={() => onAct("pause", n.id)} danger>Pause</Btn>}
        <Btn onClick={() => onAct("raiseCap", n.id)}>Raise cap +0.25</Btn>
      </div>
    </div>
  );
}
function Btn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={`rounded-lg border px-4 py-1.5 text-base transition ${danger ? "border-red-500/50 text-red-300 hover:bg-red-500/15" : "border-zinc-600 text-zinc-200 hover:bg-zinc-700"}`}>{children}</button>;
}
