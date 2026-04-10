import {
  ApiError,
  GoogleGenAI,
  Type,
  createPartFromBase64,
  createUserContent,
} from "@google/genai";

const GEMINI_PRIMARY_MODEL = "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = [
  "gemini-2.5-flash-lite", // Primary: The absolute cheapest, fastest stable model
  "gemini-3.1-flash-lite-preview", // Backup 1: The next-gen cheap model
  "gemini-3.1-flash-lite-preview", // The absolute fastest, lowest-latency model for simple text/audio
  "gemini-3-flash-preview", // The newest stable generation
];

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

const TEXT_PROMPT = `The user provided this grocery list (Polish and/or English).
CRITICAL INSTRUCTION: Ignore all conversational filler, hesitations, and irrelevant chatter (like "No może", "yyy", "kupmy jeszcze"). Extract ONLY the actual grocery items.
Extract the items, translate them to Polish, and categorize them.`;

const AUDIO_PROMPT = `Listen to this audio recording. The speaker is listing groceries in Polish and/or English.
CRITICAL INSTRUCTION: Ignore all conversational filler, hesitations, and irrelevant chatter (like "No może", "yyy", "kupmy jeszcze"). Extract ONLY the actual grocery items.
Translate all items to Polish and categorize each one.`;

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
    const body = (await req.json()) as {
      text?: string;
      audioData?: string;
      mimeType?: string;
    };

    const listText = typeof body.text === "string" ? body.text.trim() : "";
    const audioData =
      typeof body.audioData === "string" ? body.audioData : null;
    const mimeType =
      typeof body.mimeType === "string" ? body.mimeType : "audio/webm";

    if (!listText && !audioData) {
      return Response.json(
        {
          success: false,
          error: "Expected JSON body with non-empty text or audioData.",
        },
        { status: 400 },
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const contents = audioData
      ? createUserContent([
          createPartFromBase64(audioData, mimeType),
          AUDIO_PROMPT,
        ])
      : createUserContent([`${TEXT_PROMPT}\n\n---\n${listText}\n---`]);

    const tryGenerate = (model: string) =>
      ai.models.generateContent({ model, config: generateConfig, contents });

    const isUnavailable = (err: unknown) => {
      const unavailable =
        err instanceof ApiError &&
        [503, 404, 500].includes(err.status as number);
      if (unavailable) {
        console.warn(`[process-audio] Model unavailable (status ${(err as ApiError).status}):`, err);
      }
      return unavailable;
    };

    let modelUsed = GEMINI_PRIMARY_MODEL;
    let response = await tryGenerate(GEMINI_PRIMARY_MODEL).catch(
      async (primaryErr: unknown) => {
        if (!isUnavailable(primaryErr)) throw primaryErr;

        for (const fallback of GEMINI_FALLBACK_MODELS) {
          try {
            const res = await tryGenerate(fallback);
            modelUsed = fallback;
            return res;
          } catch (fallbackErr) {
            if (!isUnavailable(fallbackErr)) throw fallbackErr;
          }
        }
        throw primaryErr;
      },
    );

    const groceryItems = JSON.parse(response.text ?? "[]") as GroceryItem[];

    return Response.json({
      success: true,
      message: "List parsed.",
      items: groceryItems,
      model: modelUsed,
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
