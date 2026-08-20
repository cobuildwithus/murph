# Junction Temporal Features Round 17 Retrospective

Status: completed decision record for PR #1703 ReviewGPT round 17 remediation.

## Original requirement

A complete-source-day import may replace temporal facets only from rows it can
fully trust. Every delivered row that cannot normalize into a usable timestamp
and target vault day must fail the import retryably before any canonical
write, and an unresolvable supplied clock must never fabricate an instant.

## Recurrence and root cause

- Round 16 corrected the authorized-day filter to keep ambiguous rows so the
  importer's fail-closed owner could reject them. That correction assumed the
  importer validates the entire timestamp. It does not: timestamp-semantics
  inference, day-key extraction, explicit-timestamp validity, and the temporal
  instant resolver each interpret only a leading prefix of the raw value, so a
  clock-prefixed malformed timestamp such as a valid date-and-clock followed
  by unsupported or contradictory trailing text is classified floating,
  admitted for the authorized day, resolved to a prefix-derived instant, and
  laundered into partial, corrupted, or empty replacement authority.
- The repeated mechanism is the same as round 16's: preprocessing converts
  malformed provider input into successful authority instead of the
  complete-day owner failing closed. The deeper cause is that timestamp
  acceptance has no single owner — four independent prefix interpretations
  each answer a different question about the same raw value, and no one of
  them is responsible for rejecting the remainder.

## Shape and decision

- One accepted timestamp language for complete-source-day authority. A
  delivered row's raw timestamp must be exactly one of, with the full value
  consumed and no trailing text:
  1. a pure calendar date `YYYY-MM-DD` — proves day membership, contributes
     zero temporal coverage;
  2. a floating datetime `YYYY-MM-DD` plus `T` or space plus `HH:mm`,
     optionally `:ss` and a fractional part — contributes a vault-local
     temporal instant, omitted seconds defaulting to zero;
  3. a supported absolute ISO-8601 form ending in `Z` or an explicit
     `±hh[:]mm` offset — contributes an exact instant under the existing
     window rules.
  Any other value — including a valid prefix with trailing unsupported text
  or contradictory semantics — fails the import with the existing retryable
  incomplete-normalization error before any canonical write.
- One acceptance owner. The importer's complete-day boundary owns acceptance
  through a single parse of the raw value that yields semantics, day
  membership, and temporal-instant eligibility together. The temporal
  instant resolver and the explicit-timestamp validity check consume that one
  result under complete-day authority instead of re-deriving their own prefix
  interpretations. The provider-side authorized-day filter keeps its round-16
  rule: discard only rows that conclusively prove a different calendar day,
  and pass everything ambiguous to the owner.
- Combine and delete rather than stack: no fourth classifier, no parallel
  validation path, no compatibility state. Ordinary non-authoritative parsing
  is unchanged.

## Required proof before another review round

- A production-composed matrix through the real client, provider, importer,
  and core covering: valid exact date-only values succeeding with zero
  temporal samples and legitimate stale-facet retraction; valid floating
  `HH:mm` and `HH:mm:ss` forms including omitted-second behavior; each
  supported fractional, UTC, and offset absolute form; no-day malformed
  values; correct-day-and-clock prefixes with trailing unsupported text;
  malformed absolute-looking suffixes and contradictory semantics.
- A seeded-facet case proving every invalid row causes a retryable job with
  zero canonical mutation, a byte-identical ledger, and no retraction.
- Existing facet-only, deletion-preservation, cold-restore identity, strict
  grouped collection, and replay-convergence proofs remain green.
- After remediation and exact-head green CI, the loop continues under the
  owner's recorded run-to-completion authorization toward an exact-head
  `PASS`.
