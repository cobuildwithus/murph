# Linq email recovery ownership

## Outcome and invariant

Keep email-handle instant start confined to private direct iMessage. Every
supported email route has one member owner and an authenticated encrypted
identity source that survives temporary-route promotion. Existing group
admission still requires verified email or its exact recovered route.

## Handoff and retrospective

The user handed off the paused PR #2820 at unchanged head `92317ea95bb7`.
The task worktree is clean and matches the remote. Round 2 reviewed
`76580828af9d`; the later head corrected isolated tests only. The immutable
first-reviewed head remains `4e2e61eca55baf61664dba2a117219f56c35d3ec`.

Round 1 added encrypted-source continuity and canonical email conflict and
unlink checks. Round 2 exposed the same omitted-owner mechanism in recovery:
shared group preflight reads a handle that the group transaction does not;
recovery writes pending routing without identity ownership or retained source.
Static caller and writer inspection confirms both gaps. Activation clears the
pending source. This is an authority-completeness defect, not a need for more
state or a new group identity feature.

Decision: shrink the accidental group expansion and route recovery through the
existing identity writer. Retain the supported recovery journey. Keep the
existing contact lock, member identity, routing owner, unique constraints,
crypto preparation, and transaction. Add no schema, lifecycle, service, or
reconciliation mechanism. Recovery checks ownership before mutation and writes
identity plus temporary routing atomically. Direct lookup alone recognizes the
durable handle; group preflight and planning retain their existing verified or
exact pending-contact rules.

## Product UX plan

- Effort: Patch restoring the accepted direct-only promise.
- Outcome: Direct replies retain identity; group setup and recovery agree on
  account ownership without granting verified-email authority.
- Reaches: Handle-only members entering group setup; same-account and conflicting
  recovery; recovered email routing through direct use and activation.
- Proof: Composed admission/planner regression, recovery endpoint conflict and
  atomicity proof, source retention through real routing promotion, focused
  PostgreSQL concurrency, existing direct reply regressions and live journey.

## Implementation and validation

- [x] Record retrospective in PR metadata before production edits.
- [x] Restore group resolver and converge recovery through identity ownership.
- [x] Prove selected journeys, typecheck, lint, complexity, privacy and docs.
- [x] Complete parent candidate review and prepare the scoped commit.
- External gates after commit: exact-head full ReviewGPT round 3 concurrently
  with required CI; no merge is authorized by this implementation handoff.

## Failure, load, and deployment

One recovery request touches one contact, chat, and member. Serialize contact
before chat/member and prepare crypto outside the database transaction. Conflicts
roll back all writes; exact retries reuse the same owner. No fanout or provider
message is added. The existing schema-first Web writer floor remains required;
Cloudflare is unchanged. Production access is unnecessary for this correction.

## Deterministic proof and candidate review

395 focused tests passed; the final affected-source rerun passed all 380 tests
in recovery endpoint/PostgreSQL composition, Linq group routing, and direct
dispatch. Four PostgreSQL cases prove foreign-owner rejection, one concurrent
claimant, transaction rollback, and identity/source retention through direct
preparation and route promotion. The normal migration runner applied all 213
migrations to a fresh loopback proof database; that database was removed after
proof. The old worktree database was left unchanged.

Web typecheck, focused ESLint, complexity, diff whitespace, and identifier checks
passed. Recovery complexity remains 19; webhook-file debt decreases 287 to 286.
Existing large planners remain cohesive owners; broader refactoring would not
help this correction. Parent security/ownership and Product UX review are Ready
for the deterministic journeys. Current-base merge-tree proof is clean. The
existing changelog item already describes the accepted direct-only outcome.

The focused live onboarding journey passed with `gpt-5.6-terra` and local
subscription authentication after three profiles failed their startup/cache
probe before provider action. Rotation stopped on the first passing profile.
Manual reply review: Ready; one canonical resume check, one onboarding skill
read, zero progress updates, and the expected concise identity questions.
Command: `pnpm test:assistant:live -- --test "answers a fresh routine-goal
onboarding turn without a progress update"` with an explicit authenticated
alternate profile. No assistant prompt, live fixture, or delivery provider was
changed. One failed profile also emitted the existing temporary-root teardown
friction covered by Frog #2514; the passing run cleaned up normally.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
