# Data Model Seams

Last verified: 2026-04-07

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


### 4. Keep assistant CLI contract ownership in operator-config

**Seam:** `packages/operator-config/src/assistant-cli-contracts.ts`, `packages/assistant-engine/src/assistant-cli-contracts.ts`, `packages/assistant-engine/src/assistant/channels/{types,helpers,registry}.ts`

`packages/assistant-engine/src/assistant-cli-contracts.ts` had drifted into a full second copy of the assistant CLI contract surface even though `packages/operator-config/src/assistant-cli-contracts.ts` already owned that model.
The assistant channel layer also repeated delivery-kind unions locally instead of using the contract-owned types.

This patch:

- turns `packages/assistant-engine/src/assistant-cli-contracts.ts` into a pure compatibility re-export of `@murphai/operator-config/assistant-cli-contracts`
- switches assistant channel types/helpers/registry to `AssistantChannelDeliveryTargetKind` and `AssistantBindingDeliveryKind` instead of restating string unions locally

**Why this is simpler:** operator-config is again the only real owner of the assistant delivery contract model, while assistant-engine keeps the old import path as a thin legacy shim.

**Main refactor risk:** do not add new engine-only contract fields back onto the shim file.
If the legacy path still needs to exist, it should stay a re-export, not a fork.

### 5. Keep gateway delivery target kinds owned by gateway-core where the same route semantics are reused

**Seam:** `packages/gateway-core/src/contracts.ts`, `packages/gateway-core/src/local-runtime.ts`, `packages/gateway-core/src/routes.ts`, `packages/assistant-runtime/src/hosted-email.ts`

The same outbound delivery-target semantics (`explicit`, `participant`, `thread`) and binding kinds (`participant`, `thread`) were being restated in gateway-local runtime records, gateway route helpers, and assistant-runtime hosted email parsing.
Those are all the same routing concept, but not all of them were pointing back at the gateway owner types.

This patch:

- reuses `GatewayDeliveryTargetKind` in `packages/gateway-core/src/local-runtime.ts`
- reuses `GatewayReplyRouteKind` for the internal route helper inputs in `packages/gateway-core/src/routes.ts`
- reuses `gatewayDeliveryTargetKindValues` / `GatewayDeliveryTargetKind` in `packages/assistant-runtime/src/hosted-email.ts`

**Why this is simpler:** one more outbound target kind can now flow through gateway-local runtime and hosted email request parsing without hand-updating multiple literal unions.

**Main refactor risk:** gateway-core should stay the owner only for the shared route-kind vocabulary.
Do not pull hosted-execution side-effect policy or channel-specific send rules into that package just to chase total dedupe.

### 6. Keep profile snapshot record ownership in contracts

**Seam:** `packages/contracts/src/zod.ts`, `packages/core/src/profile/types.ts`

`packages/core/src/profile/types.ts` still restated `ProfileSnapshotRecord` even though the contracts package already exports the canonical persisted profile snapshot record.

This patch aliases the core type to the contract type instead of keeping a second record definition.

**Why this is simpler:** the canonical profile snapshot write shape now has one nominal owner again, matching the assessment-response cleanup already done in core.

**Main refactor risk:** if core later needs richer operational wrappers around a snapshot, add a separate wrapper type rather than widening the canonical persisted record.

### 7. Keep workout as a workflow façade over explicit primitive record families

**Seam:** `packages/core/src/domains/events.ts`, `packages/assistant-engine/src/usecases/workout.ts`, `packages/assistant-engine/src/usecases/workout-measurement.ts`, `packages/assistant-engine/src/usecases/workout-import.ts`, `packages/cli/src/commands/workout.ts`

`workout` is a useful operator-facing namespace, but it was acting as though it owned one persistence model even though the durable records were already split across `activity_session`, `body_measurement`, and saved `workout_format` documents.
That showed up most clearly in the write path: meals already had a dedicated core mutation seam, while workout sessions and measurements were assembled in assistant-engine and then pushed through the generic event upsert surface.

This patch keeps `workout` as the user-facing workflow surface while moving session and measurement persistence down into explicit core-owned primitive mutations:

- `packages/core/src/domains/events.ts` now owns `addActivitySession()` and `addBodyMeasurement()`
- those primitive seams stage workout/measurement attachments and manifests inside the same canonical write that appends the event ledger entry
- `packages/assistant-engine/src/usecases/workout.ts`, `workout-measurement.ts`, and `workout-import.ts` now build typed drafts and delegate to those primitive seams instead of staging attachments or calling generic event upsert directly
- the CLI `workout` namespace stays intact, but it is now clearly a façade over the primitive record families instead of a hidden persistence owner

**Why this is simpler:** the durable models stay small and composable, while the operator surface still gets one coherent `workout` namespace. Session writes, measurement writes, and raw attachment staging now each have one canonical owner.

**Main refactor risk:** do not respond to this cleanup by inventing one larger `Workout` record family. That would collapse a useful boundary: templates/defaults, session events, and body measurements have different storage semantics even when they belong to the same workflow surface.

### 8. Keep bank registry projection ownership in contracts

**Seam:** `packages/contracts/src/bank-entities.ts`, `packages/query/src/health/bank-registry-query-metadata.ts`, `packages/query/src/health/registries.ts`

Bank registry projection metadata was still split by family.
Health-backed families already kept projection ownership in contracts, but `food`, `recipe`, `provider`, and `workout_format` still carried query-local projection definitions in `packages/query/src/health/bank-registry-query-metadata.ts`.
That made one bank-registry concept have two owners depending on entity kind.

This patch:

- adds explicit `projection` metadata for `food`, `recipe`, `provider`, and `workout_format` in `packages/contracts/src/bank-entities.ts`
- exports `BankEntityRegistryProjection*` aliases plus `getBankEntityRegistryProjectionMetadata(...)` from the contracts owner layer
- reduces `packages/query/src/health/bank-registry-query-metadata.ts` to a thin compatibility adapter over the contracts getter instead of a second metadata table
- extends `packages/query/test/health-registry-definitions.test.ts` to lock the shared-owner seam in place and adds `packages/assistant-engine/test/assistant-cli-contracts-compat.test.ts` to prove the assistant compatibility shim still forwards the exact owner exports

**Why this is simpler:** all bank registry families now follow one ownership rule.
Adding or reshaping a bank projection no longer requires remembering whether that family lives in contracts or query.
The query package goes back to owning projection application rather than projection definition.

**Main refactor risk:** do not let the contracts projection metadata start absorbing query-only presentation concerns.
The shared owner should describe stable read-model extraction from frontmatter, not package-specific sorting or presentation behavior beyond what multiple consumers genuinely share.

## Residual concerns left untouched

### A. Assistant delivery target kinds still have multiple owners across operator-config, gateway-core, and hosted-execution

**Seam:** `packages/operator-config/src/assistant-cli-contracts.ts`, `packages/gateway-core/src/contracts.ts`, `packages/hosted-execution/src/side-effects.ts`

This pass removed the extra assistant-engine copy and aligned assistant-runtime hosted email with gateway-core, but the repo still has more than one surviving owner for delivery-target vocabulary.
`assistantChannelDeliveryTargetKindValues`, `gatewayDeliveryTargetKindValues`, and `HostedExecutionAssistantDelivery.targetKind` still describe overlapping concepts from different package roots.

**Why not changed here:** collapsing the remaining owners cleanly still needs a dependency-boundary choice between the gateway, assistant-contract, and hosted-execution packages.

### B. Hosted execution side effects still model one real effect as a generic effect framework

**Seam:** `packages/hosted-execution/src/side-effects.ts`, `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`, `apps/cloudflare/src/side-effect-journal.ts`

The current model has generic side-effect kind/state helpers even though the only real product effect today is `assistant.delivery`.
That abstraction cost may not be earning its keep yet.

**Why not changed here:** specializing it now would touch persisted records and multiple recovery paths, so it deserves its own narrow pass.

### C. Keep health entity taxonomy ownership as-is

**Seam:** `packages/contracts/src/health-entities.ts`

This area already has a clear shared owner and should stay centralized rather than being split back across query/CLI/core.
See `agent-docs/references/health-entity-taxonomy-seam.md`.
