Goal (incl. success criteria):
- Reduce hosted web Vercel build memory after PR 310 enough to avoid enhanced build machines if possible.
- Identify the concrete memory-heavy build step or input and land the smallest maintainable fix.

Constraints/Assumptions:
- Preserve PR 310 runtime behavior and hosted Linq observability semantics.
- Do not weaken production migrations, Next build validation, or app verification to hide the issue.
- Avoid exposing local paths, account names, secrets, or provider payloads in committed files or handoff.
- Work in a clean task worktree so unrelated local dirty files do not affect the build profile.

Key decisions:
- Treat enhanced Vercel build machines as a temporary mitigation, not the desired steady state.
- Start with Vercel build logs plus local memory profiling before changing code.

State:
- Active.

Done:
- Read routing, architecture, verification, completion, Vercel CLI, and Next.js build guidance.
- Confirmed PR 310 merge is the current main head and has a large hosted Linq observability diff.
- Confirmed failed Vercel deployments exit 137 during `next build` after migrations and generated prebuild steps complete.
- Profiled the hosted web build locally at roughly 6.48 GB max RSS before changes, close enough to Vercel's 8 GB standard builder limit to explain OOM with platform overhead.
- Added a Next production-build tsconfig that excludes `apps/web/test` from `next build` while preserving the full app typecheck.
- Split lightweight device-sync Junction config, credential-policy, provider-match, and job-definition entrypoints away from heavy provider manifest/factory imports.
- Capped Next production build workers at 2; measured the clean hosted web build at roughly 6.18 GB max RSS with `Collecting page data using 2 workers`.
- Verified with hosted web tests/typecheck/build and device-sync tests/typecheck.

Now:
- Final cleanup and scoped commit.

Next:
- Use a normal Vercel builder preview after merge to confirm the platform build no longer OOMs.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: exact Vercel standard-builder peak memory after this change until a preview deployment runs on that builder class.

Working set (files/ids/commands):
- `apps/web/**`
- `apps/web/vercel.json`
- `apps/web/next.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.next.json`
- `packages/device-syncd/**`
- `package.json`
- Vercel deployments: failed production build for PR 310 merge, exit 137 during `next build`.
- Verification: `pnpm --dir packages/device-syncd test`; `pnpm --dir packages/device-syncd typecheck`; `pnpm --dir apps/web typecheck`; `pnpm --dir apps/web test:prepared -- apps/web/test/next-config.test.ts apps/web/test/device-sync-junction-workout-diagnostic-route.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts`; `/usr/bin/time -l env NEXT_TELEMETRY_DISABLED=1 VERCEL=1 VERCEL_ENV=preview pnpm --dir apps/web build`.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
