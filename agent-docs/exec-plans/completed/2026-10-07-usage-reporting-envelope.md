# Fit usage telemetry after trusted reporting attribution

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Outcome and invariant

Fit optional timing against the final usage-request envelope, including trusted
Worker reporting attribution, so valid accounting reaches Web. Preserve the
16,384-byte UTF-8 limit, canonical accounting, trusted attribution override,
write fencing, signing, settlement ownership, and no-retry behavior.

## Evidence and correction

The runtime sender fits timing before the Worker replaces reportingUserId.
A valid near-limit request can consequently exceed Web's unchanged limit. The
initial diagnostic fixture had an invalid profile and was replaced: the final
composed tests assert real parser retention of timing before exercising the
actual sender, outbound proxy, signature verifier and Web body reader.

The existing fitting helper now lives in one app-local module shared by the
sender and Worker. The Worker invokes it after trusted attribution and before
signing. Only optional timing summaries/counters can be removed; legacy usage,
notice target and the queued input remain intact. Legacy-only oversize continues
to reject, including after attribution growth. No new state, schema, dependency,
network call, retry, validation limit, or accounting policy is introduced.

Worker rollout is compatible with existing senders and the current Web reader;
no coordinated deployment is required. An old Worker retains the known overflow
risk. Functional merge and production deployment remain outside this task's
explicit authority; leave the correction for human merge.

## Authority and ownership

The user explicitly authorized direct implementation after the ReviewGPT authoring
blocker. This supersedes the earlier authoring requirement for this correction;
final review remains a separate repository gate. Existing PR diffs do not own
this mechanism. Primary onboarding/contact-card work remains untouched.

## Verification and handoff

Ten composed cases cover near/exact UTF-8 bounds, small requests, trusted override,
absent-secret clearing, saturating drop counts, counter omission, immutable input,
signed final body, preserved fence headers, one request and legacy-only rejection.
The original-source run has four failures and six passing controls; the corrected
outbound and usage suites pass all 345 tests. Cloudflare typecheck, documentation
drift/gardening and the complexity guard pass. The existing request-handler
hotspot remains unchanged at 37; the moved fitting helper is 9.

PR #4080 contains the correction at 13435910f1425c09e41d4c39104ce5e548a3697c.
All four required checks passed on that source head: release checks, both CLI
hosts, and the hosted Stripe billing boundary. Parent review found no additional
defect or unjustified scope.

The user requested final ReviewGPT through Computer after the pinned selector
failed before sending. A fresh canonical guarded packet retained the exact head,
full-snapshot round-one metadata, current PR body, and empty remediation deltas.
Computer verified regular Chat, selected the named GPT-6 model with Pro power,
and submitted the unchanged canonical review prompt with that packet. The review
completed in 5 minutes 47 seconds with PASS and zero findings. It inspected all
eight changed postimages and reported ten focused component probes; it did not
independently rerun the full test suite or CI. Backend model metadata was not
exposed by the native UI, so the evidence records UI selection without claiming
platform attestation. The completed task-owned tab was closed.

This closeout changes explanatory plan/index/Frog text only. Production source,
tests, configuration, schemas, and contracts remain byte-identical to the reviewed
head; the review loop's documentation exemption applies. Final closeout CI and
current-base mergeability are recorded on the PR. Human merge and canonical
deployment remain next, followed by read-only verification of the affected
durable usage outcome. Local proof and PASS do not establish production recovery.

The automatic selector compatibility issue remains open in the task's Frog
entry; the manual UI completion preserves the model and evidence requirements.

Changelog: not applicable. This correction transports internal usage/profile
reports without changing prices, accounting policy, entitlement rules, prompts or
member-facing copy. No externally verified billing or delivery recovery is claimed.
Completed: 2026-10-07
