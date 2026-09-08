# Comparison dates in Personal Patterns details

## Outcome and invariant
Members can inspect the saved dates behind a comparison from its existing drawer or popover. The query remains the sole owner of results; presentation does not invent dates, daily outcomes, or confirmed absence.

## Ownership and design
Extend the existing Personal Patterns details with one Days compared disclosure below the average bars. Derive a bounded Gregorian UTC week grid from report dates and the saved cell arrays. Use filled factor marks, bordered filled confirmed-absence marks, and hollow unrecorded marks. Selecting a date reveals its group. Retain the short unrecorded warning without idle instructions or repeated statistics.

## Product UX
- Entry: open a metric on phone or desktop, then Days compared.
- Reaches: single and grouped sleep outcomes, confirmed and unrecorded comparisons, partial or absent dates, keyboard and touch users.
- Proof: focused date-boundary tests, existing synthetic production-component browser journey, phone and desktop screenshots, Web typecheck and targeted lint.
- Done when: saved dates are inspectable, missing dates are honest, drawer dismissal/focus restoration and desktop behavior remain usable.

## Work
- [x] Implement the presentation and update the existing design study.
- [x] Verify dates, interaction, rendering, and types; inspect privacy and final diff.
- [x] Add changelog and prepare the reviewed candidate for PR publication.

## Verification outcome
Ready: the two date-boundary unit tests passed. The existing browser journey passed at 320, 390, 640, and 1440 pixels, covering touch selection, keyboard week navigation, unrecorded and confirmed comparisons, grouped sleep results, drawer dismissal and focus restoration. Web typecheck and targeted ESLint passed. Complexity passed with no changed functions above 20. Synthetic phone and desktop screenshots were inspected; authenticated member data was not used. Hosted CI and publication follow on the exact candidate.

## Deployment
Presentation-only consumption of existing optional fields, no backend or data migration dependency. Legacy cells without dates omit the disclosure.
Status: completed
Updated: 2026-09-08
Completed: 2026-09-08
