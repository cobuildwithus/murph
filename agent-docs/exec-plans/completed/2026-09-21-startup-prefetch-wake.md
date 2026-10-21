# Preserve covered startup mailbox prefetch

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and invariant

Outcome: avoid a second startup mailbox fetch when an authenticated mailbox wake is already covered by the prefetched response.
Reaches: established cold conversations with duplicate mailbox wakes; newer or unknown work retains a fresh fetch.
Proof: composed restore/import tests plus wake coalescing and wire compatibility tests, with relevant typechecks.

## Existing owners and cause

The startup importer discards every prefetch when any wake is pending. Wake transport currently drops the existing reconciliation lane sequences, so local timing cannot prove coverage. Temporal remains the wake owner, Web remains mailbox authority, and the existing importer owns staging and cursor progress.

## Scope and design

- Carry optional complete conversation/system mailbox high-water hints from mailbox-only reconciliation through authenticated ensure and native wake transport.
- Coalesce hints by lane maximum. Any unknown or non-mailbox wake removes the hint for the entire pending burst.
- Reuse only after existing cursor, lane, and limit checks and response high-water coverage. Preserve bootstrap, cancellation, failure fallback, and importer validation.
- No new durable state, query, wake owner, direct-wake policy, prompt, or provider behavior.
- Old producers or containers omit hints and retain the existing fresh-fetch behavior. Consumer changes must precede the optional Temporal producer.

## Tasks

1. Add bounded optional hint and transport/coalescing proof.
2. Select covered startup prefetch and prove covered/newer/unknown/failure paths.
3. Update current protocol owner, run focused tests and typechecks, and hand off for parent review and scoped commits.

## Verification

- `pnpm --dir packages/assistant-runtime test test/hosted-runtime-workspace-entrypoint-restore.test.ts test/hosted-runtime-wake-coverage.test.ts test/hosted-runtime-mailbox-import.test.ts`: 84 passed. Covered wakes use one fetch; unknown, newer lane watermarks, mixed bursts, cursor mismatch, and speculative failures retain fallback. A newly arrived conversation item is staged by the fresh fetch. Bounded-prefix coverage retains item-only cursor progress and immediate backlog continuation; abort propagates.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/runtime-processing-postgres.test.ts`: 93 passed. After simplifying notification construction, the changed container file's 62 tests passed again.
- `pnpm --dir packages/hosted-execution test test/hosted-orchestration-control.test.ts`: 28 passed.
- `pnpm --dir packages/assistant-runtime typecheck`, `pnpm --dir packages/hosted-execution typecheck`, and `pnpm --dir apps/cloudflare typecheck`: passed. Cloudflare's first check required the normal local `pnpm --dir apps/web prisma:generate` prerequisite; no database connection or migration was needed.
- `pnpm complexity:diff`: passed; the existing container request handler decreases from 103 to 102. Other changed existing hotspots do not grow. The notification constructor removes duplicate live/buffered shape assembly.
- `git diff --check`: passed.

Real-model proof is not applicable: only deterministic mailbox fetch selection changes; prompts, tools, and replies remain owned by existing paths. No provider-visible content is added or removed. No foreground network or database operation is added; coverage awaits only the already-running speculative response. Unknown wakes keep the original fresh-fetch path.

## Product UX walkthrough and limits

Ready for the deterministic covered, newer, unknown, mixed, failure, and cancellation journeys above. Coverage does not advance cursors or bypass importer user/sidecar/consumed validation. Existing bounded import and system barriers remain authoritative.

This is local implementation proof, not deployed latency proof. Historical wake eligibility cannot be established from timing alone; a mailbox-only hint would be omitted for due, unknown, or control work. No specific latency saving is guaranteed for a past invocation.

The private Temporal producer is a separate local patch using the existing signed HTTP boundary and current validated reconciliation facts. Deploy the public Worker/container consumer first. Disable or roll back the producer before restoring an old strict ensure parser. No push, publication, PR, or deployment is part of this task.

Changelog: no public release entry for this local consumer foundation; current production producers supply no hint, and the paired producer has not shipped. The eventual paired release can describe faster eligible cold replies after rollout evidence; no present-tense production claim is made here.

Completed: 2026-09-21
