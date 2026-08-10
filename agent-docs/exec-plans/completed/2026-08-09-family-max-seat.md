# Family Max seat

Status: completed
Created: 2026-08-09
Updated: 2026-08-10

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
- The preliminary specialists found three bounded gaps on the corrected head:
  Family guidance omitted the Max-versus-Edge usage distinction, the three-tier
  selector clipped its labels, and Max downgrade interactions lacked executable
  coverage. The correction keeps Edge/Max capability semantics explicit,
  lets the existing selector grow to its content, and exercises Max-to-Edge and
  Max-to-Pulse through the production component.

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
- The in-app Browser initialized but had no attached target. A local isolated
  Next server and Playwright captured the real inert design component instead.
  Desktop and mobile evidence covers the overview, both transition directions,
  pending/retry state, and Pulse, Edge, and Max invite selectors. The corrected
  selector captures prove each full label and price remains inside the control;
  automation also proved keyboard focus, selected-state semantics, and enabled
  paid-seat CTAs for all three choices.
- Live Stripe has the recurring $49 Family Max price on the existing Murph
  product, and Vercel Production has the encrypted price-id setting. The
  isolated GitHub Stripe sandbox has one matching test-mode monthly price on
  the same product as the Pulse and Edge prices, and its protected environment
  variable is configured without persisting provider identifiers locally.
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
- Exact-head CI on the complete database correction and three-tier design-study
  head produced a fully green required check set, including the hosted preview.
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
- The first specialist retry was invalid because its evidence omitted the
  invite-tier and retry renders. A complete retry against the corrected head
  returned three substantive findings: general Family guidance did not explain
  that Max adds usage over Edge without another capability, the fixed-height
  tier selectors clipped all three price labels, and executable interaction
  coverage omitted Max-to-Edge/Pulse. All three are resolved in the current
  candidate. The selector evidence was recaptured at desktop and mobile sizes;
  the focused Web component suite passes 26 tests, the focused Family skill
  suite passes 4 tests, both Web and Assistant Engine typechecks pass, focused
  Web lint passes without findings, and `git diff --check` passes.
- The specialist remediation was committed and pushed. Final ReviewGPT round 3
  rechecked the migration and all specialist corrections, then returned one
  necessary-but-undisclosed Purpose Drift finding: after the first durable Max
  item or assignment, pre-Max Web and hosted-execution artifacts are unsafe
  rollback targets. The PR intent contract and durable Family deployment owner
  now state the hard rollback floors, coordinated roll-forward recovery, and
  the exact legacy-rejection/current-acceptance proof. No compatibility shim,
  repair path, or new state owner was added.
- GitHub's round-3 merge candidate exposed one Release app verification failure:
  current `main` had added the static Family setup route without registering it
  in the telemetry inventory. The one-line inventory repair remains separately
  owned rather than expanding Family Max; final ReviewGPT classified the issue
  as pre-existing or adjacent, and the next exact pushed-head check set passed
  Release app verification and the umbrella release check.
- The rollback-floor correction passes 5 focused Web capacity tests plus 4
  focused hosted-runtime parser tests. Web and hosted-execution
  typechecks pass; changed Web files pass ESLint with zero errors and one
  unrelated existing warning; `git diff --check` passes.
- Final ReviewGPT round 4 audited the complete sensitive snapshot at the exact
  rollback-floor head and returned `PASS` with no qualifying findings. It
  verified every earlier finding and retrospective disposition. Its only notes
  were a one-line PR-body count discrepancy, now corrected against the guarded
  diff, and the already-disclosed lack of embedded renders in the final ZIP;
  the hosted desktop/mobile proof remains linked from the PR.
- Pending: archive this completed plan with the final scoped commit, push the
  plan-only head, confirm exact-head CI, merge the PR, and retire the worktree.
Completed: 2026-08-10
