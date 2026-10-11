"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChainState, LeashEvent } from "../lib/types";
import { BASESCAN_TX } from "../lib/types";
import { mockAdmin, mockInitial, mockTick } from "../lib/mock";
import { ShieldAlert, ShieldX, ArrowUpRight, Pause, Play, TrendingUp } from "lucide-react";
import { ago, countdown, fmt, REASONS, short } from "../lib/format";

const EMPTY: ChainState = { mode: "mock", decimals: 6, labels: {}, nodes: [], logs: [] };

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
          if (s && !stop) setState((prev) => (s.error && prev.logs.length ? { ...s, nodes: prev.nodes, logs: prev.logs, balance: prev.balance } : s));
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
    if (!live || new URLSearchParams(location.search).has("nosse")) return;
    let es: EventSource | undefined; let t: ReturnType<typeof setTimeout>; let dead = false;
    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => setSse(true);
      es.onerror = () => { setSse(false); es?.close(); if (!dead) t = setTimeout(connect, 2000); };
      es.onmessage = (m) => {
        try {
          const e: LeashEvent = JSON.parse(m.data);
          setSse(true);
          setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e].slice(-300)));
        } catch {}
      };
    };
    connect();
    return () => { dead = true; clearTimeout(t); es?.close(); };
  }, [live]);

  const d = state.decimals;
  const nameOf = (id: string | number) => {
    const n = state.nodes.find((x) => x.id === Number(id));
    if (!n) return state.mode === "mock" ? ({ 1: "orchestrator", 2: "searcher-1", 3: "searcher-2", 4: "searcher-3" } as Record<number, string>)[Number(id)] ?? `node ${id}` : `node ${id}`;
    return nodeName(n, state);
  };
  const label = (addr?: string, fallback?: string) => (addr && state.labels[addr.toLowerCase()]) || fallback || short(addr);

  const allFeed: FeedItem[] = useMemo(() => {
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
    const chainTx = new Set(state.logs.map((l) => l.txHash));
    for (const e of events) {
      if (e.kind === "paid" && !(e.txHash && seen.has(e.txHash)))
        items.push({ key: e.id, ts: e.ts, tone: "paid", title: `${nameOf(e.nodeId ?? "")} paid ${label(e.payee, e.payeeLabel)}`, amount: e.amount, tx: e.txHash });
      // Facilitator events for owner actions and delegations duplicate the chain logs above; show only ones not yet on chain (e.g. failures).
      else if ((e.kind === "delegation" || e.kind === "admin") && !(e.txHash && chainTx.has(e.txHash)))
        items.push({ key: e.id, ts: e.ts, tone: "info", title: e.detail ?? e.kind, tx: e.txHash });
    }
    return items.sort((a, b) => b.ts - a.ts);
  }, [state.logs, events, state.labels, d]);
  const feed = allFeed.slice(0, 9);

  const allBlocked = useMemo(() => events.filter((e) => e.kind === "blocked" || e.kind === "bypass").sort((a, b) => b.ts - a.ts), [events]);
  const blocked = allBlocked.slice(0, 8);
  const nodes = state.nodes;
  const roots = nodes.filter((n) => n.parent === "0").slice(-1); // latest root only
  const childrenOf = (id: number) => nodes.filter((n) => n.parent === String(id)).slice(-3); // 3 most recent

  const totalPaid = useMemo(() => allFeed.reduce((a, f) => (f.tone === "paid" && f.amount ? a + Number(f.amount) : a), 0), [allFeed]);
  const activeAgents = useMemo(() => {
    const byId = new Map(nodes.map((n) => [String(n.id), n]));
    const pausedUp = (n: (typeof nodes)[number]): boolean => n.paused || (n.parent !== "0" && byId.has(n.parent) ? pausedUp(byId.get(n.parent)!) : false);
    return nodes.filter((n) => !pausedUp(n)).length;
  }, [nodes]);

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
    <div className="h-screen overflow-hidden px-6 py-4 flex flex-col gap-3 relative">
      <header className="flex items-center gap-5">
        <div>
          <h1 className="text-[28px] leading-none font-extrabold tracking-[0.28em] text-white">LEASH</h1>
          <p className="text-[13px] text-zinc-400 mt-1">Onchain spending allowances for AI agents</p>
        </div>
        <span className="mono text-zinc-400 text-sm rounded-md border border-[#1f2630] bg-[#0d1117] px-3 py-1.5">{state.wallet ? short(state.wallet) : "no wallet yet"}</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-300 px-3.5 py-1 text-sm">Base Sepolia</span>
          {state.mode === "mock"
            ? <span className="rounded-full border border-amber-500/50 bg-amber-500/10 text-amber-300 px-3.5 py-1 text-sm">Mock data</span>
            : <span className="rounded-full border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 px-3.5 py-1 text-sm flex items-center gap-2"><i className="inline-block h-2 w-2 rounded-full bg-[#22c55e] pulse-dot" />Live{sse ? "" : " (chain only)"}</span>}
        </div>
      </header>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Wallet balance" value={state.balance === undefined ? undefined : Number(state.balance)} d={d} unit="AUSD" color="#e8ecf1" />
        <Stat label="Total paid" value={totalPaid} d={d} unit="AUSD" color="#22c55e" />
        <Stat label="Blocked" value={allBlocked.length} d={0} unit="attempts" color="#ef4444" plain />
        <Stat label="Active agents" value={activeAgents} d={0} unit={`of ${nodes.length}`} color="#e8ecf1" plain />
      </div>

      {state.error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 px-4 py-2">Chain read failed: {state.error}</div>}
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-[#0d1117] border border-[#2a3340] px-5 py-3 text-lg shadow-xl z-10">{toast}</div>}

      <main className="grid gap-4 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] flex-1 min-h-0">
        <section className="min-h-0 flex flex-col">
          <h2 className="sec-title">Delegation tree</h2>
          <div className="tree-glow flex-1 min-h-0 rounded-xl border border-[#1f2630] p-3 overflow-hidden">
            {nodes.length === 0 && <p className="text-zinc-500 text-lg">No nodes yet. The owner creates the orchestrator first.</p>}
            {roots.map((r) => {
              const kids = childrenOf(r.id);
              return (
                <div key={r.id} className="flex flex-col">
                  <NodeCard n={r} name={nodeName(r, state)} d={d} now={now} labels={state.labels} onAct={act} root />
                  <div className="ml-6 relative">
                    {kids.map((c, i) => (
                      <div key={c.id} className="relative pl-6 pt-2.5">
                        <span className="absolute left-0 top-0 w-px bg-[#2f3a48]" style={{ height: i === kids.length - 1 ? "calc(2.5px + 50%)" : "100%" }} />
                        <span className="absolute left-0 w-6 h-px bg-[#2f3a48]" style={{ top: "calc(50% + 5px)" }} />
                        <NodeCard n={c} name={nodeName(c, state)} d={d} now={now} labels={state.labels} onAct={act} parentPaused={r.paused} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="min-h-0 flex flex-col">
          <h2 className="sec-title"><span className="text-[#22c55e]">Payments</span></h2>
          <ul className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2">
            {feed.map((f) => (
              <li key={f.key} className={`slidein shrink-0 rounded-lg border border-[#1f2630] border-l-[3px] bg-[#0d1117] card-inset px-3.5 py-2 ${f.tone === "paid" ? "border-l-[#22c55e]" : "border-l-[#3b4656]"}`}>
                <div className="flex items-baseline gap-3">
                  <span className={`text-[15px] ${f.tone === "paid" ? "text-zinc-100" : "text-zinc-300"}`}>{f.title}</span>
                  {f.amount && <b className="mono ml-auto text-lg text-[#22c55e]">+{fmt(f.amount, d)}</b>}
                </div>
                <div className="flex gap-3 text-xs text-zinc-500 mt-0.5 items-center">
                  <span>{ago(f.ts, now)}</span>{f.sub && <span className="mono">{f.sub}</span>}
                  {f.tx && <a className="mono ml-auto text-sky-400 hover:underline inline-flex items-center gap-0.5" href={BASESCAN_TX + f.tx} target="_blank" rel="noreferrer">Basescan {short(f.tx)}<ArrowUpRight size={12} /></a>}
                </div>
              </li>
            ))}
            {feed.length === 0 && <p className="text-zinc-500 text-lg">Waiting for the first payment.</p>}
          </ul>
        </section>

        <section className="min-h-0 flex flex-col">
          <h2 className="sec-title"><span className="text-[#ef4444]">Blocked</span></h2>
          <ul className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2">
            {blocked.map((e) => {
              const name = e.error?.name ?? "Blocked";
              const bypass = e.kind === "bypass";
              const Icon = bypass ? ShieldX : ShieldAlert;
              return (
                <li key={e.id} className="slidein flash-red shrink-0 rounded-lg border border-[#1f2630] border-l-[3px] border-l-[#ef4444] bg-[#0d1117] card-inset px-3.5 py-2.5">
                  <div className="flex gap-2.5 items-start">
                    <Icon size={20} className="text-[#ef4444] mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      {bypass && <div className="text-[13px] uppercase tracking-wide text-red-400 font-semibold">AUSD rejected direct submission</div>}
                      <div className="text-[17px] leading-snug text-red-100 font-medium">{e.error?.reason ?? REASONS[name] ?? name}</div>
                      <div className="mt-0.5 text-[13px] text-zinc-400">
                        {bypass ? "Direct call to AUSD with a captured signature" : `${nameOf(e.nodeId ?? "")} tried to pay ${label(e.payee, e.payeeLabel)}`}
                        {e.amount ? ` ${fmt(e.amount, d)} AUSD` : ""}
                      </div>
                      <div className="flex gap-3 text-xs mt-1.5 items-center whitespace-nowrap">
                        <span className="mono rounded bg-red-500/15 text-red-300 px-1.5 py-0.5">{name}({e.error?.args?.join(", ") ?? ""})</span>
                                                <span className="text-zinc-500">{ago(e.ts, now)}</span>
                        {e.txHash && <a className="mono ml-auto text-sky-400 hover:underline inline-flex items-center gap-0.5" href={BASESCAN_TX + e.txHash} target="_blank" rel="noreferrer">Basescan {short(e.txHash)}<ArrowUpRight size={12} /></a>}
                      </div>
                    </div>
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

function useTween(target: number) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current; let t0 = -1; let raf = 0;
    const tick = (t: number) => {
      if (t0 < 0) t0 = t;
      const p = Math.max(0, Math.min(1, (t - t0) / 700)); const e = 1 - Math.pow(1 - p, 3);
      const cur = p >= 1 ? target : start + (target - start) * e; from.current = cur; setV(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}
function Stat({ label, value, d, unit, color, plain }: { label: string; value?: number; d: number; unit: string; color: string; plain?: boolean }) {
  const v = useTween(value ?? 0);
  const text = value === undefined ? "-" : plain ? String(Math.round(v)) : fmt(BigInt(Math.round(v)), d);
  return (
    <div className="rounded-xl border border-[#1f2630] bg-[#0d1117] card-inset px-4 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <b className="mono text-[28px] leading-none tabular-nums" style={{ color }}>{text}</b>
        <span className="text-xs text-zinc-500">{unit}</span>
      </div>
    </div>
  );
}

function nodeName(n: ChainState["nodes"][number], s: ChainState) {
  const byKey = s.names?.[n.key.toLowerCase()];
  if (byKey) return byKey;
  if (n.parent === "0") return "orchestrator";
  const sibs = s.nodes.filter((x) => x.parent === n.parent).slice(-3);
  return `searcher-${sibs.findIndex((x) => x.id === n.id) + 1}`;
}

function NodeCard({ n, name, d, now, labels, onAct, parentPaused, root }: { n: ChainState["nodes"][number]; name: string; d: number; now: number; labels: Record<string, string>; onAct: (a: "pause" | "unpause" | "raiseCap", id: number) => void; parentPaused?: boolean; root?: boolean }) {
  const cap = BigInt(n.cap); const spent = BigInt(n.spent);
  const pct = cap === 0n ? 0 : Number((spent * 10000n) / cap) / 100;
  const paused = n.paused || !!parentPaused;
  const expired = Number(n.expiry) * 1000 <= now;
  const payee = n.restricted ? Object.entries(labels).filter(([, l]) => l === "Search API").map(([, l]) => l) : [];
  const hot = pct >= 90;
  const bar = paused ? "#64748b" : hot ? "#f59e0b" : "#22c55e";
  return (
    <div className={`relative rounded-xl border bg-[#0d1117] card-inset px-3.5 py-2.5 ${paused ? "border-slate-600/60" : root ? "border-[#2a3a4c]" : "border-[#1f2630]"}`}>
      <div className={paused ? "opacity-50" : ""}>
        <div className="flex items-center gap-2 whitespace-nowrap">
          {!paused && <i className="h-2 w-2 rounded-full bg-[#22c55e] pulse-dot shrink-0" />}
          <span className="text-lg font-semibold text-zinc-100">{name}</span>
          <span className="mono text-zinc-500 text-xs">#{n.id}</span>
          {expired && <span className="rounded bg-red-500/30 text-red-200 px-1.5 text-xs">EXPIRED</span>}
          {n.restricted && <span title={payee.length ? `${payee.join(", ")} only` : "restricted payees"} className="rounded bg-violet-500/20 text-violet-300 px-1.5 text-xs">{payee.length ? `${payee.join(", ")} only` : "Restricted"}</span>}
          <span className="ml-auto mono text-base"><b className="text-zinc-100" style={{ color: paused ? undefined : bar }}>{fmt(n.spent, d)}</b><span className="text-zinc-500"> / {fmt(n.cap, d)}</span></span>
        </div>
        <div className="mt-2 h-3 rounded-full bg-[#171d26] overflow-hidden">
          <div className="h-full rounded-full bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: bar, boxShadow: paused ? "none" : `0 0 10px ${bar}66` }} />
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400 whitespace-nowrap">
          <span className="mono">Max/call {fmt(n.maxPerCall, d)}</span>
          <span className="mono">Expires {countdown(Number(n.expiry), now)}</span>
        </div>
      </div>
      <span className="absolute right-3 bottom-2 flex gap-1.5">
        {n.paused ? <Btn onClick={() => onAct("unpause", n.id)}><Play size={11} />Unpause</Btn> : <Btn onClick={() => onAct("pause", n.id)} danger><Pause size={11} />Pause</Btn>}
        <Btn onClick={() => onAct("raiseCap", n.id)} amber><TrendingUp size={11} />Raise cap</Btn>
      </span>
      {paused && <span className="absolute left-1/2 top-[57%] -translate-x-1/2 -translate-y-1/2 rounded bg-slate-600 text-slate-100 px-2 py-0.5 text-xs font-semibold tracking-wider shadow-lg">{n.paused ? "PAUSED" : "PARENT PAUSED"}</span>}
    </div>
  );
}
function Btn({ children, onClick, danger, amber }: { children: React.ReactNode; onClick: () => void; danger?: boolean; amber?: boolean }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition bg-[#0d1117] ${danger ? "border-red-500/50 text-red-300 hover:bg-red-500/15" : amber ? "border-amber-500/40 text-amber-300 hover:bg-amber-500/10" : "border-slate-500 text-slate-200 hover:bg-slate-700"}`}>{children}</button>;
}
