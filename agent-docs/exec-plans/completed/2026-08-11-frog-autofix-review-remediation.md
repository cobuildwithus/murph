# Frog Autofix Review Remediation

## Goal

Resolve the accepted preliminary ReviewGPT findings on PR #1647 without
creating a parallel recovery owner or weakening the original trust boundary.

## Success criteria

- The parent classifies a trusted deterministic issue branch as `implement`,
  `resume`, or `close-issue` from verified local Git and GitHub state.
- Only `implement` mode asks a fresh ReviewGPT thread for an implementation
  patch. Existing commits and open PRs resume their earliest incomplete gate;
  a verified merged PR may only finish issue closure.
- Production admission delegates to the same pure eligible-issue selector used
  by focused tests, with command-boundary cases for malformed and capped API
  results.
- Deterministic tests prove exact process-group timeout signaling, cleanup
  ordering, lock ownership, and the merged-PR-plus-closed-issue terminal rule.
- Focused tests, repository tools, typecheck, privacy checks, ReviewGPT final
  review, and exact-head CI pass before ordinary merge.

## Finding dispositions

1. Accepted: unconditional patch reacquisition breaks recoverable retries.
2. Accepted: the production discovery path duplicated instead of using the
   tested selection helper.
3. Accepted: isolated argument/lock tests did not directly prove the owned
   worker supervisor and terminal remote-state conjunction.

## Tasks

1. Add pure recovery classification, prompt-mode rendering, worker supervision,
   cleanup, and terminal-state helpers.
2. Wire the runtime to verified deterministic branch/PR state and the shared
   admission selector.
3. Add focused recovery, command-boundary, process lifecycle, and terminal-state
   coverage.
4. Run local proof, close this plan through `finish-task`, push, update PR shape,
   then complete final ReviewGPT and CI gates.

## Verification results

- The preliminary specialist pass ran on the original pushed head for about 18
  minutes with the requested concrete model and guarded repository attachment.
  It returned three findings and no patch artifact; all three were accepted.
- Production recovery now uses controlled `implement`, `resume`, and
  `close-issue` classification. Resume and close-only rendered prompts contain
  no implementation ReviewGPT command.
- Focused Frog autofix coverage passes with 17 tests, including controlled
  production discovery and recovery states, ordinary/nonzero/timeout/forced
  child exits, lock-recording failure termination, cleanup ordering, and exact
  merged-head-plus-closing-relationship terminal proof.
- The combined Frog workflow/autofix suite, direct TypeScript check, focused
  assistant model-behavior suite, docs drift, shell syntax, diff check, and live
  read-only scan pass. The live scan remains correctly empty while Frog bindings
  are absent from `main`.
- The original PR head's required GitHub checks are green. A metadata-only
  changelog bullet correction fixed the sole initial PR-body guard failure; the
  broad Release app verification passed.
- Full repository-tools passes: 35 files and 542 tests. Canonical workspace
  typecheck passes through every package/app lane.
- Pending on the remediated head: privacy scan, commit/push, final ReviewGPT
  PASS, exact-head CI, merge, install, and installed run proof.
Status: completed
Updated: 2026-08-11
Completed: 2026-08-11
