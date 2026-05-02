# Five Protocol Research Groups

## Goal

Group the remaining Health Commons research artifacts for Cold Plunge, IT Band rehab, Caffeine Curfew, Daily Step Floor, and Bryan Johnson Sauna so the experiment research pages can render grouped study sections.

## Scope

- `packages/health-commons/content/protocols/cold-water-immersion/cold-plunge.md`
- `packages/health-commons/content/protocols/iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run.md`
- `packages/health-commons/content/protocols/caffeine-timing/caffeine-curfew-dose-reset.md`
- `packages/health-commons/content/protocols/daily-step-floor/daily-step-floor.md`
- `packages/health-commons/content/protocols/dry-sauna/bryan-johnson-blueprint.md`
- Matching `packages/health-commons/content/evidence-appraisals/source-protocol-evidence/*.jsonl` files only when required to repair group-id mismatches.

## Constraints

- Source-data fix only; do not change UI components or generated artifact files unless verification requires it.
- Keep grouping headers and summaries clean, human-readable, and non-placeholder.
- Preserve unrelated Health Commons, hosted-web, Cloudflare, and workflow dirty work.
- Use subagents with disjoint protocol ownership.

## Verification Target

- Each requested route exposes non-empty `researchGroups` in generated research JSON.
- Health Commons generation/checks pass, or unrelated blockers are recorded.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
