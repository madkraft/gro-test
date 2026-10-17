import { getStore } from "@netlify/blobs";
import { reconcile, type SyncedItem } from "../lib/reconcile";

const FALLBACK_CATEGORY = "❓ Inne";

// Called by the "GroSync" iOS Shortcut (run by a Personal Automation): body { titles: "<open reminders, one per line>" }.
export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await req.json().catch(() => ({}))) as { titles?: unknown };
  if (typeof body.titles !== "string") {
    return Response.json({ error: "Expected { titles: string }." }, { status: 400 });
  }
  const titles = body.titles.split("\n").map((t) => t.trim()).filter(Boolean);

  const store = getStore({ name: "grocery-items", consistency: "strong" });
  const raw = await store.get("data", { type: "json" });
  const current = (Array.isArray(raw) ? raw : []) as SyncedItem[];

  const plan = reconcile(current, titles);
  const categories = await categorize(plan.imported, req.url);
  const now = new Date().toISOString();
  const imported: SyncedItem[] = plan.imported.map((title, i) => ({
    id: crypto.randomUUID(),
    item: title,
    category: categories[i] ?? FALLBACK_CATEGORY,
    bought: false,
    createdAt: now,
    reminderTitle: title,
  }));

  await store.setJSON("data", [...plan.items, ...imported]);
  return Response.json({ add: plan.add, complete: plan.complete });
};

/** Reuses process-audio's Gemini categorizer; keeps the original titles since they're the Reminders match key. */
async function categorize(titles: string[], baseUrl: string): Promise<string[]> {
  if (titles.length === 0) return [];
  try {
    const res = await fetch(new URL("/.netlify/functions/process-audio", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: titles.join("\n") }),
    });
    const json = (await res.json()) as { items?: { category: string }[] };
    // ponytail: positional mapping; Gemini may merge or drop lines, then everything falls back to "Inne".
    return json.items?.length === titles.length ? json.items.map((i) => i.category) : [];
  } catch (error) {
    console.warn("reminders-sync categorize:", error);
    return [];
  }
}
