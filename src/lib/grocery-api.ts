import type { GroceryItem } from "../types/grocery";

const GROCERY_ITEMS_PATH = "/.netlify/functions/grocery-items";

export async function fetchGroceryItems(): Promise<GroceryItem[]> {
  const response = await fetch(GROCERY_ITEMS_PATH, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to load list (${response.status})`);
  }
  const json = (await response.json()) as { items?: unknown };
  const raw = json.items;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isGroceryItem);
}

export async function postGroceryItems(items: GroceryItem[]): Promise<void> {
  const response = await fetch(GROCERY_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    throw new Error(`Failed to sync list (${response.status})`);
  }
}

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
