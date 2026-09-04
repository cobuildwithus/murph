# Simplify developer agent guidance

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Make developer instructions easy to load and follow, with one owner per rule.

## Success criteria

- Root instructions route to relevant docs instead of requiring the whole library.
- Completion and review requirements have unambiguous owners.
- Preserve privacy, authority, production invariants, and executable gates.
- Open a PR with measured text reduction and focused documentation proof.

## Scope

- In scope: developer entrypoints, workflow, completion, index, and related skills.
- Out of scope: product assistant prompts, model defaults, historical plans,
  production architecture changes, CI policy changes, deployment, and merge.

## Constraints

- Keep current commands and machine-readable PR evidence compatible with guards.
- Read and integrate personally; preserve other sessions and their worktrees.

## Risks and mitigations

1. Deleting an important boundary while removing repetition.
   Mitigation: retain explicit privacy/authority rules and link their detailed owners.
2. Documentation may be consumed by tests or review packaging.
   Mitigation: inspect those consumers and run focused existing checks.

## Tasks

1. Inventory developer instructions and read current workflow owners.
2. Verify official GPT-6 Astra prompting guidance.
3. Consolidate repeated rules and remove conflicting legacy instructions.
4. Review links, command contracts, and the complete diff; run focused checks.
5. Close the plan, commit, open a PR, and report checks and remaining limitations.

## Decisions

- Official Astra guidance recommends auditing skills and AGENTS instructions,
  clarifying authority, and keeping verification proportional. Apply those
  principles without adding a second model-specific workflow.
- There is one tracked root AGENTS.md and one CLAUDE.md entrypoint.
- The tracked Graft block requires tooling and a graph absent from this checkout.
  Make navigation optional with repository-scoped discovery as the fallback.
- Preserve the ReviewGPT finding-disposition policy and machine-enforced PR
  fields; simplify their routing rather than silently changing those contracts.

## Verification

- Documentation readback, reference checks, privacy scan, and git diff --check.
- Existing workflow documentation and PR-evidence tests where applicable.
- docs:drift and docs:gardening; exact-head required CI after candidate review.

## Audit findings

- Root/router required the entire architecture and product library before even
  internal text work. Replaced this with relevant-owner reads.
- The index restated operational contracts. Retained all 134 directory entries
  while removing duplicate explanations; owner docs remain authoritative.
- CLAUDE prescribed review relaunches inconsistent with one capture owner.
  It now delegates workflow to AGENTS.
- Product UX referenced a removed preliminary specialist and required repeated
  Feature approval. Parent review and existing task authority now govern.
- The optional prompt-review checklist forced GPT-5.6 guidance regardless of its
  target. It now uses the actual target model and reports missing source access.
- Prose-only tests pinned exact workflow sentences/whitespace. Removed those
  assertions; executable workflow tests and validated PR examples remain.
- Internal changelog classification needlessly continued into visual authoring.
  It now stops the skill after recording the internal-only decision.
- Graft was mandatory despite unavailable tooling/index. It is now optional
  navigation with direct repository search as the fallback.

## Retained policies and limits

- The review runbook still has timing thresholds, a finding-disposition pause,
  bounded rounds, and exact packet identity rules. Their policy and implementation
  are not changed by this consolidation.
- Mechanically validated PR evidence fields remain required. Removing fields
  would need a coordinated guard/template change, not a prose-only promise.
- This is a developer-guidance cleanup. Domain architecture, security/reliability
  contracts, production assistant skills, and historical evidence are not rewritten.
- Word counts measure authored documentation, not complete model request tokens.

## Local proof

- Existing workflow/Frog suites: 25 tests passed.
- Existing changelog/deployment validators: 21 tests passed.
- Tooling TypeScript check passed.
- Documentation drift and gardening passed; index inventory unchanged.
- Privacy scan and diff whitespace checks passed.
- Required exact-head CI remains pending until the final candidate is published.
