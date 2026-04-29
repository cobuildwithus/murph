# Security Privacy Copy

## Goal

Tighten public hosted/local security and privacy copy so it matches Murph's current architecture without implying zero-knowledge, operator-blind, or end-to-end encryption guarantees.

Success means:

- Public security and homepage copy describes encrypted hosted storage and limited readable processing plainly.
- Local Murph copy clearly distinguishes local vault storage from hosted Murph storage.
- No public copy claims or implies that only the user can access hosted health data.
- Focused checks and required review passes complete or any unrelated blockers are recorded.

## Scope

- `apps/web/app/security/page.tsx`
- `apps/web/app/security/opengraph-image.tsx`
- `apps/web/src/components/homepage/security-teaser-section.tsx`
- `apps/web/src/components/homepage/faq-section.tsx`
- Directly coupled metadata tests only if copy expectations require updates.

## Constraints

- Preserve existing unrelated dirty work.
- Do not change layout, styling, routes, runtime behavior, auth, schemas, or legal docs in this task.
- Use plain, direct language and avoid legalistic over-explanation on marketing surfaces.
- Keep legal-risk claims aligned with existing privacy-policy and terms language.

## Progress

- Done: updated public security/homepage/FAQ copy, fixed review findings, and ran focused checks.
- Now: close the plan and hand off. A scoped commit is blocked by overlapping dirty work in the same files.
- Next: none for this task.

## Verification

- `rg` stale-claim scan over `apps/web/app apps/web/src/components apps/web/test`: no matches for the old risky phrases.
- `git diff --check` for touched files passed.
- `pnpm exec vitest run apps/web/test/route-metadata-pages.test.ts --config apps/web/vitest.workspace.ts --no-coverage` passed.
- `pnpm --dir apps/web exec eslint app/security/page.tsx app/security/opengraph-image.tsx src/components/homepage/security-teaser-section.tsx src/components/homepage/faq-section.tsx test/route-metadata-pages.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed once before audit fixes; the post-fix rerun is blocked by unrelated active work in `apps/web/test/start-experiment-button.test.ts`.
- `pnpm test:diff ...` is blocked by an unrelated raw-log guard finding in `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`.
- Full `pnpm --dir apps/web lint` is blocked by existing generated `.next-smoke-codex-repro/**` output; touched-file ESLint passed.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
