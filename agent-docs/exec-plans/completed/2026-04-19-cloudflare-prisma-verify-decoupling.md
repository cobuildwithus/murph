## Goal

Unblock `Deploy Cloudflare Hosted Execution` by removing the accidental hosted-web Prisma type dependency from the `apps/cloudflare verify` graph.

## Why now

- GitHub Actions run `24631294870` failed in `pnpm --dir apps/cloudflare verify`.
- The last successful deploy workflow was run `24549998834` at commit `217006a`.
- After that successful run, Cloudflare test helpers began importing `apps/web/src/testing.ts`, and those seed helpers now expose Prisma-backed hosted-web modules to Cloudflare typecheck.

## Guardrails

- Keep the fix narrow to the hosted-web testing bridge used by Cloudflare tests.
- Prefer reducing cross-app compile coupling over adding more deploy-only setup.
- Avoid changing production runtime behavior.

## Plan

1. Break the type-level dependency from `apps/web/src/testing.ts` into Prisma-backed hosted-web modules.
2. Verify `pnpm --dir apps/cloudflare verify` on the current workspace.
3. If verification still needs fresh Prisma generation, add the smallest explicit prep step with the dependency documented.

## Outcome

- Replaced type-level `typeof import(...)` references in the hosted-web Cloudflare test seed helpers with narrow runtime bridge interfaces.
- Kept the runtime dynamic imports intact for local full-stack helpers, but stopped `apps/cloudflare verify` from statically loading Prisma-backed hosted-web source during typecheck.
- Verified the original failing lane with `pnpm --dir apps/cloudflare verify`.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
