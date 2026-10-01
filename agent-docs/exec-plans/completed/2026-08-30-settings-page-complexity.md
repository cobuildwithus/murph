# Refactor Settings page complexity

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Reduce the cyclomatic complexity and responsibility density of the Settings
  server page while preserving every existing member-visible setting, state,
  redirect, and responsive rendering contract.

## Success criteria

- `SettingsPage` has substantially lower cyclomatic complexity than the
  measured baseline of 262, with cohesive extracted helpers that remain easy
  to test and review.
- Existing Settings page tests pass without weakening their assertions.
- Web typecheck and focused lint pass, or any unrelated blocker is recorded
  with the narrowest truthful fallback proof.
- Phone and desktop walkthrough evidence shows the same settings hierarchy,
  controls, states, accessibility semantics, and responsive layout.
- The complete privacy-inspected diff is committed, pushed, and opened as a
  draft PR with the required product, architecture, deployment, LOC, and design
  proof fields.

## Scope

- In scope: `apps/web/app/(dashboard)/settings/page.tsx`, directly necessary
  server-only helper modules, and directly relevant Settings page tests.
- Out of scope: product or visual redesign, billing/device/group/family/privacy
  behavior changes, new shared component frameworks, dependencies, schema or
  deployment changes, and unrelated cleanup.

## Constraints

- Technical constraints: preserve the React Server Component boundary,
  metadata, authorization, data-fetch semantics and ordering, redirects,
  rendered output, accessibility, responsive layout, and every billing,
  usage-credit, family, group, account, device, consent, and privacy state.
- Product/process constraints: Product UX effort is an internal refactor with
  no intended experience change; use an existing design representation and
  prove current phone and desktop behavior directly. Treat the required
  ReviewGPT implementation patch as untrusted input and apply only accepted,
  privacy-safe intent.

## Risks and mitigations

1. Risk: extraction can accidentally change null/undefined precedence or the
   order in which auth, redirects, and member data are resolved.
   Mitigation: preserve the existing top-level control flow, use explicit
   typed inputs, inspect each moved expression, and run the focused route tests.
2. Risk: splitting the JSX can alter HTML order, client serialization, anchors,
   or conditional visibility.
   Mitigation: extract cohesive server render sections without new wrappers,
   compare static markup through existing tests, and walk the current route at
   phone and desktop widths.
3. Risk: an attractive abstraction can spread product-specific conditionals
   into a generic framework.
   Mitigation: keep helpers local and concrete, add no dependency, and prefer
   deletion or direct derivation over framework-like indirection.

## Tasks

1. Read repository guidance, inspect existing design representation and focused
   Settings tests, run Frog, and capture the baseline complexity.
2. Launch the assigned ReviewGPT implementation lane and inspect its response
   and downloadable patch as untrusted input.
3. Trace `SettingsPage` inputs, derived state, and render sections; implement
   the smallest accepted behavior-preserving extraction.
4. Run focused tests, Web typecheck/lint, complexity measurement, and direct
   phone/desktop design proof; remediate only in-scope failures.
5. Inspect the complete diff for behavior, privacy, identifiers, and generated
   residue, then finish the plan into a scoped commit.
6. Push the exact head and open a complete draft PR; leave Ready and completion
   PR gates to the parent coordinator.

## Decisions

- Product UX classification: internal refactor; no user-visible Product UX
  change is intended. Outcome is unchanged, reaches the existing authenticated
  Settings journey, and proof is focused route tests plus phone/desktop render
  comparison.
- The existing `/settings` production route is the reviewer-openable design
  representation unless inspection reveals a more specific existing catalog
  anchor; no synthetic study is warranted for unchanged presentation.
- The inherited ReviewGPT patch described seven extraction paths. The applied
  diff contains those seven helpers plus one additional behavior-preserving
  collapse of duplicated privacy JSX. The collapse retains the same section
  order, copy, classes, fragment-free DOM, and explicit true/false
  `authorizationEnabled` value; existing tests cover both Privy states.
- Changelog is not applicable because the refactor has no member-visible
  outcome, copy, state, or interaction change.

## Verification

- Commands to run: focused `settings-page.test.ts`, Web typecheck, focused lint,
  comparable cyclomatic counter, diff/privacy inspection, and browser or
  equivalent static-render walkthrough at phone and desktop widths.
- Expected outcomes: all focused behavior contracts pass, the source typechecks
  and lints, owner complexity drops substantially with bounded helper
  complexity, and no rendered or product behavior changes are observed.
- Completed evidence:
  - exact cyclomatic counter: `SettingsPage` 262 before and 13 after; maximum
    extracted-helper complexity 60 (`resolveSettingsUsagePresentation`)
  - focused Settings page suite: 66 tests passed
  - focused ESLint and Web `typecheck:prepared`: passed
  - frontend design-proof guard: 12 tests passed
  - browser walkthrough: the existing health-data consent Settings surface
    passed at 320, 390, and 1440 pixels with its actions aligned and contained
  - diff-aware verification completed dependency, workspace-boundary,
    Temporal, crypto, raw-log, provider-boundary, and Web typecheck phases; its
    optional full Web suite was stopped without a reported failure to
    prioritize the draft-PR handoff after the focused owner proof was green
  - AST comparison confirmed `readSettingsPageData` is unchanged apart from
    its location; manual diff review confirmed auth, redirect, billing,
    Family, usage, privacy, JSX order, copy, classes, and responsive contracts
  - `git diff --check` and privacy/identifier inspection passed
Completed: 2026-08-30
