# Murph Age R399 MIDUS Refresher Increment

## Goal

Run the existing R399-plus-compact-lab increment loop on MIDUS Refresher as a second same-family cohort check, keeping R399 frozen and all outputs aggregate-only/research-only.

## Scope

- Generalize the existing R399 MIDUS biomarker increment runner by cohort configuration.
- Preserve the MIDUS 2 output and tests.
- Add a MIDUS Refresher path using the downloaded survey, biomarker, and mortality files.
- Emit the same generic increment evidence card boundary for Refresher.

## Non-Goals

- No product model promotion.
- No calculator-loaded layered card.
- No row values, identifiers, split membership, predictions, coefficients, model parameters, source bodies, codebook text, or local paths in committed/package artifacts.
- No broad CLI redesign.

## Verification

- Focused R399 MIDUS increment runner tests.
- Tools typecheck.
- Live local MIDUS Refresher aggregate run.
- Diff check before handoff.
