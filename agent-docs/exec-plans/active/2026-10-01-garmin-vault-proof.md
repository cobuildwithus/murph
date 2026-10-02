# Verify Garmin connection and synthetic webhook persistence

Status: active
Created: 2026-10-01
Updated: 2026-10-01

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
- [ ] Complete parent review, required external review, and exact-head CI.
- [ ] Run the protected hosted canary and inspect persistence plus cleanup.

## Evidence and limits

Prior live runs completed authorization, persisted reload, and cleanup but found
empty provider summaries after twenty minutes. Broader ninety-day diagnostics
were also empty despite successful historical status and available resource
inventory. Those results do not establish an upstream cause or a production
vault problem. No production row contents belong here.

The completed fresh-browser subplan records the login correction. Synthetic
webhook proof will cover the application's ingress-to-vault behavior; it cannot
qualify live Garmin delivery or its timing. The local harness uses production
code with isolated backing services, not production member storage.

## Verification

Focused synthetic-delivery tests must cover actual importer/query behavior,
acknowledgement without data, invalid receipt, nonlocal target rejection,
cancellation, and secret-safe failures. Configuration tests require sandbox,
managed real worker, and an explicit receipt path in both data modes. Private
receipt tests distinguish version-3 synthetic proof from legacy live proof.
Run Cloudflare typecheck, relevant controller tests, logs guard, complexity,
docs drift, and private verification. The scoped change has no member-facing UX
or changelog effect.
