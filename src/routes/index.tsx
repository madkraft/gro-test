import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useGroceryList } from "../hooks/useGroceryList";
import { categoryOf, learnCategories, norm, pastNames } from "../lib/learned";
import { CATEGORIES, OTHER_CATEGORY, type GroceryItem } from "../types/grocery";

export const Route = createFileRoute("/")({
  component: GroceryPage,
});

type Row = { item: string; category?: string };
type Status = { text: string; undo?: () => void };

const USUALS_LIMIT = 12;
const SUGGESTIONS_LIMIT = 5;

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(",")[1] ?? "";
}

function GroceryPage() {
  const { items, update, isOnline } = useGroceryList();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<"voice" | "categorize" | null>(null);
  const [editing, setEditing] = useState<{ id: string; item: string; category: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const learned = useMemo(() => learnCategories(items), [items]);
  const open = useMemo(() => items.filter((i) => !i.bought), [items]);
  const openKeys = useMemo(() => new Set(open.map((i) => norm(i.item))), [open]);
  const history = useMemo(() => pastNames(items), [items]);

  const usuals = useMemo(
    () => history.filter((p) => p.count > 1 && !openKeys.has(norm(p.name))).slice(0, USUALS_LIMIT),
    [history, openKeys],
  );

  const suggestions = useMemo(() => {
    const q = norm(query);
    if (!q || /[,\n]/.test(query)) return [];
    return history
      .filter((p) => norm(p.name).includes(q) && norm(p.name) !== q && !openKeys.has(norm(p.name)))
      .sort((a, b) => Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)))
      .slice(0, SUGGESTIONS_LIMIT);
  }, [history, query, openKeys]);

  const groups = useMemo(() => {
    const map = new Map<string, GroceryItem[]>();
    for (const i of open) {
      const cat = categoryOf(i, learned);
      map.set(cat, [...(map.get(cat) ?? []), i]);
    }
    return [...map].sort(([a], [b]) => CATEGORIES.indexOf(a as never) - CATEGORIES.indexOf(b as never));
  }, [open, learned]);

  const uncategorized = open.filter((i) => categoryOf(i, learned) === OTHER_CATEGORY).length;

  const add = (rows: Row[]) => {
    const now = new Date().toISOString();
    const seen = new Set(openKeys);
    const fresh: GroceryItem[] = [];
    for (const r of rows) {
      const name = r.item.trim();
      const key = norm(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      fresh.push({
        id: crypto.randomUUID(),
        item: name,
        category: learned.get(key) ?? r.category ?? OTHER_CATEGORY,
        bought: false,
        createdAt: now,
      });
    }
    if (fresh.length === 0) {
      setStatus({ text: "Already on the list." });
      return;
    }
    update((list) => [...list, ...fresh]);
    const ids = new Set(fresh.map((f) => f.id));
    setStatus({
      text: `Added: ${fresh.map((f) => f.item).join(", ")}`,
      undo: () => update((list) => list.filter((i) => !ids.has(i.id))),
    });
  };

  const submitTyped = () => {
    const rows = query.split(/[,\n]/).map((item) => ({ item }));
    setQuery("");
    add(rows);
  };

  const setBought = (id: string, bought: boolean) =>
    update((list) => list.map((i) => (i.id === id ? { ...i, bought } : i)));

  const markBought = (row: GroceryItem) => {
    setBought(row.id, true);
    setStatus({ text: `Got: ${row.item}`, undo: () => setBought(row.id, false) });
  };

  const saveEdit = () => {
    if (!editing) return;
    const name = editing.item.trim();
    if (!name) return;
    update((list) => list.map((i) => (i.id === editing.id ? { ...i, item: name, category: editing.category } : i)));
    setEditing(null);
  };

  const toggleMic = async () => {
    if (recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus({ text: "Microphone blocked. Allow it in Settings → Safari → Microphone." });
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      setRecording(false);
      setBusy("voice");
      setStatus({ text: "Listening back… (Gemini)" });
      try {
        const mimeType = recorder.mimeType || "audio/webm";
        const audioData = await blobToBase64(new Blob(chunks, { type: mimeType }));
        const res = await fetch("/.netlify/functions/process-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioData, mimeType }),
        });
        const json = (await res.json()) as { items?: Row[]; error?: string };
        if (!res.ok || !json.items) throw new Error(json.error);
        if (json.items.length === 0) setStatus({ text: "Didn't catch any items. Try again." });
        else add(json.items);
      } catch (err) {
        setStatus({ text: `Voice failed: ${err instanceof Error && err.message ? err.message : "try again"}` });
      } finally {
        setBusy(null);
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setStatus({ text: "Recording… tap STOP when done." });
  };

  const categorize = async () => {
    const unknown = [...new Set(open.filter((i) => categoryOf(i, learned) === OTHER_CATEGORY).map((i) => i.item))];
    setBusy("categorize");
    setStatus({ text: `Sorting ${unknown.length} item(s)…` });
    try {
      const res = await fetch("/.netlify/functions/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: unknown }),
      });
      const json = (await res.json()) as { categories?: string[]; error?: string };
      if (!res.ok || !json.categories) throw new Error(json.error);
      const fromAi = new Map(unknown.map((name, i) => [norm(name), json.categories![i]]));
      update((list) =>
        list.map((i) => {
          if (i.bought || i.category !== OTHER_CATEGORY) return i;
          const category = learned.get(norm(i.item)) ?? fromAi.get(norm(i.item));
          return category ? { ...i, category } : i;
        }),
      );
      setStatus({ text: `Sorted ${unknown.length} item(s). Remembered for next time.` });
    } catch (err) {
      setStatus({ text: `Sorting failed: ${err instanceof Error && err.message ? err.message : "try again"}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="page">
      <section className="panel" aria-labelledby="add-heading">
        <h2 id="add-heading" className="panel__title">
          Add stuff
        </h2>
        <form
          className="add"
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped();
          }}
        >
          <label htmlFor="add-input" className="sr-only">
            Items, separated by commas
          </label>
          <input
            id="add-input"
            className="add__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="mleko, chleb…"
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="submit" className="btn" disabled={!query.trim()}>
            Add
          </button>
        </form>

        {suggestions.length > 0 ? (
          <ul className="chips" aria-label="Suggestions">
            {suggestions.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    setQuery("");
                    add([{ item: s.name }]);
                  }}
                >
                  + {s.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          className={recording ? "btn btn--mic btn--recording" : "btn btn--mic"}
          aria-pressed={recording}
          disabled={!isOnline || busy === "voice"}
          onClick={() => void toggleMic()}
        >
          {recording ? "■ Stop" : busy === "voice" ? "Working…" : "● Speak"}
        </button>

        {usuals.length > 0 ? (
          <>
            <h3 className="panel__subtitle">The usual suspects</h3>
            <ul className="chips" aria-label="Frequently bought">
              {usuals.map((u) => (
                <li key={u.name}>
                  <button type="button" className="chip" onClick={() => add([{ item: u.name }])}>
                    + {u.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <div className="status" role="status">
        {status ? (
          <>
            <span>{status.text}</span>
            {status.undo ? (
              <button
                type="button"
                className="status__undo"
                onClick={() => {
                  status.undo?.();
                  setStatus({ text: "Undone." });
                }}
              >
                Undo
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {uncategorized > 0 ? (
        <button
          type="button"
          className="btn btn--sort"
          disabled={!isOnline || busy === "categorize"}
          onClick={() => void categorize()}
        >
          {busy === "categorize" ? "Sorting…" : `★ Sort ${uncategorized} unsorted item${uncategorized > 1 ? "s" : ""} ★`}
        </button>
      ) : null}

      {groups.length === 0 ? (
        <p className="empty">
          Nothing to buy.
          <br />
          Go outside.
        </p>
      ) : (
        groups.map(([cat, rows]) => (
          <section key={cat} className="group" aria-label={cat}>
            <h2 className="group__title">
              <span>{cat}</span>
              <span>{rows.length}</span>
            </h2>
            <ul className="group__list">
              {rows.map((row) =>
                editing?.id === row.id ? (
                  <li key={row.id} className="row row--editing">
                    <label className="sr-only" htmlFor={`edit-${row.id}`}>
                      Name
                    </label>
                    <input
                      id={`edit-${row.id}`}
                      className="add__input"
                      value={editing.item}
                      autoFocus
                      onChange={(e) => setEditing({ ...editing, item: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <label className="sr-only" htmlFor={`cat-${row.id}`}>
                      Category
                    </label>
                    <select
                      id={`cat-${row.id}`}
                      className="row__select"
                      value={editing.category}
                      onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <div className="row__actions">
                      <button type="button" className="btn" onClick={saveEdit}>
                        Save
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={row.id} className="row">
                    <button
                      type="button"
                      className="row__check"
                      aria-label={`Got ${row.item}`}
                      onClick={() => markBought(row)}
                    >
                      [&nbsp;&nbsp;]
                    </button>
                    <button
                      type="button"
                      className="row__name"
                      aria-label={`Edit ${row.item}`}
                      onClick={() =>
                        setEditing({ id: row.id, item: row.item, category: categoryOf(row, learned) })
                      }
                    >
                      {row.item}
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))
      )}

      <footer className="footer">
        <p>
          {open.length} to buy · {history.length} things remembered
        </p>
        <p>Best viewed on iPhone at arm's length.</p>
      </footer>
    </main>
  );
}
