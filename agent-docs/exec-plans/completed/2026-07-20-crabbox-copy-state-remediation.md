# Crabbox Copy-State Remediation

## Goal

Close PR #812 round-three's accepted copy-detected addition gap so a copied new
path must remain fully staged before any Blacksmith delegation.

## Constraints

- Preserve the immutable first-reviewed head
  `3c00660fde9f039ec94d68ffb2fb5ca10e483f3c` and round-three reviewed head
  `ee5edef32a87bc9d29d94dacf733e6f5abc0dedd`.
- Keep the existing porcelain parser and Git-state classifier as the only sync
  authorization owner.
- Treat `C` as addition-like: fully staged `C ` is allowed, while `CM`, `CD`,
  and `CT` fail before Crabbox starts.
- Preserve authorized tracked rename states such as `RM` and `RD`.
- Add no new classifier, state machine, lifecycle, or reconciliation path.

## Plan

1. Reproduce `CM` and `CD` with Git copy detection in the real temporary-repository test.
2. Record the required same-mechanism retrospective continuation on PR #812.
3. Extend the existing staged-addition divergence check to copy-detected additions and cover `C`, `CM`, `CD`, `CT`, `RM`, and `RD`.
4. Run coverage-write, focused and canonical verification, commit, push, then run ReviewGPT round 4 with exact lineage alongside CI.

## State

Complete. A production-faithful Git repository reproduced the `CM` bypass before
the fix. The existing classifier now applies its fully-staged-addition rule to
both `A` and `C`, with real `C`/`CM`/`CD` proof, direct `CT` and `RM`/`RD` proof,
and no-delegation assertions. The retrospective continuation is recorded on PR
#812. Focused verification passed 31 tests, canonical `test:diff` passed 27 files
/ 396 tests, docs drift and syntax checks passed, and coverage-write closed with
no unresolved findings.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
