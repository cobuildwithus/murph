# Retire completed idle previous-release runners

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and protected invariants

Outcome: completed background work on a previous release can retire and recover on the active image instead of repeatedly retaining an obsolete shell for an overdue wake.
Reaches: post-completion container lifecycle only; active foreground work, recent conversation warmth, exact slot ownership, and canonical completion recording remain protected.
Proof: synthetic previous/active release cases with overdue and immediate wakes, completion acknowledgement, active children, conversation warmth, and unavailable health; focused lifecycle tests and typecheck, final ReviewGPT, exact-head CI, then protected Worker deployment and runtime observation.

## Owner and evidence

RunnerContainer owns completion cleanup and serializes it with native lifecycle changes. Its pending-wake optimization returns before the ordinary idle checks for every release. A completed previous-release invocation with an overdue wake therefore renews warmth repeatedly and cannot pick up the active image. The regression must exercise invoke plus the matching completion-recorded callback, not a copied helper.

## Smallest correction

Derive previous-release status from existing deployment metadata and scoped release identity. Apply pending-wake warmth retention only when the container is not the previous release. Reuse the existing completion barrier, interaction-generation checks, active-operation/child checks, conversation lease, and native cleanup owner. Add no state, endpoint, process supervisor, admission authority, or quota-transfer machinery.

## Failure, compatibility, and scope

Unknown health or racing work continues to retain the shell. Active/candidate and legacy metadata behavior remains unchanged. Previous warm foreground sessions remain valid until their existing completion and idle checks permit retirement. The Worker consumes the already-deployed runner health shape; an old child without warmth evidence stays protected. A Worker-only deployment preserves runner images and release pointers, with existing smoke and convergence gates. No manual process stop or Temporal mutation is part of this correction.

## Tasks

1. Prove the overdue-wake retention defect through the real completion path.
2. Derive the release-specific retention choice and cover protected journeys.
3. Update the lifecycle owner documentation and complete focused verification.
4. Complete final review and exact-head CI, deploy through the protected owner, and check recovery.

## Verification

Pending focused reproduction, lifecycle tests, typecheck, complexity guard, final ReviewGPT, and exact-head CI. Production recovery remains separate from local proof.
