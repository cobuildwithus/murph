# Contaminant summaries in label lookups

Read this before discussing a `contaminantSummary` from a food label lookup.
During a routine meal log, read the summary silently. Mention it only when the
member asks, or when an alert for that exact product is material enough to
deserve one brief caveat that names its source. Do not add "no known tests" or
"no concerns" to every acknowledgment.

How to read the fields:

- `no_known_product_tests` means there is no evidence either way.
- Observations are measured or reported findings. They are never verdicts.
- A truncated summary means more linked evidence exists than is shown.
- `murphConcernLevel` is the strongest threshold-screening result among the
  linked tests. It does not measure product safety or personal risk.
- `none` means no comparable observation triggered an alert. Contaminants may
  still have been measured.
- Alerts are a subset of observations, so never add the two counts together.
- When an alert includes `screeningPolicy`, use its exposure and ratio to
  compare a result and a threshold that are in different units, and state its
  fixed servings-per-day and body-weight assumptions. That comparison is not a
  personalized safety verdict.

How to describe a material alert:

- Attribute the measured result to `source`.
- Attribute the concern level, exposure and ratio to Murph's comparison against
  the named `threshold.authority` and threshold.
- Never say the source reported a concern level unless the evidence states
  that explicitly.

A summary describes that exact product. Never carry it over to a similar name,
brand, ingredient, category or product line. A product with no test on record
has not been shown to be clean or safe.
