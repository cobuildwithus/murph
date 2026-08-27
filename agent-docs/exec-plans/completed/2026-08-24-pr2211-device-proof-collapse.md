# PR 2211 Device Proof Surface Collapse

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Preserve the reviewed hosted-device recovery and privacy behavior while
removing production package surfaces that exist only to support cross-package
test composition.

## Finding Disposition

Accepted as a behavior-preserving Complexity Collapse. Production already owns
device-tool assembly in the private hosted-workspace resolver. Public package
subpaths, pass-through modules, root type exports, and an observation callback
were added only so a Cloudflare test could construct the middle of that path.
They add durable contracts without adding production capability.

The smallest correction is deletion: restore device-tool construction and
connect logging to the private resolver, remove the test-only public surfaces,
and keep the nine recovery/privacy cases through existing hosted test
composition. No requested behavior, provider boundary, retry semantic, logging
outcome, or privacy invariant changes.

## Plan

1. Delete test-only package entrypoints, wrappers, type exports, callback, and
   export-shape assertions; inline the existing behavior at its private owner.
2. Relocate the composed proof to the smallest existing test boundary without
   adding a production seam.
3. Run focused device, hosted-runtime, package-shape, typecheck, bundle/parity,
   diff/privacy, and isolated outbox-flake proof.
4. Confirm net deletion and archive this plan in one scoped local commit for
   parent review.

## Result

- Removed both test-only package subpaths, their pass-through modules, four
  root type exports, the public factory/observation callback, and their positive
  export-shape assertions.
- Restored device construction and connect logging directly to the private
  hosted-workspace resolver.
- Moved the nine transport, response-shape, action-mismatch, ambiguous-outcome,
  cancellation, and log-redaction cases to the existing private phase harness;
  the assistant-engine serializer suite continues to prove the bounded model
  envelopes and non-echo behavior.
- Focused runtime, engine, Cloudflare transport, typecheck, package-shape,
  production bundle/parity, diff/privacy, and isolated outbox tests passed.
- The executable/configuration/test correction contains 239 additions and 359
  deletions before this plan is archived: 120 net deleted lines with no new
  production owner or retry mechanism.
Completed: 2026-08-24
