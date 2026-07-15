# Family Edge Sol Entitlement

Status: completed
Updated: 2026-07-15

## Goal

Let an active personal member assigned to a paid Family Edge seat choose GPT-5.6
Sol through Settings or conversation, while Family Pulse seats and inactive
Family memberships remain ineligible.

## Root Cause

The assistant-model resolver predates mixed-tier Family billing and reads only
the member's direct billing reference for Sol eligibility. Family conversion
correctly clears direct billing and stores the member's tier on the active
Family membership, so a paid Family Edge seat is currently misclassified as
non-Edge even though usage allowance and Settings both project it as Edge.

## Invariants

- Web-owned Postgres member, membership, and group facts remain the only
  entitlement authority; do not add a cache, flag, or duplicate plan state.
- Direct paid Edge remains eligible and direct Pulse/trial remains ineligible.
- Family Edge is eligible only while the personal member, membership, and
  sponsoring group are active and unsuspended; Family Pulse stays ineligible.
- Synthetic thread containers keep their existing derived Sol behavior and
  remain unable to persist personal model preferences.
- Model writes lock and re-read sponsored-access rows so a stale page or turn
  cannot save Sol after a concurrent Family downgrade or removal.
- No schema, protocol, Cloudflare, or runner change is required.

## Plan

1. Extend the existing assistant-model member projection with the assigned
   Family tier and derive Sol eligibility from direct paid Edge or active
   Family Edge access.
2. Lock sponsored-access rows before the transactional eligibility re-read.
3. Add focused coverage for Family Edge eligibility, Family Pulse rejection,
   inactive/suspended Family rejection, runtime projection, and stale-write
   locking.
4. Update the durable hosted plan docs to reflect Family Edge model access.
5. Run scoped verification, direct Settings proof, required audit passes, final
   review, and the normal PR ReviewGPT/CI loop.

## Verification Target

- A Family owner or member with an active Edge assignment sees Sol in Settings,
  can save it, and receives the Sol next-turn runtime override.
- A Family Pulse member still sees the locked Sol explanation and cannot save
  Sol through either Settings or conversation.
- Direct Edge, direct Pulse, dormant Sol restoration, reasoning preferences,
  and thread-container defaults retain their existing behavior.

## Deployment

This is a Vercel web-only entitlement correction. No schema or cross-plane
protocol changes are involved; old and new web functions read the same existing
rows. After deploy, refresh Settings and save Sol. The next hosted invocation
consumes the existing signed workspace projection; an already-running turn may
keep its current model until the normal invocation boundary.

## Completion Evidence

- The focused assistant-model resolver test passed with 15 tests.
- The adjacent Settings snapshot, component, route, and hosted assistant-tool
  suite passed with 51 tests.
- `pnpm test:diff` passed the full hosted-web verification lane: repository
  guards, dependency and workspace boundaries, TypeScript, lint, Next
  development smoke, production build, and 5,215 passing tests across 429 test
  files.
- A direct production-code scenario invocation proved that an active Family
  Edge assignment with no direct billing reference resolves as Sol-eligible.
- The coverage-write audit found the existing proof sufficient and made no
  test changes. The frontend audit returned zero evidence-backed findings.
- Interactive rendered proof remains unavailable because the in-app browser
  had no available browser target. No component markup or styling changed; the
  affected projection and mutation states retain server-rendered and route
  coverage.
Completed: 2026-07-15
