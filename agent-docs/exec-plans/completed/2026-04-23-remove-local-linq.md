# Remove local Linq support while preserving hosted Linq

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Remove the local Linq product surface without regressing hosted Linq ingestion, hosted onboarding, shared outbound delivery, or other non-local channel behavior.

## Success criteria

- Local inbox setup, source management, doctor checks, runtime connector instantiation, and foreground daemon support no longer offer or start Linq.
- Local assistant CLI and setup surfaces no longer present Linq as a supported local channel where that would imply local Linq availability.
- Hosted Linq webhook verification, hosted onboarding routing, hosted conversation wake ingestion, and shared outbound Linq delivery continue to compile and pass focused proof unchanged.
- Docs, tests, and setup guidance match the new "hosted-only Linq" posture.
- Scoped verification and the required completion-workflow audits run, with unrelated blockers documented precisely if they remain.

## Scope

- `packages/inbox-services/**`
- `packages/inboxd/src/connectors/linq/connector.ts` and directly coupled exports/tests only if required
- `packages/cli/**`
- `packages/assistant-cli/**`
- `packages/operator-config/**`
- directly coupled docs/tests needed to keep local-vs-hosted Linq boundaries truthful
- this plan and the coordination-ledger row for the lane

## Constraints

- Preserve unrelated dirty-tree work.
- Keep hosted Linq intact; do not remove the shared Linq parser, hosted wake ingestion, hosted onboarding, or shared outbound Linq runtime unless a change is directly required to preserve compile-time truth.
- Avoid widening into broader channel-contract redesign unless the existing shared contract makes a narrower local-only removal impossible.
- Work carefully around active operator-config and boundary lanes that may touch adjacent CLI/runtime files.

## Decisions

- Keep `source: 'linq'` in shared inbox config contracts so existing local configs remain readable/listable/removable, but remove Linq from local add/setup/wizard/doctor/runtime entrypoints.
- Preserve hosted/shared Linq surfaces by leaving normalization and hosted control-plane/runtime integrations intact.
- Treat unsupported local Linq connectors as explicit doctor/runtime failures instead of silently ignoring them.

## Verification

- `git diff --check -- <slice paths>`: passed
- `pnpm --dir packages/inbox-services typecheck`: passed
- `pnpm --dir packages/operator-config typecheck`: failed due pre-existing errors in `packages/contracts/src/command-capabilities.ts`
- `pnpm --dir packages/inboxd typecheck`: failed due pre-existing errors in `packages/contracts/src/command-capabilities.ts` and `packages/core/src/domains/events.ts`
- `pnpm --dir packages/setup-cli typecheck`: failed due pre-existing errors in `packages/core/src/domains/events.ts`
- `pnpm --dir packages/cli typecheck`: failed due pre-existing errors in `packages/core/src/domains/events.ts`
- `pnpm exec vitest run --config vitest.config.ts test/linq-webhook-connector.test.ts test/inboxd-connectors-coverage.test.ts test/package-boundary.test.ts` in `packages/inboxd`: passed
- `pnpm exec vitest run --config vitest.config.ts test/config-env.test.ts test/setup-runtime-env-prompt.test.ts test/setup-text-seam.test.ts` in `packages/operator-config`: passed
- `pnpm exec vitest run --config vitest.config.ts test/inbox-app-environment-sources.test.ts test/inbox-app-sources.test.ts test/inbox-services-core-seams.test.ts test/service-layer-coverage.test.ts test/inbox-app-bootstrap-doctor.test.ts` in `packages/inbox-services`: passed
- `pnpm exec vitest run --config vitest.config.ts test/setup-surface.test.ts test/setup-services-coverage.test.ts test/setup-wizard.test.ts test/setup-wizard-ui.test.ts` in `packages/setup-cli`: passed
- `pnpm --dir . exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/inbox-incur-smoke.test.ts packages/cli/test/inbox-cli.test.ts packages/cli/test/inbox-service-boundaries.test.ts packages/cli/test/setup-cli.test.ts packages/cli/test/setup-channels.test.ts`: passed
Completed: 2026-04-23
