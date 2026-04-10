import { getStore } from "@netlify/blobs";
import type { Handler } from "@netlify/functions";

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

export const handler: Handler = async (event) => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  if (event.httpMethod === "GET") {
    try {
      const raw = await store.get(DATA_KEY, { type: "json" });
      const items = Array.isArray(raw)
        ? raw.filter(isGroceryItem)
        : ([] as GroceryItem[]);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      };
    } catch (error) {
      console.error("grocery-items GET:", error);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Failed to read list.",
        }),
      };
    }
  }

  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body ?? "{}") as { items?: unknown };
      if (!Array.isArray(body.items)) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            success: false,
            error: "Expected JSON body with items array.",
          }),
        };
      }
      const items = body.items.filter(isGroceryItem);
      await store.setJSON(DATA_KEY, items);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, items }),
      };
    } catch (error) {
      console.error("grocery-items POST:", error);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Failed to save list.",
        }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Method not allowed" }),
  };
};
