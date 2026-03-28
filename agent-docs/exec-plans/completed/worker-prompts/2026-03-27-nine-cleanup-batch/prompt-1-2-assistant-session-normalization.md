Murph cleanup lane: handle two tightly coupled behavior-preserving simplification passes in one lane because both need `packages/cli/src/assistant/store/paths.ts`.

Ownership:
- Own `packages/cli/src/{chat-provider.ts,outbound-channel.ts,assistant/store.ts,assistant/failover.ts,assistant/store/paths.ts,assistant/conversation-ref.ts,assistant-cli-contracts.ts}`.
- Own direct coverage in `packages/cli/test/{assistant-provider.test.ts,assistant-runtime.test.ts,assistant-service.test.ts,assistant-robustness.test.ts,assistant-state.test.ts,assistant-cli.test.ts}`.
- `packages/cli/src/{chat-provider.ts,assistant/failover.ts,assistant/store/paths.ts}` are already dirty, and this lane overlaps the active provider-config cleanup row. Read the live file state first, preserve unrelated edits, and do not revert anything you did not author.
- Do not broaden into `packages/cli/src/assistant/service.ts` or `packages/cli/src/setup-services.ts` unless a direct, minimal dependency makes that unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Follow the completion workflow as far as your lane can: implement, simplify, add or adjust direct coverage, run the narrowest truthful verification, and report any remaining gaps.
- If your environment supports spawned audit subagents, run the required `simplify`, `test-coverage-audit`, and `task-finish-review` passes using the prompts under `agent-docs/prompts/`.

Task A: assistant provider-option normalization

Relevant code:
- `packages/cli/src/chat-provider.ts`: `resolveAssistantProviderOptions`
- `packages/cli/src/assistant/store/paths.ts`: `normalizeProviderOptions`
- `packages/cli/src/assistant/failover.ts`: `normalizeAssistantProviderSessionOptions`
- `packages/cli/src/assistant-cli-contracts.ts`: `assistantProviderSessionOptionsSchema`

Issue:
- The same field-by-field normalization logic is implemented three times for assistant provider options.
- The shapes are close enough to drift, but not identical: some paths preserve omitted optional fields as `undefined`, others coerce them to `null`, and only one path runs through the schema parser.
- The repeated name "provider options" blurs the trust boundary between runtime execution inputs, persisted session state, and failover-state serialization.

Best concrete fix:
- Extract one tiny shared normalizer for the raw fields only.
- Keep thin boundary-specific adapters:
  - one adapter for runtime execution that preserves current `undefined` behavior where callers expect it
  - one adapter for persisted/session/failover state that preserves current `null` or optional behavior and still validates with `assistantProviderSessionOptionsSchema` where appropriate
- Do not collapse the boundaries into a single exported type if that changes absent-field semantics.
- Keep externally visible behavior, serialized state, failover route hashing, and labels unchanged.

Tests to anchor:
- `packages/cli/test/assistant-provider.test.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- `packages/cli/test/assistant-service.test.ts`
- `packages/cli/test/assistant-robustness.test.ts`

Task B: assistant conversation and session locator normalization

Relevant code:
- `packages/cli/src/outbound-channel.ts`: `deliverAssistantMessage`
- `packages/cli/src/assistant/store.ts`: `resolveAssistantSession`
- `packages/cli/src/assistant/store/paths.ts`: `normalizeConversationLocator`, `bindingInputFromLocator`, `bindingPatchFromLocator`
- `packages/cli/src/assistant/conversation-ref.ts`: `normalizeConversationRef`, `mergeConversationRefs`, `conversationDirectnessFromThreadIsDirect`, `threadIsDirectFromConversationDirectness`

Issue:
- Conversation identity canonicalization is still repeated across outbound delivery, session resolution, and store-path helpers.
- The repeated rules cover:
  - `actorId` vs `participantId`
  - `threadId` vs `sourceThreadId`
  - `threadIsDirect` vs `directness`
  - explicit locator fields merged with `input.conversation`

Best concrete fix:
- Add one small helper near `assistant/conversation-ref.ts` or `assistant/store/paths.ts` that converts an `AssistantSessionLocator`-like input into a normalized `ConversationRef`, or an equally clear canonical intermediate.
- Reuse that helper from:
  - `outbound-channel.ts` when building conversation for `deliverAssistantMessage`
  - `assistant/store.ts` when resolving sessions
  - `assistant/store/paths.ts` when building binding input and binding patch
- Preserve the special `bindingPatchFromLocator` behavior that only patches fields actually present.
- Reuse the existing directness helpers in `conversation-ref.ts` instead of keeping local directness normalization clones.
- Do not change session lookup precedence, alias or conversation-key behavior, binding patch semantics, or delivery behavior.

Tests to anchor:
- `packages/cli/test/assistant-state.test.ts`
- `packages/cli/test/assistant-service.test.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- `packages/cli/test/assistant-cli.test.ts`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
