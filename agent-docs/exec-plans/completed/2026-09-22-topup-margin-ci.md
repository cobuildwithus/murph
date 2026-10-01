# Complete top-up margin PR checks

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

Repair the reproduced CI blockers on PR 3646 with focused proof, then submit
the complete candidate to required CI and final billing review.

## Evidence and correction

The required hosted billing job fails in Chromium setup before application
proof. A Linux APT reproduction shows that a lowercase timeout key retains its
casing when the value is overridden with the documented mixed-case key. The
configured value is 180, but the wrapper's case-sensitive full-line comparison
rejects it. Match the fixed numeric policy lines case-insensitively; no new
configuration parser or process owner is needed.

A second release Web failure reproduces locally: the source-recorded sleep
route test uses July fixtures with the real clock, so the route correctly
filters them after 60 days. Pin Date.now only within that test and restore it
through the test-finished hook; preserve production retention behavior.

## Scope and invariants

Preserve the exact retry/timeout values, fail before Playwright on missing or
incorrect policy, invoke Playwright once, and preserve its exit status. No
member-facing behavior beyond the already-reviewed top-up allowance change.
The wrapper also serves viewport CI. CI-only deployment; no production rollout.

## Proof

- Linux apt-config reproduction confirms lowercase timeout output with value 180.
- Run bash syntax validation and the wrapper's focused tests, including preserved
  casing and wrong/missing numeric values, plus the repository tools typecheck.
- Re-run required checks on the final PR head; keep the PR draft before pushes.
- Complete final ReviewGPT and prove current-base mergeability before handoff.

## Verification

- Passed: Linux APT reproduction, `bash -n scripts/install-playwright-chromium.sh`,
  seven focused installer tests, and
  `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false`.
- Parent review: a case-insensitive fixed-string, full-line comparison preserves
  exact numeric validation. No new process, retry, parser, or runtime code.
- Product UX: internal CI correction; no additional member-facing change.
- Passed: the focused vault-share delivery file, 36 tests, after its one failing
  fixture was reproduced with the real clock. Production retention is unchanged.
- Implementation and parent review are complete. Seven installer tests,
  36 vault-share tests, shell syntax, repository-tools typecheck, Web typecheck,
  focused lint, documentation drift, and complexity checks pass.
- Required CI and final ReviewGPT remain delivery gates on the final pushed
  candidate. The original run passed both CLI platforms; its two reproduced
  failures are covered by the corrections above.

Completed: 2026-09-22
