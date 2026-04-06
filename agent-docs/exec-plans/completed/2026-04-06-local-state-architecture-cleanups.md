# Local State Architecture Cleanups Patch Landing

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Land the returned ChatGPT patch where it still fits the current repository so local runtime state placement, migration/version seams, gateway projection storage, shared health registry metadata, and workflow docs match the intended long-term architecture without clobbering unrelated in-flight work.

## Success criteria

- The applicable patch intent is ported into the current tree with conflicts resolved against newer repo changes.
- Required verification runs for the touched repo surface, or any unrelated red command is documented with a defensible separation.
- The landing is committed with a scoped dirty-tree-safe commit and this plan is closed.

## Scope

- In scope:
- Returned patch file at `output-packages/chatgpt-watch/69d2e9ae-b3e8-839d-8a90-1c3b13f01951-2026-04-06T004232Z/downloads/murph-local-state-architecture-cleanups.patch`
- Durable docs and code directly touched by that patch, including runtime-state, gateway-local, inbox/device local state, shared health metadata, and workflow docs
- Out of scope:
- Unrelated existing assistant-core capability-registry lane already in progress in this worktree
- New design work beyond what the returned patch materially requires

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits and resolve around newer repo changes instead of reverting them.
- Keep changes scoped to the returned artifact; do not opportunistically expand the refactor.
- Product/process constraints:
- Follow repo completion workflow, required verification, and scoped commit rules.
- Treat the downloaded patch as behavioral intent, not overwrite authority.

## Risks and mitigations

1. Risk: The patch is broad and may conflict with newer local changes or active work in overlapping subsystems.
   Mitigation: Compare against current files first, port only applicable hunks, and avoid files owned by the active assistant-core lane unless the patch truly requires them.
2. Risk: Cross-cutting runtime-path changes can introduce regressions across packages.
   Mitigation: Run the repo-required verification baseline for touched code and inspect any failures for causal relevance before handoff.

## Tasks

1. Inspect the exported thread and downloaded patch, then map the intended touched files against the current worktree.
2. Port the applicable patch changes into the current repository, resolving any conflicts against newer repo state.
3. Run required verification and address change-attributable failures.
4. Close the plan and create the required scoped commit.

## Decisions

- Use a plan-bearing workflow because the patch is cross-cutting and touches runtime contracts, docs, and multiple packages.
- Keep the active assistant-core capability-registry lane out of scope unless the returned patch directly intersects with unaffected files in that subsystem.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Commands pass, or unrelated existing blockers are recorded with exact failing targets and why the landed diff did not cause them.
Completed: 2026-04-06
