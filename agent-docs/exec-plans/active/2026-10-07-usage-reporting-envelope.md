# Fit usage telemetry after trusted reporting attribution

Status: implementation verified; PR and final gates pending
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

## Verification and remaining gates

Ten composed cases cover near/exact UTF-8 bounds, small requests, trusted override,
absent-secret clearing, saturating drop counts, counter omission, immutable input,
signed final body, preserved fence headers, one request and legacy-only rejection.
The original-source run has four failures and six passing controls; the corrected
outbound and usage suites pass all 345 tests. Cloudflare typecheck, documentation
drift/gardening and the complexity guard pass. The existing request-handler
hotspot remains unchanged at 37; the moved fitting helper is 9.

Next: finish focused checks and parent review; commit the correction, owner docs,
plan and public-safe Frog entry; open the scoped PR; run final ReviewGPT and
required exact-head CI. Do not claim a production outcome from local proof.

The pinned ReviewGPT selector could not navigate the current GPT-6/Power menu
before authoring. A bare Pro label is not model proof. The dedicated lane is
reachable; preserve model verification and record a final-review blocker if the
selector remains incompatible. The Frog entry records this repository tooling
issue and belongs in the task commit.

Changelog: not applicable. This correction transports internal usage/profile
reports without changing prices, accounting policy, entitlement rules, prompts or
member-facing copy. No externally verified billing or delivery recovery is claimed.
