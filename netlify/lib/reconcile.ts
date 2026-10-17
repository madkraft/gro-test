export type SyncedItem = {
  id: string;
  item: string;
  category: string;
  bought: boolean;
  createdAt: string;
  /** Title as it exists in Reminders; set once linked, so app renames don't break matching. */
  reminderTitle?: string;
  /** Reminder is completed on both sides; never touch it again. */
  reminderDone?: boolean;
};

export type Plan = {
  items: SyncedItem[];
  add: string[];
  complete: string[];
  imported: string[];
};

const norm = (s: string) => s.trim().toLowerCase();

/** Reconciles app items with the open reminders in the shared list. Titles are the only key Shortcuts exposes. */
export function reconcile(current: SyncedItem[], openTitles: string[]): Plan {
  const open = new Map(openTitles.map((t) => [norm(t), t]));
  const claimed = new Set<string>();
  const add: string[] = [];
  const complete: string[] = [];

  const items = current.map((original) => {
    const item = { ...original };
    if (item.reminderDone) return item;

    if (item.reminderTitle === undefined) {
      if (item.bought) return item;
      const key = norm(item.item);
      const existing = open.get(key);
      claimed.add(key);
      if (existing === undefined) {
        // ponytail: assumes the shortcut adds it; if that run fails, the next sync marks it bought.
        add.push(item.item);
        item.reminderTitle = item.item;
      } else {
        item.reminderTitle = existing;
      }
      return item;
    }

    const key = norm(item.reminderTitle);
    if (!open.has(key)) {
      item.bought = true;
      item.reminderDone = true;
    } else {
      claimed.add(key);
      if (item.bought) {
        complete.push(item.reminderTitle);
        item.reminderDone = true;
      }
    }
    return item;
  });

  const imported = [...open].filter(([key]) => !claimed.has(key)).map(([, t]) => t);
  return { items, add, complete, imported };
}
