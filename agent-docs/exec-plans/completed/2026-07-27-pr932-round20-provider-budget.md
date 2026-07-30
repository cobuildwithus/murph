# PR 932 Round 20 Provider Budget

Status: completed

## Goal

Make the group-reply provider fence actually bounded through response-body
consumption and leave the accepted milestone as the sole group-aware owner of
the shared daily marker and exact outreach consequence.

## Accepted findings

1. The ten-second Linq timeout ended when response headers arrived, while the
   response body was consumed afterward. A group-aware transaction could
   therefore expire after provider acceptance but before durable correlation.
2. Buffered terminal-failure replay released the shared daily marker, then the
   legacy post-send path set it again even though no live signup delivery
   remained.

## Requirement-level decision

- Keep `HostedLinqDelivery` as the delivery owner and the existing group
  outreach drain as the serialization boundary.
- Consume the text-send response body inside the existing provider timeout.
- Bound every pre-provider lock in the fenced transaction and refuse provider
  entry unless the remaining transaction budget covers the full provider
  timeout plus correlation/commit margin. A refusal before provider entry rolls
  back for webhook retry.
- Give account-deletion suspension a strictly longer explicit transaction
  budget than the proved maximum fenced operation.
- For fenced group-aware effects, the accepted milestone alone writes or
  releases the shared daily marker and consumes or reopens the exact outreach.
  Retain the legacy post-send marker for generic effects.

## Work

1. Add explicit provider, lock, entry, transaction, and deletion budgets with
   one pre-provider entry check.
2. Route Linq text create/send response parsing through the timed JSON helper.
3. Remove the competing post-send marker write on the fenced path.
4. Add focused unit and real-PostgreSQL proof for stalled bodies, lock/budget
   refusal, buffered failure final state, and both deletion/reply orderings.
5. Run focused verification, canonical diff and acceptance, then push and run
   exact-head CI plus ReviewGPT.

## Evidence

- ReviewGPT round 20 reviewed `ed67f0b7a4d5` on the requested Pro model and
  returned `FINDINGS`.
- Static tracing confirms `fetchLinqApi` returned a raw `Response` before its
  timer was cleared, while `sendHostedLinqChatMessage` consumed
  `response.text()` afterward.
- Static tracing confirms buffered terminal failure releases the daily marker
  in `markHostedLinqDeliveryAcceptedBestEffort`, followed by the unconditional
  post-send marker write in `drainHostedLinqSideEffectDirect`.
- Text create/send now consume and parse the response inside the ten-second
  Linq timeout. The fenced transaction applies a 1.5-second lock timeout and
  refuses provider entry unless twelve seconds remain for the provider,
  correlation, and commit. Account-deletion suspension uses a separate
  twenty-second transaction budget.
- The accepted milestone is now the sole daily-marker and exact-outreach writer
  for fenced group-aware signup effects; generic effects retain the legacy
  post-send marker behavior.
- Focused Web typecheck and targeted lint passed. The Linq HTTP, transport, and
  account-data suites passed 142 tests, including a stalled response-body
  timeout and pre-provider budget refusal.
- The isolated worktree PostgreSQL suite passed all eight receipt/deletion
  cases, including a real stalled HTTP body while deletion waits, real drain
  contention that refuses provider entry, and buffered failure followed by a
  successful generic retry.
- The branch reconciled with `origin/main` at `62fe02fb07b2`; the only merge
  conflict preserved both current documentation entries.
- The explicit remote acceptance attempt failed before Testbox creation or
  candidate execution because the landed dispatcher supplies
  `--stop-after always` while the installed direct provider rejects that flag.
  Final canonical proof therefore uses the documented local fallback.
- After the base merge, the first local acceptance attempt exposed a stale
  worktree install: the new committed Cloudflare `undici` dependency was not
  linked locally. `pnpm install --frozen-lockfile` hydrated that dependency
  without changing repository files.
- The hydrated local `pnpm verify:acceptance` passed workspace guards and
  typechecks, all package coverage and package-boundary lanes, 6,968 Web tests,
  Web lint with zero errors, dev smoke, and the production build. It exited
  nonzero only when the unrelated Cloudflare clinical-records cancellation
  test hit its sixty-second timeout under composed load; the exact test then
  passed alone in 133 ms.
- Final local `pnpm test:diff apps/web` passed all guards, Web typecheck, 545
  test files with 6,968 passing tests and 196 skipped tests, lint with zero
  errors, dev smoke, and the production build.

Updated: 2026-07-27
Completed: 2026-07-27
