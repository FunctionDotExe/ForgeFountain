# ForgeFountain

Welcome to **ForgeFountain**, your slightly chaotic, highly profitable Hypixel flip command center.

Think of it as a beacon for your coins:
- Forge flips
- Craft flips
- Shard fusion ideas
- Live-ish market math without spreadsheet pain

## What This Is

`ForgeFountain` tracks Hypixel Bazaar and recipe data so you can spot profitable forge/craft opportunities fast.

If you like numbers, profit, and pretending you're an economist in full enchanted armor, you are home.

## Play Online (No Download Needed)

Use ForgeFountain directly in your browser:

- `https://functiondotexe.github.io/ForgeFountain/`

No install, no setup, no mods folder required.

## Local Setup (Dev Only)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start server:
   ```bash
   npm start
   ```
3. Open locally:
   `http://localhost:3000`

## GitHub Pages (Skyblock Cloud Edition)

Deployment workflow lives at:
- `.github/workflows/deploy-pages.yml`

Important details:
- Only `public/` is deployed to GitHub Pages.
- Backend files like `server.js` are **not** published to `*.github.io`.
- Local env/config files are not published.
- `public/.nojekyll` is included so static files render correctly.

## Security (No Coin-Leaking Enchant)

- Never hardcode secrets in frontend files.
- Keep keys in environment variables only (`HYPIXEL_KEY`).
- `.gitignore` blocks `.env*`, `node_modules`, and editor/system junk.

## Name Change

Project name is now **ForgeFountain**.

If anyone asks why: because "Hypixel Bazaar Gemstones Viewer" sounds like a tax form.
