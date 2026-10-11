import { NextResponse } from "next/server";
import { readState, walletAddress, payeeLabels } from "../../../lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const wallet = walletAddress();
  if (!wallet) return NextResponse.json({ mode: "mock", decimals: 6, labels: payeeLabels(), nodes: [], logs: [] });
  try {
    return NextResponse.json(await readState(wallet));
  } catch (e: any) {
    return NextResponse.json({ mode: "live", wallet, decimals: 6, labels: payeeLabels(), nodes: [], logs: [], error: String(e?.shortMessage || e?.message || e).slice(0, 200) });
  }
}
