# Frontend harness guidance

Status: completed
Created: 2026-03-23
Updated: 2026-03-23

## Goal

- Add durable frontend/operator-UI guidance for `packages/web` plus a reusable frontend quality review prompt and matching verification rules.

## Success criteria

- Healthy Bob has a durable `agent-docs/FRONTEND.md` describing the current operator-facing posture of `packages/web`.
- Root and package-level AGENTS docs route web work through the new frontend guidance.
- Product and verification docs explicitly describe the web surface as operator UI and require browser inspection for UI-affecting changes.
- A reusable frontend quality review prompt exists for future UI work.
- Required repo checks are rerun and outcomes are recorded truthfully.

## Scope

- In scope:
- `AGENTS.md`
- `agent-docs/{index,PRODUCT_SENSE,FRONTEND}.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/prompts/frontend-quality-review.md`
- `packages/web/AGENTS.md`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- product code changes under `packages/web/app/**`
- assistant, CLI, query, or device-sync runtime behavior
- new browser automation tooling

## Constraints

- Keep the change docs/process-only.
- Preserve unrelated dirty worktree state and active assistant/device lanes.
- Keep the guidance aligned with the current local-only, read-only web surface.

## Risks and mitigations

1. Risk: the new guidance could overfit to marketing-site rules that do not match Healthy Bob.
   Mitigation: state explicitly that `packages/web` is operator-facing UI by default and bias toward utility copy and scanability.
2. Risk: verification language could imply browser automation that the repo does not yet have.
   Mitigation: describe browser inspection as a required manual/agent step and keep scripted checks unchanged.

## Tasks

1. Add the new frontend/operator-UI guidance doc.
2. Update AGENTS routing and package-web overlay docs to reference it.
3. Update product-sense and verification docs to encode the current operator-surface posture and browser-inspection requirement.
4. Add the reusable frontend quality review prompt.
5. Rerun required repo checks.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- checks pass, or any unrelated blocker is recorded explicitly with rationale
Completed: 2026-03-23
