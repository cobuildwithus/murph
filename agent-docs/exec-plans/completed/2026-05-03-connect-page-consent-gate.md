# Keep consent UI out of the connect page layout

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Keep `/connect` as a source-selection surface by moving connect-start consent recovery into an auth-dialog-style modal instead of rendering the legal consent card inline above the source grid.

## Success criteria

- `/connect` still starts configured provider connection flows when consent gates pass.
- If the server rejects connect start with `HOSTED_CONSENT_REQUIRED`, `/connect` opens a modal dialog that uses the same shell styling as `AuthDialog`.
- Accepting consent retries the originally selected source connection.
- The server-side launch and connected-health-source consent gates stay intact.

## Scope

- In scope:
  - `apps/web/app/(dashboard)/connect/connect-page-client.tsx`
  - `apps/web/test/connect-page.test.ts`
- Out of scope:
  - Changing legal consent scopes, consent persistence, or API gate semantics.
  - Changing the settings device-sync consent flow.

## Constraints

- Technical constraints:
  - Preserve the existing `POST /api/connect-sources/:sourceId/start` contract and safe redirect validation.
  - Avoid new persisted state.
- Product/process constraints:
  - Do not make legal consent part of the default `/connect` page layout.
  - Preserve unrelated dirty checkout work and active hosted-web rows.

## Risks and mitigations

1. Risk: Moving the retry card could accidentally bypass consent.
   Mitigation: Leave server-side `assertHostedLaunchRequiredConsentGranted` and `assertHostedConsentScopeGranted` unchanged.
2. Risk: The modal could drift from the auth dialog visual language.
   Mitigation: Reuse the existing `DialogContent` and header class pattern from `AuthDialog`.

## Tasks

1. Replace `/connect`'s inline `HostedLegalConsentCard` retry state with a modal dialog.
2. Add a focused client regression test for the `HOSTED_CONSENT_REQUIRED` dialog.
3. Run focused hosted-web verification and required audits.

## Decisions

- Keep consent enforcement server-side; this change only moves `/connect` consent recovery into a modal.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/connect-page.test.ts`
  - `pnpm typecheck`
  - `pnpm --dir apps/web exec eslint 'app/(dashboard)/connect/connect-page-client.tsx' test/connect-page.test.ts`
  - `git diff --check -- 'apps/web/app/(dashboard)/connect/connect-page-client.tsx' apps/web/test/connect-page.test.ts agent-docs/exec-plans/active/2026-05-03-connect-page-consent-gate.md`
- Broader repo checks blocked by unrelated pre-existing failures:
  - `pnpm --dir apps/web lint` fails on `apps/web/src/components/hosted-onboarding/auth-dialog.tsx` (`react-hooks/set-state-in-effect`) plus unrelated unused-variable warnings.
  - `bash scripts/workspace-verify.sh test:diff ...` reaches `apps/web verify`, where lint fails as above and `apps/web/test/experiment-page-projections.test.tsx` has an unrelated projection-copy assertion mismatch.
- Audits:
  - Security/privacy review: no findings.
  - Frontend review: no findings; browser visual pass not run because this modal path depends on authenticated hosted consent state.
  - Coverage/write review: no additional test edits needed.
  - Final task-finish review: no findings.
Completed: 2026-05-03
