# Clarify Linq raw-vs-canonical parser naming without behavior changes

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make the shared Linq message parser names describe the actual supported shapes:
  raw webhook payload parsing vs the general normalization entrypoint that accepts
  either raw payloads or stored canonical snapshots.

## Success criteria

- `packages/messaging-ingress` exports clearly named Linq message parser helpers.
- Direct `apps/web` and `packages/inboxd` callers compile and use the renamed entrypoints.
- Coupled messaging-ingress, hosted-onboarding, hosted Linq control-plane, and inboxd proof stays green.
- No behavior changes to recipient fallback precedence or canonical snapshot parsing.

## Scope

- In scope:
  - rename the shared Linq raw parser and general normalization entrypoint
  - update direct callers, mocks, and focused tests
  - keep existing behavior and precedence unchanged
- Out of scope:
  - any Linq routing, fallback, or payload-shape behavior change
  - raw minimization or broader hosted Linq cleanup work

## Constraints

- Technical constraints:
  - preserve the current raw webhook shape support and stored canonical snapshot support
  - preserve explicit `recipient_phone` / `recipient_handle` precedence over `chat.owner_handle`
- Product/process constraints:
  - keep the diff narrow because the shared worktree already has overlapping Linq lanes
  - avoid touching unrelated active rows in `apps/web`, `packages/inboxd`, or `packages/messaging-ingress`

## Risks and mitigations

1. Risk: rename drift leaves mocks or focused tests on the old symbol names.
   Mitigation: update all direct callers and coupled test imports in one pass, then run scoped verification.
2. Risk: the new names imply a behavior change that does not exist.
   Mitigation: choose names that reflect current behavior exactly and keep fallback logic untouched.

## Tasks

1. Rename the shared messaging-ingress raw parser and general normalization entrypoint.
2. Update direct `apps/web` and `packages/inboxd` imports, mocks, and type references.
3. Refresh coupled test names to match the clarified parser language.
4. Run scoped typecheck and focused Vitest coverage for the touched owner seams.

## Decisions

- Rename `requireLinqMessageReceivedEvent` to `parseRawLinqMessageReceivedEvent`.
- Rename `parseCanonicalLinqMessageReceivedEvent` to `parseLinqMessageReceivedEvent`.
- Keep hosted/web wrapper names stable for now; the confusing boundary is the shared parser API.
- Preserve the historical sparse-timestamp semantics: `received_at ?? sent_at ?? created_at` in both parser branches after final review caught the accidental drift.

## Verification

- Commands to run:
  - `pnpm --dir packages/messaging-ingress typecheck`
  - `pnpm --dir packages/messaging-ingress exec vitest run test/linq-webhook.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-linq-webhook.test.ts apps/web/test/linq-control-plane.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm --dir packages/inboxd exec vitest run test/linq-connector.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm test:smoke`
  - `pnpm --dir apps/web lint`
  - `bash scripts/workspace-verify.sh test:diff packages/messaging-ingress/src/linq-webhook.ts packages/messaging-ingress/test/linq-webhook.test.ts apps/web/src/lib/hosted-onboarding/linq-webhook.ts apps/web/src/lib/linq/control-plane.ts apps/web/test/hosted-onboarding-linq-webhook.test.ts apps/web/test/linq-control-plane.test.ts packages/inboxd/src/connectors/linq/normalize.ts packages/inboxd/test/linq-connector.test.ts`
- Outcomes:
  - Passed: focused messaging-ingress typecheck and Vitest
  - Passed: focused apps/web Linq Vitest
  - Passed: focused inboxd Linq Vitest
  - Passed: `pnpm test:smoke`
  - Passed with warnings only: `pnpm --dir apps/web lint`
  - Failed for unrelated pre-existing reasons: `pnpm --dir apps/web typecheck`, `pnpm --dir packages/inboxd typecheck`, and the scoped `test:diff` lane, all outside this rename slice
Completed: 2026-04-23
