# Delete Cron Route Reverification

Status: active
Updated: 2026-07-14

## Why

PR #582 made scheduled delivery pass through two incompatible authority
representations. Cron first materializes the canonical saved automation route,
then notification planning tries to infer that route's audience again from
session and binding state. A valid persisted route can therefore become
`unverified`, retry five times, and expire even though the delivery owner still
has an authorized destination.

Manual route repair changes stored data to satisfy the duplicate classifier. It
does not remove the failure mode. The durable correction is deletion: one saved
route hint, one Web-owned audience decision, and the existing final egress
guard.

## Outcome

- Existing valid personal and group automations execute without manual repair.
- Unknown or mismatched audiences fail before model or provider work.
- Before model work, Web resolves the saved route hint to one concrete target
  and direct/group fact; session state cannot retarget or reclassify it.
- Personal current-home delivery continues to use the existing canonical egress
  owner, including its authorized target override.
- Group capability and personal-effect guards remain fail closed.
- The final diff removes more authority machinery and representation-specific
  tests than it adds.

## Implementation Shape

1. Add production-faithful regression coverage that runs persisted automation
   routes through cron, notification planning, and delivery classification.
2. Remove the cron-only `audienceVerification` result protocol and post-result
   reclassification. A genuinely unknown audience fails once at the existing
   pre-provider boundary.
3. Resolve scheduled Linq routes once through the existing Web egress owner
   before model work, then pass its concrete target and direct/group fact
   unchanged through notification delivery.
4. Stop writing or interpreting personal-home snapshot markers as execution
   authority. Retain read tolerance only where existing canonical records make
   it necessary; compatibility data must be inert.
5. Delete manual repair and transition exceptions once no execution path
   depends on them.
6. Delete representation-level tests and unreachable prompt branches made dead
   by the single pre-provider boundary. Keep small invariant tests for direct,
   group, unknown, mismatched, exact-text, and current-home delivery.

## Invariants

- No model-backed or exact-text content reaches an unknown destination.
- A saved group route never gains personal capabilities or personal-home
  fallback.
- Session state cannot lend directness to another target.
- Hosted automation mutation remains bound to the accepted causal input/current
  conversation; unauthenticated group email cannot mutate automation state.
- Web/API owners continue enforcing connected-account, wearable authorization,
  and Family billing boundaries for synthetic group containers.
- No new state owner, migration service, repair worker, queue, dependency, or
  fallback route is introduced.

## Verification

- Focused red/green regression proof for the real cron-to-notification path.
- `pnpm test:diff` for every touched owner.
- Required security/privacy review and write-capable coverage audit.
- Parent full-diff and call-path review.
- Scoped commit through `scripts/finish-task`.
- PR CI plus the pushed-head ReviewGPT loop to zero accepted findings.

## Deployment

Deploy and verify Web's additive concrete-target/directness response first;
this is a hard gate. Then deploy Cloudflare with
`container_rollout=immediate`. Runner admission rejects and restarts any warm
runner whose bundle fingerprint is stale, so require managed-container smoke
to report the expected new fingerprint before declaring convergence. A new
runner against old Web fails closed and retries before model or provider work,
but a misordered or slow rollout can exhaust the bounded retry window and let
an occurrence expire. Do not roll Web back while the new runner is active. If
rollback is unavoidable, roll back Cloudflare first, prove the old runner
fingerprint, then roll back Web; this restores the prior cron risk, so prefer a
forward fix. After convergence, prove one personal scheduled reminder, one
group scheduled turn, and zero new
`ASSISTANT_LINQ_ENGAGEMENT_ASSERT_UNAVAILABLE` or
`ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE` failures.
