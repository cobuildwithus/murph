Goal (incl. success criteria):
Fix hosted users who signed up through `/join` but never saw the launch-required Murph legal consent, so Settings wearable connection shows an actionable consent step instead of only the API gate error.

Constraints/Assumptions:
Keep legal consent explicit and current-document-version based. Do not weaken device-sync consent gates or auto-grant consent silently.

Key decisions:
Use the existing `/api/legal/consent/status` and `/api/legal/consent/accept` routes from browser UI. Reuse the same launch consent component from `/join` and Settings.

State:
In progress.

Done:
Read routing, frontend, security, and legal-consent docs. Traced the failing error to device-sync connect consent gates.

Now:
Add a reusable launch consent UI and wire it into `/join` accessible stages plus Settings wearable error recovery.

Next:
Add focused tests, run verification, required audits, and commit if safe.

Open questions (UNCONFIRMED if needed):
Whether production has existing active members without `launch.required` grants because legal consent was added after the original `/join` flow.

Working set (files/ids/commands):
`apps/web/src/components/legal/**`; `apps/web/src/components/hosted-onboarding/**`; `apps/web/src/components/settings/**`; focused `apps/web/test/**`.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
