export type GroceryItem = {
  id: string;
  item: string;
  category: string;
  bought: boolean;
  createdAt: string;
};

export const CATEGORIES = [
  "🥯 Piekarnia",
  "🥤 Napoje",
  "🍇 Owoce i warzywa",
  "🧊 Lodówka / mleczny",
  "🛒 Rossmann / apteka",
  "🥩 Mięso",
  "🍜 Sypane / przyprawy",
  "🏠 Dla domu",
  "👶 Tadziu",
  "🧒 Julcia",
  "❓ Inne",
] as const;
