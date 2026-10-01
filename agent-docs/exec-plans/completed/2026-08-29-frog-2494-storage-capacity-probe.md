# Normalize worktree storage capacity probes

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Make the serialized worktree storage guard parse supported POSIX/macOS
  filesystem-capacity output deterministically and return a bounded actionable
  probe error without weakening the fixed free-space floor.

## Success criteria

- Capacity parsing selects a real POSIX Capacity field only when the size,
  used, and available columns immediately before it are numeric.
- Locale and numeric output are normalized for the probe and parser.
- A failed `df -Pk` command reports its bounded exit status and probe count;
  malformed or empty successful output reports a distinct bounded error.
- The existing 20 GiB fail-closed floor and serialized guard lock remain
  unchanged.
- Focused storage/worktree lifecycle tests and a direct current-macOS probe
  pass.

## Scope

- In scope: `scripts/worktree-storage-guard` capacity probe/parser and focused
  hermetic regression coverage.
- Out of scope: worktree creation/home discovery, ReviewGPT bootstrap, storage
  thresholds, lock ownership, cleanup, or unmerged related repairs.

## Risks and mitigations

1. Risk: accepting a malformed row could bypass the disk floor.
   Mitigation: require the complete numeric size/used/available triplet before
   a percentage token and reject every unrecognized data row.
2. Risk: diagnostics could expose local paths.
   Mitigation: report only the fixed command name, exit status, probe count,
   and expected row contract.
3. Risk: probe hardening could alter serialization or threshold policy.
   Mitigation: change only post-lock capacity parsing and retain all existing
   count, floor, and reservation tests.

## Tasks

1. [x] Revalidate the binding, ownership, current guard, and native macOS probe.
2. [x] Add failing supported-output and bounded-error fixtures.
3. [x] Implement locale-normalized capacity parsing and diagnostics.
4. [x] Run focused lifecycle tests, shell syntax, and affected repo-tool checks.
5. [x] Commit the exact candidate and prepare its Draft PR handoff.

## Decisions

- Keep the existing aggregate probe and guard lock. The repair belongs in the
  one capacity parser/diagnostic boundary, not a new filesystem owner or retry
  loop.
- Treat percentage-like filesystem-name tokens as untrusted layout text. Only
  a percentage preceded by the three POSIX numeric capacity columns can select
  the available-space value.
- Do not consume changes from the unmerged worktree-home or ReviewGPT bootstrap
  PRs; neither owns this capacity parser.
- Keep the public changelog unchanged because this is repository-local commit
  tooling with no member-visible behavior.
- The preliminary coverage ReviewGPT lens applies. The final cross-cutting gate
  is exempt because the patch changes no production surface, threshold, lock,
  retry, ordering, or concurrency contract.

## Verification

- Commands to run: focused storage-guard capacity fixtures, the complete
  worktree storage-guard suite when practical, Bash syntax, repo-tools
  typecheck, current macOS `df -Pk` proof, diff hygiene, and privacy review.
- Expected outcomes: supported rows pass with the correct minimum capacity,
  command/malformed failures stay fail-closed with bounded actionable errors,
  low disk remains rejected, and the live guard still succeeds.
- The three new fixtures failed on the pre-fix guard and pass after the repair.
- Full worktree storage-guard suite: passed, 67 tests in 365.38 seconds.
- Full repository-tooling suite: passed, 49 files and 681 tests.
- Bash syntax, agent-doc drift, and doc gardening: passed with zero issues.
- Live scoped guard on current macOS: passed with a concrete capacity result.
Completed: 2026-08-29
