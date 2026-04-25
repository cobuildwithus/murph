# Promote complete Health Commons protocols to field-testing

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Promote complete Health Commons draft protocol pages to `field-testing` when they already have protocol, test plan, experiment-onboarding, research-landscape, and safety boundaries.
- Preserve incomplete, research-only, or actively-owned drafts until their current work lands.

## Success criteria

- Complete unclaimed protocol pages are updated from `draft` to `field-testing`.
- Whole-body photobiomodulation remains `draft` because it explicitly says it should not power Murph experiment creation.
- Active red-light-glasses and skin-PBM rows are not overwritten.
- Focused readback confirms final statuses.

## Scope

- In scope:
  - `packages/health-commons/content/protocols/consistent-wake-time/consistent-wake-time.md`
  - `packages/health-commons/content/protocols/creatine-supplementation/creatine-monohydrate.md`
  - `packages/health-commons/content/protocols/dry-sauna/bryan-johnson-blueprint.md`
  - `packages/health-commons/content/protocols/hyperbaric-oxygen-therapy/hyperbaric-oxygen-therapy.md`
  - `packages/health-commons/content/protocols/iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run.md`
- Out of scope:
  - Generated Health Commons catalog outputs.
  - `red-light-glasses-before-bed.md`, currently owned by an active research-landscape row.
  - `red-near-infrared-skin-texture-photoaging.md`, currently owned by an active skin-PBM biomarker row.
  - Whole-body PBM promotion, because its page says it is not onboarding-ready.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in the shared checkout.
  - Do not regenerate shared `packages/health-commons/generated/**` artifacts in this pass.
- Product/process constraints:
  - `field-testing` is a readiness/status label for cautious bounded experiments, not a promise of efficacy.
  - High-caution protocols must keep their clinician/safety gates intact.

## Risks and mitigations

1. Risk: Promoting high-caution pages could read as endorsement.
   Mitigation: Only promote pages that already contain explicit onboarding safety screens and stop/clinician guidance language.
2. Risk: Active Health Commons rows collide on shared files.
   Mitigation: Defer red-light glasses and skin PBM rather than editing actively owned files.

## Tasks

1. Update eligible statuses to `field-testing`. Done.
2. Read back final statuses. Done.
3. Run focused Health Commons typecheck/test where feasible. Done.

## Decisions

- Defer generated catalog updates to the active generated-artifact policy row.
- Defer red-light glasses and skin PBM until their active rows land.

## Verification

- Commands to run:
  - `pnpm --dir packages/health-commons typecheck`
  - `pnpm --dir packages/health-commons test`
  - `git diff --check -- <touched files>`
- Expected outcomes:
  - Focused typecheck/test pass or any unrelated blocker is named.
  - Status readback shows promoted files as `field-testing`.

Results:
- `pnpm --dir packages/health-commons typecheck` passed.
- `pnpm --dir packages/health-commons generate:check` passed.
- `git diff --check -- <touched files>` passed.
- `pnpm --dir packages/health-commons test` failed in `test/cli-coverage.test.ts` on the generated-artifact stale-output expectation resolving instead of rejecting; this is in the active generated-artifact policy lane, not the status-only content changes.
- Direct readback showed the five promoted protocols as `field-testing`; red-light glasses and skin PBM remained `draft` because active rows own those files, and whole-body PBM remained `draft` because the page explicitly says it is not onboarding-ready.
Completed: 2026-04-25
