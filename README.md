# Pip

A voice helper that guides children through conflicts with each other — calming
down, naming feelings, telling their side, listening, solving the problem
together, and repairing afterwards. A parent starts every session and stays
nearby.

Private pilot for a handful of invited families. Not a public product.

- **Live site:** https://pip.linnewiel.com
- **Project brief and ground rules:** [`CLAUDE.md`](./CLAUDE.md)
- **Where it stands:** [`PROGRESS.md`](./PROGRESS.md)
- **Why it is built this way:** [`DECISIONS.md`](./DECISIONS.md)
- **Agent instructions:** kept out of this repository until phase 3 — see `CLAUDE.md` section 12

## How it fits together

| Part | Runs on | Does |
| --- | --- | --- |
| Website | GitHub Pages | Parent area, kids' screen, admin area |
| Backend | Supabase | Login, database, row-level security, edge functions |
| Voice | ElevenLabs | Pip's voice, talking straight to the browser |

Children's voices never touch our servers. The browser connects directly to
ElevenLabs using a short-lived token issued by an edge function. No audio is
stored anywhere, and transcripts are never sent to our database.

## Working on it

Needs Node 20 or newer.

```sh
npm install     # once
npm run dev     # local site at http://localhost:5173
npm run build   # production build into dist/
npm run preview # serve the production build locally
```

Copy `.env.example` to `.env` and fill it in. **`.env` is never committed** —
this repository is public.

## Deployment

Every push to `main` builds the site and publishes it to GitHub Pages at
`pip.linnewiel.com`. See [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml).

## Layout

```
index.html                 the site's pages live at the root
src/styles/                stylesheets, starting with the design tokens
src/lib/                   shared browser code
public/                    copied to the site root as-is (CNAME, robots.txt, icons)
supabase/                  database migrations and edge functions
agent/                     the ElevenLabs prompt template and the script that pushes it (phase 3)
```
