# 2026-03-29 Hosted usage and Stripe hardening

## Goal

Close the known correctness gaps in hosted assistant usage export and optional Stripe token metering without changing the core architecture:

1. freeze `credentialSource` when the pending usage record is written
2. batch post-commit usage export and delete only acknowledged records
3. meter only platform-funded usage
4. make Stripe drain failures retryable instead of terminal
5. preserve original event timing and JSON safety in the hosted ledger
6. extend hosted BYO-key allowlists so Venice/provider-compatible keys can actually flow

## Constraints

- Keep hosted Postgres as the canonical hosted usage ledger; Stripe stays a downstream sink only.
- Preserve the existing provider-agnostic runtime capture path across Codex and OpenAI-compatible providers.
- Do not make hosted execution success depend on usage export or Stripe metering success.
- Preserve overlapping in-flight hosted runtime, web, and Cloudflare edits already present in the tree.
- Keep the billing policy intentionally narrow: only platform-funded usage is billable in this pass.

## Planned shape

- Resolve and persist `credentialSource` inside the hosted usage writer in `packages/cli`, using the current hosted env snapshot at the time the record is created.
- Remove export-time reclassification from `packages/assistant-runtime` and switch export to batched posts with acknowledged deletion only.
- Add `occurredAt` to Stripe metering candidates, sanitize imported JSON payloads before Prisma, and keep metering value tied to explicit `totalTokens`.
- Treat Stripe send failures as retryable pending work while still recording the latest error message.
- Expand hosted user-env and runner-env defaults to include `VENICE_API_KEY` / `VENICE_`.

## Deliberate non-goals

- No new billing outbox table in this pass.
- No dollar-cost computation or provider-specific pricing logic.
- No broader change to hosted onboarding, Stripe entitlement reconciliation, or control-plane auth.
- No attempt to infer a richer long-term credential-ownership model beyond freezing the current best-known value.

## Verification follow-up

- Run repo-required checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Add focused regression coverage for frozen credential ownership, batched export acknowledgements, Stripe timestamp/platform-only gating/retryability, JSON sanitization, and Venice allowlists.

## Status

- In progress.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
