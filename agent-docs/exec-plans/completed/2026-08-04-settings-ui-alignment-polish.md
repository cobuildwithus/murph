Goal (incl. success criteria):
- Replace the indirect assistant-provider summary with direct provider-specific copy: `Inference on OpenAI`, `Inference on Venice`, or `Inference on your endpoint`.
- Clean up the provider summary hierarchy and left-align the export-ready and paused health-data states with consistent vertical spacing at desktop and mobile widths.
- Success means the real production components and design-catalog studies render the requested hierarchy, focused component tests and typecheck pass, and desktop/mobile catalog captures remain legible.

Constraints/Assumptions:
- Reuse the existing settings, data-export, health-consent, button, and design-catalog components; add no dependency or abstraction.
- Preserve current actions, state transitions, accessibility, feature flags, and network behavior.
- Keep synthetic catalog studies inert and free of real requests.

Key decisions:
- Treat the provider identity as the summary headline and keep custom endpoint metadata subordinate.
- Use one left-aligned content column for confirmation and paused states instead of split icon/content geometry.
- Limit the change to presentation and the requested semantic copy; do not alter settings persistence or privacy behavior.

State:
- Complete. The implementation, design proof, focused local verification, and exact-head CI are green; no further ReviewGPT runs will be sent per the user's explicit instruction.

Done:
- Confirmed the existing custom-inference, export, and health-consent studies and reviewed the supplied desktop states.
- Loaded the frontend, product, design, verification, completion, and worktree-development guidance.
- Replaced the provider summary and related settings announcements with direct inference labels for OpenAI, Venice, and the member endpoint.
- Moved endpoint metadata into a subordinate line, gave Change a 40px hit target, normalized export-dialog spacing inside the reusable production content, and regrouped paused health-data copy into one left-aligned column.
- Updated the real design studies with stable proof selectors and captured synthetic desktop/mobile states for all three provider labels, export ready, and processing paused.
- Passed 69 focused component/design tests, hosted Web typecheck, scoped ESLint, the frontend design-proof tests, and native-resolution visual inspection.
- Confirmed the first remote design-proof failure was metadata-only: the guard requires a top-level catalog registry diff and a `Design page:` list item containing a visible `/design?tab=…` route. Registered the revised headings in both catalog owners; no production behavior changed.
- Opened draft PR #1292 with hosted desktop/mobile proof for OpenAI, Venice, custom endpoint, export ready, and processing paused.
- Passed the exact-head GitHub Actions surface: 13 successful checks, including frontend design proof, release build/typecheck, app verification, package coverage, host matrices, repository hygiene, and viewport overflow.
- Stopped the in-progress preliminary ReviewGPT retry and sent no further reviews after the user's explicit request. The separate automated UI reviewer was unavailable due to exhausted reviewer credits; local native-resolution inspection remains the direct visual proof.

Now:
- Archive this plan through the final scoped commit path and hand off the live catalog and PR.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None blocking; the user explicitly supplied the desired provider-label pattern and alignment direction.

Working set (files/ids/commands):
- apps/web/src/components/settings/hosted-assistant-model-settings.tsx
- apps/web/src/components/settings/hosted-data-privacy-settings.tsx
- apps/web/src/components/settings/hosted-health-data-consent-settings.tsx
- apps/web/app/design/components-content.tsx
- apps/web/app/design/settings-custom-inference-study.tsx
- apps/web/app/design/data-export-study.tsx
- apps/web/app/design/health-data-consent-study.tsx
- apps/web/test/hosted-assistant-model-settings.test.tsx
- apps/web/test/hosted-data-privacy-settings.test.tsx
- apps/web/test/hosted-health-data-consent-settings.test.tsx
- pnpm test:frontend-design-proof
- pnpm --dir apps/web typecheck
Status: completed
Updated: 2026-08-04
Completed: 2026-08-04
