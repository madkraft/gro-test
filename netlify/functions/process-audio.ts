import { ApiError, GoogleGenAI, Type, createUserContent } from "@google/genai";

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

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { success: false, error: "Missing GEMINI_API_KEY." },
      { status: 500 },
    );
  }

  try {
    const body = (await req.json()) as { text?: string };
    const listText = typeof body.text === "string" ? body.text.trim() : "";

    if (!listText) {
      return Response.json(
        { success: false, error: "Expected JSON body with non-empty text." },
        { status: 400 },
      );
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

    return Response.json({
      success: true,
      message: "List parsed.",
      items: groceryItems,
    });
  } catch (err) {
    console.error(err);
    const message =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to process input.";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};
