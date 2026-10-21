# Preserve complete hosted snapshots during filesystem races

Status: completed
Created: 2026-09-19
Updated: 2026-09-19

## Goal and scope

Prevent disappearing filesystem entries from silently truncating hosted snapshot
inventories. Keep the existing archive format, inclusion policy, and optional
uninitialized roots. Production recovery and deployment are outside this change.

## Product UX: Patch

- Outcome: Preserve saved vault contents through hosted checkpoint and restore.
- Reaches: Members whose hosted workspace changes during snapshot enumeration.
- Proof: Synthetic real archive encryption and restore with a cache-directory race;
  selected-file and directory disappearance must reject the inventory.

## Cause and decisions

The recursive walk catches descendant ENOENT at the root boundary, accepting an
incomplete plan. Archive validation cannot detect paths absent from that plan.
Classify excluded paths before lstat, tolerate only a root absent at its initial
lstat, and propagate failures after an included entry has been observed. Reuse
existing checkpoint failure handling; add no retries, schemas, or state owners.

## Tasks and verification

1. Convert the diagnostic into normal regression coverage.
2. Cover vanished included files/directories in both roots and absent initial roots.
3. Run focused runtime-state and real Cloudflare snapshot tests, both owner
   typechecks, changelog rendering, and the complexity guard.
4. Review the candidate and prepare a draft PR for ReviewGPT and exact-head CI.

## Risks and limits

Included-entry races now fail checkpoint creation instead of accepting omission.
The existing checkpoint retry path retains authority. This does not repair an
already incomplete stored snapshot or prove the exact path of a historical race.

## Results

Implementation complete. Candidate review found no remaining in-scope defect.
Excluded-cache deletion preserves vault metadata, notes, and operator memory after
real encrypted restore. Included file/directory/root races reject planning in
both roots, initially missing roots remain supported, and cancellation preserves
its exact reason even when readdir fails concurrently.

- Runtime-state focused tests: 89 passed across four files.
- Cloudflare archive and restore tests: 41 passed across two files.
- Runtime-state and Cloudflare typechecks: passed. Cloudflare required the normal
  Prisma client generation step after refreshing the checkout.
- Changelog rendering: 10 tests passed.
- Complexity guard: passed; traversal complexity 27 to 25, debt 7 to 5.
- Privacy/diff review and git diff whitespace check: passed.

PR #3587 owns final ReviewGPT and exact-head CI evidence. Merge, deployment,
and recovery of any previously incomplete snapshot remain separate actions.
Completed: 2026-09-19
