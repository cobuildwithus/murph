# Manual meal estimation PR completion

Status: active
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
