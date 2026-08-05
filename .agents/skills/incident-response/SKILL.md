---
name: incident-response
description: Use when a production outage, degraded service, data-integrity concern, security or privacy event, vendor failure, or other coordinated incident needs to be declared, updated, resolved, reviewed, or linked to GitHub through incident.io.
---

# Incident Response

Read `docs/incident-response.md` before acting. If health data, consent,
tracking, exposed credentials, or unauthorized processing may be involved, also
read `docs/health-data-incident-runbook.md` and
`agent-docs/compliance/ftc-hbnr-incident-plan.md`.

incident.io is the live coordination source of truth. Do not create a parallel
incident record in a GitHub issue or ad hoc document.

## Default Workflow

1. Capture the observed symptom, best-known start time, current member impact,
   scope, and any safe workaround. Keep unknowns explicit.
2. Choose severity from `docs/incident-response.md`. Start higher when
   uncertainty could conceal irreversible harm.
3. Declare immediately through the first available path:
   - Slack: `/inc <observed customer symptom>`
   - Browser: `https://inc.new`
   - Workspace form:
     `https://app.incident.io/withmurph/incidents?createIncident=true`
4. Set the incident lead, impacted member-facing components, current summary,
   and next-update time.
5. Publish to `status.withmurph.ai` when the public-status rule applies. Use
   verified symptom and impact language, not a guessed cause.
6. Track response actions in incident.io. Paste repair PR links into the
   incident channel so the GitHub integration attaches them.
7. Move through Investigating, Identified, Monitoring, and Resolved based on
   observed recovery, not optimism.
8. Export durable follow-ups to GitHub before closing.

If direct incident.io or Slack access is unavailable, do not claim the incident
was declared. Return the exact ready-to-run `/inc ...` command, severity,
components, initial summary, and declaration URL so a responder can declare it
without re-triaging.

## Safety Rules

- Never paste secrets, credentials, raw authorization headers, private keys,
  full private logs, member identities, message content, or health payloads into
  incident.io, Slack, GitHub, or a public status update.
- Declare suspected security, privacy, consent, and health-data incidents
  internally without waiting for legal analysis. Public wording requires the
  incident lead and legal/privacy reviewer.
- Do not delay containment to perfect the title, severity, summary, or public
  copy. All can be revised.
- Do not resolve while member impact is unverified or only theoretically fixed.
- Use `/incident test` for drills. Use `/inc retro` only for a past event that no
  longer requires live response.

## Declaration Packet

When preparing a declaration for another responder, use this compact shape:

```text
Title: <observable symptom, not presumed root cause>
Severity: <SEV0-SEV3>
Impact: <who is affected and what they observe>
Started: <best known time and timezone>
Components: <Messaging | Web app | Health data connections | Accounts and billing>
Current action: <containment or investigation>
Known: <verified facts>
Unknown: <important open questions>
Next update: <time>
Command: /inc <title>
```

## Status Update Shape

```text
Status: <Investigating | Identified | Monitoring | Resolved>
Impact: <current member-visible effect>
Change: <what has materially changed since the last update>
Action: <what responders are doing now>
Next update: <time, unless resolved>
```

Keep updates short, factual, and useful to someone who has not read the incident
channel.
