import { ApiError, GoogleGenAI, Type, createUserContent } from "@google/genai";
import type { Handler } from "@netlify/functions";

const GEMINI_MODEL = "gemini-2.5-flash";

type GroceryItem = { item: string; category: string };

const CATEGORIES = [
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
];

const grocerySchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      item: {
        type: Type.STRING,
        description: "The corrected name of the product",
      },
      category: { type: Type.STRING, enum: CATEGORIES },
    },
    required: ["item", "category"],
  },
};

const generateConfig = {
  responseMimeType: "application/json",
  responseSchema: grocerySchema,
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Missing GEMINI_API_KEY.",
      }),
    };
  }

  try {
    const body = JSON.parse(event.body ?? "{}") as { text?: string };
    const listText = typeof body.text === "string" ? body.text.trim() : "";

    if (!listText) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Expected JSON body with non-empty text.",
        }),
      };
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      config: generateConfig,
      contents: createUserContent([
        `The user provided this grocery list (Polish and/or English).
         NOTE: If this was dictated, it was transcribed by a tiny, phonetically-challenged offline AI. Expect heavy misspellings, phonetic guesses, and butchered grammar (e.g., "Mlego" = Mleko, "wylep" = chleb, "pomidorę" = pomidory).
         CRITICAL INSTRUCTION: Ignore all conversational filler, hesitations, and irrelevant chatter (like "No może", "yyy", "kupmy jeszcze"). Extract ONLY the actual grocery items.
         Use context clues to correct the typos to the actual real-world grocery items. Extract the items, translate them to Polish, and categorize them.

        ---
        ${listText}
        ---`,
      ]),
    });

    const groceryItems = JSON.parse(response.text ?? "[]") as GroceryItem[];

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "List parsed.",
        items: groceryItems,
      }),
    };
  } catch (err) {
    console.error(err);
    const message =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to process input.";
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: message }),
    };
  }
};
