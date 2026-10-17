import { Type } from "@google/genai";
import { CATEGORIES } from "../../src/types/grocery";
import { errorMessage, generateJson } from "../lib/gemini";

// Body { names: string[] } → { categories: string[] } in the same order. Names are never rewritten.
export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const body = (await req.json().catch(() => ({}))) as { names?: unknown };
  const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string") : [];
  if (names.length === 0) return Response.json({ categories: [] });

  const prompt = `Categorize each grocery item (Polish or English) for shopping in a Polish supermarket.
Return exactly ${names.length} categories, one per line below, in the same order.

${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}`;

  try {
    const { data } = await generateJson<string[]>(prompt, {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: [...CATEGORIES] },
    });
    if (!Array.isArray(data) || data.length !== names.length) {
      return Response.json({ error: "Model returned a mismatched list." }, { status: 502 });
    }
    return Response.json({ categories: data });
  } catch (err) {
    console.error(err);
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
};
