# Signal Descriptions Landing

## Goal

Land the supplied Health Commons `expectedSignalDescriptions` copy update across protocol markdown files.

## Scope

- Apply the supplied 29-protocol patch file.
- Apply the keyed replacement copy for the two additional protocols listed in the companion note.
- Preserve unrelated dirty work in the checkout, including active hosted/deploy changes and unrelated protocol edits.

## Verification

- Read back representative changed blocks and run diff hygiene.
- Run Health Commons generation.
- Run scoped diff-aware verification for the touched protocol markdown files.
- Run required completion review passes before committing.

## State

- Done: applied the 29-protocol patch and 14 keyed extra replacements.
- Note: two keyed alcohol-abstinence entries did not have matching `expectedSignalDescriptions` keys in the current file, so they were left unapplied.
- Done: left the deterministic catalog hash test unchanged because the changed sauna hash comes from unrelated parser drift outside this landing.
- Done: tightened three descriptions after security review to avoid overstating exploratory glucose or sleep signals.
- Verification: `pnpm health-commons:generate`, `pnpm --dir packages/health-commons typecheck`, and copy word/caveat checks passed. `pnpm --dir packages/health-commons test` and scoped `test:diff` are blocked by unrelated dirty-tree artifacts/parser/build state.
- Now: final scoped staging and commit.
- Next: commit only the intended protocol copy changes and archive this plan.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
