# Compliance Docs

Last verified: 2026-04-29

## Purpose

This directory contains Murph's internal compliance playbooks for consumer health data incidents, vendor obligations, breach notices, and health-data tracking restrictions.

These docs are operational guardrails for engineering, product, support, and vendor-review work. They are not a substitute for counsel review before public launch, breach notification, regulator submission, or user-facing policy changes.

## Current posture

Treat Murph as likely subject to the FTC Health Breach Notification Rule (HBNR) for U.S. users unless counsel documents a narrower conclusion for a specific deployment. The working assumption is based on Murph's product shape: a non-HIPAA consumer health product that stores identifiable health-related records, supports individual-controlled health workflows, and can draw data from multiple sources such as user inputs, files, messages, labs or lab-like records, meals, supplements, and wearable/device integrations.

This assumption is intentionally conservative. It keeps incident handling and vendor contracting ready even if a later launch posture narrows the covered surface.

## Canonical files

| File | Use it when | Owner |
| --- | --- | --- |
| `ftc-hbnr-incident-plan.md` | Any suspected breach, unauthorized access, unauthorized disclosure, vendor incident, tracking disclosure, or exposed hosted/local health-data flow. | Security + privacy/legal |
| `ftc-hbnr-notice-templates.md` | Preparing consumer, FTC, media, vendor, or internal notices after the incident lead and counsel approve notification. | Privacy/legal + comms |
| `vendor-health-data-addendum.md` | Reviewing or contracting with any provider that may access, maintain, store, process, log, disclose, or destroy identifiable health data or health-context metadata for Murph. | Vendor owner + privacy/legal |
| `health-data-tracking-and-ads-rule.md` | Adding analytics, telemetry, cookies, pixels, SDKs, attribution, marketing tags, user-event pipelines, or third-party scripts. | Product + engineering + privacy/legal |

## Launch minimum

Before broad U.S. hosted launch, the minimum acceptable state is:

1. An HBNR incident commander and backup are named.
2. The vendor notice recipient email and escalation channel are active.
3. Service providers with health-data access have incident-notice clauses and no-ad/no-secondary-use restrictions.
4. Hosted health-data surfaces are free of third-party ad pixels, retargeting SDKs, and behavioral advertising tags.
5. The breach-log template exists in an access-controlled incident workspace.
6. Counsel has reviewed public privacy, terms, and consumer health-data notices for the launch configuration.

## Maintenance rules

- Re-check these docs whenever Murph adds a new hosted data surface, wearable/device provider, messaging channel, lab/file import path, support tool, analytics tool, or ad/marketing technology.
- Keep legal citations in these docs official-source-first. Use FTC, eCFR, HHS, state AG, or statutory sources before blog posts or vendor summaries.
- Do not paste raw incident facts, user identifiers, health data, screenshots, logs, support exports, tokens, or vendor payloads into these docs. Keep live incident records in the incident workspace.
- If a product decision conflicts with these docs, treat the docs as blocking until privacy/legal approves the exception in writing.

## Official references

- FTC business guidance: <https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0>
- Current eCFR rule text, 16 CFR Part 318: <https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318>
- FTC 2024 final-rule announcement: <https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule>
- FTC GoodRx HBNR enforcement announcement: <https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising>
