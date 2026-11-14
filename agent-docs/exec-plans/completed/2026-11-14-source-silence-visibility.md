# Wearable source silence visibility

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Outcome and invariants

Daily wearable sources receive the existing neutral no-data check. Murph can
inspect each source's delivery and first-connection times. Operator diagnostics
use canonical records rather than stale projections to establish coverage.
Preserve one text per silence episode, preferences, direct-thread and engagement
gates, dispatch revalidation, and read-only diagnostic permissions.

## Owners and evidence

The connect catalog owns provider identity and will require a daily-data fact.
Recovery policy derives from that catalog, with only Garmin and Apple Health
copy/timing overrides. WHOOP retains its refresh-failure eligibility exception.
Web remains preference authority. Existing runtime snapshots already contain
source status, firstSeenAt and lastDataAt; expose these at the tool projection.
Diagnostic permissions omit /app, and query publication takes the canonical
write lock and can rebuild projection files. Instructions must reflect that.
No new persisted state, migration, authority path, or CLI output is needed.

## Scope and rollout

Change catalog-derived notices, lean source rows, and diagnostic guidance.
Do not change push-primary detection, Junction recovery, permissions or providers.
Work in the current checkout; commit only. No push, PR, deploy or production access.
Trace and test both Web/runner skew orders. Keep the existing snapshot wire shape;
tool summaries are local to the runner. Older snapshots may omit source rows or
lastDataAt, and must remain accepted.

## Product journeys and proof

- Established daily source quiet for five days: existing neutral copy; Garmin
  and Apple Health keep their copy and timing. Never-delivered and not-daily
  sources stay quiet. Off/custom waits and delivery revalidation remain intact.
- Empty recent read: old source delivery explains source silence without claiming
  disconnection; newly connected source may still be importing.
- Private preference request: use the actual provider slug and let Web validate;
  group or scheduled contexts cannot change the preference.
- Operator diagnostic: canonical records beat an empty stale cache; no CLI retry,
  mutation, delivery, or extra permission request.

## Tasks

1. Confirm owners and parser compatibility; implement the three bounded changes.
2. Add focused deterministic and production-derived real-Codex journeys.
3. Run changed-package tests and relevant typechecks; review replies and full diff.
4. Record classification, skew proof and actual check exits; close plan and commit
   through finish-task. ReviewGPT/CI are later PR gates outside this task boundary.

## Implementation and compatibility review

Implemented at the catalog, pure policy, Web message renderer, runtime account
projection, device result serializer and operator instructions. No new state,
migration, transport fields, permission grants or dependencies. Message formatting
now happens outside the source transaction; all source and dispatch gates remain.

The snapshot producer (`hosted-runtime-authority.ts`) and parser
(`device-syncd/src/hosted-runtime.ts`) are unchanged from the branch baseline.
The runtime test feeds provider-shaped rows through that parser before projecting
the tool result. Parser proof covers missing source arrays, missing lastDataAt,
known arrival values, unknown additive fields, and malformed timestamp rejection.
Web-first retains old account-only runner results while expanding notices at Web;
runner-first reads old Web source fields while old Web retains policy authority.
No order constraint is added. Normal rollout is Web on merge, then manual runtime;
the previously established three-day response reader remains the baseline floor.

All 40 catalog entries match the supplied classification: 17 daily and 23 not
daily. Both Fitbit provider routes are daily. Seven daily entries lack direct
routes: Zepp/Amazfit, Xiaomi/Mi Fitness, RingConn, COROS, Suunto, Huawei Health and
Health Connect. They acquire no invented provider identities; Apple Health relay
coverage follows the existing Apple Health source. Health Connect stays unavailable.
The exposed firstSeenAt is when the source's current lifecycle began: an epoch-advancing
reconnect replaces it; a relink merged into a data-equivalent source keeps the earliest.

Diagnostic cause confirmed: the diagnostic read profile omits /app, where the
runner installs the CLI, while wearable reads call readFreshWearableSummaryRows,
which takes withCanonicalWriteLock and can publish projection files. Instructions
and the feedback-diagnostics skill now direct coverage questions to canonical
records. The sandbox and vault-cli wearables output are unchanged.

## Verification

All commands ran locally using synthetic data; no production services or data.

- `pnpm install --frozen-lockfile`: exit 0; fresh-checkout dependencies only.
- Device-syncd full Vitest suite: exit 0, 61 files / 1,476 tests.
- Assistant tool/diagnostic focused suites: exit 0, 45 tests.
- Runtime device-tool composed suite: exit 0, 56 tests.
- Web notice, preference, runtime authority, egress and changelog suites: exit 0,
  343 tests. After moving formatting outside the transaction, notice tests reran:
  exit 0, 31 tests.
- Device-syncd, assistant-engine and assistant-runtime package typechecks: exit 0.
- `pnpm --dir apps/web typecheck`: final exit 0. Earlier exits 2 exposed optional
  copy fields still required by the shared renderer context; corrected without
  changing the existing message templates.
- `pnpm complexity:diff`: final exit 0; no increased complexity debt. The first
  exit 1 identified optional copy fallback work inside the already-large source
  transaction; pure formatting now runs before the transaction.
- `pnpm docs:drift`, `pnpm docs:gardening`, diff whitespace and authored-content
  identifier scan: passed; gardening reports zero issues.
- Full engine/runtime direct Vitest attempts lacked prebuilt CLI/capture-worker
  artifacts. A runtime probe exited 1 and named the missing prerequisite. The
  exact session-owned test trees were verified and stopped with SIGTERM (143).
  `pnpm --dir packages/assistant-runtime build` and
  `pnpm build:test-runtime:prepared` both exited 0; the four-case runtime probe
  then passed. One pre-existing thumbnail
  stress test in the runtime rerun exceeded the standard 60-second timeout.
  The unchanged test passed alone (exit 0, 36-second body), and the entire
  158-test bridge file then passed (exit 0), without changing assertions or
  timeouts.
- Prepared `pnpm --dir packages/assistant-engine test`: exit 1, 6,132 passed,
  two instruction-budget failures, 846 opt-in skips. Shortened the device
  description without raising any budget (superseded in parent review, below). Final instruction-budget and device
  tool files passed together: exit 0, 40 tests. Final engine/runtime typecheck
  also exited 0. All three device live journeys reran against the final wording.
- Prepared `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts
  --isolate=true --no-coverage`: exit 1, 4,445 passed, the one thumbnail timeout,
  seven skips. The entire failed file subsequently passed as described above.
  These full-run exits remain failures; the focused reruns resolve every observed
  failure without claiming a second clean full-package run.

Complete initial provider input was captured at the branch baseline and candidate
using the existing credential-free usage measurement harness with the device tool
enabled for the private fixture. The temporary harness copy was removed afterward.
Both fixtures passed (exit 0): private 123,473 to 123,473 bytes, group 154,674 to
154,674 bytes (both delta 0, 0%). Deferred device registration decreased by three
bytes; its full description is not sent in the initial request. Captures include
the full native request, instructions, input and tool surface, excluding
prompt_cache_key, with identical synthetic fixtures and candidate shared adapters,
dependencies and installed Codex. No exact GPT-6.1 Sol tokenizer is configured,
so absolute/delta tokens are unavailable; no estimate substitutes for them.
No database, network or other awaited operation was added to the reply path.

Real-Codex commands used `pnpm test:assistant:live -- --test "<name>"`, each exit 0,
model `gpt-6.1-sol`, auth class `local subscription, ambient configuration`:

| Test name | Effects and reply review |
| --- | --- |
| source silence visibility: stopped delivery | One list; no mutation. Identifies old delivery without disconnection or invented cause. Ready. |
| source silence visibility: recent connection | One list; no mutation. Explains possible history import without promising completion. Ready. |
| source silence visibility: daily source preference | One list, then one 12-day save for returned google_health slug. Confirms the saved wait. Ready. |
| source silence visibility diagnostic uses canonical records over stale projections | One diagnostic; zero CLI commands; canonical snapshot unchanged. Counts canonical records and rejects stale-cache absence. Ready. |

The first stopped-delivery sample included an unrelated unavailable saved-source
lookup. The synthetic journey supplies the empty wearable read and now disables
shell tools to isolate the connection owner; the repeat passed the added
no-permission-error prose assertion. Diagnostic proof retains read-only shell
access to inspect real synthetic canonical files.

## Completion

Parent review: scoped diff, classification, permissions, source authority,
rollout, copy and synthetic replies inspected. Changelog added for expanded
private check-ins; sourcePullRequests remains empty until a PR exists. No visual
change; production archive rendering is covered by the content-only test lane.
Missing prebuilt artifacts resulted from invoking direct Vitest before its
documented prerequisite. Frog entry
`20261114134601-thumbnail-checkpoint-stress` records the unrelated shared-host
thumbnail stress-test timeout and successful unchanged isolated rerun; include
that public-safe entry with this task.

Parent review after the implementation commit: the device tool's existing
sentences were restored and only the list_accounts and configure_no_data_outreach
sentences changed, so the two murph.device ceilings were raised on purpose
(description 1350 to 1600, declaration 3150 to 3400). The three device live
journeys reran against that wording: each exit 0. A read-only deep review found
that deriving policy through the catalog resolver also accepted provider aliases,
so a preference could be saved under a slug no notice reads. The policy now
resolves the canonical stored slug only, as the old allowlist did; a regression
assertion covers the alias. Its other concern is accepted: until the runtime
deploys, an old runner still describes the preference as limited to three
providers, so the runtime deploy follows the merge directly.

All observed test failures have passing focused reruns. Parent review is complete;
close this plan and include it in the scoped commit through scripts/finish-task.
No push, PR, ReviewGPT, deployment or production access is authorized here.
ReviewGPT and exact-head CI remain later PR gates. No product question remains.

Completed: 2026-11-14
