import { getStore } from "@netlify/blobs";

const STORE_NAME = "grocery-items";
const DATA_KEY = "data";

type GroceryItem = {
  id: string;
  item: string;
  category: string;
  bought: boolean;
  createdAt: string;
};

function isGroceryItem(value: unknown): value is GroceryItem {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.item === "string" &&
    typeof o.category === "string" &&
    typeof o.bought === "boolean" &&
    typeof o.createdAt === "string"
  );
}

export default async (req: Request) => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  if (req.method === "GET") {
    try {
      const raw = await store.get(DATA_KEY, { type: "json" });
      const items = Array.isArray(raw)
        ? raw.filter(isGroceryItem)
        : ([] as GroceryItem[]);
      return Response.json({ items });
    } catch (error) {
      console.error("grocery-items GET:", error);
      return Response.json({ success: false, error: "Failed to read list." }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    try {
      const body = (await req.json()) as { items?: unknown };
      if (!Array.isArray(body.items)) {
        return Response.json(
          { success: false, error: "Expected JSON body with items array." },
          { status: 400 },
        );
      }
      const items = body.items.filter(isGroceryItem);
      await store.setJSON(DATA_KEY, items);
      return Response.json({ success: true, items });
    } catch (error) {
      console.error("grocery-items POST:", error);
      return Response.json({ success: false, error: "Failed to save list." }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};
