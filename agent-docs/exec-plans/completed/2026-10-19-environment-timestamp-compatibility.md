# Preserve timestamp compatibility after Environment dependency cleanup

## Objective and accepted finding

ReviewGPT round two on PR #4211 identified a High upgrade regression: local
Zod 4.4.3 accepted minute-precision schedule strings that 4.5.4 rejects. One
historical record, even archived, could then prevent all canonical cron reads.
The user requested review completion and fixes; preserve existing accepted data
while retaining the measured startup fix and removing Environment infrastructure.

## Implementation

- Add one bounded datetime schema constructor to the existing contracts Zod
  runtime owner. Compose the dependency's second/fraction and minute validators;
  return original strings, retaining explicit-offset versus UTC-only behavior.
- Use it at all existing contract datetime call sites, including scheduling,
  automation metadata, clinical dates, member actions and research inputs. Extend
  the same constructor to existing runtime/Web datetime consumers, including
  the operator-config primitive used for cron state. Gateway-core retains its
  acyclic lower-level adapter and composes the same two dependency validators. This
  avoids silently tightening other existing contract readers during cleanup.
- Keep malformed calendar dates, times and zones rejected. Do not normalize
  persisted timestamps: exact strings participate in occurrence equality.
- Refresh contract and CLI generated artifacts through their normal generators.
- Update the two stale package-version guards found by CI to ^4.5.4.

## Proof

- Contract tests cover minute/second/fraction forms, offsets, leap dates, rejected
  invalid values, UTC-only policy and exact string preservation.
- Claude implements a regression using canonical cron fixtures: archived
  minute-precision automation, activeUntil, scheduled log, and an unrelated due
  automation must remain readable and runnable with original strings intact.
- Run affected tests and typechecks, normal runner assembly and boot comparison,
  schema generation and package checks. Native CI remains authoritative.
- ReviewGPT round three reviews the stable pushed head concurrently with CI.

## Existing external evidence

Round-two CI passes the unchanged native startup budget: boot CPU candidate
1,362.642 ms/base 1,370.717 ms; wall candidate 1,308 ms/base 1,283 ms. The two
version guards fail as expected before their correction. One unchanged product
feedback deadline test timed out in the full Cloudflare run; all six focused
cases pass locally. Recheck on the final head without relaxing its timeout.

No production deployment, data rewrite, or timestamp migration is authorized
or needed. The Environment page and dedicated infrastructure remain removed.

The cron replay initially failed at operator-config nextRunAt even after the
contracts fix, proving the projected-state path also needed compatibility.
Actual query-reader fixtures additionally exercise archived/raw persisted files;
the cron regression uses the existing mocked query fixture seam.

## Completion evidence

Implementation and local verification are complete. Contract tests pass (405),
canonical cron runtime passes (250), actual query-reader fixtures pass (17),
hosted execution passes (823; one skipped), operator config passes (451), gateway
core passes (15), input/upcoming context passes (61), clinical enrichment passes
(32), Web clinical/admin tests pass (36), and typed CLI event tests pass (8).
Contracts, Web and all seven affected package typechecks pass. Contract and CLI
generators, CLI package verification, complexity, documentation drift and diff
whitespace checks pass.

Normal production runner assembly passes. Relative to the exact baseline, runner
output shrinks by 31,179 bytes and CLI output by 4,348 bytes. Alternating local
boot CPU samples have candidate median 784.951 ms and base median 836.366 ms.
Native final-head CI remains the authoritative external budget check.

Claude's scoped final review found no correctness or material complexity issue
in the shared validator, gateway adapter and regression coverage. Repository-wide
source inspection confirms all previous datetime consumers use the compatibility
constructor or the acyclic gateway equivalent. Generated types/schema reflect the
composed validators; no handwritten date parser or new dependency was introduced.

PR follow-up: push this correction, run the third ReviewGPT round in the same
thread alongside exact-head CI, and publish their results on PR #4211. This closes
the implementation plan; external review status is maintained on the PR.
Status: completed
Updated: 2026-10-19
Completed: 2026-10-19
