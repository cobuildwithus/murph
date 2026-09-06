# Retire drained Linq compatibility fields

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Remove two drained Linq rolling-compatibility surfaces without changing
  member-visible delivery: the obsolete guard-only provider-start telemetry
  shape and the deprecated engagement-response fields superseded by the
  canonical `resolvedRoute` response.

## Success criteria

- No runtime-control producer, parser, type, storage filter, or test accepts or
  emits `linqEgressGuardMs`.
- The hosted-runtime Linq engagement route returns `resolvedRoute` as its sole
  route authority, and the active Cloudflare runtime continues reading only
  that canonical field.
- Focused shared-package, Web, and Cloudflare tests and typechecks pass.
- The deploy owner doc states the supported version-skew matrix, hard rollback
  floor, safe deployment order, recovery path, and post-deploy checks.
- The exact pushed draft-PR head passes the applicable ReviewGPT gates and
  required CI without merging the PR.

## Scope

- In scope:
  - Delete the Web latency-store legacy provider-start filter and its test.
  - Delete `linqEgressGuardMs` from the shared runtime-control type, allowlist,
    parser, and round-trip test.
  - Delete deprecated top-level `threadIsDirect` and `targetOverride` fields
    from the internal Linq engagement response and remove legacy-response
    compatibility assertions.
  - Update the canonical Linq send-route deploy contract.
- Out of scope:
  - Linq delivery-request `threadIsDirect`, canonical
    `resolvedRoute.threadIsDirect`, mailbox routing state, or database columns.
  - Delivery policy, route revalidation, dispatch idempotency, callback
    authentication, provider calls, or member-facing copy.
  - Production deployment or PR merge.

## Constraints

- Technical constraints:
  - Preserve current-runtime plus old-Web skew while making pre-canonical
    runtimes an explicit unsupported rollback target after Web deployment.
  - Do not add state, abstractions, dependencies, retries, or data migrations.
- Product/process constraints:
  - Keep private evidence and local identifiers out of repository artifacts.
  - Use the sanctioned task worktree, Frog workflow, scoped commit, draft PR,
    lane `apollo`, sequential specialist/final review, and no merge.

## Risks and mitigations

1. Risk: Web could stop serving a field still read by a deployed runtime.
   Mitigation: retain `resolvedRoute`, prove the current Cloudflare parser reads
   only that field, document a runtime-first deployment order, and make the
   canonical reader the rollback floor.
2. Risk: removing the telemetry leaf could discard otherwise valid latency
   diagnostics from an old callback.
   Mitigation: current emitters no longer produce the leaf, signed callbacks
   are short-lived and nonce-bound, and the old runner must be drained before
   the Web cleanup deploy.
3. Risk: broad `threadIsDirect` deletion could break canonical delivery.
   Mitigation: remove only the deprecated top-level engagement-response field;
   keep canonical route and delivery-request fields unchanged.

## Tasks

1. Inventory every legacy field occurrence and the current Cloudflare consumer.
2. Delete the drained telemetry and engagement-response compatibility code.
3. Update focused tests and the current deploy contract.
4. Run shared-package, Web, and Cloudflare focused verification and typechecks.
5. Inspect and commit the scoped diff, push it, and open a draft PR.
6. Run completion specialists and final PR review sequentially on lane `apollo`
   while exact-head CI runs; stop without merging.

## Decisions

- Treat `resolvedRoute` as the only supported engagement-response route shape.
- Keep all independent authorization, route-revalidation, dispatch-claim, and
  delivery guards; this cleanup removes compatibility representation only.
- Changelog is not applicable because member-visible behavior is unchanged.

## Verification

- Commands to run:
  - Focused hosted-execution runtime-control test.
  - Focused Web latency-store and Linq engagement-route tests.
  - Focused Cloudflare runtime-platform canonical-route test.
  - Typechecks for `packages/hosted-execution`, `apps/web`, and
    `apps/cloudflare`.
  - Repository grep proving no active legacy emitter/consumer, `git diff
    --check`, and applicable documentation guards.
- Expected outcomes:
  - All focused tests and typechecks pass.
  - The remaining `threadIsDirect` occurrences belong to canonical route or
    delivery shapes, not the removed top-level engagement response.
  - No `linqEgressGuardMs` occurrence remains, and no engagement-response
    `targetOverride` occurrence remains in Linq source, tests, or current owner
    documentation.
- Results:
  - Hosted-execution focused parser test: 1 file, 33 tests passed.
  - Web focused latency/engagement tests: 2 files, 92 tests passed.
  - Cloudflare focused runtime-platform test: 1 file, 202 tests passed.
  - Hosted-execution, Web, and Cloudflare typechecks passed.
  - Scenario-manifest integrity passed for 207 scenarios.
  - Agent-doc drift and `git diff --check` passed.
  - Scoped static searches found no active retired telemetry field and no
    deprecated engagement-response override in the affected boundary.
Completed: 2026-08-28
