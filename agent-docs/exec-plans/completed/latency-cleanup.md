# Hosted Mailbox Latency Cleanup

## Goal

Reduce hosted conversation wake latency by moving mailbox fetch/import earlier in the restored workspace invocation without adding a new mailbox owner, weakening replay safety, or removing the current checkpoint-before-assistant boundary.

Success criteria:

- Mailbox fetch can begin immediately after `workspacePort.read()` using a correctness-neutral watermark hint.
- The restored runtime imports and checkpoints staged mailbox input before inbox sidecar setup, Codex env setup, and CLI bridge startup.
- If an early fetch hint is stale, missing, invalid, or fails, the runtime falls back to the existing authoritative fetch from restored `hosted-mailbox.json` state.
- `mailbox.imported` remains the post-checkpoint durability signal for compatibility.
- The implementation does not add a new durable mailbox/event-log primitive, workspace metadata cursor, provider-message path scheme, or Cloudflare-owned mailbox state.
- Tests prove ordering, stale-hint fallback, no duplicate initial import, checkpoint-before-assistant safety, and redacted mailbox logs.

## Constraints

- Web/Postgres already owns the durable mailbox source: `HostedMailboxItem`, `HostedMailboxPayload`, and `HostedMailboxLaneCounter`.
- Runtime already owns mailbox import watermarks in `.runtime/operations/assistant/hosted-mailbox.json`.
- `HostedWorkspace.redactedStatusJson` can be used only as a best-effort fetch hint, not as correctness state.
- Removing the mandatory mailbox import checkpoint is out of scope for this pass. That requires a separate protocol-doc change plus replay proof for outbound side effects and active-turn refresh.
- Inbox projection remains a post-checkpoint enrichment effect. Assistant admission must continue to rely on staged `AssistantInputEvent` rows, not hidden inbox rows.
- Runtime logs are observability only and must stay redacted; no mailbox payloads, local paths, provider identifiers, raw message ids, or decrypted content in log fields.

## Implementation

1. Refactor `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts` so mailbox fetch can be issued separately from mailbox processing:
   - add a small `prefetchHostedMailboxPrefix` helper over the existing `mailboxPort.fetch`
   - let `fetchAndProcessHostedMailboxPrefix` reuse a prefetch only when its lanes, limit, and imported sequences exactly match the authoritative restored state
   - otherwise discard the prefetch and perform the normal fetch
2. In `packages/assistant-runtime/src/hosted-runtime.ts`:
   - start the prefetch promise after workspace read/version/user validation
   - build the prefetch watermark hint from complete `workspace.redactedStatus` watermarks, skipping prefetch for existing workspaces when hints are missing or invalid
   - restore the workspace
   - run the initial mailbox import/checkpoint before sidecar/Codex/bridge setup
   - pass the completed initial import result into the workspace runner
3. In `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`:
   - accept an optional already-completed initial mailbox import
   - record it into the checkpoint session instead of fetching/importing again
   - keep active-turn mailbox refresh unchanged
4. Keep `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts` as the owner of the checkpointed import operation for now:
   - watermarks are still written before checkpoint and rolled back on checkpoint failure
   - the checkpoint remains the only durable advancement of mailbox import state
5. Add only minimal typed runtime log events if needed for the early fetch stages, preserving `mailbox.imported` as the compatibility post-checkpoint signal.
6. Update `agent-docs/references/hosted-runtime-protocol.md` to document early prefetch as an optimization and reaffirm the checkpoint-before-assistant boundary.

## Tests

Update focused assistant-runtime tests:

- initial mailbox fetch starts after workspace read and before expensive restore artifact materialization finishes when the redacted-status hint matches restored state
- import/checkpoint occurs before sidecar setup, Codex env setup, and CLI bridge startup
- stale, absent, or invalid hint falls back to the authoritative fetch after restored state is read
- a provided initial import result is not imported a second time by `runHostedWorkspaceUntilIdleOrBudget`
- active-turn refresh still fetches/checkpoints late conversation mailbox rows
- retryable payload blocks still checkpoint the retry wake and do not advance lane watermarks
- runtime log redacted JSON still omits body/cipher/file/id/path/payload/ref-like fields

Verification target:

- focused Vitest for `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm typecheck`
- truthful `pnpm test:diff` scoped to this plan's touched files, unless blocked by unrelated active worktree state

## Completion

Required audits for this high-risk hosted runtime change:

- `security-privacy-review`
- `coverage-write` if the final verification lane uses owner/diff coverage
- `task-finish-review`

Commit path:

- Use `scripts/finish-task agent-docs/exec-plans/active/latency-cleanup.md ...` if overlapping dirty work permits a scoped plan close.
- If overlapping active rows block a safe scoped commit, close the exact plan row with the repo script and report the blocker.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
