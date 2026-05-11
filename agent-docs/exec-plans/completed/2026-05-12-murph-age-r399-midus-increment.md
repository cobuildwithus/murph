# Murph Age R399 MIDUS Increment

## Goal

Add a local aggregate-only research runner that treats the frozen R399 NHIS anchor as the base layer and tests whether compact MIDUS 2 biomarker features add outcome signal on the same MIDUS denominator.

## Scope

- Add `scripts/murph-age/r399-midus2-biomarker-increment.ts`.
- Add focused synthetic fixture coverage for aggregate-only output, CLI output, and egress guards.
- Use only local/ignored model cards and downloaded public-use MIDUS files at execution time.
- Preserve the product boundary: no product authorization, no score promotion, no row values, no participant identifiers, no split memberships, no predictions, no coefficients, no source bodies, and no codebook text in committed or aggregate outputs.

## Non-Goals

- Do not change the user-facing `age report` CLI shape.
- Do not mutate the frozen R399 model.
- Do not promote MIDUS, CRELES, or any local research card to product evidence.
- Do not introduce ReviewGPT gates for local implementation chores.

## Verification

- Focused Vitest for the new runner.
- Live local run against downloaded study packages and ignored R399 card.
- Diff-aware scoped verification for touched files.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
