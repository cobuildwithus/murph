# Bound repository-tool CI file parallelism

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal and scope

Reduce elapsed time for the existing Host Support repository-tool step by using
two isolated Vitest workers on its existing Ubuntu runner. Only that step's
environment changes. Preserve the command, test inventory, assertions, timeouts,
coverage policy, failure propagation, and required checks.

The parent reserved this exact workflow step. A fresh registered-worktree scan
found no uncommitted workflow edits. The only open PR touching the workflow,
#3134, changes unrelated authentication environment entries. Test-deletion PRs
#4262 and #4264 and their files are outside this task.

## Measured basis

Successful Ubuntu run 39536825132, job 119015274308, spent 129.71 seconds in
repo-tools (113.74 seconds executing tests). Retirement, storage guard, and
complexity accounted for about 75 seconds of summed file execution. This is a
target-selection observation, not a controlled before/after pipeline comparison.

A controlled local pair used unchanged source c29612b250b9fff7fbfc5d7fe930334c26fc3f5b,
Node 24.14.1, pnpm 10.33.0, Vitest 4.1.6, the same frozen dependencies, and the same
Apple M1 Max arm64 machine with 10 logical CPUs and 32 GiB RAM. Both runs used
CI=true. Before each run the completed warm-up's Vitest scheduling cache was
restored (SHA-256 2c4aa9311ecee8dd9d7f0588790f05d98d1705e724e53b12e3fcb8a1fa068c54).
No cleanup or other owned heavy job overlapped this pair.

| Mode | Wall seconds | User CPU seconds | System CPU seconds | Result |
| --- | ---: | ---: | ---: | --- |
| Serial, one worker | 248.05 | 113.80 | 80.30 | 64 files, 908 passed |
| Parallel files, two workers | 123.35 | 113.68 | 81.53 | 64 files, 908 passed |

Elapsed time fell about 50%; combined CPU time was essentially unchanged.
This is one local pair, not an Ubuntu, whole-pipeline, or billing savings claim.
The earlier 257.44-second warm-up overlapped guarded cleanup and is excluded.
Resource samples showed CPU headroom and no swap activity; background desktop
activity remained present, so measurements are not from an otherwise empty host.

## Parity and shared-state audit

- Both modes reported zero failures and zero skips. Sorted file/test identity
  and status records had the same SHA-256:
  83b397c7849198743345c26814204fb5bf2e61589929b07e1703e7df9cd9d8d3.
- After excluding framework progress, timing, and report-location lines, both
  runs emitted the same single npm configuration warning.
- Scratch fixtures used the real repo-tools config with only fixture discovery
  redirected. Serial and parallel modes both exited 1, reported one passed,
  one failed, one explicitly skipped case, and two failed suites. Assertion
  failure messages and collection-error messages matched exactly. The scratch
  fixtures are measurement inputs, not changes to the production test inventory.
- Vitest keeps file isolation enabled and uses separate forked processes.
  The large suites create unique temporary Git repositories; guard locks live
  inside those fixtures. Environment/cwd mutation stays in isolated workers.
  The local HTTP fixture requests an ephemeral port. The run's temporary-root
  teardown remains owned by the unchanged global setup after worker completion.

## Implementation and completion

Use existing MURPH_VITEST_FILE_PARALLELISM=1 and MURPH_VITEST_MAX_WORKERS=2 only
on the Test repo verification tools step. Do not change the global Vitest
defaults, package suites, runners, cancellation, or continue-on-error behavior.
No new abstraction, dependency, production concurrency, or deployed state.

Local checks pass: full comparison, failure probes, YAML parsing with the
installed yaml 2.9.0 parser, structural equality after removing only the added
step environment, unchanged package-command readback, doc drift, doc gardening,
and diff checks. No authored JavaScript or TypeScript changes need a complexity
measurement. Required exact-head Ubuntu CI and parent candidate review remain
pending at this checkpoint. This is low-risk CI tooling using existing isolated
test workers, with no product/runtime concurrency or state changes; the tooling
exemption in completion-workflow.md applies. Parent candidate review remains
required. No external source package has been transmitted.

The separate native-Node complexity probe saved only 0.18 seconds per invocation
and is not included. Native base-image reuse is independently owned and its
savings are not attributed here. The sibling's real-time timeout and larger CLI
startup candidates remain separate follow-ups with their existing coverage.
Completed: 2026-10-21
