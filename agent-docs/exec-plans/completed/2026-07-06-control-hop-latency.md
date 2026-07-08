Goal (incl. success criteria):
- Split the measured web-to-Cloudflare direct ensure wake latency into same-clock sub-timings.
- Ship the two low-complexity warm-path optimizations: web-side process OIDC token reuse and web-only keep-alive connection reuse.
- Success means new optional orchestration leaves round-trip through shared contracts, Cloudflare records auth timing, web records request/token timing, tests cover parser/persistence/cache behavior, and the direct wake remains best-effort.

Constraints/Assumptions:
- Keep Cloudflare-hosted-control transport-agnostic; no Node-only imports in packages used by the Worker bundle.
- New timing leaves are additive and optional for web/Cloudflare deploy skew.
- Compute only same-clock spans downstream; store cross-clock epochs only as raw leaves.
- Token reuse must preserve audience/auth semantics and never serve expired or near-expired tokens.
- No runner bundle rebuild.

Key decisions:
- Inject a web-local undici Agent through the existing fetch implementation seam rather than changing the shared client.
- Use module-scoped web OIDC token cache keyed by audience/config identity with expiry safety margin.
- Thread web timing leaves as internal headers on the direct ensure request; Cloudflare merges them into orchestration diagnostics with auth start/finish leaves.

State:
- Implementation and scoped verification complete; ready to close with a scoped commit.

Done:
- Required routing, architecture, security, reliability, and verification docs read.
- Worktree confirmed clean on the requested branch.
- Added optional orchestration timing leaves across hosted-execution shape, parser, leaf key list, Cloudflare response assembly, and web latency-store persistence.
- Added direct ensure client timing callback/header emission without adding Node-only imports to the shared Cloudflare control package.
- Added web-only keep-alive fetch dispatcher injection in `apps/web`.
- Added module-scoped expiry-aware Vercel OIDC token cache in `apps/web`.
- Added/extended focused tests for token cache, runtime-control parser round-trip, hosted latency persistence, Cloudflare ensure route diagnostics, and shared control client headers/callback.
- Verification passed: touched package/app typechecks, focused tests, dependency policy guard, ignored-builds check, web lint, and `git diff --check`.
- Broader `pnpm test:diff` passed repo guards but is blocked by unrelated assistant CLI/engine typecheck failures from global lockfile scope.

Now:
- Close active plan and create scoped commit.

Next:
- Handoff with measurable leaves, verification results, and deploy-shape notes.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-execution/control.ts
- apps/web/src/lib/hosted-execution/auth-adapter.ts
- apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts
- apps/web/src/lib/hosted-runtime-latency/store.ts
- apps/web/test/*latency*
- apps/web/test/*hosted-execution*
- apps/cloudflare/src/worker/auth.ts
- apps/cloudflare/src/auth-adapter.ts
- apps/cloudflare/src/worker/route-handlers/runtime-control.ts
- apps/cloudflare/src/worker/routes.ts
- packages/cloudflare-hosted-control/src/client.ts
- packages/cloudflare-hosted-control/test/*
- packages/hosted-execution/src/runtime-control.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/test/*
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
