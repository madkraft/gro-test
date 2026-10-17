export type GroceryItem = {
  id: string;
  item: string;
  category: string;
  bought: boolean;
  createdAt: string;
  /** Set by reminders-sync; see netlify/lib/reconcile.ts. */
  reminderTitle?: string;
  reminderDone?: boolean;
};

export const CATEGORIES = [
  "🥯 Piekarnia",
  "🍇 Owoce i warzywa",
  "🍜 Sypane / przyprawy",
  "🧊 Lodówka / mleczny",
  "🥩 Mięso",
  "🛒 Rossmann / apteka",
  "🥤 Napoje",
  "🏠 Dla domu",
  "👶 Tadziu",
  "🧒 Julcia",
  "❓ Inne",
] as const;
