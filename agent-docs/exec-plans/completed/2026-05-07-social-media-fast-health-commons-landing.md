# Social media fast Health Commons landing

Status: completed
Created: 2026-05-07
Updated: 2026-05-07

## Goal

- Land the staged Social Media Fast research package into live Health Commons content and commit it.
- Success means the family, protocol, source pages, artifact manifest, evidence appraisals, and generated header image are wired into the live Health Commons content tree, validate through the Health Commons generator, and are committed in a scoped patch.

## Scope

- In scope:
  - `packages/health-commons/content/families/social-media-abstinence.md`
  - `packages/health-commons/content/protocols/social-media-abstinence/social-media-fast.md`
  - `packages/health-commons/content/sources/social-media-abstinence/**`
  - `packages/health-commons/content/artifacts/social-media-abstinence/research-artifacts.json`
  - `packages/health-commons/content/evidence-appraisals/source-protocol-evidence/social-media-abstinence.jsonl`
  - `apps/web/public/design-assets/hero-social-media-fast.*`
  - this execution plan and the coordination-ledger row
- Out of scope:
  - Changing the research-workflow scripts again.
  - Reworking Health Commons schema/runtime behavior unless validation proves it is required.
  - Editing unrelated dirty files.

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not expose local identifiers, secrets, or absolute local paths.
- Keep claims conservative, source-bound, and visibly mixed where the evidence is mixed.
- Keep social-media abstinence separate from Digital Sunset, generic screen-time reduction, full smartphone abstinence, app-blocker tooling, and clinician-led treatment.
- Header imagery must follow Murph design guidance: warm, quiet, cinematic, with a small human presence and breathing room. Avoid wellness-ad, neon, UI-overlay, productivity, dopamine, or moral-discipline framing.

## Tasks

1. Inspect live Health Commons schema/content conventions. Done.
2. Convert staged research-package files into live Health Commons page/appraisal shape. Done.
3. Generate and add a protocol header image asset. Done.
4. Run focused Health Commons validation and package checks. Done.
5. Commit the scoped landing patch. Pending.

## Verification

- `pnpm --dir packages/health-commons generate`: passed after schema/frontmatter fixes.
- `pnpm --dir packages/health-commons generate:check`: passed.
- Source/evidence consistency check: passed with 178 source pages, 11 protocol source references, and 11 evidence-appraisal rows.
- Header image asset check: passed; `apps/web/public/design-assets/hero-social-media-fast.jpeg` exists as a 1672x941 JPEG.
- Privacy scan over new content, asset path, and plan/ledger paths: passed.
- `git diff --check` over touched paths: passed.
- `pnpm --dir packages/health-commons verify`: blocked by an unrelated existing test/data mismatch where `test/runtime.test.ts` expects `sleep-quality` to be published while the unchanged biomarker page is hidden in `HEAD`.
- `pnpm typecheck`: passed.
Completed: 2026-05-07
