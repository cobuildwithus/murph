# Vendor Health Data Addendum

Last verified: 2026-04-29

## Purpose

Use this addendum for any vendor, subprocessor, contractor, integration provider, infrastructure provider, model provider, support tool, analytics tool, messaging provider, email provider, wearable/device provider, or service provider that may access, maintain, retain, modify, record, store, destroy, use, or disclose identifiable health data or health-context metadata for Murph.

This is an internal clause library and review checklist. It is not a signed contract by itself. Counsel must approve final language.

## When this addendum is required

Require legal/privacy review before using a vendor that touches any of the following:

- Murph vault records, health experiments, measurements, labs or lab-like records, samples, symptoms, conditions, medications, supplements, foods, meals, workouts, routines, or outcomes;
- wearable/device data, OAuth tokens, webhook payloads, provider account identifiers, sync logs, or connection metadata;
- prompts, messages, emails, transcripts, attachments, photos, files, imports, exports, support artifacts, or generated health insights;
- health-context page URLs, event names, analytics properties, identifiers, cookies, IP addresses, device IDs, wallet IDs, email addresses, or phone numbers;
- hosted workspace checkpoints, artifact objects, mailbox records, runner env overrides, usage records, logs, traces, and error reports that can reveal health context.

When uncertain, assume this addendum is required.

## Vendor classification

| Vendor type | Examples of relevant risk | Required posture |
| --- | --- | --- |
| Infrastructure/storage/database | Plaintext or encrypted health data, logs, backups, support access. | HBNR service-provider notice, security controls, retention/deletion, subprocessor flow-down. |
| Email/messaging/ingress | Misdirected health messages, raw `.eml`, attachments, routing metadata. | Strict routing, breach notice, no secondary use, deletion support. |
| Wearable/device/provider connectors | OAuth tokens, webhook payloads, device IDs, health metrics. | Least privilege, token protection, provider-rule compliance, breach notice. |
| Model/search/transcription providers | Prompts, files, transcripts, assistant context, health inferences. | No training, no ads, limited retention, incident notice, deletion support. |
| Support/helpdesk/debug tooling | Screenshots, logs, user messages, health context. | Need-to-know access, redaction, retention limits, incident notice. |
| Analytics/error monitoring | URLs, events, identifiers, stack traces, health-context metadata. | No ad-tech, minimized events, no raw health payloads, deletion and incident notice. |
| Payments/billing | Usually non-health, but health context can leak through product names, metadata, support notes. | Avoid health descriptors, restrict metadata, incident notice if health context appears. |

## Required contract terms

### 1. Covered-status notice

Murph may be a vendor of personal health records or PHR related entity under the FTC Health Breach Notification Rule for certain U.S. consumer health-data workflows. Vendor is notified that services for Murph may involve unsecured PHR identifiable health information, and Vendor may be a third-party service provider for purposes of the Rule when Vendor accesses, maintains, retains, modifies, records, stores, destroys, uses, or discloses such information for Murph.

### 2. Limited use

Vendor may process Murph data only to provide the contracted services to Murph and for no other purpose. Vendor must not:

- sell, rent, license, disclose, or make Murph health data available to data brokers, advertising networks, ad platforms, information resellers, or similar parties;
- use Murph health data or health-context metadata for targeted advertising, cross-context behavioral advertising, retargeting, lookalike audiences, ad attribution, ad measurement, customer-list matching, data clean rooms, or advertising profiles;
- use Murph health data, prompts, files, transcripts, or outputs to train, fine-tune, evaluate, or improve general-purpose AI or ML models except where Murph has explicitly approved a service-specific use in writing;
- combine Murph data with other customer data except as strictly necessary to provide the service and only in a way allowed by the agreement; or
- process Murph data in a way inconsistent with Murph's privacy policy, user consents, product docs, or written instructions.

### 3. Security controls

Vendor must maintain administrative, technical, and physical safeguards appropriate for sensitive consumer health data, including:

- encryption in transit and at rest where technically feasible;
- strong access controls, least privilege, MFA for administrative access, and access logging;
- segregation of customer data where feasible;
- vulnerability, patch, and change-management practices;
- secure deletion and retention controls;
- incident detection and response;
- employee confidentiality obligations; and
- subprocessor review and flow-down terms.

### 4. Incident notice

Vendor must notify Murph without unreasonable delay and in no event later than the shorter of the contract deadline or the maximum deadline allowed by applicable law after discovering a suspected or confirmed security incident involving Murph data.

Murph's preferred contract deadlines:

- immediate notice for active exposure, active exploitation, public disclosure, or ongoing unauthorized access;
- 24 hours after discovery for confirmed unauthorized access, acquisition, disclosure, use, loss, or compromise of Murph health data or health-context metadata;
- 72 hours after discovery for suspected incidents that may involve Murph health data or health-context metadata; and
- prompt updates as facts develop, even if the initial notice is incomplete.

Vendor notice must be sent to Murph's designated security/privacy notice recipient and must obtain acknowledgment from Murph.

### 5. Incident notice content

Vendor notices must include, to the extent known:

- discovery date;
- incident date or date range;
- systems and subprocessors involved;
- data categories involved;
- whether data was plaintext, encrypted, destroyed, or key-exposed;
- affected Murph users/customers or the least-sensitive identifiers needed for Murph to match them;
- whether data was accessed, acquired, copied, disclosed, retained, or used by an unauthorized party;
- containment and mitigation steps;
- downstream recipients, if any;
- evidence preservation status;
- whether law enforcement, regulators, customers, or media have been or will be notified; and
- Vendor incident owner and contact details.

Vendor must not send raw health data unless Murph specifically requests it through an approved secure channel.

### 6. Cooperation

Vendor must cooperate with Murph's investigation, notification, user-support, regulator, platform, and remediation obligations. Cooperation includes:

- preserving logs and evidence;
- providing timely written updates;
- supporting affected-user matching;
- correcting false or incomplete notices;
- helping Murph meet HBNR, state law, contract, and platform deadlines;
- supporting deletion or return of affected data;
- obtaining downstream deletion or containment confirmations where feasible; and
- providing forensic summaries or third-party reports where appropriate.

### 7. Subprocessors

Vendor must disclose subprocessors that may process Murph health data or health-context metadata, flow down equivalent restrictions, and remain responsible for subprocessor acts and omissions. Vendor must notify Murph of material subprocessor changes where required by agreement.

### 8. Deletion and retention

Vendor must retain Murph data only for the period needed to provide the service or as otherwise approved in writing. Vendor must delete or return Murph data at Murph's request, contract termination, or retention expiry unless legally required to retain it. Vendor must not retain health data in logs, backups, support tickets, training data, analytics, or debugging systems longer than approved.

### 9. Audit and assurance

For vendors with meaningful health-data access, request appropriate assurance materials before production use, such as SOC 2, ISO 27001, penetration-test summary, security whitepaper, privacy/DPA terms, subprocessor list, AI/data-use terms, incident history, and deletion/retention docs.

## Procurement checklist

Before approving a vendor, confirm:

- data classes and health-context metadata are mapped;
- vendor has signed limited-use, no-ad, no-training, incident-notice, deletion, and subprocessor terms;
- vendor understands Murph may be HBNR-covered for relevant workflows;
- vendor notice recipient and Murph notice recipient are documented;
- retention defaults are acceptable and configurable;
- data residency and international transfer posture are acceptable for launch markets;
- support access is need-to-know and logged;
- product configuration disables optional ad/marketing, model-training, telemetry-sharing, public-sharing, or data-improvement settings;
- no raw health data is sent to analytics/error/support tooling unless specifically approved; and
- the vendor is listed in the vendor inventory.

## Vendor inventory template

Keep the live inventory in the access-controlled vendor workspace. This table is a template only.

| Vendor | Service | Data classes | Health data? | Health-context metadata? | Retention | Subprocessors reviewed? | Incident deadline | No-ad/no-training terms | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `{{vendor}}` | `{{service}}` | `{{data}}` | `{{yes_no}}` | `{{yes_no}}` | `{{period}}` | `{{yes_no}}` | `{{deadline}}` | `{{yes_no}}` | `{{owner}}` | `{{approved_pending_blocked}}` |

## Official references

- FTC business guidance: <https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0>
- 16 CFR Part 318: <https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318>
