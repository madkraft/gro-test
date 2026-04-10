import type { GroceryItem } from "../types/grocery";

const STORAGE_KEY = "grocery-list";

export function getItems(): GroceryItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isGroceryItem);
  } catch {
    return [];
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

/** Union by id; bought is OR of both sides; later spread wins other fields from local. */
export function mergeItems(
  local: GroceryItem[],
  server: GroceryItem[],
): GroceryItem[] {
  const map = new Map<string, GroceryItem>();
  for (const s of server) {
    map.set(s.id, { ...s });
  }
  for (const l of local) {
    const prev = map.get(l.id);
    if (prev === undefined) {
      map.set(l.id, { ...l });
    } else {
      map.set(l.id, {
        ...prev,
        ...l,
        bought: prev.bought || l.bought,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}
