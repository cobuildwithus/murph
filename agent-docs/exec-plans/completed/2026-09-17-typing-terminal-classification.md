# Classify completed silent inputs in typing alerts

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

- Stop missing-typing alerts for inputs with valid pre-provider terminal non-reply completion.

## Success criteria

- Real PostgreSQL proof excludes completed silent inputs for Linq and Telegram.
- Slow observed typing, pending inputs, and invalid or stale terminal markers remain alertable.
- Focused tests, Web typecheck, and complexity review pass.

## Scope

- In scope: typing monitor classification, synthetic regression tests, reliability owner.
- Out of scope: reaction interpretation, ingress filtering, member messages, production mutations.

## Constraints

- Reuse the exact trace's existing terminal milestone; no schema or protocol changes.
- Keep the independent reply and mailbox progress monitors authoritative for checkpoint failure.
- Keep private diagnostic evidence outside repository artifacts.

## Risks and mitigations

1. A malformed or stale marker hides pending work. Validate JSON type, integer bounds,
   and chronology through the latest input staging. Preserve alerts whenever a provider started,
   because terminal suppression also represents some provider failures.
2. Completed silence suppresses actual slow typing. Apply the exclusion only when
   no typing acceptance was recorded.

## Tasks

1. Request private runtime diagnostics through the authenticated Ops client.
2. Add focused PostgreSQL regression proof and correct classification.
3. Update the reliability owner, verify, review, and commit the scoped change.

## Decisions

- Outcome: operational emails distinguish completed silence from missing progress.
- Reaches: Linq and Telegram typing-alert evaluation only; no member behavior changes.
- Proof: production query through alert creation and the existing sender with synthetic data.
- Changelog: not applicable; internal operator alert classification only.

## Verification

- Regression proof before implementation: both new channel cases failed by sending
  alerts for all three completed silent inputs; eight existing tests passed.
- `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test:prepared -- test/hosted-runtime-typing-alert-postgres.test.ts test/hosted-runtime-latency-alert-monitor.test.ts`
  with the standard loopback test database: 57 tests passed after implementation.
- `pnpm --dir apps/web typecheck`: passed. Final `typecheck:prepared`: passed.
- Focused ESLint: passed. `pnpm complexity:diff`: passed, no hotspots or debt growth.
- Parent review: exact-input classification only; no additional query, state,
  schema, runtime protocol, or foreground operation. Provider failures retain
  alert eligibility. Synthetic sender proof verifies the external alert boundary.
- Product UX: Ready for the internal alert scope. No member message, prompt,
  interpretation, reaction retention, or reply behavior changes.
- Deployment: Web-only reader change over existing fields; no migration or Worker
  ordering requirement. Missing older milestones preserve existing alert behavior.
  Existing frozen alerts remain unchanged. Not deployed by this task.
- Private runtime diagnostic completed; evidence remains in the expiring Ops task,
  outside repository artifacts. Any reaction-context behavior change is separate.
Completed: 2026-09-17
