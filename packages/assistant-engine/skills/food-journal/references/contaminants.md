# Contaminant summaries in label lookups

Read this before discussing a `contaminantSummary` from a food label lookup.

The default returns one compact nutrition match
per component with serving, calories, protein, carbohydrate, fat, fiber, and
a bounded exact-product contaminant summary. Read `contaminantSummary` by
default: `no_known_product_tests` means evidence is unknown, observations are
measured or reported findings rather than verdicts, and truncation means more
linked evidence exists. When an alert includes `screeningPolicy`, use its
exposure and ratio to interpret unlike result/threshold units and state its
fixed serving-per-day and body-weight assumptions; that context is not a
personalized safety verdict. `murphConcernLevel` is the strongest
threshold-screening result among the linked tests, not product safety or
personal risk. `none` means no represented comparable observation triggered
an alert, not that no contaminants were measured. Alerts are a subset of
observations; never add their counts together. For a routine meal log, inspect
the summary silently and mention it only when the user asks or a material
exact-product alert warrants a brief, source-specific screening caveat. For a
material alert, attribute the measured result to `source`, and attribute the
concern level, exposure, and ratio to Murph's comparison against the named
`threshold.authority` and threshold. Never say the source reported a concern
level unless the evidence explicitly states that. Do not inject unknown or
`none` results into every acknowledgment.
