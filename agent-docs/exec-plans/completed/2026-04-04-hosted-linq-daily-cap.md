# 2026-04-04 Hosted Linq Daily Cap

## Goal

Add a hosted Linq-only daily state seam that:

- hard-caps active hosted-member inbound Linq messages at 100 per UTC day
- removes the message-text onboarding heuristic so any valid first-contact Linq text gets an onboarding link
- suppresses onboarding links and quota replies to at most once per UTC day
- records outbound Linq counts from the echoed Linq webhook stream without storing raw message content or raw phone numbers

## Scope

- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-onboarding/**`
- Focused hosted-onboarding tests under `apps/web/test/**`
- `ARCHITECTURE.md`

## Constraints

- Keep the hard cap at hosted Linq ingress before hosted execution dispatch is enqueued.
- Preserve webhook idempotency: duplicate webhook deliveries must not burn quota or double-count outbound messages.
- Store only member ids, UTC day buckets, counts, and notice timestamps in the new daily state.
- Do not reuse content-bearing payload or event tables as the canonical quota store.
- Preserve unrelated dirty-tree edits in overlapping hosted and web files.

## Plan

1. Add a small hosted Linq daily-state model and helper functions for UTC-day upserts and once-per-day notice claims.
2. Refactor the Linq webhook planner to remove the onboarding-text gate, enforce the 100/day inbound cap for active members, and suppress onboarding and quota replies after the first send that day.
3. Count Linq outbound echo webhooks against the same daily state without dispatching hosted execution.
4. Update focused hosted-onboarding tests, run required verification plus direct scenario proof, then complete the required audit and scoped commit.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
