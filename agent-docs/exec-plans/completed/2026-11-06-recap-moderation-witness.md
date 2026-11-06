# Recap moderation witnesses and read-time hiding

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal and ownership

A stored recap story that may hold a post removed for everyone is hidden from
all viewers. Existing ciphertext remains until a separately approved cleanup.
New Ops takedowns still clear affected stories in their game-locked transaction.
Generated work may publish only from sources still permitted at commit.
Already-sent chat lines and game lore are outside this clearing contract.

`recap-witness.ts` owns publication witnesses, source validity and the stored
story generation lookup. `service.ts` owns member view suppression. Derive the
read rule from existing events and entries; add no durable state or client wire.
The observed gap is that viewer-specific suppression does not hide a legacy
story after a direct entry tombstone from older Web code.

## Scope and constraints

Amend the one local commit; no push or PR. Keep the original publication,
material/seal/replay/dispatch proofs and dormant runtime retirement consumer.
Do not change the source-validity reader or regeneration admission in this
follow-up. The runner consumer remains dormant until its later activation PR.

No data migration ships here, and deploy changes no stored row. Archive the
removed SQL, README paragraph and proof 14 verbatim in the requested
`state-machine-arch-build/plans/pr6a-cleanup-held/` directory. Cleanup needs a
separate owner-approved PR. This archive is the sole requested write outside
the worktree.

## Plan

1. Archive and byte-check cleanup artifacts, then remove the migration, its
   README paragraph, proof 14 and the changelog entry/generated output.
2. Run real PostgreSQL proofs against unchanged production code. Record actual
   failures and preservation cases that already pass; never manufacture failures.
3. Share the newest accepted generation (or original lifecycle generation)
   lookup and a pure witness-membership rule between takedown and views.
4. Only non-history games with stored ciphertext and an entry removed for
   everyone trigger the two batched event reads. Preserve viewer report rules.
5. Run the requested focused suites, Web typecheck, complexity and docs checks;
   review privacy and scope, then amend with both required trailers.

## Product UX and load

Outcome: affected stories use the existing template recap for every viewer,
without deleting old ciphertext on read or deploy.
Reaches: both players, legacy and witnessed stories, Home collections and detail;
reported-only, merely legacy, withdrawn/retaken and clean-witness stories retain
existing behavior. Clean accepted regeneration becomes visible.
Proof: real `readGame`, `readHome`, `readHistory`, seal and dispatch paths, with
Prisma operation instrumentation and no read-path mocks. At most two additional
sequential event reads for all candidates; none without candidates or in history.
No new external calls, transaction, persisted state, provider input or client UI.

## Verification

Use the existing isolated loopback database `murph_test_sm_pr6a`, with
`MURPH_TEST_POSTGRES_CONCURRENCY=1`. Keep temporary artifacts inside the worktree.
Run the requested witness, late-recap, groups, report-block, chat-tool,
chat-lifecycle and service files; the assistant-runtime notification file;
Web typecheck; `pnpm complexity:diff`; `pnpm docs:drift`. Capture process exit
codes directly, without pipelines. No umbrella tests or acceptance run.

All runs used the existing isolated database above; no migration was executed
in this follow-up. Temporary logs and runtime workspaces stayed in the worktree.

The unchanged production-code run was:

```sh
pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/game-recap-witness-postgres.test.ts -t 'stored story read suppression' --reporter=verbose
```

It exited 1 twice: the initial run and a repeat after strengthening the ordinary
view/history query-count assertions. Both had eight failing cases and seven
passing preservation cases. Production code was unchanged for both runs.

| Proof | Before implementation | Final proof |
| --- | --- | --- |
| a: legacy old removal | Both players received the story instead of null. Whole-row equality (including byte-identical ciphertext) and dispatch refusal already passed. | Both see null; whole game row unchanged; chat-line fence refuses. |
| b: reported-only legacy | Passed: nonreporter sees the story, reporter sees null. | Same, with the game row unchanged. |
| c: merely legacy | Passed for both players. | Same. |
| d: withdrawn and retake | Both cases passed for both players. | Same. |
| e: excluding witness | Passed for both players. | Same, with the game row unchanged. |
| f: containing witness | Both players received the story instead of null. Four malformed-witness variants failed the same way. | All five cases hide for both players without changing the game row. |
| g: clean regeneration | Hidden phases returned the old story, including while a clean replacement was requested but not accepted. Clean acceptance already succeeded. | Two successive clean accepted generations show; newest acceptance wins, including an empty witness. Unaccepted witnesses do not control the stored story. |
| h: ordinary and batched reads | Ordinary view already passed. One and three candidate games still performed only one existing event read, not the required total of three, and exposed affected stories. | Ordinary view retains one existing event read; one or three candidates add exactly two batched reads. Mixed witnesses yield the correct per-game visibility. |
| i: bounded history | Passed, with no event-model reads and identical operation lists before/after removals. | Same. |

Preservation proofs cannot truthfully be reported as failing before the fix.
All read paths use real PostgreSQL; operation instrumentation observes the real
Prisma calls without mocking the view or witness readers.

| Command / selection | Exit | Result |
| --- | --- | --- |
| Web workspace Vitest, witness file, `--reporter=verbose` | 0 | 41 passed: 26 retained cases (including legacy takedown), 15 new cases. |
| Web workspace Vitest, `game-late-recap-postgres`, `game-groups-postgres`, `game-report-block-postgres`, `game-chat-tool`, `game-chat-lifecycle`, `game-service-postgres`, `--testTimeout=180000` | 0 | 345 passed across six files, including the existing maximum-cardinality proof. |
| `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts` | 0 | 197 passed. |
| `MURPH_TSC_WEB_CHECKERS=1 pnpm --dir apps/web typecheck:prepared` | 0 | Web typecheck passed. |
| `pnpm complexity:diff` | 0 | No added complexity debt; witness module maximum 8. Existing runtime hotspots unchanged. |
| `pnpm docs:drift` | 1, then 0 | Updated the index description for the revised scope; final check passed. |
| `pnpm --dir apps/web changelog:generate` | 1, then 0 | Removed the now-empty date directory after its sole entry was deleted; regenerated output no longer contains the item. |
| `git diff --check` | 0 | Passed. |

Prisma operation instrumentation confirms ordinary views have no added witness
read and candidate collections use two batched reads, regardless of whether one
or three games qualify. History's complete operation list is unchanged. The
original maximum-cardinality group proof remains intact. Its generated metrics
file was moved under the ignored local proof directory; existing Frog entry
`20261103110056-game-group-postgresql` owns that test residue. No new Frog issue
was needed. The existing docs-drift comparison friction is also already recorded.

## Final review and Product UX

Ready. Both players receive the template fallback for affected stories; report
suppression, legacy visibility, withdrawals, retakes and clean replacements retain
the specified behavior. All earlier proof cases remain except archived proof 14.
The source-validity reader is byte-identical to the original local commit, and
`recap-regeneration.ts` has no follow-up change. The complete branch diff has no
`apps/web/prisma/` paths and no changelog fragment. Archive copies of SQL, README
paragraph and proof 14 were byte-checked before deleting their originals.

Only this worktree and the explicitly requested cleanup archive were edited.
The single local commit is amended with both requested coauthor trailers. The
already-installed commit hook remains enabled; shared hook configuration is not
reinstalled or changed. No `--no-verify` or umbrella test command is used.

## Completion boundaries

Changelog: not applicable. This is a safety fix to an existing Ops action with
nothing new for members to use. No cleanup pass has run in production. Deploy
only changes reader and future-action behavior; an older reader can expose
historical stories again, so retain compatible readers. CI, external ReviewGPT,
production deployment and live model journeys are outside this local no-push task.
