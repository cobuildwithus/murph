# Add docs-only verification fast path

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Add a durable workflow rule that lets pure text-only Markdown docs edits and deletions skip repo-wide `typecheck` / `test` / `test:coverage`, while preserving the existing stricter verification path for docs/process work that touches scripts, config, tests, generated artifacts, or workflow mechanics.

## Success criteria

- `agent-docs/operations/verification-and-runtime.md` clearly defines the docs-only fast path and its boundaries.
- `agent-docs/operations/agent-workflow-routing.md` points docs/process work at the new fast path without weakening non-doc workflows.
- `agent-docs/index.md` reflects the updated verification-doc scope.
- The final commit stays scoped to the workflow docs and the closed plan artifact.

## Scope

- In scope:
- Pure Markdown docs/process edits and deletions, including agent workflow docs.
- Durable documentation for when repo-wide verification is still required.
- Out of scope:
- Any change to code, scripts, tests, generated docs, or mechanical repo guards.
- Broad verification-framework redesign or unrelated workflow cleanup.

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits.
- Do not broaden the exemption beyond text-only `.md` changes.
- Product/process constraints:
- Keep the rule easy for agents to apply mechanically.
- Leave higher-risk docs/process surfaces on the existing stricter verification path.

## Risks and mitigations

1. Risk: A docs-only exemption could accidentally swallow higher-risk process changes.
   Mitigation: Define the fast path narrowly as text-only `.md` edits/deletions and explicitly exclude scripts, config, tests, generated docs, and workflow-enforcement files.
2. Risk: Routing and verification docs could drift apart.
   Mitigation: Update both docs in the same turn and reflect the change in the docs index summary.

## Tasks

1. Document the docs-only fast path and its exact boundaries in the verification guide.
2. Update the workflow router so docs/process tasks point to the new fast path when eligible.
3. Refresh the index summary so the durable-doc table of contents matches the new rule.
4. Run required verification, record any unrelated branch failures, and commit the scoped docs change.

## Decisions

- Restrict the fast path to text-only `.md` edits/deletions instead of a broader “no code touched” rule.
- Keep docs/process changes that touch scripts, config, tests, generated docs, or workflow mechanics on the existing repo-wide verification path.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- The docs changes should be internally consistent even if the current branch remains red for unrelated reasons.
Completed: 2026-03-31
