# Reduce redundant Junction admission parsing

Status: completed

## Outcome and evidence

Continue the origin parsing optimization with a behavior-preserving change at
source admission. The admission filter builds a complete origin and hashes
identity components only to discard everything except the provider slug.
Use the existing exported provider-only reader. Its fallback is derived solely
from the connection reference map, which never includes grouped-source hints.
Keep the completed origin-cost plan as immutable earlier evidence.

## Invariants and scope

Preserve provider alias precedence, connection fallback, disconnected and
unknown source fences, current authority revalidation, and canonical identities.
No new cache, dependency, state, async boundary, or deployed protocol.
Checkpoint replay durability and deployment wake recovery remain unchanged;
this work does not claim to eliminate every observed typing delay.

## Proof and completion

Run focused importer and source-admission tests, both package typechecks,
complexity diff and parent privacy/diff review. Compare full-origin extraction
with the provider-only reader on synthetic records and report measured scope.
No provider input, reply policy, or user-visible contract changes; no live model
journey or changelog entry is warranted. Complete the owned PR with final
ReviewGPT alongside exact-head CI and merge after required gates pass.

## Completed local evidence

- 269 Junction importer tests and 24 source-admission/reuse tests passed.
- Importers and device-syncd package typechecks passed.
- Synthetic equivalence comparison covered ten record/fallback combinations.
  Seven alternating 50,000-call rounds after warmup measured median 1,453 ms
  for full-origin extraction and 563 ms for the provider-only reader (61% less).
  Local timing is not an end-to-end production latency guarantee. Temporary
  benchmark and result files were removed.
- Added composed coverage for nested provider aliases taking precedence over
  connection fallback, disconnect changes between passes, and unknown-reference
  retention when no disconnect fence is known. An initial overly strict fixture
  expectation was corrected to preserve that existing behavior.
- Complexity guard passed. Origin resolver maximum remains 10; device provider
  debt and maximum remain unchanged. The 20 existing provider hotspots are
  untouched; the admission predicate itself is below the threshold. Broad
  provider decomposition would not be justified by this two-line substitution.
- Parent review confirms no authority, identity, checkpoint, protocol, or privacy
  change. Source-reference fallbacks contain only provider slug and instance id,
  so the full resolver's grouped-source-only fallback is inapplicable here.
- No new repository friction required a Frog entry.

## Delivery boundary

Implementation and focused local proof are complete. The PR phase retains
ReviewGPT, exact-head required CI, final parent review, and the authorized merge
as delivery gates. No deployment or live latency reduction is claimed.
Updated: 2026-09-24
Completed: 2026-09-24
