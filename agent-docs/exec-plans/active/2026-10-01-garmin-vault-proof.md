# Verify Garmin connection and synthetic webhook persistence

Status: active
Created: 2026-10-01
Updated: 2026-10-02

## Goal

Keep real Garmin authorization, callback, persisted connection, and cleanup.
Replace upstream delivery timing with a signed synthetic activity, and require
that activity to reach the canonical vault through the ordinary hosted path.
This scope supersedes mandatory live-data availability and the unmerged
optional-empty-data proposal. No empty-data success will ship.

## Ownership and rollout

Public Murph owns the fixture delivery and canonical proof. Murph Cloud owns
the private worker/executor and versioned receipt acceptance. Land public mode
support first while the private workflow retains strict live mode, then land
the private version-3 reader and synthetic-mode selection together. Older readers
retain their strict contracts. Restore private live mode before rolling public
support back. No production member mutation or provider configuration is needed.

## Implementation

Reuse the signed Junction webhook replay helper and normal local public ingress.
Resolve the real sandbox user established by the browser callback. Send only to
a validated loopback root, with redirects disabled and an ephemeral harness-only
signing secret. Keep real signature verification, admission, managed Temporal,
private worker, importer/core, publication, and encrypted canonical readback.
Require a fresh matching day/value/unit/provenance and final cleanup before the
version-3 `synthetic_webhook_matched` receipt. Retain strict manual live mode and
its version-2 matched receipt. Logs and receipts contain no account IDs, fixture
health values, dates, raw errors, or secrets. Output identifies synthetic delivery.

## Tasks

- [x] Diagnose live empty reads, including fresh login, broad history, and permission metadata.
- [x] Consult a second model; delayed initial delivery is plausible but unproven.
- [x] Implement signed synthetic delivery and verify importer/query and boundary behavior locally.
- [x] Verify exact receipt compatibility and workflow selection in Murph Cloud.
- [x] Complete parent review, required external review, and exact-head CI.
- [ ] Diagnose the hosted synthetic persistence timeout with content-free stage evidence.
- [ ] Run the protected hosted canary and inspect persistence plus cleanup.

## Evidence and limits

Prior live runs completed authorization, persisted reload, and cleanup but found
empty provider summaries after twenty minutes. Broader ninety-day diagnostics
were also empty despite successful historical status and available resource
inventory. Those results do not establish an upstream cause or a production
vault problem. No production row contents belong here.

The first protected synthetic run completed authorization and persisted connection
reload, then reached its twenty-minute canonical-data deadline without a match.
Provider and browser cleanup followed. The failure did not expose whether
admission, runtime execution, or replica publication stalled. Follow-up evidence
adds only fixed stage labels, boolean observations, and a status-read count;
account identities, error text, fixture values, and vault contents remain private.
Code-path inspection and a second-model consultation identified a missing
prerequisite: seeding an active control account does not initialize its vault,
and runtime context rejects device-sync wakes until member.activated bootstrap.
The data canary now enqueues that real activation event, signals managed Temporal,
and waits for completion before connecting. A focused runtime regression checks
the pre-activation rejection. The protected rerun must confirm this resolves the
observed timeout; no hosted success is inferred from the code-path evidence.

The completed fresh-browser subplan records the login correction. Synthetic
webhook proof will cover the application's ingress-to-vault behavior; it cannot
qualify live Garmin delivery or its timing. The local harness uses production
code with isolated backing services, not production member storage.

## Verification

Public producer PR #3967 and the private selector/reader are merged with green
exact-head CI and passing final external review. The private preliminary review
identified a review-tool duration override; its accepted correction enforces the
five-minute floor and passed the subsequent final review. Focused proof includes
26 synthetic-delivery, live-oracle, and signed-webhook tests, 13 configuration
cases, controller tests, Cloudflare typecheck, and 43 private receipt/review-tool
tests. Full private verification also passed. Hosted persistence proof remains
pending in the protected-main canary. The activation follow-up passes 27
synthetic-delivery/live-oracle/signature tests, 13 configuration cases, and 11
runtime-context tests, including device-sync rejection before activation. Both
Cloudflare and assistant-runtime typechecks pass, as do logs guard and docs drift.
The complexity guard passes with test-only paths excluded; parent review keeps
the setup inline and the diagnostic state bounded.

Focused synthetic-delivery tests must cover actual importer/query behavior,
acknowledgement without data, invalid receipt, nonlocal target rejection,
cancellation, and secret-safe failures. Configuration tests require sandbox,
managed real worker, and an explicit receipt path in both data modes. Private
receipt tests distinguish version-3 synthetic proof from legacy live proof.
Run Cloudflare typecheck, relevant controller tests, logs guard, complexity,
docs drift, and private verification. The scoped change has no member-facing UX
or changelog effect.
