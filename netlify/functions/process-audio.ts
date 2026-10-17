import { Type, createPartFromBase64, createUserContent } from "@google/genai";
import { CATEGORIES } from "../../src/types/grocery";
import { errorMessage, generateJson } from "../lib/gemini";

const PROMPT = `Listen to this audio recording. The speaker is listing groceries in Polish and/or English.
CRITICAL INSTRUCTION: Ignore all conversational filler, hesitations, and irrelevant chatter (like "No może", "yyy", "kupmy jeszcze"). Extract ONLY the actual grocery items.
Translate all items to Polish and categorize each one.`;

const schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      item: { type: Type.STRING, description: "The corrected name of the product" },
      category: { type: Type.STRING, enum: [...CATEGORIES] },
    },
    required: ["item", "category"],
  },
};

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const body = (await req.json().catch(() => ({}))) as { audioData?: unknown; mimeType?: unknown };
  if (typeof body.audioData !== "string" || body.audioData === "") {
    return Response.json({ success: false, error: "Expected audioData." }, { status: 400 });
  }
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
  try {
    const { data, model } = await generateJson<{ item: string; category: string }[]>(
      createUserContent([createPartFromBase64(body.audioData, mimeType), PROMPT]),
      schema,
    );
    return Response.json({ success: true, items: data, model });
  } catch (err) {
    console.error(err);
    return Response.json({ success: false, error: errorMessage(err) }, { status: 500 });
  }
};
