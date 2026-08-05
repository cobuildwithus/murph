Goal (incl. success criteria):
- Make Murph use official local extreme-heat, extreme-cold, and outdoor-air-quality alerts as health context in relevant direct conversations and existing proactive health analyses.
- Success means Murph uses the provider's location-specific alert logic, never invents a threshold, and never sends proactive outreach for an alert alone.

Constraints/Assumptions:
- Use OpenWeather One Call 3 official alerts and the existing server-held API key. Do not call the live provider until its subscription is active.
- Do not deploy the direct or scheduled alert guidance until One Call 3 is active for the exact production key and a signed smoke read succeeds.
- Do not add a cron, persisted state, cache, dependency, provider, or Murph-defined weather threshold.
- Reuse the existing connected-app execution boundary and geocoding tool.
- Preserve city/region privacy, provider-failure fallback, calibrated causal language, and the existing proactive send bar.

Key decisions:
- Put normal-conversation behavior in the existing direct connected-app guidance so the always-on prompt core does not grow.
- Put scheduled-analysis behavior in the shared proactive-health policy already used by the weekly digest, weekly insight, and monthly coach.
- Add one fixed, bounded web-owned One Call read because Composio does not expose the official alert response.
- Return the provider's normalized alerts and let the existing prompt restrict health context to heat, cold, and outdoor air quality.

State:
- In progress.

Done:
- Traced the OpenWeather allowlist, connected-apps skill, direct health reasoning prompt, managed health automations, and focused prompt tests.
- Confirmed scheduled turns receive the existing connected-app execution surface when hosted connected apps are available.
- Added the fixed One Call alert read through the existing connected-app execution service.
- Added the narrow prompt and skill changes for direct conversation, weekly digest, weekly insight, and monthly coach behavior.
- Added mocked provider tests. No live One Call request is part of verification.
- Recorded One Call activation plus a successful signed smoke read as a deployment prerequisite.
- Kept the exact alert instruction out of the shared group-visible skill and preserved the existing group rejection boundary.
- Final ReviewGPT round 1 found the missing entitlement gate and the shared-skill group leak. Both findings were accepted and corrected without expanding the group allowlist.
- Activated One Call 3 with a 2,000-call daily account cap; the signed production-runtime smoke read remains a deployment check.
- Capped the normalized alert list at the existing assistant-result byte budget instead of rejecting an otherwise valid provider response.
- Made the optional alert read non-retryable across the prompt and tool-failure boundary while preserving the generic retry contract for other connected apps.
- Added a real-model journey covering a successful official heat alert, provider failure fallback, and alert-only scheduled suppression.
- Passed 201 focused tests, assistant and web typechecks, and the focused real-model journey.
- Final ReviewGPT round 2 found that the alert failure result still combined generic retry guidance with the alert-specific no-retry rule. The required retrospective chose a shrinking fix at the existing tool boundary.
- Removed the conflicting retry sentence for this route, preserved generic retry guidance elsewhere, and expanded the real-model journey to cover scheduled provider failure.

Now:
- Commit and push the round-2 remediation, then run final correction review.

Next:
- Reconcile the branch with `main`, confirm exact-head CI, run the signed production-runtime smoke read after the web route is deployed, then close the plan.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-engine/src/assistant/managed-automations.ts
- packages/assistant-engine/skills/connected-apps/SKILL.md
- packages/assistant-engine/test/model-behavior.test.ts
- packages/assistant-engine/test/connected-apps-prompt.test.ts
- packages/assistant-engine/test/managed-automations.test.ts
- packages/assistant-engine/test/managed-automations-core.test.ts
- apps/web/src/lib/connected-apps/openweather-alerts.ts
- apps/web/src/lib/connected-apps/service.ts
- apps/web/test/openweather-alerts.test.ts
- apps/web/test/connected-apps-service.test.ts
- pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage <focused tests>
Status: active
Updated: 2026-08-05
