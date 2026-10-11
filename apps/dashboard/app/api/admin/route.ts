import { NextResponse } from "next/server";
import { facilitatorUrl } from "../../../lib/server";
export const dynamic = "force-dynamic";
// Owner actions. ADMIN_TOKEN stays on the server; the browser only sends {action, id, newCap}.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const id = String(b.id ?? "");
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  let path: string; let body: Record<string, unknown>;
  if (b.action === "pause") { path = "pause"; body = { id }; }
  else if (b.action === "unpause") { path = "unpause"; body = { id }; }
  else if (b.action === "raiseCap") {
    if (!/^\d+$/.test(String(b.newCap ?? ""))) return NextResponse.json({ ok: false, error: "bad newCap" }, { status: 400 });
    path = "raiseCap"; body = { id, newCap: String(b.newCap) };
  } else return NextResponse.json({ ok: false, error: "bad action" }, { status: 400 });
  try {
    const r = await fetch(`${facilitatorUrl()}/admin/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": process.env.ADMIN_TOKEN || "" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ ok: false, error: `facilitator ${r.status}` }));
    return NextResponse.json(j, { status: r.ok ? 200 : r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "facilitator unreachable" }, { status: 502 });
  }
}
