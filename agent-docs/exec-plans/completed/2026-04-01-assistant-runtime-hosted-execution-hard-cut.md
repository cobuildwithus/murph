# Hard cut assistant-runtime hosted-execution shim

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Remove the remaining `@murph/assistant-runtime` root compatibility shim that re-exported `@murph/hosted-execution`, move callers onto the canonical owner package, and document the cleaner long-term boundary.

## Success criteria

- `packages/assistant-runtime` no longer exports the hosted-execution shim file.
- Cloudflare source imports hosted-execution-owned contracts/helpers directly from `@murph/hosted-execution`.
- Regression coverage proves `@murph/assistant-runtime` is no longer an alias for hosted-execution-owned exports.
- Required verification for the touched packages/apps passes, or any unrelated failure is documented with a scoped defense.

## Scope

- In scope:
- Delete the assistant-runtime shim export and file.
- Update direct Cloudflare consumers to import hosted-execution-owned surfaces from `@murph/hosted-execution`.
- Add or update narrow regression coverage for the package boundary.
- Update durable docs that describe the assistant-runtime versus hosted-execution ownership split.
- Out of scope:
- Broader hosted/runtime package reshaping beyond this one shim boundary.
- Device-sync or other smaller alias debates found during the audit.

## Constraints

- Technical constraints:
- Preserve the existing `@murph/assistant-runtime` execution surface for runtime-owned helpers.
- Preserve unrelated in-flight worktree edits, especially other active assistant-runtime and runtime-state lanes.
- Product/process constraints:
- Use the repo coordination ledger and close this plan through the normal finish flow.
- Run the required audit passes for this standard repo change.

## Risks and mitigations

1. Risk: Removing the shim could break Cloudflare callers or package shape assumptions.
   Mitigation: Update all current call sites in the same patch, add a regression assertion against the root package export shape, and run focused package/app verification.
2. Risk: The dirty worktree includes overlapping package lanes.
   Mitigation: Keep the diff narrow, patch only the declared files, and avoid touching unrelated assistant-runtime runtime logic.

## Tasks

1. Remove the assistant-runtime shim export and update Cloudflare imports to `@murph/hosted-execution`.
2. Add boundary regression coverage and update package/runtime docs.
3. Run focused verification, complete required audits, and finish with a scoped commit.

## Decisions

- Treat `@murph/hosted-execution` as the canonical owner of shared hosted execution contracts, side-effect helpers, and callback/env constants; `@murph/assistant-runtime` owns runtime execution behavior only.
- Keep `HostedEmailSendRequest` under `@murph/assistant-runtime`; it is part of the runtime-owned hosted email worker client, not the removed hosted-execution shim surface.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir packages/assistant-runtime test`
- `pnpm --dir apps/cloudflare test`
- Expected outcomes:
- Typecheck passes with the new import boundaries.
- Assistant-runtime and Cloudflare tests pass with the shim removed.

## Results

- Implemented: deleted `packages/assistant-runtime/src/contracts.ts`, removed the root export, moved Cloudflare side-effect helpers to `@murph/hosted-execution`, and documented the ownership split in repo/package docs.
- Scoped verification used after repo-wide failure:
  - `pnpm typecheck` failed for an unrelated existing `apps/web` typecheck error at `test/prisma-store-oauth-connection.test.ts(242,31)` complaining that `metadataJson` does not exist on type `never`.
  - `pnpm --dir packages/assistant-runtime typecheck` passed.
  - `pnpm --dir packages/assistant-runtime exec vitest run test/assistant-core-boundary.test.ts --no-coverage` passed.
  - `pnpm --dir apps/cloudflare test` passed.
- Additional unrelated failure observed:
  - `pnpm --dir packages/assistant-runtime test` failed in `test/hosted-runtime-maintenance.test.ts` on missing warning-log assertions tied to the concurrent `hosted-device-sync-runtime` lane, not to the removed shim files or changed Cloudflare imports in this task.
Completed: 2026-04-01
