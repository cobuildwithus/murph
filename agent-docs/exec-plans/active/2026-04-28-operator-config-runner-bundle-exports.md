Goal (incl. success criteria):
- Fix the production runner bundle build failure where `pnpm --dir apps/cloudflare runner:docker:smoke` fails while building `@murphai/assistant-cli` because TypeScript cannot resolve public `@murphai/operator-config/*` subpaths.
- Success means the narrow `@murphai/assistant-cli` build path can resolve the required operator-config subpaths without touching Dockerfile or Cloudflare Codex CLI dependency work.

Constraints/Assumptions:
- Preserve unrelated dirty work in the shared checkout.
- Do not touch Dockerfile or Cloudflare Codex CLI changes.
- Do not re-add `@openai/codex` as an `apps/cloudflare` dependency.
- Treat `packages/operator-config/package.json`, build outputs/layout, package-boundary tests, and directly coupled assistant-cli build config as the likely ownership boundary.

Key decisions:
- UNCONFIRMED until reproduction: expected root cause is a package export/build artifact mismatch in the runner bundle closure rather than an assistant-cli source import problem.

State:
- Active.

Done:
- Read repo routing, architecture, verification, completion workflow, testing map, and coordination ledger.

Now:
- Inspect operator-config exports, emitted artifacts, assistant-cli imports, and runner bundle workspace closure.

Next:
- Reproduce the focused build failure, patch the package-boundary contract, then verify assistant-cli build and focused package tests.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether runner bundle pruning omits operator-config files because `files`/`exports` drifted or because assistant-cli build config resolves subpaths differently inside the prepared bundle.

Working set (files/ids/commands):
- `packages/operator-config/package.json`
- `packages/operator-config/src/**`
- `packages/operator-config/test/**`
- `packages/assistant-cli/package.json`
- `packages/assistant-cli/tsconfig.json`
- `pnpm --dir packages/assistant-cli build`
- `pnpm --dir apps/cloudflare runner:docker:smoke` (focused failure/proof if practical)
