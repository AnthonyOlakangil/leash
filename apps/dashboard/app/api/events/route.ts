import { facilitatorUrl } from "../../../lib/server";
export const dynamic = "force-dynamic";
// Pipes the facilitator SSE stream to the browser so the page needs no CORS and no direct facilitator URL.
export async function GET(req: Request) {
  try {
    const up = await fetch(`${facilitatorUrl()}/events`, { headers: { accept: "text/event-stream" }, signal: req.signal });
    if (!up.ok || !up.body) return new Response("upstream unavailable", { status: 502 });
    return new Response(up.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
  } catch {
    return new Response("upstream unavailable", { status: 502 });
  }
}
