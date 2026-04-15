# Reframe hosted onboarding warmup copy around Murph setup

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Replace developer-centric hosted onboarding warmup language with user-facing copy that explains Murph is setting up the user's encrypted vault and assistant, using the repo's product marketing voice.

## Success criteria

- Hosted onboarding states no longer mention Cloudflare or "hosted runtime" in user-facing warmup copy.
- Similar onboarding surfaces use aligned setup language instead of drifting variants.
- Updated copy reflects Murph's privacy and assistant positioning from `agent-docs/product-marketing-context.md`.
- Touched `apps/web` tests pass with the new wording.

## Scope

- In scope:
  - Hosted invite status subtitle copy.
  - Hosted invite active-state warmup banner copy.
  - Hosted invite success-screen warmup copy.
  - Related `apps/web` tests covering those surfaces.
- Out of scope:
  - Broader onboarding redesign or structural UI changes.
  - Non-onboarding marketing copy elsewhere in the app.

## Constraints

- Preserve existing onboarding state behavior and control flow.
- Keep the tone calm, privacy-forward, and non-technical.
- Preserve unrelated worktree edits.

## Risks and mitigations

1. Risk: Similar surfaces drift again with slightly different wording.
   Mitigation: Consolidate repeated warmup copy through shared helpers/constants where practical.

2. Risk: Marketing language becomes too vague about what is happening next.
   Mitigation: Keep one concrete expectation that Murph will text the user when setup finishes.

## Tasks

1. Identify the shared hosted-onboarding warmup copy surfaces.
2. Replace implementation-centric language with product-marketing-aligned setup copy.
3. Update tests for the changed wording.
4. Run required `apps/web` verification and audit passes.

## Decisions

- Consolidated the activation-pending onboarding copy into `apps/web/src/components/hosted-onboarding/join-invite-copy.ts` so the invite subtitle, warmup banner, and success screen stay aligned.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff apps/web`
- Expected outcomes:
  - Typecheck passes.
  - Diff-aware `apps/web` coverage passes for the onboarding copy changes.
- Outcomes:
  - `pnpm typecheck` passed.
  - `pnpm test:diff apps/web` passed.
  - Focused scenario proof passed via `pnpm --dir apps/web test -- --run apps/web/test/join-invite-client.test.ts apps/web/test/join-invite-success-client.test.ts`.
  - Required coverage-write audit found no worthwhile additional proof.
  - Final review audit found no issues in the narrowed onboarding diff.
Completed: 2026-04-13
