# Native Message Formatting

## Goal

Land native rich-text delivery for user-facing messaging channels.

Success criteria:

- Linq outbound text converts simple assistant emphasis markers into
  `text_decorations` ranges while sending marker-free text.
- Telegram outbound text converts the same simple emphasis markers into
  explicit message entities while sending marker-free text.
- Plain SMS/RCS fallback remains marker-free and does not force Linq protocol
  selection.
- Prompt guidance allows rare short emphasis on supported messaging channels
  while still blocking broad Markdown presentation.
- Focused package tests, typecheck, completion audits, PR, and ReviewGPT PR loop
  all complete.

## Constraints

- Preserve unrelated active-plan and working-tree edits.
- Keep conversion conservative: no multiline emphasis, no raw parse-mode send,
  no new dependency, and no provider credential/logging changes.
- Avoid local usernames, home paths, secrets, or direct personal identifiers in
  committed files, review artifacts, or handoff text.
- `packages/assistant-engine/src/assistant/system-prompt.ts` is also listed in an
  active prompt lane; keep this change limited to the messaging reply-style
  guidance.

## Approach

1. Add a small shared message-formatting helper in `operator-config`.
2. Use it at Linq and Telegram delivery egress.
3. Add focused tests for formatting conversion, offsets, chunking, and prompt
   contract.
4. Run required verification and audits.
5. Commit, push, open the PR, then run the ReviewGPT PR loop.

## State

Implementation, verification, and local completion audits complete. Ready for
scoped commit, PR, and ReviewGPT PR loop.

## Notes

- Current Linq docs confirm `text_decorations` ranges are UTF-16 code units and
  are ignored on RCS/SMS.
- Current Telegram Bot API docs confirm `sendMessage` accepts explicit
  `entities` in place of `parse_mode`, with offsets and lengths in UTF-16 code
  units.
- Security/privacy audit found no medium-or-higher findings.
- Coverage-write added focused tests for conservative non-conversion, plain
  Telegram chunks omitting entities, and split UTF-16 Telegram entity ranges.
- Deep-review found a prompt consistency issue between the old broad Markdown
  marker ban and the new Linq/Telegram native-emphasis exception. Accepted and
  fixed by making broad prompt rules defer to explicit channel-native emphasis
  guidance.
- Final verification passed:
  - `git diff --check`
  - `pnpm --dir packages/operator-config test -- message-formatting.test.ts http-linq-device-runtime.test.ts`
  - `pnpm --dir packages/assistant-engine test -- assistant-channels-runtime.test.ts model-behavior.test.ts`
  - `bash scripts/workspace-verify.sh test:diff ...`
  - `pnpm typecheck`
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
