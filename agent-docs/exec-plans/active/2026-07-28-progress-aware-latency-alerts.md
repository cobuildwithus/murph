# Progress-Aware Hosted Reply Latency Alerts

Status: active
Updated: 2026-07-28

## Why

The hosted reply-latency monitor currently counts one completed Linq delivery
once per ingress trace. A grouped reply can therefore inflate a single slow
reply into multiple alert incidents. It also measures only final delivery, so a
turn that sent a timely user-visible progress update can still page as if the
member received no response.

The alert should measure the actual incident: a member waiting at least 30
seconds without either an accepted progress update or the final reply.

## Scope

1. Persist an accepted assistant progress-delivery milestone onto the existing
   hosted ingress latency trace.
2. Group completed trace rows by their shared Linq delivery id before counting
   slow replies.
3. Use the earliest accepted visible response, progress or final, as the
   latency SLO boundary. A progress update after 30 seconds does not suppress an
   alert.
4. Update alert wording and focused coverage for grouped traces, early progress,
   and late progress.
5. Confirm scheduled automation work, including Flex-tier turns, remains
   outside the user-ingress reply monitor.
6. Preserve unresolved-trace handling, singleton alert ownership, delivery
   throttling, and the privacy-safe telemetry boundary.

## Ownership

- Assistant runtime records the progress-delivery milestone after Linq accepts
  the ephemeral progress message.
- Hosted execution carries the additive milestone through the existing runtime
  control protocol.
- The web latency trace store merges the milestone into existing phase data.
- The web alert monitor owns grouping and the first-visible-response SLO.

No new database table, queue, alert owner, or transcript/tool-argument logging
is introduced.

## Verification

- Focused assistant runtime and hosted execution protocol tests.
- Focused web latency store and alert-monitor tests.
- Canonical `pnpm test:diff` for all touched owners.
- Direct scenario proof that one grouped final delivery produces one incident,
  an accepted progress update before 30 seconds suppresses it, and progress
  after 30 seconds does not.
- Required product-experience review, preliminary completion-specialists
  ReviewGPT pass, parent final review, final ReviewGPT gate, CI, and merge-tree
  proof.

## Deployment

The protocol addition must be additive. Web must tolerate old runtimes that do
not emit the milestone, and new runtimes must tolerate a web deployment that
has not learned to store it. The safe order and skew behavior will be recorded
in the PR.
