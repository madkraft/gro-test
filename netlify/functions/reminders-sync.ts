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
  const now = new Date().toISOString();
  const imported: SyncedItem[] = plan.imported.map((title) => ({
    id: crypto.randomUUID(),
    item: title,
    // The app shows learned categories for these; the Categorize button handles the rest.
    category: FALLBACK_CATEGORY,
    bought: false,
    createdAt: now,
    reminderTitle: title,
  }));

  await store.setJSON("data", [...plan.items, ...imported]);
  return Response.json({ add: plan.add, complete: plan.complete });
};
