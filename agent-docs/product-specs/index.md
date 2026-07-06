# Product Specs Index

Last verified: 2026-06-21

| Path | Purpose | Status |
| --- | --- | --- |
| `agent-docs/product-specs/repo.md` | Canonical repository posture and success criteria for keeping the repo current-state only. | Active |
| `agent-docs/product-specs/pulse-trial-checkout-offer.md` | Implemented Pulse Trial checkout-offer architecture over the existing hosted billing and AI usage allowance system. | Active |
| `agent-docs/product-specs/pulse-trial-start-paid-pulse.md` | Implemented exhausted Pulse Trial conversion to paid Pulse through Stripe trial-end billing. | Active |
| `agent-docs/product-specs/hosted-plan-downgrades.md` | Stripe Subscription Schedule plan for Edge-to-Pulse switches at renewal. | Active |
| `agent-docs/product-specs/hosted-family-plan.md` | Hosted Family plan MVP: fixed four-person sponsored access, private member accounts, chat-first invites, and privacy boundaries. | Active |
| `agent-docs/product-specs/health-commons.md` | Health Commons page graph, catalog, versioning, future aggregate outcome summaries, and artifact-storage product boundary. | Active |
| `agent-docs/product-specs/protocol-summary-copy.md` | Source-of-truth copy rules for Health Commons protocol `summary:` fields shown on `/experiments` cards. | Active |
| `agent-docs/product-specs/experiment-onboarding.md` | Chat-based experiment start, protocol onboarding contracts, assistant setup behavior, and private run handoff. | Active |
| `agent-docs/product-specs/first-experiment-outcome-selection.md` | First-run experiment choice rules for outcome-valued options, credible evidence, timeframe integrity, and setup handoff. | Active |
| `agent-docs/product-specs/protocol-outcome-network.md` | Private outcome cards now, plus target-state sharing levels, contribution rules, cohort summaries, and social guardrails for the protocol outcome network. | Active |
| `agent-docs/product-specs/captures.md` | Dated media-capture primitive for lightweight private evidence over time. | Active |
| `agent-docs/product-specs/companion-app.md` | Native Swift iOS companion app for Apple Health sync (WHOOP relay), hybrid WHOOP posture, MVP scope, and phase plan. | Planned |
| `agent-docs/product-specs/query-metric-universality.md` | Invariant that every metric-bearing canonical event yields a query metric point through one generic rule; summary pipeline becomes presentation + precedence, never a gatekeeper. | Specified |
| `agent-docs/product-specs/companion-app-mvp.md` | Two-screen MVP build spec: Privy phone/email login, Connect Apple Health, Junction sign-in token endpoint. | Planned |
| `agent-docs/product-specs/murph-contact-card-picker.md` | Post-signup add-Murph-to-contacts step where the member picks the avatar on Murph's vCard; picker components live on `/design`. | Planned |
| `agent-docs/product-specs/call-circle.md` | Friend-call matchmaking for groups: in-chat enrollment, private availability via the group-to-member notification rail, calendar-aware confirms, and a Retell connector bridge. | Planned |

## Rule

Before broad feature work, add the relevant product-spec doc here and update `agent-docs/index.md`.
