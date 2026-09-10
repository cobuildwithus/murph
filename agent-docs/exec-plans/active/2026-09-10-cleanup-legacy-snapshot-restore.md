# Retire live legacy hosted snapshot restoration

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Remove retired base, hot, and delta workspace restoration and snapshot materialization from the hosted runtime. Preserve v2 cold/warm restoration, null bootstrap, canonical receipt recovery, and exact checkpoint authority.

## Evidence and ownership

The current snapshot producer writes only direct-R2 v2 archives at idle shutdown. The pre-removal investigation established that canonical hosted workspace references have converged to that format. Web continues to own the latest pointer, the runtime owns restoration and checkpoint construction, and Cloudflare retains legacy object cleanup until its independent obligations drain. No private operational evidence is copied into this plan.

## Scope

- Remove private assistant-runtime legacy restore/materialization branches and their obsolete tests; convert applicable recovery fixtures to current v2 snapshots.
- Reject unsupported non-null workspace refs before local state changes or snapshot publication.
- Simplify the current artifact materializer to bounded existing-file availability plus media references. Preserve media denials and file-size/path guards; remove the now-uncalled legacy bundle fallback. The converted promoted-document retention proof exposed an existing v2 cache-membership false negative, so this correction is required to preserve that success path.
- Update live architecture, runtime protocol, and deploy guidance.
- Exclude shared legacy wire decoders, Cloudflare bundle/object GC, old upload-session cleanup, current artifact/receipt recovery, and omitted replacedSnapshotRef compatibility for older v2 producers.

## Failure and deployment

New and existing supported runners continue producing/reading v2. Before the restore-reader removal deploy, all canonical workspace pointers must be v2 and no supported serving producer may write legacy refs. Unsupported refs fail before destructive local restore; do not silently bootstrap or overwrite them. A rollback that meets the existing fleet/receipt floors and retains a v2-capable reader and v2-only writer remains compatible because this change writes no new state format. Historical legacy object cleanup retains its existing owner.

## Tasks

1. Remove retired live restore/materialization code with current state boundaries intact.
2. Preserve current recovery tests, replace obsolete fixtures, and add unsupported-ref rejection proof.
3. Run focused runtime tests, relevant typechecks, complexity guard, and documentation checks.
4. Review privacy and scope, commit, push, and open a draft PR for parent review and exact-head CI.

## Verification

- Passed the focused continuity/checkpoint/restore suites during fixture migration; the standalone restore suite passed all 23 cases.
- The broad affected-entrypoint run passed 509 of 517 tests. Five failures were retired fixture assumptions, two were existing short realtime waits that passed unchanged in isolation, and one was an optional mailbox-poll count assertion replaced with semantic ordering proof. Subsequent selected reruns passed the updated mailbox/preemption/causal-input cases.
- After fixing the existing v2 ordinary-file availability false negative, the full artifact, retention, receipt, and restore suites passed all 77 tests.
- Assistant-runtime typecheck passed. No Cloudflare implementation or shared public wire types changed.
- Complexity guard passed for all four source files; artifact maximum fell 13 to 7, snapshot maximum 60 to 56, restore maximum 23 to 17, and the deleted legacy owner fell 15 to 0.
- Documentation drift and whitespace checks passed before current-main integration. Startup and bridge integration proof remains pending; the parent owns final candidate review, ReviewGPT, and exact-head CI.
- No production actions or provider-input changes were performed.
