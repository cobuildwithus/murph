# Architecture Review — 2026-04-02

This review stays inside Murph's current file-native and canonical-write boundaries:

- `packages/core` remains the only canonical writer.
- `apps/web` and `apps/cloudflare` remain non-canonical hosted layers.
- Recommendations favor incremental seam cleanup over framework or platform churn.

## 1. Remove cross-domain control-plane coupling from hosted Linq auth and agent pairing

**Architectural seam:** `apps/web/src/lib/linq/control-plane.ts` `HostedLinqControlPlane` currently reached into `apps/web/src/lib/device-sync/control-plane.ts` `HostedDeviceSyncControlPlane` through `createHostedDeviceSyncControlPlane(...)` just to call `requireAuthenticatedUser()`, `assertBrowserMutationOrigin()`, `pairAgent()`, and `requireAgentSession()`.

**Current complexity cost:** Linq binding and webhook code does not own device-sync public-ingress or webhook-admin behavior, but changes in the device-sync control plane constructor still widened Linq's dependency surface because `HostedDeviceSyncControlPlane` also constructs `HostedDeviceSyncPublicIngressService` and `HostedDeviceSyncWebhookAdminService`. That couples two hosted features at the orchestration layer instead of at the narrower auth/session seam.

**Simpler target shape:** Linq should compose only the device-sync auth and agent-session seams it actually needs: `requireAuthenticatedHostedUser(...)`, `assertBrowserMutationOrigin(...)`, `HostedDeviceSyncAgentSessionService`, and `createHostedDeviceSyncControlPlaneContext(...)`. Device-sync should keep owning connection/webhook orchestration; Linq should not instantiate that wider control plane.

**Incremental refactor path:** This patch lands the first step directly in `apps/web/src/lib/linq/control-plane.ts` by replacing the `createHostedDeviceSyncControlPlane(...)` dependency with local composition of the narrower device-sync auth/session pieces. If another hosted feature later needs the same seam, extract a dedicated shared auth/session boundary then. Do not introduce another generic "manager" first.

**Main risk if done poorly:** replay-protection, CSRF-origin, or agent-session rotation rules could drift if callers partially reimplement device-sync auth instead of continuing to reuse the same auth/session primitives.

**Status in this patch:** landed.

## 2. Stop restating hosted execution user status in deployment smoke code

**Architectural seam:** `apps/cloudflare/scripts/smoke-hosted-deploy.shared.ts` defined its own `SmokeUserStatus` shape and local JSON parsing helpers even though `packages/hosted-execution/src/contracts.ts` already owns `HostedExecutionUserStatus` and `packages/hosted-execution/src/parsers.ts` already exports `parseHostedExecutionUserStatus(...)`.

**Current complexity cost:** the same hosted-runner status contract existed in at least four forms: the public contract in `packages/hosted-execution/src/contracts.ts`, the Cloudflare internal state adapter in `apps/cloudflare/src/user-runner/types.ts` `toUserStatus(...)`, the Durable Object persisted/meta representation in `apps/cloudflare/src/user-runner/{runner-queue-schema.ts,runner-queue-state.ts}`, and the deployment smoke parser in `apps/cloudflare/scripts/smoke-hosted-deploy.shared.ts`. The smoke copy was the weakest seam because it could silently lag the contract without any product value.

**Simpler target shape:** keep one shared parser for the public status contract, and keep the Cloudflare Durable Object's internal persisted state private. Public callers should parse `HostedExecutionUserStatus`; only the Durable Object layer should know about `runner_meta` field layout and sanitization.

**Incremental refactor path:** this patch routes the smoke script through `parseHostedExecutionUserStatus(...)` and deletes the script-local parser. A later follow-up can introduce an explicit Cloudflare-only codec for `runner_meta` rows if the `runner-queue-state.ts` / `runner-queue-schema.ts` lane keeps growing.

**Main risk if done poorly:** collapsing public status and internal Durable Object state into one over-shared type would either leak internal-only fields upward or freeze the Cloudflare storage schema too early.

**Status in this patch:** landed.

## 3. Collapse health registry topology to one catalog per layer instead of many repeated family lists

**Architectural seam:** the same bank/health registry families are repeated across `packages/contracts/src/health-entities.ts`, `packages/query/src/health/registries.ts`, `packages/query/src/health/canonical-collector.ts` `REGISTRY_COLLECTORS`, `packages/assistant-core/src/health-cli-descriptors.ts`, `packages/assistant-core/src/health-registry-command-metadata.ts`, and `packages/cli/src/commands/health-entity-command-registry.ts`.

**Current complexity cost:** adding or renaming one registry family still ripples through contracts, query, assistant-core, and CLI metadata. Contracts already own canonical registry taxonomy, but query and CLI still restate family inventories and command derivations mechanically. That increases concept count and makes new-family work more error-prone than it needs to be.

**Simpler target shape:**

- `packages/contracts/src/health-entities.ts` remains the owner of canonical taxonomy, registry directories, ids, titles, statuses, relation metadata, and scaffold payloads.
- Query owns one projection catalog for query-only transforms and sort behavior.
- Assistant-core/CLI derive CRUD command metadata mechanically from those upstream owners instead of maintaining separate family inventories.

**Incremental refactor path:**

1. Introduce one query-local registry catalog that `packages/query/src/health/registries.ts` and `packages/query/src/health/canonical-collector.ts` both read.
2. Delete manual collector lists such as `REGISTRY_COLLECTORS` once the catalog exists.
3. Then remove remaining assistant-core/CLI method-stem tables only where the naming is truly mechanical.

**Main risk if done poorly:** moving query projection transforms into contracts would over-centralize package-local read-model behavior and blur the boundary that currently keeps contracts package-neutral.

**Status in this patch:** reviewed only.

## 4. Split `DeviceSyncService` by responsibility without changing its public API yet

**Architectural seam:** `packages/device-syncd/src/service.ts` `DeviceSyncService` currently owns public ingress composition, OAuth/webhook handoff, token encryption/decryption, account-state shaping, reconcile scheduling, worker leasing, provider execution, importer calls, and job-queue mutation.

**Current complexity cost:** one class is responsible for both synchronous control-plane actions (`startConnection(...)`, `handleOAuthCallback(...)`, `handleWebhook(...)`, `disconnectAccount(...)`) and asynchronous job-engine behavior (`runSchedulerOnce()`, `runWorkerOnce()`, `drainWorker()`). That widens the blast radius for provider, queue, token, and HTTP changes and makes the cancellation and disconnect invariants harder to test in isolation.

**Simpler target shape:** keep the exported `DeviceSyncService` as the compatibility facade for now, but make it compose three narrower owners:

- a browser/webhook control surface around `createDeviceSyncPublicIngress(...)`
- a job engine around scheduler/worker methods
- an account/token helper or repository for `requireStoredAccount(...)`, `toDecryptedAccount(...)`, `encryptTokens(...)`, and `enqueueJobs(...)`

**Incremental refactor path:** extract the worker/scheduler/private account methods into plain modules or small classes first while preserving the current public API. Only after tests stabilize should the constructor surface shrink.

**Main risk if done poorly:** disconnect-generation, lease ownership, and token-refresh cancellation semantics could break if the split crosses the current store transaction boundaries carelessly.

**Status in this patch:** reviewed only.

## 5. Stop growing the generic health CLI factory stack

**Architectural seam:** CRUD-style health commands currently span `packages/cli/src/commands/health-command-factory.ts`, `packages/assistant-core/src/health-cli-descriptors.ts`, `packages/assistant-core/src/health-registry-command-metadata.ts`, and `packages/cli/src/commands/health-entity-command-registry.ts`.

**Current complexity cost:** the generic factory path hides ownership. A simple CRUD behavior change can require touching descriptor derivation, command-metadata derivation, generic factory plumbing, and the registry binder. The abstraction helps with consistency, but its generic surface is now large enough that it also obscures where examples, CTAs, list-filter semantics, and result-shape decisions really live.

**Simpler target shape:** keep one descriptor-driven path for true registry CRUD commands, and let non-mechanical command shapes opt out into dedicated builders. Prefer a smaller `registerRegistryCrudCommands(...)` seam over expanding the current generic factory with more branches.

**Incremental refactor path:** freeze `health-command-factory.ts` for existing commands, add a smaller descriptor-driven registry CRUD registration path for one family, migrate families opportunistically, then delete the generic layers after the last migration.

**Main risk if done poorly:** CLI output schemas, incur-generated metadata, or CTA/help text could drift if migration happens piecemeal without keeping descriptor ownership explicit.

**Status in this patch:** reviewed only.
