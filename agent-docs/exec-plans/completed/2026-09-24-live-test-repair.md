# Repair and simplify real-Codex live verification

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Goal

Make the retained real-Codex suite pass on GPT-6 Sol by correcting fixtures and actual defects, and deleting obsolete, brittle, or redundant proof. Preserve meaningful authority, privacy, health-context, mutation, recovery, and delivery checks. Do not make the runtime worse to satisfy incidental model-step or exact-prose assertions.

## Scope and evidence

Continue the owned `feat/sol-prompt-guidance` checkout from `32359a19530a`. Prior full-run evidence contains 380 journeys with 81 failures; sanitized local artifacts provide reproducible inventory and base comparisons. No PR or production mutation is requested.

The initial nutrition investigation found obsolete universal medical-history preflight expectations: current food-journal/card policy explicitly uses known-context suitability and canonical accepted goals. Preserve current exception and target-authority coverage while removing the retired policy fixture.

## Work

1. Classify each failing journey against current production contracts and deterministic coverage.
2. Fix synthetic fixture context, obsolete tool assumptions, and incidental prose/call assertions; remove duplicated or retired journeys with a recorded coverage owner.
3. Fix proven production defects at their existing owners if needed, with focused deterministic and live proof.
4. Run typecheck, relevant deterministic suites, then every retained real-codex-live journey using synthetic ports and local subscription on gpt-6-sol. Inspect remaining failures and iterate within scope.
5. Review privacy, diff, complexity and test-deletion coverage; record exact counts; finish with a scoped commit.

## Verification and decisions

### Removed coverage and current owners

- Retired universal nutrition condition-preflight live case: current food-journal/card policy uses known suitability and canonical accepted targets. Retained live cases cover no goals, legacy rolling means, date windows, conflicting targets, incompatible units, known kidney constraints, and target updates. Query/CLI contracts own metric normalization. Removed obsolete fixture branches and converted the remaining live-steer scenario to the real CLI.
- Mandatory moved-capability skill-read case: it asserted an incidental read before each tool. Retained composed browser, phone, connected-app, and Family journeys prove the actions; skill routing/assets have deterministic contracts.
- Generic native access repost case: its fake current-group result lacked scoped offer authority. Retained scoped permission recovery cases check the accepted message ref, exact requested scope, one offer, and unavailable/already-granted boundaries.
- Strict meal import typo fake: it reimplemented CLI validation without the actual schema/hints/global flags. Real CLI meal validation and the retained typed-argument recovery journey prove validation, correction, and a single persisted meal.
- Multi-stage exact onboarding policy-read sequence: it duplicated deterministic policy routing and individual onboarding journeys, and tied later stages to exact conversational wording. Retained first-reply, source-awareness, deferred connection, email continuation, and recovery journeys exercise their user-visible boundaries.

- Sparse managed group email: this build explicitly excludes newsletter composition/delivery. Kept canonical group-email authorization and label-batching tests in `assistant-codex-group-tool.test.ts`, plus retained shared-row live reports.
- Synthetic three-read proactive-progress case: obsolete exact early-update requirement for a quick bounded read. Retained multi-automation edit progress and browser continuation journeys exercise supported delivery.
- Prose-only weekly Journal insight: a fake CLI returned the same summary from unrelated reads rather than canonical evidence. Retained canonical Journal capture/reconciliation and Personal Patterns evidence journeys; causal language is owned by managed-automation contracts.
- Two synthetic feedback cases (ordinary schema-probe silence, direct callback failure): redundant with deterministic feedback result/retry contracts, retained corrected support and terminal second-rejection live cases, and the private/group escalation privacy journey. Avoid enforcing incidental fallback wording.

- Expanded connected-record command-spelling matrix: its fake CLI returned the same observation payload for arbitrary queries, so it did not prove canonical routing. Query tests own actual connected-metric aliases and insulin observation semantics; retained live health, Journal, nutrition, and wearable journeys cover grounded interpretation. Removed the permissive fake instead of accepting invented metric aliases.

### Repairs

- Supply the real vault root to workout card tools, use complete production skill assets, and derive the workout command contract from the built CLI.
- Keep browser/quote expiry live, align reminder clocks, advertise available capabilities, and build email scenarios with email instructions.
- The composed Goal test now accepts explicit member-selected support dates and verifies all four canonical schedules, removing its fragile prose-date parser.
- Count successful canonical mutation metadata and inspect persisted state instead of counting failed/help command attempts as writes. Preserve exact side-effect authority and duplicate-write checks.
- Accept semantically equivalent replies, truthful negation, supported read aliases, and harmless read-only/help calls. Preserve forbidden affirmative claims and canonical effects.
- Resident feedback guidance reiterates abstraction of private health and family details; the explicit support privacy journey still forbids those details.
- CLI and resident workout guidance now explicitly applies saved duration defaults without repeated confirmation and restores scoped saved every-set repetition instructions before logging, while preserving an explicit cleared value.

### Verification

- Full live invocation completed every one of its 376 selected cases: 328 passed and 48 failed. Original evidence is preserved. After justified deletions there are 369 retained live cases; all 369 have passing latest results in the retained-name ledger, combining that full invocation with focused replays. There are no unattempted retained cases or unresolved latest failures. This is not a single green full invocation.
- Deterministic live harness: 60 passed, 369 live cases skipped with the live opt-in disabled.
- CLI workout, live workout, and strict meal validation: 37 passed.
- Prompt/feedback contracts: 121 passed; assistant prompt/skill/workout/delivery contracts: 65 passed, 7 existing skips.
- Deterministic group/device/hosted-domain coverage owners: 164 passed. Canonical nutrition queries: 21 passed. Connected metric and insulin observation queries: 10 passed.
- Engine, CLI, and Web typechecks passed; CLI build passed. The commit hook regenerated the CLI skill hash for the changed hints; the reviewed generated hash is included explicitly in the scoped commit.
- Changelog generation passed. Changelog page and fragment tests: 17 passed from the root Vitest invocation.
- Complete synthetic first-provider-input capture: 2 passed. Normalizing temporary paths, installation identifiers, and the runtime date, direct input is 151,278 to 151,865 UTF-8 bytes (+587, +0.3880%); group is 127,977 to 128,303 (+326, +0.2547%). Only the developer-instruction item changes. This existing representative fixture omits the generated CLI contract and uses the scripted provider; CLI hint rendering is verified separately. Exact Sol token counts remain unavailable because the checkout has no exact Sol tokenizer; synthetic usage is not a token measurement.
- Complexity guard passed. Existing source hotspots are unchanged: `buildStableRouteCapabilityPrompt` (28), `buildAssistantHostedGroupGuidanceText` (25), `parseInitialExercise` (25), and `buildWorkoutFormatPayloadFromOptions` (27). Only guidance strings changed in these source owners; further refactoring would be unrelated scope.
- Parent reviewed the complete source/test diff, all deletions and remaining coverage owners, canonical mutation assertions, authority/privacy boundaries, and public-safe changelog. Authored-text privacy scan and diff whitespace check passed.

Commands and sanitized raw evidence are retained locally in `.artifacts/live-test-repair/`: the full and focused runners use `MURPH_RUN_REAL_CODEX_E2E=1`, subscription auth, `gpt-6-sol`, and the `real-codex-live` tag. The retained inventory and per-case ledger preserve exact names and original failures. Deterministic checks use focused package Vitest invocations, package typecheck scripts, CLI build, and `pnpm complexity:diff`.

### Review

ReviewGPT thread: https://chatgpt.com/c/6ab46ed6-09c0-83ea-8d75-262628d99823

- Initial cleanup and CLI hint review: PASS.
- Expanded candidate review: two accepted test-only findings. Under the repository's Non-Production Remediation rule, reused the existing syntax mutation observer for CAPTCHA inspection and deleted the fragile Goal prose-date parser. The Goal journey instead verifies explicit member-selected dates against all four canonical schedules. No production change was part of that remediation.
- Resolution review: PASS; both accepted findings resolved, no further correction required in scope. The reviewer did not execute tests; local CAPTCHA and composed Goal replays subsequently passed.
- Final parent check retained consent and action boundaries while accepting equivalent non-retention wording in the check-in reply. Memory-read ordering is now checked before saved-birth-date disclosure, allowing a valid pre-login read and harmless browser inspection. These isolated proof corrections do not require another substantive review.

### Product and completion

Member-visible scope is better use of saved workout duration/repetition instructions and privacy-safe support summaries. Changelog items: `2026-09-24/saved-workout-defaults` and `2026-09-24/private-support-summaries`; no PR exists, so source PR lists are empty. Existing changelog presentation is unchanged and has rendered-component coverage.

Product UX verdict: Ready for the saved-default and support-summary changes. Focused live evidence covers applying a saved duration without re-confirmation, overriding it with a newly stated duration, restoring only scoped repetition instructions, respecting cleared instructions, and excluding private health/family details from support. These edits add no foreground network calls, state owners, schemas, dependencies, runtime branches, or deployment boundaries. No production deployment was requested or performed.

Known developer friction reused existing live-fixture, mutation-counting, and semantic-assertion Frog records; no new distinct tooling defect or duplicate entry was introduced. Final login handoff replay passed after correcting wording and disclosure-order assertions; final engine typecheck passed. Parent completion review is clear. This plan closes with the scoped local commit; no PR, push, or deployment was requested.
Completed: 2026-09-24
