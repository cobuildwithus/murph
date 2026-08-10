# Make ReviewGPT reruns proportional

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make the ReviewGPT completion workflow proportional: a base update with only
  bounded, behavior-preserving conflict resolution does not rerun the final
  audit, and a frontend-only PR does not enter the full cross-cutting gate
  unless an independent risk trigger applies.

## Success criteria

- The final-gate eligibility rules clearly exempt frontend-only changes while
  preserving the preliminary product/frontend/coverage lenses, rendered proof,
  Claude UI check, parent review, focused verification, and CI.
- The base-update exception admits bounded manual conflict resolution only when
  it introduces no new authored behavior or contract change, and names the
  inspection and verification required to prove that classification.
- AGENTS, routing, completion, ReviewGPT-loop, and index guidance agree.
- Focused doc/readback checks and the repository documentation guards pass.

## Scope

- In scope: durable ReviewGPT eligibility and rerun policy in `AGENTS.md` and
  `agent-docs/**`.
- Out of scope: changing ReviewGPT packaging, browser automation, CI jobs,
  frontend implementation requirements, or the preliminary specialist pass.

## Constraints

- Technical constraints: keep the rule objective enough that "minor" cannot
  hide newly authored production behavior; no new workflow mechanism is needed.
- Product/process constraints: preserve exact-head CI and affected-surface proof,
  and preserve the full final gate for mixed, backend, cross-owner, sensitive,
  or otherwise cross-cutting PRs.

## Risks and mitigations

1. Risk: a conflict resolution is mislabeled mechanical and introduces an
   unreviewed behavior change.
   Mitigation: require parent inspection against the reviewed PR and current
   base, affected-surface verification, and rerun the final gate whenever the
   resolution authors new behavior or changes the implemented contract.
2. Risk: "frontend-only" is interpreted as any PR touching `apps/web`, including
   server routes, auth, billing, or data flow.
   Mitigation: define the exemption by meaningful presentation/client
   interaction scope and list the independent conditions that still activate
   cross-cutting review.

## Tasks

1. Completed: align final ReviewGPT eligibility around a frontend-only exemption.
2. Completed: expand the base-update-only exception to bounded, behavior-preserving manual
   conflict resolution.
3. Completed: align compact routing/index summaries with the owning workflow docs.
4. Completed: run focused documentation verification and inspect the final diff;
   close the plan through the scoped commit helper.

## Decisions

- Keep the preliminary specialist ReviewGPT pass for frontend-only PRs; the user
  asked to remove the full audit, not rendered/product/coverage review.
- Treat conflict count as orientation only. The exemption depends on semantic
  preservation, not an arbitrary number of conflict markers or files.

## Verification

- Commands to run: targeted `rg` readback, `pnpm docs:drift`,
  `pnpm docs:gardening -- --fail-on-issues`, and `git diff --check`.
- Expected outcomes: all live workflow documents express the same exemptions,
  durable-doc guards pass, and the diff contains no identifier leakage or
  unrelated changes.
- Results: targeted readback confirms the deprecated unconditional manual-
  conflict rerun and presentation-polish-only exemption no longer appear in the
  live workflow docs; `pnpm docs:drift` passed; `pnpm docs:gardening` completed
  with zero issues; `git diff --check` passed; privacy scans found no local
  username or home-directory path in the tracked diff or plan.
- Parent final review: the frontend shorthand was tightened so only frontend-
  only PRs that satisfy the explicit eligibility exemption skip the full gate;
  independent high-risk or cross-cutting triggers still require it.
Completed: 2026-08-10
