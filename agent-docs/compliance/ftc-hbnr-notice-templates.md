# FTC HBNR Notice Templates

Last verified: 2026-04-29

## Purpose

Use these templates only after the incident commander and privacy/legal owner decide that notice is required or likely required. Every notice must be reviewed by counsel before sending.

Do not include raw health records, tokens, provider payloads, exploit details, internal log excerpts, or unnecessary identifiers in any notice. Use plain language and only the facts needed for the notice recipient to understand what happened, what information was involved, what Murph is doing, and what the recipient can do.

## Template variables

Use consistent values across all notices.

| Variable | Meaning |
| --- | --- |
| `{{incident_name}}` | Internal non-sensitive incident title. |
| `{{discovery_date}}` | Date Murph first knew or reasonably should have known of the breach. |
| `{{breach_date_or_range}}` | Date or range when the breach occurred, if known. |
| `{{affected_population}}` | Affected users, residents, customers, or account holders. |
| `{{data_types}}` | Categories of unsecured PHR identifiable health information involved. |
| `{{third_parties}}` | Third parties that acquired or may have acquired the data, if known and safe to name. |
| `{{containment_steps}}` | Actions taken to stop exposure and prevent recurrence. |
| `{{user_steps}}` | Concrete steps users can take. |
| `{{contact_email}}` | Incident contact email. |
| `{{contact_url}}` | Incident help page or support URL. |
| `{{contact_phone}}` | Toll-free or support phone, if available. |
| `{{mailing_address}}` | Postal contact, if used. |

## Consumer notice template

Subject: Important notice about your Murph health data

```text
We are writing to let you know about a privacy and security incident involving Murph.

What happened
{{plain_language_description_of_what_happened}}

The incident occurred on or around {{breach_date_or_range}}. We discovered it on {{discovery_date}}.

Who was involved
{{third_party_description_if_known}}

Information involved
Based on our investigation so far, the information involved may have included:

{{data_types_bulleted}}

We are not including your specific health details in this notice to protect your privacy.

What we are doing
{{containment_steps_bulleted}}

What you can do
{{user_steps_bulleted}}

Questions
You can contact us using the following methods:

- Email: {{contact_email}}
- Website or in-app support: {{contact_url}}
- Phone: {{contact_phone}}
- Mail: {{mailing_address}}

We are sorry this happened. We will update you if we learn important new information that affects you.
```

### Consumer notice review checklist

Before sending, confirm:

- the notice is clear, conspicuous, and written in plain language;
- breach date and discovery date are included if known;
- third parties that acquired the data are named or described if known and safe to disclose;
- data types are specific enough to be useful without revealing raw health details;
- user protection steps are concrete;
- Murph's mitigation and prevention steps are accurate;
- at least two contact methods are provided;
- the delivery method matches the user's selected or available notice channel;
- substitute notice is planned if contact information is insufficient for 10 or more affected people; and
- the notice is consistent with FTC, state, contract, platform, and public-policy obligations.

## FTC report preparation checklist

For breaches involving 500 or more individuals, prepare the FTC report contemporaneously with individual notice. For breaches involving fewer than 500 individuals, log the breach for annual submission no later than 60 calendar days after the end of the calendar year, unless counsel requires earlier reporting.

Collect:

- Murph legal entity name and contact information;
- incident contact person;
- discovery date;
- breach date or range, if known;
- number of affected individuals;
- number of affected U.S. citizens or residents;
- affected state/jurisdiction counts;
- whether 500 or more individuals are affected;
- whether 500 or more residents of any state/jurisdiction are affected;
- data types involved;
- third parties that acquired or may have acquired the data;
- containment and mitigation steps;
- date individual notice was or will be sent;
- method of individual notice;
- media notice details, if applicable;
- law enforcement delay request, if applicable; and
- counsel-approved copy of the consumer notice.

Do not submit until privacy/legal approves the final facts and notice content.

## Media notice template

Use only when privacy/legal confirms that media notice is required, such as when a breach involves unsecured PHR identifiable health information of 500 or more residents of a state or jurisdiction.

```text
Murph is notifying residents of {{state_or_jurisdiction}} about a privacy and security incident involving certain health-related information.

Murph discovered the incident on {{discovery_date}}. The incident occurred on or around {{breach_date_or_range}}.

The information involved may have included {{short_data_types_summary}}. Murph is notifying affected individuals directly and is not including personal health details in this public notice.

Murph has taken steps to {{short_containment_summary}}.

Affected individuals can learn more by contacting Murph at {{contact_email}}, {{contact_url}}, or {{contact_phone}}.
```

### Media notice review checklist

- Confirm the 500-resident threshold for the state/jurisdiction.
- Confirm prominent media outlets serving the relevant state/jurisdiction.
- Keep the notice shorter and less detailed than individual notice when appropriate to avoid exposing extra health context.
- Coordinate with customer support and incident help pages before publication.

## Vendor notice intake template

Use this when a service provider reports a suspected or confirmed incident to Murph.

```text
Vendor: {{vendor_name}}
Vendor contact: {{vendor_contact_name_email_phone}}
Murph contract / service: {{service_description}}
Date vendor discovered incident: {{vendor_discovery_date}}
Date vendor notified Murph: {{vendor_notice_date}}
Date or range of incident: {{breach_date_or_range}}
Current status: {{active_contained_unknown}}
Systems involved: {{systems}}
Data involved: {{data_types}}
Was data encrypted? {{yes_no_unknown}}
Were keys or credentials exposed? {{yes_no_unknown}}
Affected Murph users/customers: {{known_estimated_unknown}}
Affected identifiers supplied: {{identifier_type_and_count}}
Third parties or subprocessors involved: {{third_parties}}
Containment steps completed: {{containment}}
Mitigation planned: {{mitigation}}
Evidence preserved: {{evidence}}
Vendor acknowledgment received by Murph: {{yes_no}}
Murph follow-up owner: {{owner}}
```

Ask the vendor for enough information to identify affected users without receiving unnecessary raw health data.

## Murph-to-vendor incident inquiry template

Use this when Murph learns of a vendor risk before the vendor gives complete notice.

```text
Subject: Urgent security and privacy inquiry for Murph health-data processing

Murph is investigating a potential security or privacy incident involving {{service_or_system}}. Murph may process consumer health data and may be subject to health-data breach notification obligations.

Please confirm, by {{deadline}}, whether your systems accessed, maintained, retained, modified, recorded, stored, destroyed, used, or disclosed any Murph data connected to this incident.

Please include:

1. the date you discovered the incident;
2. the date or range when the incident occurred;
3. whether Murph data was involved;
4. the categories of Murph data involved;
5. whether the data was encrypted and whether keys or credentials were exposed;
6. the affected Murph users/customers or the least-sensitive identifiers needed for Murph to match them;
7. all third parties or subprocessors involved;
8. containment and mitigation completed;
9. whether any data was accessed, acquired, disclosed, copied, retained, or used by an unauthorized party;
10. whether you have preserved relevant evidence; and
11. the name and role of your incident owner.

Please do not send raw health data unless Murph specifically requests it through an approved secure channel.
```

## Internal incident memo template

```markdown
# Incident Memo: {{incident_name}}

Date opened: {{date_opened}}
Discovery date: {{discovery_date}}
Incident commander: {{incident_commander}}
Privacy/legal owner: {{privacy_legal_owner}}
Engineering owner: {{engineering_owner}}
Evidence owner: {{evidence_owner}}
Comms/support owner: {{comms_support_owner}}

## Summary

{{short_non_sensitive_summary}}

## Systems involved

{{systems}}

## Data involved

{{data_categories_only}}

## HBNR analysis

- Murph covered posture: {{vendor_phr_related_service_provider_assumption}}
- PHR identifiable health information: {{yes_no_unknown_and_rationale}}
- Personal health record context: {{yes_no_unknown_and_rationale}}
- Unsecured data: {{yes_no_unknown_and_rationale}}
- Unauthorized acquisition/access/disclosure: {{yes_no_unknown_and_rationale}}
- Reliable evidence against acquisition: {{summary_or_none}}
- U.S. affected count: {{count_basis}}
- State/jurisdiction counts: {{count_basis}}
- FTC threshold: {{500_or_more_less_than_500_unknown}}
- Media threshold: {{states_or_none_unknown}}

## Timeline

| Date/time | Event | Source |
| --- | --- | --- |
| {{timestamp}} | {{event}} | {{source}} |

## Containment

{{containment_steps}}

## Notifications

| Recipient | Required? | Deadline | Status | Owner |
| --- | --- | --- | --- | --- |
| Individuals | {{yes_no_unknown}} | {{deadline}} | {{status}} | {{owner}} |
| FTC | {{yes_no_unknown}} | {{deadline}} | {{status}} | {{owner}} |
| Media | {{yes_no_unknown}} | {{deadline}} | {{status}} | {{owner}} |
| Vendor/customer/platform | {{yes_no_unknown}} | {{deadline}} | {{status}} | {{owner}} |

## Remediation

{{remediation_items}}

## Decision record

{{counsel_security_engineering_decisions}}
```

## Sub-500 HBNR log template

Keep this in the access-controlled incident workspace, not in the public repo.

| Incident | Discovery date | Affected count | Data types | Cause | Notice sent? | FTC annual log status | Owner |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `{{incident_name}}` | `{{date}}` | `{{count}}` | `{{categories}}` | `{{cause}}` | `{{yes_no}}` | `{{pending_submitted}}` | `{{owner}}` |

## Official references

- FTC business guidance: <https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0>
- 16 CFR Part 318: <https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318>
