# Add hosted loading boundaries and explicit ESLint setup for Next apps

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Add `loading.tsx` fallbacks for the hosted dynamic join/share routes and add explicit ESLint CLI setup for both Next apps, including the package metadata, lockfile, verify scripts, and durable verification docs needed to keep the repo consistent.

## Success criteria

- `apps/web/app/join/[inviteCode]/loading.tsx` and `apps/web/app/share/[shareCode]/loading.tsx` exist and provide route-appropriate loading UI.
- `apps/web` and `packages/local-web` each have explicit ESLint CLI setup with `eslint` and `eslint-config-next` in package metadata, an app-local flat config, and a `lint` script.
- The app-local verify scripts run lint before their heavier build/dev steps.
- The lockfile is updated consistently with public-registry dependency specs only.
- The verification/testing docs and app READMEs accurately describe the new lint step.
- Focused verification passes, or any unrelated blocker is documented clearly.

## Scope

- In scope:
  - Hosted join/share route loading fallbacks and any focused tests that directly prove them.
  - `apps/web` and `packages/local-web` ESLint setup, including dependency/lockfile updates and verify-script wiring.
  - Matching doc updates in the app READMEs plus verification/testing durable docs.
- Out of scope:
  - Broader repo-wide lint rollout outside these two Next apps.
  - Next dev/browser inspection work; the user explicitly asked not to run Next dev because of Turbopack cache memory blowups.
  - Unrelated hosted onboarding, device-sync, or Cloudflare edits already in the worktree.

## Constraints

- Preserve unrelated dirty-tree edits and use a path-scoped landing.
- Keep dependency changes limited to public-registry packages with a committed lockfile update.
- Do not run Next dev during verification for this task.

## Risks and mitigations

1. Risk: Dependency changes can widen the landing accidentally in a dirty tree.
   Mitigation: Keep the plan path-scoped, inspect the lockfile diff, and use the repo commit helper with exact paths.
2. Risk: Updating verify scripts without docs causes drift in repo verification guidance.
   Mitigation: Update `agent-docs/operations/verification-and-runtime.md`, `agent-docs/references/testing-ci-map.md`, and the affected app READMEs in the same turn.
3. Risk: Route loading fallbacks can drift from the current hosted visual language.
   Mitigation: Keep the loading UI simple and reuse existing page tones/layout rather than inventing new UI patterns.

## Tasks

1. Register the lane and inspect current package scripts, route files, and verification docs.
2. Add hosted join/share loading fallbacks and any focused tests needed for direct proof.
3. Install ESLint CLI plus `eslint-config-next` in both Next apps, add flat configs and lint scripts, and wire lint into app verify scripts.
4. Update durable docs and app READMEs to match the new verification/lint behavior.
5. Run scoped verification for the touched surfaces and finish with the scoped commit helper.

## Decisions

- This is plan-bearing because it changes dependency state, app verification surfaces, and durable verification docs, even though the behavioral UI change is small.

## Verification

- Commands to run:
  - `pnpm --dir apps/web typecheck:prepared`
  - `pnpm --dir packages/local-web typecheck`
  - `pnpm --dir apps/web lint`
  - `pnpm --dir packages/local-web lint`
  - Focused Vitest commands for the touched hosted/local web tests
  - `pnpm deps:ignored-builds`
- Explicitly skip `next dev` inspection for this task per user instruction.
- Results:
  - `pnpm deps:ignored-builds` passed and still reports the pre-existing ignored-build list (`unrs-resolver`, `@reown/appkit`) without requiring any policy change.
  - `pnpm --dir packages/local-web typecheck` passed.
  - `pnpm --dir packages/local-web lint` passed with one pre-existing warning in `packages/local-web/postcss.config.mjs` for `import/no-anonymous-default-export`.
  - `pnpm exec vitest run --config packages/local-web/vitest.config.ts --project local-web --no-coverage packages/local-web/test/next-config.test.ts` passed.
  - `pnpm --dir apps/web typecheck:prepared` passed on the current branch.
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/next-config.test.ts apps/web/test/join-page.test.ts apps/web/test/join-invite-client.test.ts apps/web/test/settings-page.test.ts apps/web/test/share-link-client.test.ts apps/web/test/route-loading.test.tsx` passed.
  - `pnpm --dir apps/web lint` remains red on broad pre-existing hosted-web issues outside this landing, including existing `prefer-const` violations and many `@typescript-eslint/no-explicit-any` failures in unrelated hosted onboarding files/tests.
Completed: 2026-04-01
