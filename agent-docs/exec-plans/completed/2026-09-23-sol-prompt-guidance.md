# Align Murph prompting with GPT-6 family guidance

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Goal and protected invariants

Improve completion of concrete requests and concise replies on GPT-6 Sol without widening consent, health safety, private/group access, or external-effect authority.

## Owner and evidence

The existing system-prompt builder owns delegated initiative and product writing guidance. Its initiative paragraph addresses explicit delegation but does not distinguish ordinary action phrasing from capability questions or explain optional skill guidance versus mandatory gates. Revise that owner; add no runtime, routing, state, or model-selection machinery.

Official source: https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices (retrieved 2026-09-23). This is family-wide starting guidance based on Astra observations, not a separate Sol-specific behavioral guarantee. Evaluate on gpt-6-sol.

## Product UX plan

Outcome: answer concrete requests completely using known context; make necessary blockers clear and specific.
Reaches: direct and group conversations on the existing prompt paths, with existing silence, consent, and health rules retained.
Proof: assembled prompt contracts; real-model action-versus-capability and blocked-booking journeys; every real-codex-live test requested by the task.

## Scope and decisions

- Update existing initiative and prose guidance only, plus focused proof.
- Preserve model defaults, tool contracts, mandatory skill routes, and notification/maintenance prompts.
- No persistence or deploy protocol changes; existing prompt fingerprinting owns thread refresh.
- User requested ReviewGPT collaboration and the full live suite; the single-journey wrapper guard remains unchanged. Use the existing lower-level opt-in test lane for the authorized full run.
- Use synthetic fixtures and local subscription authentication, never production credentials.

## Tasks

1. Update prompt and deterministic/live regression proof.
2. Run focused tests and assistant-engine typecheck.
3. Ask ReviewGPT to critique and refine the concrete candidate with attached source and tests; use a 240m wait.
4. Apply supported feedback and run all real-codex-live tests on gpt-6-sol; diagnose failures against the base when necessary.
5. Review privacy and final diff, record results, close plan and create a scoped commit.

## Verification

- Workspace package build and final assistant-engine build passed. Final assistant-engine typecheck passed.
- Final deterministic command: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-real-e2e.test.ts test/model-behavior.test.ts test/system-prompt.dynamic-context.test.ts test/system-prompt.reply-bubbles.test.ts test/system-prompt.health-record-ingestion.test.ts test/system-prompt.durable-media-capture.test.ts test/appointment-reminder-system-prompt.test.ts`: **189 passed**, 380 intentionally skipped in the opt-in live lane.
- `pnpm complexity:diff` passed. The text-only production edit adds no complexity; existing route-builder hotspots (28 and 25) remain unchanged.
- Both existing prompt-size ceilings pass without raising budgets. Full normalized first-provider-input captures passed for identical direct/group fixtures at base and candidate. Direct: 151,776 to 151,888 UTF-8 bytes (+112, +0.0738%); group: 128,475 to 128,587 (+112, +0.0872%). All other provider fields match after normalizing temporary paths and installation identifiers. Tool definitions are unchanged. Exact Sol token counts are unavailable because this checkout has no exact Sol tokenizer; synthetic usage is not a token measurement.
- Local subscription only. Default and several alternate subscriptions failed before provider actions; stopped rotation at the first usable subscription and used it for all comparisons. No provider credentials or production data were read.

### ReviewGPT collaboration

Two same-thread GPT-6 Pro responses reviewed the candidate and full prompt/skill context. Thread: https://chatgpt.com/c/6ab46ed6-09c0-83ea-8d75-262628d99823.

Applied the conditional final-question correction, a real invitation-deliverable assertion, and a new mandatory marketing-consent journey. The second response requested no further production-prompt edit and found two proof issues: a blanket invitation-question rejection and an observer that missed `setChecked(true)` while rejecting read-only `evaluate`. Both are fixed. The observer uses the existing Babel parser without executing model-supplied code; nine deterministic cases distinguish checkbox/DOM mutation from inspection, and a deterministic invitation case covers the reviewed ambiguity. Final focused Sol replays of both new journeys pass.

Both reviews used 240m waits. The second waited capture stalled after the response was complete; exact-thread export recovered the completed response, matching preceding user turn, and `gpt-6-pro` response metadata. Only the verified task-owned stalled CLI was stopped. The shared browser was retained.

Review scope includes the public fallback skills present in this checkout; six privately replaced group/music skills were not available and are not claimed reviewed.

### Full real-Codex suite

All **380 distinct tagged journeys** ran once on the final production prompt: **299 passed, 81 failed**. Four disjoint 95-case batches used the existing lower-level Vitest lane, with `MURPH_RUN_REAL_CODEX_E2E=1`, subscription auth, and `MURPH_REAL_CODEX_MODEL=gpt-6-sol`. The command was `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage --reporter=verbose test/assistant-codex-real-e2e.test.ts --tagsFilter real-codex-live`, partitioned by exact test names. The single-journey wrapper guard was not changed.

Compared every failing pre-existing journey with unchanged base `493286f287ed232af3a5204111eb0c203841bacd` in a separate managed checkout using the same subscription/model. Subsequent test-only repairs do not alter the production prompt exercised by the full suite.

- **65** first-pass failures also failed on the unchanged base at least once. These include missing workout-card vault context, existing browser recovery and experiment failures, and brittle text assertions. A shared failing test name alone is not treated as proof of identical behavior; mismatched failure points were inspected separately.
- **11** remaining failures passed on candidate rerun, including the corrected new invitation assertion. These are repeat observations, not a replacement green full-suite result.
- **5** persistently fail only on the candidate in these samples: private group-consent wording, the Garmin cutoff wording, Journal association wording, degraded Knowledge wording, and a speaker-label test that rejects the required group-skill read. Inspected results preserve the requested behavior; the assertions reject equivalent wording or an incidental tool step. Existing assertions were retained.
- Saved workout-default handling remains imperfect: the candidate confirms an already supplied duration unnecessarily; the base independently fails persisted duration. This is an unresolved quality limitation, not evidence of a clean live suite.
- The nutrition safety sequence failed at different points on base/candidate. Isolated complete, truncated, wrong-ID, and ambiguous condition-record replays all failed on both versions (4/4 each): both attached a card without the expected condition reads, including the three negative evidence cases. These synthetic results establish a baseline evidence gap and block clean safety sign-off; they do not by themselves establish the production cause. Temporary diagnostic test copies were removed after the comparisons.

Counts, sanitized synthetic logs, inventory, and exact-thread review metadata are retained locally under `.artifacts/sol-prompt/` and excluded from commits.

## Completion disposition

Product UX: **Hold for release**. The prompt edit and focused proof are complete, but the full live suite is not green. No major regression unique to this prompt edit has been established; the failing baseline and stochastic samples do not justify an unconditional regression sign-off.

This task creates a local scoped commit only; no PR, merge, deployment, or public release note is published. The member-visible change needs a changelog entry in any future release PR, alongside resolution or explicit disposition of the live-test gaps. Do not describe this prompt-only candidate as shipped.

Include the public-safe Frog entry for missing workout-card fixture context in the scoped commit. Other known assertion friction is covered by existing repository entries; avoid duplicate reports or unrelated broad test repairs.
Completed: 2026-09-23
