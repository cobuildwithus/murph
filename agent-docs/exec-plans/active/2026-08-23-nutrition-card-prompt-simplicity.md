# Simplify nutrition card prompt safety

Status: active
Created: 2026-08-23
Updated: 2026-08-23

## Goal

- Make requested daily nutrition cards reliable by replacing the duplicated
  fail-closed medical-data checklist with one concise prompt-owned safety rule.

## Success criteria

- Routine card requests do not require unrelated memory, condition, regimen,
  procedure, encounter, body-measurement, or test-history scans.
- Known context that makes self-directed numeric nutrition unsuitable still
  suppresses numeric targets and cards without exposing private reasoning.
- The canonical Goal, meal-total, response-card schema, and delivery boundaries
  remain unchanged.
- Focused tests, typecheck, Product UX walkthrough, required ReviewGPT gates,
  and exact-head CI pass.

## Scope

- In scope: nutrition-card prompts, their durable owner docs, and focused prompt
  regressions.
- Out of scope: card schemas/rendering, Goal storage semantics, meal totals,
  delivery, and unrelated nutrition guidance.

## Constraints

- Technical constraints: keep one prompt rule as the source of truth; delete
  obsolete child instructions and ratchets instead of adding runtime state or
  another safety service.
- Product/process constraints: preserve the product-critical card path and
  known-context numeric-guidance boundary; use a task worktree and PR.

## Risks and mitigations

1. Risk: simplification accidentally allows numeric guidance despite a known
   contraindication.
   Mitigation: keep a direct known-context suppression rule and test it.
2. Risk: tests continue to reward the deleted procedural fanout.
   Mitigation: delete obsolete assertions and add one negative regression for
   universal preflight reads.

## Tasks

1. Map every live owner and test that duplicates the checklist.
2. Collapse safety handling to one concise prompt rule and delete obsolete
   reference machinery.
3. Add focused regression proof and update durable owner docs.
4. Run focused tests, typecheck, Product UX walkthrough, and parent diff review.
5. Commit, open a draft PR, and resolve the preliminary and final review gates
   plus required CI.

## Decisions

- Classify this as a Product UX Patch and a sensitive prompt-primary
  health-safety change.
- Keep deterministic validators only at the independent card/schema boundary;
  use Codex prompt guidance for contextual nutrition suitability.

## Verification

- Commands to run: focused assistant-engine skill/tool tests, assistant-engine
  typecheck, documentation drift checks, required ReviewGPT passes, PR CI, and
  current-base merge-tree proof.
- Expected outcomes: no prompt requires the deleted universal history scan;
  known-context suppression, Goal authority, totals, and card validation remain
  covered and all required checks pass.
