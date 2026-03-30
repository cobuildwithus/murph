# Assistant Attachment Context Bounds

## Goal

Stop assistant auto-reply turns from crashing on oversized parsed attachments by keeping large attachment bodies out of the prompt while still leaving enough handles for the assistant to inspect the attachment on demand.

## Scope

- Keep Codex CLI prompt transport on stdin instead of argv so oversized prompts do not fail at process launch.
- Change auto-reply prompt construction so large parsed attachment text is replaced with attachment metadata and file handles instead of being pasted wholesale.
- Preserve small attachment transcripts/extracted text inline when they stay comfortably bounded.
- Add focused regression coverage for both the bounded prompt builder and the Codex stdin transport.

## Constraints

- Keep the change local to assistant prompt construction and the Codex subprocess adapter.
- Preserve existing auto-reply capture grouping, retry, and provider session behavior.
- Do not widen inbox parser behavior or canonical logging semantics in this pass.

## Verification Plan

- Run focused assistant prompt/Codex tests first.
- Run repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`, and record unrelated blockers if the tree stays red outside this patch.
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
