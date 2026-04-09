import {
  ApiError,
  GoogleGenAI,
  createPartFromBase64,
  createUserContent,
} from "@google/genai";
import type { Handler } from "@netlify/functions";

const PROMPT = `Listen to the audio. The speaker is listing groceries in Polish and English.
        Extract the items, translate them to Polish, and output the result STRICTLY
        as a JSON array of objects with 'item' and 'quantity' keys. Do not include markdown.`;

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

    let groceryItems: unknown;
    try {
      groceryItems = JSON.parse(cleanText) as unknown;
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
          : "Failed to process audio.";
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: message }),
    };
  }
};
