# Epic Clinical Records beta readiness

Status: completed
Created: 2026-07-18
Updated: 2026-07-18

## Goal

- Remove evidence-backed blockers from the one-shot Epic SMART beta, refresh
  the server-owned Epic directory, and prove the configured flow as far as the
  available external credentials and browser environment allow.

## Success criteria

- SMART patient context is canonical before the unique connection/run commit.
- A legitimate OAuth callback that started before intent expiry can finish
  during its still-valid OAuth session.
- Concurrent page replay cannot double-count a completed page.
- Valid search-bundle outcome entries do not invalidate otherwise usable Epic
  resources or enter canonical patient-family mapping.
- A missed initial Temporal signal has a bounded, same-run recovery path; it
  creates no second retrieval generation or business-work record.
- The committed provider directory matches Epic's current official R4 Brands
  bundle and focused tests cover every corrected boundary.
- Required verification, specialist audits, PR CI, and ReviewGPT pass with no
  unresolved accepted finding.

## Constraints

- Preserve the one-shot beta: no refresh, retry generation, reconnect, or
  second raw-evidence family.
- Keep Web as the OAuth, credential, provider-egress, run, and wake owner.
- Add no queue, scheduler, generic mailbox sweeper, or persisted state.
- Keep patient context, tokens, FHIR bodies, and direct identifiers out of
  logs, docs, commits, and external review artifacts.
- Work on `codex/epic-beta-readiness` in the isolated task worktree.

## Tasks

1. Add focused failing tests for patient-context normalization, near-expiry
   OAuth completion, page-claim interleaving, valid outcome entries, and missed
   initial wake recovery.
2. Implement the smallest fixes at the existing Web/import ownership
   boundaries without expanding the one-shot lifecycle.
3. Refresh and review the official Epic R4 provider directory artifact.
4. Run focused coverage, truthful affected-owner verification, direct static or
   runtime scenarios, required specialist audits, and parent final review.
5. Commit through the plan workflow, open a PR, run ReviewGPT with CI, and
   document the remaining external Epic registration/live-E2E gate.

## Decisions

- Treat reconnect/reauthorization as a disclosed beta limitation, not part of
  this patch, because the retained raw-evidence lifecycle deliberately forbids
  a second generation today.
- Recover only the already-committed first wake/run. Do not create a generic
  mailbox-lag scheduler or another durable authority.
- Keep account/client creation and production-readiness attestations outside
  the repo commit and require the mandated action-time confirmation.

## Verification

- Web verification completed through lint, dev smoke, the production build,
  and the full test suite (5,867 passed, 148 skipped). The final terminal-claim
  correction then passed 28 focused frontend tests and Web typecheck.
- Clinical Records (9), importers (371), and Temporal orchestration (78) tests
  passed with owner typechecks. Scenario integrity passed for 204 scenarios,
  11 samples, and 28 golden directories.
- Provider-artifact review found 1,246 valid entries and 92,194 locations from
  Epic's current official R4 Brands bundle. The focused race, pagination,
  outcome-entry, reference-range, recovery-query, and stale-navigation proofs
  passed.
- Required coverage-write and the final frontend review completed with zero
  remaining findings. The Claude UI double-check could not run because both
  configured profiles required renewed authentication; the Codex frontend
  substitute completed instead. Rendered computer-use proof was unavailable.
- `pnpm test:diff` passed dependency, boundary, cycle, log-safety, and all 16
  affected typecheck lanes before the unrelated assistant-engine test harness
  exhausted its V8 heap and later remained idle in isolated retries. Owner
  suites above provide the required scoped proof.
- `git diff --check` and the identifier/privacy scan passed. PR CI and the
  required PR-lane ReviewGPT round remain post-push gates; do not also run local
  `deep-review` for this patch.
Completed: 2026-07-18
