# Data Model Seams

Last verified: 2026-04-06

## Implemented in this patch

### 1. Keep automation schedule/route/status ownership in contracts

**Seam:** `packages/contracts/src/automation.ts`, `packages/core/src/automation.ts`, `packages/query/src/automation.ts`, `packages/cli/src/commands/automation.ts`

The automation schedule, route, status, continuity-policy, schema-version, and doc-type shapes were being restated in four places.
That made one product concept look local to each layer even though the contract package already owns the canonical write shape.

This patch:

- reuses `AUTOMATION_SCHEMA_VERSION`, `AUTOMATION_DOC_TYPE`, `automationStatusValues`, `automationContinuityPolicyValues`, and `automationScheduleKindValues` from `packages/contracts/src/automation.ts`
- reuses the contract `AutomationSchedule`, `AutomationRoute`, `AutomationStatus`, `AutomationContinuityPolicy`, and `AutomationScaffoldPayload` types in `packages/core/src/automation.ts`
- reuses the same contract types/constants in `packages/query/src/automation.ts`
- reuses `automationRouteSchema`, `automationScheduleSchema`, `automationScaffoldPayloadSchema`, and the shared status/continuity enums in `packages/cli/src/commands/automation.ts`

**Why this is simpler:** the contract layer is again the single owner of the automation model, while core/query/CLI keep only the layer-local normalization and presentation concerns.

**Main refactor risk:** if future changes move layer-specific semantics into the shared contract types without care, core/query could lose their friendlier error handling and normalized read-model behavior.
The model owner should stay shared; the parsing UX can stay local.

### 2. Keep hosted email send request parsing with the request shape owner

**Seam:** `packages/assistant-runtime/src/hosted-email.ts`, `apps/cloudflare/src/runner-outbound/results.ts`

`HostedEmailSendRequest` lived in `packages/assistant-runtime/src/hosted-email.ts`, but the Cloudflare runner carried a second hand-written parser for the same request shape.
That split ownership of one transport record across two packages.

This patch adds `parseHostedEmailSendRequest` and `hostedEmailSendTargetKindValues` to `packages/assistant-runtime/src/hosted-email.ts` and removes the duplicate parser from `apps/cloudflare/src/runner-outbound/results.ts`.

**Why this is simpler:** the sender-facing package now owns both the request type and its boundary parser, so one more request field does not require copy/paste validation logic downstream.

**Main refactor risk:** do not let this helper start absorbing Cloudflare-specific auth or route policy; it should stay a pure payload parser.

### 3. Keep assessment response record ownership in contracts

**Seam:** `packages/contracts/src/zod.ts`, `packages/core/src/assessment/types.ts`

`packages/core/src/assessment/types.ts` restated `AssessmentResponseRecord` even though the contracts package already exports the canonical record type.

This patch aliases the core type to the contract type instead of keeping a second copy.

**Why this is simpler:** the write model no longer has two nominal owners for the same persisted record shape.

**Main refactor risk:** `packages/core/src/assessment/storage.ts` still partially reconstructs the record around `assessmentResponseSchema` instead of letting the contract parser own the full persisted object.
If that cleanup is attempted later, do it after confirming there is no persisted data depending on the looser `relatedIds` handling there.

## Residual concerns left untouched

### A. Assistant delivery target kinds still have multiple owners

**Seam:** `packages/assistant-engine/src/assistant-cli-contracts.ts`, `packages/operator-config/src/assistant-cli-contracts.ts`, `packages/gateway-core/src/contracts.ts`, `packages/hosted-execution/src/side-effects.ts`

`"explicit" | "participant" | "thread"` still exists in multiple packages with package-local enum/value owners.
That is the next obvious candidate for a single shared owner.

**Why not changed here:** fixing it cleanly would likely require dependency-boundary decisions, not just local dedupe.

### B. Hosted execution side effects still model one real effect as a generic effect framework

**Seam:** `packages/hosted-execution/src/side-effects.ts`, `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`, `apps/cloudflare/src/side-effect-journal.ts`

The current model has generic side-effect kind/state helpers even though the only real product effect today is `assistant.delivery`.
That abstraction cost may not be earning its keep yet.

**Why not changed here:** specializing it now would touch persisted records and multiple recovery paths, so it deserves its own narrow pass.

### C. Keep health entity taxonomy ownership as-is

**Seam:** `packages/contracts/src/health-entities.ts`

This area already has a clear shared owner and should stay centralized rather than being split back across query/CLI/core.
See `agent-docs/references/health-entity-taxonomy-seam.md`.
