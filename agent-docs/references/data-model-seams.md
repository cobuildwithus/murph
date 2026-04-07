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

## Current targeted review findings

No code changes landed below.
This is the current review-only pass over the live tree for the next data-model simplifications that look highest-leverage without weakening canonical-write or trust-boundary rules.

### High leverage now

#### 1. Collapse assistant-engine's `query-runtime` mirror back to the shared query owner

**Seam:** `packages/assistant-engine/src/query-runtime.ts` (`ALL_QUERY_ENTITY_FAMILIES`, `QueryCanonicalEntity`, `QueryVaultReadModel`, `QueryListEntityFilters`, `QuerySearchFilters`, `QuerySearchResult`, `QueryProjectionStatus`, `QueryTimelineEntry`, `QueryExportPack`, `QueryRuntimeModule`), `packages/query/src/index.ts`, `packages/query/src/canonical-entities.ts`, `packages/query/src/model.ts`, `packages/query/src/search-shared.ts`, `packages/query/src/query-projection-types.ts`, `packages/query/src/timeline.ts`, `packages/query/src/export-pack.ts`, `packages/assistant-engine/src/usecases/types.ts`

The assistant-engine wrapper currently owns a second copy of most of the query read model even though `@murphai/query` already exports the canonical entity, read-model, projection-status, timeline, export-pack, and wearable-summary shapes.
The same file already aliases the wearable summary types from `@murphai/query`, so the remaining local interfaces are mostly a parallel contract surface rather than a true adapter.

**Current cost:** every query-shape change now wants two edits: the real query owner plus the assistant-engine mirror.
Adding one more search field or canonical entity property can ripple through `query-runtime.ts`, its consumers in `usecases/types.ts`, and the runtime loader interface even when the product concept never changed.

**Simpler target:** make `@murphai/query` the only owner of the query model.
Export the missing search-runtime types (`SearchFilters`, `SearchResult`, or a dedicated public runtime-search type) from the query public entrypoint, then collapse the assistant-engine file down to type aliases or `Pick<...>` views plus the local `loadQueryRuntime()` dynamic-import seam.
Keep intentionally narrower views as `Pick<ExportPack, ...>` or `Pick<typeof import("@murphai/query"), ...>` rather than restating fields.

**Main refactor risk:** do not make assistant-engine reach into non-public query internals just to remove duplication.
The shared owner has to stay the public `@murphai/query` surface; the assistant-engine file should remain only a runtime-loader and optional-runtime boundary.

#### 2. Give knowledge result contracts one owner instead of separate assistant-engine and CLI copies

**Seam:** `packages/assistant-engine/src/knowledge/contracts.ts`, `packages/assistant-engine/src/knowledge.ts`, `packages/cli/src/knowledge-cli-contracts.ts`, `packages/cli/src/commands/knowledge.ts`, `packages/cli/src/vault-cli-command-manifest.ts`, `packages/query/src/knowledge-model.ts`

`KnowledgePageReference`, `KnowledgePage`, `KnowledgeSearchHit`, `KnowledgeSearchResult`, `KnowledgeLogTailResult`, and the lint/index result shapes are defined once as assistant-engine interfaces and again as CLI incur schemas plus inferred types.
Even the result format constant is already shared from `packages/query/src/knowledge-model.ts` via `DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT`, which highlights that the contract already spans packages while the rest of the field set does not.

**Current cost:** one more field on a knowledge page or lint result requires synchronized manual edits in two owners.
That makes CLI validation, assistant-engine return types, and future web/hosted knowledge surfaces easy to drift out of alignment.

**Simpler target:** move the canonical knowledge result shape to one shared owner below CLI/app packages.
In the current package graph, the least disruptive owner is a new shared contract surface under `packages/operator-config` or `packages/contracts`.
Then turn `packages/assistant-engine/src/knowledge/contracts.ts` into a re-export or alias layer, and keep `packages/cli/src/knowledge-cli-contracts.ts` as a thin incur boundary adapter over that shared shape instead of a second nominal owner.

**Main refactor risk:** do not solve this by making assistant-engine depend on CLI or by letting the shared owner absorb CLI-only help text and parser ergonomics.
The shared layer should own the product record shape and constants; CLI can still own its boundary schemas and presentation-only constraints.

### Worth planning

#### 3. Finish collapsing assistant delivery target vocabulary to one route owner

**Seam:** `packages/operator-config/src/assistant-cli-contracts.ts` (`assistantChannelDeliveryTargetKindValues`, `assistantBindingDeliveryKindValues`), `packages/gateway-core/src/contracts.ts` (`gatewayDeliveryTargetKindValues`, `gatewayReplyRouteKindValues`), `packages/hosted-execution/src/side-effects.ts` (`HostedExecutionAssistantDelivery.targetKind`)

The same delivery-target vocabulary still survives in three packages: operator-config, gateway-core, and hosted-execution.
The words are the same (`explicit`, `participant`, `thread`), but the owner is not.

**Current cost:** one more target kind or route variant would require copy/paste edits across assistant settings/contracts, gateway routing, and hosted delivery receipts.
That is exactly the kind of change that tends to produce partial rollouts and adapter glue.

**Simpler target:** keep the shared route vocabulary in `packages/gateway-core/src/contracts.ts`, since that package already owns the concrete reply-route semantics.
Let operator-config and hosted-execution alias the shared target-kind types/constants from that owner, while keeping their higher-level receipts and CLI schemas local.

**Main refactor risk:** do not pull assistant policy, hosted callback rules, or CLI help text down into gateway-core just to centralize string unions.
Only the route-kind vocabulary should move; layer-specific policy should stay where it is.

#### 4. Collapse hosted execution side-effect modeling to the one effect that actually exists today

**Seam:** `packages/hosted-execution/src/side-effects.ts` (`HOSTED_EXECUTION_SIDE_EFFECT_KINDS`, `HostedExecutionSideEffect`, `HostedExecutionSideEffectRecord`), `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`, `apps/cloudflare/src/side-effect-journal.ts`

The current side-effect model is a generic framework with kind/state parsing, merging, and identity helpers even though the only real product effect today is `assistant.delivery`.
Both assistant-runtime and the Cloudflare journal are already effectively specialized to that one case.

**Current cost:** the system pays generic-framework complexity on every read/write path even though there is no second effect family to compose.
A future maintainer has to reason about kinds, prepared-vs-sent record unions, and generic journal identity rules when the product behavior is still “track assistant delivery confirmation.”

**Simpler target:** rename and narrow the model to an assistant-delivery-specific record/journal surface now: `HostedAssistantDeliveryRecord`, `HostedAssistantDeliveryPreparedRecord`, `HostedAssistantDeliverySentRecord`, and a delivery journal store that keeps the same idempotent prepared/sent transitions.
If a second effect really appears later, re-generalize from two concrete cases instead of carrying the abstraction in advance.

**Main refactor risk:** do not entangle this cleanup with Cloudflare-specific storage paths or callback protocol logic.
The simplification should specialize the shared data model, not move trust-boundary or deployment policy into the wrong package.

#### 5. Normalize hosted webhook side-effect persistence around common retry fields plus kind-owned details

**Seam:** `apps/web/prisma/schema.prisma` (`HostedWebhookReceiptSideEffect`), `apps/web/src/lib/hosted-onboarding/webhook-receipt-types.ts` (`HostedWebhookSideEffect`), `apps/web/src/lib/hosted-onboarding/webhook-receipt-codec.ts` (`serializeHostedWebhookReceiptSideEffect`, `readHostedWebhookReceiptSideEffect`), `apps/web/src/lib/hosted-onboarding/webhook-dispatch-payload.ts`

`HostedWebhookReceiptSideEffect` is now a wide sparse row that carries dispatch, Linq, and Revnet payload/result fields side-by-side.
The codec then has to switch over `kind` and reconstruct whichever subset of columns matters.
The current tree also suggests those effect-specific columns are not queried outside the codec/store seam, so the relational width is not buying much composition.

**Current cost:** adding one more webhook side effect means adding more nullable columns, widening Prisma types, extending the codec switch, and updating store sync logic even if the shared retry/status behavior did not change.
The effect owner is unclear because the table itself tries to own every variant at once.

**Simpler target:** keep the common retry/idempotency fields first-class on `HostedWebhookReceiptSideEffect` (`source`, `eventId`, `effectId`, `kind`, `status`, `attemptCount`, `lastAttemptAt`, `sentAt`, `lastError*`), but move effect-specific payload/result data behind a single kind-owned `detailJson` envelope or a small keyed detail table per kind.
`webhook-receipt-codec.ts` would then parse one common shell plus one detail owner instead of a wide sparse record.

**Main refactor risk:** do not use this cleanup to reintroduce raw webhook event blobs or to hide fields that the retry/idempotency logic actually needs for indexed lookup.
Preserve the privacy-minimized common fields, and only move the effect-specific remainder.

### Keep as-is

#### A. Keep health registry taxonomy, projection metadata, and command metadata owned by contracts

**Seam:** `packages/contracts/src/health-entities.ts`, `packages/query/src/health/registries.ts`, `packages/assistant-engine/src/health-registry-command-metadata.ts`, `packages/cli/src/commands/health-command-factory.ts`

This is one of the healthier cross-package model seams in the repo today.
Contracts own the health taxonomy and shared registry metadata; query and assistant-engine consume it through thin adapters instead of restating the same kinds and command names.

**Why keep it:** the current central owner removes drift across contracts/query/assistant/CLI without weakening trust boundaries.
It already does the thing the higher-leverage findings above still need to do.

**Main failure mode if changed poorly:** spreading these definitions back across query, assistant-engine, and CLI would recreate exactly the taxonomy drift and duplicate command metadata the repo has been paying down elsewhere.

#### B. Keep hosted execution outbox payload ownership in `@murphai/hosted-execution` with only a thin web Prisma adapter

**Seam:** `packages/hosted-execution/src/outbox-payload.ts`, `apps/web/src/lib/hosted-execution/outbox-payload.ts`

This seam is already simple and composable enough.
The hosted-execution package owns the real payload/storage model (`HostedExecutionOutboxPayload`, `buildHostedExecutionOutboxPayload`, `readHostedExecutionOutboxPayload`, canonical storage selection), while the web layer only wraps it to convert the payload into `Prisma.InputJsonObject`.

**Why keep it:** this split respects the trust boundary and avoids a second owner.
Web does not redefine inline-vs-reference payload semantics; it just adapts the shared owner to Prisma.

**Main failure mode if changed poorly:** moving the payload model back into web or letting Prisma types leak into the shared hosted-execution package would recreate a cross-layer contract fork and make Cloudflare/web rollouts harder to keep aligned.
