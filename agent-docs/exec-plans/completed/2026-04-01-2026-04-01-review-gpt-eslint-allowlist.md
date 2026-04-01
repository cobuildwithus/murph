# Allow Next ESLint configs in the source-artifact guard

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Unblock `pnpm review:gpt` by teaching the handwritten-source guard that the checked-in Next flat ESLint configs for `packages/local-web` and `apps/web` are intentional framework config files, not stray source artifacts.

## Success criteria

- `pnpm no-js` passes with the tracked ESLint configs present.
- `pnpm review:gpt --dry-run` succeeds instead of failing on `packages/local-web/eslint.config.mjs` and `apps/web/eslint.config.mjs`.
- Required repo verification is attempted, with any unrelated branch-local blockers recorded explicitly.

## Scope

- In scope:
- `scripts/check-no-js.ts`
- Verification docs and index entries that describe the source-artifact allowlist
- Out of scope:
- Changing `review:gpt` preset behavior or bundle contents
- Refactoring the ESLint configs themselves

## Constraints

- Technical constraints:
- Preserve the repo's JS-like source-artifact guard and keep the allowlist explicit and path-scoped.
- Product/process constraints:
- Preserve unrelated dirty worktree edits.
- Use the active coordination ledger and required completion audit path.

## Risks and mitigations

1. Risk: expanding the allowlist could quietly weaken the handwritten-artifact policy.
   Mitigation: keep the change limited to the two existing fixed ESLint config paths and update the durable docs to match.
2. Risk: repo-wide verification may still fail because the branch already has many unrelated active changes.
   Mitigation: run the required commands anyway and record exact unrelated blockers if they remain.

## Tasks

1. Add the two ESLint config paths to the explicit source-artifact allowlist.
2. Update the verification docs and index language so the durable policy matches the guard.
3. Verify with `pnpm no-js`, `pnpm review:gpt --dry-run`, and the required repo commands.
4. Run the required finish review, address any findings, then close the plan with a scoped commit.

## Decisions

- Treat the two checked-in Next ESLint flat configs the same way the repo already treats the checked-in PostCSS configs: explicit fixed-path allowlist entries in the handwritten-artifact guard.

## Verification

- Commands to run:
- `pnpm no-js`
- `pnpm review:gpt --dry-run`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- The guard no longer flags the two ESLint config files.
- `review:gpt` stages its dry-run audit bundle successfully.
- Repo-wide verification passes, or any unrelated blockers are identified precisely.

### Ran

- Passed: `pnpm no-js`
- Passed: `pnpm review:gpt --dry-run`
- Passed: `pnpm typecheck`
- Failed, unrelated: `pnpm test`
- Failed, unrelated: `pnpm test:coverage`

### Results

- The handwritten-artifact guard now allows the tracked `packages/local-web/eslint.config.mjs` and `apps/web/eslint.config.mjs` files.
- `pnpm review:gpt --dry-run` completed and staged the audit package successfully.
- `pnpm test` and `pnpm test:coverage` both got past the original guard and then failed in the pre-existing `apps/web verify` lint lane on unrelated branch issues, including `prefer-const` errors in `apps/web/src/lib/hosted-onboarding/stripe-revnet-issuance.ts` and `apps/web/src/lib/hosted-share/link-service.ts`, plus many existing `@typescript-eslint/no-explicit-any` errors across hosted-onboarding test files.
Completed: 2026-04-01
