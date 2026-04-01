# Murph architecture review — 2026-04-01

This review stays grounded in the code that exists in this snapshot. It focuses on places where Murph is currently carrying the same concept in multiple shapes, where package seams are wider than they need to be, and where orchestration layers own more behavior than they should.

## 1. Landed in this pass: make hosted env policy a single owner

**Files / symbols / seam**

- `apps/cloudflare/src/user-env.ts` — `isHostedUserEnvKeyAllowed`
- `apps/cloudflare/src/runner-env.ts` — `buildHostedRunnerContainerEnv`, `filterHostedRunnerUserEnv`, `hostedAssistantAutomationEnabled`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts` — `hostedAssistantAutomationEnabledFromEnv`
- `packages/hosted-execution/src/env.ts` — new shared `hostedAssistantAutomationEnabledFromEnv`
- new `apps/cloudflare/src/hosted-env-policy.ts`

**Current complexity cost / maintenance risk**

Murph was carrying hosted env policy in multiple places:

- the per-user env allowlist lived in `user-env.ts`
- the runner-forwarding allowlist lived in `runner-env.ts`
- the automation on/off invariant was parsed independently in both Cloudflare and assistant-runtime

That meant adding one env key or changing one automation rule could require parallel edits across multiple packages, with drift that would only show up at runtime. This is exactly the kind of cross-layer policy that widens blast radius even when behavior is simple.

**Simpler target shape**

Treat hosted env policy as one explicit owner:

- `packages/hosted-execution/src/env.ts` owns the shared hosted automation flag parser
- `apps/cloudflare/src/hosted-env-policy.ts` owns Cloudflare-specific env admission and forwarding policy
- `runner-env.ts` becomes a thin compatibility re-export instead of a second owner
- `user-env.ts` consumes the shared policy instead of restating it

**Incremental refactor path**

1. Extract the shared flag parser into `@murphai/hosted-execution`.
2. Extract Cloudflare env policy into one local module.
3. Keep existing public imports stable by leaving `runner-env.ts` as a forwarding module.
4. Only after the seam proves stable, consider moving more hosted env metadata there if another real duplication appears.

**Main risk if done poorly**

If this seam is over-generalized, it can become another vague “env manager” layer. The safe version is narrow: one module owns policy, while caller-specific behavior stays in the caller.

## 2. Query still carries two near-duplicate read-model shapes

**Files / symbols / seam**

- `packages/query/src/canonical-entities.ts` — `CanonicalEntity`, `CanonicalEntityLink`
- `packages/query/src/model.ts` — `VaultRecord`, `VaultReadModel`, `toCanonicalEntity`, `relatedIdsToLinks`

**Current complexity cost / maintenance risk**

`CanonicalEntity` and `VaultRecord` describe almost the same underlying thing with field renames and compatibility baggage:

- `entityId` vs `displayId`
- `family` vs `recordType`
- `parentEntityId`/`parentEntityDisplayId` vs `parentId`
- `relatedEntities` vs `relatedIds`
- `metadata.path` vs `relativePath`
- `metadata.title` vs `displayName`

That duplication means new registry-backed entity behavior has to be threaded through two read-model vocabularies before the UI or CLI can use it. It also obscures which shape is the actual package seam versus which one is legacy presentation glue.

**Simpler target shape**

Pick one shared read-model owner for the generic registry-backed entity shape and make the other layer a compatibility adapter only. The better candidate is probably the `CanonicalEntity` shape, because it already packages link metadata and generic entity concepts in one place.

**Incremental refactor path**

1. Freeze one shape as canonical for new call sites.
2. Move conversion logic into a dedicated adapter module.
3. Stop letting new query helpers invent against both shapes.
4. Remove the duplicate structure only after the current consumers have converged.

**Main risk if done poorly**

If the convergence happens too aggressively, callers that still depend on today’s `VaultRecord` quirks could lose fields or subtly change output ordering. The safe move is to narrow ownership first, then delete the extra shape later.

## 3. `apps/web` still has orchestration-heavy service modules that want narrower owners

**Files / symbols / seam**

- `apps/web/src/lib/device-sync/control-plane.ts`
- `apps/web/src/lib/hosted-onboarding/member-service.ts`
- `apps/web/src/lib/hosted-share/link-service.ts`

**Current complexity cost / maintenance risk**

Murph’s hosted web layer keeps accumulating large service files that mix:

- environment/config assembly
- auth and trust checks
- persistence orchestration
- side-effect dispatch preparation
- response shaping

These files are still coherent enough to work in the current repo, but they widen the blast radius of routine changes. A small feature tweak often means reopening a file that also carries trust-boundary logic, transactional invariants, and dispatch wiring.

**Simpler target shape**

Keep the route entrypoints thin and move toward “composition root + focused behavior owner” splits:

- request-scoped composition root
- persistence/state transition owner
- side-effect/dispatch owner
- response/view-model adapter

That keeps the app-local seam intact without forcing premature package extraction.

**Incremental refactor path**

Start with the highest-churn methods rather than splitting whole files at once. For example, extract one focused behavior cluster from `control-plane.ts` or `member-service.ts`, keep the facade stable, and prove the seam before carving further.

**Main risk if done poorly**

A bad split can duplicate request-scoped config or widen trust boundaries by letting multiple helpers rebuild their own auth/environment assumptions. The seam has to preserve one request-scoped owner.

## 4. The hosted runner request envelope still spans too many layers

**Files / symbols / seam**

- `packages/hosted-execution/src/contracts.ts`
- `packages/assistant-runtime/src/hosted-runtime/models.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/runner-container.ts`

**Current complexity cost / maintenance risk**

Murph currently carries the runner request across multiple layers with slightly different shapes and parsers. That makes it harder to answer simple ownership questions like:

- which fields are shared runtime contract versus Cloudflare-local transport detail?
- where should validation fail closed?
- which package owns future optional execution knobs?

The longer this stays spread out, the easier it becomes for one layer to quietly widen the contract without another layer noticing.

**Simpler target shape**

Keep one shared runtime job envelope and one tiny Cloudflare-local wrapper for worker/container transport-only fields. Everything else should be parsed and validated once.

**Incremental refactor path**

First centralize the Cloudflare-local request parsing into one module. Then decide whether the shared runtime envelope belongs in `@murphai/hosted-execution` or remains owned by `@murphai/assistant-runtime`.

**Main risk if done poorly**

Flattening too much could leak Cloudflare-only transport details into shared runtime packages or weaken fail-closed parsing.

## 5. Error-response policy in `apps/web` still wants one owner

**Files / symbols / seam**

- `apps/web/src/lib/http.ts`
- `apps/web/src/lib/device-sync/http.ts`
- `apps/web/src/lib/hosted-onboarding/http.ts`
- `apps/web/src/lib/linq/http.ts`

**Current complexity cost / maintenance risk**

The app has a common low-level JSON error response builder, but domain-local wrappers still restate similar adapter logic. That keeps today’s behavior mostly aligned, but future changes to logging, status shaping, or headers will still fan out.

**Simpler target shape**

One app-level error-adapter factory should own generic HTTP behavior, while each domain supplies only the domain-specific matcher/default policy.

**Incremental refactor path**

Introduce a tiny factory without changing route signatures. Migrate domains one at a time.

**Main risk if done poorly**

An over-generic helper can hide domain policy differences that should stay explicit.

## 6. Keep these seams as-is

### Contracts-owned health taxonomy

`packages/contracts/src/health-entities.ts` still looks like the correct owner. The right simplification is deleting downstream restatements, not scattering taxonomy ownership again.

### `@murphai/runtime-state` root vs `/node`

This remains a real environment boundary, not accidental structure. Browser-safe/shared types on the root export and filesystem/SQLite helpers on `/node` is still the right split.

### Gateway-local assistant adapter

`packages/gateway-local/src/assistant-adapter.ts` still earns its keep. It keeps the gateway layer pointed at a narrow assistant-facing bridge instead of importing assistant-core behavior directly into send/store code.
