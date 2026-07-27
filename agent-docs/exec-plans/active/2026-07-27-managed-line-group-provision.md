# Managed Linq line authority for group provisioning

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Integrate the returned Pro patch so Linq group-chat auto-provisioning accepts
  an active member only when the inbound recipient belongs to the existing
  configured, enabled, operational Murph-managed Linq line pool rather than the
  member's committed home line.

## Success criteria

- New group-route admission uses the shared managed-line predicate.
- Existing established thread-route delivery remains independent of current
  line-pool eligibility.
- Unknown, unmanaged, inactive, paused, or suspended paths fail before
  provisioning.
- Focused tests cover the returned behavior.
- Repo-required verification and final diff review are complete.

## Scope

- In scope: `apps/web` Linq group-chat admission, focused hosted Linq tests, and
  the hosted-runtime protocol note returned by Pro.
- Out of scope: schema changes, home-line assignment capacity, proactive
  conversation counters, delivery behavior, billing behavior, provider
  integrations, and broader group provisioning redesign.

## Constraints

- Technical constraints: keep line authority inside existing
  `HostedLinqLine` operational state, preserve established-route authority, and
  avoid adding queues, fallback maps, or new persisted state.
- Product/process constraints: preserve recipient-initiated group flow, do not
  create extra outbound messages, and keep the patch scoped to the retained
  assistant response and downloaded artifact.

## Risks and mitigations

1. Risk: admitting arbitrary webhook recipient numbers could mint group
   containers.
   Mitigation: require a lookup-key match against the active managed line pool.
2. Risk: line-health or configuration changes could break already-established
   routes.
   Mitigation: leave existing route resolution ahead of the new-route admission
   check and cover it in tests.

## Tasks

1. Apply and inspect the returned Pro patch.
2. Adjust for current `origin/main` if needed while preserving the intended
   ownership boundary.
3. Run focused and canonical verification for the touched owner.
4. Perform parent final review, close the plan, and create the scoped commit.

## Decisions

- Use the active managed-line predicate already shared by assignable home-line
  readiness instead of introducing a new route-authority table or capacity
  counter.

## Verification

- Commands to run: `pnpm test:diff agent-docs/references/hosted-runtime-protocol.md apps/web/src/lib/hosted-onboarding/linq-line-store.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-thread-route.test.ts`.
- Expected outcomes: focused diff-aware verification passes; if it is blocked
  by unrelated workspace state, report the exact blocker and strongest focused
  proof run.
