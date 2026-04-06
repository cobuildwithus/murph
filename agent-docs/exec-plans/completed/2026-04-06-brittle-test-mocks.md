# Reduce brittle mock-heavy tests and improve behavioral confidence across major seams

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Reduce brittle mock-heavy tests across the major seams of the repo so the highest-value suites exercise real boundary behavior instead of asserting on mocked internals.
- Land seam-local helper or fixture changes only when they directly improve confidence and remove unsafe coupling to implementation details.

## Success criteria

- The highest-risk mock-heavy suites in the selected seams no longer rely on unsafe full-module mocks when realistic local fixtures or integration-style seams are available.
- Each touched seam gains stronger behavior-level assertions that would fail on a meaningful regression in the underlying code path.
- Touched seam tests pass locally.
- Repo-required verification is run, with any unrelated pre-existing failures clearly separated from this diff.
- Required final audit review is completed and any high-severity findings are resolved before handoff.

## Scope

- In scope:
- `packages/assistant-runtime/test/**` mock-heavy hosted/share/runtime tests that can use real package behavior with temp vault/workspace fixtures.
- `apps/cloudflare/test/**` mock-heavy runner/container tests that can swap brittle module mocks for seam-local fakes or higher-fidelity injected behavior.
- `apps/web/test/**` mock-heavy hosted service/outbox tests that can be tightened without colliding with the active hosted-member privacy work.
- Seam-local test helpers/fixtures needed to support those confidence improvements.
- Out of scope:
- Production behavior changes unrelated to testability.
- Broad rewrites of already-active assistant-state or hosted-member privacy files.
- Converting every mock in the repo; prioritize the most brittle or misleading seams first.

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits.
- Import sibling packages only through public package entrypoints.
- Use seam-local fixtures and real boundary behavior where practical instead of introducing new generic test abstraction layers.
- Product/process constraints:
- Follow repo completion workflow, including coordination ledger, required audit subagent, scoped commit, and baseline verification unless clearly blocked by unrelated red lanes.
- Keep worker ownership disjoint and avoid already-active files where possible.

## Risks and mitigations

1. Risk: Worker changes overlap with active hosted-member privacy or assistant-state edits.
   Mitigation: Assign workers to narrow, disjoint seams and keep them out of already-owned files unless explicitly necessary.
2. Risk: Replacing mocks with real behavior makes tests flaky or expensive.
   Mitigation: Prefer local temp-dir fixtures, in-memory stores, and public package entrypoints over networked or timing-sensitive integration paths.
3. Risk: Some thin orchestration seams still need mocking at one boundary.
   Mitigation: Remove only brittle mocks that hide real behavior; keep narrow dependency injection or spy seams when they are the correct boundary under test.

## Tasks

1. Register the task in the coordination ledger and map the highest-risk mock-heavy seams.
2. Launch parallel seam workers with disjoint file ownership for assistant-runtime, Cloudflare, and hosted-web tests.
3. Review worker diffs, integrate any follow-up tightening, and add missing local fixes where brittle mocks remain.
4. Run touched-seam verification, then repo baseline verification, and record unrelated pre-existing failures if they persist.
5. Run the required final audit review, address findings, and create a scoped commit.

## Decisions

- Prioritize brittle full-module mocks that hide underlying behavior over lightweight spy-based seams that still exercise real code.
- Avoid the active assistant-state CLI surface for this pass unless a worker finds a clearly isolated, high-confidence improvement that does not collide with current ownership.

## Verification

- Commands to run:
- Focused Vitest commands for touched seam tests.
- `pnpm typecheck`
- `pnpm test:coverage`
- Expected outcomes:
- Touched seam tests pass.
- Repo baseline commands pass, or any failures are shown to be unrelated pre-existing branch failures.
Completed: 2026-04-06
