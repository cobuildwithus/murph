# Bounded recovery for terminal Linq send failures

Status: completed
Created: 2026-10-08
Updated: 2026-10-08

## Goal

Recover recent runtime replies only after definitive provider no-send failures,
including failures with no selected transport, without duplicating uncertain sends.

## Success criteria

- Preserve automatic versus explicit iMessage policy.
- At most five total sends in three minutes, with durable exponential delay and jitter.
- Exact-message receipts, parent locking, deterministic attempt keys, revoked access,
  superseding replies and expiry fence every new dispatch.
- Focused synthetic Postgres concurrency and workflow tests pass; Web typecheck passes.

## Scope

- Existing Web delivery owner, additive message state, pointer-only Workflow wakes,
  webhook and acceptance arrival orders, documentation and tests.
- No production mutation, historical resend, PR publication, deployment or merge.

## Constraints

- Unknown acceptance consumes the claim permanently. No new key after timeout.
- Only code 4001 with exact reason `Message send failed` allows replacement.
- Retain encrypted provider identities, never payload text, in durable retry context.
- Preserve legacy consumed claims during rolling deployment. Apply additive migration first.

## Risks and mitigations

- Receipt/acceptance races: existing receipt and parent locks plus exact attempt CAS.
- Workflow duplicate start: row owns due time, count and permanent dispatch fence.
- Stale recovery: original acceptance anchors expiry; newer accepted replies stop retry.
- Authority changes: current route, member access and egress checked at dispatch.
- Model behavior is unchanged; use synthetic transport tests without live model calls.

## Tasks

1. Completed: durable bounded recovery in the existing delivery owner.
2. Completed: synthetic proof of classification, transport, arrival order, concurrent claims, ambiguity and limits.
3. Completed: owner contracts, release note, self-review and local verification evidence.

## Decisions

- Five attempts means original plus four replacements, waits 10/20/40/80 seconds
  with 80–100% jitter. Every replacement must itself fail definitively before another.
- Missing service does not prove iMessage. Preserve omitted preferred service instead.
- Vercel Workflow is an existing Web-owned timer; Postgres remains sole send authority.
- Exact-head CI and required ReviewGPT need PR publication, which is not authorized.
  Complete local verification and report that remaining gate without publishing.

## Verification

- Fresh isolated localhost database: complete migration history, including the new
  columns and both indexes, applied successfully. No production database access.
- Focused Vitest: 359 tests passed across nine files: terminal retry unit/Postgres,
  retry workflow, runtime delivery callback, observability store, provider event
  parser, webhook, changelog page and Next Workflow config.
- `pnpm --dir apps/web typecheck:prepared`: passed after generated inputs.
- `pnpm complexity:diff`: passed; no new debt above the threshold. Existing
  callback/store hotspots are unchanged; retry owner maximum remains at threshold.
- Installed Workflow builder compiled the new step and orchestration into step,
  intermediate and final workflow bundles; manifests register both functions.
- `git diff --check`: passed. Self-review checked permanent claims, receipt-before-
  acceptance, old-writer fencing, immutable expiry, exact lineage and private data.
- Added callback admission failure/replay proof and a crash after provider acceptance
  before ledger recording. Both retain the accepted/ambiguous identity fence.
- Account reassignment cannot transfer an existing recovery to a different member.
- Changelog: updated, `2026-10-08 / recover-unsent-replies`; source PR list remains
  empty until publication is authorized. Content-only entry uses existing rendering.
- No live model evaluation: prompt/tool/model behavior is unchanged; transport and
  state-transition behavior is covered with synthetic provider boundaries.

## Remaining release gates and limits

- This local implementation is complete. Publishing a PR, exact-head CI, ReviewGPT,
  production migration and deployment are outside current authorization.
- Apply the additive migration before deploying Web. No runtime deploy is needed.
- Definitive terminal failures can recover; ambiguous sends deliberately remain
  unresolved. An accepted replacement remains delivery-unconfirmed until its receipt.
- Already-accepted newer replies suppress stale recovery. Provider-level FIFO against
  an independently in-flight send is not guaranteed by this Web recovery owner.
- Underlying provider transport failures and exact historical account/message joins
  require separately authorized hosted evidence; no historical repair was attempted.
Completed: 2026-10-08
