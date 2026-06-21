# Hosted Workspace File Count Invariant

Status: completed
Created: 2026-06-21
Updated: 2026-06-21

## Goal

- Add a durable contract doc explaining why hosted workspace-restored features
  must avoid unnecessary file-count growth and how new write/log side effects
  should stay bounded for checkpoint/restore.

## Success criteria

- New contract doc exists under `docs/contracts/`.
- `docs/contracts/00-invariants.md` points future agents to the detailed rule.
- `agent-docs/index.md` lists the new canonical doc.
- Readback/reference verification passes for the touched Markdown files.

## Scope

- In scope: text-only docs under `docs/contracts/**` and the canonical docs
  index.
- Out of scope: code changes, test changes, hosted runner behavior changes,
  and active PR implementation work.

## Constraints

- Technical constraints: keep the contract practical and aligned with the
  existing v2 encrypted `tar.zst` workspace snapshot model.
- Product/process constraints: preserve privacy guardrails and avoid local
  identifiers in docs or commit metadata.

## Risks and mitigations

1. Risk: The rule becomes vague architecture prose.
   Mitigation: Include concrete storage choices, anti-patterns, and a review
   checklist for new write paths.

## Tasks

1. Add the detailed hosted workspace file-count contract.
2. Add a short baseline invariant pointer.
3. Update the canonical docs index.
4. Read back touched files and check references.

## Decisions

- Use a new numbered contract doc rather than expanding `00-invariants.md`,
  keeping the baseline file compact while making the rationale discoverable.

## Verification

- Readback: `docs/contracts/06-hosted-workspace-file-count.md` and
  `docs/contracts/00-invariants.md` contain the new rule.
- Reference check: `rg` found the new contract linked from
  `docs/contracts/00-invariants.md`, `agent-docs/index.md`, this plan, and the
  coordination ledger.
- Scoped docs verification:
  `bash scripts/workspace-verify.sh test:diff docs/contracts/00-invariants.md docs/contracts/06-hosted-workspace-file-count.md agent-docs/index.md agent-docs/exec-plans/active/2026-06-21-hosted-workspace-file-count.md`
  passed.
- Full typecheck: `pnpm typecheck` passed.
Completed: 2026-06-21
