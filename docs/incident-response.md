# Incident Response

Last verified: 2026-08-05

## Purpose

incident.io is Murph's coordination source of truth for production incidents.
Use it to declare the incident, keep one current summary, assign response roles,
track actions, publish customer updates, attach repair pull requests, and record
follow-up work.

This repository owns the response policy. incident.io owns the live incident
state and hosts the public status page. Do not build a second incident tracker
or a custom status-page application in Murph.

- Workspace: `https://app.incident.io/withmurph/response/incidents`
- Declare: `https://app.incident.io/withmurph/incidents?createIncident=true`
- Public status target: `https://status.withmurph.ai`

## Declare Early

Declare an incident when a current or credible production problem needs
coordinated investigation, mitigation, communication, or ownership. Examples
include:

- a member-facing outage or material degradation;
- delayed, duplicated, missing, or incorrect messages or automations at scale;
- broken account access, billing, health-data connection, or web flows;
- data integrity loss or a risk of destructive writes;
- a suspected security, privacy, consent, or vendor incident;
- a recurring low-level failure whose aggregate impact is material.

Do not wait for a root cause. Start with the observed symptom and revise the
severity, scope, and summary as evidence improves. Use triage when the impact is
unclear rather than coordinating in an untracked Slack thread.

Fast declaration paths:

- Slack: `/inc <observed customer symptom>`
- Existing Slack message: **More actions → Create an incident**
- Browser: `https://inc.new`
- Murph workspace form:
  `https://app.incident.io/withmurph/incidents?createIncident=true`

Use `/incident test` for drills and configuration checks. Test incidents do not
announce broadly, appear in normal insights, or update the public status page.
Use `/inc retro` only when recording a past incident that no longer needs a live
response.

## Severity

Configure these four severities in incident.io and choose from observed or
credible impact, not how difficult the repair appears:

| Severity | Use when |
| --- | --- |
| `SEV0 Critical` | Murph is broadly unavailable, member safety or privacy may be at immediate risk, data integrity may be irreversibly harmed, or a confirmed compromise requires urgent containment. |
| `SEV1 Major` | A core member journey is unavailable or materially wrong for a meaningful cohort, with no dependable workaround. |
| `SEV2 Degraded` | Impact is partial, limited in scope, or has a reasonable workaround, but coordinated response and communication are still useful. |
| `SEV3 Minor` | Active impact is low, but the problem benefits from a named owner, timeline, or cross-functional coordination. |

When uncertainty could conceal irreversible harm, start higher and lower the
severity later. Severity is independent from confidentiality: a private
security or health-data incident still needs an impact-based severity.

## Public Status Page

The public page should be hosted by incident.io at `status.withmurph.ai`. Keep
its components recognizable to members rather than mirroring internal services:

1. Messaging
2. Web app
3. Health data connections
4. Accounts and billing

The shared public footer reads only incident.io's fixed public summary endpoint
from the browser. Keep that request bodyless and queryless, retain the global
`strict-origin` referrer policy, and allow only the exact status-page origin in
`connect-src`. The request must not carry a page path, query, fragment, account
data, prompt, health content, or message content. Keep incident.io's resulting
technical-data processing disclosed in the public subprocessor register.

Publish when members are currently affected and a shared update will help them
understand the symptom, scope, workaround, or recovery. A customer-facing
`SEV0` or `SEV1` normally belongs on the page immediately. Publish a `SEV2`
when the duration, support volume, or affected cohort makes a public update more
useful than individual replies.

Use incident.io's public lifecycle consistently:

- **Investigating** — the symptom is known but the cause or remedy is not.
- **Identified** — the cause or corrective action is understood and work is in
  progress.
- **Monitoring** — service should be back to normal while verification
  continues.
- **Resolved** — member impact has ended and recovery is confirmed.

Public updates must describe verified member impact in plain language. State
what is affected, what is not affected when useful, any safe workaround, and
when the next update will arrive. Do not publish speculative causes, internal
provider names, raw logs, secrets, exploit details, member identities, message
content, or health data.

Set the next update time whenever an update is posted. While impact is active,
do not leave a `SEV0` or `SEV1` without an update for more than 30 minutes, or a
published `SEV2` for more than 60 minutes, even when the update is simply that
investigation continues.

Suspected security, privacy, consent, or health-data incidents are declared
internally immediately, but public wording requires the incident lead and the
legal/privacy reviewer. Never delay containment while deciding what to publish.

## Response Roles

Assign roles explicitly for `SEV0` and `SEV1`. One person may hold multiple
roles on a small team, but ownership must remain clear.

- **Incident lead** — owns severity, priorities, decisions, and the current
  summary; protects responders from distraction.
- **Technical lead** — owns diagnosis, containment, mitigation, and recovery
  proof.
- **Communications lead** — owns internal and public updates and the next-update
  promise.
- **Scribe** — maintains the timeline, decisions, actions, and links needed for
  later review.

## First Ten Minutes

1. Declare the incident from the observed symptom.
2. Set severity, impacted components, start time, and one incident lead.
3. Write a short current summary that separates known facts from unknowns.
4. Contain irreversible harm first; prefer a safe rollback, disablement, or
   traffic reduction over speculative repair.
5. Preserve the minimum useful evidence without copying secrets or private
   payloads into Slack, incident.io, GitHub, or public updates.
6. Publish the public symptom and next-update time when the status-page rule
   applies.
7. Create or assign the first concrete actions and ask for help early.

Suggested initial summary:

```text
Impact: <who is affected and what they observe>
Started: <best known time, with timezone>
Current action: <containment or investigation underway>
Known: <verified facts>
Unknown: <important open questions>
Next update: <time>
```

## During The Incident

- Keep coordination in the incident channel and incident.io. Do not create a
  second source of truth in a private thread, issue, document, or chat.
- Use `/incident update` for meaningful state changes and scheduled progress
  updates.
- Record decisions and actions as they happen; do not rely on memory after the
  incident.
- Link dashboards, traces, deploys, and logs by reference. Keep credentials and
  private payloads out of the incident record.
- Paste each repair pull request into the incident channel so the incident.io
  GitHub integration attaches it and reports merge state.
- Re-evaluate severity, scope, and public components when evidence changes.
- Prefer restoring safe member value over completing a perfect root-cause
  analysis during active impact.

## Security, Privacy, And Health Data

For any suspected unauthorized access, use, disclosure, consent bypass, exposed
secret, vendor incident, or health-data processing problem:

1. Follow this runbook to declare and coordinate the incident.
2. Immediately read `docs/health-data-incident-runbook.md`.
3. Open `agent-docs/compliance/ftc-hbnr-incident-plan.md` for the legal/privacy
   decision path.
4. Mark the incident private when exposing its existence or details would create
   additional risk.
5. Do not decide alone that notification is unnecessary.

The general incident record may contain sanitized operational facts and links
to restricted evidence. It must not contain raw health payloads, legal names,
access tokens, private keys, or other sensitive evidence.

## Resolution And Follow-Up

Move the public page to **Monitoring** only after the expected member experience
has recovered. Resolve the public incident and the internal incident only after
recovery is verified and rollback or forward-fix risk is understood.

Before closing:

- record impact, start and end times, detection path, mitigation, and recovery
  proof;
- identify root cause and contributing conditions without blame;
- note what slowed detection, declaration, containment, or communication;
- export durable follow-ups to GitHub with an owner and priority;
- attach the final repair PRs and verify their deployment state;
- update tests, alerts, runbooks, or architecture only where the incident proved
  a real gap;
- remove or time-bound incident-only sensitive evidence.

Write a post-incident review for every `SEV0`, every `SEV1`, and any recurring
`SEV2`. The review should optimize for fewer repeat failures, not more process.

## One-Time incident.io Setup

These settings are dashboard- or DNS-owned and cannot be completed by a repo
commit. Keep tokens and provider credentials out of this repository.

- [ ] Connect the Murph Slack workspace and confirm the incident announcement
  channel.
- [ ] Connect the `cobuildwithus` GitHub organization under
  **Settings → Integrations → GitHub**.
- [ ] Configure the four severities in this document.
- [ ] Keep the declaration form minimal: observed symptom, severity, impacted
  component, and optional summary. Add incident types or catalog machinery only
  when repeated incidents prove they improve response.
- [ ] Create a public status page named **Murph** with the four member-facing
  components above.
- [ ] Add the Murph logo, privacy policy, terms of use, support link, and enable
  search indexing when the page is ready to launch.
- [ ] Set the custom domain to `status.withmurph.ai`. Add the exact `CNAME` and,
  when requested, temporary verification `TXT` record shown by incident.io,
  then use its **Check** action to verify the domain and certificate.
- [ ] Review the **Publish to status pages** permission. Keep publishing
  available to active responders now; narrow it to incident/comms leads if the
  responder group grows.
- [ ] Enable incident.io's built-in update and status-page nudges, aligned to the
  cadence in this runbook.
- [ ] Run `/inc tutorial`, then `/incident test`, and verify roles, actions,
  GitHub attachments, and resolution behavior.
- [ ] Run one announced low-impact drill before relying on the public status
  workflow; test incidents intentionally cannot exercise status-page publishing.

Do not add an incident.io API key, declaration script, Terraform provider, or
custom status-page host until a concrete automation need proves that the native
Slack, dashboard, workflow, and hosted status-page paths are insufficient.
