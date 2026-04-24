# Roll out review-gpt thinking-failed detection

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Roll Murph forward to the published `@cobuild/review-gpt` patch that detects ChatGPT `Thinking failed` assistant controls as terminal failed thread states.

## Success criteria

- Murph root dependency and lockfile resolve to the new public npm patch release.
- pnpm release-age policy remains version-scoped and documented if a fresh-release exception is needed.
- A Murph-side direct proof shows the installed CLI reports the known failed HBOT thread as failed instead of waiting forever.
- Required dependency-update checks run or are clearly reported with unrelated blockers.

## Scope

- In scope:
- Root `@cobuild/review-gpt` devDependency update.
- Lockfile update from the public npm registry.
- A version-scoped `minimumReleaseAgeExclude` entry only if pnpm blocks the just-published patch.
- Focused CLI proof against the known ChatGPT `Thinking failed` thread.
- Out of scope:
- Any Health Commons content landing or research rerun.
- Browser profile refactors or prompt/preset behavior changes.
- Cloudflare/app runtime code changes.

## Constraints

- Technical constraints:
- Preserve unrelated dirty work in the shared checkout.
- Do not use local file/git dependency specs; consume the public registry package.
- Product/process constraints:
- Keep the dependency hotfix narrow and record any supply-chain exception.

## Risks and mitigations

1. Risk:
   Fresh npm release is blocked by repo minimum-release-age policy.
   Mitigation:
   Add only a version-scoped exception for the exact published `@cobuild/review-gpt` patch if needed.

## Tasks

1. Publish `@cobuild/review-gpt` patch with the thinking-failed fix.
2. Bump Murph root dependency and lockfile to the published patch.
3. Verify the installed Murph CLI detects the failed HBOT thread.
4. Run required dependency-update checks, inspect diffs for identifiers, then close and commit the scoped change if safe.

## Decisions

- Use the public npm release rather than a repo-local helper because Murph consumes `@cobuild/review-gpt` as an external CLI dependency.

## Verification

- Commands to run:
- `pnpm deps:ignored-builds`
- `pnpm exec cobuild-review-gpt thread wake ...` against the known failed HBOT thread using the explicit managed-browser endpoint.
- `pnpm typecheck`
- Dependency-update test lane selected from the repo verification docs.
- Expected outcomes:
- No new install-script approval needed.
- The failed HBOT thread exits with `state: failed` and `ChatGPT generation failed: Thinking failed`.
- Typecheck/test signals are green, or failures are credibly unrelated to the dependency bump.

## Results

- `@cobuild/review-gpt@0.5.81` published to npm and the Murph root dependency now resolves that registry package.
- Added a version-scoped `minimumReleaseAgeExclude` for exactly `@cobuild/review-gpt@0.5.81` after pnpm blocked the just-published release under the repo's release-age policy.
- `pnpm install --lockfile-only --frozen-lockfile` passed after narrowing the lockfile to the intended package-only update.
- `pnpm exec cobuild-review-gpt --help` reported `cobuild-review-gpt@0.5.81`.
- Direct failed-thread proof passed: the known HBOT `Thinking failed` conversation exits as failed with `ChatGPT generation failed: Thinking failed`, `completionStatus=checked-once`, `handoffKind=none`, and `assistantFailureTexts=["Thinking failed"]`.
- `pnpm deps:ignored-builds` exited 0 but reported `Cannot identify as no node_modules found`; this is a weak install-script signal rather than useful proof.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff package.json pnpm-lock.yaml pnpm-workspace.yaml` failed in unrelated `apps/web/test/browser-vault-dashboard-pages.test.tsx` stale experiment-count expectations (`Library · 5 experiments` expected while current output renders `Library · 6 experiments` / `8 of 8 experiments`).
- `pnpm test` failed in unrelated `packages/cli/test/gateway-core.test.ts` sendability expectation for `linq` route constraints.
- `git diff --check` passed on the scoped files.
- Required final review completed with no findings.
Completed: 2026-04-24
