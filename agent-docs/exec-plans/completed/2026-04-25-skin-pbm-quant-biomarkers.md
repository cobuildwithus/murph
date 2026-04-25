# Skin PBM Quant Biomarkers

## Goal

Ask Pro for a scoped patch that adds the next 2-3 highest-value, low-burden, more quantifiable skin biomarker measurements for the existing red/NIR skin photobiomodulation protocol, then land the reviewed patch locally.

Success criteria:

- Add biomarker pages that are feasible for an individual for less than $500 all-in upfront cost.
- Prefer scientific or quantifiable measurements over additional subjective scores.
- Hook accepted biomarkers into the existing skin PBM protocol as secondary outcomes.
- Preserve conservative evidence language, safety gates, and source traceability.

## Constraints

- Existing skin PBM biomarkers already cover standardized skin photo score, periocular wrinkle score, skin texture/roughness score, and skin/eye tolerability symptoms; do not duplicate them.
- Keep the patch scoped to authored Health Commons content unless generated outputs are explicitly safe to include.
- Do not touch unrelated dirty work or shared generated catalog outputs without coordination.
- Exclude clinic-only or professional-device measurements that normally exceed the <$500 self-experiment budget unless there is a credible consumer implementation and the limitations are explicit.

## Working Set

- `packages/health-commons/content/biomarkers/**`
- `packages/health-commons/content/protocols/skin-photobiomodulation/red-near-infrared-skin-texture-photoaging.md`
- `packages/health-commons/content/sources/**` only if Pro identifies a necessary missing source page.
- `packages/health-commons/generated/**` only as directly coupled verification output if safe to coordinate.

## Verification Plan

- `pnpm --filter @murphai/health-commons generate`
- `pnpm --filter @murphai/health-commons generate:check`
- `pnpm --filter @murphai/health-commons typecheck`
- `pnpm --filter @murphai/health-commons test`
- `pnpm --filter @murphai/health-commons verify`
- `git diff --check`

## State

- Pro returned `skin-pbm-quantitative-biomarkers.patch`; retained response and patch were inspected before applying.
- Patch applied cleanly to authored Health Commons content only.
- Added three low-cost quantitative/image-derived biomarker pages and wired them into the skin PBM protocol as optional secondary biomarkers.
- Security/privacy review found one low-severity minimization gap around identifiable face photos; added local/private storage, metadata stripping, and ROI/derived-value sharing guidance to the new biomarker pages.
- Final completion review found one low-severity onboarding logging gap; added the optional ROI/color/texture checkpoint fields to `experimentOnboarding.logging.sessionFields`.
- `pnpm --filter @murphai/health-commons generate` produced no tracked generated catalog diff.
- Completed green checks after the final review fix: `pnpm --filter @murphai/health-commons generate`, `generate:check`, `typecheck`, `test`, and `verify`.
- Completed local checks after the final review fix: touched-file whitespace/diff check and direct-identifier privacy scan.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
