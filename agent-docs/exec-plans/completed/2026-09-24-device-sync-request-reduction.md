# Reduce repeated device sync imports and internal requests

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Outcome and invariant

Reduce duplicate Junction daily-window fetches, canonical no-op imports, and
hosted source-snapshot requests during queued webhook bursts. Preserve every
accepted update, source/connection fencing, foreground yield, retries, and
canonical repair semantics.

## Owner and evidence

The Junction provider already converts dense resource notifications into closed
UTC-day REST scans. Distinct sub-day webhook windows can describe the same
closed days. DeviceSyncService supports bounded provider batches but Junction
does not expose one, so each queued notification repeats that scan. Canonical
imports correctly return no-op when both data and evidence are unchanged; the
provider read and live source callback have already occurred by that point.
Use synthetic burst tests to prove the repeated work and reduction. Private
production evidence is excluded from this artifact.

## Design

Reuse the existing provider batch seam and granular durable job rows. Batch
only pull-based daily dense-resource notifications with the same source,
resource, and complete closed-day range. Scan that range once.
Exclude inline carriers, historical proof, temporal authority, calendar repair,
and payload extensions. No cache, schema, dependency, or new durable owner.
The existing account lease and atomic batch completion own retry/ack; updates
arriving after the batch is claimed remain independent jobs. A yielded scan
must retain the full remaining range through the existing continuation path.

## Tasks

1. Prove duplicate daily-window work with a composed store/service/provider test.
2. Add provider-owned batching without altering shared queue selection.
3. Prove correction-after-claim, source revocation, failure/retry, bounded drain,
   and continuation behavior; run focused tests, typecheck, and complexity.
4. Update the provider owner documentation, review the complete diff, and
   complete parent review and a scoped commit. External review and CI remain
   required on a subsequently authorized PR before shipping.

## Deployment and failure

Wire formats and queue records remain unchanged. Old runtimes may process rows
separately; new runtimes may batch pending compatible rows. Either path keeps
ordinary dedupe, provider correction, and canonical write authority. No data
migration or rollout order dependency. Runtime deployment and live savings are
not established by local tests.

## Verification

- 11 new composed regression tests pass, including signed webhook parsing,
  bounded queue execution, later arrivals, different ranges, source revocation,
  partial failure/retry, and durable yield/resume.
- 271 existing tests pass across service, webhooks, provider resources, source
  admission, and timeseries inventory reuse.
- Package typecheck and `git diff --check` pass.
- `pnpm complexity:diff` passes: existing debt 315 and maximum 96 unchanged.
  All 20 existing hotspots are outside the added batch descriptor/executor;
  broad provider refactoring would add unrelated risk.
- Synthetic eight-notification/two-day control: provider reads 16 to 2,
  source-authority reads 17 to 3, importer calls 16 to 2, no-op calls 14 to 0.
  The real queue/provider execute against a stub importer; existing canonical
  importer semantics are unchanged. These are not measured live savings.
- Parent review confirms no new state owner, schema, secret, or data cache.
  No member-facing semantic change: no public changelog entry.
- Scope ends at a local commit. PR creation, exact-head CI, final ReviewGPT,
  runtime deployment, and post-deploy traffic measurement have not run.

## Limits and follow-up

Batching combines already-queued compatible notifications, up to 16 and the
caller's row budget. It does not combine different day ranges, skip later
corrections, or remove all no-ops. Claim-order barriers may reduce batching.
Owner-route and reconciliation traffic require independent causal proof before
changing their freshness or scheduling contracts. After an authorized runtime
rollout, compare imports/no-ops, snapshot requests, completed queue rows, lag,
and failure rate for equivalent traffic and confirm canonical corrections.
Completed: 2026-09-24
