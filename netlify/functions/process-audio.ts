import {
  ApiError,
  GoogleGenAI,
  createPartFromBase64,
  createUserContent,
} from "@google/genai";
import { Client } from "@notionhq/client";
import type { Handler } from "@netlify/functions";

const databaseId = process.env.NOTION_DATABASE_ID;

type GroceryItem = { item: string; category: string };

const PROMPT = `Listen to the audio. The speaker is listing groceries in Polish and English.
        Extract the items, translate them to Polish, and output the result STRICTLY
        as a JSON array of objects. Do not include markdown.

        Each object MUST have two keys:
        1. 'item' (string): The name of the product.
        2. 'category' (string): You MUST categorize the item into EXACTLY ONE of the following predefined categories (including the emoji):
          - "🥯 Piekarnia"
          - "🥤 Napoje"
          - "🍇 Owoce i warzywa"
          - "🧊 Lodówka / mleczny"
          - "🛒 Rossmann / apteka"
          - "🥩 Mięso"
          - "🍜 Sypane / przyprawy"
          - "🏠 Dla domu"
          - "👶 Tadziu"
          - "🧒 Julcia"
          If you cannot figure out the category, use "❓ Inne".`;

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

  const notionApiKey = process.env.NOTION_API_KEY;
  if (!notionApiKey || !databaseId) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Missing NOTION_API_KEY or NOTION_DATABASE_ID.",
      }),
    };
  }

  try {
    const body = JSON.parse(event.body ?? "{}") as { audioData?: string };
    const audioData = body.audioData;
    if (!audioData || typeof audioData !== "string") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Expected JSON body with audioData (base64).",
        }),
      };
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: createUserContent([
        createPartFromBase64(audioData, "audio/webm"),
        PROMPT,
      ]),
    });

    const text = response.text ?? "";
    const cleanText = text
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    let groceryItems: GroceryItem[];
    try {
      const parsed = JSON.parse(cleanText) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Expected JSON array");
      }
      groceryItems = parsed as GroceryItem[];
    } catch (parseError) {
      console.error("Failed to parse JSON from AI:", text, parseError);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "AI returned invalid format.",
        }),
      };
    }

    const notionClient = new Client({ auth: notionApiKey });

    for (const item of groceryItems) {
      const name = typeof item.item === "string" ? item.item : "";
      const category =
        typeof item.category === "string" && item.category.trim() !== ""
          ? item.category
          : "❓ Inne";

      await notionClient.pages.create({
        parent: { database_id: databaseId },
        properties: {
          Name: {
            title: [{ text: { content: name } }],
          },
          Category: {
            select: { name: category },
          },
        },
      });
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "Added to Notion!",
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
          : "Failed to process audio or save to Notion.";
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: message }),
    };
  }
};
