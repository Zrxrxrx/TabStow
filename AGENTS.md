# AGENTS.md

@/Users/zrx/.codex/RTK.md

Project-specific override: use Bun for package management and scripts in this repository. Do not use pnpm, npm, npx, or yarn commands for project dependency work.

Commit messages must use `type(scope): msg`, for example `feat(auth): add login page`.

Browser-extension constraints:
- Chrome extension runtime code must not use Bun-only APIs.
- Avoid Node-only APIs in bundled extension code.
- Keep Manifest V3 permissions minimal.
- Do not add content scripts for the MVP.
- Do not use eval, new Function, remote executable code, or CDN-loaded scripts.
- Treat the background entrypoint as a Manifest V3 service worker.
- Store durable tab sessions in IndexedDB.
- Store lightweight settings through extension storage.
- Do not commit real tokens, credentials, or user-specific values.
