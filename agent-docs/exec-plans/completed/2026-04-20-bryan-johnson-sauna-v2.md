# Bryan Johnson sauna source-attributed routine update

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Replace the placeholder Bryan Johnson dry-sauna Health Commons page with a source-attributed routine update based on the returned ChatGPT patch, adapted to the repo's current `dry-sauna` family layout.

## Success criteria

- `packages/health-commons/content/protocols/dry-sauna/bryan-johnson-blueprint.md` no longer reads as a placeholder and instead captures the current source-attributed routine, chronology, and safety/test-plan structure.
- The relevant Health Commons change log and sauna disambiguation page reflect the more specific Bryan Johnson routine.
- New source pages added for the routine only include metadata/provenance and stay within the current Health Commons schema and rights posture.
- Health Commons generated artifacts regenerate cleanly and package verification passes.

## Scope

- In scope:
  - `packages/health-commons/content/protocols/dry-sauna/bryan-johnson-blueprint.md`
  - `packages/health-commons/content/protocols/sauna-protocol.md`
  - `packages/health-commons/content/changes/2026-04.jsonl`
  - new Bryan Johnson source pages under `packages/health-commons/content/sources/**`
  - regenerated `packages/health-commons/generated/**` artifacts if the builder updates them
- Out of scope:
  - Murph canonical dry-sauna protocol content beyond directly coupled references
  - broader Health Commons taxonomy/key renames
  - unrelated hosted-run or hosted-ingress work already active elsewhere in the repo

## Constraints

- Preserve the repo's current user-facing `dry-sauna` family key style instead of reviving the older `sauna/finnish-dry` path layout from the returned patch.
- Keep the Bryan Johnson page source-attributed and non-canonical.
- Do not add copyrighted full-text bodies or artifact uploads; source pages stay metadata-level with rights-safe summaries only.

## Risks and mitigations

1. Risk: the returned patch was authored against an older Health Commons path layout.
   Mitigation: map content onto the current `dry-sauna` files manually and regenerate outputs instead of applying the patch mechanically.
2. Risk: source-attributed claims may drift into Murph-canonical guidance language.
   Mitigation: keep attribution explicit, preserve `needs_review` quality where appropriate, and frame claims as source-reported/self-experiment findings.
3. Risk: generated artifacts or validators reject new source/person pages.
   Mitigation: inspect current schema usage before adding new pages and run package verification after regeneration.

## Tasks

1. Register this plan and a coordination-ledger row, then inspect the current Health Commons sauna files against the returned patch.
2. Adapt the returned Bryan Johnson sauna content to the current `dry-sauna` page layout and add the new source/source-person pages it requires.
3. Regenerate Health Commons artifacts, run truthful verification, and address any content/schema fallout.
4. Complete the required review/audit flow, commit the scoped change, and hand off outcomes plus any unrelated blockers.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm --dir packages/health-commons verify`
- Expected outcomes:
  - Repo typecheck stays green or any failure is clearly unrelated to the Health Commons content slice.
  - Health Commons typecheck, tests, and generated-catalog checks pass with the updated Bryan Johnson content.
Completed: 2026-04-20
