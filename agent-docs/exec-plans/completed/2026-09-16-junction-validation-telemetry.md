# Diagnose and retain Junction validation failures

Status: completed
Created: 2026-09-16
Updated: 2026-09-16

## Goal

- Distinguish SpO2 value/unit validation from ECG empty or mismatched source collections, and retain failed imports for later correction without dropping samples or replacing valid canonical facts.

## Success criteria

- Finite metadata and bounded counts reach hosted failed-attempt logs; readings, waveform values, IDs, URLs, and raw units never enter the new fields.
- Matching Junction resource validation failures remain queued beyond their initial retry allowance with a 30-minute recheck cadence. Corrections recover through the original job and existing write fences.
- Focused tests, affected package typechecks, privacy review, and scoped commit.

## Scope

- In scope: importer classification, ECG collection diagnostics, existing service retry policy, hosted diagnostic forwarding, tests, owner docs.
- Out of scope: guessing measurement scales, skipping invalid samples, loosening ECG identity, production mutation, or resurrecting historical terminal jobs.

## Constraints

- Reuse existing typed errors, SQLite jobs, bounded provider requests, and hosted log buffer. No new database schema, queue, or raw-data store.
- Keep foreground priority, disconnect/reauthorization fences, and complete-day canonical replacement intact.

## Risks and mitigations

1. Live response cause is not known. Add classification rather than infer an exact value or provider fault.
2. Persistent bad inputs can keep jobs pending. Use the existing deduped job and a fixed 30-minute cadence; unrelated jobs continue while it is deferred.
3. Old runners can still exhaust jobs. Additive telemetry is backward compatible; reliable retention requires updated runners. Existing terminal jobs need normal re-enqueue/reconciliation.

## Tasks

1. Add finite SpO2 classification and aggregate ECG matching diagnostics across all pages.
2. Retain matching validation failures at a bounded cadence using existing job state.
3. Prove successful corrections, no canonical data loss, mismatch rejection, retry isolation, restart and diagnostic privacy.
4. Update owner docs/changelog, review, typecheck and commit.

## Decisions

- Best-guess mitigation treats incomplete provider data as a retained import obligation. It does not certify partial collections or silently repair unknown units.
- Product journeys: valid readings unchanged; invalid day preserves prior facts and stays pending; empty/mismatched ECG stays pending; corrected response succeeds; disconnect still prevents provider work.

## Verification

- Focused Vitest importer, Junction client/provider, service, and hosted-maintenance suites.
- Importers, device-syncd, and assistant-runtime typechecks; complexity diff and privacy/diff inspection.

## Results

- Product UX: Ready for the implemented local change. Synthetic journeys prove valid inputs retain the existing success path; invalid complete days preserve prior canonical facts; mismatched ECG sources remain rejected; corrected inputs recover; deferred work allows other jobs to run; disconnect fences remain in force.
- 103 distinct focused tests passed: 27 importer cases, 21 Junction client/provider cases, 14 service cases, 22 hosted-maintenance cases, two hosted cold-continuation cases, and 17 changelog cases. The importer classification subset was rerun after its final simplification.
- Retry proof starts with a one-attempt allowance, continues through six validation failures, persists across SQLite reopen, then succeeds on corrected input. Hosted proof reconstructs the full deferred resource/window from the existing continuation format in a fresh workspace, retains another validation failure, and then completes.
- Failure-log tests exercise both hosted parsing and the shared bounded sanitizer with forged categories and negative, fractional, string, and excessive counts. Pass totals cover fast measurement jobs outside the 16 slowest timing samples.
- Typechecks passed for importers, device-syncd, assistant-runtime, and hosted Web. The final assistant-runtime typecheck includes the added cold-continuation proof.
- `pnpm complexity:diff` passed. Service complexity debt decreased by four; other changed source owners did not increase debt. Existing large orchestration and binding functions retain their current boundaries; no unrelated split is needed.
- `git diff --check` and the added-content privacy scan passed. All fixtures are synthetic. No database rows, waveform readings, provider responses, or direct personal identifiers were copied into artifacts.
- Changelog: `2026-09-16/measurement-import-rechecks`; content-only, existing renderer unchanged. The documented direct Vitest command failed from the Web directory, matching existing Frog entry `20260912202546-changelog-focused-test`. The supported `test:prepared` wrapper generated the manifest and passed both focused suites. No duplicate Frog entry was created.

## Review and operational limits

- Parent review covered the full diff, finite telemetry allowlists, pagination, unchanged complete-day/source validation, retry ownership, disconnect fences, restart behavior, and existing hosted continuation parsing.
- The mitigation preserves the import obligation; it does not establish the live input defect. Persistent invalid responses can remain pending indefinitely at the bounded cadence. Existing terminal jobs are not automatically revived.
- No persistent schema or hosted wire-shape change. New telemetry uses scalar fields accepted by the current reader. Old runners still have ordinary retry exhaustion; mixed deployment converges only when affected runners update. Rollback restores the old exhaustion behavior.
- No additional foreground calls, provider requests per attempt, or database queries. The existing background job makes another bounded attempt after 30 minutes. Completion counters are pre-checkpoint observations, not proof of a specific historical import's durable recovery.
- No production mutation or deployment. Once deployed, inspect finite failure categories/counts, resource completion counters, and matching checkpoint evidence; replay historical terminal jobs through the normal reviewed recovery path.
- Final ReviewGPT and exact-head CI remain PR gates. This task authorizes a local scoped commit; no branch push or PR was requested, so those remote gates were not run.
Completed: 2026-09-16
