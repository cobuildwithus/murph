## Bottom line

Current main is **safer than the earlier strict-reject implementation**, but it is also **more complex than the clean final architecture should be**.

The cleanest long-term shape is still the one in the uploaded plan:

```txt
baseSnapshot = occasional full workspace backup
liveStateSnapshot = small correctness bundle
restore = baseSnapshot + liveStateSnapshot overlay
Codex home = part of live assistant state when native resume exists
```

That plan’s core invariant is right: if live state stores a provider resume pointer, it must also store the provider-local state required to resume that pointer. It also correctly says not to create a separate “Codex checkpoint” subsystem. 

Main branch mostly implements this, but it does so with extra machinery: session scanning, continuity analysis, in-bundle session scrubbing, a fixture escape hatch, and restore-time repair. Those are useful migration/safety patches, but I would not let all of them become the permanent architecture.

## What main gets right

Main now has a real continuity model. `snapshotHostedAssistantRuntimeHotState` can accept `operatorHomeRoot`, include filtered `.codex-hosted`, enforce provider continuity, preflight both vault and operator-home budget, and detect provider resume state from assistant session files. It also recognizes Codex continuity under both `.codex-hosted/sessions` and `.codex-hosted/rollouts`, which is better than only checking `sessions`. 

Main also improved restore availability. Instead of hard-rejecting legacy incomplete snapshots, restore repairs incomplete provider continuity by scrubbing provider resume state from assistant session files, logs a metadata-only warning, and then proceeds. That avoids bricking existing hosted workspaces. 

The Cloudflare bridge remains appropriately thin. It passes the operator-home root into the snapshot primitive, keeps ordinary user-path checkpoints hot/live, falls back to full/base when hot state is incomplete or over budget, and emits separate logs for hot fallback and full fallback continuity failure. 

So functionally, main is in a much better place than before.

## Where main is drifting from clean architecture

The main concern is that `packages/runtime-state/src/hosted-bundles.ts` has become too much of a semantic hub. It now does:

```txt
generic hosted bundle snapshotting
workspace snapshot filtering
assistant hot/live include filtering
Codex-home filtering
Codex continuity detection
assistant session JSON parsing
assistant session resume-state scrubbing
fixture continuity-policy escape hatches
budgeting
diagnostics
```

That is too much for one module. The code works, but the composability boundary is blurring. A generic runtime-state bundle module now knows enough about assistant sessions to delete `providerSessionId` / null out `resumeState`. That is pragmatic for migration, but not a clean permanent layering. 

The other drift is naming. The uploaded plan pushes `baseSnapshot` and `liveStateSnapshot` because those terms are easier to reason about. Main still exposes a lot of “hot state” names: `snapshotHostedAssistantRuntimeHotState`, `HostedAssistantRuntimeHotStateBudgetExceededError`, `hotStateBundleBytes`, etc. That keeps the old conceptual confusion alive. 

## Best final shape

I would target this as the permanent architecture:

```txt
packages/runtime-state:
  generic bundle snapshot/restore primitives
  workspace snapshot filters
  assistant live-state snapshot primitive
  codex-home filter

packages/assistant-runtime:
  restore orchestration
  migration/repair policy
  assistant-session-specific recovery behavior

apps/cloudflare:
  chooses checkpoint policy
  passes roots and platform ports
  logs metadata
  does not interpret assistant sessions
```

That means main is close, but I would move some of the semantic logic out of `hosted-bundles.ts`.

## Recommended simplifications

### 1. Make session scrubbing explicitly temporary

`repairHostedWorkspaceSnapshotProviderContinuity` is good as a migration path. It should be treated as a legacy repair shim, not a first-class part of steady-state snapshot semantics.

I’d rename it to make that explicit:

```ts
repairLegacyHostedWorkspaceSnapshotProviderContinuity
```

or

```ts
scrubLegacyIncompleteProviderResumeState
```

Then isolate it in a separate module, probably under assistant-runtime, because it mutates assistant session semantics.

Current restore calls the repair before restoring base and hot bundles. That is operationally useful, but architecturally it should read as “legacy compatibility,” not “normal snapshot restore.” 

### 2. Split `hosted-bundles.ts`

I would split the current file into something like:

```txt
hosted-bundles.ts
  generic bundle snapshot/restore helpers

hosted-workspace-snapshot.ts
  full/base workspace include/exclude policy

hosted-assistant-live-state.ts
  assistant live-state include/exclude policy and budgets

hosted-codex-home-snapshot.ts
  .codex-hosted filter, diagnostics, continuity-path predicate

hosted-provider-continuity-repair.ts
  legacy repair/scrub logic
```

This would make the architecture easier to maintain without changing behavior.

### 3. Remove or hide `ignore-for-fixture` from the public snapshot API

Main added:

```ts
providerContinuityPolicy?: "enforce" | "ignore-for-fixture"
```

That is explicit, which is good, but it leaks test vocabulary into the production API. 

Cleaner options:

```ts
snapshotHostedExecutionContext(...)
snapshotHostedExecutionContextUnsafeForFixture(...)
```

or:

```ts
providerContinuityPolicy?: { kind: "enforce" } | { kind: "allow-incomplete"; reason: "fixture" }
```

The first is simpler. The point is to make bypassing continuity enforcement look visibly unsafe.

### 4. Prefer explicit ownership over content inference, eventually

Main currently decides whether hot/live state owns Codex continuity by parsing bundle contents and checking for files under `.codex-hosted/sessions` or `.codex-hosted/rollouts`. 

That is acceptable now. But long-term, a tiny manifest would be cleaner:

```ts
{
  schema: "murph.hosted-live-state-manifest.v1",
  ownsAssistantLiveState: true,
  ownsCodexProviderContinuity: true,
  codexContinuityRootKinds: ["sessions", "rollouts"]
}
```

No thread IDs. No Codex parsing. No prompts. Just ownership metadata.

I would not add a huge manifest system. A tiny ownership manifest would reduce restore-time inference and make clear-before-overlay easier to reason about.

### 5. Keep resume-param thinning separate

The uploaded plan includes “ordinary resume is thin,” but current main deliberately did not do that yet. That is the right call. 

The continuity fix and resume-param compatibility are separate problems:

```txt
continuity fix = restore the same Codex local state as the stored thread id
resume-param thinning = avoid reinterpreting that thread under current config
```

Main branch’s deferment is better for maintainability because it avoids bundling two causal changes into one rollout.

### 6. Decide whether conditional Codex inclusion is worth the coupling

Main conditionally includes `.codex-hosted` only when assistant live state has provider resume state. That is efficient but requires runtime-state to parse assistant session JSON. 

The uploaded final shape leans simpler: treat `.codex-hosted` as live assistant state when hosted Codex is active and the directory exists. 

For maximum simplicity, I would consider this final rule:

```txt
If operatorHomeRoot/.codex-hosted exists, liveStateSnapshot includes filtered .codex-hosted.
```

Then the only special cases are:

```txt
budget exceeded => full fallback or no publish
restore sees live .codex-hosted continuity => clear base .codex-hosted before overlay
```

This may write a few more bytes, but it removes session scanning from the snapshot decision. If the measured Codex-home contribution is small, unconditional inclusion is cleaner.

If Codex-home state is large in practice, keep main’s conditional include, but move the assistant-session detection into an assistant-specific module.

## What I would not simplify away

Do not remove the base/live split. It exists for a real reason: full snapshots caused broad artifact fanout, while live snapshots commit small correctness state on the user-visible path. The uploaded plan’s `baseSnapshot` / `liveStateSnapshot` abstraction is the right simple model. 

Do not move assistant outbox/session semantics into Cloudflare or web DB tables as part of this. The current architecture keeps Cloudflare as the thin runner and platform port layer, which is still the right separation.

Do not make full/base snapshots the response-path default. Main correctly keeps hot/live checkpoints for ordinary reasons and full/base only for maintenance/system-mailbox-receipt or fallback. 

## My preferred final architecture

I would write it as four invariants:

```txt
1. Restore = baseSnapshot + liveStateSnapshot.
2. liveStateSnapshot owns all live assistant correctness roots.
3. If live assistant state can native-resume Codex, liveStateSnapshot also owns filtered Codex provider continuity.
4. Legacy incomplete snapshots are repaired once at restore by stripping unsafe native-resume handles.
```

Everything else should be implementation detail.

## Current main vs ideal

| Area                      | Current main                 | Clean final shape                                         |
| ------------------------- | ---------------------------- | --------------------------------------------------------- |
| Base/live model           | Good                         | Keep                                                      |
| Cloudflare bridge         | Good, still thin             | Keep                                                      |
| Continuity enforcement    | Correct but content-inferred | Prefer tiny ownership manifest or unconditional inclusion |
| Legacy repair             | Useful                       | Keep as temporary/migration-only                          |
| Runtime-state module size | Too broad                    | Split into focused modules                                |
| Naming                    | Still “hot” heavy            | Move toward `liveStateSnapshot` names                     |
| Fixture bypass            | Explicit but ugly            | Hide behind unsafe fixture helper                         |
| Resume-param thinning     | Deferred                     | Correct; do later                                         |

## Recommendation

Do **not** redesign the system again. Main is close.

The next cleanup should be a small architectural hardening pass, not new behavior:

1. Rename or isolate legacy repair.
2. Split the large runtime-state bundle file.
3. Decide conditional vs unconditional Codex-home inclusion based on measured size.
4. Hide `ignore-for-fixture`.
5. Start moving public terms from “hot” to “live state.”
6. Leave resume-param thinning for a separate compatibility phase.

That gets you to a clean, simple, composable architecture without undoing the correctness fix.

## Landing notes

This cleanup pass lands the safe no-behavior-change pieces first: the legacy incomplete-continuity repair is isolated and named as legacy migration code, and the fixture-only enforcement bypass is hidden behind an unsafe fixture helper instead of a production-looking policy switch.

The pass intentionally does not add Codex thread-id parsing or exact-thread matching. The invariant remains ownership-level: a snapshot that carries assistant native-resume state must also carry filtered Codex provider continuity state. It also keeps conditional Codex-home inclusion until production measurements justify an unconditional rule, and leaves broad `hot` to `liveState` public naming migration for a separate compatibility-safe cleanup.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
