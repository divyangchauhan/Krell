# KRELL

**Read [VISION.md](VISION.md) before making any changes.** It is the single
source of truth for this project's intent, fiction, design pillars,
architecture invariants, style guide, testing conventions, and deliberate
omissions. Keep it updated when those things change.

Quick facts:
- Run: `pnpm start` → http://localhost:3000 (bots make it playable instantly)
- No build step, no frameworks, no binary assets — vanilla ESM, canvas, WebAudio
- Tuning/shared logic lives in `public/shared/` (imported by server AND client)
- Tests: `node test/<name>.js` against a running server; browser tests need
  `npx playwright install chromium` once
- Debug hook in the client: `window.__krell`
