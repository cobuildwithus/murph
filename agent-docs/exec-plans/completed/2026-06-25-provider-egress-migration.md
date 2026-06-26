# Provider Egress Migration

## Goal

Land the PR 297 follow-up that moves Exa, Mapbox, Murph data API, and Workers AI transcription onto runner/provider-scoped hosted provider egress credentials, with no tokenless active-user fallback providers left.

Success means the provider credential minting and validation paths stay narrow, provider-specific request policy remains enforced, and focused hosted-runner verification passes on the task branch.

## Constraints

- Base the work on PR 297, not `main`, because the supplied patch was authored on top of that branch.
- Keep the change scoped to hosted provider egress behavior and tests.
- Preserve the existing provider-specific allowlists and request validation.
- Do not delete dormant fallback helper code in this PR unless required for correctness; leave physical removal to a deletion-only follow-up.
- Do not expose secrets, local paths, or direct identifiers in committed artifacts.

## Plan

1. Apply the supplied migration patch on the PR 297 branch.
2. Inspect the diff for architecture fit, provider authority, and unnecessary complexity.
3. Make only minimal correctness or simplification edits if inspection finds gaps.
4. Run focused hosted-runner verification plus required typecheck/acceptance checks, or report any unrelated blockers.
5. Commit through `scripts/finish-task`, push, and open a draft PR.

## Verification

- Passed: `pnpm --dir packages/parsers exec vitest run test/adapters/remote-transcription.test.ts --no-coverage`
- Passed: `pnpm --dir packages/hosted-execution exec vitest run test/assistant-capabilities.test.ts --no-coverage`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-environment.test.ts test/hosted-runtime-codex-config.test.ts --isolate=true --no-coverage`
- Passed: `pnpm --dir apps/cloudflare test:node -- apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts apps/cloudflare/test/hosted-local-test-runner-container.test.ts`
- Passed: `pnpm typecheck`
- Passed: `pnpm test:diff`
- Passed: `git diff --check`

## State

- Now: migration patch applied, credential transport hardened to avoid query-string secrets, verification passed.
- Next: commit with `scripts/finish-task`, push the branch, and open a draft PR against PR 297.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
