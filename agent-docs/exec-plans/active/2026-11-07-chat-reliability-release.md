# Release timely and reliable chat replies

Status: active
Created: 2026-11-07
Updated: 2026-11-07

## Outcome and scope

Combine the tested notification-checkpoint and foreground usage-identity fixes
into one candidate. Preserve checkpoint-before-import, immutable usage records,
usage settlement, privacy, and delivery authority. No ledger repair, message
replay, forced runtime retirement, or authority bypass belongs in this release.

## Evidence and ownership

The implementation records are `2026-11-07-notification-checkpoint-latency.md`
and `2026-11-07-usage-ordinal-collision.md` under completed plans. Their local
proof remains valid; run focused combined proof before publication. The second
record's internal-only changelog decision is superseded: the shared
`timely-pending-chat-updates` entry describes both member-visible outcomes.

## Steps

1. Combine the two isolated commits and inspect the complete candidate.
2. Verify combined checkpoint/usage boundaries, typechecks, and changelog render.
3. Publish a draft PR when authorized; attach its number to changelog provenance.
4. Run one final ReviewGPT concurrently with exact-head CI, disposition findings,
   and preserve one completion owner.
5. Merge and deploy only with the required authorization and green release gates;
   coordinate deployment with other active release owners.
6. Read back deployed revision and bounded health/error evidence. Do not claim
   recovered replies without delivery evidence.

## Product UX and deployment

Ready for deterministic boundaries: notification-only and mixed system prefixes
checkpoint before import; maintenance-only batching stays unchanged. Streamed
children, failed reconsideration, tool interleaving, and late child settlement
use unique identities while preserving accounting and accepted-input ownership.
No prompt, tool, provider-input, schema, or runtime protocol changes. Old warm
containers retain old behavior until replaced; new containers accept existing
state. No coordinated Web migration is needed. A rollback reintroduces the old
bugs but does not require data conversion. This release does not repair prior
usage records or replay failed member messages.

## Verification and remaining gates

Combined candidate: 88 engine tests across four focused suites, 74 runtime
tests, and four changelog render tests passed. Engine, runtime, and Web
typechecks passed; complexity debt is unchanged; docs drift/gardening and
whitespace checks passed. Candidate review found no additional state, protocol,
provider calls, permission changes, or private artifacts. Exact-head CI, final
external review, publication and deployment authorization remain pending.
Existing implementation proof: 74 runtime tests, 149 engine
owner tests, 49 focused streamed/subagent tests (partly overlapping), typechecks,
complexity and documentation checks passed in the implementation worktrees.
