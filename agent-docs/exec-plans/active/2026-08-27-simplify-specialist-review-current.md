# Simplify specialist ReviewGPT proof review

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Replace the stale conflicting PR with a current-main change that keeps the
  preliminary specialist ReviewGPT pass focused on distinct Product UX,
  prompt, frontend, and proof-adequacy review without a write-capable coverage
  artifact protocol.

## Success criteria

- The unified specialist preset is review-only and cannot attach a patch.
- Coverage review activates only for proof-centered outcomes or material
  boundaries that ordinary focused tests cannot establish, and reports only
  high- or medium-severity proof gaps.
- Final ReviewGPT remains the ordinary correctness and test-adequacy owner when
  that gate applies.
- Current workflow docs, package context, and contract tests agree on the same
  artifact-free specialist contract.
- Focused local proof, required ReviewGPT review, and required PR checks pass on
  the exact replacement head before merge.

## Scope

- In scope: specialist workflow docs, specialist prompts, audit context,
  contract tests, and the minimum routing text needed to keep them aligned.
- Out of scope: restoring deleted Frog automation, changing final ReviewGPT's
  substantive review scope, product runtime behavior, or deployment behavior.

## Constraints

- Technical constraints: preserve current-main owners and deleted surfaces;
  remove obsolete artifact plumbing rather than replacing it with another
  protocol.
- Product/process constraints: no member-facing behavior changes; keep the PR
  draft until focused proof and review are complete; close the stale PR only
  after this replacement merges.

## Risks and mitigations

1. Risk: old-branch patches reintroduce code or assumptions removed from main.
   Mitigation: port intent file by file against current owners and omit deleted
   automation.
2. Risk: removing the patch artifact weakens proof coverage.
   Mitigation: preserve review findings for material proof gaps and keep final
   ReviewGPT responsible for ordinary correctness and test adequacy.
3. Risk: prompt simplification drifts from current model guidance.
   Mitigation: validate the new prompt against current official OpenAI guidance
   and the repository's prompt-review lens.

## Tasks

1. Audit current main against the stale PR and identify still-relevant intent.
2. Implement the smallest artifact-free specialist workflow on current main.
3. Run focused prompt, workflow, and CLI contract proof.
4. Commit and push an exact candidate, then open a draft replacement PR.
5. Run the routed specialist review and required CI, resolve accepted findings,
   perform the parent final review, merge, and retire the superseded PR/worktree.

## Decisions

- Rebuild from current main rather than reconciling the stale branch again.
- Leave the stale PR open and unchanged until the replacement is merged.
- Do not restore Frog automation files deleted since the stale PR was authored.

## Verification

- Commands to run: focused CLI contract tests for review packaging and release
  audit context; repository prompt/workflow consistency searches; scoped
  formatting or type checks if changed executable code requires them.
- Expected outcomes: no remaining specialist coverage patch or legacy
  coverage-write references in current owners; focused tests green; required
  ReviewGPT result and GitHub checks green on the merge candidate.
