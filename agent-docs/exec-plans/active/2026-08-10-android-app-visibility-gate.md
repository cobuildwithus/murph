# Gate Android-only product surfaces

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Hide Mobvoi and every Android-app-dependent claim or link until the Android app ships.
- Keep one fail-closed environment switch that can reveal the complete journey later.
- Reduce the Mobvoi setup copy to the shortest useful instruction.

## Success criteria

- With the flag absent or disabled, Connect Devices, the design catalog, and assistant guidance expose no Android app, Google Play, Health Connect, Mobvoi, or TicWatch journey introduced by this PR.
- With the flag enabled, the Mobvoi card uses the official rounded logo and one short setup line with the Android handoff.
- The shared flag parser accepts only the explicit enabled value and defaults off.
- Focused tests, responsive browser proof, required review, and exact-head CI pass.

## Scope

- Shared hosted environment parsing.
- Hosted Web Connect Devices and design-catalog presentation.
- Direct-assistant relay guidance and link-truthfulness boundary.
- Focused tests and deploy-contract documentation.

## Constraints

- Do not add a backend Mobvoi provider or infer a Mobvoi connection from Health Connect data.
- Keep the flag server-side and default-disabled.
- Preserve Apple Health and all existing direct device connections.

## Tasks

1. Add one shared fail-closed Android availability flag.
2. Gate Web, design-catalog, and assistant Android surfaces from that flag.
3. Replace the Mobvoi instruction wall with one short sentence.
4. Add disabled/enabled coverage and responsive proof.
5. Document the deploy contract, review the exact candidate, and complete PR gates.

## Evidence

- The shared parser and runner projection accept only the exact enabled value.
- Cloudflare deploy config preserves that exact-value rule before Wrangler output;
  generic optional-var whitespace normalization cannot activate the flag.
- The trusted per-invocation platform projection carries the flag into the
  assistant turn; forwarded and member-provided env cannot enable or override it.
- Default Web and assistant tests prove the Android-only journey is absent.
- Enabled tests prove the Mobvoi card, Play link, concise guidance, and prompt route return together.
- Focused Web, assistant-engine, hosted-execution, and Cloudflare suites pass.
- All four affected package typechecks and focused Web lint pass.
- Chromium mobile and desktop design studies pass with no horizontal overflow and the official rounded logo.

## Pending completion

- Push the exact candidate head and refresh the PR description.
- Complete the available exact-head review and GitHub Actions gates.
