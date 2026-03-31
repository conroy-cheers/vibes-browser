Server-owned scaffolding notes:

- The local server injects hidden page-binding inputs into declared forms after validation.
- The local server injects a small no-cache pageshow handler.
- The local server wraps your fragment in a minimal page shell with base CSS.
- The fragment will be inserted inside `<main data-vb-main="true"><div data-vb-page="true">...</div></main>`.
- There is no server-owned header or footer. Your fragment is the whole visible page.
- Keep the page self-contained and readable without external assets.
- Give major interactive regions stable ids or data attributes so inline JavaScript has clear hooks.
- Prefer semantic sections, obvious navigation blocks, and visible calls to action.
- Write plenty of text content. The page should feel inhabited and interesting to read.
- If you include a `<style>` block, treat it as page-scoped refinement for content inside `[data-vb-page="true"]`, not a full-site redesign.
