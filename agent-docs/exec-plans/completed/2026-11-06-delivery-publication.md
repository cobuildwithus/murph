# Delivery publication result

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- Outcome: publish exact retry claims and Linq reply obligations before provider entry without adding publication to fresh Telegram/email or ordinary keyed Linq replies.
- Reaches: direct and group-recipient sends, approval files, follow-up settlement, and foreground checkpoint scheduling.
- Proof: real vault/outbox phase journeys with copied snapshots and provider counters, plus the existing runtime entrypoint harness.

## Success criteria

- Red proofs on the original production code, focused green tests, engine/runtime typechecks, complexity review, and one local scoped commit.

## Scope

- In scope: local effect selection, prepared-claim dispatch, existing durable continuation and its derived deadline, two contract paragraphs, focused proof.
- Out of scope: Web, Worker, wire/persisted formats, provider/model behavior, push or PR creation.

## Constraints

- Reuse the outbox and durable hook; no new state machine or persisted fields.
- Run focused files serially by package with at most two workers. Keep artifacts inside the task checkout.

## Risks and mitigations

1. A published non-idempotent claim may be unsent at crash; retain existing ambiguous terminal recovery, never infer acceptance from entry.
2. Publication can delay a reply; carry the exact foreground deadline and keep unrelated boundaries immediate.

## Tasks

1. Write and run failing boundary proofs before production edits.
2. Implement selection, strict claims, split delivery routing and effect deadlines.
3. Verify focused files, typechecks, docs, diff and complexity; record results here, close the plan and commit.

## Decisions

- The outbox remains authoritative; the publication marker is local and derived at collection.
- No live model journey: interpretation, prompt, tools and generated text are unchanged; deterministic provider-entry and restore evidence owns this change.

## Verification

- Original production head: `89a15d73f0`. Engine build before runtime red tests exited 0.
- Red 1: runtime new publication file, 25 tests, exit 1 (19 failed, 6 passed). Retry fixtures initially rejected only one Telegram transport attempt; ordinary Linq assertions initially mistook existing maintenance hooks for publication. Those fixture issues were corrected before implementation.
- Engine red: `assistant-outbox-runtime.test.ts --testNamePattern "prepared ownership token mismatches"`, exit 1 (2 failed, 1 passed, 154 skipped). Retryable and pending intents with a stale token started an ordinary attempt and became failed; a mismatching sending token already skipped.
- Red 2: new publication file plus checkpoint-wakes, focused name filter, exit 1 (22 failed, 9 passed, 17 skipped). Real due Telegram/email retries and durable pending sent before publication; missing token dispatched; preemption lacked a durable hook; successor was already sent; Linq approval/settlement and mixed-boundary replies dispatched early; group child retry sent early. Foreground and eight-minute deadlines both waited ten minutes. One general-path fixture and rearm lifecycle still needed correction.
- Red 3 (before any production edits): same focused runtime command with the voice and Ask cases, exit 1 (23 failed, 10 passed, 17 skipped). Publication file: 18 failed, 8 passed, all failures at the intended missing fence/claim boundary. Checkpoint-wakes: two deadline assertion failures, plus three fixture lifecycle timeouts (rearm and both Ask cases); those timeouts are not counted as regression proof.
- All Vitest invocations used package-local config, `--no-coverage`, `--maxWorkers=2`, and no shell pipeline.
- Additional engine red: expanded stale tracked non-idempotent recovery to Linq, exit 1 (1 failed, 1 passed, 156 skipped). The first fixture used text, which the real engine correctly normalizes to idempotent. Corrected it to a voice attachment and reran against the original engine sources: exit 1 (1 failed, 1 passed, 156 skipped), now failing because stale Linq ambiguity became retryable without terminal confirmation. The implementation preserves the existing common ambiguous classification and removes Telegram's channel-specific workaround.
- Corrected active-Ask proof against the original `hosted-runtime.ts`: exit 1 (1 failed, 1 passed, 23 skipped). The due effect waited for the Ask instead of starting publication while it was active; the ordinary effect correctly waited. Original sources were temporarily restored from the starting commit for this red run and the exact implemented sources restored afterward. No lifecycle timeout remains in this proof.

### Final focused commands

All tests used `MURPH_VITEST_TEMP_ROOT="$PWD/.tmp/pr13" TMPDIR="$PWD/.tmp/pr13"`; package execution was serial, with no umbrella lane.

```sh
pnpm --dir packages/assistant-engine build
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts test/assistant-outbox-thresholds.test.ts --maxWorkers=2
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-delivery-publication.test.ts test/hosted-runtime-delivery-settlement.integration.test.ts test/hosted-runtime-telegram-file-checkpoint.test.ts test/hosted-runtime-callbacks.test.ts test/hosted-runtime-linq-outbox-regression.test.ts test/hosted-runtime-workspace-assistant-phase-delivery.test.ts test/hosted-runtime-workspace-assistant-phase-foreground.test.ts test/hosted-runtime-workspace-assistant-phase-outbox-starvation.test.ts test/hosted-runtime-system-mailbox-notification.test.ts test/hosted-runtime-workspace-entrypoint-checkpoint-wakes.test.ts test/hosted-runtime-workspace-entrypoint-checkpoint-races.test.ts test/hosted-runtime-idle-retirement.test.ts --maxWorkers=2
pnpm --dir packages/assistant-runtime typecheck
MURPH_COMPLEXITY_BASE_SHA=89a15d73f0 pnpm complexity:diff
```

- Engine build: exit 0, including the rebuilt export before runtime execution.
- Engine focused files: 181 passed, 2 files, exit 0.
- Runtime focused files: 861 passed, 12 files, exit 0. This includes 26 new real-outbox publication cases and 8 new entrypoint deadline cases.
- Engine typecheck: exit 0. Runtime typecheck: exit 0; its first run exited 2 because a new test returned a boolean instead of the result's literal discriminant. Fixed the fixture return branches without a cast.
- Implementation iterations exited 1 while correcting test fixtures: 13 failed/20 passed/17 skipped; 5 failed/28 passed/17 skipped (two Ask expiry fixture errors); 4 failed/1 passed/45 skipped. Corrected approval/voice/Ask subset then passed 5 with 45 skipped, exit 0. The first full runtime run passed 855 and failed only 5 exact collection-argument assertions, exit 1. The first full engine run passed 180 and failed the text-versus-voice fixture described above, exit 1.
- Follow-up argument migration: the first runtime run exited 1 (842 passed, 19 failed), all at collection-argument assertions. Fourteen assertion sites previously omitted an `undefined` checkpoint argument and now explicitly expect `workspace: null`; the five timestamp assertions now check `workspace.checkpointedAt`. The unchanged 12-file proof then passed all 861 tests, exit 0. The engine proof again passed all 181 tests, exit 0. The follow-up engine build and both package typechecks also exited 0.

### Existing test changes

- `assistant-outbox-runtime.test.ts`: expanded the prepared-token mismatch test from `sending` to `sending`, `retryable`, and `pending`, proving a stale token cannot start an ordinary attempt. Expanded stale non-idempotent terminal-confirmation recovery from Telegram to Telegram and Linq voice, preserving callback replay and no provider reentry.
- `hosted-runtime-delivery-settlement.integration.test.ts`: its shared direct-drain fixture now prepares effects and passes `allowPreparedSending`/`preparedDispatches`, while preserving explicit test overrides. Due non-idempotent retries must follow the production prepared-claim path. No assertion was removed or relaxed.
- `hosted-runtime-telegram-file-checkpoint.test.ts`: the shared drain for fresh/approval/retry file cases now prepares claims and supplies the exact dispatch tokens, matching production. Restore and ambiguous-terminal assertions remain unchanged.
- `hosted-runtime-workspace-assistant-phase.harness.ts`: its callback mock forwards the real eight-minute constant so phase tests exercise the actual deadline.
- `hosted-runtime-workspace-assistant-phase-delivery.test.ts`: the fresh-conversation/device-sync deferral test now asserts the committed `workspace` collection argument and its exact `checkpointedAt` value.
- `hosted-runtime-workspace-assistant-phase-foreground.test.ts`: the causal-only zero-effect, exact approval ahead of older wake, queued cleanup during foreground input, and due cleanup rearm tests add that same exact argument. All existing assertions remain.
- `hosted-runtime-workspace-entrypoint-checkpoint-wakes.test.ts`: added deadline/no-deadline, foreground and background rearm, active-Ask, and projection-offer ordering cases using the existing real entrypoint harness. Existing cases are unchanged.

### Review and brief corrections

- Product/recovery review: Ready. Real vault copies preserve retry claims, parked approval identity and adopted bytes, follow-up automation and nutrition memory. Fresh Telegram/email and ordinary keyed Linq keep zero new publication hooks; unrelated Linq boundaries dispatch immediately. Preemption resets only the exact claim. The next accepted turn regains the ordinary idle window after publication.
- The ordinary foreground Linq phase already has an `afterCheckpoint` maintenance hook from `withFreshHostedManagedAutomationsAfterCheckpoint`. Its absence would be an incorrect assertion. The proof checks inline provider entry and no durable continuation; the general fast path also has no local hook.
- The requested stale Linq voice outcome exposed the additional engine classification bug described above. The fix reuses `ASSISTANT_DELIVERY_AMBIGUOUS`; it adds no status, error code, persisted field, Web/Worker change, or provider lookup.
- Reviewed continuation preservation through route maintenance, managed automations, checkpoint composition and continuing system-mailbox merging. Existing durable effect function identities and their deadlines survive these wrappers. Existing foreground checkpoint preemption is unchanged.
- Production TypeScript against `89a15d73f0`: 211 lines added, 68 removed, net **+143**, across six files. The removed Telegram-only ambiguity workaround accounts for the engine reduction.
- `MURPH_COMPLEXITY_BASE_SHA=89a15d73f0 pnpm complexity:diff` exits **0** after the follow-up refactor, with the guard and threshold unchanged. All six production files pass: engine outbox debt 82 → 80 and maximum 66 → 64; dispatch-state debt 48 → 48 and maximum 38 → 38; runtime entrypoint debt 420 → 419 and maximum 186 → 185; callbacks debt 154 → 154 and maximum 73 → 73; assistant phase debt 276 → 276 and maximum 114 → 114; workspace-runner debt 58 → 58 and maximum 70 → 70. The callbacks/assistant-phase deltas compare unmoved functions. The marker walk, prepared-dispatch predicate, missing-token outcome, deadline helpers and projection closure keep the existing decisions at their owners without increasing complexity debt.
- `git diff --check`: exit 0. Changed-file privacy scan: pass. No new package, registry, state machine, wire or persisted format was introduced.
- Remaining: no implementation or focused behavior proof is left undone, and the complexity guard passes.

### ReviewGPT round 1 continuation fix

- Outcome: a due Telegram reply collected during post-foreground activation maintenance reaches provider entry after the enclosing publication.
- Reaches: queued Telegram signup activation, ordinary reply retry, pre-provider yield, and restored follow-up receipts.
- Proof: the real foreground phase, system-mailbox enqueue/prepare/record, delivery collect/prepare/drain, copied vault snapshots, and a synthetic provider counter.
- Starting head: `7521a601ad`. Before production edits, the focused name-filtered run exited **1**: **2 failed, 26 skipped**. After the outer durable callback the provider count was **0**, expected **1**. On yield, the intent remained `sending` with its prepared token and attempt count **2**, expected `retryable`, a cleared token, and its original attempt count **1**.
- The first fixture run also exited **1** (2 failed, 26 skipped), but failed at real mailbox parsing because the reused mock-only welcome route used unsupported delivery kind `chat`. The proof now constructs the wake with the real builder and `explicit` delivery; that fixture error is not counted as regression evidence.
- Red command (with the temp-root environment below): `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-delivery-publication.test.ts --testNamePattern 'post-foreground maintenance publication' --maxWorkers=2`.
- Implementation: run the returned durable effects sequentially inside the enclosing durable callback, forwarding its context and merging the earliest wake and redacted status. Those claims already belong to the enclosing publication. Keep the follow-up checkpoint requirement and let errors reach the existing best-effort handler.
- First implementation run: **exit 1**, **1 passed, 1 failed, 26 skipped**. Provider entry and token reset were fixed; the remaining assertion incorrectly expected `hostedSystemMailboxRecorded: 1`. This activation has no separate post-checkpoint record, so the real callback reports `0`. The proof asserts that callback is invoked exactly once and the activation queue is empty, plus the merged delivery metric.
- Final commands:

  ```sh
  export MURPH_VITEST_TEMP_ROOT="$PWD/.tmp/pr13" TMPDIR="$PWD/.tmp/pr13"
  pnpm build:workspace:incremental
  pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-delivery-publication.test.ts test/hosted-runtime-workspace-assistant-phase-foreground.test.ts test/hosted-runtime-workspace-assistant-phase-delivery.test.ts test/hosted-runtime-system-mailbox-notification.test.ts --maxWorkers=2
  pnpm --dir packages/assistant-runtime typecheck
  MURPH_COMPLEXITY_BASE_SHA=$(git merge-base HEAD origin/main) pnpm complexity:diff
  ```

- Incremental workspace build: **exit 0**, both before the red proof and after the implementation.
- Final focused proof: **413 passed, 4 files, exit 0**. The publication file contains **28 cases**, including the two new post-foreground journeys. Provider calls stay at zero through publication, become exactly one in the enclosing callback, and remain one after restoring the follow-up snapshot and advancing ten minutes. Yield restores the original retry state and exact token ownership; the next pass claims a fresh token and sends once.
- Assistant-runtime typecheck: **exit 0**.
- Complexity: **exit 0** against merge base `64bd18363634`; all six branch-changed production files pass. Assistant-phase debt remains **276 → 276**, maximum **114 → 114**; the threshold and guard are unchanged.
- Parent review: **Ready**. The existing outbox owns the claim and receipt; no new queue, list of deferred work, deadline, persisted field, flag, provider behavior, or model input was added. The new loop awaits each effect in order and has no catch that could swallow an error. The existing release entry needs no separate item for this unshipped regression correction.
- Brief corrections: no change to the accepted cause or required production behavior. The zero activation record metric above is a fixture/assertion clarification; the real activation record callback still runs exactly once.
- Final diff whitespace check: **exit 0**. Authored-diff privacy scan: **pass**; all fixtures and provider responses are synthetic.

Completed: 2026-11-06
