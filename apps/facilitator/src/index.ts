import { timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import {
  type Address,
  type Hex,
  type TransactionReceipt,
  decodeEventLog,
  isAddress,
  recoverTypedDataAddress,
} from "viem";
import { AUSD_ADDRESS, X402_NETWORK, ausdAbi, leashWalletAbi } from "@leash/abi";
import { authorizationFromJson, buildTransferTypedData } from "@leash/client";
import { PORT, adminToken, getWallet, payeeLabel } from "./config.js";
import {
  getAusdInfo,
  ownerLock,
  owner,
  publicClient,
  relayer,
  relayerLock,
  verifyAusdAtBoot,
} from "./chain.js";
import { BYPASS_REASON, type Decoded, decodeLeashError, shortMessage, unknownDecoded } from "./decode.js";
import { bus, emit, lastEvents, type LeashEvent } from "./events.js";

const app = express();
app.use(express.json({ limit: "256kb" }));
// Dashboard (localhost:3000) and seller call us cross-origin.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-admin-token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});

// Express 4 does not catch async rejections: wrap every handler so errors become 500s, never hangs or crashes.
for (const m of ["get", "post"] as const) {
  const orig = (app as any)[m].bind(app);
  (app as any)[m] = (path: string, ...hs: any[]) =>
    orig(path, ...hs.map((h) => (rq: Request, rs: Response, nx: any) => Promise.resolve(h(rq, rs, nx)).catch(nx)));
}

const NOT_DEPLOYED = "LeashWallet is not deployed yet (set LEASH_WALLET in .env or deployments/base-sepolia.json)";
const scan = (h?: Hex) => h;

type AuthJson = { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
type PaymentPayload = { x402Version?: number; accepted?: any; payload?: { signature?: Hex; authorization?: AuthJson } };
type PaymentRequirements = { scheme?: string; network?: string; asset?: Address; payTo?: Address; amount?: string };

function parsePayment(body: any): { auth: AuthJson; signature: Hex; req: PaymentRequirements } | { error: string } {
  const pp: PaymentPayload | undefined = body?.paymentPayload;
  const auth = pp?.payload?.authorization;
  const signature = pp?.payload?.signature;
  const req: PaymentRequirements = body?.paymentRequirements ?? pp?.accepted ?? {};
  if (!auth || !signature) return { error: "missing paymentPayload.payload.{authorization,signature}" };
  try {
    BigInt(auth.value); BigInt(auth.validAfter); BigInt(auth.validBefore);
  } catch {
    return { error: "authorization amounts must be decimal strings" };
  }
  if (!isAddress(auth.from) || !isAddress(auth.to) || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) return { error: "malformed authorization" };
  return { auth, signature, req };
}

function settleArgs(auth: AuthJson, signature: Hex) {
  return [auth.to, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, signature] as const;
}

async function recoverSigner(auth: AuthJson, signature: Hex): Promise<Address | undefined> {
  try {
    const { domain } = getAusdInfo();
    return await recoverTypedDataAddress({ ...buildTransferTypedData(domain, authorizationFromJson(auth)), signature });
  } catch {
    return undefined;
  }
}

async function nodeIdOf(wallet: Address | undefined, signer: Address | undefined): Promise<string | undefined> {
  if (!wallet || !signer) return undefined;
  try {
    const id = await publicClient.readContract({ address: wallet, abi: leashWalletAbi, functionName: "nodeOfKey", args: [signer] });
    return id === 0n ? undefined : id.toString();
  } catch {
    return undefined;
  }
}

function paidFromReceipt(receipt: TransactionReceipt, wallet: Address): { id: string } | undefined {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== wallet.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: leashWalletAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Paid") return { id: (ev.args as any).id.toString() };
    } catch {
      /* not ours */
    }
  }
  return undefined;
}

async function simulateSettle(wallet: Address, auth: AuthJson, signature: Hex, blockNumber?: bigint): Promise<Decoded | null> {
  try {
    await publicClient.simulateContract({
      address: wallet,
      abi: leashWalletAbi,
      functionName: "settle",
      args: settleArgs(auth, signature),
      account: relayer().account,
      ...(blockNumber ? { blockNumber } : {}),
    });
    return null;
  } catch (e) {
    return decodeLeashError(e) ?? unknownDecoded(e);
  }
}

/** A tx may have been front-run: if the nonce is used and a Paid log carries it, report success. */
async function findFrontRun(wallet: Address, nonce: Hex): Promise<{ txHash: Hex; id: string } | undefined> {
  try {
    const used = await publicClient.readContract({ address: AUSD_ADDRESS, abi: ausdAbi, functionName: "authorizationState", args: [wallet, nonce] });
    if (!used) return undefined;
    const head = await publicClient.getBlockNumber();
    const logs = await publicClient.getContractEvents({
      address: wallet, abi: leashWalletAbi, eventName: "Paid", fromBlock: head > 150n ? head - 150n : 0n, toBlock: head,
    });
    const hit = logs.find((l) => (l.args as any).nonce?.toLowerCase() === nonce.toLowerCase());
    return hit ? { txHash: hit.transactionHash, id: (hit.args as any).id.toString() } : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- routes

app.get("/health", (_req, res) => res.json({ ok: true, wallet: getWallet() ?? null }));

app.get("/supported", (_req, res) => {
  res.json({ kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK }] });
});

/**
 * Requirement checks that no client flag may bypass (force broadcast only overrides contract-simulation failures).
 * strict = paymentRequirements must carry payTo and amount (always true in /settle).
 */
function checkRequirements(auth: AuthJson, reqs: PaymentRequirements, wallet: Address, strict: boolean): string | undefined {
  if (auth.from.toLowerCase() !== wallet.toLowerCase()) return "authorization.from is not the LeashWallet";
  if (strict && (!reqs.payTo || !reqs.amount)) return "paymentRequirements.payTo and amount are required";
  if (strict && (!reqs.asset || reqs.asset.toLowerCase() !== AUSD_ADDRESS.toLowerCase())) return "asset is not AUSD";
  if (reqs.asset && reqs.asset.toLowerCase() !== AUSD_ADDRESS.toLowerCase()) return "asset is not AUSD";
  if (reqs.network && reqs.network !== X402_NETWORK) return `unsupported network ${reqs.network}`;
  if (reqs.payTo && reqs.payTo.toLowerCase() !== auth.to.toLowerCase()) return "authorization.to does not match payTo";
  try {
    if (reqs.amount && BigInt(auth.value) < BigInt(reqs.amount)) return "authorization.value is below the required amount";
  } catch {
    return "paymentRequirements.amount is malformed";
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (!(now > BigInt(auth.validAfter))) return "authorization not yet valid";
  if (!(now < BigInt(auth.validBefore))) return "authorization expired";
  return undefined;
}

app.post("/verify", async (req: Request, res: Response) => {
  const parsed = parsePayment(req.body);
  if ("error" in parsed) return void res.json({ isValid: false, invalidReason: parsed.error });
  const { auth, signature, req: reqs } = parsed;
  const wallet = getWallet();
  if (!wallet) return void res.json({ isValid: false, invalidReason: NOT_DEPLOYED });

  const badReason = checkRequirements(auth, reqs, wallet, false);
  if (badReason) return void res.json({ isValid: false, invalidReason: badReason });

  const signer = await recoverSigner(auth, signature);
  const decoded = await simulateSettle(wallet, auth, signature);
  if (decoded) {
    return void res.json({ isValid: false, invalidReason: decoded.reason, decoded, payer: signer });
  }
  res.json({ isValid: true, payer: signer });
});

app.post("/settle", async (req: Request, res: Response) => {
  const parsed = parsePayment(req.body);
  const force = req.body?.forceBroadcast === true;
  if ("error" in parsed) return void res.json({ success: false, network: X402_NETWORK, errorReason: parsed.error });
  const { auth, signature, req: reqs } = parsed;
  const wallet = getWallet();
  if (!wallet) return void res.json({ success: false, network: X402_NETWORK, errorReason: NOT_DEPLOYED });
  const badReason = checkRequirements(auth, reqs, wallet, true);
  if (badReason) {
    emit({ kind: "blocked", payee: auth.to, payeeLabel: payeeLabel(auth.to), amount: auth.value, error: { name: "InvalidPayment", args: [], reason: badReason } });
    return void res.json({ success: false, network: X402_NETWORK, errorReason: badReason, decoded: { name: "InvalidPayment", args: [], reason: badReason } });
  }

  const signer = await recoverSigner(auth, signature);
  const nodeId = await nodeIdOf(wallet, signer);
  const base = { nodeId, payee: auth.to, payeeLabel: payeeLabel(auth.to), amount: auth.value };

  // Always simulate first (free eth_call). It gives the decoded error even for force broadcasts.
  const preDecoded = await simulateSettle(wallet, auth, signature);
  if (preDecoded && !force) {
    const fr0 = await findFrontRun(wallet, auth.nonce);
    if (fr0) {
      emit({ kind: "paid", ...base, nodeId: fr0.id, txHash: fr0.txHash, detail: "settled by an earlier transaction (front-run)" });
      return void res.json({ success: true, transaction: fr0.txHash, network: X402_NETWORK, payer: signer });
    }
    emit({ kind: "blocked", ...base, error: preDecoded });
    return void res.json({ success: false, network: X402_NETWORK, payer: signer, errorReason: preDecoded.reason, decoded: preDecoded });
  }

  let txHash: Hex | undefined;
  let receipt: TransactionReceipt | undefined;
  try {
    const r = relayer();
    txHash = await relayerLock(() =>
      r.client.writeContract({
        address: wallet, abi: leashWalletAbi, functionName: "settle", args: settleArgs(auth, signature),
        // Force broadcast: fixed gas skips estimation so a reverting tx still lands onchain.
        ...(force ? { gas: 400_000n } : {}),
      }),
    );
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
  } catch (e) {
    const fr1 = await findFrontRun(wallet, auth.nonce);
    if (fr1) {
      emit({ kind: "paid", ...base, nodeId: fr1.id, txHash: fr1.txHash, detail: "settled by an earlier transaction (front-run)" });
      return void res.json({ success: true, transaction: fr1.txHash, network: X402_NETWORK, payer: signer });
    }
    const decoded = decodeLeashError(e) ?? preDecoded ?? unknownDecoded(e);
    emit({ kind: "blocked", ...base, txHash: scan(txHash), error: decoded });
    return void res.json({ success: false, network: X402_NETWORK, payer: signer, transaction: txHash, errorReason: decoded.reason, decoded });
  }

  if (receipt.status === "success") {
    const paid = paidFromReceipt(receipt, wallet);
    emit({ kind: "paid", ...base, nodeId: paid?.id ?? nodeId, txHash });
    return void res.json({ success: true, transaction: txHash, network: X402_NETWORK, payer: signer });
  }

  // Reverted onchain. Front-run case first, then recover the decoded error.
  const fr = await findFrontRun(wallet, auth.nonce);
  if (fr) {
    emit({ kind: "paid", ...base, nodeId: fr.id, txHash: fr.txHash, detail: "settled by an earlier transaction (front-run)" });
    return void res.json({ success: true, transaction: fr.txHash, network: X402_NETWORK, payer: signer });
  }
  const decoded =
    preDecoded ?? (await simulateSettle(wallet, auth, signature, receipt.blockNumber > 0n ? receipt.blockNumber - 1n : undefined)) ?? {
      name: "Unknown", args: [], reason: "settle reverted onchain (reason not recoverable)",
    };
  emit({ kind: "blocked", ...base, txHash, error: decoded });
  res.json({ success: false, transaction: txHash, network: X402_NETWORK, payer: signer, errorReason: decoded.reason, decoded });
});

app.post("/demo/bypass", async (req: Request, res: Response) => {
  const auth: AuthJson | undefined = req.body?.authorization;
  const signature: Hex | undefined = req.body?.signature;
  if (!auth || !signature) return void res.status(400).json({ ok: false, error: "authorization and signature required" });
  const args = [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, signature] as const;
  const base = { payee: auth.to, payeeLabel: payeeLabel(auth.to), amount: auth.value };
  const wallet = getWallet();
  const nodeId = await nodeIdOf(wallet, await recoverSigner(auth, signature));

  let detailReason = BYPASS_REASON;
  try {
    // Free simulation so we can report the raw token revert text alongside the canonical reason.
    await publicClient.simulateContract({ address: AUSD_ADDRESS, abi: ausdAbi, functionName: "transferWithAuthorization", args, account: relayer().account });
  } catch (e) {
    detailReason = `${BYPASS_REASON} (${shortMessage(e)})`;
  }

  let txHash: Hex | undefined;
  try {
    const r = relayer();
    txHash = await relayerLock(() =>
      // selector 0xcf092995 (bytes-signature overload); fixed gas so the failing tx lands onchain
      r.client.writeContract({ address: AUSD_ADDRESS, abi: ausdAbi, functionName: "transferWithAuthorization", args, gas: 300_000n }),
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    if (receipt.status === "success") {
      emit({ kind: "bypass", ...base, nodeId, txHash, error: { name: "BypassSucceeded", args: [], reason: "UNEXPECTED: AUSD accepted the signature outside settle()" } });
      return void res.json({ ok: true, txHash, reverted: false, reason: "UNEXPECTED: AUSD accepted the signature outside settle()" });
    }
  } catch (e) {
    detailReason = `${BYPASS_REASON} (${shortMessage(e)})`;
  }
  emit({ kind: "bypass", ...base, nodeId, txHash, error: { name: "BypassRejected", args: [], reason: BYPASS_REASON } });
  res.json({ ok: false, txHash, reverted: true, reason: BYPASS_REASON, detail: detailReason });
});

// ---- delegation relay (anyone can relay; signatures authorize)
app.post("/delegate", async (req: Request, res: Response) => {
  const wallet = getWallet();
  if (!wallet) return void res.status(503).json({ ok: false, error: { name: "NotDeployed", args: [], reason: NOT_DEPLOYED } });
  const body = req.body ?? {};
  const label: string | undefined = typeof body.label === "string" ? body.label : undefined;
  try {
    let fn: "createChild" | "pauseChild";
    let args: any;
    let detail: string;
    if (body.type === "createChild") {
      const c = body.child;
      fn = "createChild";
      args = [
        {
          parentId: BigInt(c.parentId), key: c.key, cap: BigInt(c.cap), maxPerCall: BigInt(c.maxPerCall), expiry: BigInt(c.expiry),
          restricted: Boolean(c.restricted), payees: c.payees ?? [], nonce: BigInt(c.nonce), deadline: BigInt(c.deadline),
        },
        body.signature as Hex,
      ];
      detail = `createChild${label ? " " + label : ""} under node ${c.parentId}`;
    } else if (body.type === "pauseChild") {
      fn = "pauseChild";
      args = [BigInt(body.target), BigInt(body.nonce), BigInt(body.deadline), body.signature as Hex];
      detail = `pauseChild node ${body.target}`;
    } else {
      return void res.status(400).json({ ok: false, error: { name: "BadRequest", args: [], reason: "type must be createChild or pauseChild" } });
    }

    try {
      await publicClient.simulateContract({ address: wallet, abi: leashWalletAbi, functionName: fn, args, account: relayer().account } as any);
    } catch (e) {
      const d = decodeLeashError(e) ?? unknownDecoded(e);
      emit({ kind: "delegation", detail: `${detail} FAILED`, error: d });
      return void res.json({ ok: false, error: d });
    }
    const r = relayer();
    const txHash = await relayerLock(() => r.client.writeContract({ address: wallet, abi: leashWalletAbi, functionName: fn, args } as any));
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    if (receipt.status !== "success") {
      const d: Decoded = { name: "Unknown", args: [], reason: `${fn} reverted onchain` };
      emit({ kind: "delegation", detail: `${detail} FAILED`, txHash, error: d });
      return void res.json({ ok: false, txHash, error: d });
    }
    let childId: string | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: leashWalletAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "NodeCreated") childId = (ev.args as any).id.toString();
      } catch { /* skip */ }
    }
    emit({ kind: "delegation", nodeId: childId ?? (fn === "pauseChild" ? String(body.target) : undefined), txHash, detail: childId ? `${detail} (node ${childId})` : detail });
    res.json({ ok: true, txHash, ...(childId ? { childId } : {}) });
  } catch (e) {
    const d = decodeLeashError(e) ?? unknownDecoded(e);
    res.status(500).json({ ok: false, error: d });
  }
});

// ---- admin (owner actions)
function tokenOk(req: Request): boolean {
  const expected = adminToken();
  const got = req.header("x-admin-token");
  if (!expected || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const adminRoutes: Record<string, { fn: string; args: (b: any) => any[]; detail: (b: any) => string; node?: (b: any) => string | undefined }> = {
  createRoot: { fn: "createRoot", args: (b) => [b.key, BigInt(b.cap), BigInt(b.maxPerCall), BigInt(b.expiry)], detail: () => "createRoot" },
  pause: { fn: "pause", args: (b) => [BigInt(b.id)], detail: (b) => `pause node ${b.id}`, node: (b) => String(b.id) },
  unpause: { fn: "unpause", args: (b) => [BigInt(b.id)], detail: (b) => `unpause node ${b.id}`, node: (b) => String(b.id) },
  raiseCap: { fn: "raiseCap", args: (b) => [BigInt(b.id), BigInt(b.newCap)], detail: (b) => `raiseCap node ${b.id} to ${b.newCap}`, node: (b) => String(b.id) },
  setAllow: { fn: "setAllow", args: (b) => [b.payee, Boolean(b.allowed)], detail: (b) => `setAllow ${b.payee} ${Boolean(b.allowed)}` },
};

app.post("/admin/:action", async (req: Request, res: Response) => {
  if (!tokenOk(req)) return void res.status(401).json({ ok: false, error: { name: "Unauthorized", args: [], reason: "bad or missing x-admin-token" } });
  const route = adminRoutes[req.params.action];
  if (!route) return void res.status(404).json({ ok: false, error: { name: "NotFound", args: [], reason: "unknown admin action" } });
  const wallet = getWallet();
  if (!wallet) return void res.status(503).json({ ok: false, error: { name: "NotDeployed", args: [], reason: NOT_DEPLOYED } });
  try {
    const args = route.args(req.body ?? {});
    const detail = route.detail(req.body ?? {});
    const o = owner();
    try {
      await publicClient.simulateContract({ address: wallet, abi: leashWalletAbi, functionName: route.fn, args, account: o.account } as any);
    } catch (e) {
      const d = decodeLeashError(e) ?? unknownDecoded(e);
      emit({ kind: "admin", detail: `${detail} FAILED`, error: d });
      return void res.json({ ok: false, error: d });
    }
    const txHash = await ownerLock(() => o.client.writeContract({ address: wallet, abi: leashWalletAbi, functionName: route.fn, args } as any));
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    if (receipt.status !== "success") {
      const d: Decoded = { name: "Unknown", args: [], reason: `${route.fn} reverted onchain` };
      emit({ kind: "admin", detail: `${detail} FAILED`, txHash, error: d });
      return void res.json({ ok: false, txHash, error: d });
    }
    let id: string | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: leashWalletAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "NodeCreated") id = (ev.args as any).id.toString();
      } catch { /* skip */ }
    }
    emit({ kind: "admin", nodeId: id ?? route.node?.(req.body), txHash, detail: id ? `${detail} (node ${id})` : detail });
    res.json({ ok: true, txHash, ...(id ? { id } : {}) });
  } catch (e) {
    const d = decodeLeashError(e) ?? unknownDecoded(e);
    res.status(500).json({ ok: false, error: d });
  }
});

// ---- SSE
app.get("/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  for (const ev of lastEvents(200)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const onEvent = (ev: LeashEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  bus.on("event", onEvent);
  const hb = setInterval(() => res.write(": hb\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(hb);
    bus.off("event", onEvent);
  });
});

app.use((err: any, _req: Request, res: Response, _next: any) => {
  console.warn("[facilitator] request error:", shortMessage(err));
  if (!res.headersSent) res.status(500).json({ ok: false, success: false, isValid: false, errorReason: shortMessage(err), error: { name: "InternalError", args: [], reason: shortMessage(err) } });
});

// ---------------------------------------------------------------- boot
async function main() {
  const info = await verifyAusdAtBoot();
  console.log(`[facilitator] AUSD domain verified: "${info.domain.name}" v${info.domain.version} chain ${info.domain.chainId}, decimals ${info.decimals}`);
  const w = getWallet();
  if (!w) console.warn(`[facilitator] WARNING: ${NOT_DEPLOYED}. /verify, /settle, /delegate and /admin/* return errors until it is set (re-read per request, no restart needed).`);
  else console.log(`[facilitator] LeashWallet ${w}`);
  try {
    console.log(`[facilitator] relayer ${relayer().account.address}`);
  } catch (e) {
    console.warn(`[facilitator] WARNING: ${(e as Error).message}`);
  }
  if (!adminToken()) console.warn("[facilitator] WARNING: ADMIN_TOKEN unset; /admin/* will reject everything");
  app.listen(PORT, () => console.log(`[facilitator] listening on http://localhost:${PORT}`));
}
main().catch((e) => {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
});
