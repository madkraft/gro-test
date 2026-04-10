# Grocery Assistant

Voice or typed list → **Gemini** extracts Polish grocery items with categories. Data is **local-first** (`localStorage`) and syncs to **Netlify Blobs** when online. **PWA**: install to home screen; list and check-off work offline; AI needs a connection.

## Tech stack

- React, TypeScript, Vite
- TanStack Router, TanStack Query
- `vite-plugin-pwa` (Workbox precache)
- Netlify Functions: `process-audio` (Gemini), `grocery-items` (Blobs)

## Prerequisites

1. **Google AI Studio API key** — [aistudio.google.com](https://aistudio.google.com)
2. **Netlify** — Blobs are enabled on your site (default on current plans)

## Environment

| Variable         | Where                                      |
| ---------------- | ------------------------------------------ |
| `GEMINI_API_KEY` | Netlify env + local `.env` for `netlify dev` |

Copy `.env.example` to `.env`. Do not expose the key in `VITE_*` variables.

## Scripts

- `pnpm dev` — Vite (functions return 404 unless proxied).
- `pnpm dev:netlify` — Vite + Netlify functions + Blobs (uses `.env`).
- `pnpm routes` — regenerate `src/routeTree.gen.ts` (also runs at start of `pnpm build`).
- `pnpm build` — `tsr generate`, TypeScript check, production client + PWA assets to `dist/`.

## PWA icons

`public/pwa-192x192.png` and `public/pwa-512x512.png` are used for the install prompt.

## Netlify

`netlify.toml` builds with `pnpm run build`, publishes `dist/`, and redirects `/*` → `/index.html` for the SPA. Add `GEMINI_API_KEY` under **Site configuration → Environment variables**.
