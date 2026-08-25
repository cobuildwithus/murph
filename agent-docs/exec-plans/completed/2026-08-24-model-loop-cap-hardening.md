# Bound model-backed retry loops and cap overshoot

Status: completed
Created: 2026-08-24
Updated: 2026-08-25

## Goal

- Prevent one model-backed durable work item from generating an unbounded
  sequence of paid provider calls, and stop further paid calls after the
  crossing request settles without adding reservation or distributed
  transaction machinery.
- Make preliminary specialist review reason about the complete production
  composition of changed features and prefer the highest stable composed or
  end-to-end proof over isolated unit seams.

## Success criteria

- The existing target-group mailbox wake asks the group model for one ordinary
  message, and the runtime sends that text through the existing deduplicated
  outbox without asking the model to restate a `send_message` decision or
  supply an unused private summary.
- Deterministic output, configuration, policy, route, and expiry failures do
  not enter the generic retry loop; explicitly transient model-backed failures
  have a small persisted work-item attempt bound that survives restore.
- A settled managed-provider usage record refreshes or revokes warm-runtime
  admission before the same durable item can start another paid attempt. A
  denied or unavailable gate starts no provider work and preserves recoverable
  accepted input.
- Focused production-shaped tests compose prompt planning, provider output,
  deterministic send construction, usage settlement, retry state, restore,
  allowance denial, and the provider fence. The tests prove provider-call
  cardinality and that no later paid request starts after settled denial.
- Workflow and coverage-review guidance require reviewers to map the full
  feature composition and prefer truthful composed/E2E evidence when lower
  seams cannot prove the invariant.
- Focused tests and relevant typechecks pass; the exact pushed PR head clears
  applicable preliminary and final ReviewGPT gates and required CI.

## Scope

- In scope:
  - assistant-engine plain-text output for the existing context-handoff turn;
  - assistant-runtime retry disposition and durable item-level attempt bounds
    for model-backed system work;
  - the existing Web/Cloudflare usage-record and provider-admission owners
    needed to revoke stale warm-runtime allowance;
  - production-shaped cross-package proof, safe loop/cap diagnostics, and the
    preliminary specialist/coverage workflow principle.
- Out of scope:
  - changing or pushing the separately owned PR #2168 branch;
  - atomic allowance reservation, a new billing ledger, queue, dead-letter
    service, scheduler, or generalized state machine;
  - a global attempt cap for model-free, delivery, device-sync, or other
    product-critical mailbox work;
  - copying private incident data, identifiers, transcripts, or exact
    production artifacts into tests or documentation.

## Product UX

- Outcome: a requested private-to-group handoff reaches the group once as a
  natural message and cannot silently become a paid retry storm.
- Reaches: the existing private requester, target group, and blocked-allowance
  recovery journeys; no new audience or authority relationship is introduced.
- Proof: replay the real private-to-group route through delivery, settlement,
  and a later blocked group input, plus focused terminal/transient restore
  cases for the handoff work item.

## Constraints

- Technical constraints:
  - Reuse current mailbox attempt state, usage accounting, workspace gate,
    provider fence, and terminal no-send/outbox recovery owners.
  - Keep the normal foreground path and model-free system work intact. Do not
    silently discard accepted user-critical work on a transient control-plane
    failure.
  - Prefer settlement plus fresh authorization over cost reservation; only one
    already-started bounded request may cross the cap.
- Product/process constraints:
  - This branch is stacked on the exact inspected head of PR #2168 but has no
    authority to mutate that live branch.
  - ReviewGPT implements the first patch; the parent inspects every hunk,
    applies it deliberately, verifies it, and owns remediation and PR gates.
  - Keep all durable artifacts public-safe and identifier-free.

## Risks and mitigations

1. Risk: A broad mailbox retry cap drops transient product-critical work.
   Mitigation: Apply explicit retry dispositions and the fuse only to
   model-backed system items; retain existing owners for model-free work.
2. Risk: Fresh allowance checks add unnecessary foreground latency or database
   fanout.
   Mitigation: Reuse the existing accounting response/fence and require a
   refresh between repeated model-backed item attempts, not a new service or
   independent polling loop.
3. Risk: A control-plane or accounting failure causes another paid attempt.
   Mitigation: Park recoverable model work and retry settlement/gating only;
   provider admission fails closed until authoritative capacity is known.
4. Risk: A stacked patch conflicts when PR #2168 lands.
   Mitigation: Keep the delta narrowly additive, record the exact dependency,
   and reconcile once against current main before the final candidate review.

## Tasks

1. Delegate the bounded implementation to ReviewGPT and require an attachment
   patch with focused production-shaped tests and the workflow-doc change.
2. Inspect and apply the returned patch; reject speculative state or duplicated
   machinery and close any remaining owner-boundary gaps locally.
3. Run focused engine/runtime/Web/Cloudflare tests and relevant typechecks,
   including provider-call cardinality and cap-denial composition proof.
4. Commit and push the scoped candidate, open a draft PR, then run the
   applicable preliminary specialist and final ReviewGPT gates concurrently
   with required CI at the exact candidate head.
5. Resolve accepted findings, perform the parent final review, close the plan,
   and leave the active worktree until the stacked PR is merged or closed.

## Decisions

- Do not implement atomic cost reservation. Product accepts bounded overshoot
  in the ten-to-twenty-percent range as an operational target. This patch
  guarantees no later paid request after settled denial and alerts above twenty
  percent; it does not claim a mathematical percentage ceiling for the one
  already-admitted request. Such a ceiling would require reservation or a
  provider-request cost bound.
- Keep the existing durable context-handoff mailbox, route proof, expiry,
  output-only model profile, and delivery idempotency, but remove the generic
  notification JSON decision envelope from this required-send path.
- Prefer deletion and explicit terminal/transient classification over a new
  queue, dead-letter service, or generalized retry framework.

## Verification

- Focused evidence:
  - Assistant engine: 75 focused tests passed; typecheck passed.
  - Assistant runtime: 59 focused mailbox tests passed; typecheck passed.
  - Hosted execution: 32 protocol tests passed; typecheck passed.
  - Web: 142 allowance, route, cron, and alert tests passed; prepared
    typecheck passed.
  - Cloudflare: 465 focused proxy, fence-state, Durable Object, and platform
    tests passed; typecheck passed.
  - Agent-doc drift and gardening checks passed.
  - The hosted-local usage-limit scenario rebuilt and passed deployment smoke,
    but repeated local MinIO health failures and a runner exit 137 prevented a
    clean end-to-end completion. The missing production Durable Object RPC was
    found through that composition and fixed; exact-head CI owns the fresh
    hosted-local rerun.
- Verified outcomes:
  - An ordinary non-empty group-model response is delivered without JSON
    parsing; empty output is terminal without a retry.
  - Explicit transient failures respect the persisted item bound.
  - The crossing request may finish, but every later attempt sees denial before
    provider entry; a separate operational incident alerts if the resulting
    allowance period exceeds its cap by more than twenty percent.
  - Specialist review explicitly evaluates the entire feature composition and
    rejects isolated seam proof when a stable composed/E2E boundary exists.
  - The preliminary specialist findings were dispositioned and resolved; final
    ReviewGPT round 1 returned `PASS` with no findings on the immutable pushed
    candidate.
  - After the single current-main merge, the affected focused suites passed:
    75 engine tests, 59 runtime tests, 33 hosted-control tests, 129 Web tests,
    and 685 Cloudflare tests. All five affected typechecks, docs drift, and doc
    gardening passed.
Completed: 2026-08-25
