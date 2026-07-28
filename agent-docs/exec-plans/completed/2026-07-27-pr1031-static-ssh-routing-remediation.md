Goal (incl. success criteria):
- Make PR #1031's canonical static-SSH executor work with Crabbox's real routing contract.
- Keep the remote destination entirely operator-local through explicit non-secret host, user, and port inputs.
- Success means the documented doctor probe passes and one canonical verification command completes on the dedicated Mac without forwarding credentials or falling back to Blacksmith.

Constraints/Assumptions:
- The dedicated worker account and neutral resolvable host already exist outside the repository.
- Host, user, and port are local routing facts only; they must not enter the remote verification environment or committed machine-specific configuration.
- Preserve the frozen Git candidate, run-unique workspace, native `lockf` capacity boundary, sanitized test environment, exact cleanup, and fail-closed executor selection.
- Preserve unrelated working-tree and coordination-ledger edits.

Key decisions:
- Add explicit `MURPH_VERIFY_SSH_USER` and `MURPH_VERIFY_SSH_PORT` inputs beside the existing host input.
- Require the host input to be resolvable by Crabbox's raw readiness probe; an SSH-config-only alias is insufficient.
- Pass routing facts as Crabbox CLI flags after validation, then continue rebuilding the CLI environment from the existing non-secret allowlist.
- Add no config file, daemon, queue, scheduler, fallback, or persisted worker state.

State:
- Completed.

Done:
- Proved direct key-only SSH and the dedicated worker toolchain.
- Reproduced the documented doctor failure with an SSH-config-only alias.
- Proved Crabbox doctor succeeds with explicit resolvable host, user, and port.
- Reproduced Crabbox v0.40 rejecting non-built-in `rsync` and `lockf`
  preflight-tool names before sync; kept those prerequisites in doctor and the
  locked entrypoint while limiting run diagnostics to supported built-ins.
- Added explicit host, user, and port admission, CLI routing, scrubbed-environment
  coverage, and aligned durable documentation.
- Reproduced full acceptance reaching the worker and passing workspace
  typecheck before failing because Crabbox excludes `.git`; the same run proved
  the real nested workspace made the original lock and cleanup resolve one level
  per run instead of at worker scope.
- Added bounded Git-base transport/reconstruction with exact tree proof, corrected
  the shared-lock root, corrected outer-run cleanup, and covered the real nested
  layout.
- Proved the reconstructed candidate through install, full-workspace typecheck,
  documentation and artifact guards, package tests, and the web build before
  the worker became unreachable and the SSH transport returned 255.
- Bound native `caffeinate` to the admitted verifier lifetime so an active run
  prevents idle system sleep without a daemon or persistent power change; the
  production-wrapper regressions preserve verifier status, lock ownership, and
  exact cleanup through that boundary.
- Canonical local `pnpm test:diff` passed 30 repo-tool files and 448 tests after
  the wake-lifetime correction.
- Completed the production-faithful retry through the full 8m37s canonical
  command. Native `caffeinate` kept the worker online, exact cleanup and lock
  release passed, and the command propagated its test exit status. The run
  exposed one shared cause for the Cloudflare snapshot failures: `zstd` was not
  part of static-worker readiness. It also exposed CPU-count-only composed
  scheduling as an invalid assumption for the dedicated worker's bounded CLI
  test budgets.
- ReviewGPT identified both mechanisms plus duplicated mutable scheduling
  claims in the Crabbox skill. The remediation now proves native `tar` and the
  production-compatible `zstd` round trip before candidate inspection, selects
  an executor-owned `static-ssh` profile, serializes package coverage before
  app and fixture work, and keeps Crabbox's supported generic preflight list
  unchanged.
- Focused runner/dispatcher/workspace coverage passed 67 tests. Canonical local
  `pnpm test:diff` passed 30 repo-tool files and 455 tests.
- The exact-head ReviewGPT check reproduced a signal arriving during the
  synchronous archive-readiness probe and leaving the transported run
  directory behind. A run-lifetime supervisor now owns signals before
  readiness, forwards them to the isolated verifier process group, waits for
  every process in that group to exit, performs exact cleanup, and preserves
  the first signal status.
- New interruption regressions cover repeated signals during archive readiness
  and termination during Git reconstruction. Focused runner/dispatcher/workspace
  coverage passed 69 tests, and canonical local `pnpm test:diff` passed 30
  repo-tool files and 457 tests.
- The targeted ReviewGPT correction check confirmed the readiness/Git cleanup
  mechanism and found one nested-group edge case: install and verification used
  one-shot forwarding listeners, so a graceful child could consume the first
  signal and a surviving descendant would not receive the same signal again.
  Those listeners now remain installed until the owned process group is empty.
  Repeated-identical-signal regressions cover both install and verification,
  including a leader that exits before its descendant; focused coverage passed
  71 tests, and canonical local `pnpm test:diff` passed 30 repo-tool files and
  459 tests.
- A fresh exact-head ReviewGPT correction check independently exercised
  repeated SIGHUP, SIGINT, and SIGTERM across install and verification and
  passed with no findings. At that reviewed head the live worker remained
  reachable through operator-local routing, but its non-interactive readiness
  probe still reported `zstd` missing.
- Installed worker-side `zstd` without changing repository or routing state.
  The production readiness probe then passed the exact native
  `tar`/production-argument `zstd` round trip before candidate inspection.
- Completed one production-faithful static-SSH `pnpm verify:acceptance` run.
  The dispatcher captured one immutable candidate tree, synced 17,720 files
  (247.3 MiB), reconstructed the detached Git base and candidate index, completed
  the frozen install, full workspace typecheck, documentation and artifact
  guards, every package coverage lane, the hosted-web production build/lint/dev
  smoke and 7,146-test matrix, Cloudflare's 2,013-test matrix, and 204-scenario
  manifest proof. The canonical command returned `0`; command time was
  12m28.613s and end-to-end sync plus execution was 13m18.471s.
- The dispatcher reported `runStatus=succeeded`, `exitCode=0`, and
  `leaseStopped=true`. An independent SSH probe proved the exact opaque outer
  run directory absent and immediately acquired the worker-global
  `/Users/Shared/murph-crabbox/verification.lock` nonblockingly.
- Merged current `origin/main` through a normal merge. Five conflicts were
  limited to the dispatcher, its tests, and aligned verification/security
  guidance; the resolution preserved the proven static lane and omission of
  unsupported paid-provider lifecycle flags while accepting unrelated current
  base updates. Canonical post-resolution `pnpm test:diff` passed 30 repo-tool
  files and 459 tests.
- Parent final review found no remaining accepted finding, unnecessary owner,
  credential path, cleanup gap, or proof gap. No additional paid Blacksmith
  verification was triggered.

Now:
- Archive this completed plan and push the resulting exact task head.

Next:
- Run final ReviewGPT correction-verification round 5 concurrently with PR CI,
  update the PR evidence, and keep the PR draft pending those exact-head gates.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- scripts/verification-dispatch.mjs
- scripts/verification-dispatch.test.ts
- .agents/skills/crabbox/SKILL.md
- ARCHITECTURE.md
- agent-docs/SECURITY.md
- agent-docs/RELIABILITY.md
- agent-docs/operations/verification-and-runtime.md
- agent-docs/references/testing-ci-map.md
- scripts/crabbox/run-ssh-verification.mjs
- scripts/crabbox/run-verification.mjs
- scripts/crabbox/run-verification.test.ts
- scripts/workspace-verify.sh
- scripts/workspace-verify.test.ts
- PR #1031
Status: completed
Updated: 2026-07-28
Completed: 2026-07-28
