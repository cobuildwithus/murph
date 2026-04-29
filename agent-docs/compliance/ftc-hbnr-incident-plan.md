# FTC HBNR Incident Plan

Last verified: 2026-04-29

## Purpose

This is Murph's internal first-response playbook for suspected breaches of identifiable health data involving U.S. users. It is designed for the FTC Health Breach Notification Rule (HBNR), but it should be run together with any applicable state privacy, consumer health, contract, platform, payment, and security-incident obligations.

Use this playbook for hosted Murph, supported local-to-hosted flows, vendor systems, support workflows, logs, telemetry, device integrations, message/email ingress, wearable sync, imported files, and any incident where Murph may have received, processed, stored, routed, or disclosed identifiable health data.

## Covered posture

Treat Murph as likely a vendor of personal health records or a closely related consumer health app for U.S. users unless counsel documents a deployment-specific exception. HBNR applies to non-HIPAA vendors of personal health records, PHR related entities, and their third-party service providers that maintain information of U.S. citizens or residents.

Murph's working covered-data posture includes:

- user-managed health records and experiment records;
- symptoms, conditions, medications, supplements, routines, foods, meals, recipes, workouts, labs or lab-like records, samples, and measurements;
- wearable, device, sleep, recovery, heart-rate, respiration, blood-oxygen, temperature, activity, readiness, and body-state data;
- messages, emails, transcripts, attachments, photos, files, raw imports, parsed records, prompts, assistant outputs, and derived health insights;
- integration metadata that reveals health context, such as provider, device type, sync timing, connected account, webhook, OAuth, route, or event metadata;
- support artifacts, logs, analytics, traces, error reports, screenshots, and debugging exports that include health data or health-context identifiers; and
- vendor systems that access, maintain, store, process, log, disclose, or destroy the data above for Murph.

## Local, self-hosted, and hosted distinction

Local-only or self-hosted data that never reaches Murph-controlled systems may fall outside Murph's notification role for a given incident. Do not stop the analysis there. A local deployment can still create Murph-side exposure through:

- hosted onboarding, billing, invite, import, export, email, message, wearable, device-sync, or assistant-execution features;
- support requests, crash reports, screenshots, or uploaded logs;
- OAuth redirects, webhooks, token exchange, provider API calls, and connection metadata;
- hosted workspace checkpoints, encrypted artifact objects, mailbox records, runner env overrides, and usage ledgers; or
- service providers that process health-context metadata even when canonical records stay local.

For encrypted local or hosted vault material, document whether Murph or a vendor had the decryption keys, whether keys were exposed, and whether metadata alone is identifiable health information.

## What counts as unsecured data

For HBNR triage, treat identifiable health data as unsecured unless protected by an HHS-recognized technology or methodology, typically encryption or destruction.

Record the following for every incident:

- Was the data encrypted at rest, in transit, both, or neither?
- Were encryption keys, session keys, key-encryption keys, recovery keys, or decrypt-capable service credentials exposed?
- Was the data destroyed, deleted, or only scheduled for deletion?
- Did the exposed material include plaintext data, encrypted blobs, metadata, logs, URLs, cookies, tokens, identifiers, screenshots, prompts, attachments, or derived insights?
- Could the exposed data reasonably identify a person when combined with account identifiers, device identifiers, email addresses, phone numbers, wallet identifiers, IP addresses, provider IDs, or timestamps?

A blob encrypted with strong keys that were not exposed may change notification analysis. Plaintext logs, URLs, third-party events, support exports, screenshots, and vendor traces should be presumed unsecured until privacy/legal confirms otherwise.

## Incident intake

Open an incident record immediately when any employee, contractor, agent, vendor, or automated alert knows or reasonably should know about a suspected health-data exposure.

Capture these fields before debating final notification status:

| Field | Required detail |
| --- | --- |
| Incident title | Short, non-sensitive name. Do not include raw health details. |
| Reporter | Person, vendor, alert, or external report that surfaced the issue. |
| Discovery date/time | When Murph first knew or reasonably should have known. This starts the HBNR timing analysis. |
| Systems involved | App, package, route, vendor, database, object store, mailbox, provider, log, support tool, analytics tool, or integration. |
| Data classes | Use the covered-data categories above. Avoid raw values. |
| Security state | Plaintext, encrypted, destroyed, key exposure unknown, or metadata-only. |
| User count | Known, estimated, unknown, and basis for estimate. |
| U.S. affected count | Known, estimated, unknown, and basis for estimate. |
| State/jurisdiction counts | Required to assess the 500-resident media threshold. |
| Third parties | Vendors, recipients, unauthorized actors, ad/analytics platforms, model providers, or unknown. |
| Containment | What was disabled, rotated, deleted, blocked, reverted, or isolated. |
| Evidence owner | Person responsible for preserving logs and facts without expanding access. |
| Legal/privacy owner | Person responsible for notification analysis and counsel coordination. |

## HBNR decision tree

Use this as a triage aid, not as a substitute for counsel.

1. **Is Murph in scope?** For U.S. hosted users, assume yes unless counsel has documented a narrower deployment. If Murph is only a third-party service provider for another covered entity in a specific workflow, follow the vendor/service-provider notice lane.
2. **Is the information PHR identifiable health information?** Yes if it relates to health, care, wellness, condition, symptoms, tests, treatment, medication, diet, sleep, activity, body function, or similar health services and identifies or could reasonably identify a person.
3. **Is it from or in a personal health record context?** Assume yes for Murph vaults, health experiments, connected devices, wearable sync, messages, imports, hosted workspace records, and health-context logs.
4. **Is it unsecured?** Assume yes unless encryption or destruction clearly applies and keys were not exposed.
5. **Was there unauthorized acquisition, access, or disclosure?** Include cybersecurity intrusions, insider misuse, misdirected emails/messages, public object exposure, vendor leaks, unauthorized support access, accidental disclosure, and third-party tracking or analytics disclosures.
6. **Is there reliable evidence that acquisition did not and could not reasonably have occurred?** The burden is on Murph/vendor. Absence of proof is not enough.
7. **Who must be notified?** Identify affected U.S. citizens/residents, FTC timing bucket, media threshold by state/jurisdiction, vendors, customers, platforms, and contractual counterparties.
8. **What other laws apply?** Run state consumer health privacy, state breach, contract, app-store, payment, biometric, children, international transfer, and regulator obligations in parallel.

## Common reportable or escalation-worthy scenarios

Escalate to this playbook even if the final decision is uncertain:

- hosted database, R2/object storage, Durable Object, queue, mailbox, checkpoint, or workspace exposure;
- production logs or traces containing raw health data, prompts, files, wearable records, or health-context identifiers;
- support ticket, screenshot, screen recording, or exported debug bundle sent to the wrong recipient or to an unapproved vendor;
- third-party ad pixel, retargeting SDK, marketing tag, ad attribution tool, or analytics destination receiving health-context page URLs, event names, identifiers, or payload fields;
- model, search, transcription, email, messaging, auth, payment, infrastructure, or analytics vendor reports unauthorized access to Murph health data or health-context metadata;
- OAuth token, provider webhook secret, or integration account incident that could expose wearable/device/health records;
- public or guessable import/export/invite links containing health data or health-context metadata;
- misrouted email, SMS, Telegram, Linq, iMessage, or other message that includes health data or health context;
- internal access by a person who did not need the data for service operation, support, security, or legal compliance; or
- deletion/retention failure that leaves health data available to an unauthorized party.

## Scenarios that may not require HBNR notice, but still require documentation

Do not close these without privacy/legal review:

- encrypted health data is lost or exposed and keys were not exposed;
- local-only records never reached Murph-controlled systems;
- de-identified aggregate statistics cannot reasonably identify any person;
- a false-positive alert shows no access, no disclosure, and strong evidence that data could not have been acquired;
- a vendor incident affects a system that never processed Murph health data, health-context metadata, tokens, or identifiers.

## Timing requirements and internal targets

Legal timing starts on the discovery date: the first day the breach is known or reasonably should have been known by Murph, a PHR related entity, or a third-party service provider, excluding the person who committed the breach.

| Notification lane | Legal timing | Internal target |
| --- | --- | --- |
| Individuals | Without unreasonable delay and no later than 60 calendar days after discovery. | Draft by day 10 when facts permit; send earlier when facts are ready. |
| FTC, 500 or more individuals | Contemporaneous with individual notice. | Prepare with individual notice draft. |
| FTC, fewer than 500 individuals | May be logged and submitted annually no later than 60 calendar days after the end of the calendar year. | Log within 5 business days after final classification. |
| Media, 500 or more residents of a state/jurisdiction | Without unreasonable delay and no later than 60 calendar days after discovery. | Draft with individual notice if state/jurisdiction threshold may be met. |
| Vendor to Murph | Without unreasonable delay and no later than 60 calendar days after discovery under HBNR; Murph contracts should require faster notice. | Contract target: immediate escalation for active exposure, 24 hours for confirmed breach, 72 hours for suspected breach. |
| Murph to affected customer/counterparty when acting as service provider | Governed by contract and applicable law. | Notify designated contact as soon as facts are credible enough to help containment. |

The 60-day outside deadline is not a safe harbor for delay. If the required facts are ready earlier, waiting until day 60 can be unreasonable.

## First 24 hours

1. Assign an incident commander, privacy/legal owner, engineering lead, evidence owner, and communications owner.
2. Preserve evidence without broadly copying raw health data. Lock relevant logs, traces, support tickets, vendor notices, deployed artifacts, and configs.
3. Contain exposure: revoke tokens, disable affected integrations, remove public links, pause risky routes, disable third-party tags, rotate credentials, revoke sessions, quarantine objects, or block egress.
4. Start the HBNR decision tree with conservative assumptions.
5. Identify all vendors and subprocessors that may have touched affected data.
6. Create a preliminary affected-user estimate and a state/jurisdiction count plan.
7. Open counsel review for HBNR, state law, contract, and platform obligations.
8. Do not send user, regulator, vendor, or media notices until privacy/legal approves the content, unless an urgent containment notice is required to prevent imminent harm.

## First 10 days

- Complete data map and system map for the affected flow.
- Determine whether health data was plaintext, encrypted, destroyed, or key-exposed.
- Determine whether the incident is ongoing.
- Identify whether any third party acquired data, and if known, who.
- Estimate affected users and U.S. users using privacy-preserving queries where possible.
- Estimate residents by state/jurisdiction where possible.
- Collect vendor attestations and incident reports.
- Draft consumer, FTC, media, and vendor notices if notification may be required.
- Decide whether to offer user remediation such as token rotation, support guidance, provider disconnect, monitoring, or account reset.
- Document any reliable evidence supporting a no-notice decision.

## Notice content checklist

Individual notices must be plain-language and include, to the extent possible:

- what happened;
- breach date and discovery date, if known;
- name or identity of third parties that acquired the data, if known and safe to disclose;
- types of unsecured PHR identifiable health information involved;
- steps users should take to protect themselves;
- what Murph is doing to investigate, mitigate harm, protect against further breaches, and protect affected individuals; and
- at least two contact methods, such as email, website, in-app message, postal address, or toll-free phone.

Use `ftc-hbnr-notice-templates.md` for draft structure. Never include raw health data, tokens, internal-only forensic details, exploit instructions, or unnecessary user identifiers in notices.

## Vendor incident lane

When a vendor reports or may have caused an incident:

1. Confirm the vendor's contractual notice recipient and require acknowledgment.
2. Request affected-user identifiers using the least sensitive identifier that can support matching.
3. Request data types, exposure dates, discovery date, containment status, root-cause summary, subprocessors involved, and whether data was encrypted or keys were exposed.
4. Require preservation of relevant evidence and logs.
5. Require the vendor to stop unauthorized processing, delete improperly disclosed data where feasible, and get downstream deletion/containment confirmations.
6. Determine whether Murph, the vendor, or both owe notices under HBNR, state law, contract, or platform rules.
7. Record all vendor communications in the incident workspace.

## Tracking, ad-tech, and analytics incidents

Any third-party advertising, retargeting, behavioral attribution, customer-list upload, data clean-room, or analytics disclosure involving health data or health-context identifiers is a privacy incident and must be reviewed under this playbook.

Immediately:

- disable the tag, SDK, event, route, or destination;
- preserve tag configuration, event schema, payload samples with health data redacted, and destination logs;
- identify all pages, screens, APIs, and server-side events involved;
- identify whether identifiers such as email, phone, wallet, account ID, device ID, IP address, cookie ID, ad ID, or provider ID were sent;
- request deletion and downstream-use restrictions from the recipient; and
- review whether HBNR, FTC Act, state consumer health privacy laws, privacy-policy promises, and vendor contracts require notice or remediation.

The default product rule is in `health-data-tracking-and-ads-rule.md`: no ad pixels or behavioral advertising technologies on health-data surfaces.

## Evidence hygiene

- Store incident records in an access-controlled incident workspace, not general docs.
- Prefer metadata, counts, hashes, and redacted excerpts over raw data copies.
- Do not paste user health data into Slack, GitHub issues, commit messages, pull requests, public docs, or vendor tickets.
- Do not run broad user-data queries without privacy/legal approval and an explicit purpose.
- Keep a chain of custody for forensic exports and vendor reports.
- Preserve the rationale for every notification decision, including no-notice decisions.

## Closure checklist

An incident can close only after privacy/legal, security, and engineering agree that:

- containment is complete;
- affected systems are remediated or disabled;
- users, FTC, media, vendors, customers, and platforms were notified if required;
- sub-500 HBNR events were logged for annual FTC submission if applicable;
- vendor deletion or containment confirmations were requested and tracked;
- product, code, config, or process changes needed to prevent recurrence are assigned;
- public/user-facing statements are consistent with privacy policy and notice content;
- evidence and decision records are retained according to legal hold and retention rules; and
- any docs, tests, vendor clauses, or launch checklists affected by the incident are updated.

## Official references

- FTC business guidance: <https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0>
- 16 CFR Part 318: <https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318>
- FTC 2024 final-rule announcement: <https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule>
