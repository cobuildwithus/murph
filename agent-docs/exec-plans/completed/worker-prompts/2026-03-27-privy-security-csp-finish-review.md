You are Codex Audit Worker PR operating in the current shared worktree. Do not create a commit.

Before any edits:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add a row as `Codex Audit Worker PR` only if you need to edit files; review-only is preferred.
- Preserve unrelated in-flight edits and do not revert anything.

Task:
- Run the required completion-workflow final review audit for the Privy security/CSP change in `apps/web`.
- Read and follow `agent-docs/prompts/task-finish-review.md` exactly.

Review scope:
- `apps/web/next.config.ts`
- `apps/web/test/next-config.test.ts`
- `apps/web/.env.example`
- Any directly affected code/tests needed to assess regressions or residual risk.

What changed and why:
- Added security headers for the hosted web app via `next.config.ts`.
- Added a Content Security Policy aligned with Privy's documented requirements for `@privy-io/react-auth`, including WalletConnect and Cloudflare Turnstile domains.
- Added optional `PRIVY_BASE_DOMAIN` support so domain-specific Privy origins can be allowed in CSP when a Privy base domain is used.
- Added tests covering CSP construction, optional base-domain normalization, production-vs-development behavior, and Next header wiring.
- Added `.env.example` guidance for the remaining Privy dashboard-side checklist items that cannot be enforced in app code.

Why this implementation fits the current system:
- `apps/web` already centralizes cross-app Next config in `next.config.ts`, so adding header generation there keeps the change narrow and framework-native.
- Existing hosted onboarding flows already use Privy identity tokens and secure session cookies; this change hardens the browser boundary without introducing new runtime abstractions.

Invariants and assumptions:
- The hosted app currently needs `style-src 'unsafe-inline'` because existing pages/components rely on inline React styles.
- The current Next CSP approach is header-based and not nonce-based, so inline scripts remain allowed and `unsafe-eval` is development-only.
- Behavior outside browser security headers must remain unchanged.

Verification evidence already run:
- `pnpm --dir apps/web typecheck` -> passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/next-config.test.ts` -> passed.
- `pnpm --dir apps/web test` -> passed.
- `pnpm typecheck` -> failed outside this scope in `packages/assistant-runtime` with pre-existing cross-package `rootDir` errors.
- `pnpm test` -> failed outside this scope in `apps/cloudflare` and `packages/runtime-state`.
- `pnpm test:coverage` -> failed outside this scope in `apps/web/src/lib/device-sync/prisma-store.ts`.

Direct scenario proof:
- No browser inspection was required because this change is server-config/header-only; proof is currently limited to automated config tests plus successful `apps/web` build/test.

Output:
- Return only the copy/paste-ready prompts requested by `agent-docs/prompts/task-finish-review.md`.
