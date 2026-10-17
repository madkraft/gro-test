import { ApiError, GoogleGenAI, type ContentListUnion, type Schema } from "@google/genai";

const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];

// Free-tier quotas are per model, so a 429 is worth retrying on the next one.
const isUnavailable = (err: unknown) =>
  err instanceof ApiError && [404, 429, 500, 503].includes(err.status as number);

export async function generateJson<T>(contents: ContentListUnion, schema: Schema): Promise<{ data: T; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY.");
  const ai = new GoogleGenAI({ apiKey });
  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents,
        config: { responseMimeType: "application/json", responseSchema: schema },
      });
      return { data: JSON.parse(res.text ?? "null") as T, model };
    } catch (err) {
      if (!isUnavailable(err)) throw err;
      console.warn(`[gemini] ${model} unavailable (${(err as ApiError).status}), trying next`);
      lastErr = err;
    }
  }
  throw lastErr;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Gemini request failed.");
