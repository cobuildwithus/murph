# Restore private Journal capture and truthful recovery

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Goal

- Restore automatic private Journal capture of clearly reported facts and truthful save/display explanations using existing canonical records.

## Success criteria

- A focused synthetic live Codex journey on gpt-5.6-terra proves capture without a logging command, exclusion of guessed causes, respect for no-retention requests, verified save answers, and truthful recovery.
- Deterministic tests cover composed instructions and any reproduced working-directory or projection defects; relevant typecheck passes.

## Scope

- In scope: private capture policy, canonical CLI targeting, save/readback and display explanations, and locally proven Journal display defects.
- Out of scope: production mutations, member messaging, model preference changes, speculative UI fixes, and copied private evidence.

## Constraints

- Technical constraints: retain event ownership in core and the query-owned Journal projection; add no store, capture service, dependency, or blanket retry loop.
- Product/process constraints: synthetic scenarios only; do not infer causes or require explicit logging for ordinary clear facts. Preserve group boundaries and explicit no-retention intent.

## Risks and mitigations

1. Risk: stochastic proof passes without reproducing a reported failure.
   Mitigation: distinguish baseline observations from proved regressions; use exact production builders and real canonical readback.
2. Risk: conflating canonical persistence with Browser Vault visibility.
   Mitigation: trace both owners and require evidence before claiming a refresh or a display cause.

## Tasks

1. Inspect capture, CLI working-directory, and Journal projection boundaries.
2. Add deterministic contracts and run a synthetic live Terra baseline before production edits.
3. Correct proved gaps at their smallest existing owners and rerun focused live scenarios.
4. Run focused tests/typecheck, inspect the complete diff, add a public-safe changelog, and commit.

## Decisions

- Product UX effort: Patch.
- Outcome: clear private facts survive the conversation; save and display claims match evidence.
- Reaches: private conversations with facts, uncertain causes, explicit no-save intent, missed saves, canonical saves absent from the current display, and corrections.
- Proof: production prompt composition, real CLI writes and query readback, synthetic live Terra replies, and focused recovery regressions.

## Verification

- Product UX: Ready. Reviewed synthetic replies and canonical state for automatic capture, missing-entry repair, existing-entry verification, launch failure, no-retention, and date/detail correction.
- Current main already includes automatic capture, English note quality, date/timing corrections, and Journal refresh-on-open from #2970. This patch addresses remaining recovery guidance; it does not replace those owners.
- Before edits, the current prompt captured the synthetic observation but suggested an unsupported all-day-note filter when asked about an empty page.
- A replay using the production prompt preceding #2970 and current CLI/runtime saved the observation plus a speculative explanation, then invented legacy Journal-day linking as a visibility repair. The new regression failed because two facts existed instead of one. That run did not reproduce the original omitted-save behavior; this is historical-prompt evidence, not a replay of a complete historical deployment.
- After edits, five focused real Codex journeys passed on `gpt-5.6-terra` through subscription auth: automatic observation-only capture plus bounded readback; repair of a missed eligible save; recovery after a real pre-launch `ENOENT`; explicit no-retention with zero writes; and the existing English note/date/time correction journey. The latter preserved the original event ID and corrected its duration and timestamp.
- The launch-failure fixture proves the canonical command did not start and left zero events, then presents that failure context to a live turn. It does not emulate a lost response after an ambiguous committed write.
- Live command: `pnpm test:assistant:live -- --test <one exact journey name> --model gpt-5.6-terra`. Initial subscription profiles failed before any provider action; one available alternate profile succeeded and was retained for every final journey. No credentials were read or copied.
- Focused assistant contracts: 98 tests passed across Journal recovery, CLI access, model behavior, and health-record ingestion. Route composition and turn planning: 106 tests passed; reviewed the expected direct/group/scheduled-email snapshot changes.
- Existing Browser Vault context tests: 71 passed. Dashboard page tests: 39 passed after the declared `pnpm health-commons:generate` prerequisite. Changelog page tests: 9 passed.
- `pnpm --dir packages/assistant-engine typecheck`, `pnpm --dir apps/web typecheck`, and `pnpm --filter @murphai/murph... build` passed. The CLI build prepared the existing live note-quality journey.
- `pnpm complexity:diff` passed with no added branch debt. The two existing prompt hotspots are unchanged; new behavior is guidance at existing owners. Authored stable-route text grew by 1,456 characters; this is not a complete provider-input token measurement.
- Parent review checked the complete diff, bounded canonical readback, duplicate prevention, private/group scope, explicit no-retention, current-directory launch recovery, truthful visibility claims, and synthetic-only artifacts. No new state store, API, dependency, runtime retry loop, or Web control was added.
- Public changelog: `journal-save-verification`. No new repository friction required a workaround or entry. Final external review is not routed for this prompt-primary local patch; no PR or production deployment is part of this task.
- Limits: local synthetic proof does not establish the historical member page's display failure cause or validate a deployed fix. Existing refresh-on-open behavior is covered by its focused tests; no speculative UI change was made.
Completed: 2026-09-08
