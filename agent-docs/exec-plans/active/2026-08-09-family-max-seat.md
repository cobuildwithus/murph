# Family Max seat

Status: active — ReviewGPT round 2 correction locally proved; exact-head gates pending
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Add a $49/person/month Max tier to Murph Family.
- Let the Family owner move an active member from Pulse or Edge to Max, and
  move a Max member back to Edge or Pulse, through the existing serialized
  member-plan transition.
- Preserve the existing Family billing, entitlement, privacy, and webhook
  owners without introducing another state machine or service.

## Success criteria

- Family checkout, invites, capacity, settings, assistant status, MRR, and
  per-member usage allowance all recognize Pulse, Edge, and Max.
- A Max Family seat grants the same Edge/Sol runtime capability as personal
  Max while receiving an 80%-of-price monthly usage allowance ($39.20).
- A member transition swaps exactly one licensed Stripe seat between its
  source and target tiers, remains retry-safe, and commits membership plus
  capacity only through webhook reconciliation.
- Settings offers every valid target tier, describes upgrade or downgrade
  direction from catalog prices, and preserves the pending-transition retry
  state.
- Database constraints accept only the three supported Family tier codes.
- Focused unit, PostgreSQL, type, lint, and rendered desktop/mobile design
  proof pass, followed by exact-head specialist and final ReviewGPT gates and
  green required GitHub Actions.

## Scope

- In scope: the Family tier catalog and cross-boundary type, Stripe price
  configuration, seat-capacity projection, invites and member transitions,
  usage and model entitlement, growth metrics, Settings UI, design catalog,
  database constraints, durable product docs, and focused coverage.
- Out of scope: changing personal Max behavior, creating a distinct Max
  runtime capability, changing Family size limits, shared usage pools, new
  billing orchestration, or mutating production Stripe state in this PR.

## Constraints

- Keep `HostedPlanCode` as the runtime capability type (`pulse | edge`). Define
  a Family billing tier type (`pulse | edge | max`) at the existing hosted
  execution contract boundary instead of widening runtime behavior globally.
- Use one Family offer catalog as the source of display name, price, Stripe env
  key, direct-billing equivalent, and runtime capability.
- Reuse the current owner/member Stripe locks, pending member plan field,
  idempotency path, per-tier capacity rows, and webhook reconciliation owner.
- Add no table, queue, service, background job, feature manager, or dependency.
- Preserve the existing invariant that assignments and pending invites never
  exceed billed capacity for any tier.

## Risks and mitigations

1. Risk: treating Max as a new runtime tier spreads branches across unrelated
   execution code. Mitigation: map Family Max to the existing Edge capability
   in the Family catalog and keep runtime codes unchanged.
2. Risk: a third tier breaks two-option UI and fixed-object assumptions.
   Mitigation: derive options, direction, totals, and empty projections from
   the Family catalog/code list and add explicit three-tier regression proof.
3. Risk: Web/Stripe/database rollout skew rejects Max rows or items.
   Mitigation: broaden constraints before exposure, require the Max price id
   fail-closed, deploy the Max-aware Web before attaching Max items, and verify
   provider items plus local capacity after the rollout.
4. Risk: a transition commits only one side of coupled membership/capacity
   state. Mitigation: retain webhook-only local mutation and test Pulse-to-Max,
   Edge-to-Max, Max-to-Edge, and Max-to-Pulse exact swaps.

## Tasks

1. Add the Family-specific tier contract and consolidate tier metadata in the
   billing catalog.
2. Extend environment/config, capacity math, Stripe item projection, member
   transitions, assistant projections, allowance/model eligibility, and MRR.
3. Add a forward-only migration that owns the complete Family assignment
   contract: fail-closed preflight, non-null membership/invite assignments, and
   the three Pulse/Edge/Max plan-code checks, with focused migration coverage.
4. Replace the binary member-plan dialog with a catalog-driven target picker,
   update the real component's design-catalog states, and capture desktop and
   mobile proof.
5. Update durable Family and usage contracts, run focused verification, finish
   the scoped commit, push, and open the PR.
6. Start preliminary completion-specialist and final ReviewGPT round 1 against
   the exact pushed head concurrently with CI; resolve accepted findings and
   repeat the exact-head gate when required.

## Decisions

- Family Max costs $49/person/month, preserving the established $1 Family
  discount relative to the $50 personal Max plan.
- Family Max's monthly cost-weighted usage allowance is $39.20 (80% of $49).
- Max maps to the existing Edge runtime capability and personal
  `launch_max_monthly` billing rank/reset semantics; it is a billing/allowance
  tier, not another execution mode.
- Existing member-plan swaps keep Stripe `create_prorations`, so the prorated
  upgrade charge or downgrade credit appears on the next invoice.
- The migration is the single owner of the current Family assignment contract:
  it rejects null or unsupported membership/invite assignments, makes those
  columns non-null, and installs exact Pulse/Edge/Max checks for membership,
  invite, and capacity rows. It does not add a speculative pending-plan
  constraint or rewrite historical migrations.
- ReviewGPT round 2 exposed review-induced purpose drift in the round-1
  supersession fix: the historical migration also owned assignment nullability,
  while the replacement initially owned only vocabulary. The retrospective is
  recorded on the PR before correction. The replacement now preserves the
  whole invariant, so the historical two-tier migration can remain superseded.

## Verification

- Focused Hosted Execution parser coverage passed: 64 tests.
- Focused Assistant Engine Family tool and skill coverage passed: 22 tests;
  Assistant Engine typecheck passed.
- Focused hosted-local Stripe configuration coverage passed: 34 tests;
  hosted-local-harness typecheck passed.
- Focused Web billing, settings, allowance, capacity, runtime, growth, route,
  migration, and assistant-model coverage passed. One unchanged settings
  projection case exceeded its default timeout under machine contention and
  passed alone with a bounded 180-second timeout. The final affected Family
  tool/model-preference slice passed 31 tests; Web typecheck passed.
- A clean disposable PostgreSQL database replayed all 170 Prisma migrations.
  The three broadened Family constraints were present, validated, and limited
  to `pulse`, `edge`, and `max`; the disposable database was then removed.
  Focused migration/guard coverage passed 61 tests.
- Changed Web TypeScript/TSX files passed ESLint with zero errors. Five
  existing-style unused-symbol warnings remain; none blocks the configured
  lint lane. `git diff --check` passed.
- Complete first-provider request capture used the pinned real Codex App
  Server, a local scripted Responses provider, `gpt-5.6-terra`, low reasoning,
  production code mode, 29 representative direct tools, 15 representative
  group tools, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized
  `include`, `input`, `parallel_tool_calls`, `text`, `tool_choice`, and `tools`,
  normalizing temporary/worktree paths and UUIDs identically. Direct measured
  30,505 to 30,508 tokens (+3, +0.0098%) and 139,422 to 139,428 bytes (+6);
  group measured 23,845 tokens and 109,728 bytes at both refs. The exact former
  Family tool description was reconstructed with a single asserted
  replacement; the deferred Max enum and changed skill bodies do not enter the
  first provider request. The temporary harness and captures were removed.
- The in-app Browser initialized but had no attached target. Its owning skill
  disallows a substitute controller, so desktop/mobile catalog screenshots are
  an explicit evidence gap rather than inferred proof. The fresh Claude Fable
  UI check was attempted with that gap and stopped on explicit usage-credit
  exhaustion, as required.
- Live Stripe now has the recurring $49 Family Max price on the existing Murph
  product, and Vercel Production has the encrypted price-id setting. The
  isolated GitHub Stripe sandbox remains blocked because this machine has no
  test-mode Stripe authority; its Family Max test price and repository variable
  must be configured before merging to `main` so the protected-main live
  billing lane can run.
- Exact pushed-head review and CI status:
- Preliminary specialists packaged the exact first head after one transient ZIP
  race retry, then returned `INVALID` solely because required desktop/mobile
  renders were absent. It reported no code finding or patch. Retry remains
  blocked on an attached in-app browser target.
- Final ReviewGPT round 1 returned one accepted High finding: the historical
  two-tier Family postdeploy contract migration remained scheduled after the
  new Prisma migration took ownership of the same constraints. The smallest
  correction marks that exact historical ID superseded and extends the existing
  omission proof; 52 focused migration/guard tests, Web typecheck, focused
  ESLint, and `git diff --check` pass after the correction.
- Round 1 also identified a deployment-note discrepancy. The durable Family
  contract is authoritative: configure all three price ids, deploy and verify
  the Max-aware hosted-execution parser and runner first, then run Web predeploy
  and deploy Web. Do not attach Max items while old Web can receive Family
  subscription events. No compatibility state machine is justified.
- Exact-head CI produced 12 green checks. The release-app/summary failures are
  a base-commit design-title assertion mismatch, and the viewport failure is a
  base-commit PR-specific screenshot spec that requires an unset output
  directory; the Family Max diff touches neither owner. Frontend design proof
  remains blocked by the missing required screenshot artifacts.
- Final ReviewGPT round 2 returned `RETROSPECTIVE_REQUIRED`: superseding the
  historical two-tier contract migration removed its separate non-null
  assignment guarantee on fresh databases. The PR retrospective affirms one
  complete Prisma migration owner and requires fresh, upgraded, and contract-
  runner proof of non-null assignment columns plus exact three-tier checks.
- The round-2 correction passed 61 focused migration/guard tests, Web
  typecheck, focused ESLint with one unchanged warning, and `git diff --check`.
  A disposable database replayed all 170 Prisma migrations and then ran the
  empty-ledger contract runner (14 applied, with the superseded historical
  migration absent). A second disposable database applied the historical
  Pulse/Edge contract first and recorded it in the ledger before applying the
  replacement. Both paths ended with membership, invite, and capacity
  `plan_code` columns non-null and all three validated exact Pulse/Edge/Max
  checks. Both test databases were removed after inspection.
- Pending: push that correction, capture/retry the preliminary
  specialist pass with desktop/mobile proof, configure the test Stripe sandbox
  price, then run the next exact-head final ReviewGPT round and CI to green.
- The first specialist artifact also required rendered proof of both transition
  directions. The inert design fixture now composes one current Max member, one
  current Edge member, and one Pulse member pending Max so the real component
  can demonstrate downgrade choices, upgrade-to-Max choices, confirmation, and
  the existing pending/retry state without live data or mutations.
