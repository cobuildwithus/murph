# Hosted runner active lease identity split

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Prevent active hosted runner invocations from failing invocation-local internal
  side effects solely because the invocation has advanced its workspace
  checkpoint version.
- Keep workspace optimistic-concurrency enforcement on the hosted workspace
  checkpoint route.

## Success criteria

- Artifact uploads, browser-vault replica writes, provider/email effects, and
  mailbox payload decode authorize by active invocation identity
  (`attemptId`, `leaseGeneration`, `userId`) rather than workspace version.
- Hosted workspace checkpoint still rejects a stale `expectedWorkspaceVersion`.
- Wrong invocation identity still fails closed.
- Focused regression tests cover the version-drift case and stale identity cases.

## Scope

- In scope:
  - Cloudflare runner outbound active-lease helper semantics.
  - Focused Cloudflare tests for invocation-local side effects versus checkpoint
    workspace version enforcement.
- Out of scope:
  - Broad runtime auth redesign.
  - Provider/model configuration changes.
  - Production deploy execution.

## Constraints

- Technical constraints:
  - Preserve the internal proxy token requirement on runner-internal requests.
  - Preserve workspace CAS semantics for checkpoint writes.
  - Do not weaken attempt/generation/user active invocation ownership.
- Product/process constraints:
  - Keep the fix simple and composable; avoid route policy matrices or generic
    capability frameworks.
  - Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Accidentally allowing stale completed invocations to write side effects.
   Mitigation: Keep the Durable Object active-lease identity check required for
   invocation-local routes and test stale attempt/generation rejection.
2. Risk: Weakening workspace concurrency protection.
   Mitigation: Leave checkpoint route version enforcement intact and test stale
   checkpoint version rejection.

## Tasks

1. Done: Split active invocation identity validation from checkpoint version validation.
2. Done: Keep the existing route call sites simple by changing the shared helper semantics.
3. Done: Add focused Cloudflare regression coverage for stale workspace-version drift.
4. Done: Run focused verification and required audits.
5. Next: Close the plan and create a scoped commit.

## Decisions

- `workspaceVersion` is workspace CAS state, not a generic authorization
  credential for invocation-local internal routes.

## Verification

- Commands to run:
  - Focused Cloudflare test(s) covering runner outbound active-lease behavior.
  - `pnpm --dir apps/cloudflare verify` or repo-required equivalent.
- Expected outcomes:
  - Version drift does not reject invocation-local side effects.
  - Stale checkpoint version and stale invocation identity still fail closed.
- Evidence:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts` passed with 73 tests.
  - `pnpm --dir apps/cloudflare typecheck` passed.
  - `pnpm test:diff apps/cloudflare/src/runner-outbound/active-lease.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/references/hosted-runtime-protocol.md` reached `apps/cloudflare verify` and failed on unrelated hosted OpenAI/local-stub tests, not on this lease split.
  - Required security/privacy review reported no findings.
  - Required coverage-write pass added email send coverage and reported focused test/typecheck passing.
  - Final completion review reported no findings.
Completed: 2026-05-06
