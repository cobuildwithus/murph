# Data Model Seams

Last verified: 2026-04-08

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

### 9. Keep hosted member identity, routing, and billing slices nested at the onboarding composition seam

**Seam:** `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`, `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`, `apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts`, `apps/web/src/lib/hosted-onboarding/stripe-revnet-issuance.ts`, `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`, `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`

The hosted-member privacy split introduced separate identity, routing, and billing-reference tables, but `HostedMemberAggregate` in `hosted-member-store.ts` immediately flattened those slices back into one wide object.
That recreated the old coupling shape in memory: adding or changing one field on any slice widened the read model used by Stripe, RevNet, and webhook orchestration even when those callers only needed one slice.

This patch:

- replaces the flattened `HostedMemberAggregate` with a nested `HostedMemberSnapshot` made of `{ core, identity, routing, billingRef }`
- updates Stripe billing, RevNet issuance, and webhook orchestration to read through the owning slice instead of through a re-widened helper
- adds one focused activation-dispatch helper in `stripe-billing-policy.ts` so the only real cross-slice composition stays explicit
- adds a hosted-web test that locks in the non-flattening snapshot shape

**Why this is simpler:** the privacy split now stays visible at the main onboarding composition seam.
Identity changes no longer imply a billing-shaped type update, routing changes no longer widen RevNet callers, and orchestration code has to name which slice it depends on.

**Main refactor risk:** do not respond by adding a second layer of generic selectors that hides the slice ownership again.
Small task-specific composition helpers are fine, but the shared store surface should keep returning nested slice owners rather than another compatibility aggregate.

### 10. Keep `vault-usecases` query runtime as a thin compatibility adapter over `@murphai/query`

**Seam:** `packages/vault-usecases/src/query-runtime.ts`, `packages/vault-usecases/src/runtime.ts`, `packages/query/src/index.ts`

`packages/vault-usecases/src/query-runtime.ts` was still restating the query read model even though `@murphai/query` already owned the canonical entity, read-model, search, projection-status, timeline, export-pack, and wearable-summary shapes.
That made one query concept look local to the CLI/usecase layer again even though the package already loads the shared query runtime dynamically.

This patch:

- exports the shared search result/filter types from `packages/query/src/index.ts`
- aliases `QueryCanonicalEntity`, `QueryVaultReadModel`, `QuerySearch*`, `QueryProjection*`, `QueryTimeline*`, and `QueryExportPack*` in `packages/vault-usecases/src/query-runtime.ts` back to the shared `@murphai/query` owner types
- reduces `QueryRuntimeModule` to a `Pick<typeof import("@murphai/query"), ...>` view over the shared runtime surface instead of a second hand-written function contract
- adds `packages/vault-usecases/test/query-runtime.test.ts` to prove the compatibility layer forwards the shared owner exports directly

**Why this is simpler:** `vault-usecases` keeps the optional-runtime loader seam it actually needs, but stops owning a second nominal copy of the query model.
Adding one more query field now flows from the real query owner through the CLI/usecase layer without a parallel type-edit pass.

**Main refactor risk:** keep the adapter limited to runtime loading and narrow naming compatibility.
Do not let `vault-usecases` start reaching into query internals or reintroducing narrower local copies just to preserve older field subsets.

### 11. Keep knowledge result contracts owned by `operator-config`, with CLI schemas as the boundary adapter

**Seam:** `packages/operator-config/src/knowledge-contracts.ts`, `packages/operator-config/package.json`, `packages/assistant-engine/src/knowledge/contracts.ts`, `packages/cli/src/knowledge-cli-contracts.ts`

`KnowledgePageReference`, `KnowledgePage`, `KnowledgeSearchResult`, `KnowledgeLogTailResult`, and the lint/index result shapes were split between assistant-engine interfaces and CLI-local inferred types.
That forced the same product contract to drift across two packages even though both layers already depend on `operator-config` for shared contract surfaces.

This patch:

- adds one shared `Knowledge*` contract owner in `packages/operator-config/src/knowledge-contracts.ts`
- turns `packages/assistant-engine/src/knowledge/contracts.ts` into a pure re-export of those shared result types
- keeps `packages/cli/src/knowledge-cli-contracts.ts` as the CLI boundary schema layer, but types each schema against the shared owner instead of inferring a second nominal contract surface

**Why this is simpler:** assistant-engine and CLI now share one source of truth for the knowledge result model while CLI still owns its parse/validation boundary.
Adding or renaming a knowledge result field now has one type owner instead of two.

**Main refactor risk:** do not move CLI-only descriptions or parsing ergonomics into `operator-config` just because the result types are shared there.
The shared owner should stay on the product record shape; the CLI file should remain a thin boundary adapter.

## Current targeted review findings

The notes below are the remaining review-only pass after the simplifications landed above.
They focus on the next data-model simplifications that still look highest-leverage without weakening canonical-write or trust-boundary rules.

### Worth planning

#### 1. Finish collapsing assistant delivery target vocabulary to one route owner

**Seam:** `packages/operator-config/src/assistant-cli-contracts.ts` (`assistantChannelDeliveryTargetKindValues`, `assistantBindingDeliveryKindValues`), `packages/gateway-core/src/contracts.ts` (`gatewayDeliveryTargetKindValues`, `gatewayReplyRouteKindValues`), `packages/hosted-execution/src/side-effects.ts` (`HostedExecutionAssistantDelivery.targetKind`)

The same delivery-target vocabulary still survives in three packages: operator-config, gateway-core, and hosted-execution.
The words are the same (`explicit`, `participant`, `thread`), but the owner is not.

**Current cost:** one more target kind or route variant would require copy/paste edits across assistant settings/contracts, gateway routing, and hosted delivery receipts.
That is exactly the kind of change that tends to produce partial rollouts and adapter glue.

**Simpler target:** keep the shared route vocabulary in `packages/gateway-core/src/contracts.ts`, since that package already owns the concrete reply-route semantics.
Let operator-config and hosted-execution alias the shared target-kind types/constants from that owner, while keeping their higher-level receipts and CLI schemas local.

**Main refactor risk:** do not pull assistant policy, hosted callback rules, or CLI help text down into gateway-core just to centralize string unions.
Only the route-kind vocabulary should move; layer-specific policy should stay where it is.

#### 2. Collapse hosted execution side-effect modeling to the one effect that actually exists today

**Seam:** `packages/hosted-execution/src/side-effects.ts` (`HOSTED_EXECUTION_SIDE_EFFECT_KINDS`, `HostedExecutionSideEffect`, `HostedExecutionSideEffectRecord`), `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`, `apps/cloudflare/src/side-effect-journal.ts`

The current side-effect model is a generic framework with kind/state parsing, merging, and identity helpers even though the only real product effect today is `assistant.delivery`.
Both assistant-runtime and the Cloudflare journal are already effectively specialized to that one case.

**Current cost:** the system pays generic-framework complexity on every read/write path even though there is no second effect family to compose.
A future maintainer has to reason about kinds, prepared-vs-sent record unions, and generic journal identity rules when the product behavior is still “track assistant delivery confirmation.”

**Simpler target:** rename and narrow the model to an assistant-delivery-specific record/journal surface now: `HostedAssistantDeliveryRecord`, `HostedAssistantDeliveryPreparedRecord`, `HostedAssistantDeliverySentRecord`, and a delivery journal store that keeps the same idempotent prepared/sent transitions.
If a second effect really appears later, re-generalize from two concrete cases instead of carrying the abstraction in advance.

**Main refactor risk:** do not entangle this cleanup with Cloudflare-specific storage paths or callback protocol logic.
The simplification should specialize the shared data model, not move trust-boundary or deployment policy into the wrong package.

#### 3. Normalize hosted webhook side-effect persistence around common retry fields plus kind-owned details

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

#### 4. Return hosted-member lookup results from the slice that actually matched

**Seam:** `apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts` (`findHostedMemberByPrivyUserId`, `findHostedMemberByPhoneLookupKey`, `findHostedMemberByPhoneNumber`, `findHostedMemberByWalletAddress`, `readHostedMemberIdentity`), `apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts` (`findHostedMemberByStripeCustomerId`, `findHostedMemberByStripeSubscriptionId`, `readHostedMemberStripeBillingRef`), `apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts` (`findHostedMemberByTelegramUserId`, `findHostedMemberByTelegramUserLookupKey`), `apps/web/src/lib/hosted-onboarding/member-identity-service.ts` (`findHostedMemberForPrivyIdentity`, `refreshHostedMemberForPhone`, `reconcileHostedPrivyIdentityOnMember`), `apps/web/src/lib/hosted-onboarding/billing-service.ts` (`ensureHostedStripeCustomer`)

The slice lookup stores already know which identity, routing, or billing binding matched, but most of them return only `HostedMember` or a tiny ad hoc snapshot.
That throws away the slice-owned state that made the match, so callers immediately fan back out into follow-up reads or reconstruct the match set themselves.
`findHostedMemberForPrivyIdentity(...)` is the clearest example: it runs three separate identity lookups and dedupes on `HostedMember.id`, while `refreshHostedMemberForPhone(...)` and `ensureHostedStripeCustomer(...)` do a lookup and then a second read to recover the slice state they actually care about.

**Current cost:** simple operations require extra orchestration because the lookup owner is not allowed to return its own slice result.
One more auth, billing, or routing use case is likely to add another round of lookup-then-read or another ad hoc partial snapshot type.

**Simpler target:** let each specialized store own a nested lookup result such as `HostedMemberIdentityLookup = { core, identity, matchedBy }`, `HostedMemberBillingLookup = { core, billingRef, matchedBy }`, and `HostedMemberRoutingLookup = { core, routing, matchedBy }`.
Keep `readHostedMemberSnapshot(...)` as the full composition seam, but let the lookup functions that already resolve a blind index or stable binding return the matched slice and the core row together in one read.
That keeps slice ownership explicit without flattening the hosted member back into a wide aggregate.

**Main refactor risk:** do not answer this by reintroducing one wide `HostedMemberAggregate` or by exposing raw encrypted columns/lookup-key internals outside the slice owners.
The lookup result should stay nested and privacy-minimized: matched slice plus core state, not a second pre-cutover wide row.

#### 5. Normalize hosted execution dispatch lifecycle around one cross-boundary outcome owner

**Seam:** `packages/hosted-execution/src/contracts.ts` (`HostedExecutionEventDispatchState`, `HostedExecutionDispatchStateSnapshot`, `resolveHostedExecutionDispatchOutcomeState`), `apps/cloudflare/src/user-runner/runner-queue-store.ts` (`readEventState`), `apps/cloudflare/src/user-runner/types.ts` (`RunnerStateRecord`, `toUserStatus`), `apps/web/prisma/schema.prisma` (`ExecutionOutbox.status`), `apps/web/src/lib/hosted-execution/outbox.ts` (`resolveHostedExecutionDeliveryOutcome`, `isHostedExecutionOutboxPayloadSettled`)

A single hosted dispatch currently moves through three overlapping state models.
The web outbox has transport-local Postgres statuses (`queued`, `dispatching`, `dispatched`, `delivery_failed`), the Cloudflare queue reconstructs event presence from `pending`/`consumed`/`backpressured`/`poisoned`, and the shared hosted-execution contract exposes the public outcome vocabulary (`queued`, `duplicate_pending`, `duplicate_consumed`, `backpressured`, `completed`, `poisoned`).
Simple questions like “is this event really done?” or “should web retry?” require translation across all three.

**Current cost:** adding one more dispatch outcome or changing duplicate semantics would require coordinated edits in the shared contract, Cloudflare queue projection, and web outbox mapper.
The current shape also collapses distinct runner outcomes back into `ExecutionOutboxStatus.dispatched`, which makes the transport row less useful as a source of truth once the handoff succeeds.

**Simpler target:** keep `HostedExecutionEventDispatchState` as the only cross-boundary outcome vocabulary, and keep the Postgres outbox status transport-local: lease/retry/handoff only.
Persist the last or terminal hosted dispatch outcome explicitly using the shared union instead of collapsing everything into `dispatched`, and let the Cloudflare queue surface that same shared outcome directly rather than making downstream callers reason from raw presence booleans.
This would reduce the concept count without weakening the web/Cloudflare trust boundary.

**Main refactor risk:** do not collapse transport lifecycle and runner outcome into one enum.
Web still needs local claim/retry state, and Cloudflare still needs queue-internal scheduling detail.
If the cleanup is done poorly, the system could lose the `duplicate_pending` versus `duplicate_consumed` distinction or make retry policy depend on Cloudflare-specific storage details.

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

#### C. Keep current-profile document ownership in contracts, canonical materialization in core, and fallback resolution in query

**Seam:** `packages/contracts/src/current-profile.ts` (`buildCurrentProfileDocument`, `CurrentProfileDocument`), `packages/core/src/profile/storage.ts` (`buildCurrentProfileMarkdown`, `stageCurrentProfileMaterialization`), `packages/query/src/health/current-profile-resolution.ts` (`resolveCurrentProfileDocument`, `resolveCurrentProfileProjection`), `packages/query/src/health/projectors/profile.ts` (`materializeCurrentProfileDocumentFromSnapshotEntity`)

This seam is already layered in a composable way.
Contracts own the current-profile document/frontmatter contract, core owns writing and rebuilding the canonical `bank/profile/current.md` materialization from the latest snapshot, and query owns the stale-document fallback logic it needs when the materialized file lags behind the latest snapshot.
Those are three different responsibilities, but they currently point at one document owner instead of restating the same record shape.

**Why keep it:** the current split preserves the canonical-write boundary while still letting query fall back to snapshot-derived materialization without becoming a second document owner.
It is a good example of a layered model seam where the owner and the adapters are already clear.

**Main failure mode if changed poorly:** moving fallback logic into core or letting query redefine the current-profile document shape would blur the write/read boundary and reintroduce parallel representations of the same document contract.

#### D. Keep hosted execution event, builder, and parser ownership in `@murphai/hosted-execution`

**Seam:** `packages/hosted-execution/src/contracts.ts` (`HostedExecutionEvent`, `HostedExecutionDispatchRequest`), `packages/hosted-execution/src/builders.ts`, `packages/hosted-execution/src/parsers.ts`, `apps/web/src/lib/hosted-onboarding/member-activation.ts`, `apps/web/src/lib/hosted-share/shared.ts`, `apps/web/src/lib/device-sync/hosted-dispatch.ts`, `packages/assistant-runtime/src/hosted-runtime/events.ts`

This is another seam that is already simple enough.
The hosted-execution package owns the event kind vocabulary, the request shape, the shared builders, and the boundary parsers.
Web composes event ids or source-specific reason mapping around those builders, and assistant-runtime consumes the shared union in one place when it switches on dispatch kinds.

**Why keep it:** adding a new hosted dispatch event is already localized to the shared transport owner plus the layer-local handler that actually uses it.
The event model is not being restated independently in web, Cloudflare, and assistant-runtime.

**Main failure mode if changed poorly:** moving event construction or parsing back into web or assistant-runtime would recreate the exact parallel-representation drift that other review findings are trying to remove.
