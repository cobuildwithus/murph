# Prefer the member's signed-in marketplace for retail purchases

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make Murph consistently treat a member's signed-in marketplace, usually Amazon, as the default storefront for retail purchases unless the member names another storefront, has a saved storefront preference, or the exact product is unavailable from the brand or a verified seller there.

## Success criteria

- A brand-site account, prior direct order, saved cart, or product-research source cannot silently override the signed-in marketplace default.
- Material authenticity, subscription, return, or total-cost tradeoffs produce one narrow preference question instead of an unannounced storefront switch.
- Clinical, prescription, insurance, records, and billing tasks continue to prefer the official portal.
- The stable system prompt, computer-use skill, health-browser playbook, and focused regression tests agree on the storefront rule.
- Scoped verification, the required prompt review, final local review, commit, and PR workflow complete.

## Scope

- In scope: stable computer-use guidance, the computer-use skill's site-selection contract, supplement purchase/reorder playbook guidance, and focused prompt/skill asset regression proof.
- Out of scope: changing saved member preferences, product selection, medical or dosing advice, retailer integrations, checkout authorization, or production data.

## Constraints

- Keep one decision rule and narrow exceptions; do not add state, services, migrations, or a retailer abstraction.
- Preserve explicit current-request and saved storefront preferences over the default.
- Preserve seller, fulfillment, product-identity, authorization, and official clinical-portal checks.
- Coordinate with the active thread-context prompt work by limiting the system-prompt change to the existing computer-use guidance line.

## Root cause

- The signed-in-retailer rule added on 2026-07-02 remained present and deployed, but the surrounding priority order treated an authenticated brand site or prior direct order as an undifferentiated existing relationship. That ambiguity allowed product provenance to be interpreted as storefront preference. The fix makes product evidence and storefront choice distinct.

## Tasks

1. Reconstruct the reported production path and trace the relevant prompt/skill history.
2. Tighten the existing storefront decision rule without changing unrelated browser behavior.
3. Add focused regression proof for the stable prompt, skill, and playbook.
4. Run scoped verification and the required prompt review, then resolve findings.
5. Perform final local review, close the plan, create a scoped commit, and open a PR.

## Verification

- Focused prompt/skill regression tests passed: 76 tests across 2 files.
- Diff-scoped verification passed, including guards, affected package typechecks and tests, and Cloudflare verification.
- `git diff --check` and the final identifier-leak scan passed.
- The required prompt review found one wording ambiguity and one missing branch assertion; both were resolved. A fresh review against current official OpenAI GPT-5.6 guidance reported no findings.
- Residual risk: the behavior is covered by prompt/readback tests rather than a live browser-model evaluation.
Completed: 2026-07-10
