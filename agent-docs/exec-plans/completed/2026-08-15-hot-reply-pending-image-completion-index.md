# Index image-completion candidates for hot replies

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Remove pending-event file hydration from ordinary hosted foreground replies
  when the canonical pending-input index can prove no generated-image
  completion is waiting, without changing completion ordering or introducing a
  second durable owner.

## Success criteria

- Ordinary pending inputs require one pending-index read and no pending-event
  hydration in the image-completion recovery precheck.
- A trusted image completion keeps the full pending cohort available to the
  existing route, origin, follow-up, and newest-message selector.
- State written before the projection defaults conservatively positive and the
  existing maintenance compaction computes the exact value.
- Focused assistant-runtime typecheck and Vitest proof pass.
- Exact-head CI is green, the preliminary coverage specialist has no unresolved
  accepted finding, and final ReviewGPT returns `ROUND_OUTCOME: PASS`.

## Scope

- In scope: the existing hosted pending-input index, generated-image completion
  recovery selection, focused regression tests, and the owner documentation
  needed to state persisted-state and rollout behavior.
- Out of scope: a second index or summary artifact, queue, scheduler, service,
  migration job, reconciliation loop, route index, or elimination of the
  existing pending-index JSON parse.

## Constraints

- Technical constraints: preserve completion-first ordering, same-route
  follow-ups after the trusted image origin, newest-message authority, missing
  event fail-safe behavior, and background-only repair/compaction ownership.
- Product/process constraints: use the sanctioned task worktree, preserve the
  supplied patch intent, keep identifiers out of durable artifacts, run focused
  local proof, and complete both exact-head ReviewGPT stages plus CI.

## Risks and mitigations

1. Risk: a false-negative projection could suppress a real image completion.
   Mitigation: missing pre-projection state and missing newly enqueued event data
   are positive; compaction clears the hint only from known inspected events,
   while missing indexed events preserve an existing positive value.
2. Risk: changing persisted v2 state creates a rollback floor for the prior
   strict reader after the first projected state is written.
   Mitigation: keep the field additive and old-state-readable, require immediate
   runner rollout, document the forward-fix rollback posture, and avoid a second
   compatibility owner for a derived projection.
3. Risk: optimizing the negative path changes positive completion semantics.
   Mitigation: the projection returns the complete pending cohort on a positive
   hint and leaves the established selector unchanged; focused tests retain the
   existing positive route/cohort cases.

## Tasks

1. Apply and inspect the supplied patch against current `origin/main` in the
   sanctioned worktree.
2. Confirm the state transition and rollout contract at the existing owner.
3. Run focused typecheck, regression tests, direct call-count proof, diff checks,
   and privacy scan.
4. Create and push the scoped review candidate, then open a draft PR with the
   complete intent, architecture, hot-path, state, and change-shape contract.
5. Run the preliminary coverage specialist and final ReviewGPT round 1 in
   parallel with exact-head CI; resolve accepted findings through later final
   rounds until pass.
6. Perform the parent final review, close this plan through `scripts/finish-task`,
   push the final head, prove clean mergeability, and confirm final-head CI.

## Decisions

- Reuse the hosted pending-input index as the sole canonical owner. The smaller
  O(n)-byte index parse remains; removing it would require another durable
  summary and synchronization protocol.
- Treat `hasImageCompletionCandidate` as an additive, conservative derived hint
  within the existing v2 exact-ack index. Do not add a v3 migration lane or
  compatibility subsystem; document the strict-reader rollback floor instead.
- Coverage and product experience are the applicable preliminary specialist
  lenses: the member-visible interaction and recovery semantics do not change,
  but removing foreground hydration changes ordinary reply timing. Prompt and
  frontend are not changed. The final cross-cutting ReviewGPT gate applies
  because persisted hosted-runtime state and foreground ordering are affected.

## Verification

- `pnpm --filter @murphai/assistant-runtime typecheck`
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-pending-input-index.test.ts test/hosted-runtime-turn-input.test.ts`
- `git diff --check`
- Secret-safe diff/path privacy scan and supplied-patch SHA-256 verification.
- Result: typecheck passed; both focused test files passed with 73 tests on the
  corrected head. The ordinary path records no pending-event hydration;
  completion, legacy-state, compaction, missing-event fail-safe, and established
  positive recovery cases passed.
- Result: the supplied patch SHA-256 matched
  `1493bdbe301e5c4404a10f5c81487b14d56ddfda8c18fbf2e7fc5f35bf49951f`;
  diff/whitespace and secret-safe privacy checks passed.

## Review disposition

- The preliminary specialist reviewed the immutable production candidate
  `e4587d839c4fbc8f306c9a9e4e4cac88da437dda` for 20m46s. Captured metadata
  bound the response to `gpt-5-6-pro`. Product experience passed with no
  findings; prompt and frontend were not applicable; coverage produced one
  medium finding requesting direct proof of the missing-event conservative
  branch.
- The finding was accepted and resolved at
  `ca03c9df662f545bb26e7ab63724a1e48a15f93f` with six test-only assertion
  lines proving the complete recovery cohort immediately after enqueue and
  after compaction. The specialist attachment could not be downloaded, so its
  narrowly stated correction was implemented manually and verified locally.
- Final ReviewGPT round 1 reviewed the same immutable production candidate for
  22m25s, with captured `gpt-5-6-pro` metadata, and returned
  `ROUND_OUTCOME: PASS`, `REVIEW_COMPLETE`, and no qualifying findings. The
  later correction is test-only, so the repository workflow does not require a
  new substantive final round.
- Parent review traced enqueue, parsing, merge, backfill, compaction, exact
  acknowledgement, foreground selection, and positive completion recovery. It
  found no unresolved correctness or architectural issue and confirmed that a
  stale projection can only retain old work, not suppress a completion.
- All required GitHub checks passed on the corrected candidate
  `ca03c9df662f545bb26e7ab63724a1e48a15f93f`, including release build and
  typecheck, assistant/CLI/platform coverage, release app verification, the CLI
  host matrix, billing boundaries, frontend proof, fixture coverage, and
  tracked-artifact checks.
Completed: 2026-08-15
