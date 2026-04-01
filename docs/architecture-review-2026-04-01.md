# Architecture Review — 2026-04-01

## Scope

This snapshot reviews Murph's current shared data model, package boundaries, internal APIs, and code structure with an emphasis on duplicated concepts, widening blast-radius seams, and orchestration-heavy modules.

This patch lands part of item 1 and item 2 below. The other items remain review findings only.

## High leverage now

### 1. Make `packages/contracts` the shared owner of protocol-group path derivation

**Seam:** `packages/core/src/bank/protocols.ts#parseProtocolItemRecord`, `packages/query/src/health/bank-registry-query-metadata.ts#protocol.transform`, `packages/contracts/src/health-entities.ts`.

**Current cost:** the same file-layout invariant was represented twice: core derived a protocol `group` from `groupFromProtocolPath(...)`, while query separately derived it from `deriveProtocolGroupFromRelativePath(...)`. Any future path-layout change under `bank/protocols/**` risks a split between canonical writes and read-model projection.

**Simpler target shape:** one package-neutral helper in contracts that owns the invariant, with core keeping only the write-time validation/error behavior and query reusing the same pure derivation.

**Incremental refactor path:** land a pure helper in `packages/contracts/src/health-entities.ts`, update core and query to consume it, then delete the duplicate core/query-specific derivations. This patch does that.

**Main risk if done poorly:** treating an invalid path as valid would quietly corrupt the protocol `group` field, especially during projection rebuilds.

### 2. Stop restating registry-command method names and registry-kind unions in assistant-core

**Seam:** `packages/assistant-core/src/health-registry-command-metadata.ts`, `packages/assistant-core/src/health-cli-descriptors.ts`, `packages/contracts/src/health-entities.ts`, `packages/query/src/health/bank-registry-query-metadata.ts`.

**Current cost:** the same registry concept was represented several ways: assistant-core kept a full per-kind table of method names, payload filenames, and id examples; assistant-core also restated the registry-kind union separately from query. That makes routine renames or added registry kinds ripple through contracts, assistant-core, query, and CLI even when most fields are mechanical.

**Simpler target shape:** contracts owns the registry-kind set and registry nouns; assistant-core derives mechanical command metadata from a tiny per-kind stem table plus the contract-owned registry definitions. Query imports the shared registry-kind type instead of restating the same union locally.

**Incremental refactor path:** first type the metadata fields with the actual service/runtime method-name unions, then derive list/show/scaffold/upsert names from singular/plural stems, leaving only the genuinely irregular override (`protocol` runtime writes `upsertProtocolItem`). This patch lands that first step.

**Main risk if done poorly:** one incorrect derived method name would fail CLI dispatch at runtime or disconnect command help from the actual bound service methods.

### 3. Split `HostedDeviceSyncControlPlane` into a composition root plus narrower behavior owners

**Seam:** `apps/web/src/lib/device-sync/control-plane.ts#HostedDeviceSyncControlPlane`, `./agent-session-service.ts#HostedDeviceSyncAgentSessionService`, `./wake-service.ts`, `./public-connection.ts`, `./providers.ts`.

**Current cost:** `HostedDeviceSyncControlPlane` currently owns request-scoped environment assembly, auth caching, store/codec construction, public ingress creation, browser connection projection, agent-session behavior, webhook-admin upkeep, and runtime-snapshot preparation. That makes routine route work fan out across auth, persistence, callback policy, and wake orchestration at once.

**Simpler target shape:** keep `HostedDeviceSyncControlPlane` as the request-scoped composition root only, and move the remaining owned behavior into focused services such as `HostedDeviceSyncConnectionsService`, `HostedDeviceSyncWebhookAdminService`, and `HostedDeviceSyncAgentService`.

**Incremental refactor path:** start by extracting the connection/browser-id ownership methods (`listConnections`, `getConnectionStatus`, `disconnectConnection`, `requireOwnedBrowserConnection`) into one service without changing route signatures. Then peel out webhook-admin upkeep and leave agent-session behavior where it already has a narrow service.

**Main risk if done poorly:** losing the request-scoped auth/origin assumptions could accidentally widen trust or let one service rebuild slightly different environment/config state than another.

## Worth planning

### 4. Break `member-service.ts` along invite, member-identity, and session-issuance seams

**Seam:** `apps/web/src/lib/hosted-onboarding/member-service.ts#getHostedInviteStatus`, `#completeHostedPrivyVerification`, `#ensureHostedMemberForPhone`, `#ensureHostedMemberForPrivyIdentity`, `#reconcileHostedPrivyIdentityOnMember`, `#issueHostedInvite`, `#buildHostedMemberActivationDispatch`.

**Current cost:** one module owns invite lifecycle transitions, member identity reconciliation, bootstrap-secret issuance, session creation, and hosted execution activation dispatch construction. That means onboarding changes ripple across persistence rules, authentication rules, and hosted-dispatch semantics in one file.

**Simpler target shape:** three package-local seams: an `invite-lifecycle` module, a `member-identity` module, and a `session-and-activation` module. Route-layer behavior can still call one facade, but the state machines stop living in the same file.

**Incremental refactor path:** extract pure invite-stage computation first, then pull the Privy/member reconciliation helpers into a separate module, and only after that move session issuance + activation dispatch construction.

**Main risk if done poorly:** splitting the file without a clear transactional boundary could introduce subtle mismatches between invite state, member status, and activation dispatch idempotency.

### 5. Give the hosted runner job envelope one owner instead of layering ad hoc request shapes

**Seam:** `packages/hosted-execution/src/contracts.ts#HostedExecutionRunnerRequest`, `packages/assistant-runtime/src/hosted-runtime/models.ts#HostedAssistantRuntimeJobRequest`, `apps/cloudflare/src/node-runner.ts#HostedExecutionRunnerJobRequest`, `apps/cloudflare/src/container-entrypoint.ts#parseHostedExecutionRunnerJobRequest`, `apps/cloudflare/src/runner-container.ts#parseHostedExecutionContainerRunnerRequest`.

**Current cost:** the same execution request grows across three layers: base runner request, assistant-runtime job request, and Cloudflare runner job request, with parsing split across package and app boundaries. That makes transport changes harder to reason about and obscures which layer actually owns which optional fields.

**Simpler target shape:** one shared job-envelope contract for the assistant runtime boundary, plus a very small Cloudflare-local wrapper only for worker-only transport fields such as `internalWorkerProxyToken` and filtered `userEnv`.

**Incremental refactor path:** first centralize the Cloudflare-local job parser/type into one module, then decide whether the assistant-runtime job envelope should move down into `@murph/hosted-execution` or remain in `@murph/assistant-runtime` as the single owner.

**Main risk if done poorly:** collapsing the envelopes too aggressively could leak worker-only transport concerns into shared packages or erase validation that currently fails closed.

### 6. Finish collapsing hosted web route error handling into one HTTP boundary

**Seam:** `apps/web/src/lib/http.ts#createJsonErrorResponse`, `apps/web/src/lib/device-sync/http.ts#jsonError`, `apps/web/src/lib/hosted-onboarding/http.ts#jsonError`, `apps/web/src/lib/linq/http.ts#jsonError`.

**Current cost:** the app already has a common low-level JSON error response builder, but each domain still hand-builds its own thin wrapper and route pattern. That keeps behavior mostly aligned today, but future logging, headers, or request-validation changes still fan out across several domain-local wrappers.

**Simpler target shape:** one app-level error-adapter factory in `src/lib/http.ts` that owns the generic HTTP behavior, with each domain providing only matchers/default headers.

**Incremental refactor path:** introduce a small factory without changing route signatures, then migrate device-sync, onboarding, and Linq one by one. Leave domain-specific helpers such as callback redirects or HTML responses where they are.

**Main risk if done poorly:** an over-generic helper could erase domain-specific headers or make domain error policies harder to see than they are today.

## Keep as-is

### 7. Keep the contracts-owned health taxonomy seam

**Seam:** `packages/contracts/src/health-entities.ts`, `packages/query/src/health/registries.ts`, `packages/assistant-core/src/health-cli-descriptors.ts`, `agent-docs/references/health-entity-taxonomy-seam.md`.

**Why it should stay:** this file looks central because it is actually coordinating shared taxonomy, lookup prefixes, scaffold templates, and registry metadata that multiple packages genuinely share. The right simplification is to delete downstream restatements, not to scatter the ownership.

### 8. Keep the `@murph/runtime-state` root versus `@murph/runtime-state/node` split

**Seam:** `packages/runtime-state/package.json#exports`, `packages/runtime-state/src/index.ts`, `packages/runtime-state/src/node/index.ts`.

**Why it should stay:** the split keeps browser-safe/shared hosted identity types on the root export while isolating Node-only filesystem, SQLite, and bundle-materialization behavior behind the `/node` subpath. That is a real environment boundary, not accidental churn.

### 9. Keep the explicit gateway-local assistant adapter seam

**Seam:** `packages/gateway-local/src/assistant-adapter.ts`, `packages/gateway-local/src/send.ts`, `packages/gateway-local/src/local-service.ts`.

**Why it should stay:** the adapter is doing real ownership work. It lets the local gateway projection/read/send layer depend on a narrow assistant-facing bridge instead of letting `send.ts` and store logic import assistant-core directly. The better next step is to keep the adapter small, not to inline it away.
