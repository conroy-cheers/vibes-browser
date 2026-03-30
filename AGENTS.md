# AGENTS

- Work from the Nix dev shell: `nix develop`.
- Use Prettier for formatting. Run `npm run format` after edits and `npm run format:check` before handing off.
- Always rerun the relevant automated tests after any significant work or any code change.
- At minimum run `npm run test:unit` after significant work.
- If browser behavior, prompts, routing, rendering, or OpenAI integration changed, also run `npm run test:browser`.
- Before finishing, make sure the packaged binary still builds with `npm run build:sea`.
- Before finishing, make sure the Nix package still builds with `nix build .#vibes-browser`.
- Keep changes compatible with the dev shell toolchain in `flake.nix`.
- Do not commit local secrets, generated build output, or temporary test artifacts.
