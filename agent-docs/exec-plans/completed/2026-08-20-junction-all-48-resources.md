# Restore all 48 Junction resources in hosted collection

Status: completed
Created: 2026-08-20
Updated: 2026-08-20

Pull request: #2102

## Goal

- Existing hosted Junction connections collect every one of the 48 supported
  resource families without requiring a reconnect, while preserving the
  current bounded scheduling, provider-call, import, and recovery behavior.

## Success criteria

- Hosted production serialization retains the code-owned
  `JUNCTION_PRODUCTION_TIMESERIES_RESOURCES` list through member overlays.
- The serialized list is exactly the canonical 48-resource registry, with no
  duplicate or member-controlled additions.
- Omitted programmatic configuration still resolves the curated default; only
  the explicit production assembly changes.
- Focused resolver and policy tests pass, the affected package and Web
  typechecks pass, and the changelog fragment validates.
- The PR documents composed maximum fanout, rollout order, direct evidence,
  Product UX journeys, and residual freshness risk.
- Required preliminary and final ReviewGPT gates and exact-head CI are green.

## Scope

- In scope:
  - Restore the code-owned Junction production resource list in hosted runtime
    provider configuration.
  - Restore focused coverage that proves member overlays cannot replace it.
  - Publish a concise connected-health changelog item.
- Out of scope:
  - Changing global omitted-config defaults or per-resource importer support.
  - Adding concurrency, queues, retry state, provider-specific bypasses, or
    database work.
  - Changing member consent, connection setup, or device settings UI.

## Constraints

- Technical constraints:
  - Keep the provider registry as the one resource-policy owner.
  - Preserve one bounded resource/day (or closed-hour for page-heavy data)
    continuation unit, serial pagination, timeout/yield, and dense-stream
    reduction limits.
  - Preserve the distinction between an omitted list and an explicit list.
- Product/process constraints:
  - No member action or reconnect may be required.
  - Preserve foreground conversation preemption and existing retry/recovery.
  - Treat production aggregates as private and include only summarized,
    identifier-free operational evidence in durable artifacts.

## Risks and mitigations

1. Risk: A full sweep admits 17 more resource families than the current curated
   hosted default, increasing external provider work and catch-up time.
   Mitigation: Retain the existing serial continuation, timeout, pagination,
   dense-data reduction, and retry bounds; deploy the hosted runner first and
   monitor pass duration, timeout yields, failures, rate limits, and queue age.
2. Risk: A member overlay could accidentally narrow or expand the production
   policy.
   Mitigation: Apply the code-owned list last and assert exact equality in a
   focused resolver test.
3. Risk: Deploy skew could advertise broader collection before the hosted
   runner uses it.
   Mitigation: The change is runtime-only; publish the Web changelog after the
   Cloudflare runner rollout is healthy.

## Tasks

1. Confirm the current policy owner, hosted serialization boundary, recent PR
   overlap, and production recovery/freshness evidence.
2. Restore the explicit all-48 list at the hosted boundary and update focused
   tests.
3. Run scoped tests, typechecks, policy/fanout proof, and Product UX replay.
4. Push an exact candidate, open the PR, add its changelog fragment, and close
   this plan in the final scoped commit.
5. Run preliminary specialist and final ReviewGPT gates alongside exact-head
   CI, resolve findings, and confirm mergeability.

## Decisions

- The code-owned `JUNCTION_PRODUCTION_TIMESERIES_RESOURCES` export remains the
  production policy owner. The hosted resolver will preserve it instead of
  changing all registry entries to enabled-by-default.
- The 17-resource expansion is accepted at the explicit request of the product
  owner. Existing production evidence shows recovered scheduling and no recent
  rate limiting, but timeout-yield frequency still makes rollout monitoring
  necessary.
- No new database path is introduced. The control-plane query count and open
  transaction count are unchanged; added work is bounded external collection.

## Verification

- Commands to run:
  - Focused assistant-runtime resolver test.
  - Focused device-sync policy/config tests that assert the 48-resource
    production list and its bounds.
  - Affected package typecheck and Web typecheck.
  - Focused changelog fragment/registry tests after the PR-numbered item lands.
  - Repository diff/privacy/secret checks and required PR exact-head CI.
- Expected outcomes:
  - Hosted serialization contains exactly 48 unique canonical resources after
    member overlays.
  - Omitted standalone config retains curated defaults.
  - No provider concurrency, database fanout, retry ownership, or consent
    behavior changes.

### Results

- Focused resolver regression proof failed before the source change because the
  hosted result omitted 47 of the 48 explicit production resources, then passed
  after the correction (3 tests).
- Device-sync config and manifest policy coverage passed (73 tests), proving
  exact all-48 activation and curated omitted-config defaults.
- Assistant-runtime and device-syncd typechecks passed.
- The changelog fragment generator, registry, archive rendering, and page tests
  passed (53 tests); the fully prepared Web typecheck passed.
- The browser-control runtime was unavailable in this session, so responsive
  screenshot inspection could not run. The existing server-rendered archive
  and design-study coverage provided the next-best local representation proof;
  exact-head CI remains the broad gate.
- Composed fanout remains bounded at 48 configured resources: 6 wide resources
  and 42 one-day resources. A full-job continuation owns one resource and one
  closed UTC day; ordinary collection is at most three serial single-attempt
  pages with an eight-second timeout per page (24 seconds maximum provider
  wait), and page-heavy features retry one closed hour. Workout streams admit
  at most 32 workouts, 100,000 points and 8 MiB per workout through serial
  reads; ECG admits at most 64 recordings and 100,000 samples per window. Both
  reduce before snapshot retention.
- The expansion changes explicit hosted external-provider admission from the
  current 31 curated resources to 48 (+17, about 55%). It does not add provider
  concurrency, database queries, transactions, pooled connections, retry state,
  or work identities. Recent aggregate production evidence showed paired
  device-sync passes and no provider rate limiting, while frequent bounded
  timeout yields keep rollout monitoring necessary.
Completed: 2026-08-20
