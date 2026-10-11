import type { LeashResult } from "@leash/client";
import { atomic, adminPost, facPost, type Child } from "./chain.js";
import { call, makeActor, type Actor } from "./pay.js";
import { createChildren, dryDelegations, ensureRoot, type Ctx } from "./tree.js";
import { fmt, log, sleep, txLink } from "./util.js";

const BEAT_MS = 2000;
const QUERY = "used alto sax under $600 near Berkeley";

export const BEATS = [
  "(owner) ensure the orchestrator root node exists via facilitator /admin/createRoot (cap 1.00, 0.10/call, expires 23:59 PT today); unpause it if a previous run left it paused",
  "(orchestrator) sign 3 CreateChild delegations and relay via /delegate: searcher-1, searcher-2 (cap 0.25, 0.10/call), searcher-3 (cap 0.25, restricted to PAYEE_SEARCH)",
  "searcher-1: paid /search, then paid /scrape of a real search result. searcher-2: paid /search",
  "searcher-2: scrapes /listings/sax-42 (hidden injection), then calls /premium-intel (payTo ATTACKER) with forceBroadcast -> settle() reverts PayeeNotAllowed onchain",
  "facilitator /demo/bypass: replay that same signature straight at AUSD -> token rejects it",
  "searcher-3 tries /scrape -> BLOCKED PayeeNotAllowed(searcher-3 node)",
  "searcher-2 scrapes until OverBudget(searcher-2 node)",
  "(owner) raiseCap(searcher-2, 0.40 AUSD) via /admin/raiseCap; one more scrape succeeds",
  "(owner) pause(root) via /admin/pause; each searcher's next call is BLOCKED Paused(root id)",
];

function firstExternalUrl(data: unknown, sellerOrigin: string): string | undefined {
  const found: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (/^https?:\/\//.test(v) && !v.startsWith(sellerOrigin)) found.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(data);
  return found[0];
}

export async function runScripted(ctx: Ctx, children: Child[]): Promise<void> {
  const { env, decimals } = ctx;
  const search = (q: string) => `${env.sellerUrl}/search?q=${encodeURIComponent(q)}`;
  const scrape = (u: string) => `${env.sellerUrl}/scrape?url=${encodeURIComponent(u)}`;
  const fixture = `${env.sellerUrl}/listings/sax-42`;
  const beat = async (n: number) => {
    log(`--- beat ${n}/9: ${BEATS[n - 1]}`);
  };

  if (ctx.dry) {
    log("DRY RUN: planned beats (nothing is sent; no chain or facilitator calls)");
    BEATS.forEach((b, i) => log(`  ${i + 1}. ${b}`));
    log(`wallet=${env.wallet}${env.walletIsPlaceholder ? " (PLACEHOLDER: LEASH_WALLET not set)" : ""}  root=${ctx.root.address}  assumed rootId=${ctx.rootId}  rootExpiry=${ctx.rootExpiry}`);
    await dryDelegations(ctx, children);
    return;
  }

  await beat(1);
  Object.assign(ctx, await ensureRoot(ctx));
  log(`root node ${ctx.rootId} ready (expiry ${ctx.rootExpiry})`);
  await sleep(BEAT_MS);

  await beat(2);
  await createChildren(ctx, children);
  const [a1, a2, a3] = children.map((c) => makeActor(env, c, true)) as [Actor, Actor, Actor];
  await sleep(BEAT_MS);

  await beat(3);
  const s1 = await call(a1, "search", search(QUERY), decimals);
  const target = firstExternalUrl(s1.data, env.sellerUrl) ?? "https://example.com";
  log(`searcher-1 picked result to scrape: ${target}`);
  await sleep(BEAT_MS / 2);
  await call(a1, "scrape", scrape(target), decimals);
  await call(a2, "search", search(QUERY + " alto saxophone"), decimals);
  await sleep(BEAT_MS);

  await beat(4);
  const page = await call(a2, "scrape", scrape(fixture), decimals);
  const text = typeof page.data === "string" ? page.data : JSON.stringify(page.data);
  log(`searcher-2 read the listing (${text.length} chars). [SCRIPTED] the injected instruction is followed deterministically here; in live mode the model decides.`);
  await sleep(BEAT_MS / 2);
  const evil: LeashResult = await call(a2, "premium-intel", `${env.sellerUrl}/premium-intel`, decimals, { forceBroadcast: true });
  await sleep(BEAT_MS);

  await beat(5);
  if (evil.authorization && evil.signature) {
    const r = await facPost<{ ok: boolean; txHash?: string; reverted?: boolean; reason?: string }>(env, "/demo/bypass", { authorization: evil.authorization, signature: evil.signature });
    log(`bypass: same signature sent straight to AUSD -> ok=${r.body.ok} reverted=${r.body.reverted} reason="${r.body.reason}" tx ${txLink(r.body.txHash)}`);
  } else {
    log("bypass SKIPPED: the blocked /premium-intel result carried no authorization/signature (client or seller did not return them)");
  }
  await sleep(BEAT_MS);

  await beat(6);
  await call(a3, "scrape", scrape(fixture), decimals);
  await sleep(BEAT_MS);

  await beat(7);
  let hitBudget = false;
  for (let i = 0; i < 8 && !hitBudget; i++) {
    const r = await call(a2, "scrape", scrape(fixture), decimals);
    hitBudget = r.blocked?.name === "OverBudget";
    await sleep(BEAT_MS / 2);
  }
  if (!hitBudget) log("WARNING: searcher-2 never hit OverBudget within 8 scrapes");
  await sleep(BEAT_MS);

  await beat(8);
  const newCap = atomic("0.40", decimals);
  const rc = await adminPost(env, "/admin/raiseCap", { id: a2.nodeId, newCap });
  if (rc.body.ok) {
    log(`owner raised ${a2.name} cap to ${fmt(newCap, decimals)}  tx ${txLink(rc.body.txHash)}`);
    await sleep(BEAT_MS / 2);
    await call(a2, "scrape", scrape(fixture), decimals);
  } else {
    log(`raiseCap not available (${JSON.stringify(rc.body.error ?? rc.body)}); skipping the continue-after-raise step`);
  }
  await sleep(BEAT_MS);

  await beat(9);
  const pz = await adminPost(env, "/admin/pause", { id: ctx.rootId });
  if (!pz.body.ok) log(`pause failed: ${JSON.stringify(pz.body.error ?? pz.body)}`);
  else log(`owner paused root node ${ctx.rootId}  tx ${txLink(pz.body.txHash)}`);
  await sleep(BEAT_MS / 2);
  await call(a1, "scrape", scrape(fixture), decimals);
  await call(a2, "scrape", scrape(fixture), decimals);
  await call(a3, "search", search(QUERY), decimals);
  log("done. Root is left paused (the next run unpauses it at beat 1).");
}
