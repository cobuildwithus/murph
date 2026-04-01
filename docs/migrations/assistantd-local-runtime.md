# AssistantD local-runtime migration guide

This change set restructures Murph's **local personal assistant runtime** around a dedicated loopback daemon, `assistantd`, while keeping the **canonical health-data write boundary** inside Murph core/vault services.

Hosted execution is intentionally out of scope for this migration.

## What changed

### 1. New local assistant daemon package

A new published package now exists at `packages/assistantd` / `@murphai/assistantd`.

It exposes a localhost control plane for:

- opening local assistant conversations
- sending assistant turns
- updating assistant session options
- reading runtime status and sessions
- draining the assistant outbox
- processing due assistant cron work
- running a one-shot automation scan

The daemon is bound to a **single vault** and requires a bearer token for every route.

### 2. CLI can operate as an AssistantD client

`openAssistantConversation`, `sendAssistantMessage`, and `updateAssistantSessionOptions` now automatically use `assistantd` when these env vars are present:

- `MURPH_ASSISTANTD_BASE_URL`
- `MURPH_ASSISTANTD_CONTROL_TOKEN`

This is intentionally staged.

The CLI currently stays **in-process** for turns that depend on local-only runtime hooks such as:

- `abortSignal`
- `onProviderEvent`
- `onTraceEvent`
- `sessionSnapshot`
- `transcriptSnapshot`

That keeps live Ink/chat behavior and recovery-sensitive resume flows stable while the local runtime authority moves behind the daemon.

### 3. Assistant runtime state now has a single service façade

A new `createAssistantRuntimeStateService(vault)` façade centralizes access to runtime-owned state:

- sessions
- transcripts
- outbox
- diagnostics
- status
- memory
- state documents
- turn receipts

The backing store is still file-based under sibling `assistant-state/**`, but callers now have a single state-service entry point instead of directly mixing helpers across many modules.

### 4. Explicit conversation policy

Turn planning now computes a first-class `AssistantConversationPolicy`.

This makes the local assistant runtime explicit about:

- scope strategy (`session-id`, `alias`, `conversation-key`, `unscoped`)
- delivery audience
- auto-reply eligibility
- sensitive health-context exposure
- no fan-out / no delivery mirroring
- session reset policy

### 5. Append-only transcript distillation

Older transcript history can now be distilled into append-only continuity records at:

- `assistant-state/distillations/<session-id>.jsonl`

These are **non-canonical runtime artifacts**. They are meant to preserve older conversational continuity without making model-authored summaries into source-of-truth health records.

Murph still treats the canonical vault as authoritative.

### 6. Service decomposition

The main local assistant orchestration path has been split further into dedicated modules:

- `assistant/conversation-policy.ts`
- `assistant/runtime-state-service.ts`
- `assistant/session-resolution.ts`
- `assistant/provider-binding.ts`
- `assistant/turn-plan.ts`
- `assistant/delivery-service.ts`
- `assistant/turn-finalizer.ts`
- `assistant/reply-sanitizer.ts`
- `assistant/transcript-distillation.ts`

`assistant/service.ts` still exists, but it is now more clearly the coordinator rather than the sole owner of every runtime concern.

## Operator migration

### Starting AssistantD

Run the daemon with a single target vault:

```bash
ASSISTANTD_VAULT_ROOT=/path/to/vault \
ASSISTANTD_CONTROL_TOKEN=replace-me \
pnpm --dir packages/assistantd exec tsx src/bin.ts
```

Optional:

```bash
ASSISTANTD_HOST=127.0.0.1
ASSISTANTD_PORT=50241
```

`ASSISTANTD_HOST` is restricted to loopback hosts.

### Pointing Murph CLI at AssistantD

Configure the CLI client env vars:

```bash
export MURPH_ASSISTANTD_BASE_URL=http://127.0.0.1:50241
export MURPH_ASSISTANTD_CONTROL_TOKEN=replace-me
```

After that, normal local conversation open/send/update calls will route over the daemon when the turn does not require in-process progress hooks or local snapshots.

## Developer migration

### Runtime-state callers

Prefer `createAssistantRuntimeStateService(vault)` in new code rather than stitching together store/outbox/status/diagnostic helpers ad hoc.

### Conversation-sensitive routing

Prefer `resolveAssistantConversationPolicy(...)` in new code when making decisions about:

- whether sensitive health context is allowed
- who the turn may reply to
- whether auto-reply is allowed
- which conversation scope key should govern the turn

### Long transcript handling

Use transcript distillation as **runtime continuity only**.

Do not treat `assistant-state/distillations/**` as canonical memory, and do not read it as if it were vault truth.

## Compatibility notes

- Existing assistant sessions remain file-backed under `assistant-state/sessions/**`.
- Existing transcripts remain file-backed under `assistant-state/transcripts/**`.
- Existing automation, outbox, diagnostics, and receipt stores remain file-backed.
- No hosted-runtime architecture changes are required for this migration.

## Release/build changes

This patch also updates workspace/release wiring so `assistantd` participates in:

- workspace build ordering
- package typecheck lists
- release manifest packaging
- TypeScript workspace path mapping

## Recommended rollout

1. Merge the runtime decomposition and state-service changes first.
2. Start `assistantd` in local/dev environments only.
3. Enable the CLI client env vars for selected operator machines.
4. Keep interactive Ink/live-progress flows in-process until the remaining local-only hooks are daemonized.
5. Once stable, move more local runtime entry points to the daemon control plane by default.
