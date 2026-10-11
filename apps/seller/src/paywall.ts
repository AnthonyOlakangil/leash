import type { NextFunction, Request, Response } from "express";
import { type Address, type Hex } from "viem";
import { AUSD_ADDRESS, AUSD_DOMAIN_NAME, AUSD_DOMAIN_VERSION, X402_NETWORK } from "@leash/abi";
import { FACILITATOR_URL, SELLER_URL } from "./config.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

export type Decoded = { name: string; args: string[]; reason: string };

export function requirementFor(opts: { amount: bigint; payTo: Address }) {
  return {
    scheme: "exact",
    network: X402_NETWORK,
    asset: AUSD_ADDRESS,
    payTo: opts.payTo,
    amount: opts.amount.toString(),
    maxTimeoutSeconds: 120,
    extra: { name: AUSD_DOMAIN_NAME, version: AUSD_DOMAIN_VERSION },
  };
}

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${FACILITATOR_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

/**
 * x402 v2 paywall. Unpaid: 402 + PAYMENT-REQUIRED. Paid: /verify then /settle via the facilitator,
 * then next() with PAYMENT-RESPONSE set. Blocked: 402 { error: "payment_blocked", decoded, txHash? }.
 */
export function paywall(opts: { amount: () => bigint; payTo: () => Address; description: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requirement = requirementFor({ amount: opts.amount(), payTo: opts.payTo() });
      const required = {
        x402Version: 2,
        error: "payment_required",
        resource: { url: `${SELLER_URL}${req.originalUrl}`, description: opts.description, mimeType: "application/json" },
        accepts: [requirement],
      };
      const sigHeader = req.header("payment-signature");
      if (!sigHeader) {
        res.setHeader("PAYMENT-REQUIRED", b64(required));
        return void res.status(402).json(required);
      }

      let paymentPayload: any;
      try {
        paymentPayload = unb64(sigHeader);
      } catch {
        return void res.status(400).json({ error: "bad_payment_header", message: "PAYMENT-SIGNATURE is not base64 JSON" });
      }
      const force = req.header("x-leash-force-broadcast") === "1";
      const body = { paymentPayload, paymentRequirements: requirement };

      const v = await post("/verify", body).catch((e) => ({ isValid: false, invalidReason: `facilitator unreachable: ${e.message}` }));
      // Force broadcast may only override a contract-simulation failure (v.decoded); requirement failures always stop.
      if (!v.isValid && !(force && v.decoded)) {
        res.setHeader("PAYMENT-REQUIRED", b64(required));
        return void res.status(402).json({
          error: "payment_blocked",
          decoded: v.decoded ?? { name: "InvalidPayment", args: [], reason: v.invalidReason ?? "payment rejected by facilitator" },
        });
      }

      const s = await post("/settle", { ...body, forceBroadcast: force }).catch((e) => ({
        success: false,
        errorReason: `facilitator unreachable: ${e.message}`,
      }));
      if (!s.success) {
        res.setHeader("PAYMENT-REQUIRED", b64(required));
        return void res.status(402).json({
          error: "payment_blocked",
          decoded: s.decoded ?? v.decoded ?? { name: "SettleFailed", args: [], reason: s.errorReason ?? "settlement failed" },
          ...(s.transaction ? { txHash: s.transaction as Hex } : {}),
        });
      }
      res.setHeader(
        "PAYMENT-RESPONSE",
        b64({ success: true, transaction: s.transaction, network: s.network ?? X402_NETWORK, payer: s.payer }),
      );
      next();
    } catch (e) {
      next(e);
    }
  };
}
