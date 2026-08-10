# Keep app-absent iMessage card icons clean

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Remove the pillarboxed square App Store artwork from Linq's provider-static
  response-card chrome without changing the installed Messages extension's
  interactive rendering or the nutrition bitmap.

## Success criteria

- The Linq app-card request retains the shipping extension name, team id, and
  bundle id, but omits the optional App Store id.
- Contract tests fail if the optional App Store id returns.
- Installed-extension interaction, static image URLs, captions, fallback text,
  delivery ownership, and error handling remain unchanged.
- Focused operator-config tests and typecheck pass, exact-head review is clean,
  and required PR checks pass before merge.
- The runtime deploy completes before a real Mac/app-absent card retry.

## Scope

- In scope: the Linq response-card request, direct request-shape coverage, and
  durable response-card presentation contracts.
- Out of scope: the nutrition image renderer, iOS extension artwork, card
  schema, image route, delivery fallback, and unrelated message types.

## Constraints

- Technical constraints: `app_store_id` is optional in Linq; the extension
  identity remains the interactive rendering key.
- Product/process constraints: preserve the user-critical interactive card and
  ordinary text recovery; accept removal of the provider's static Get-app
  affordance so it cannot source the square fallback artwork.

## Risks and mitigations

1. Risk: removing the id could accidentally disable the installed extension.
   Mitigation: retain and test the exact team and bundle identity plus
   `interactive: true`; Linq documents those fields as the rendering key.
2. Risk: local tests cannot prove provider-owned Mac composition.
   Mitigation: keep the change to the documented optional field, deploy the
   exact reviewed head, then require a real app-absent Messages retry.

## Tasks

1. Remove the optional App Store id from the typed Linq request.
2. Update request-shape coverage and durable response-card contracts.
3. Run focused tests, typecheck, diff checks, and candidate review.
4. Push a PR, run specialist and final ReviewGPT concurrently with CI, and
   resolve any accepted findings.
5. Merge, deploy Cloudflare, and verify a new Mac/app-absent card.

## Decisions

- Keep `interactive: true`; an ordinary media attachment would remove the
  installed extension's useful interactive card.
- Do not change iOS assets. The production screenshot matches the app-absent
  static route, and the installed extension's opaque 4:3 icon assets are
  already correctly shaped.

## Verification

- Commands to run: focused operator-config response-card/runtime tests,
  operator-config typecheck, scoped lint/diff checks, exact-head ReviewGPT and
  CI, Cloudflare deployment smoke, then a physical Mac/app-absent retry.
- Expected outcomes: no `app_store_id` in the provider request; all automated
  checks pass; the new static card has no square-icon pillarboxing.
