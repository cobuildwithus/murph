Goal (incl. success criteria):
- Give Murph one concise skill for explaining, verifying, and using automatic iPhone meal capture.
- Success means the skill accurately covers setup, Photos permissions, best-effort background behavior, the canonical imported meal shape, short import races, and calorie-aware photo enrichment without creating duplicate meals.

Constraints/Assumptions:
- Keep canonical meal capture and retrospective analysis owned by the existing food-journal skill and meal records.
- Treat the imported photo-only meal as the record to enrich; never create a second meal for the same captured photo.
- Preserve the original photo capture timestamp for breakfast/lunch/dinner context.
- Do not imply guaranteed background execution or historical photo scanning.
- Keep app requirements aligned with the companion-app and background-meal-capture specs.

Key decisions:
- Add a dedicated `automatic-meal-capture` assistant skill and register it in the compact skill router.
- Use `vault-cli meal list`, `meal show`, and `meal edit` for verification and enrichment.
- When calorie or macro tracking is an explicit focus, always co-load this skill with `food-journal` on eligible interactive nutrition turns, inspect recent unresolved device meal photos, and enrich the existing meal with evidence-dependent provenance and honest uncertainty.
- Keep import deterministic and silent: a photo import does not start a model turn, so nutrition enrichment happens on the next eligible interactive turn rather than being falsely promised at upload time.
- If a just-sent photo is not visible yet, re-check once, then report it as pending; request a resend only after later evidence shows the upload failed, never from back-to-back reads.

State:
- In progress.

Done:
- Traced the iOS capture, hosted import, original capture-time, and canonical meal-edit paths.
- Confirmed that hosted import already creates an idempotent photo-only meal and that `meal edit` can add ingredients and nutrition to it.
- Created and registered the skill with focused router and contract tests.
- Added the setup, bounded local-review, best-effort background, import-race, same-occasion duplicate, timezone, credential-renewal, and calorie-tracking guidance.
- Passed skill validation, assistant-engine typecheck, and 38 focused skill/router/food-journal/nutrition tests.
- Ran the scoped workspace verification: dependency, boundary, safety-log, and affected typechecks passed; the broad affected-test lane was blocked by unrelated experiment-journal failures plus a Vitest worker out-of-memory crash in unchanged runtime tests.
- Completed an independent prompt review and remediation verification; resolved all seven original findings plus the follow-up duplicate-resend finding.

Now:
- Close the execution plan and create the scoped commit.

Next:
- Finish the plan, create the scoped commit, push, and open the prompt-primary PR.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/skills/automatic-meal-capture/SKILL.md
- packages/assistant-engine/src/assistant-skill-assets.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-engine/test/assistant-automatic-meal-capture-skill.test.ts
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
- pnpm test:diff packages/assistant-engine/skills/automatic-meal-capture/SKILL.md packages/assistant-engine/src/assistant-skill-assets.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/assistant-automatic-meal-capture-skill.test.ts
Status: completed
Updated: 2026-07-18
Completed: 2026-07-18
