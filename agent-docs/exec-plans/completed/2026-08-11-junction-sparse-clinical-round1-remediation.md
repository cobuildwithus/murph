# Remediate Junction sparse-clinical ReviewGPT round 1

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Prove the shared Junction daily fetch boundary durably imports successful
  resources before rethrowing a retryable per-resource failure.
- Make the default-resource provider-call expansion and unchanged concurrency
  and database fanout explicit in executable proof and PR disclosure.

## Success criteria

- A production-shaped job/importer/core roundtrip retains an established
  resource before a clinical endpoint failure rejects the job.
- Retrying after endpoint recovery adds the clinical fact without duplicating
  or revising the already-retained established fact.
- Tests pin the 17-to-24 default resource change, 336 one-page collections for
  14 days, the admitted 100,800-attempt maximum, sequential concurrency one,
  and diagnostic resource-read counts with and without source filtering.
- The PR body discloses connect-time history, scheduled reconcile/backfill, and
  diagnostic effects while preserving the original first-reviewed marker.

## Scope

- In scope: cross-package real-vault proof in the existing hosted-execution
  composition owner, Junction provider fanout tests, and PR metadata.
- Out of scope: the shared fetch implementation owned by the foundation branch,
  new state, queues, lifecycle owners, database work, or ReviewGPT execution.

## Constraints

- Rebase on the foundation fetch-isolation head before adding behavior proof.
- Keep provider requests sequential and database collection/transaction fanout
  unchanged.
- Preserve compact sparse-clinical persistence and the hard no-timeseries rule.

## Risks and mitigations

1. Risk: tests prove only mocked imports rather than canonical durability.
   Mitigation: run the real Junction job executor through the real importer and
   core vault, then inspect canonical event revisions.
2. Risk: retry marks a failed resource complete or revises a healthy fact.
   Mitigation: assert the failed fact is absent after rejection and the healthy
   external reference has one revision before and after retry.
3. Risk: operational claims drift as default resources change.
   Mitigation: derive exact counts from the exported default resource list and
   assert the current 24-resource and 14-day boundary explicitly.

## Tasks

1. [x] Inspect the ReviewGPT findings and coordinate shared fetch ownership.
2. [x] Merge the exact foundation fetch-isolation head.
3. [x] Add real-vault retry/idempotence and exact fanout regressions.
4. [x] Run focused tests, relevant typechecks, and diff/privacy/Frog checks.
5. [x] Prepare the scoped commit and PR #1701 disclosure update.

## Decisions

- The foundation/history owner changes `fetchTimeseriesSnapshots` and its daily
  import boundary; this branch will not overlap that implementation.
- The real-vault proof belongs in hosted-execution because that existing package
  already legally composes core, device-syncd, and importers.
- Count/concurrency/diagnostic tests remain at the device-syncd provider owner.
- Merged foundation head `22573bcc16c31a1026d8d71eb3b4de7127bec4f2`
  exactly; the only merge conflict kept its schedule-time sparse-history anchor
  alongside this branch's canonical-per-record clinical policy helper.

## Verification

- Hosted-execution Junction partial-failure vault roundtrip: 1 passed. The
  canonical vault retained blood oxygen before the retryable rejection, omitted
  inhaler usage, then added inhaler usage on recovery without revising either
  retained blood-oxygen event.
- Full Junction provider file: 228 passed, including exact 336 one-page
  collections, sequential concurrency one, 100-page and three-attempt limits,
  and default diagnostic counts.
- Full Junction importer file: 150 passed; Junction contracts: 6 passed.
- Contracts, importers, device-syncd, and hosted-execution typechecks passed.
- `git diff --check` and the changed-file direct-identifier scan passed.
- Frog review found no new task-caused repository friction.
Completed: 2026-08-11
