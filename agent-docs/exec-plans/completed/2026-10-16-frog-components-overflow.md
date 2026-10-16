# Contain components catalog examples at phone widths

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal

Restore the components catalog's phone viewport fit without hiding page overflow or changing production component behavior unnecessarily. Frog autofix issue: #4157.

## Success criteria

- Identify the actual overflowing elements through the rendered catalog.
- Demonstrate whole-page fit at phone and desktop widths, retaining readable examples and intentional local scrolling.
- Complete focused browser proof, Web typecheck and parent candidate review. Record final ReviewGPT, exact-head CI and human merge approval as PR completion gates.

## Scope

- In scope: the catalog's presentation wrappers and focused responsive regression coverage.
- Out of scope: auth, billing semantics, data owners, deployment, and unrelated primary-checkout work.

## Constraints

- Reuse the existing Playwright smoke environment, synthetic catalog examples, and local-only browser requests.
- No global overflow hiding; fix the actual layout constraint.
- Product UX effort: Patch. Outcome: catalog examples fit their container. Reaches: phone and desktop reviewers. Proof: real catalog document and affected examples, with no masking styles.

## Risks and mitigations

1. Narrow wrappers may conceal content. Verify all affected examples remain reachable and inspect rendered captures.
2. Shared production styling could broaden scope. Prefer the catalog composition owner when diagnosis shows the example owns the constraint.

## Tasks

1. Reproduce and measure overflow before changing source.
2. Correct each proven source at its existing layout owner and add durable regression coverage.
3. Run focused browser proof and Web checks; record parent candidate review.
4. Commit the reviewed implementation and open its draft PR. Final external review, exact-head CI and human merge approval remain tracked in that PR.

## Decisions

- Reuse the committed report; no duplicate Frog entry.
- The installed impeccable skill is unavailable in current exposed skill roots; existing PRODUCT.md, DESIGN.md and frontend owner instructions supply the layout contract for this bounded correction.

## Verification

- Before: real smoke catalog at 390px measured 628px document width. The unwrapped Metric Card row reached 627.59px; the Expected Signal Card row independently exceeded the phone container.
- After: catalog rows stack below the existing medium breakpoint and retain three columns at tablet/desktop widths. Focused proof checks both rows at 320, 390, 768 and 1280px, plus whole-page fit at the reported 390px and desktop 1280px. Whole-page 320px and 768px fit is deliberately not claimed: unrelated fixed-size image studies and other demos still overflow there.
- Web typecheck, complexity diff (maximum 9, no hotspots), documentation drift and gardening passed. Final browser proof passed (durable regression plus capture: 2 tests, 37.6s). Parent candidate review passed after full diff and native phone/desktop image inspection.
- Changelog: not applicable; only internal component-catalog layout and regression proof change, with production components unchanged.
Completed: 2026-10-16
