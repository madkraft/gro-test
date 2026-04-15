import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useGroceryList } from "../hooks/useGroceryList";
import { CATEGORIES } from "../types/grocery";
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

type EditState = {
  id: string;
  item: string;
  category: string;
};

function ListPage() {
  const { items, updateList } = useGroceryList();
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<EditState | null>(null);

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
      const current = items.map((i) =>
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

  const handleEditStart = (row: GroceryItem) => {
    setEditing({ id: row.id, item: row.item, category: row.category });
  };

  const handleEditSave = () => {
    if (!editing) return;
    const trimmed = editing.item.trim();
    if (!trimmed) return;
    const updated = items.map((i) =>
      i.id === editing.id
        ? { ...i, item: trimmed, category: editing.category }
        : i,
    );
    updateList(updated);
    setEditing(null);
  };

  const handleEditCancel = () => {
    setEditing(null);
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
                    const isEditing = editing?.id === row.id;
                    return (
                      <li
                        key={row.id}
                        className={
                          exiting
                            ? "list__row list__row--exit"
                            : isEditing
                              ? "list__row list__row--editing"
                              : "list__row"
                        }
                      >
                        {isEditing ? (
                          <div className="list__edit-form">
                            <input
                              className="list__edit-input"
                              value={editing.item}
                              onChange={(e) =>
                                setEditing((prev) =>
                                  prev ? { ...prev, item: e.target.value } : prev,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleEditSave();
                                if (e.key === "Escape") handleEditCancel();
                              }}
                              autoFocus
                            />
                            <div className="list__edit-row">
                              <select
                                className="list__edit-select"
                                value={editing.category}
                                onChange={(e) =>
                                  setEditing((prev) =>
                                    prev
                                      ? { ...prev, category: e.target.value }
                                      : prev,
                                  )
                                }
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <div className="list__edit-actions">
                                <button
                                  type="button"
                                  className="list__edit-btn"
                                  onClick={handleEditSave}
                                  aria-label="Save"
                                >
                                  [✓]
                                </button>
                                <button
                                  type="button"
                                  className="list__edit-btn"
                                  onClick={handleEditCancel}
                                  aria-label="Cancel"
                                >
                                  [×]
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span
                              className="list__name list__name--editable"
                              role="button"
                              tabIndex={0}
                              onClick={() => handleEditStart(row)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ")
                                  handleEditStart(row);
                              }}
                            >
                              {row.item}
                            </span>
                            <button
                              type="button"
                              className="list__dismiss"
                              aria-label={`Mark ${row.item} bought`}
                              onClick={() => handleMarkBought(row.id)}
                            >
                              [×]
                            </button>
                          </>
                        )}
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
