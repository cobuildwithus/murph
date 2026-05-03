# Remove connected-source consent gate

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Stop asking members to accept a separate `feature.connected-health-source` consent before starting a wearable/source connection when current launch legal and health-data consent is already granted.

## Success criteria

- Device/source connect-start routes require current launch consent only.
- `/connect` and settings consent recovery no longer request the connected-source feature scope.
- The hosted consent registry can keep optional feature consent support for other scopes without treating connected sources as a required separate grant.
- Focused tests prove the removed gate and preserve launch-consent enforcement.

## Scope

- In scope:
  - `apps/web/src/lib/device-sync/hosted-connect-start.ts`
  - `/connect` and settings connected-source consent recovery UI only where directly coupled
  - Focused hosted-web consent/device-sync tests
  - `docs/legal-consent-implementation.md`
- Out of scope:
  - Changing launch-required consent storage or `/join` consent writes
  - Auto-granting historical optional feature consent rows
  - Changing provider OAuth, token storage, or device-sync authority

## Constraints

- Preserve server-side launch-required consent as the processing boundary.
- Do not add persisted state.
- Preserve unrelated dirty work in hosted auth, onboarding, sidebar, browser-vault, and pricing files.

## Risks and mitigations

1. Risk: Removing the feature gate could accidentally remove launch consent enforcement.
   Mitigation: Keep `assertHostedLaunchRequiredConsentGranted` in the shared connect-start helper and add/update focused route assertions.
2. Risk: Existing modal recovery could continue asking for the feature scope after a launch-consent failure.
   Mitigation: Default recovery cards to launch consent in connect/settings surfaces.

## Tasks

1. Register the active row and inspect overlapping diffs.
2. Remove the `feature.connected-health-source` assertion from connect-start.
3. Update connect/settings recovery UI and focused tests.
4. Update legal-consent implementation docs.
5. Run focused verification, required audits, and scoped commit.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-settings-routes.test.ts apps/web/test/connect-page.test.ts apps/web/test/hosted-device-sync-settings-client.test.tsx`
  - `pnpm --dir apps/web exec eslint 'src/lib/device-sync/hosted-connect-start.ts' 'app/(dashboard)/connect/connect-page-client.tsx' 'src/components/settings/hosted-device-sync-settings-client.tsx' 'test/device-sync-settings-routes.test.ts' 'test/connect-page.test.ts' 'test/hosted-device-sync-settings-client.test.tsx'`
  - `git diff --check -- apps/web/src/lib/device-sync/hosted-connect-start.ts 'apps/web/app/(dashboard)/connect/connect-page-client.tsx' apps/web/src/components/settings/hosted-device-sync-settings-client.tsx apps/web/test/device-sync-settings-routes.test.ts apps/web/test/connect-page.test.ts apps/web/test/hosted-device-sync-settings-client.test.tsx docs/legal-consent-implementation.md agent-docs/exec-plans/active/2026-05-03-remove-connected-source-consent-gate.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/device-sync/hosted-connect-start.ts 'apps/web/app/(dashboard)/connect/connect-page-client.tsx' apps/web/src/components/settings/hosted-device-sync-settings-client.tsx apps/web/test/device-sync-settings-routes.test.ts apps/web/test/connect-page.test.ts apps/web/test/hosted-device-sync-settings-client.test.tsx docs/legal-consent-implementation.md`
- Audits:
  - Security/privacy review: no findings.
  - Frontend review: found launch-consent fallback copy/context mismatch; fixed by retitling the `/connect` dialog and surfacing settings consent failures as a normal error instead of an inline feature-consent card.
  - Coverage/write review: added focused settings recovery test.
  - Final review: no findings.
Completed: 2026-05-03
