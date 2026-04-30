# Land final assistant-input delivery and simplification fixes

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

Finish the assistant-input hard cut without adding another architecture layer:
Codex admission and auto-reply routing must work from `AssistantInputEvent`
even when inbox projection fails.

The primitive stays:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner / active turn -> accepted-input journal -> Codex
```

`AssistantInputEvent.replyTarget` is the private delivery authority. Inbox is
projection/enrichment only.

## Success criteria

- Hosted projection-failed input reaches Codex and can reply using the real
  private `replyTarget`, not hashed conversation ids or fabricated inbox ids.
- Scanner and active-turn routing use assistant input as the source of truth.
- Auto-reply channel priming seeds from assistant input, not inbox captures.
- Hosted automation no longer requires inbox runtime initialization before the
  assistant pass can inspect assistant input.
- Captureless active-turn continuation does not clear an existing reply target
  unless a new accepted input intentionally supplies one.
- Hosted staged input keeps minimized grouping metadata in `conversation`; local
  projected input keeps existing local capture semantics while adding real
  private route data in `replyTarget`.
- `createHostedAutomationInboxServices` is deleted rather than kept as an
  identity wrapper.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant/input-store.ts`
  - `packages/assistant-engine/src/assistant/input-source.ts`
  - `packages/assistant-engine/src/assistant/automation/reply.ts`
  - `packages/assistant-engine/src/assistant/auto-reply-channels.ts`
  - `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
  - `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
  - `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
  - `packages/setup-cli/src/setup-services/channels.ts`
  - directly coupled assistant-engine and assistant-runtime tests
- Out of scope:
  - new hosted-only assistant input stores, queues, journals, or scanner paths
  - broad Cloudflare runner changes
  - deleting runtime-only/capture-persistence SQLite ballast in this patch
  - inbox rebuild mutation cursor redesign

## Constraints

- Technical constraints:
  - Do not add a `deliveryAuthority` abstraction; strengthen existing
    `replyTarget`.
  - Do not store real provider ids in prompt content, logs, accepted-input
    journal entries, or safe conversation grouping fields.
  - Preserve package boundaries and unrelated dirty work.
- Product/process constraints:
  - Greenfield hard cut: remove stale capture-gated code rather than adding
    compatibility fallbacks.
  - Hosted remains a thin runner over local runtime semantics.

## Risks and mitigations

1. Risk: Real provider ids leak through safe metadata or logs.
   Mitigation: keep real ids only in `replyTarget` and add tests that hosted
   `conversation` remains hashed/minimized.
2. Risk: Projection-failed input can be seen but not delivered.
   Mitigation: delivery and active-turn admission resolve the latest accepted
   input `replyTarget`.
3. Risk: Inbox initialization failures still block hosted admission.
   Mitigation: remove unconditional hosted inbox init before automation and
   keep inbox access as enrichment only.

## Tasks

1. Extend `AssistantInputEvent.replyTarget` into the real private route shape.
2. Stage hosted input with minimized `conversation` and real private
   `replyTarget`; add local capture `replyTarget` without adding a second local
   hashing layer.
3. Route auto-reply and active-turn continuation from accepted input
   `replyTarget`.
4. Seed managed auto-reply channels from `AssistantInputSource`.
5. Remove hosted inbox-init coupling and the identity wrapper.
6. Add focused regression tests.
7. Run required focused verification and completion audits.

## Decisions

- Reuse `replyTarget`; do not introduce `deliveryAuthority`.
- Keep inbox as projection/enrichment only.

## Verification

- Passed:
  - `pnpm --filter @murphai/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-input-store.test.ts test/assistant-automation-runtime.test.ts test/assistant-automation-state.test.ts`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-maintenance.test.ts`
  - `pnpm --filter @murphai/assistant-engine typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm --filter @murphai/setup-cli typecheck`
  - `pnpm --filter @murphai/assistant-engine test`
  - `pnpm --filter @murphai/assistant-runtime test`
  - `pnpm --filter @murphai/setup-cli test`
  - `pnpm typecheck`
  - scoped `bash scripts/workspace-verify.sh test:diff ...` for the touched assistant-input paths
  - `git diff --check` on touched paths
  - scoped diff leakage scan
- Required audits:
  - security/privacy and simplify audit findings were addressed.
  - coverage-write found no useful additional test to add.
  - task-finish-review findings were addressed: Linq cleanup now reads
    captureless `replyTarget.messageId`, and captureless email defers until
    inbox projection supplies real delivery authority.
Completed: 2026-04-30
