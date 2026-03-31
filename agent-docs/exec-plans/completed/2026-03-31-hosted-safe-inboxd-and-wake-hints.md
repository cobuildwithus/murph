# Narrow hosted-safe inboxd entrypoints and harden hosted device-sync wake hint shaping

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Remove the remaining hosted bundling seam from the inboxd webhook helpers and stop hosted device-sync wake hints from carrying provider payload structure beyond the explicit replay-safe fields the hosted runner needs.

## Success criteria

- Hosted web callers use webhook-safe `@murph/inboxd` subpaths that do not statically import Linq or Telegram connector runtime code.
- Hosted device-sync wake hints shape job payloads by provider and job kind rather than recursive key-based redaction, so delete-style webhook jobs cannot forward nested provider payload blobs.
- Focused tests cover both the new inboxd entrypoints and the wake-hint allowlists, and required verification outcomes are recorded.

## Scope

- In scope:
- `packages/inboxd` public subpaths used by hosted webhook/onboarding callers
- `apps/web` hosted Linq/Telegram imports and wake-hint shaping
- focused tests needed to prove the hosted-safe import graph and wake-hint payload shaping
- Out of scope:
- unrelated assistant-core/cli refactor work already in the tree
- broader hosted `@murph/device-syncd` NFT seams beyond the wake-hint producer contract

## Constraints

- Technical constraints:
- Preserve public package imports through declared `package.json` exports only.
- Keep hosted wake hints replay-safe for the hosted runner without widening the hosted execution contract unnecessarily.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Follow the full audit path because this touches hosted trust boundaries.

## Risks and mitigations

1. Risk: A narrower inboxd subpath could accidentally drop a hosted caller dependency or break package exports.
   Mitigation: Add explicit webhook-only subpaths, update all hosted callers/tests together, and verify with focused hosted-web plus inboxd runs.
2. Risk: Over-tight wake-hint allowlists could strip fields the hosted runtime needs to replay device-sync jobs.
   Mitigation: Shape payloads from current provider/job contracts, add targeted tests for reconcile/resource/delete payloads, and verify the hosted runtime path still accepts the resulting hints.

## Tasks

1. Add hosted-safe inboxd webhook entrypoints and switch hosted callers/tests to those narrower imports.
2. Replace key-based hosted wake-hint payload redaction with provider/job allowlist shaping for replay-safe fields.
3. Run focused verification, then close the plan with the required scoped commit.

## Decisions

- Keep the existing broad `@murph/inboxd/linq` and `@murph/inboxd/telegram` subpaths available for runtime consumers, but move hosted callers onto new webhook-safe entrypoints so the hosted graph stops importing connector runtime code.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - focused `packages/inboxd` and `apps/web` verification covering the new webhook-safe subpaths and hosted wake-hint shaping
  - `pnpm --dir apps/web build`
- Expected outcomes:
  - Hosted-web focused tests pass on the new inboxd webhook-safe entrypoints.
  - Wake-hint tests prove only provider/job allowlisted payload fields survive into hosted dispatch hints.
- Outcomes:
  - `pnpm typecheck` passed. One transient `rimraf` `ENOTEMPTY` race in `packages/cli/dist/usecases` retried automatically inside the workspace verify script and then completed successfully.
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/linq-control-plane.test.ts apps/web/test/linq-webhook-route.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts --no-coverage` passed.
  - `pnpm --dir packages/inboxd exec vitest run --config vitest.config.ts test/subpath-warning.test.ts --no-coverage` passed.
  - `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/oura-provider.test.ts --no-coverage` passed.
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-device-sync-oura-delete-hint.test.ts --no-coverage` passed.
  - `pnpm --dir apps/web build` passed.
  - Direct hosted-build proof: the prior hosted inboxd warning seam is gone; remaining Turbopack/NFT warnings now trace through `packages/device-syncd/src/service.ts` via hosted device-sync routes.
  - Extra non-required check: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-device-sync-runtime.test.ts --no-coverage` remained red in a separate dirty-tree consumer-runtime lane that this diff did not touch.
  - Required audit passes ran: the simplify review findings and final review follow-ups were fixed, and the final scoped re-review found no remaining material issues.
Completed: 2026-03-31
