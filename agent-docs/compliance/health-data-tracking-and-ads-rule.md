# Health Data Tracking and Ads Rule

Last verified: 2026-04-29

## Hard rule

Do not place or configure third-party advertising pixels, retargeting tags, behavioral advertising SDKs, customer-list matching, ad attribution, ad measurement, data clean-room connectors, or marketing-event destinations on any Murph surface, API, route, event, log, or workflow that receives, displays, uploads, imports, syncs, sends, infers, or routes health data or health-context metadata.

This rule applies to client-side scripts, server-side events, tag managers, reverse proxies, SDKs, analytics destinations, URL beacons, conversion APIs, event-forwarding pipelines, CRM syncs, customer-list uploads, and manual marketing exports.

## Why this exists

Murph handles consumer health data and health-context metadata. Disclosing identifiable health information to third-party advertising or tracking systems can create an unauthorized disclosure and can trigger health-data breach analysis, user notice obligations, FTC scrutiny, state consumer health privacy obligations, and privacy-policy violations.

## Always prohibited on health surfaces

The following are prohibited when the page, screen, route, API, event, or payload includes health data or health context:

- Meta/Facebook Pixel, Conversions API, custom audiences, or event forwarding;
- Google Ads tags, Floodlight, remarketing, enhanced conversions, or advertising features;
- TikTok, Snap, X/Twitter, LinkedIn, Pinterest, Reddit, or similar ad pixels and conversion APIs;
- customer-list uploads using email, phone, wallet address, device ID, cookie ID, advertising ID, or other identifiers for health-related audiences;
- ad attribution or marketing measurement tools that receive health-context URLs, event names, metadata, or identifiers;
- third-party analytics configured with advertising features, cross-site tracking, data sharing for ads, or audience building;
- tag managers that allow non-engineering users to inject third-party tags onto health surfaces;
- behavioral advertising SDKs in mobile, web, hosted, local, or embedded flows;
- data clean-room, enrichment, identity-resolution, or lookalike tooling for health-related users; and
- any vendor use of Murph health data to build advertising, targeting, profiling, or data-broker products.

Hashing or pseudonymizing identifiers does not make health-context advertising disclosures acceptable by default. A hashed email, phone number, wallet address, or device ID paired with a health event can still identify a person.

## Health surfaces

Treat all of the following as health surfaces unless privacy/legal documents otherwise:

- authenticated Murph app pages;
- onboarding questions that ask about health, wellness, goals, body, routines, symptoms, conditions, labs, meals, supplements, sleep, exercise, recovery, or devices;
- vault, experiment, Health Commons, protocol, outcome, measurement, food, supplement, routine, workout, sample, lab, and record pages;
- device/wearable connect, OAuth, provider callback, webhook, and sync pages;
- import/export, attachment, file, transcript, raw capture, and inbox/message/email surfaces;
- assistant prompts, outputs, search, automation, and workspace checkpoint flows;
- support, debug, error, observability, analytics, session replay, and crash-reporting flows that may capture health content or health-context metadata;
- URLs, route names, event names, page titles, referrers, breadcrumbs, or DOM text that reveal health context; and
- backend events and logs carrying account identifiers plus health-context actions.

## Allowed only with privacy/security review

Some telemetry may be necessary to operate and secure Murph. It is allowed only when minimized, documented, and not used for advertising:

- first-party operational metrics such as request counts, latency, availability, and error counts;
- security logs needed for authentication, abuse prevention, access review, incident response, or fraud prevention;
- product analytics that avoid raw health content, health-context URLs, health-specific event names, and third-party advertising use;
- crash/error reporting that redacts payloads, prompts, files, transcripts, headers, cookies, tokens, and health-context identifiers;
- aggregated or de-identified metrics where reidentification is not reasonably possible; and
- vendor processing under signed limited-use, no-ad, no-training, retention, deletion, and incident-notice terms.

If a tool cannot disable advertising use, audience building, cross-context profiling, broad data sharing, replay of health pages, or retention of sensitive payloads, do not use it on Murph health surfaces.

## Before adding analytics, telemetry, or third-party scripts

Complete this checklist:

1. Identify every page, route, API, server event, client event, log field, URL, referrer, cookie, header, and user identifier the tool will receive.
2. Confirm no health content, health-context metadata, prompts, files, transcripts, wearable data, device data, provider IDs, or raw user messages are sent.
3. Disable advertising features, audience creation, data sharing for ads, benchmarking, replay, session recording, heatmaps, and model-training or product-improvement uses unless privacy/legal explicitly approves.
4. Confirm the vendor has limited-use, no-ad, no-training, deletion, retention, incident-notice, and subprocessor terms.
5. Confirm events use neutral names that do not reveal health context. Prefer `record_action` over `symptom_logged`, `lab_uploaded`, `medication_viewed`, or similar sensitive names.
6. Strip query parameters and fragments from URLs before telemetry leaves Murph unless privacy/security approves a specific allowlist.
7. Redact path segments that may contain user IDs, provider IDs, invite IDs, import IDs, file IDs, condition names, food names, medication names, lab names, or other health context.
8. Confirm tag managers cannot inject unreviewed tags into health surfaces.
9. Add tests, static scans, CSP restrictions, or config reviews when feasible.
10. Record the approval in the relevant implementation plan or vendor review.

## Examples

| Scenario | Allowed? | Reason |
| --- | --- | --- |
| Server metric increments `http_request_count` for `/api/health-records` without user ID, payload, query, or referrer. | Usually yes after security review. | Operational metric with no identifying health context. |
| Error report includes stack trace plus raw prompt asking about a supplement protocol. | No. | Raw health prompt disclosure. |
| Meta Pixel fires on a page where a user connects Oura or WHOOP. | No. | Ad pixel receives health-context page/event and identifiers. |
| Analytics event `medication_added` with hashed email. | No. | Health event plus identifier can be identifiable health data. |
| First-party aggregate count of successful sync jobs by provider, stored internally without user IDs. | Usually yes after review. | Aggregated operational metric; still avoid exposing it to ad/marketing vendors. |
| Support tool records a replay of a vault page containing lab-like records. | No by default. | Session replay can capture health data and requires exceptional approval if ever used. |

## Incident trigger

Open the HBNR incident plan immediately if any prohibited or unreviewed tracking system may have received health data or health-context metadata. Disable the route, tag, SDK, event, destination, or export first, then preserve configuration and redacted evidence for review.

See `ftc-hbnr-incident-plan.md` for incident handling.

## Implementation guardrails

- Keep third-party scripts off authenticated health surfaces by default.
- Prefer server-side, first-party, metadata-only operational metrics over client-side tracking.
- Do not store health terms in URL paths, query strings, page titles, referrers, or analytics event names when avoidable.
- Do not use tag managers on authenticated or health-adjacent surfaces unless locked to a reviewed allowlist.
- Keep Content Security Policy restrictive enough to block unapproved ad and tracking domains.
- Add dependency and source scans for known ad-pixel packages when adding marketing or analytics tooling.
- Treat marketing-site analytics separately from authenticated product analytics; never let health-context referrers or identifiers flow into marketing tools.
- Do not use health data for customer segmentation, retargeting, growth experiments, lookalikes, conversion optimization, or ad reporting.
- Do not let a vendor's default terms, dashboard toggle, or support statement override Murph's no-ad/no-secondary-use posture.

## Official references

- FTC business guidance: <https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0>
- FTC GoodRx HBNR enforcement announcement: <https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising>
