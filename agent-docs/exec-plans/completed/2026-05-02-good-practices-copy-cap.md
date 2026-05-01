# Experiment Good Practices Copy Cap

## Goal

Keep experiment-page Good Practices lists to no more than six short items, folding or removing excess items while preserving practical guidance.

## Scope

- Health Commons protocol `protocol.tips` copy that feeds experiment pages.
- Use simple, clean items under 20 words where touched.
- Preserve unrelated active Health Commons copy/research edits and generated artifacts.

## Files

- `packages/health-commons/content/protocols/added-sugar-reduction/no-added-sugar-diet.md`
- `packages/health-commons/content/protocols/pre-sleep-downshift-practices/pre-sleep-silent-meditation.md`
- `packages/health-commons/content/protocols/psyllium-husk/psyllium-husk-for-cholesterol.md`

## Verification

- Audit protocol `tips` counts and word counts after edits.
- `pnpm --filter @murphai/health-commons generate:check`
- Focused web/runtime tests if the generated projection changes require assertion updates.

## Outcomes

- Passed audit: every protocol `tips` list has 6 or fewer items, and every tip is 20 words or fewer.
- Passed: `pnpm --filter @murphai/health-commons generate:check`
- Passed: `pnpm typecheck`
- Passed: `git diff --check` for touched files.
- Blocked by unrelated active checkout state: `bash scripts/workspace-verify.sh test:diff <touched protocol files>` failed in `apps/cloudflare/test/node-runner-isolated.test.ts` because `HOSTED_WEB_BASE_URL` was missing from the isolated child env expectation. This task only changes Health Commons protocol tip copy.
- No scoped commit: touched protocol files already contain overlapping dirty edits from other active Health Commons rows, so staging would include unrelated copy/content changes.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
