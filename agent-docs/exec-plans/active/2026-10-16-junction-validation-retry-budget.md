# Junction validation retry budget

## Goal and ownership

Preserve a finite transport retry allowance after an accepted Junction resource job is retained for validation. The original task owns investigation, patch acceptance, tests, Git, PR and final review. Claude Opus 5.5 is the authorized implementation fallback after ReviewGPT browser access failed; it authors all substantive source/test/doc changes.

## Evidence and scope

A synthetic validation failure exhausts the original budget and extends it by one. A subsequent retryable provider failure consumes that sole remaining attempt and terminalizes the job. Existing diagnostic-only PR4139 changes a different service section and does not cover this cause. No production evidence or identifiers belong in this plan.

Use the existing service retry policy, SQLite job transition and hosted remaining-attempt handoff. Preserve source binding, nonretryable errors, account/disconnect/generation/lease fences, foreground priority and canonical import ownership. No dead-job revival, recovery action, new scheduler, state ledger or new telemetry.

## Product UX

Outcome: pending source validation work gets a finite opportunity to survive a temporary provider failure.
Reaches: existing Junction ECG and blood-oxygen validation resource jobs; ordinary jobs keep their budget.
Proof: warm/cold handoff, retryable transport failure then valid data, persistent transport exhaustion and nonretryable/disconnect controls.

## Steps

1. Prove the retry transition with synthetic current-source evidence.
2. Inspect the implementation-author patch; apply it exactly and return revisions to the author.
3. Run focused regression/owner tests, affected typecheck, complexity/docs checks and parent candidate review.
4. Scoped commit, draft PR, final ReviewGPT concurrently with exact-head CI. Do not merge or deploy this bug-fix PR.

## Status

Current-source proof and seven failing baseline regressions confirm terminalization. Claude Opus 5.5 authored the accepted source, regression tests, reliability contract and changelog. The full device-sync service/store suite passes (250 tests), device-sync typecheck passes, and focused source-guidance (27), heartbeat stale-state (7), and changelog (10) tests pass. Complexity has no debt increase or changed hotspot above 20; docs drift passes. All three focused hosted retention tests pass, including the actual retry-hint builder/parser/cold-restoration path for both resources; the prepared workspace runtime build passes. Parent inspection confirms the existing transition owns the fix and ordinary/terminal failures stay bounded. ReviewGPT access was restored with a minimal read-only connectivity check; final exact-head review and CI remain pending. No production operation is authorized by this plan.
