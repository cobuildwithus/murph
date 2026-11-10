# Resolve game chat review findings

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Outcome

Prepared PR #4812 for shipping after correcting its CI regression and both
external review findings. Exact-head CI, merge and managed production deployment
remain tracked in the PR and original completion session; they are not claimed
by this local implementation record.

## Decisions and corrections

- Bound-room candidate discovery preserves invitation expiry. The regression
  proves expired rematches remain hidden after a bystander joins too.
- Expanded duplicate pair rooms prove eligibility from their own bound game,
  then reuse the existing primary-pair allowance selector. A real chat-created
  duplicate retains the exhausted primary budget and opens no new allowance.
- App-only pair recap content remains private by default. Ordinary and scheduled
  reads omit pair lore for resolved or unresolved bystanders. Pair recap and
  missed-day messages retain the exact-player audience at final dispatch,
  including already queued text. Existing retry policy owns held messages.
  Full app recaps, shared game actions and other shared notices remain available.
- CI fixtures now supply provider/route evidence while retaining the actual
  shared-room database, moderation, receipt and final-dispatch checks.
- No new schema, stored authority, queue, delivery protocol or migration.

## External review disposition

Round 1 reviewed c75b1d056a9bf43beee94d01fe427b7ebe0a84ce using GPT-6 Pro,
a full sensitive repository attachment and the PR intent contract. The capture
included the exact head, substantive findings and REVIEW_COMPLETE after more
than ten minutes. Review: https://chatgpt.com/c/6af383d9-f358-83e9-aada-b5d56bda5eaa

Both high-priority findings were accepted and corrected. Funding keeps the
existing allowance owner. Privacy retains the old private notice boundary
instead of adding text rewriting or another runtime protocol. This deliberately
limits pair recap/missed-day chat delivery while bystanders remain; app recaps
are still generated and visible to their players. The correction reaches only
owners examined in round 1 and adds no state or authority path, so another
substantive round is not needed under the review loop's step 7.

## Verification

- Five previously failing PostgreSQL suites: 123 passed.
- Funding PostgreSQL suite: seven passed, including exhausted duplicate-room proof.
- Real provider-roster pair recap cases: two passed, including unresolved people;
  173 unrelated cases excluded by the focused test selector.
- Tool, delivery authority and actual Linq egress route tests: 279 passed,
  one existing environment-gated skew test skipped.
- Web typecheck passed. Assistant-engine typecheck passed earlier in this task;
  no further engine implementation changed during remediation.
- Complexity: 11 source files, no hotspot above the existing threshold.
- The earlier real-Codex bystander edit journey passed. Its repeat after base
  reconciliation remains blocked by the unavailable patched native binary;
  no replacement live pass is claimed.
- Parent review checked the full corrections, product privacy exception,
  bounded SQL, unchanged transaction boundaries and privacy-safe artifacts.
Completed: 2026-11-10
