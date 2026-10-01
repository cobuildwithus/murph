# Preserve WHOOP recovery through canonical normalization

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and evidence

PR 3002 CI reproduced a missing WHOOP recovery score in the composed development
persona. Round 1 ReviewGPT passed the earlier candidate; CI correctly remained
a separate merge gate. Focused persona and Journal regressions reproduced the
regression locally before correction.

The shared catalog aliases recovery-score to readiness-score, while WHOOP's
importer emits recovery-score values with a percent unit. Journal's new use of
canonical normalization therefore lost both the product label and numeric value.
The generic unit normalizer rejected percent against score. Canonical-only
fixtures also exposed that provider attribution ignored externalRef.system,
preventing the existing WHOOP duplicate-score preference.

## Smallest owner corrections

- Normalize percent units to the same numeric score only for canonical
  sleep-score and readiness-score, both 100-point scales. Keep raw source units
  and reject incompatible units. No global percent/score equivalence.
- Reuse the existing exact-unit normalizer for other units. Extract the existing
  generic fallback without changing its behavior; normalization dispatch
  complexity decreases from 62 to 55.
- Preserve an explicit recovery-score presentation key while reading canonical
  value and date. Reuse externalRef.system for provider attribution after the
  more specific dataOrigin provider and before a generic source field.
- Keep canonical data, metric IDs, persistence, refresh ownership, dependencies
  and UI components unchanged. Document the unit convention with health-metrics.

## Product UX and proof

Ready: WHOOP recovery stays visible, same-value Readiness duplicates stay hidden,
percentage-based scores retain their value, and invalid units remain rejected.
The new provider-shaped Journal regression checks canonical aliasing/value,
Recovery display, duplicate suppression and record count. Existing composed
personas exercise the final Browser Vault output for WHOOP and Oura.

57 health-metrics tests, 65 query tests, 123 Web tests, all three affected
typechecks, whitespace and the complexity guard pass. Existing normalization
hotspots are the metric dispatch (55, improved) and unchanged comparable-point
selection (21); further decomposition is outside this correction.

The branch design preview returned HTTP 200 and includes the ready and empty
Journal studies, weekly stats and refresh feedback. Its production UI source is
unchanged by this query/unit remediation; earlier responsive browser and image
evidence still covers that rendering. No private data or production secrets
were accessed.

## Delivery boundary

Parent reviewed the focused diff and privacy. Commit the correction, then run
ReviewGPT round 2 with the immutable first-reviewed head and re-admit exact-head
CI. Merge remains gated on their successful results.
Completed: 2026-09-06
