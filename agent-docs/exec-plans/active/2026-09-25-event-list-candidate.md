# Event-list family-local candidate

Status: active; live fixture corrected, isolated measurements and full-context reply review pending
Requested runtime base: `9da96b607e7ec04925abbc8a1fbb787a7bf7b880`
Applied candidate patch SHA256: `ae39d41a7b96fad425e6cf0c91e24d048023e9b5abe663e3d09aa20a35a046b2`
Delta base: applied isolation patch `372a7cdd66cf82facef695524dc5e7cb4b2ae98fb53286fc44afac1bed37adf7`.

## Outcome and protected behavior

Event-only listing avoids unrelated full projection computation while retaining
fresh indexed reuse, exact selection/order, lifecycle collapse, default visibility,
post-filter limits and canonical commit/rollback exclusion. The public integrated
service and CLI route stay unchanged. The query owner uses the existing reentrant
canonical write lock for stale family reads; no cache, table, schema, dependency
or other endpoint is added. Parent owns measurement, acceptance and final review.

## Proof correction

This follow-up changes proof and documentation only; runtime remains the applied
candidate. All applicable benchmark/test service calls supply fixed synthetic
request IDs. Malformed event JSONL retains `VAULT_INVALID_JSONL`. The strict goal
collector reads `bank/goals/**`; its frontmatter parser treats a lone `[` as a
plain scalar, so the isolation fixture now omits the closing delimiter. Event
listing must succeed, while the global positive control must fail with
`QUERY_SOURCE_INVALID`, `frontmatter_invalid` and the exact relative source path.
Driver output keeps worker labels/hashes, not resolved paths. Driver tests retain
output mismatch detection and whole-sequence accounting without restating the
pairing loop. Production-boundary locking and lifecycle tests remain intact.

## Evidence reported by parent before this correction

The applied candidate passed 20 query tests, including cross-process cold/fresh
commit and rollback, query semantic typecheck and the public package build.
The event suite passed 9 of 13 cases; its four failures were the incorrect event
error expectations and ineffective goal fixtures corrected here. Usecases and
benchmark typechecks failed exclusively on the corrected missing request IDs.

Baseline/noise used the same production worker twice on Node 24.14.1 and pnpm
10.33.0, with two warmup and seven alternating measured pairs. All complete
output signatures matched; the cold sample had 40 items and 25,057 UTF-8 bytes.
These are baseline label comparisons, **not candidate improvements**:

| Sequence | Base/head median wall ms | Median paired head/base | Range across 14 measured trials, ms |
| --- | --- | --- | --- |
| Cold | 1424.51 / 1430.64 | 1.0150 | 1304.31–2380.36 |
| 20 event reads | 1273.69 / 1293.75 | 0.9942 | 1205.24–1845.05 |
| Event then global | 1162.56 / 1255.53 | 1.0556 | 1133.41–1563.96 |
| Global then event | 1139.59 / 1195.62 | 1.0022 | 1110.09–1446.86 |

Local checks for this correction passed five driver tests and exercised the
unchanged contracts parser: the original scalar is accepted and the corrected
fixture is rejected for its missing closing delimiter. These checks do not
replace semantic typechecking or the public-boundary suite.

## Scenario isolation and assistant-visible proof

Parent's subsequent candidate run matched complete output signatures across all
18 trial reports. All seven measured head event-only samples omitted rebuild,
metric, wearable-summary, search and publication phases. The mixed median
1069.19 / 1273.31 ms (base/head) is a **preliminary confounded observation**, not
an overhead estimate or acceptance result: earlier scenarios warmed base's global
projector while head first executed it in the mixed case. Same-worker noise
cannot expose this asymmetric history. No runtime change follows from it.

Each revision now runs each scenario in an independent, sequential subprocess
against the same immutable canonical fixture. Only query SQLite/WAL/SHM reset.
The worker accepts one enumerated scenario; cold also covers one event read, so
there are seven scenarios. First-read workload imports and service initialization
are timed. Within-scenario reuse, including warm-global's timed setup, remains.
Historical single-process timings above cannot certify the corrected comparison.

Outcome: recall two saved facts despite malformed unrelated goal frontmatter.
Reaches: a natural member request through production instructions, dynamic-tool
contracts and the shipped CLI, which executes integrated `query.listEvents`.
Proof: one successful event-list read with exact kind/date/tag selection, both
facts, no unrelated data commands, unchanged canonical state, no delivery and no
repair claims. Parent's first `gpt-6-sol` / local subscription run produced a
truthful concise reply but failed the one-read assertion after two invalid
commands. The fixture omitted the generated production CLI contract; that run
cannot establish a production invalid-call cause. A separate fixture assumption
would have parsed default TOON output as JSON after the call-count assertion.

This correction loads the built CLI manifest into the production prompt builder
and checks the event-list index and normal help guidance before any model action.
The otherwise equivalent direct-conversation context and strict one-read/no-write
checks stay intact. Executed kind/date/tag arguments and actual output facts are
asserted without assuming a serialization format; deterministic tests retain the
complete envelope/count/filter contract. No production prompt or runtime changes,
benchmark changes, or failed-call investigator issue follow from these fixture
defects. A full-production-context rerun and reply inspection remain `Hold`.

Parent reports assistant-engine semantic typecheck, benchmark semantic typechecks
at both revisions, and six driver tests pass on the applied isolation snapshot.
The corrected live journey still requires semantic checking and the focused run;
no isolated measurement result or quantitative acceptance is recorded here.

## Remaining acceptance work

Run the README's focused deterministic checks and semantic typechecks, then the
single named real-Codex journey. Inspect its printed synthetic reply and required
and forbidden effects before recording a model/auth-class-specific `Ready` verdict.
Run identical corrected workers at base/head with two warmup pairs and seven
alternating measured pairs. Require full-envelope hash/bytes/count equality;
retain 1/2/3 reads (cold = 1), 20-read stress, both mixed orders and warm-global
with setup included in total cost. Review totals and inclusive phases against
new isolated baseline/noise evidence before accepting quantitative claims.

The supplied aggregate histogram has 60 one-call, 9 two-call and 4 three-call
profiles; only 8 of those 73 profiles also contain named global readers.
Cooccurrence does not establish ordering or shared intent. Assess representative
1–3-call cost and fresh reuse without hiding repeated-scan stress or mixed-order
overhead. Prefer no new state solely to win the 20-read stress case, but reject a
material correctness or performance regression. Keep this plan active until
corrected measurements, semantic/integration checks and live reply review pass.
