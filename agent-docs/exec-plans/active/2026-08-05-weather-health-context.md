Goal (incl. success criteria):
- Make Murph use current extreme temperature and outdoor air quality as health context in relevant direct conversations and existing proactive health analyses.
- Success means Murph reuses the current OpenWeather tools, changes advice only when conditions matter, and never sends proactive outreach for weather alone.

Constraints/Assumptions:
- Keep the change prompt-primary. Do not add a cron, persisted state, service, dependency, provider, or official-alert claim.
- Reuse the existing accountless current-weather, five-day forecast, geocoding, and current outdoor-air-quality tools.
- Preserve city/region privacy, provider-failure fallback, calibrated causal language, and the existing proactive send bar.

Key decisions:
- Put normal-conversation behavior in the existing direct connected-app guidance so the always-on prompt core does not grow.
- Put scheduled-analysis behavior in the shared proactive-health policy already used by the weekly digest, weekly insight, and monthly coach.
- Keep provider details in the connected-apps skill and keep official alerts explicitly unsupported.

State:
- In progress.

Done:
- Traced the OpenWeather allowlist, connected-apps skill, direct health reasoning prompt, managed health automations, and focused prompt tests.
- Confirmed scheduled turns receive the existing connected-app execution surface when hosted connected apps are available.
- Added the narrow prompt and skill changes with regression coverage for direct conversation, weekly digest, weekly insight, and monthly coach behavior.
- Passed 159 focused assistant-engine tests and the package typecheck.

Now:
- Review the final diff and prepare the exact pushed PR candidate.

Next:
- Complete the required prompt/product/coverage specialist review and exact-head CI gates, then close the plan.

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
- pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage <focused tests>
Status: active
Updated: 2026-08-05
