# Keep minor review concerns non-blocking

Status: completed
Created: 2026-08-26
Updated: 2026-08-27

## Goal

- Keep final ReviewGPT merge findings limited to material, merge-blocking defects while preserving useful subthreshold observations as explicit non-blocking notes.

## Success criteria

- Every finding category must independently meet a material merge-impact threshold.
- Evidence-backed concerns below that threshold may appear only under `Review notes` and must not change a passing round into `FINDINGS`.
- The notes contract must prevent speculative nit lists and state that notes do not require remediation or carry into later rounds as prior findings.
- Focused repository tests must lock the prompt boundary and output contract.

## Scope

- In scope: the final PR ReviewGPT prompt, its focused prompt-contract test, and this execution plan.
- Out of scope: specialist prompts, review workflow pause semantics, severity taxonomy redesign, or changes to existing production behavior.

## Constraints

- Technical constraints: keep the prompt lean, state the rule once at the finding boundary, and avoid example-specific exclusions.
- Product/process constraints: preserve serious bug detection, simplicity findings, and the existing final outcome markers.

## Risks and mitigations

1. Risk: an overly broad note rule could hide a real merge blocker.
   Mitigation: require each note to be safely deferrable with no material correctness, safety, privacy, data, core-flow, or irreversible-effect impact.
2. Risk: a notes section could become a new source of noisy review nits.
   Mitigation: make notes optional, concise, evidence-backed, and limited to observations worth preserving.

## Tasks

1. Add one general materiality and merge-readiness boundary across all finding categories.
2. Define the optional non-blocking notes contract and output placement.
3. Add focused prompt-contract assertions.
4. Run focused verification, inspect the diff, and complete the prompt review lane.

## Decisions

- Preserve the existing finding categories; change their admission threshold instead of adding another severity taxonomy.
- Notes never change `PASS`, require remediation, or become prior findings in later rounds.

## Verification

- Commands to run: the focused CLI release-script coverage audit test, formatting/diff checks, and the prompt-primary specialist review.
- Expected outcomes: the prompt and test contract pass, and the reviewer can return `PASS` alongside useful non-blocking notes.
Completed: 2026-08-27
