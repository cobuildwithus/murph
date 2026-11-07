# Wait for native image publication before protected integration

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Outcome and invariant

Avoid starting bounded release E2Es while their unchanged or newly compiled native
base image is still being published. Preserve exact source fingerprint/platform
admission, all scenario/replay/sandbox proofs, and short-lived credential budgets.

## Evidence and owner

A native build took longer than several hosted integration job limits. Public
Web admission minted its App token before private E2Es attempted that same cold
build. Build caching alone cannot cover the first publication or changed native
source. The public image preparation helper owns fingerprint calculation; the
public admission workflow and private integration planner own execution ordering.

## Design and scope

Extend the existing helper with a bounded, read-only registry metadata wait.
Require the exact source label and Linux/AMD64 config; never compile or pull image
layers from this path. Put public Web waiting in a separate prerequisite before
the credentialed job. Add a private companion prerequisite for worker release and
full integration using the resolved public SHA; preserve candidate and pure
Temporal paths. Existing scenario/controller limits remain unchanged. No new
state, queues, artifact authorities, package dependencies, or production mutation.
Public helper lands before its private consumer. Existing native cache PR stays
independent and the original completion owner controls merge/deploy sequencing.

## Verification

Focused image tests cover publication polling, stale/malformed config, wrong
platform, bounded registry failure, unchanged source admission, and no build.
Controller tests preserve exact candidate checks, App-token order and limits.
The live registry metadata path successfully matched the current published source
fingerprint without a Docker daemon or image build. Cloudflare typecheck and
complexity guard pass. Private companion runs its full repository verify.

## Status

Implementation complete; exact-head CI, final ReviewGPT, and coordinated release
remain with the original completion owner. Existing runner bundle latency Frog
entry reused; no duplicate friction record created. No member-visible behavior,
provider input, database, or runtime contract changed.
Completed: 2026-10-21
