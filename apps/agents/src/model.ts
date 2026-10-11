/** Choose the model from the live /v1/models list: newest Sonnet, else newest Haiku. No hard-coded id. */
export async function chooseModel(apiKey: string | undefined): Promise<string> {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing from .env");
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) throw new Error(`Anthropic /v1/models failed: HTTP ${res.status} (check ANTHROPIC_API_KEY)`);
  const body = (await res.json()) as { data: { id: string; created_at?: string }[] };
  const newest = (family: string) =>
    body.data
      .filter((m) => m.id.includes(family))
      .sort((a, b) => Date.parse(b.created_at ?? "0") - Date.parse(a.created_at ?? "0"))[0]?.id;
  const id = newest("sonnet") ?? newest("haiku");
  if (!id) throw new Error("No Sonnet or Haiku model available for this API key");
  return id;
}
