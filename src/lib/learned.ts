import { OTHER_CATEGORY, type GroceryItem } from "../types/grocery.ts";

export const norm = (name: string) => name.trim().toLowerCase();

/** Name → category from every item ever categorized; later items win. The list history is the training data. */
export function learnCategories(items: GroceryItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const i of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (i.category !== OTHER_CATEGORY) map.set(norm(i.item), i.category);
  }
  return map;
}

export const categoryOf = (item: GroceryItem, learned: Map<string, string>) =>
  item.category === OTHER_CATEGORY ? (learned.get(norm(item.item)) ?? OTHER_CATEGORY) : item.category;

/** Distinct past item names, most frequently added first (ties: most recent), with the latest spelling. */
export function pastNames(items: GroceryItem[]): { name: string; count: number }[] {
  const byKey = new Map<string, { name: string; count: number; last: string }>();
  for (const i of items) {
    const key = norm(i.item);
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { name: i.item, count: 1, last: i.createdAt });
    else {
      prev.count++;
      if (i.createdAt > prev.last) Object.assign(prev, { name: i.item, last: i.createdAt });
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}
