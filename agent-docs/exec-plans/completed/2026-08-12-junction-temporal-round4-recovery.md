# Junction temporal round-four recovery

Status: completed
Created: 2026-08-12

## Outcome

Recover every eligible blood-oxygen and stress local day inside a bounded
configured reconcile horizon, with the newest day processed immediately and
older days converging through the existing durable device-job queue/history,
without retaining full timeseries or adding another lifecycle owner.

## Requirement decision

The mandatory round-four retrospective is recorded on PR #1703. Continue with
an owner-boundary redesign: a scheduled reconcile handles exactly the newest
authoritative day independently of ordinary `windowStart`, then schedules stable
per-resource/day work for the older eligible days. Succeeded job history proves
populated or empty completion; failure and yield remain retryable queue state.
Canonical authoritative facets remain the only health-data truth.

The effective configured horizon is clamped to 1–14 authoritative vault-local
days. At two temporal resources this composes to at most two immediate resource
fetches and 26 older jobs. Each child owns one resource/day and retains the
existing client limits, importer caps, and one canonical import transaction.

## Work

- [x] Add stable internal temporal-day jobs and succeeded-history dedupe.
- [x] Process the newest authoritative day independently of ordinary window start.
- [x] Schedule every older eligible day newest-first within the bounded horizon.
- [x] Prove restart, backlog, partial traffic, empty, failure/yield retry, and query convergence.
- [x] Correct documentation and measure the runner bundle against its existing budget.
- [x] Run focused verification and prepare the scoped commit without launching ReviewGPT.

## Verification

- Junction provider/store/service and hosted runtime focused tests.
- Real importer/core/query replay and successful-empty replacement proof.
- Affected package typechecks, runner bundle assembly/guard, diff/privacy scans,
  exact summary ancestry, and current-base merge-tree proof.
Updated: 2026-08-12
Completed: 2026-08-12
