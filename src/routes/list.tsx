import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useGroceryList } from "../hooks/useGroceryList";
import { getItems } from "../lib/storage";
import type { GroceryItem } from "../types/grocery";

export const Route = createFileRoute("/list")({
  component: ListPage,
});

function groupByCategory(rows: GroceryItem[]): Map<string, GroceryItem[]> {
  const map = new Map<string, GroceryItem[]>();
  for (const row of rows) {
    const key = row.category;
    const list = map.get(key);
    if (list) {
      list.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return map;
}

function ListPage() {
  const { items, updateList } = useGroceryList();
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());

  const visible = useMemo(() => {
    return items.filter((i) => !i.bought || exitingIds.has(i.id));
  }, [items, exitingIds]);

  const grouped = useMemo(() => groupByCategory(visible), [visible]);

  const categories = useMemo(() => {
    return Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  }, [grouped]);

  const handleMarkBought = (id: string) => {
    setExitingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      const current = getItems().map((i) =>
        i.id === id ? { ...i, bought: true } : i,
      );
      updateList(current);
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 280);
  };

  return (
    <main className="page page--list">
      {categories.length === 0 ? (
        <p className="page__empty">lista pusta</p>
      ) : (
        <div className="list">
          {categories.map((cat) => {
            const rows = grouped.get(cat) ?? [];
            return (
              <section key={cat} className="list__group">
                <h2 className="list__cat">{cat.toUpperCase()}</h2>
                <ul className="list__ul">
                  {rows.map((row) => {
                    const exiting = exitingIds.has(row.id);
                    return (
                      <li
                        key={row.id}
                        className={
                          exiting ? "list__row list__row--exit" : "list__row"
                        }
                      >
                        <span className="list__name">{row.item}</span>
                        <button
                          type="button"
                          className="list__dismiss"
                          aria-label={`Mark ${row.item} bought`}
                          onClick={() => handleMarkBought(row.id)}
                        >
                          [×]
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
