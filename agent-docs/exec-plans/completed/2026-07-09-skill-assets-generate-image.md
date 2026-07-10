# Allow package skill assets as generate_image references

Status: completed
Created: 2026-07-09
Updated: 2026-07-09

## Goal

- Allow the hosted/local `generate_image` resolver to accept Murph-owned package skill assets as ordered reference images, specifically `skill-assets/murph-character-sheet-v1.png`, without weakening the existing vault raw-image guardrail.

## Success criteria

- The canonical Murph character sheet is shipped under `packages/assistant-engine/skills/shared/`.
- `resolveGenerateImageReferences` accepts `skill-assets/**` under `<skillsRoot>/shared/`, preserves mixed input order, keeps size/sniffing caps, excludes skill assets from vault materialization, and keeps vault behavior unchanged.
- `generate_image` passes the resolved assistant skills root to the resolver, and dynamic tool descriptions tell the model to use the canonical Murph character sheet when Murph appears.
- Focused assistant-engine tests cover the new reference family and existing guardrails.
- Required verification and audit passes complete or any unrelated blockers are reported precisely.

## Scope

- In scope: `packages/assistant-engine` resolver/tool/schema text/tests plus the copied PNG under `skills/shared/`.
- Out of scope: editing any `packages/assistant-engine/skills/**/SKILL.md` prose; infra changes; broad dynamic-tool refactors.

## Constraints

- Technical constraints: keep `raw/inbox/**` and `raw/captures/**` behavior unchanged; no traversal/absolute/hidden path allowance; apply per-file/total size caps across both ref families; preserve input-order numbering.
- Product/process constraints: do not expose local identifiers; preserve unrelated dirty `packages/assistant-engine/skills/group-challenge/SKILL.md` edits.

## Risks and mitigations

1. Risk: A new reference prefix could bypass the existing vault misreference guardrail.
   Mitigation: Reuse existing ref normalization, hard-code `skill-assets/` to package `shared/`, and cover traversal/unknown-prefix failures in tests.
2. Risk: Mixed vault and skill refs could reorder `reference-image-N` names or materialize non-vault refs.
   Mitigation: Partition only for materializer input and resolve final outputs by original index, with mixed-order tests.

## Tasks

1. Inspect current resolver/tool/schema/test patterns.
2. Copy the tracked Murph character sheet into `skills/shared/`.
3. Extend resolver and generate-image tool root passing.
4. Update dynamic tool descriptions/schema help text.
5. Extend focused tests and run required verification/audits.

## Decisions

- Use `skill-assets/` as the only new public reference family, rooted at `resolveAssistantSkillsRoot()/shared`.

## Verification

- `pnpm exec vitest run test/image-reference-resolver.test.ts test/generate-image-tool.test.ts test/dynamic-tools-generate-image.test.ts test/assistant-skill-assets.test.ts --no-coverage` from `packages/assistant-engine`: passed, 4 files / 48 tests.
- `pnpm typecheck` from `packages/assistant-engine`: failed before this change's code path on existing `@murphai/operator-config/*` path-resolution errors. Trace shows NodeNext trying generic `packages/operator-config/src/*` substitutions without `.ts` extensions and failing to resolve existing source files such as `packages/operator-config/src/vault-cli-errors.ts`.
- Root `pnpm typecheck`: blocked before workspace checks by sandbox-inaccessible git-common lock directory; retrying with the lock sentinel reached `tsx` IPC pipe `EPERM` failures.
- Completion audits: security/privacy audit found no issues; coverage-write audit found no missing requested edge-case coverage and made no edits.
Completed: 2026-07-09
