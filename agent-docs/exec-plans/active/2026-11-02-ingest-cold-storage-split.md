# Cold-history reader-first split and verification

Status: reader/preserver candidate; independent commit verification pending
Updated: 2026-11-02

## Correction and authority

The earlier implementation report remains historical evidence, following this
repository's completed-plan convention. This follow-up supersedes its rollout
advice: an old runner does not merely read partial history. Its parser discards
`integration-ingest` entries, and its next checkpoint rewrites the catalogue
without them, silently losing workspace history and orphaning encrypted objects.

The requested checkout was rebased onto freshly fetched `origin/main` at
`9d1de9bed8` without conflicts. Only two local commits are authorized; no push,
PR, deployment or other checkout changes. Both commit messages must end with the
requested coauthor trailer.

## Split

1. Reader/preserver: database and protocol expansion, catalogue preservation,
   verified lazy reads, retryable failures, write admission, erasure/export proof,
   documentation. No cold candidate-discovery code exists in this commit. Existing
   inline months remain inline. Tests seed future producer references explicitly.
2. Producer: restore closed-month candidate discovery and change idle maintenance
   to leave the current month unarchived. No runtime flag or alternative catalogue.

Commit 1 includes an archive extraction -> catalogue merge -> checkpoint -> archive
extraction regression. It compares the complete cold entry unchanged and proves
no upload, download or deletion happened. A separate encrypted snapshot test
exercises the actual tar.zstd encryption/restore path and subsequent lazy read.

## Verification and rollout

Build and typecheck affected packages and run focused suites for each commit.
After creating commit 1, detach this same checkout at its SHA and run its checks
with no producer changes present; return to the same branch before commit 2.
Record exact commands, pass counts, per-commit files and rollout boundaries in the
completed follow-up report. Use the requested scoped committer, never push.

Deploy commit 1 completely: database expansion, Web acceptance, Worker/runner
reader-preserver fleet, and drain earlier images. Only then deploy commit 2.
Commit 1 may roll back to the prior inline-only release before any producer runs.
Once any cold reference is published, commit 1 is the rollback floor for both
stages. Commit 2 can safely roll back to commit 1, which continues to preserve and
materialize history but creates no new cold references. Do not downgrade the
schema/parser below the reader floor while sparse snapshots remain.
