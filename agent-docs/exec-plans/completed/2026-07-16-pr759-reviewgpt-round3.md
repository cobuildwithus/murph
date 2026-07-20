# PR 759 ReviewGPT round 3 remediation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Resolve the two accepted ReviewGPT round-2 findings by making the canonical saved outcome the sole completed-Results authority and making one run-context horizon bound every partial-run evidence consumer.

## Success criteria

- A canonical outcome referenced by the experiment remains available after supported title and lifecycle-status changes; mutable live measurements cannot alter or contradict its saved summaries.
- An early-stopped run excludes point-measurement anchors observed after `endedOn` from its signals, trends, and intervention attribution, along with all other live evidence consumers.
- The correction removes the saved-summary/live-point authority split and duplicate mutable metadata validation without adding durable state, lifecycle machinery, repair paths, or compatibility owners.
- Production-path regressions cover hosted projection, browser replica build/query, and web rendering for both findings.
- Required focused/full verification, completion audits, CI, and ReviewGPT round 3 are green on the final pushed head.

## Scope

- In scope: hosted browser-vault outcome association, browser query outcome association and projection, the shared partial-run evidence horizon, Results web mapping, focused runtime/query/web tests, and matching PR contract/docs where required.
- Out of scope: changing canonical outcome persistence, adding historical outcome selection, changing experiment lifecycle storage, adding post-stop repair/backfill, or creating a separate live-context surface.

## Constraints

- Preserve the exact direct-path and schema validation on `outcomeRef`; stable experiment identity remains required.
- Treat outcome title, status, protocol, windows, and summaries as the saved analysis snapshot once the exact reference is validated.
- Keep post-stop measurements available to other authorized vault surfaces while excluding them from stopped-run attribution.
- Use ReviewGPT as the sole cross-cutting gate; do not run local `deep-review`.

## Retrospective decision

- The required anomaly retrospective is recorded on PR 759 after round 2.
- First-reviewed source churn was 283 lines; round-2 source churn was 889 lines, including 606 lines of review-remediation churn.
- The repeated mechanisms were distributed canonical-result validity and distributed terminal evidence boundaries.
- Decision: redesign and shrink through deletion. Keep one outcome association owner, delete the completed live-point overlay, and derive one `evidenceThrough` boundary for every partial-run evidence consumer.

## Tasks

1. Prove both findings through the current hosted/query/web production paths and capture the exact failing gaps in regression tests.
2. Narrow canonical outcome association to the exact validated reference plus stable experiment identity, and delete live-point merging from saved outcome biomarkers.
3. Introduce one run-context evidence horizon and route rolling and anchored metric selection plus existing event/adherence/context consumers through it.
4. Add end-to-end regression coverage for active outcome generation followed by stop/title edit, and for a stopped run with a later point-measurement anchor.
5. Run required audits, verification, parent final review, scoped commit/push, PR-body shape update, ReviewGPT round 3, CI, and mergeability proof.

## Verification

- Focused query, assistant-runtime, and web regression tests for the two accepted findings.
- Truthful `pnpm test:diff` for every touched owner, plus selected package coverage and direct hosted-to-web scenario proof.
- Required `coverage-write` and `frontend-review` passes, followed by the Claude Code UI double-check when the rendered surface changes materially.
- Full selected repository verification, PR CI, and ReviewGPT correction round 3.

## Completed locally

- Replaced mutable metadata equality with exact outcome-reference and stable experiment-identity association at both hosted projection and browser query boundaries.
- Deleted the completed saved-summary/live-point overlay; completed signals and displayed analysis dates now come from the saved outcome alone.
- Introduced one `evidenceThrough` run-context date and routed rolling metrics, point anchors, events, adherence, schedules, context, signals, and trends through it.
- Added writer-to-hosted-to-query lifecycle regressions, stopped-anchor web/query regressions, saved-date-range proof, and direct post-stop adherence assertions.
- Required coverage and frontend audits completed with no unresolved findings. The Fable UI double-check found one saved/live date-range mix; the accepted narrow fix passed repeated coverage/frontend audits and a second Fable review with no findings.
- Focused query, assistant-runtime, and web suites plus affected typechecks passed. The truthful full diff lane passed all changed owners, lint, smoke, Cloudflare verification, and production build; its final repetition hit one unrelated serving-grams `mktemp` collision, and that exact test passed immediately in isolation.
Completed: 2026-07-16
