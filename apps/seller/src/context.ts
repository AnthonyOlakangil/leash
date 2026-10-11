import { CONTEXT_KEY } from "./config.js";

const BASE = "https://api.context.dev/v1";

export type Stubbed<T> = T & { stub?: true; stubReason?: string };

async function call(path: string, body: unknown): Promise<any> {
  if (!CONTEXT_KEY) throw new Error("CONTEXT_DEV_API_KEY is not set");
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CONTEXT_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`Context.dev ${path} -> HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** POST /web/search {query, numResults}. numResults must be 10..100. Returns trimmed results. */
export async function ctxSearch(query: string): Promise<Stubbed<{ results: { url: string; title: string; description: string }[] }>> {
  try {
    const j = await call("/web/search", { query, numResults: 10 });
    const results = (j.results ?? []).slice(0, 5).map((r: any) => ({
      url: String(r.url), title: String(r.title ?? ""), description: String(r.description ?? "").slice(0, 300),
    }));
    return { results };
  } catch (e) {
    console.warn(`[seller] WARNING Context.dev search failed, returning labeled STUB: ${(e as Error).message}`);
    return {
      stub: true,
      stubReason: (e as Error).message,
      results: [
        { url: "https://example.com/stub-1", title: "STUB RESULT 1 (Context.dev unavailable)", description: `Stub for query "${query}"` },
        { url: "https://example.com/stub-2", title: "STUB RESULT 2 (Context.dev unavailable)", description: `Stub for query "${query}"` },
      ],
    };
  }
}

/** POST /web/scrape {url, formats:{markdown:true}}. markdown is { success, data }. */
export async function ctxScrape(url: string): Promise<Stubbed<{ url: string; title?: string; markdown: string }>> {
  try {
    const j = await call("/web/scrape", { url, formats: { markdown: true }, sharedParams: { mainContentOnly: true } });
    if (!j.markdown?.success) throw new Error(j.markdown?.message || "markdown output failed");
    return { url, title: j.metadata?.title, markdown: String(j.markdown.data).slice(0, 8000) };
  } catch (e) {
    console.warn(`[seller] WARNING Context.dev scrape failed, returning labeled STUB: ${(e as Error).message}`);
    return { stub: true, stubReason: (e as Error).message, url, markdown: `# STUB (Context.dev unavailable)\n\nCould not scrape ${url}.` };
  }
}
