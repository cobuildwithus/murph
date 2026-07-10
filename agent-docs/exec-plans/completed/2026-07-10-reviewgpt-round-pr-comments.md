# ReviewGPT round PR comment guidance

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Clarify that agents do not need to commit each ReviewGPT round as a Markdown
  document and may instead post concise PR comments explaining what they fixed
  and why.

## Success criteria

- The canonical PR ReviewGPT workflow explicitly keeps per-round Markdown
  artifacts uncommitted.
- The workflow permits optional per-round PR comments that state what changed
  and why.
- Docs readback, drift checks, and typecheck pass; any unrelated test-lane
  failure is reproduced with the narrow owner test and documented.

## Scope

- In scope: `agent-docs/operations/pr-reviewgpt-loop.md` guidance and its
  `agent-docs/index.md` summary.
- Out of scope: ReviewGPT tooling, prompts, generated artifacts, and historical
  completed plans.

## Constraints

- Technical constraints: keep this a text-only Markdown change.
- Product/process constraints: PR comments remain optional; preserve the
  existing per-round handoff summary and uncommitted response-file rules.

## Risks and mitigations

1. Risk: The note could make PR comments or tracked round documents sound
   mandatory.
   Mitigation: State both choices directly and keep PR comments optional.

## Tasks

1. Done: Add the note to the canonical PR ReviewGPT loop.
2. Done: Update the durable-doc index summary.
3. Done: Read back the changed guidance and inspect the diff.
4. Done: Run the required verification.
5. Finish the scoped commit through `scripts/finish-task`.

## Decisions

- Keep the guidance in the ReviewGPT loop's artifact boundary section rather
  than duplicating it across routing docs.

## Verification

- Passed: `pnpm typecheck`.
- Passed: focused assistant CLI startup-import test, 3 tests.
- Passed: `pnpm docs:drift`, `git diff --check`, direct readback, and local-path
  leakage scan.
- Root `pnpm test` was run twice and both runs hit the existing 30-second
  timeout in the assistant CLI startup-import test under the concurrent root
  runner; the exact test file passes in isolation, and this diff is Markdown
  only.
Completed: 2026-07-10
