# Health Data Incident Runbook

Last verified: 2026-08-05

## Purpose

This runbook is the engineering entry point for suspected incidents involving Murph health data, Consumer Health Data, legal consent records, health-data tracking disclosures, vendor incidents, or unauthorized hosted processing.

Declare and coordinate the incident through `docs/incident-response.md`. incident.io is the operational source of truth; this runbook owns the health-data-specific containment and legal/privacy escalation path.

Use the detailed compliance playbooks under `agent-docs/compliance/` for legal/compliance execution. This file summarizes the engineering response shape.

## Trigger Events

Start incident triage when any of the following is suspected:

- unauthorized access, acquisition, use, or disclosure of health data;
- disclosure inconsistent with Murph privacy promises, including tracking, ad-tech, or provider secondary-use issues;
- accidental exposure of hosted workspace, mailbox, device-sync, consent, AI usage, or runtime-log data;
- vendor or subprocessor incident involving Murph health data or health-context metadata;
- consent gate bypass, stale legal-document acceptance, or unsupported processing without required feature consent;
- exposed secrets that could unlock hosted health data.

## First Hour

1. Declare the incident in incident.io as soon as the concern is credible. Mark it private when exposing its existence or details would create additional risk.
2. Preserve evidence without printing secrets or raw health payloads into chat, logs, tickets, or commits.
3. Stop the bleeding: disable affected route, job, integration, key, provider, or feature flag where possible.
4. Identify affected systems, data categories, members, vendors, time window, and whether data was encrypted.
5. Open the FTC HBNR incident plan in `agent-docs/compliance/ftc-hbnr-incident-plan.md`.
6. Notify the internal incident owner and legal/privacy reviewer.

## Engineering Containment

- Rotate exposed secrets and revoke compromised tokens.
- Remove or disable misconfigured trackers, analytics destinations, model providers, or webhooks.
- Patch authorization, consent, routing, logging, or storage defects before re-enabling affected paths.
- Preserve minimal audit evidence needed for legal review.
- Keep raw health payloads out of general-purpose logs and issue threads.

## Data Review

For each affected surface, classify:

- data categories involved;
- whether Consumer Health Data or PHI-like data was involved;
- whether the disclosure was encrypted, hashed, redacted, or readable;
- whether a vendor, subprocessor, model provider, search provider, messaging provider, or connected service received the data;
- whether the processing matched the active legal documents and consent scope.

## Notifications

Do not decide alone that no notice is required. Legal/privacy review must decide whether notices are required under consumer health data laws, FTC HBNR, state breach laws, contract terms, platform rules, or vendor agreements.

Use templates in `agent-docs/compliance/ftc-hbnr-notice-templates.md` when notice is required. Do not publish security, privacy, or health-data details to the public status page without the incident lead and legal/privacy reviewer approving the wording.

## Closeout

Before closing:

- document root cause, affected data categories, affected members, vendors, and time window;
- add regression tests or guards for the failed boundary;
- update durable docs if the incident exposed an architecture or process gap;
- verify that logs, traces, screenshots, and support materials do not retain raw health payloads unnecessarily;
- confirm deletion or retention limits for any incident-only evidence.
