# Stable group report participant labels

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

- Every hosted shared-data row has a useful, unambiguous display label, including scheduled reads without a sender.

## Success criteria

- Prefer the authorized profile projection; otherwise use a safe, consented owner contact name with explicit unverified provenance, then a stable group-scoped pseudonym.
- Preserve data/grant status and current-turn attribution, and expose no contact identifiers.

## Scope

- In scope: Web shared-read presentation, existing contact lookup, deterministic and real-assistant regression proof.
- Out of scope: contact permission changes, identity inference, deployment, and new persisted identity state.

## Constraints

- Derive labels from membership IDs, never contact identifiers or roster positions. Keep the existing wire shape and bounded contact lookup.
- Contact failure must retain reportable data. Keep external crypto outside transactions.

## Risks and mitigations

1. Owner contacts are advisory, not identity. Preserve owner consent, unique verified phone matching, safe-label filtering, and explicit unverified annotation.
2. Missing or duplicate names can silently degrade a report. Exercise host output, compact model output, and a scheduled real-Codex report.

## Tasks

1. Extend the existing shared-read owner with stable labels and optional consented contact fallback.
2. Cover missing, duplicate, malformed, revoked, and failed name sources with synthetic tests.
3. Run focused tests, typecheck/lint, real assistant proof, and candidate review; document outcome and commit.

## Decisions

- The existing nullable displayName field can carry fallback presentation without a protocol rollout.
- Product UX: patch; ordinary and scheduled group reads reach profile-named, contact-named, duplicate-named, and unnamed participants. Ready requires correct attribution and preserved data without contact leakage.

## Verification

- Focused hosted Web and assistant tests; relevant typecheck and lint; focused local-subscription assistant journey; complexity review.
- No new schema, dependency, cache, or persisted state. Existing consumers can accept the populated displayName; older Web retains its prior behavior until deployed.

## Results and review

- Root cause confirmed: the profile-only name projection can be empty while
  authorized metrics are available; scheduled reads correctly have no sender
  handles. The compact model response omits null names.
- Web shared-read, label, address-book, and group-store slices: 157 tests pass.
  Group tool, delegated Ask, freshness, and rendered changelog slices: 229 tests pass.
- Web and assistant-engine typechecks pass. Focused Web ESLint passes with one
  pre-existing unused import warning in group-store. Documentation drift and
  complexity checks pass; the new owner's maximum complexity is 7. The existing
  join transaction hotspot is unchanged and outside this correction.
- Focused real-Codex journey:
  `pnpm test:assistant:live -- --test "labels every scheduled shared row using host names and stable participant fallbacks"`,
  using an authenticated alternate local subscription via `--codex-home`,
  model `gpt-5.6-terra`. The default and earlier available profiles failed
  before provider actions (authorization, quota, or unavailable-provider errors);
  retry stopped at the first working profile. The final journey passed:
  one exact shared-data call, one send-message decision, all five rows labeled
  with the correct values, no identity question or contact identifier disclosure.
  Parent reply review: Ready.
- Deterministic proof covers absent names, fixed cross-release pseudonym vectors,
  order/subset/new-member stability, current-turn handle independence, Unicode
  case collisions, imitated generated labels, a maximum 200-member roster,
  profile precedence, no work for named/non-reportable rows, verified phone field
  bindings, revoked/unsafe contact results, unverified or mismatched phones,
  ambiguous phones, changed/removed membership, and crypto/contact failures.
- Candidate review: existing grant and sender authority is unchanged. Optional
  enrichment is outside transactions, bounded to one 16-row membership read,
  one phone batch (at most 16 control roots, existing unwrap concurrency four),
  and one existing owner advisory lookup. There are no new retries, wearable or
  messaging provider calls, or logs. Crypto receives the existing two-second abort budget; database
  reads retain the existing datastore timeout behavior.
- Initial provider input is unchanged for both personal and group runtimes:
  no production prompt, schema, tool catalog, or pre-provider work changed.
  Labels arrive only in the existing requested shared-data tool response.
- Changelog: `clearer-group-report-labels`. Content-only rendering proof passes.
- Local implementation/commit scope only. No push, PR, merge, or deployment.
  Required PR CI and final ReviewGPT remain release gates if this is promoted
  to a PR. No database migration or coordinated runtime rollout is needed.
Completed: 2026-09-22
