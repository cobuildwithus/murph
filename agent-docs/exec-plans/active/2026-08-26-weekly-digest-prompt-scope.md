# Remove weekly digest prompt override

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Make scheduled automations classified as `weekly_digest` follow their saved
  instructions without an engine-supplied digest override, while preserving
  compatibility with existing records and experiment consent checks.

## Product UX

- Outcome: A scheduled readout says what the member asked that automation to
  say, even when a legacy weekly-digest classification is present.
- Reaches: Existing scheduled private and group automation deliveries.
- Proof: A production-derived synthetic daily-readout journey delivers a daily
  readout and contains no weekly-recap framing.

## Success criteria

- `weekly_digest` adds no support-scope instructions to the provider prompt.
- `reminder`, `check_in`, and `review` retain their existing scoped guidance.
- Legacy `weekly_digest` records remain readable and retain their current
  plan-owner consent precondition.
- Deterministic composition coverage and one focused real-Codex journey pass.

## Scope

- In scope: scheduled-assistant prompt composition, focused deterministic and
  live-journey coverage, and member-visible changelog classification.
- Out of scope: removing the persisted enum value, migrating vault records,
  changing `supportSeriesId`, or redesigning the other support kinds.

## Constraints

- Technical constraints: preserve old-reader/new-reader compatibility and
  existing experiment authorization checks; avoid a new state owner or parser
  compatibility shim.
- Product/process constraints: use synthetic private-free fixtures and keep
  normal system safety, routing, delivery, and lifecycle instructions intact.

## Risks and mitigations

1. Risk: A legitimate weekly summary could expand beyond its saved purpose
   after losing the injected digest wording.
   Mitigation: Preserve the exact saved instructions as authority and prove a
   representative weekly prompt remains followed in deterministic and live
   coverage.
2. Risk: Removing the enum outright would make existing automation records
   unreadable or bypass consent checks.
   Mitigation: Keep `weekly_digest` as legacy consent metadata in this patch;
   remove only its provider-prompt behavior.

## Tasks

1. Change support-scope composition so `weekly_digest` produces no overlay.
2. Add focused regression coverage for the composed provider instructions.
3. Add and run one production-derived synthetic real-Codex journey.
4. Run focused tests and typecheck, inspect the Product UX result, and complete
   the repository PR/review workflow.

## Decisions

- Treat `weekly_digest` as compatibility and consent metadata only; it must not
  change the provider-visible task instructions.
- Preserve the other three support-scope overlays in this patch.

## Verification

- Commands to run: focused Assistant Engine Vitest composition tests, the
  selected `pnpm test:assistant:live` journey, package typecheck, and exact-head
  PR checks.
- Expected outcomes: the saved daily-readout prompt reaches the provider
  without weekly-digest override text, the synthetic reply is a concise daily
  readout, and existing scoped kinds remain unchanged.
