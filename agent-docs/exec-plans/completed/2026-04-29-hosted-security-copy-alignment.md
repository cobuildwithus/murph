# Align hosted security copy with privacy policy

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Align public Hosted Murph security/privacy copy with the privacy policy's stated hosted processing model: encrypted at rest, decrypted only when needed for requested hosted task execution, minimized operator access, and no zero-knowledge/operator-blind/end-to-end-encryption claim unless a feature expressly says so.

## Success criteria

- Security page and homepage security/privacy teaser no longer claim Murph could not access records between tasks.
- Any touched homepage FAQ data-access copy avoids "only you can access" language unless it is clearly limited to a local or expressly zero-knowledge feature.
- Stale-string searches confirm the removed hosted copy claims are gone from the touched public surfaces.
- Focused web tests/typecheck cover the changed static copy surface as far as the current dirty checkout allows.

## Scope

- In scope:
  - `apps/web/app/security/page.tsx`
  - `apps/web/src/components/homepage/security-teaser-section.tsx`
  - Existing homepage FAQ data-access copy only if needed to avoid leaving the same public claim live.
- Out of scope:
  - Runtime encryption architecture changes.
  - Legal policy rewrites or regenerated PDF policy artifacts.
  - Unrelated hosted onboarding, billing, Cloudflare, or Health Commons work.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in the current checkout.
  - Avoid widening component structure or visual design.
- Product/process constraints:
  - Keep copy direct, calm, and precise.
  - Do not introduce stronger security/privacy guarantees than the current hosted architecture and privacy policy support.

## Risks and mitigations

1. Risk: Public security copy still overstates hosted privacy posture.
   Mitigation: Search for stale claims and align wording to the existing privacy-policy boundary.
2. Risk: Overlapping dirty homepage FAQ edits make a scoped commit unsafe.
   Mitigation: If necessary, close the plan without committing and hand off the exact overlap.

## Tasks

1. Locate existing public security/privacy claims and directly related tests.
2. Replace overbroad hosted access claims with accurate encrypted-at-rest / short-lived-worker / minimized-access wording.
3. Run stale-string searches and focused web checks.
4. Run required security/privacy review and final completion review.

## Decisions

- Treat this as a public security/privacy-claim correction, not a runtime architecture change.
- Required audit findings were accepted and fixed locally:
  - Replaced remaining diagram/glyph absolutes such as "never copied" and "opened when you ask".
  - Replaced "only for request" language with policy-aligned task/security/incident/debugging/support processing language.
  - Qualified deletion as subject to limited retention.
  - Narrowed "every line" open-source language to Murph product/runtime code.
  - Narrowed AI-training copy to submitted health data and general-purpose model training with notice/consent caveat.

## Verification

- Commands to run:
  - `rg` stale-claim searches for the removed phrasing.
  - Focused apps/web tests for affected static copy/metadata where present.
  - `pnpm --dir apps/web typecheck` unless blocked by known unrelated dirty-tree failures.
- Expected outcomes:
  - No stale overbroad hosted access claim remains in the touched public copy.
  - Focused checks pass, or any unrelated pre-existing blocker is documented with the failing target.

Results:

- PASS: stale-claim `rg` search across `apps/web/app`, `apps/web/src/components`, and `apps/web/test`.
- PASS: `git diff --check -- apps/web/app/security/page.tsx apps/web/src/components/homepage/security-teaser-section.tsx apps/web/src/components/homepage/faq-section.tsx agent-docs/exec-plans/active/2026-04-29-hosted-security-copy-alignment.md`.
- PASS: `pnpm --dir apps/web exec eslint app/security/page.tsx src/components/homepage/security-teaser-section.tsx src/components/homepage/faq-section.tsx`.
- PASS: `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`.
- PASS: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage route-metadata-pages.test.ts`.
- BLOCKED unrelated before reaching this change: `pnpm --dir apps/web test -- route-metadata-pages.test.ts` and `pnpm --dir apps/web typecheck` because Health Commons generation currently fails on duplicate alias `positive affect` between `biomarker:mood-affect` and `biomarker:self-reported-mood`.
- Required audit subagents ran: `security-privacy-review`, `frontend-review`, and `task-finish-review`; all actionable findings were fixed before final checks.
Completed: 2026-04-29
