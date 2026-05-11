# Murph Age R399 Query/CLI Integration

## Goal

Make the frozen R399 NHIS proxy research card reachable from the vault-backed Murph Age report path so it can act as the explicit base outcome-risk anchor while staying research-only.

## Scope

- Pass an explicit Murph Age card id through the query report calculation path.
- Allow the CLI `age report` command to request the R399 research card.
- Update the public CLI schemas so R399 report output validates.
- Add focused tests for explicit R399 selection.

## Non-Goals

- Do not authorize product display or risk-to-age display for R399.
- Do not add private coefficients, row data, source bodies, or dataset-specific records.
- Do not change the current lab or wearable cards.
- Do not make wearables score-bearing.

## Verification

- Focused query test for explicit R399 card selection.
- Focused CLI test for `age report --card-id r399_nhis_proxy_10y_acm_research`.
- Package-level health-metrics/query/CLI checks as appropriate for the touched files.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
