# Read live admission before direct runtime wakes

Status: completed
Created: 2026-10-23

## Outcome and protected invariant

Start warm message replies sooner by omitting the Worker-to-Web claim callback
when Web can read an eligible, wakeable existing Postgres owner. Web never
reserves ownership or writes owner state before dispatch. Cold and idle wakes,
Temporal recovery, generation fencing and OIDC-only supplied admission remain.

## Evidence and design

The direct helper currently omits admission on every attempt. Reuse the coherent
owner/cutover read, the claim admission predicate and the owner response mapping.
Read before each attempt without locks, writes or external I/O in a transaction.
Exclude incomplete targets, retiring/idle owners and retention-only processing.
The existing Worker recovery loop handles a stale snapshot; prove convergence
and successor protection without changing Worker production code.

## Product UX: Patch

Outcome: replies start sooner while an existing conversation is still running.
Reaches: Linq, Telegram and Assistant Ask direct wakes; inspect voice and Temporal.
Proof: eligible warm admission, excluded states, retry refresh, failed transport
without reservation, and stale-generation recovery. No provider-input change.

## Steps

1. Hydrate checkout and inspect shared ownership and caller boundaries.
2. Add the read-only admission helper, focused Web and Worker regression proof.
3. Run local Postgres proof, relevant suites, typechecks and complexity review.
4. Update the runtime contract and plain-language changelog, review the complete
   diff, and finish with scripts/finish-task. No push, PR or ReviewGPT in this task.

## Verification and review

All focused proof passed. Frog inventory checked after dependency installation;
no new repository friction. Parent candidate review found no extra authority,
state, retries, cleanup, provider-input changes, or Worker production changes.

### Commands and exit codes

Commands below ran from the repository root. PostgreSQL commands used only an
isolated loopback database. Repeated exit codes are chronological; the final
result for every check is zero.

| Command | Exit code(s) |
| --- | --- |
| `pnpm install --prefer-offline` | 0 |
| `pnpm build:workspace:incremental` | 0 |
| `pnpm --dir packages/health-commons generate` | 0 |
| `pnpm --dir apps/web prisma:generate` | 0 |
| `scripts/frog list` after hydration | 0 |
| `createdb -h 127.0.0.1 -U postgres murph_dev_direct_wake_admission_proof_1023` | 0 |
| `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_direct_wake_admission_proof_1023 pnpm --dir apps/web exec prisma migrate deploy` | 0 |
| `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/{hosted-direct-runtime-wake,hosted-runtime-owner-route,hosted-runtime-owner-release,hosted-mailbox-wake}.test.ts` | 1 |
| `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/{hosted-direct-runtime-wake,hosted-runtime-owner-route,hosted-runtime-owner-release,hosted-mailbox-wake,hosted-onboarding-webhook-wake-direct-ensure,hosted-onboarding-linq-dispatch,voice-control-route}.test.ts` | 1, 0; 323 passed |
| `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/{runtime-processing-postgres,runtime-processing-summary}.test.ts` | 0, 0; 74 passed |
| `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/index.test.ts -t 'only accepts supplied Web admission through OIDC'` | 0; 2 passed |
| `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_direct_wake_admission_proof_1023 MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-runtime-owner-postgres.test.ts` | 1, 1, 0; 91 passed |
| `pnpm --dir apps/web typecheck:prepared` | 2, 2, 0 |
| `pnpm --dir apps/cloudflare typecheck` | 2, 0 |
| `pnpm complexity:diff` | 0 |
| `pnpm --dir apps/web changelog:generate` | 0 |
| `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx` | 0; 4 passed |
| `git diff --check` | 0 |
| `pnpm docs:drift` | 0 |

Initial failures were task-owned: existing handoff fixtures needed the new
read seam and an asynchronous dispatch assertion; the first consent fixture
had no grant to revoke; one timing assertion used the wrong property; the
Worker mock call assertion inferred an empty argument tuple. The production
projection also needed the same response parser used by the owner route to
narrow database strings to the wire type. All were fixed and rerun.

### Evidence and Product UX walkthrough

Ready at the changed boundary. Live starting/active owners with workspace
version zero are supplied using the canonical mapping. Idle, retiring,
untargeted, unprepared, deleted, legacy/draining/rolling-legacy and retention
owners omit admission. Real PostgreSQL proves inactive, suspended and
consent-revoked members are rejected by the same policy as claim. Reads work
with database read-only mode, retain the owner unchanged, and use two operations
for normal access and five for game-only access. Failed real control-client
transport leaves both empty and retained-target ownership unreserved; the next
canonical claim succeeds immediately.

The existing Worker supplied-admission proof performs zero owner callbacks.
The new stale-generation proof rejects the old wake, receives a stale exact
retirement result, re-claims canonically, then wakes the successor without
retiring its container or starting another invocation. Existing uncertain-wake
and startup protection remain unchanged. OIDC-only admission is still enforced.

Linq, Telegram and Assistant Ask share the changed handoff. Its durable Temporal
signal starts before the hint and does not await the new read. Voice reserves
through its own ensure-processing caller without admission; its route suite
passes. Temporal processing retains callback admission. No model input or reply
policy changes, so real-model proof is not relevant to this timing-only patch.

### Complexity, latency and deployment

Four source files changed, including extraction of the existing projection into
one shared module to avoid importing the command dispatcher on the wake path.
No changed function exceeds complexity 20; direct wake rises from 14 to 15.
The ordinary warm path replaces a signed callback and four claim operations
with two local database reads followed by the existing Worker request and native
wake. Ineligible owners add one coherent owner read before the unchanged claim
path; eligible-but-blocked policy may use the existing five-read fallback.
Maximum new logical reads are ten across two attempts, peak one pooled connection
per hint, zero interactive transactions and zero external work in DB scopes.
The existing client has at most two attempts for retryable database reads.
The direct command budget is recalculated after reading, within the existing
29-second hint deadline; reads use existing database connection/retry controls.
No independent database cancellation or new timeout is introduced.

Old and current Workers already accept this optional existing-admission wire
shape. No coordinated Worker rollout, migration, config or container change is
needed. Web rollback simply omits admission again. Production latency and fleet
convergence were not measured because production access and deployment are
outside this task. Post-deploy verification belongs to the parent: compare warm
route-to-dispatch timings and check normal cold/recovery outcomes.

### Brief corrections and remaining work

- Voice does not share the best-effort direct-wake helper; it has a separate
  caller and stays unchanged.
- The wakeability rule also excludes retention-only owners for default mode.
- Stale snapshots do not always immediately re-claim: startup grace and uncertain
  wake acknowledgments can return the existing retry. Proven settled/stale-owner
  recovery converges through the canonical claim loop without Worker edits.
- Local proof cannot quantify production latency savings. Read latency and
  policy races remain governed by existing native and database effect fences.
- Changelog updated: `2026-10-23` / `faster-warm-message-replies`. Content-only
  rendering passed. Its source PR list is empty because creating a PR is
  explicitly delegated to the parent; add provenance when that PR exists.
- No push, PR, ReviewGPT, production access, secrets or Temporal mutation.
  Parent owns those later release/review steps.
Updated: 2026-10-23
Completed: 2026-10-23
