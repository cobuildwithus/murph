# @murphai/health-metrics

Neutral metric identity, normalization, derived MetricPoint contracts, and pure selectors.

Canonical vault records still store evidence. This package owns only read-side metric mechanics.

Decision-grade metric-window comparisons use normalized `MetricPoint` values
and the shared series/window selectors. Wearable day summaries are presentation
context, not analysis truth.
