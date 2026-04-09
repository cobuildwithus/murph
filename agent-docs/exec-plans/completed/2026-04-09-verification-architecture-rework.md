# Refactor verification architecture for fast local loops and explicit acceptance gates

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Refactor the repo verification architecture so the default local loop is fast and deterministic, while heavy package-shape, prepared-runtime, app-verify, coverage, and acceptance-only checks move behind explicit acceptance commands and matching docs.

## Success criteria

- `pnpm test` is a deterministic fast local loop with no hidden git/worktree-sensitive behavior.
- Heavy CI/release proof runs through an explicit acceptance command contract documented in repo docs.
- CLI package-shape and prepared-runtime verification no longer block ordinary local behavior tests.
- App-local verify defaults favor simpler local debugging over hidden overlap.
- The smoke lane naming/documentation matches what it actually does, with only a tiny executable smoke addition if it is nearly free.

## Scope

- In scope:
- Root verification command contract and harness wiring.
- CLI local-vs-acceptance test split.
- App verify default behavior and worker-default parallelism posture.
- Shared Vitest timeout policy.
- Verification and testing docs that describe the command contract.
- Out of scope:
- Broad product/runtime behavior changes unrelated to verification architecture.
- Adding a large new e2e or browser-test matrix.
- Reworking unrelated in-flight coverage/typecheck speedup lanes beyond the minimal integration needed here.

## Constraints

- Technical constraints:
- Preserve unrelated in-flight worktree edits and overlapping ledger rows.
- Keep command naming simple and long-term maintainable.
- Use explicit commands instead of hidden heuristics for local-vs-acceptance behavior.
- Product/process constraints:
- The user prefers long-term architecture over peak local speed, but does not want extra complexity.
- Package shape and prepared-runtime checks should block CI/release acceptance, not the everyday local loop.

## Risks and mitigations

1. Risk: overlapping active lanes already touch `scripts/workspace-verify.sh`, app verify scripts, and verification docs.
   Mitigation: keep ownership split, read current file state before merging, and preserve adjacent edits.
2. Risk: changing command semantics without matching docs will create drift.
   Mitigation: update `agent-docs/operations/verification-and-runtime.md` and `agent-docs/references/testing-ci-map.md` in the same change.
3. Risk: acceptance and local-loop commands could become more confusing if naming sprawls.
   Mitigation: converge on one explicit acceptance entrypoint and keep the default local command minimal.

## Tasks

1. Redefine the root verification command contract around fast deterministic local loops and explicit acceptance.
2. Decouple CLI local tests from package-shape and prepared-runtime acceptance gates.
3. Simplify app verify defaults and shared Vitest timeout policy.
4. Rename or split the current smoke lane so docs match reality.
5. Re-run required verification, collect direct proof, complete required final audit, and commit the scoped change.

## Decisions

- Introduce an explicit acceptance command as the long-term repo contract rather than overloading `pnpm test`.
- Prefer rename-first for the smoke lane; only add tiny executable proof if it reuses existing fixtures cheaply.

## Verification

- Commands to run:
- `pnpm typecheck`
- Focused command checks for the new local and acceptance contracts
- Any package/app scoped checks needed by the touched surfaces
- Expected outcomes:
- Updated command/docs contract is internally consistent.
- Required checks pass, or unrelated pre-existing failures are documented precisely.
Completed: 2026-04-09
