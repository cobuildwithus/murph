# @murphai/health-metrics

Neutral metric identity, normalization, derived MetricPoint contracts, and pure selectors.

Canonical vault records still store evidence. This package owns only read-side metric mechanics.

Sample-series summaries, the wearable metric catalog, and reviewed lab fallback
ranges are part of this package's root entrypoint. Importers, query, CLI, and Web
consume them here directly; ingestion and Health Commons packages do not
re-export these neutral primitives. Health Commons continues to own authored
page guidance and its parity checks against the reviewed runtime range catalog.

Decision-grade metric-window comparisons use normalized `MetricPoint` values
and the shared series/window selectors. Wearable day summaries are presentation
context, not analysis truth.

Sleep and readiness/recovery scores use a 100-point scale. Provider percentages
normalize to the same numeric score while retaining their source unit; unrelated
units remain unsupported. Journal may retain a provider's Recovery label even
when its canonical metric identity is readiness-score.
