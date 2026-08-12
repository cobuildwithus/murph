# Frog Autofix Round 8 Remediation

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Close the round-eight recovery bypass without adding a new authority owner:
  preserve a validated parent-local first-reviewed baseline when remote PR body
  provenance is foreign, and force a durable human handoff whenever the remote
  branch has advanced beyond that baseline.

## Success criteria

- A foreign body edit plus a foreign descendant branch head cannot establish a
  new autonomous review baseline or reach ReviewGPT, merge, or issue closure.
- A foreign body edit at the unchanged trusted head still restores the retained
  parent-local body and reruns exact-head review normally.
- Missing trusted baseline evidence fails closed through the existing fixed-body
  review-findings handoff.
- Existing local-only and push-before-PR recovery remain green.
- The scoped remediation candidate is committed and ready for the required
  exact-head ReviewGPT, CI, merge, and post-merge installation gates below.

## Scope

- In scope: existing-PR body/baseline recovery, descendant-head handoff,
  production-shaped regression coverage, directly affected authority docs, PR
  review metadata, final ReviewGPT/CI/merge gates, and post-merge installation.
- Out of scope: a new scheduler, queue, durable state owner, credential path,
  branch-protection bypass, product-runtime changes, or autonomous remediation
  of future ReviewGPT findings.

## Constraints

- Technical constraints: reuse the retained parent-local PR body, immutable
  first-reviewed head, and existing review-findings handoff; keep ambiguous,
  divergent, dirty, or multiply owned state fail-closed.
- Product/process constraints: preserve the immutable round-one baseline and
  prior finding ledger; run round nine immediately after the corrected head is
  pushed and concurrently with CI; do not merge without an exact-head PASS.

## Risks and mitigations

1. Risk: accepting a collaborator-authored descendant as operator-owned repair
   state.
   Mitigation: derive baseline authority from either the authoritative remote
   body or the already validated parent-local body, never from the current
   remote head after foreign presentation.
2. Risk: breaking legitimate recovery after a harmless foreign body edit at the
   unchanged head.
   Mitigation: retain the existing restore-and-rereview path when trusted first
   head equals current head.
3. Risk: tactical patching expands the already large authority chain.
   Mitigation: add no state or owner; route suspicious descendants through the
   existing exact-head handoff.

## Tasks

1. [x] Add a production-shaped regression that composes foreign body provenance
   with a remote descendant and requires the existing pre-review handoff.
2. [x] Pass the validated parent-local body into first-reviewed-head resolution
   and fail closed when neither remote nor local presentation supplies trusted
   baseline authority.
3. [x] Run focused Frog autofix tests, shell syntax, permission smoke, docs
   drift, and the read-only live admission scan.
4. [x] Inspect and redact the final diff and prepare the plan-closing scoped
   commit for immediate push.

## Decisions

- Accepted the round-eight finding as a reachable authority bypass because the
  current code discards a validated H1 baseline after foreign body provenance
  and replaces it with a collaborator-supplied descendant H2.
- Reuse the existing immutable-baseline and review-findings handoff mechanisms;
  do not introduce branch signing, a second ownership record, or another queue.
- Capture the validated recovery body before any edit-only child, and reject an
  existing PR that disappears before review publication rather than treating it
  as a fresh branch.

## Verification

- `pnpm exec vitest run scripts/frog-autofix.test.ts --config scripts/vitest.config.ts --no-coverage`
- `bash -n scripts/frog-autofix`
- `scripts/frog-autofix verify-permissions`
- `scripts/frog-autofix scan`
- `pnpm docs:drift`
- Exact-head required GitHub Actions plus ReviewGPT round nine.
- Results: focused authorization and recovery coverage passed 38/38; the
  diff-aware repo-tools lane passed 35 files / 563 tests; full workspace
  typecheck, shell syntax, permission smoke, docs drift, diff checks, and the
  live read-only scan passed; the scan reported zero eligible issues.

## Post-plan release gates

- Push the plan-closing remediation head and start ReviewGPT round nine while
  exact-head CI runs.
- Resolve accepted findings until ReviewGPT returns `ROUND_OUTCOME: PASS` with
  zero accepted findings and required CI is green.
- Merge without bypassing required checks, then install from the exact clean
  primary checkout and run the documented two-hour service proof.
Completed: 2026-08-12
