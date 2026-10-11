# Select the newest canonical meal for recent recall

Status: active
Created: 2026-10-11
Updated: 2026-10-11

## Goal

Answer private latest-meal recall from the newest saved capture, using existing canonical reads.

## Product UX

- Outcome: retrieve before claiming absence and select by capture time, including photo-only records.
- Reaches: private factual meal recall; preserve ordinary new-capture behavior and group boundaries.
- Proof: deterministic CLI ordering plus real-model resumed-chat single, follow-up, and split-question journeys with public sample images and synthetic records.

## Evidence and scope

A synthetic split-question journey used `meal list --limit 1` as a newest-record lookup. The command intentionally returns chronological ascending records, so it read the older capture. This proves a recall-guidance/tool-ordering mismatch, not the cause of any historical retrieval omission.

Keep canonical ordering unchanged. Teach the owning food-journal guidance to use the existing descending meal-filtered timeline for latest recall, then inspect the selected record/photo as needed. No new retrieval subsystem, data mutation policy, or background prefetch.

## Tasks

1. Prove ascending meal-list versus descending timeline behavior with two captures.
2. Correct the owning recall guidance and its deterministic contract test.
3. Rerun the failing split-question journey and relevant success paths.
4. Complete focused validation, candidate review, changelog, required external review and CI.
5. Coordinate any shared runtime rollout with the parent task; do not deploy independently.

## Risks and mitigations

- A passing stochastic sample is not universal proof: retain deterministic surface/ordering tests and exact selected-record assertions.
- Photo content alone can mask selecting the wrong capture: assert canonical record identity.
- Preserve privacy: fixtures use synthetic metadata and a public repository sample; no incident transcripts or personal facts enter artifacts.

## Verification

- Assistant-engine focused deterministic tests and typecheck.
- Opt-in real Codex subscription journeys on the product model.
- Diff checks and complexity review; exact-head CI and requested ReviewGPT before merge.
