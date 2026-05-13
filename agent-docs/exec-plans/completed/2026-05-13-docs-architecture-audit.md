# Documentation architecture audit

Status: completed
Created: 2026-05-13
Updated: 2026-05-13

## Goal

- Audit current repo documentation against the current code and architecture.
- Correct inaccurate or stale docs and simplify confusing wording where the
  code is clear enough to be the source of truth.

## Success criteria

- Five sub-agents audit separate documentation/code areas and report concrete
  findings with evidence.
- Any corrected docs state current behavior, owner boundaries, and known
  constraints plainly.
- No direct personal identifiers, secrets, raw credentials, or local paths are
  added to docs or final notes.
- Verification covers the final Markdown/docs diff with the repo-required docs
  checks and typecheck unless blocked by unrelated dirty work.

## Scope

- In scope:
  - Live repo documentation listed in `agent-docs/index.md`, including
    top-level architecture docs, package/app READMEs, operations docs, product
    specs, and hosted runtime references.
  - Code-backed correctness checks for current package/app ownership, runtime
    protocols, CLI/verification commands, persisted-state rules, and product
    behavior claims.
- Out of scope:
  - Historical completed execution plans.
  - Broad code refactors or behavioral changes.
  - Generated artifacts unless a stale generated-doc claim blocks clarity.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty working-tree edits and active ledger rows.
  - Do not edit package/app runtime code for this docs audit.
  - Treat current code as the canonical reference when docs and code disagree,
    unless the code is mid-change or an active plan makes the intended
    direction explicit.
- Product/process constraints:
  - Keep documentation simple and direct.
  - Ask the user before choosing between two plausible product or architecture
    directions when the code is ambiguous.
  - Use five sub-agents for the audit as requested.

## Risks and mitigations

1. Risk: Active hosted-runtime work overlaps some docs claims.
   Mitigation: Prefer code-backed, stable ownership language; if a claim
   depends on an active uncommitted code path, mark it as a question instead of
   committing speculative docs.
2. Risk: The audit becomes too broad to finish cleanly.
   Mitigation: Prioritize high-criticality live docs and current-code
   contradictions; leave lower-impact clarity ideas in the handoff if needed.
3. Risk: Scoped commit is blocked by unrelated dirty docs/ledger edits.
   Mitigation: Use `scripts/finish-task` if safe; otherwise close the plan and
   report the exact blocker.

## Tasks

1. Spawn five audit sub-agents with non-overlapping code/doc scopes.
2. Inventory live docs, package/app READMEs, and stale architecture terms
   locally while sub-agents run.
3. Integrate high-confidence findings into minimal Markdown edits.
4. Read back touched docs and search for stale replaced claims.
5. Run required verification.
6. Close the plan and make a scoped commit if safe.

## Decisions

- Use read-only audit sub-agents and make final edits locally to avoid
  conflicting writes across the same docs.
- Treat current source code as authoritative over stale docs, but do not
  document in-flight uncommitted behavior unless the active plan and code agree.
- The five audit agents returned findings across hosted runtime, hosted web,
  local runtime/CLI/contracts, product/device docs, and operations/security.
- Integrated high-confidence current-code contradictions into live docs; left
  active execution-plan intent as non-durable unless current code already
  supports it.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff <touched-doc-paths>`
  - direct readback and stale-string searches for touched docs
- Expected outcomes:
  - Commands pass, or any unrelated pre-existing failure is named with evidence.
Completed: 2026-05-13
