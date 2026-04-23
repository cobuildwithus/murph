# Remove hosted Oura external-account display leaks and harden missing-time webhook dedupe

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Stop hosted browser-facing device-sync surfaces from exposing Oura external account ids through `displayName`.
- Prevent Oura webhook fallback trace ids from collapsing distinct missing-time updates into one 30-day dedupe key.

## Success criteria

- New Oura connections no longer persist an external-account-id-derived `displayName`.
- Hosted browser conversion sanitizes legacy provider-generated display names before dropping `externalAccountId`, so existing Oura rows do not leak through settings/status routes.
- Oura webhook fallback trace ids remain stable when the webhook body already carries a stable event id or body event time, but distinct accepted deliveries without either value no longer collapse onto one dedupe key.
- Focused `packages/device-syncd` and `apps/web` tests cover both regressions.
- Required verification, audit passes, and a scoped commit complete, or any unrelated blocker is documented precisely.

## Scope

- In scope:
  - `packages/device-syncd/src/providers/oura.ts`
  - `packages/device-syncd/test/oura-provider.test.ts`
  - `apps/web/src/lib/device-sync/public-connection.ts`
  - directly coupled `apps/web/test/{device-sync-hosted-wake,device-sync-settings-surface}.test.ts` coverage for hosted device-sync display-name sanitization
- Out of scope:
  - broader provider-label redesign across non-Oura providers
  - schema/storage retention changes for webhook traces
  - unrelated hosted device-sync/auth/billing/runtime work already active in the tree

## Constraints

- Technical constraints:
  - Keep the browser trust-boundary fix on the hosted public-connection/settings path without reintroducing `externalAccountId` downstream.
  - Preserve existing Oura webhook signature and payload validation semantics.
  - Work safely on the dirty tree and avoid widening beyond the cited files.
- Product/process constraints:
  - This is a trust-boundary and inbound webhook idempotency fix, so treat it as high-risk and capture direct proof in addition to scripted verification.
  - Use the plan-bearing workflow and required completion audits before handoff.

## Risks and mitigations

1. Risk: Sanitizing display names too broadly could hide legitimate user-facing names.
   Mitigation: Only strip legacy provider-generated labels when they exactly match the known provider-label-plus-external-id pattern available before browser redaction.
2. Risk: Changing fallback trace ids could break idempotency for unchanged webhook bodies.
   Mitigation: Preserve current behavior whenever Oura provides a stable trace/event id or body event time, and only add transport-time entropy for the accepted missing-id and missing-body-time shape.

## Tasks

1. Register the active plan/ledger scope and inspect current Oura/provider/browser-trust-boundary behavior.
2. Implement the hosted-browser display-name sanitization and stop new Oura connections from persisting external-id display labels.
3. Harden Oura fallback webhook trace-id derivation for missing-id and missing-body-time payloads.
4. Add focused regression coverage, run scoped verification plus direct proof, then complete the required audit and commit path.

## Decisions

- Sanitize legacy provider-generated labels at the hosted browser conversion seam, where both `displayName` and `externalAccountId` are still available, so existing stored rows are covered without widening public account types.
- Keep Oura fallback trace ids transport-timestamp-independent only when the payload already includes a stable event/body time; otherwise derive the fallback from the validated webhook header timestamp so later distinct updates can coexist inside the 30-day trace-retention window.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/providers/oura.ts packages/device-syncd/test/oura-provider.test.ts apps/web/src/lib/device-sync/public-connection.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/device-sync-settings-surface.test.ts`
  - `pnpm --dir apps/web lint`
- Expected outcomes:
  - Focused `device-syncd` and hosted-web tests pass with the new privacy and dedupe regressions covered.
  - Typecheck and hosted-web lint remain green for the touched slice.
Completed: 2026-04-23
