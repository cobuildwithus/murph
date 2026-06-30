# Murph Legal Documents

**Effective Date:** April 29, 2026

**Last Updated:** April 29, 2026

This page collects the current Murph legal documents for the hosted service. The latest PDFs are available under `/legal/`, versioned PDFs are retained for auditability, and `/legal/manifest.json` lists the current document versions without timestamp churn.

## Current documents

| Document | Current version | HTML | Latest PDF |
| --- | --- | --- | --- |
| Terms of Service | 2026-04-29 | [/legal/terms](/legal/terms) | [/legal/terms.pdf](/legal/terms.pdf) |
| Privacy Policy | 2026-06-24 | [/legal/privacy](/legal/privacy) | [/legal/privacy.pdf](/legal/privacy.pdf) |
| Consumer Health Data Notice | 2026-04-29 | [/consumer-health-data-privacy-policy](/consumer-health-data-privacy-policy) | [/legal/consumer-health-data-notice.pdf](/legal/consumer-health-data-notice.pdf) |
| Health AI Safety Disclosure | 2026-04-29 | [/legal/health-ai-safety-disclosure](/legal/health-ai-safety-disclosure) | [/legal/health-ai-safety-disclosure.pdf](/legal/health-ai-safety-disclosure.pdf) |
| Subprocessors and Model Providers | 2026-04-29 | [/subprocessors](/subprocessors) | [/legal/subprocessors.pdf](/legal/subprocessors.pdf) |

## Consent records

Hosted Murph records launch-required legal consent against the current Terms of Service, Privacy Policy, Consumer Health Data Notice, and Health AI Safety Disclosure. Optional feature consents, such as connected health source consent or Health Commons contribution consent, are recorded separately so they can be granted or revoked without rewriting launch consent history.

Consent events are append-only. Current grant rows are maintained as a read-optimized view of the latest active or revoked state.

## Contact

Questions about legal documents, Consumer Health Data, privacy rights, or consent can be sent to **legal@justco.build**.
