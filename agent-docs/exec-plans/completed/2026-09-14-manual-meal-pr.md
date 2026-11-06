# Manual meal estimation PR completion

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Open the manual meal estimation fix as a reviewable PR and complete its required review and green CI checks.

## Scope

- Publish the existing task branch, link changelog provenance, measure complete first provider input, and prepare required PR evidence.
- Resolve verified review or CI failures within the meal-estimation fix. Preserve completed historical plans.
- Merge and deployment are outside this request.

## Success criteria

- PR is Ready, mergeable, and required checks pass on its final authored head.
- Required final ReviewGPT is valid and resolved, with no accepted unresolved findings.
- Public evidence remains synthetic and free of production identifiers.

## Tasks

1. Capture identical individual and group provider inputs at base and head, then finish provenance and PR evidence.
2. Run focused proof for any new edits, push the stable candidate, and start ReviewGPT alongside CI.
3. Resolve findings and CI failures, verify final head and mergeability, and report the PR.

## Decisions

- Reuse the completed five real-assistant journeys, 220 focused tests, relevant typechecks, runtime build and parent review from the implementation task; rerun only proof affected by new edits or a material gap.
- Use a loopback scripted provider for complete-input measurement. It cannot make a paid request or deliver a member message. Report unavailable exact model tokenization honestly.

## Verification

- Complete first-request byte counts and exact-ref method; target-tokenizer availability.
- Focused measurement test, assistant typecheck, generated changelog/archive proof, complexity/docs/privacy checks.
- Final ReviewGPT, required exact-head CI and fresh merge-tree proof.

## Progress

- Opened PR #3454 on the existing isolated branch and linked the changelog provenance.
- Complete first-provider-input captures passed at base and runtime candidate: individual 157315 to 157479 bytes; group 144914 to 145078 bytes. The measurement covers real Codex-generated instructions, tools, schemas and deferred metadata, excluding only the transport cache key. Target token counts remain unavailable; the PR records that limitation.
- Captures use one identical synthetic fixture per scope through a loopback provider. The two changed initial-input source modules were loaded from the exact base and candidate refs; all other provider-input code remained identical. The new opt-in regression preserves this repeatable capture boundary.
- Final review and exact-head CI are pending.

## Final review and handoff

- ReviewGPT round 1: PASS at `4aaf1500076f021e7760914f2ff126fd8c60be9f`; no Critical, High or Complexity Collapse findings. Requested and observed model were both `gpt-6-pro` on the retained managed lane. Exact response hash and preceding accepted-turn identity match the capture. The full guarded source snapshot and PR metadata were accepted; the reviewer explicitly verified all 27 changed-file snapshots and the first-review baseline.
- Capture elapsed: 493 seconds from the owned send step to response persistence, above the 180-second minimum. Artifact-quality judgment: accepted; the review addresses upload authority, import/replay, mailbox admission/recovery, private execution, delivery idempotency and selected-date recovery, and accurately limits its evidence to source review.
- Parent final review: no unresolved findings. The only post-review mutation is this explanatory completion record; production source, runtime config, schemas and implemented behavior remain identical to the reviewed head. No additional substantive review round is required under the durable-doc exemption.
- All builds and 32 checks had passed when this record closed; four package-coverage jobs were still running. This documentation closeout must receive its own exact-head CI. Final CI and fresh-base mergeability will be reported in the PR evidence before handing the task back as green; this record does not claim those pending results have passed.
- Changelog archive proof, assistant typecheck, complete-input captures, complexity, documentation drift and privacy checks passed for the candidate. No new developer-friction entry was necessary; the existing changelog-command entry covered the encountered workaround.
- Merge and production deployment remain outside this request.
Completed: 2026-09-14
