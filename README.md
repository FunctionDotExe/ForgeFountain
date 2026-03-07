# Hypixel Bazaar Gemstones Viewer

Forge and craft flip dashboard for Hypixel market data.

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000`.

## GitHub Pages deployment

- A workflow is included at `.github/workflows/deploy-pages.yml`.
- It deploys only the `public/` directory.
- `server.js`, environment variables, and local config files are not published to `*.github.io`.
- `public/.nojekyll` is included to avoid Jekyll processing.

## Security notes

- Keep secrets only in environment variables (`HYPIXEL_KEY`), never in frontend files.
- `.gitignore` blocks `.env*`, `node_modules`, and editor/system artifacts from accidental commit.
