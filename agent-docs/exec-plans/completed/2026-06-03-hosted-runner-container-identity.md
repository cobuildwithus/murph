# Hosted runner container identity helper

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Centralize hosted runner container identity parsing so runtime write-fence
  creation and provider-egress active-container validation derive the same
  `runnerContainerName` and user id from one helper.

## Success criteria

- `readHostedRunnerContainerIdentity({ containerName, source })` exists on the
  Cloudflare runner side and returns `{ runnerContainerName, userId } | null`.
- Runtime write-fence creation stores the helper-derived runner container name.
- Provider egress active-container validation uses the same helper for
  container id parsing.
- Focused Cloudflare tests cover versioned container names and missing identity.

## Scope

- In scope:
- `apps/cloudflare` hosted runner identity helper, runtime start path, egress
  validation path, and focused tests.
- Out of scope:
- Broad runner lifecycle changes, provider credential policy changes, new
  runtime state, or deploy protocol changes.

## Constraints

- Technical constraints:
- Preserve existing write-fence fail-closed behavior and active-container
  validation semantics.
- Do not touch unrelated active hosted lifecycle or dirty-ack work.
- Product/process constraints:
- No user-facing product behavior change.
- Keep logs metadata-only.

## Risks and mitigations

1. Risk: Container naming changes in one path but not the other.
   Mitigation: Use one helper in both write-fence and active-container egress
   paths and cover version suffix parsing in tests.

## Tasks

1. Add shared hosted runner container identity helper. Done.
2. Route runtime write-fence creation through the helper. Done.
3. Route provider-egress active-container validation through the helper. Done.
4. Add focused tests. Done.
5. Run scoped verification, required audits, and commit via `scripts/finish-task`
   if unrelated dirty work does not block a safe scoped commit. Done; scoped
   commit blocked by overlapping dirty work in the same files.

## Decisions

- Keep the helper in `apps/cloudflare/src` because runner container identity is
  Cloudflare deployment topology, not an assistant-runtime contract.

## Verification

- Commands to run:
  - Focused Cloudflare test slice for runner egress and runner container
    identity behavior.
  - `pnpm test:diff` for the touched Cloudflare files when ready.
- Expected outcomes:
  - Focused tests and diff-aware verification pass, or any unrelated blockers
    are identified with concrete failing targets.
- Results:
  - Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/hosted-runner-container-identity.test.ts apps/cloudflare/test/runner-egress-intercept.test.ts`
    (2 files, 116 tests).
  - Passed: `git diff --check -- <task paths>`.
  - Passed: `bash scripts/workspace-verify.sh test:diff <task paths>`;
    `apps/cloudflare verify` completed with 82 test files and 1241 tests.
- Commit status:
  - Not committed. A safe scoped `scripts/finish-task` commit would include
    unrelated active-lane hunks in shared files such as `runner-container.ts`,
    `runner-egress-intercept.ts`, and the coordination ledger.
Completed: 2026-06-03
