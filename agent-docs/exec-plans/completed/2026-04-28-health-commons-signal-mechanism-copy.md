# Add Health Commons protocol signal mechanism copy

Status: completed
Created: 2026-04-28
Updated: 2026-04-28

## Goal

Add protocol-owned expected-signal descriptions across Health Commons protocol pages so the experiment "What could change" cards explain the plausible mechanism behind each biomarker change in simple language.

## Success criteria

- Each committed protocol variant with a stable content page has `expectedSignalDescriptions` for the displayed biomarkers in its first test plan.
- Copy uses the simple-writing skill standard: ordinary words, short sentences, mechanism first, no filler, no lost evidence nuance.
- Protocol-specific copy stays on the protocol page; reusable biomarker summaries are not used for protocol-specific claims.
- Existing unrelated dirty Health Commons research edits are preserved and not committed accidentally.
- Health Commons generation, typecheck, and focused app coverage for expected signal descriptions pass.

## Scope

- In scope:
- `packages/health-commons/content/protocols/**/*.md` frontmatter `expectedSignalDescriptions`.
- Copy based on the existing Health Commons protocol, claim, source, and biomarker corpus in this checkout.
- Focused schema/app verification needed to prove the field still renders through experiment pages.
- Out of scope:
- New literature searches or external web research.
- Editing reusable biomarker summaries to carry protocol-specific copy.
- Regenerating and committing `packages/health-commons/generated/**` for this broad content sweep.
- Rewriting protocol bodies, source pages, evidence appraisals, or safety claims outside the new expected-signal field.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in protocol pages; commit only the new expected-signal field changes.
  - The untracked `post-meal-walking` protocol is owned by an active research landing row; do not commit it in this task.
  - Keep `expectedSignalDescriptions` keyed by biomarker key and matching the displayed primary/secondary biomarkers from the protocol test plan.
- Product/process constraints:
  - Compare interventions, not bodies.
  - Keep confidence honest. Mechanism copy may say "may" or "can" when evidence is mixed.
  - Avoid optimize/biohack/compliance language.

## Risks and mitigations

1. Risk: Broad copy edits blur protocol-specific evidence boundaries.
   Mitigation: Workers used local Health Commons page/source/claim context and parent review normalized copy back to protocol-specific mechanisms.
2. Risk: Dirty active Health Commons research edits get staged or overwritten.
   Mitigation: Staged only synthetic `expectedSignalDescriptions` hunks from tracked protocol pages, leaving unrelated source-key/body cleanup and untracked `post-meal-walking` content out of the commit.
3. Risk: Simple copy becomes too vague.
   Mitigation: Ran a custom content check that required short mechanism descriptions and rejected flagged generic or overly technical wording.

## Tasks

1. Built protocol inventory and batch assignments.
2. Spawned high-reasoning workers with disjoint protocol-file ownership.
3. Integrated worker edits and normalized YAML shape.
4. Regenerated local catalog, ran focused scans, and ran Health Commons/app checks.
5. Ran required final review, staged scoped hunks, and committed only the signal-description field changes.

## Decisions

- Use `expectedSignalDescriptions` on protocol pages as the source of experiment-card mechanism copy.
- Treat generated Health Commons catalog files as local build outputs for this broad content sweep.
- Cover primary and secondary biomarkers from the first test plan because those are the signals rendered by the experiment page; safety outcome keys remain safety/logging context.

## Verification

- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons generate:check`
- `pnpm --dir packages/health-commons typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/health-commons test:vitest` passed: 10 files, 35 tests.
- `pnpm --dir apps/web test -- health-commons-bryan-johnson-protocol.test.ts` passed: 173 files, 1110 tests.
- Custom TSX content check passed: 28 tracked protocol pages and 132 expected signal descriptions.
- `git diff --check` passed for touched content/app/contracts paths and the staged diff.
- Required `task-finish-review` audit found no findings.
