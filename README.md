# Grocery Assistant

Voice recording → Gemma extracts a grocery JSON list → (optional) Notion.

## Tech Stack

- React
- TypeScript
- Vite
- Netlify Functions (`netlify/functions/process-audio.ts`)

## Prerequisites

1. **Google AI Studio API key** — [aistudio.google.com](https://aistudio.google.com)
2. **Netlify account** — connect the Git repo or deploy with the CLI

## Environment

| Variable         | Where                         |
| ---------------- | ----------------------------- |
| `GEMINI_API_KEY` | Netlify UI + local `.env` for `netlify dev` |

Copy `.env.example` to `.env` for local function runs. Do not expose this key in `VITE_*` variables.

## Scripts

- `pnpm dev` — Vite only (function URL will 404 unless you proxy or use Netlify).
- `pnpm dev:netlify` — Vite + functions (uses `.env` for `GEMINI_API_KEY`).
- `pnpm build` — production client bundle to `dist/`.

## Netlify

`netlify.toml` sets `build.command` to `pnpm run build`, `publish` to `dist`, and `functions` to `netlify/functions`. Add `GEMINI_API_KEY` under **Site configuration → Environment variables**.

After linking the site (`netlify init` / `netlify link`), deploy with `netlify deploy --prod` or Git-based builds.
