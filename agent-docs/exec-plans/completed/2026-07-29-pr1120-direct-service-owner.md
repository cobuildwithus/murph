# PR #1120 exact Linq service owner

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Preserve exact iMessage-only new-person mission eligibility through the real
  persisted direct-input scanner path, with one narrow service resolver and no
  new durable state or delivery authority.

## Success criteria

- A persisted direct Linq/iMessage input reaches referral read and arm with
  `linqService: "imessage"` through the real automation operation scope.
- Persisted SMS, RCS, unknown, or ambiguous service evidence fails closed for
  the new-person mission; active-group eligibility remains provider-neutral.
- Target binding still requires provider-owned exact iMessage evidence.
- Final ReviewGPT reaches `ROUND_OUTCOME: PASS`, exact-head CI is green, and the
  PR merges with required deployment proof.

## Scope

- In scope: assistant-runtime persisted-input operation context, referral source
  request shaping, focused runtime/Web journey proof, retrospective and PR-body
  truth, verification, final review, CI, merge, and cleanup.
- Out of scope: schema or mailbox-format changes, new lifecycle or fallback
  machinery, delivery/egress authority changes, referral-policy redesign, and
  provider reconciliation.

## Constraints

- Technical constraints: `AssistantInputEventRecord.sourceMetadata.service` is
  the existing durable provider-fact owner. Service eligibility must remain
  distinct from group sender, participant, route, and egress authority.
- Product/process constraints: exact iMessage evidence is mandatory at source
  and target; the referrer still receives only one natural introduction goal;
  setup remains newcomer-initiated and private.

## Risks and mitigations

1. Risk: widening direct service reconstruction could accidentally grant group
   mutation or egress authority.
   Mitigation: carry only a normalized service enum for referral policy; retain
   the existing group-only delivery-context resolver unchanged.
2. Risk: another helper-level test could miss scanner reconstruction.
   Mitigation: persist real direct input records and invoke the real
   `runAutoReplyGroup` operation scope through the runtime port boundary.

## Tasks

1. Record the ReviewGPT anomaly retrospective and choose one owner.
2. Decouple referral service evidence from group-only delivery contexts.
3. Add persisted direct-input operation-scope proof plus affected focused tests.
4. Run scoped verification, close the plan into a commit, push, and update the
   PR intent/change-shape contract.
5. Run final ReviewGPT round 3 concurrently with exact-head CI, then merge,
   verify deploy order/runtime readiness, and retire both task worktrees.

## Decisions

- Original requirement: members can start the new-person mission from their
  ordinary direct iMessage conversation; SMS/RCS/unknown/Telegram fail closed;
  active-group remains provider-neutral; no onboarding checklist or new state.
- First-reviewed shape (`6854b2f315`): source eligibility trusted only channel,
  incorrectly admitting SMS and RCS.
- Round-2 shape (`a4d6c72829`): exact service became mandatory but was derived
  from `HostedAssistantLinqDeliveryContext`, whose persisted-input
  reconstruction is intentionally group-only. This converted false-positive
  eligibility into deterministic direct-iMessage false-negative eligibility.
- Review-driven growth added service propagation and policy proof but reused the
  wrong authority abstraction. The repeated mechanism is incomplete ownership
  of the accepted provider fact, not a need for more state.
- Decision: continue after collapsing service ownership onto the already
  persisted `AssistantInputEventRecord.sourceMetadata.service`. Add one narrow
  operation-context service value used only for referral policy and delete the
  referral derivation from group delivery contexts. Keep the existing
  group-only context resolver for sender/mutation/egress authority.

## Verification

- Focused assistant-runtime operation-scope and group-tool tests.
- Focused hosted-execution parser and hosted-web referral policy/tool/provider
  tests, including the PostgreSQL activation/return journey.
- Prepared typechecks for touched owners, touched lint, `git diff --check`, and
  frontend design proof.
- `pnpm test:diff` and `pnpm verify:acceptance`, with documented unrelated
  shared-host or harness blockers only when reproduced.
- Final ReviewGPT correction round 3 with immutable first and previous reviewed
  head lineage, exact-head CI, mergeability proof, merge, deploy verification,
  and worktree retirement.
Completed: 2026-07-29
