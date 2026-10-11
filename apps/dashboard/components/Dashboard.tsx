"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChainState, LeashEvent } from "../lib/types";
import { BASESCAN_TX } from "../lib/types";
import { mockAdmin, mockInitial, mockTick } from "../lib/mock";
import { ArrowLeftRight, Bot, Check, Copy, ExternalLink, LayoutGrid, MoreHorizontal, ScrollText, Settings } from "lucide-react";
import { ago, countdown, fmt, REASONS, short } from "../lib/format";

const EMPTY: ChainState = { mode: "mock", decimals: 6, labels: {}, nodes: [], logs: [] };

type FeedItem = {
  key: string; ts: number; tone: "paid" | "info" | "admin"; title: string; sub?: string; amount?: string; tx?: string;
  agent?: string; counterparty?: string; pill?: string;
};
type Row = {
  key: string; ts: number; kind: "paid" | "blocked" | "bypass" | "admin" | "info";
  agent: string; counterparty?: string; amount?: string; tx?: string; pill: string; reason?: string; code?: string; sub?: string;
};
type Tab = "all" | "payments" | "blocked";
type Menu = { id: number; x: number; y: number } | null;

export default function Dashboard() {
  const [state, setState] = useState<ChainState>(EMPTY);
  const [events, setEvents] = useState<LeashEvent[]>([]);
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(false);
  const [sse, setSse] = useState(false);
  const [toast, setToast] = useState<string>("");
  const [tab, setTab] = useState<Tab>("all");
  const [menu, setMenu] = useState<Menu>(null);
  const [copied, setCopied] = useState(false);
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
      if (l.kind === "Paid") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "paid", title: `${nameOf(l.id)} paid ${label(l.to)}`, amount: l.value, tx: l.txHash, sub: short(l.to), agent: nameOf(l.id), counterparty: label(l.to), pill: "Paid" });
      else if (l.kind === "NodeCreated") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "admin", title: `Allowance created for ${nameOf(l.id)}`, sub: `Cap ${fmt(l.cap, d)} AUSD`, tx: l.txHash, agent: nameOf(l.id), pill: "Created" });
      else if (l.kind === "NodePaused") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "admin", title: `${nameOf(l.id)} paused`, tx: l.txHash, agent: nameOf(l.id), pill: "Paused" });
      else if (l.kind === "NodeUnpaused") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "admin", title: `${nameOf(l.id)} unpaused`, tx: l.txHash, agent: nameOf(l.id), pill: "Resumed" });
      else if (l.kind === "CapRaised") items.push({ key: l.txHash + l.logIndex, ts: l.ts, tone: "admin", title: `${nameOf(l.id)} cap raised`, sub: `${fmt(l.oldCap, d)} to ${fmt(l.newCap, d)} AUSD`, tx: l.txHash, agent: nameOf(l.id), pill: "Cap raised" });
    }
    const chainTx = new Set(state.logs.map((l) => l.txHash));
    for (const e of events) {
      if (e.kind === "paid" && !(e.txHash && seen.has(e.txHash)))
        items.push({ key: e.id, ts: e.ts, tone: "paid", title: `${nameOf(e.nodeId ?? "")} paid ${label(e.payee, e.payeeLabel)}`, amount: e.amount, tx: e.txHash, agent: nameOf(e.nodeId ?? ""), counterparty: label(e.payee, e.payeeLabel), pill: "Paid" });
      // Facilitator events for owner actions and delegations duplicate the chain logs above; show only ones not yet on chain (e.g. failures).
      else if ((e.kind === "delegation" || e.kind === "admin") && !(e.txHash && chainTx.has(e.txHash)))
        items.push({ key: e.id, ts: e.ts, tone: "info", title: e.detail ?? e.kind, tx: e.txHash, pill: e.kind === "delegation" ? "Delegation" : "Admin" });
    }
    return items.sort((a, b) => b.ts - a.ts);
  }, [state.logs, events, state.labels, d]);

  const allBlocked = useMemo(() => events.filter((e) => e.kind === "blocked" || e.kind === "bypass").sort((a, b) => b.ts - a.ts), [events]);
  const nodes = state.nodes;
  const roots = nodes.filter((n) => n.parent === "0").slice(-1); // latest root only
  const childrenOf = (id: number) => nodes.filter((n) => n.parent === String(id)).slice(-3); // 3 most recent

  const totalPaid = useMemo(() => allFeed.reduce((a, f) => (f.tone === "paid" && f.amount ? a + Number(f.amount) : a), 0), [allFeed]);
  const activeAgents = useMemo(() => {
    const byId = new Map(nodes.map((n) => [String(n.id), n]));
    const pausedUp = (n: (typeof nodes)[number]): boolean => n.paused || (n.parent !== "0" && byId.has(n.parent) ? pausedUp(byId.get(n.parent)!) : false);
    return nodes.filter((n) => !pausedUp(n)).length;
  }, [nodes]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = allFeed.map((f) => ({
      key: f.key, ts: f.ts, kind: f.tone === "paid" ? "paid" : f.tone === "admin" ? "admin" : "info",
      agent: f.agent ?? f.title, counterparty: f.counterparty, amount: f.amount, tx: f.tx, pill: f.pill ?? "Info", sub: f.tone === "paid" ? undefined : f.sub,
    }));
    for (const e of allBlocked) {
      const name = e.error?.name ?? "Blocked";
      const bypass = e.kind === "bypass";
      out.push({
        key: e.id, ts: e.ts, kind: bypass ? "bypass" : "blocked",
        agent: e.nodeId ? nameOf(e.nodeId) : bypass ? "Direct call" : "Unknown",
        counterparty: bypass ? "AUSD" : label(e.payee, e.payeeLabel),
        amount: e.amount, tx: e.txHash, pill: bypass ? "Rejected" : "Blocked",
        reason: bypass ? "AUSD rejected direct submission outside Leash settle()" : e.error?.reason ?? REASONS[name] ?? name,
        code: `${name}(${e.error?.args?.join(", ") ?? ""})`,
      });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }, [allFeed, allBlocked]);
  const counts = useMemo(() => ({ all: rows.length, payments: rows.filter((r) => r.kind === "paid").length, blocked: rows.filter((r) => r.kind === "blocked" || r.kind === "bypass").length }), [rows]);
  const visibleRows = useMemo(() => rows.filter((r) => tab === "all" || (tab === "payments" ? r.kind === "paid" : r.kind === "blocked" || r.kind === "bypass")).slice(0, 40), [rows, tab]);

  // UI only: close the actions popover on outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-menu]")) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const onScroll = () => setMenu(null);
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey); window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onScroll); };
  }, [menu]);

  const copyWallet = async () => {
    if (!state.wallet) return;
    try { await navigator.clipboard.writeText(state.wallet); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

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

  if (!ready) return <div role="status" className="h-screen bg-bg p-8 text-sm text-fg2">Loading…</div>;

  const menuNode = menu ? nodes.find((n) => n.id === menu.id) : undefined;
  const statusText = state.mode === "mock" ? "Mock data" : `Live${sse ? "" : " (chain only)"}`;
  const statusDot = state.mode === "mock" ? "bg-paused" : sse ? "bg-paid" : "bg-warn";

  return (
    <div className="h-screen overflow-hidden flex bg-bg text-fg">
      <aside className="w-[200px] shrink-0 border-r border-line flex flex-col px-3 py-4">
        <div className="flex items-center gap-2 px-2 h-8 mb-6">
          <Mark />
          <span translate="no" className="text-base font-semibold">Leash</span>
        </div>
        <nav aria-label="Primary" className="flex flex-col gap-0.5 text-sm">
          <a href="/" aria-current="page" className="flex items-center gap-2.5 rounded-md px-2 h-8 bg-elevated text-fg font-medium">
            <LayoutGrid size={16} className="text-accent" />Overview
          </a>
          {([[Bot, "Agents"], [ArrowLeftRight, "Payments"], [ScrollText, "Policies"], [Settings, "Settings"]] as const).map(([Icon, l]) => (
            <span key={l} aria-disabled="true" className="flex items-center gap-2.5 rounded-md px-2 h-8 text-fg3 cursor-not-allowed select-none">
              <Icon size={16} />{l}
            </span>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 border-b border-line flex items-center gap-4 px-6">
          <nav aria-label="Breadcrumb" className="text-sm text-fg2 flex items-center gap-2">
            <span>Treasury</span><span className="text-fg3">/</span><span className="text-fg">Agent wallet</span>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="rounded-full bg-accent/10 text-accent px-2.5 h-6 inline-flex items-center text-[13px]">Base Sepolia</span>
            <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface pl-2.5 pr-1 h-7">
              <span translate="no" className="mono text-[13px] text-fg2">{state.wallet ? short(state.wallet) : "No wallet yet"}</span>
              <button type="button" onClick={copyWallet} aria-label="Copy wallet address" disabled={!state.wallet} className="h-5 w-5 inline-flex items-center justify-center rounded text-fg2 hover:text-fg hover:bg-elevated disabled:opacity-40">
                {copied ? <Check size={13} className="text-paid" /> : <Copy size={13} />}
              </button>
            </span>
            <span className="inline-flex items-center gap-2 text-[13px] text-fg2">
              <i aria-hidden className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />{statusText}
            </span>
          </div>
        </header>

        <main className="flex-1 min-h-0 flex flex-col gap-4 p-6">
          <div className="grid grid-cols-4 gap-4 shrink-0">
            <Kpi label="Balance" value={state.balance === undefined ? undefined : Number(state.balance)} d={d} unit="AUSD" caption="Agent wallet" />
            <Kpi label="Spent today" value={totalPaid} d={d} unit="AUSD" caption={`${counts.payments} payment${counts.payments === 1 ? "" : "s"}`} />
            <Kpi label="Blocked attempts" value={allBlocked.length} d={0} plain caption={allBlocked[0] ? `Last ${ago(allBlocked[0].ts, now)}` : "None so far"} />
            <Kpi label="Active agents" value={activeAgents} d={0} plain caption={`of ${nodes.length}`} />
          </div>

          {state.error && <div className="shrink-0 rounded-md bg-blocked/10 text-blocked px-3 py-2 text-[13px]">Chain read failed: <span className="mono">{state.error}</span></div>}

          <div className="flex-1 min-h-0 grid gap-4 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section className="min-h-0 flex flex-col rounded-lg border border-line bg-surface">
              <div className="h-12 shrink-0 flex items-center px-4 border-b border-line">
                <h2 className="text-sm font-medium">Delegation tree</h2>
                <span className="ml-auto text-[13px] text-fg2">{nodes.length} agent{nodes.length === 1 ? "" : "s"}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden p-2">
                {nodes.length === 0 && <p className="p-4 text-sm text-fg2">No agents yet. Create an allowance to get started.</p>}
                {roots.map((r) => {
                  const kids = childrenOf(r.id);
                  return (
                    <div key={r.id} className="flex flex-col">
                      <NodeRow n={r} name={nodeName(r, state)} d={d} now={now} root onMenu={(id, el) => { const b = el.getBoundingClientRect(); setMenu((m) => (m?.id === id ? null : { id, x: b.right, y: b.bottom + 4 })); }} open={menu?.id === r.id} />
                      <div className="ml-[22px] relative">
                        {kids.map((c, i) => (
                          <div key={c.id} className="relative pl-5">
                            <span aria-hidden className="absolute left-0 top-0 w-px bg-white/10" style={{ height: i === kids.length - 1 ? "28px" : "100%" }} />
                            <span aria-hidden className="absolute left-0 top-[28px] w-4 h-px bg-white/10" />
                            <NodeRow n={c} name={nodeName(c, state)} d={d} now={now} parentPaused={r.paused} onMenu={(id, el) => { const b = el.getBoundingClientRect(); setMenu((m) => (m?.id === id ? null : { id, x: b.right, y: b.bottom + 4 })); }} open={menu?.id === c.id} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="min-h-0 flex flex-col rounded-lg border border-line bg-surface">
              <div className="h-12 shrink-0 flex items-center gap-4 px-4 border-b border-line">
                <h2 className="text-sm font-medium">Activity</h2>
                <div role="tablist" aria-label="Filter activity" className="ml-auto flex items-center gap-1 rounded-md bg-bg p-0.5">
                  {([["all", "All"], ["payments", "Payments"], ["blocked", "Blocked"]] as const).map(([k, l]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                      className={`h-7 px-2.5 rounded-[5px] text-[13px] inline-flex items-center gap-1.5 ${tab === k ? "bg-elevated text-fg" : "text-fg2 hover:text-fg"}`}>
                      {l}<span className="mono text-fg2">{counts[k]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="shrink-0 grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_88px_92px_24px] gap-3 px-4 h-9 items-center text-[13px] text-fg3 border-b border-line">
                <span>Time</span><span>Agent</span><span>Counterparty</span><span className="text-right">Amount</span><span>Status</span><span />
              </div>
              <ul className="flex-1 min-h-0 overflow-hidden">
                {visibleRows.map((r) => <ActivityRow key={r.key} r={r} d={d} now={now} />)}
                {visibleRows.length === 0 && <li className="p-4 text-sm text-fg2">No activity yet. Payments and blocked attempts will appear here.</li>}
              </ul>
            </section>
          </div>
        </main>
      </div>

      {menu && menuNode && (
        <div data-menu role="menu" aria-label={`Actions for ${nodeName(menuNode, state)}`}
          className="fixed z-20 w-40 rounded-md border border-line bg-elevated p-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          style={{ top: menu.y, left: menu.x - 160 }}>
          {menuNode.paused
            ? <MenuItem onClick={() => { setMenu(null); act("unpause", menuNode.id); }}>Resume</MenuItem>
            : <MenuItem onClick={() => { setMenu(null); act("pause", menuNode.id); }}>Pause</MenuItem>}
          <MenuItem onClick={() => { setMenu(null); act("raiseCap", menuNode.id); }}>Raise cap</MenuItem>
        </div>
      )}

      <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-30">
        {toast && <div className="fadein rounded-md border border-line bg-elevated px-4 py-2.5 text-sm text-fg">{toast}</div>}
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <rect width="20" height="20" rx="5" fill="#7c83db" />
      <path d="M7 5.5v9h6.5" stroke="#111214" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" role="menuitem" onClick={onClick} className="w-full text-left h-8 px-2 rounded text-sm text-fg hover:bg-white/5">{children}</button>;
}

const PILL: Record<string, string> = {
  paid: "bg-paid/10 text-paid", blocked: "bg-blocked/10 text-blocked", warn: "bg-warn/10 text-warn",
  paused: "bg-white/[0.06] text-fg2", neutral: "bg-white/[0.06] text-fg2",
};
function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return <span className={`inline-flex items-center h-6 px-2 rounded-full text-[13px] whitespace-nowrap ${PILL[tone]}`}>{children}</span>;
}

function ActivityRow({ r, d, now }: { r: Row; d: number; now: number }) {
  const bad = r.kind === "blocked" || r.kind === "bypass";
  const tone = r.kind === "paid" ? "paid" : bad ? "blocked" : "neutral";
  return (
    <li className="fadein grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_88px_92px_24px] gap-x-3 px-4 py-2.5 items-center border-b border-line text-sm">
      <span className="text-[13px] text-fg2 whitespace-nowrap">{ago(r.ts, now)}</span>
      <span className="truncate text-fg">{r.agent}</span>
      <span className={`truncate ${r.counterparty === "ATTACKER" ? "text-blocked" : "text-fg2"}`}>{r.counterparty ?? r.sub ?? ""}</span>
      <span className={`mono text-right tabular-nums ${r.kind === "paid" ? "text-fg" : "text-fg2"}`}>{r.amount ? fmt(r.amount, d) : ""}</span>
      <span><Pill tone={tone}>{r.pill}</Pill></span>
      <span className="flex justify-end">
        {r.tx && <a href={BASESCAN_TX + r.tx} target="_blank" rel="noreferrer" aria-label="View on Basescan" className="text-fg3 hover:text-accent rounded"><ExternalLink size={14} /></a>}
      </span>
      {bad && (
        <span className="col-start-2 col-end-6 mt-1 flex items-baseline gap-2 min-w-0 text-[13px]">
          <span className="text-fg2 truncate">{r.reason}</span>
          <span translate="no" className="mono text-blocked shrink-0">{r.code}</span>
        </span>
      )}
    </li>
  );
}

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(m.matches);
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}
function useTween(target: number) {
  const reduce = usePrefersReducedMotion();
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduce) { from.current = target; setV(target); return; }
    const start = from.current; let t0 = -1; let raf = 0;
    const tick = (t: number) => {
      if (t0 < 0) t0 = t;
      const p = Math.max(0, Math.min(1, (t - t0) / 500)); const e = 1 - Math.pow(1 - p, 3);
      const cur = p >= 1 ? target : start + (target - start) * e; from.current = cur; setV(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce]);
  return v;
}
function Kpi({ label, value, d, unit, caption, plain }: { label: string; value?: number; d: number; unit?: string; caption: string; plain?: boolean }) {
  const v = useTween(value ?? 0);
  const text = value === undefined ? "-" : plain ? String(Math.round(v)) : fmt(BigInt(Math.round(v)), d);
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-4">
      <div className="text-[13px] text-fg2">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[28px] leading-8 font-medium tabular-nums tracking-tight">{text}</span>
        {unit && <span className="text-[13px] text-fg2">{unit}</span>}
      </div>
      <div className="mt-1 text-[13px] text-fg3">{caption}</div>
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

function NodeRow({ n, name, d, now, parentPaused, root, onMenu, open }: { n: ChainState["nodes"][number]; name: string; d: number; now: number; parentPaused?: boolean; root?: boolean; onMenu: (id: number, el: HTMLElement) => void; open: boolean }) {
  const cap = BigInt(n.cap); const spent = BigInt(n.spent);
  const pct = cap === 0n ? 0 : Number((spent * 10000n) / cap) / 100;
  const paused = n.paused || !!parentPaused;
  const expired = Number(n.expiry) * 1000 <= now;
  const hot = pct >= 90;
  const bar = paused ? "#6b6c73" : hot ? "#d4a24c" : "#4fae7c";
  const role = root ? "Orchestrator" : n.restricted ? "Search only" : "Search and scrape";
  const status = n.paused ? <Pill tone="paused">Paused</Pill> : parentPaused ? <Pill tone="paused">Parent paused</Pill> : expired ? <Pill tone="warn">Expired</Pill> : <Pill tone="paid">Active</Pill>;
  return (
    <div className="rounded-md px-3 py-3 hover:bg-white/[0.02]">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-sm font-medium ${paused ? "text-fg2" : "text-fg"}`}>{name}</span>
        <span className="text-[13px] text-fg2 truncate">{role}</span>
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {status}
          <button type="button" data-menu aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={open}
            onClick={(e) => onMenu(n.id, e.currentTarget)}
            className={`h-7 w-7 inline-flex items-center justify-center rounded-md text-fg2 hover:text-fg hover:bg-elevated ${open ? "bg-elevated text-fg" : ""}`}>
            <MoreHorizontal size={16} />
          </button>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div className="bar-fill h-full w-full rounded-full" style={{ transform: `scaleX(${Math.min(100, pct) / 100})`, backgroundColor: bar }} />
        </div>
        <span className="mono text-[13px] tabular-nums whitespace-nowrap"><span className="text-fg">{fmt(n.spent, d)}</span><span className="text-fg2"> / {fmt(n.cap, d)} AUSD</span></span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[13px] text-fg2 whitespace-nowrap">
        <span>Max <span className="mono tabular-nums">{fmt(n.maxPerCall, d)}</span> per call</span>
        <span className="text-fg3">·</span>
        <span>{expired ? "Expired" : <>Expires in <span className="mono tabular-nums">{countdown(Number(n.expiry), now)}</span></>}</span>
      </div>
    </div>
  );
}
