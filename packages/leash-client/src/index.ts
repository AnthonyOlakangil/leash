import { type Address, type Hex, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AUSD_ADDRESS, AUSD_DOMAIN_NAME, AUSD_DOMAIN_VERSION, CHAIN_ID, X402_NETWORK, ausdAbi } from "@leash/abi";
import {
  type Eip712Domain,
  type TransferAuthorizationJson,
  authorizationToJson,
  buildTransferAuthorization,
  signTransferAuthorization,
} from "./typed-data.js";

export * from "./typed-data.js";

export type LeashResult = {
  status: number;
  ok: boolean;
  data: unknown;
  price?: { amount: string; payTo: Address; resource: string };
  paid?: { txHash: Hex; payer: Address };
  blocked?: { name: string; args: string[]; reason: string; txHash?: Hex };
  authorization?: TransferAuthorizationJson;
  signature?: Hex;
};

export type LeashFetchOptions = {
  nodePrivateKey: Hex;
  wallet: Address;
  rpcUrl: string;
  forceBroadcast?: boolean;
};

type PaymentRequirement = {
  scheme: string;
  network: string;
  asset: Address;
  payTo: Address;
  amount: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
};
type PaymentRequired = {
  x402Version: number;
  resource?: { url?: string } | string;
  accepts: PaymentRequirement[];
};

const b64encode = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const b64decode = <T>(s: string): T => JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Hand-rolled x402 v2 client. Signs ERC-3009 TransferWithAuthorization with from = the LeashWallet using
 * a Leash node key. The AUSD EIP-712 domain is read from chain once (and asserted) then cached.
 */
export function createLeashFetch(opts: LeashFetchOptions) {
  const account = privateKeyToAccount(opts.nodePrivateKey);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(opts.rpcUrl) });
  let domainPromise: Promise<Eip712Domain> | undefined;

  const getDomain = () =>
    (domainPromise ??= (async () => {
      const d = await publicClient.readContract({ address: AUSD_ADDRESS, abi: ausdAbi, functionName: "eip712Domain" });
      const [, name, version, chainId, verifyingContract] = d;
      if (name !== AUSD_DOMAIN_NAME || version !== AUSD_DOMAIN_VERSION || Number(chainId) !== CHAIN_ID) {
        throw new Error(
          `AUSD eip712Domain mismatch: got (${name}, ${version}, ${chainId}) expected (${AUSD_DOMAIN_NAME}, ${AUSD_DOMAIN_VERSION}, ${CHAIN_ID})`,
        );
      }
      return { name, version, chainId: Number(chainId), verifyingContract };
    })().catch((e) => {
      domainPromise = undefined; // allow retry after a transient RPC failure
      throw e;
    }));

  return async function leashFetch(
    url: string,
    init: RequestInit & { forceBroadcast?: boolean } = {},
  ): Promise<LeashResult> {
    const { forceBroadcast, ...reqInit } = init;
    const force = forceBroadcast ?? opts.forceBroadcast ?? false;

    const first = await fetch(url, reqInit);
    if (first.status !== 402) {
      const data = await parseBody(first);
      return { status: first.status, ok: first.ok, data };
    }

    const firstBody = await parseBody(first);
    const header = first.headers.get("payment-required");
    let required: PaymentRequired | undefined;
    try {
      required = header ? b64decode<PaymentRequired>(header) : (firstBody as PaymentRequired);
    } catch {
      required = undefined;
    }
    const accepted = required?.accepts?.find((a) => a.scheme === "exact" && a.network === X402_NETWORK);
    if (!required || !accepted) {
      return { status: 402, ok: false, data: firstBody };
    }
    if (accepted.asset.toLowerCase() !== AUSD_ADDRESS.toLowerCase()) {
      throw new Error(`refusing to sign: seller asked for asset ${accepted.asset}, not AUSD`);
    }

    const resourceUrl = typeof required.resource === "string" ? required.resource : (required.resource?.url ?? url);
    const price = { amount: accepted.amount, payTo: accepted.payTo, resource: resourceUrl };

    const domain = await getDomain();
    const authorization = buildTransferAuthorization({
      from: opts.wallet,
      to: accepted.payTo,
      value: BigInt(accepted.amount),
    });
    const signature = await signTransferAuthorization({ nodePrivateKey: opts.nodePrivateKey, domain, authorization });
    const authJson = authorizationToJson(authorization);

    const paymentPayload = {
      x402Version: 2,
      accepted,
      payload: { signature, authorization: authJson },
    };
    const headers = new Headers(reqInit.headers);
    headers.set("PAYMENT-SIGNATURE", b64encode(paymentPayload));
    if (force) headers.set("x-leash-force-broadcast", "1");

    const second = await fetch(url, { ...reqInit, headers });
    const data = await parseBody(second);
    const result: LeashResult = {
      status: second.status,
      ok: second.ok,
      data,
      price,
      authorization: authJson,
      signature,
    };

    const respHeader = second.headers.get("payment-response");
    if (respHeader) {
      try {
        const r = b64decode<{ success: boolean; transaction?: Hex; payer?: Address }>(respHeader);
        if (r.success && r.transaction) result.paid = { txHash: r.transaction, payer: (r.payer ?? account.address) as Address };
      } catch {
        /* ignore malformed header */
      }
    }

    if (second.status === 402 && data && typeof data === "object") {
      const d = data as { error?: string; decoded?: { name: string; args?: string[]; reason: string }; txHash?: Hex };
      if (d.error === "payment_blocked" && d.decoded) {
        result.blocked = {
          name: d.decoded.name,
          args: d.decoded.args ?? [],
          reason: d.decoded.reason,
          ...(d.txHash ? { txHash: d.txHash } : {}),
        };
      }
    }
    return result;
  };
}
