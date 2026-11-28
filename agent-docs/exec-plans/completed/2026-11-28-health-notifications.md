# Health notifications and milestone pickers

Build the native feed from dated events the member can still open. Reuse the existing sealed composer set for publishing and freezing milestones. Keep the old Prizes Health response readable while retiring its medal evaluator.

Verify native admission, source visibility, grouping, monotonic read marks, historical compatibility and bounded synthetic database performance. Run the Web typecheck, focused tests and diff verification before local handoff.

## Source and authority map

| Kind | Dated source and conditions for showing it |
| --- | --- |
| `cheer`, `comment`, `reply` | Health post cheers and comments. Apply post audience, comment visibility, active account, sharing consent, feed enrollment, hides and blocks. Group cheers on each post by the viewer’s local date. |
| `workingOnCheer` | Timestamped cheers on an existing profile selection. Require a visible partner and the owner's You access. Removing the selection cascades its cheers. Older rows have no verifiable timestamp. |
| `ticket`, `joined`, `challenge` | Open ticket seats, joined seats in a game the viewer started, and addressed open invitations. Check current seats, playable group days, expiry and dismissal as applicable. Filter other people through the Health audience. |
| `milestone` | Owner’s dated Prizes award, with the Progress seen marker. Individual landmark, time, total, days and route awards can become cards. |
| `winReady` | Owner’s latest sealed composer set, using the first offer time preserved across consecutive sets. Suppress posted cards. |
| `ageChange` | Owner’s current private You cache, with two consecutive weekly estimates differing by at least two tenths. |
| `friendMilestone`, `friendBest` | Omitted. Friends progress exposes consent-scoped comparisons and series. It has no dated event for a partner earning a medal or setting a personal best. |

## Rollout

Apply the additive migration first. Roll out readers and writers together after the schema is available. The read mark and Working on timestamps are account metadata. Legacy undated cheers stay undated. Progress shares its award table with active achievements. Existing retired rows are filtered immediately and are eligible for the existing retired-award maintenance after all previous writers drain.

## Verification evidence

The synthetic database suite exercised native auth, group visibility, hides, blocks, consent withdrawal, dated and legacy Working on cheers, addressed invitations, ticket state, the read watermark, both pickers, post publication, frozen pins and account export. A 200-event fixture yielded 80 items and an unread count of 99. Three consecutive authenticated list reads in the five-suite database run took 259, 234 and 107 ms. A separate run during repository verification took 1,151, 803 and 1,251 ms. These are local wall-clock measurements including database queries, decryption and JSON.

Web typecheck, lint, complexity, docs drift and raw-payload logging checks passed. The focused database run passed 99 tests. A separate database cleanup test verified both retired medal kinds and an idempotent second pass. The changed-path verifier passed the full hosted Web suite (17,919 passed, 3,244 skipped), dev smoke and production build. No production data or infrastructure was used.
Status: completed
Updated: 2026-11-28
Completed: 2026-11-28
