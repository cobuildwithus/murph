# 2026-04-01 Thread Wake Unification

## Goal

- Eliminate the repo-local split between the checked-in thread helper scripts and the packaged `@cobuild/review-gpt thread {export,download,wake}` implementation.
- Keep the existing `pnpm chatgpt:thread:*` entrypoints stable while wiring them directly to the packaged CLI instead of repo-local Node helpers.
- Carry the attachment-download fix as a pinned `@cobuild/review-gpt` package patch so the only remaining implementation lives in the package.
- Add repo proof so future drift is caught quickly.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-01-thread-wake-unification.md`
- `package.json`
- `pnpm-lock.yaml`
- `patches/@cobuild__review-gpt@0.5.19.patch`
- `scripts/chatgpt-thread-{export,download,wake}.mjs`
- `packages/cli/test/release-script-coverage-audit.test.ts`

## Constraints

- Preserve unrelated dirty-tree edits.
- Avoid `README.md` in this lane because it currently overlaps an active exclusive rename task.
- If `package.json` already carries unrelated edits, merge carefully and keep the change limited to thread-script wiring plus the pinned package patch metadata.
- Keep the repo-owned CLI contract unchanged for maintainers.

## Plan

1. Verify the remaining failure inside the packaged `@cobuild/review-gpt` attachment-download path and confirm the local helper still succeeds on the same thread.
2. Carry the package-level fix as a pinned `pnpm` patch against `@cobuild/review-gpt@0.5.19`.
3. Rewire `chatgpt:thread:{export,download,watch,wake}` directly to `cobuild-review-gpt thread ...` and remove the obsolete repo-local helper scripts.
4. Add release-script audit coverage for the direct package wiring and pinned patch.
5. Run focused proof for package `thread download` / `thread wake` plus the repo-required verification commands.

## Verification

- Passed: `pnpm exec cobuild-review-gpt thread download --chat-url https://chatgpt.com/c/69ccb9e4-94dc-832e-bffa-7d55363e7dae --attachment-text murph-security-audit.patch --output-dir output-packages/chatgpt-watch/pkg-download-proof-3`
- Passed: `pnpm exec cobuild-review-gpt thread wake --delay 0s --skip-resume true --chat-url https://chatgpt.com/c/69ccb9e4-94dc-832e-bffa-7d55363e7dae --output-dir output-packages/chatgpt-watch/pkg-wake-proof`
- Passed: `pnpm chatgpt:thread:export --chat-url https://chatgpt.com/c/69ccb9e4-94dc-832e-bffa-7d55363e7dae --output output-packages/chatgpt-watch/root-export-proof/thread.json`
- Passed: `pnpm chatgpt:thread:download --chat-url https://chatgpt.com/c/69ccb9e4-94dc-832e-bffa-7d55363e7dae --attachment-text murph-security-audit.patch --output-dir output-packages/chatgpt-watch/root-download-proof-4`
- Passed: `pnpm chatgpt:thread:wake --delay 0s --skip-resume true --chat-url https://chatgpt.com/c/69ccb9e4-94dc-832e-bffa-7d55363e7dae --output-dir output-packages/chatgpt-watch/root-wake-proof-3`
- Passed: `pnpm --dir packages/cli exec vitest run test/release-script-coverage-audit.test.ts --no-coverage`
- Failed, unrelated to this lane: `pnpm typecheck` because `scripts/workspace-verify.sh` currently exits with `syntax error near unexpected token ')'` after the package typechecks finish.
- Failed, unrelated to this lane: `pnpm test` because another hosted-web build was already running, causing `apps/web` verify to abort with `Another next build process is already running`.
- Failed, unrelated to this lane: `pnpm test:coverage` because `packages/contracts/scripts/verify.ts` currently imports missing `@murphai/contracts` exports (`isStrictIsoDate`, `isStrictIsoDateTime`, `normalizeStrictIsoTimestamp`).
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
