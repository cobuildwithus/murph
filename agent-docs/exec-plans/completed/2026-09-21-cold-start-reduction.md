# Reduce background container running time

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Goal

Reduce aggregate hosted container running time and cost with small changes at
existing owners. The earlier target was at least 25% fewer cold starts; the
current priority is less aggregate running time.

## Success criteria

- Prove avoidable running time with bounded, redacted diagnostics and a regression.
- Preserve durable completion, exact attempt fencing, foreground conversation
  warmth, device evidence, and authoritative empty-day retractions.
- Run focused tests, relevant typechecks, and complexity review.
- Distinguish measured opportunity, local proof, and deployed savings.

## Scope

Terminal container cleanup, repeated empty device-import evidence, and existing
scheduling coalescing where evidence justifies a bounded change. Production
mutation and new scheduling infrastructure are outside current authorization.

## Constraints

Reuse lifecycle, import, mailbox, and retry owners. Add no persisted eligibility
cache, queue, or alternate scheduler. Preserve reminder and reply timing. Do not
extend container warmth to improve start counts. No private rows or identifiers
enter artifacts.

## Risks and mitigations

1. Cleanup races new work: preserve generation, lifecycle-lock, active-job, and
   durable-completion fences.
2. Empty imports carry absence authority or raw evidence: stabilize only literal
   empty collection transport metadata, retaining independent authority.
3. Counts overstate savings: match physical lifecycle evidence, distinguish
   logical passes from starts, and verify savings after an authorized rollout.

## Tasks

1. Measure lifecycle and terminal-response-to-stop durations.
2. Trace missed immediate cleanup through completion acknowledgement and fencing.
3. Correct repeated empty collection evidence at the adapter boundary.
4. Implement the smallest proven cleanup correction and test race regressions.
5. Review, run required checks, close this plan, and commit the scoped fix.

## Decisions

- Running time takes precedence over start count.
- Existing dirty-state and retained-mailbox coalescing absorb repeated webhooks;
  a new debounce layer has no demonstrated need.
- Applied imports include receipt/evidence bookkeeping, not just health changes.
- Engagement reactivation is held because it adds multiple owners; remove its
  unwired experimental helper before completion.
- Internal runtime efficiency needs no member-facing changelog unless final
  scope changes member-visible behavior.

## Outcome and parent review

The lifecycle fix adds one short check through the existing scheduler only when
an exact completed invocation has no local owner but child health still reports
work. This covers the entrypoint's completion callback drain. Ordinary expiry
retains the normal recovery cadence; generation changes, new invocations, busy
children, uncertain health, and conversation receipt deadlines retain their guards.
The entrypoint's busy count and shutdown-drain semantics do not change.

The importer fix removes only poll timestamps and window bounds from raw evidence
when every provided collection is literally empty. Resource identity and other
provider evidence remain. Persistence tests prove unchanged ingest/audit files on
replay, later real data import, preservation of nonempty unnormalized evidence,
and the existing authoritative empty-day correction behavior.

Parent reviewed the full follow-up diff and dependency graph. The changes add
20 production lines across two existing owners, with no schema, queue, cache,
configuration option, new scheduling owner, or altered callback protocol. The
experimental engagement helper was removed. Existing unrelated complexity
hotspots do not justify extraction in this change.

Product UX: Ready for the unchanged local behavior contract. Foreground warmth,
active work, reminder timing, later device data, and authoritative corrections
remain protected. No prompt, model tool, reply, or assistant send/skip decision
changes, so a real-model journey would not exercise this correction. Changelog
is not applicable: internal efficiency and corrected owner documentation only.

## Verification

- The three new callback-drain cases failed before implementation with a
  60,875ms scheduled delay; after implementation they prove a 1–2 second check,
  preservation of active work and conversation warmth, and no short-interval loop.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/runner-container.test.ts
  apps/cloudflare/test/runner-supervised-invocation.test.ts
  apps/cloudflare/test/runtime-owner-completion.test.ts
  apps/cloudflare/test/container-runtime-completion.test.ts
  apps/cloudflare/test/container-entrypoint-abort.test.ts`: 287 tests passed.
- Six targeted importer regressions passed; subsequent
  `pnpm --filter @murphai/importers test -- test/device-providers-junction.test.ts`
  ran the full package rather than applying the intended file filter:
  22 files and 741 tests passed. No further suite repetition was needed.
- `pnpm --filter @murphai/importers typecheck`: passed.
- `pnpm --filter @murphai/cloudflare-runner typecheck`: passed after the declared
  `pnpm --filter @murphai/hosted-web prisma:generate` prerequisite repaired the
  missing generated Prisma exports in the migration testkit.
- `pnpm complexity:diff --base HEAD`: passed, zero added complexity debt in both
  changed source files. The reported pre-existing hotspots are unchanged.
- `git diff --check`: passed.

## Delivery boundary

This follow-up produces a verified local commit. No production mutation, merge,
or deployment was performed. Measured idle-time exposure is an opportunity, not
proven deployed savings or a proportional bill reduction. Final ReviewGPT and
exact-head CI remain required on a published candidate before merge readiness.
After an authorized rollout, compare matched container lifecycle duration and
terminal-response-to-stop delay, alongside error and backlog recovery, rather
than treating logical wake counts or applied import counts as cost evidence.
Completed: 2026-09-21
