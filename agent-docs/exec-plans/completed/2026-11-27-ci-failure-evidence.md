# CI failure evidence and repairs

Status: completed

## Evidence

The seven-day window ended at 05:40 UTC on November 27. The Actions API
returned 5,189 PR and main runs, including 347 with a final failure and 188
with a final cancellation. Earlier attempts and later successes were compared
by workflow, job, event and head SHA. Line numbers below refer to the raw
job logs returned by the Actions API.

| Failure | Evidence | Change |
| --- | --- | --- |
| Superseded deployment | 18 failures at the main revision check. Run 45944425362, job 140325765497 line 4559, rejected `f8f01e63`. Run 45945478876 passed on `70f6c0e4`. | Skip the production job for an ancestor of current main. Check main around the Vercel proofs, after drain and immediately before SQL. Divergence, lookup errors and failed current deployment proofs still fail. |
| Unexpanded matrix checks | Run 45934530389, checks 140294671452 and 140294670846, cancelled with zero steps. Run 45934554807 passed on the same SHA. The planner was cancelled between ready events 13 seconds apart. There were 36 cancelled placeholders. Every failed job had steps, and all 98 failed Release checks aggregates had an upstream failure. | Finish the active Host Support run and keep the newest waiting PR run. A newer head can wait for an active one. Main retains independent groups by SHA. |
| Recap render order | Run 44855136287, job 136695569171 lines 747–748. Two callers allocated scratch directories asynchronously before reaching the renderer. The second caller could acquire its guard first. Runs 45541734791, 45699784652 and 45885920071 also passed on rerun. | Allocate the fixture before both calls. The test asserts one successful render and one busy response. |
| Recap child-process timing | The full local suite failed the process-exit assertion. A 30-run macOS reproduction caught the process group still answering a PID probe after child close. A follow-up observed the encoder in the exiting state. Under load, startup could also outlast the cancellation test's wait for its fixture. | Let the real child announce when its encoder has started and its IDs are recorded. Cancel the render or advance the deadline clock on that event. Wait for the killed encoder to be reaped and require both the group and encoder to have stopped. An escaped fixture encoder would keep running for a minute. |
| Idle Codex compaction | Run 44856283131, job 136699247729 line 1071. A follow-up turn reached native Codex while a Compact turn still owned the thread. Attempt two passed. | Hold the reservation through the matching terminal turn event when the protocol supplies a turn ID. Exercise the event ordering and a native follow-up turn. |
| Local credential refresh | Run 45566299453, job 139042010881 line 820. A concurrent reader saw invalid JSON during an in-place credential refresh. Attempt two passed. | Publish the refreshed file with the existing private atomic rename, preserving the target of an existing symlink. |
| Competing PostgreSQL claims | Run 45759928032, job 139707453028 line 1816. A competing claim consumed the prepared row before the second transaction validated it. Attempt two passed. Run 45944906657 showed the same failure. | Check the typed stale-preparation outcome for the loser and require exactly one claim and zero remaining rows. |
| Expected PostgreSQL rejections | Runs 45679457292 and 45795249598, jobs 139436048301 lines 1543–1561 and 139824334648 lines 1575–1594. Consent withdrawal and canary reset produced their expected errors before the tests attached rejection handlers. | Observe both outcomes together as the database lock is released. Preserve the error-code and final database assertions. |
| MinIO cold pull | Run 45771508865, job 139744986317 lines 1375–1387. The mirror pull failed, Docker Hub denied the fallback, then the smoke job waited five minutes for a missing container. The mirror's original error was discarded. The harness used a ten-second cleanup watchdog for cold transfers. | Inspect the cache, let setup own the cancellable pull, verify fallback availability before waiting for health, and retain the selected image for restart. |

## Other signatures

- The game deletion query-plan test gained a selective fixture and real
  PostgreSQL statistics in `a8782c880b` on November 9. The audit found no
  recurrence. The game place-art race in run 45743486249 was fixed separately
  in `e6292c92c9`. The home-routing query count in run 45771508865 changed
  with a new database write and its exact expectation was updated in
  `9589798999`.
- No independent assistant-runtime load timeout appeared in the available
  failed-job logs. The clinical checkpoint belongs to its separate repair.
- Temporal production admission passed on the second attempts of runs
  44831138247, 45316111081 and 45512875773. Public jobs 136616776886 line
  950 and 138865122313 line 968 report a failed private compatibility job.
  Job 138185308903 line 956 could not establish the private run's terminal
  state. The private proof owner has the underlying diagnostics.
- Five scheduled Android canaries and both scheduled Stripe browser runs
  failed. Stripe runs 45139391233 and 45783737763 reached checkout and failed
  at the provider card fields. The green push jobs at those SHAs omit the live
  stage. Neither provider produced successful comparable proof in this window.
- Existing GitHub check rows retain their original conclusions. The
  concurrency change applies to future workflow runs. An exact-head Actions
  run and final ReviewGPT on the deployment and runtime changes belong to the
  parent after the branch is pushed.

## Verification

- The migration workflow shell bodies ran 20 times with controlled Git and
  Vercel responses. A separate real Git remote verified current, ancestor,
  divergent and malformed revisions. SQL admission was exercised with a stub.
- Three PostgreSQL concurrency cases and the competing-claim test passed 20
  runs against an isolated migrated database. The existing game deletion plan
  passed 20 times on that database. All four affected Web suites passed
  together with 103 tests.
- The native compaction follow-up, the mocked completion ordering and the
  concurrent credential refresh each passed 20 runs. The two MinIO suites
  passed all 26 tests in each of 20 runs. The pinned Linux/amd64 image was
  independently pulled and inspected. The five hosted-local harness suites
  passed together with 135 tests.
- All 24 recap renderer cases passed in each of 20 consecutive runs after
  both fixture races were repaired. The full renderer and two Codex process
  suites passed together with 71 tests.
- The release policy and bundle workflow passed 21 tests. All three packages
  passed typecheck and lint. Actionlint, Bash syntax, the docs check and
  `git diff --check` passed. `pnpm complexity:diff` reported zero added debt.
Updated: 2026-11-27
Completed: 2026-11-27
