# Make hosted parser toolchain env image-owned

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Make hosted parser executable/model paths image-owned runner toolchain config, not values that can be overridden by stale forwarded runtime env.

## Success criteria

- The `parsers` hosted runtime profile remains a semantic capability but no longer forwards concrete parser binary/model path env names.
- Hosted child process env projection reapplies image-owned parser toolchain env from ambient process env after sanitized forwarded env.
- Regression coverage proves stale forwarded parser paths cannot override ambient image-owned values.
- Focused typecheck/test coverage and required completion audits pass, or unrelated blockers are documented.

## Scope

- In scope:
- `packages/assistant-runtime` hosted env/profile categories and environment helpers.
- `apps/cloudflare` hosted runner child env construction and directly coupled tests.
- Durable docs only if source-of-truth architecture language changes.
- Out of scope:
- Docker base image path changes.
- Per-user runner secret allowlist changes beyond preserving the existing block on executable selectors.
- Broader hosted runtime or device-sync behavior.

## Constraints

- Technical constraints:
- Preserve Cloudflare as a thin runner over `packages/assistant-runtime`.
- Keep supervisor/proxy secrets out of the child env.
- Do not let member/user-provided forwarded env define filesystem executable/model paths.
- Product/process constraints:
- Preserve unrelated dirty-tree work and active plan ownership.
- Do not commit personal identifiers or local machine paths.

## Risks and mitigations

1. Risk: removing parser path keys from the forwarded profile could drop legitimate hosted path configuration.
   Mitigation: re-inject only ambient/image-owned toolchain keys inside the runner child launcher after forwarded env sanitization.
2. Risk: child env ordering regressions could silently reintroduce stale forwarded path wins.
   Mitigation: add a focused regression test with stale forwarded values and ambient image-owned values.

## Tasks

1. Inspect current hosted env profile, environment preservation, and child-launcher tests.
2. Remove concrete parser tool path keys from the forwarded `parsers` profile.
3. Add or reuse a typed hosted runner parser toolchain resolver and project its env after forwarded env.
4. Add regression tests for stale forwarded parser paths losing to ambient runner image paths.
5. Run focused verification, required audits, and scoped commit flow.

## Decisions

- Parser executable/model path env belongs to the hosted runner image/toolchain boundary. The runtime profile may request parser capability but must not carry those concrete paths.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/launch-spec.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts`
- Focused Vitest command for the changed runner/env tests if needed during iteration.
- Expected outcomes:
- Commands pass, or any red result is tied to a known unrelated dirty-tree blocker and documented.

## Outcome

- Implemented: `parsers` is an explicit semantic hosted runtime env profile with no forwarded native parser path keys.
- Implemented: focused env coverage proves stale parser path env is ignored when the `parsers` profile is enabled.
- Verified:
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-environment.test.ts --config vitest.config.ts --no-coverage` passed.
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/launch-spec.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts` passed.
  - `pnpm test:smoke` passed.
  - `git diff --check -- packages/assistant-runtime/src/hosted-runtime/launch-spec.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts agent-docs/exec-plans/active/2026-05-01-hosted-parser-toolchain-env.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Blocked/unrelated:
  - `pnpm typecheck` failed on unrelated `apps/web/test/join-invite-state.test.ts` type state where `phoneAuthReady` is missing from a test object.
- Audits:
  - `security-privacy-review`: no findings.
  - `coverage-write`: no additional proof needed; no files changed.
  - `task-finish-review`: no findings.
Completed: 2026-05-01
