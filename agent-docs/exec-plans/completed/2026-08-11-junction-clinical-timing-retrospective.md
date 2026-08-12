# Junction clinical timing retrospective remediation

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Resolve ReviewGPT round 2's repeated durability-boundary mechanism without
  adding clinical-specific state or lifecycle machinery.
- Prove that healthy daily resources cross the canonical vault boundary before
  a later retryable endpoint or hosted yield can discard their progress.

## Requirement-level retrospective

- The original requirement is timing-aware: every successfully fetched daily
  Junction resource must become canonical before an unrelated retryable
  endpoint or hosted wake expiry can discard it. A failed resource and every
  later unattempted resource remain incomplete, and retry adds recovered facts
  without revising healthy facts.
- First-reviewed head `c4143c7fd07ac4a6c93973d59657200e3964aadd`
  added seven sparse clinical defaults and their bounded canonical importer but
  inherited one post-sweep daily import boundary. Round 1 remediation at
  `de81453cc7c317f7444b3136840cb112ce22b65b` accumulated successful resources
  in memory, continued after retryable resource failures, imported once after
  the sweep, then rethrew. That fixed prompt endpoint failures only when the
  full sweep returned before cancellation.
- Round 2 proved the same mechanism still fails under production timing: the
  hosted 45-second wake budget starts before maintenance work, while one
  Junction GET permits three 15-second attempts. A near-timeout 5xx or repeated
  request timeouts can yield the job before the post-sweep import, discarding
  healthy siblings already fetched in that wake. The seven additions enlarge
  the reachable sequential sweep but are not themselves too dense to retain.
- Review-driven growth introduced an in-memory snapshot/error carrier but did
  not move the durability boundary. Retaining that carrier would preserve the
  failed architecture and invite more cancellation special cases.
- Decision: continue the existing PR by redesigning only the shared daily
  fetch/import owner. Import each successful resource immediately through the
  existing importer/core path before requesting the next resource. Stop on the
  first retryable failure or hosted yield. Delete the post-sweep isolation
  carrier; add no queue, new persisted marker, lifecycle, retry owner, or
  clinical-specific state. All seven sparse clinical defaults remain justified
  because they are bounded records and the corrected durability boundary no
  longer couples their progress to the total wake envelope.
- Production-faithful proof must traverse the actual hosted wake, service yield,
  provider, importer, and core vault owners with a near-timeout retryable 5xx
  and multiple timed-out resources. It must show healthy facts durable before
  yield, failed and later resources/history absent, recovery adding only the
  missing fact, and healthy event revisions remaining stable.

## Success criteria

- Merge the exact foundation correction head and retain no redundant clinical
  copy of post-sweep failure isolation.
- Hosted wake/service proof covers a near-timeout retryable 5xx, multiple
  request timeouts, yield/release, recovered retry, stable healthy revision,
  and absent failed/later history.
- PR disclosure separates scheduled seven-day fanout (119→168, +49;
  35,700→50,400, +14,700) from connect-time fourteen-day fanout (238→336,
  +98; 71,400→100,800, +29,400).
- Focused tests, relevant typechecks, privacy/diff/Frog checks, exact-base
  merge-tree proof, scoped commit, push, and updated PR metadata pass.

## Constraints

- Shared implementation remains owned by foundation PR #1696.
- Do not add clinical-specific queues, state, completion markers, lifecycle
  owners, retry loops, or reconciliation machinery.
- Preserve the immutable first-reviewed head and do not launch ReviewGPT.

## Tasks

1. [x] Read round 2 fully and record the timing-aware retrospective decision.
2. [x] Inspect actual hosted wake/service yield seams and prepare focused proof.
3. [x] Merge the exact pushed foundation correction heads.
4. [x] Complete production-faithful proof and corrected fanout disclosure.
5. [x] Verify, commit, push, update PR #1701, and report the exact head.

## Verification

- Production-shaped hosted wake/service Junction yield and retry scenario.
- Full Junction provider and affected hosted-execution test owners.
- Device-syncd and hosted-execution typechecks plus affected contract/importer
  proof if foundation changes require them.
- `git diff --check`, changed-file privacy scan, Frog review, and merge-tree.

## Evidence

- The clinical-specific regression fails on the current round-2 head because
  `sleep_apnea_alert`, which follows the retry-exhausted `inhaler_usage`
  resource, is still fetched and retained by the in-memory post-sweep carrier.
  The expected corrected behavior is zero later-resource requests before the
  job releases for retry.
- Foundation owns the full `runHostedDeviceSyncPass` proof with the real hosted
  service/store/importer/core path and a 45-second-equivalent injected yield.
  This branch will consume that proof from the exact merged base rather than
  duplicate its harness.
- Foundation heads `20ed59cfab0f11806fd5750b5f760c7ddc317a2c` and
  `ec6fe97c35c23c20709b1cc0440d5a1fae0dd7ed` move the daily durability
  boundary to each resource, stop on the first failure/yield, and enforce one
  invocation-local 100-reading clinical budget without another persisted
  owner.
- Production-hosted proof covers two sequential slow resources, near-timeout
  retryable 5xx responses, hosted abort/yield, durable healthy prefixes,
  absent later resources and extended-history coverage, and recovery without
  revising healthy events.
- The stacked provider/importer/core-vault proof retains exactly 100 validated,
  deduplicated clinical readings, skips later configured clinical resources at
  zero, and consumes the same 100-event payload on replay even when the vault
  write is a no-op.
- Final focused proof passed: 228 Junction provider tests, 150 Junction importer
  tests, two clinical hosted-execution integrations, one production-hosted
  wake test, one real service retry-chain test, and 56 existing-renderer
  changelog tests. Contracts, importers, device-syncd, hosted-execution, and
  assistant-runtime typechecks passed.
Completed: 2026-08-12
