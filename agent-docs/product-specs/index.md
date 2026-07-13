# Product Specs Index

Last verified: 2026-07-12

| Path | Purpose | Status |
| --- | --- | --- |
| `agent-docs/product-specs/repo.md` | Canonical repository posture and success criteria for keeping the repo current-state only. | Active |
| `agent-docs/product-specs/pulse-trial-checkout-offer.md` | Implemented Pulse Trial checkout-offer architecture over the existing hosted billing and AI usage allowance system. | Active |
| `agent-docs/product-specs/pulse-trial-start-paid-pulse.md` | Implemented exhausted Pulse Trial conversion to paid Pulse through Stripe trial-end billing. | Active |
| `agent-docs/product-specs/hosted-plan-downgrades.md` | Edge-to-Pulse renewal switches plus the billing-gated Edge assistant-model choice, downgrade behavior, and deployment compatibility contract. | Active |
| `agent-docs/product-specs/hosted-family-plan.md` | Hosted Family plan MVP: fixed four-person sponsored access, private member accounts, chat-first invites, and privacy boundaries. | Active |
| `agent-docs/product-specs/health-commons.md` | Health Commons page graph, catalog, versioning, future aggregate outcome summaries, and artifact-storage product boundary. | Active |
| `agent-docs/product-specs/protocol-summary-copy.md` | Source-of-truth copy rules for Health Commons protocol `summary:` fields shown on `/experiments` cards. | Active |
| `agent-docs/product-specs/murph-onboarding.md` | Value-first onboarding for a private broad-assistant relationship, an ongoing support loop, progressive health-foundation checkpoints, optional baseline review, and finite completion. | Active |
| `agent-docs/product-specs/experiment-onboarding.md` | Experiment-only start, protocol onboarding contracts, assistant setup behavior, and private run handoff. | Active |
| `agent-docs/product-specs/experiment-adherence-confidence.md` | Read-time assumed adherence, sensed/confirmed/assumed confidence ladder, correction semantics, and category-scoped activity evidence. | Active |
| `agent-docs/product-specs/experiment-outcome-selection.md` | Experiment-only choice rules for member-valued outcomes, credible evidence, timeframe integrity, and setup handoff. | Active |
| `agent-docs/product-specs/protocol-outcome-network.md` | Private outcome cards now, plus target-state sharing levels, contribution rules, cohort summaries, and social guardrails for the protocol outcome network. | Active |
| `agent-docs/product-specs/captures.md` | Dated media-capture primitive for lightweight private evidence over time. | Active |
| `agent-docs/product-specs/companion-app.md` | Native Swift iOS companion app for broad Apple Health sync plus closed WHOOP Recovery/Strain metadata enrichment. | Active |
| `agent-docs/product-specs/query-metric-universality.md` | Invariant that every metric-bearing canonical event yields a query metric point through one generic rule; summary pipeline becomes presentation + precedence, never a gatekeeper. | Specified |
| `agent-docs/product-specs/companion-app-mvp.md` | Two-screen companion build spec: Privy login, Connect Apple Health, Junction sync, and bounded WHOOP metadata enrichment. | Active |
| `agent-docs/product-specs/habitat.md` | Habitat: progressive member life-context — domains, `habitat` bank family, domain catalog, coverage derivation, context-dividend collection rules, and environment/workspace v1 indicators. | Specified |
| `agent-docs/product-specs/murph-contact-card-picker.md` | Post-signup add-Murph-to-contacts step where the member picks the avatar on Murph's vCard; picker components live on `/design`. | Implemented |
| `agent-docs/product-specs/murph-tone-and-voice.md` | Five controls for how Murph talks: hosted tone and voice plus private conversation-first Humor, Push, and Detail dials. | Implemented |
| `agent-docs/product-specs/group-health-newsletter.md` | Recurring group health newsletter emailed from a group chat: cron automation in the group vault, tone flavors, a reusable default-at-join email-sharing grant, and Cloudflare `HOSTED_EMAIL` delivery with web-side address resolution. | Specified |

## Rule

Before broad feature work, add the relevant product-spec doc here and update `agent-docs/index.md`.
