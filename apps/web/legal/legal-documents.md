# Murph Legal Documents

**Effective Date:** April 29, 2026

**Last Updated:** August 20, 2026

This page collects the current Murph legal documents for the hosted service. The latest PDFs are available under `/legal/`, versioned PDFs are retained for auditability, and `/legal/manifest.json` lists the current document versions without timestamp churn.

## Current documents

| Document | Current version | HTML | Latest PDF |
| --- | --- | --- | --- |
| Terms of Service | 2026-07-23 | [/legal/terms](/legal/terms) | [/legal/terms.pdf](/legal/terms.pdf) |
| Privacy Policy | 2026-07-23 | [/legal/privacy](/legal/privacy) | [/legal/privacy.pdf](/legal/privacy.pdf) |
| Consumer Health Data Notice | 2026-07-23 | [/consumer-health-data-privacy-policy](/consumer-health-data-privacy-policy) | [/legal/consumer-health-data-notice.pdf](/legal/consumer-health-data-notice.pdf) |
| Health AI Safety Disclosure | 2026-07-23 | [/legal/health-ai-safety-disclosure](/legal/health-ai-safety-disclosure) | [/legal/health-ai-safety-disclosure.pdf](/legal/health-ai-safety-disclosure.pdf) |
| Subprocessors, Model Providers, and Connected Services | 2026-08-20 | [/subprocessors](/subprocessors) | [/legal/subprocessors.pdf](/legal/subprocessors.pdf) |

## Consent records

Hosted Murph records required document acceptance against the current Terms of Service, Privacy Policy, Consumer Health Data Notice, and Health AI Safety Disclosure. The append-only event is historical proof of what the member accepted; it does not prevent the member from disconnecting optional sources, withdrawing optional permissions for future processing where supported or required, or exercising privacy rights.

Platform or provider permissions and optional feature consents, such as Health Commons contribution consent, are recorded separately where supported so they can be granted or revoked without rewriting launch acceptance history.

Consent events are append-only. Current grant rows are maintained as a read-optimized view of the latest active or revoked state.

## Contact

Questions about legal documents, Consumer Health Data, privacy rights, or consent can be sent to **legal@justco.build**.
