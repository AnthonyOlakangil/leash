import { facilitatorUrl } from "../../../lib/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Pipes the facilitator SSE stream to the browser so the page needs no CORS and no direct facilitator URL.
export async function GET(req: Request) {
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());
  let up: Response;
  try {
    up = await fetch(`${facilitatorUrl()}/events`, { headers: { accept: "text/event-stream" }, signal: ac.signal, cache: "no-store" });
  } catch { return new Response("upstream unavailable", { status: 502 }); }
  if (!up.ok || !up.body) return new Response("upstream unavailable", { status: 502 });
  const reader = up.body.getReader();
  const stream = new ReadableStream({
    async pull(ctl) {
      try { const { done, value } = await reader.read(); if (done) ctl.close(); else ctl.enqueue(value); } catch { ctl.close(); }
    },
    cancel() { ac.abort(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
