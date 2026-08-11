# Make database fanout a standard completion and ReviewGPT review concern

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make database-load amplification a standard agent design check, PR evidence
  requirement, and ReviewGPT audit concern, then run a separate evidence-backed
  ReviewGPT audit of `apps/web` for existing inefficient database call shapes.

## Success criteria

- Root agent guidance stays compact and routes to the existing database-load
  invariant instead of duplicating it.
- Completion and ReviewGPT prompts require proportional maximum-cardinality
  reasoning and executable proof for database-touching changes.
- The policy diff passes doc/readback, reference, privacy, and focused repo-tool
  checks, then exact-head PR CI and the required preliminary prompt review.
- A separate ReviewGPT website audit returns concrete, locally triaged findings
  or an evidence-backed no-finding result without changing production code.
- A second pull request is open with the required intent, architecture, proof,
  changelog, and change-shape sections.

## Scope

- In scope: `AGENTS.md`, the completion workflow, ReviewGPT review prompts, and
  the minimum documentation needed to keep those owners consistent.
- Out of scope: runtime database fixes, schema or pool changes, production data
  inspection, and implementation of findings from the separate website audit.

## Constraints

- Technical constraints: reuse `docs/contracts/00-invariants.md` § Database Load
  And Collection Fanout; add no dependency, state owner, service, or duplicate
  audit mechanism.
- Product/process constraints: ReviewGPT supplies the implementation patch;
  treat it as untrusted intent, inspect every hunk, keep root guidance short,
  and preserve exact-head PR/review workflow ownership.

## Risks and mitigations

1. Risk: broad prose creates ritual or review noise for database-neutral work.
   Mitigation: gate detailed evidence on database-touching collection paths and
   ask for maximum-cardinality proof only where the invariant applies.
2. Risk: guidance encourages removal of necessary live authority checks.
   Mitigation: explicitly preserve lifetime, target, transaction, crypto, and
   irreversible-effect revalidation from the existing invariant.
3. Risk: the exploratory audit produces speculative micro-optimizations.
   Mitigation: require reachable call paths, amplification formulas, admitted
   cardinality, traffic relevance, and the smallest owner-boundary correction.

## Tasks

1. Inspect the current policy, prompts, and merged incident invariant.
2. Ask ReviewGPT to implement and return a scoped patch.
3. Inspect, apply, simplify if needed, and run focused verification.
4. Commit, push, open the PR, and run the preliminary ReviewGPT prompt lens.
5. Run a separate ReviewGPT audit of `apps/web` database fanout and triage its
   findings against the real code.
6. Resolve review findings, require exact-head CI, close this plan, and report.

## Decisions

- Keep the general invariant in its existing canonical contract. The new PR
  should add only routing, completion evidence, and reviewer enforcement.
- Keep the website audit read-only and outside the policy PR's implementation
  scope so any fixes can be prioritized and landed independently.

## Verification

- Commands to run: touched-file readback; `git diff --check`; privacy/reference
  searches; `pnpm docs:drift`; the preliminary `completion-specialists`
  ReviewGPT pass on the pushed head; required exact-head GitHub checks.
- Expected outcomes: concise internally consistent guidance, no identifier
  leakage, prompt-lens pass or fully resolved findings, and green required CI.
