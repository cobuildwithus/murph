# Feature Audit Gap Triage

Generated: 2026-06-21

Canonical source: `feature-status.csv`. This file explains the 24 rows with missing automated story coverage and the 4 rows marked dead/unreachable. The remaining dead/unreachable rows are also missing automated story coverage, so the triage covers 24 unique feature rows.

## Summary

- Missing-test rows: 24
- Dead/unreachable rows: 4
- Unique rows investigated: 24
- Superseded device-sync settings rows removed from the tracker: 2
- Product-breaking failures found during this pass: 0

## Pattern

Most missing rows are existing static marketing, internal design, or deck/security content that lacks focused assertions. The remaining dead/unreachable rows are different: one passkey settings component is unmounted, and three overview components are reachable only through the design gallery. The two old device-sync settings rows were removed because `/settings` now links to `/connect` and no current route mounts that settings component.

## Group Counts

- Dead/unreachable and missing coverage: 1
- Dead/unreachable design demo: 3
- Data branch coverage gap: 1
- API route coverage gap: 2
- Client behavior coverage gap: 1
- Internal design route coverage gap: 4
- Static marketing content coverage gap: 6
- Pitch route interaction coverage gap: 3
- Security page content coverage gap: 3

## Row Findings

| feature_id | feature_status | coverage | group | cause | recommended next action | evidence inspected |
| --- | --- | --- | --- | --- | --- | --- |
| settings-passkey-create | dead/unreachable | missing | Dead/unreachable and missing coverage | Reachability gap: HostedPasskeySettings is not imported by any current app route or test; /settings omits the passkey UI, so there is no in-app path to create a passkey from this component. | Product decision: wire into settings and add a Privy/linking test, or delete/retire the component and remove it from the product feature inventory. | apps/web/src/components/settings/hosted-passkey-settings.tsx; apps/web/app/(dashboard)/settings/page.tsx |
| overview-design-active-experiment-banner | dead/unreachable | missing | Dead/unreachable design demo | Reachability gap: the overview component is imported only by the /design component gallery, not by overview or dashboard product routes; no product UI test covers it. | Remove from product feature inventory or explicitly classify as design-gallery demo; delete it if the demo is no longer needed. | apps/web/src/components/overview/active-experiment-banner.tsx; apps/web/app/design/components-content.tsx |
| overview-design-domain-card | dead/unreachable | missing | Dead/unreachable design demo | Reachability gap: the overview component is imported only by the /design component gallery, not by overview or dashboard product routes; no product UI test covers it. | Remove from product feature inventory or explicitly classify as design-gallery demo; delete it if the demo is no longer needed. | apps/web/src/components/overview/health-domain-card.tsx; apps/web/app/design/components-content.tsx |
| overview-design-profile-stats | dead/unreachable | missing | Dead/unreachable design demo | Reachability gap: the overview component is imported only by the /design component gallery, not by overview or dashboard product routes; no product UI test covers it. | Remove from product feature inventory or explicitly classify as design-gallery demo; delete it if the demo is no longer needed. | apps/web/src/components/overview/profile-stats.tsx; apps/web/app/design/components-content.tsx |
| signals-provider-source-health | inventoried | missing | Data branch coverage gap | Missing coverage: SignalsPage renders provider source-health table only for non-empty sourceHealthRows; current dashboard tests/fixtures do not cover that populated branch. | Add a SignalsPage fixture with non-empty sourceHealthRows and assert provider freshness/status cells. | apps/web/app/(dashboard)/signals/page.tsx; apps/web/test/browser-vault-dashboard-pages.test.tsx |
| linq-webhook-health | inventoried | missing | API route coverage gap | Missing coverage: GET health handler returns a static provider payload, while existing Linq webhook tests cover POST handling only. | Add a tiny GET route test asserting ok/provider if the health endpoint is intended as a supported operational surface. | apps/web/app/api/hosted-onboarding/linq/webhook/route.ts; apps/web/test/hosted-onboarding-linq-route.test.ts |
| telegram-webhook-health | inventoried | missing | API route coverage gap | Missing coverage: GET health handler returns a static provider payload, while existing Telegram webhook tests cover POST, secret, and body handling only. | Add a tiny GET route test asserting ok/provider if the health endpoint is intended as a supported operational surface. | apps/web/app/api/hosted-onboarding/telegram/webhook/route.ts; apps/web/test/hosted-onboarding-telegram-route.test.ts |
| home-phone-chat-autoscroll | inventoried | missing | Client behavior coverage gap | Missing coverage: PhoneChatScroller relies on a client DOM layout effect to scroll to bottom; current server-render root tests cannot exercise that behavior. | Add a client component test that stubs scrollHeight/clientHeight if autoscroll behavior is important. | apps/web/src/components/landing/phone-chat-scroller.tsx |
| design-tabbed-shell | inventoried | missing | Internal design route coverage gap | Missing coverage: DesignPage tab selection and URL replacement are client-side; no test renders /design or verifies tab switching. | Add one route/component test for initial tab selection plus a tab-switch click if /design is still a supported route. | apps/web/app/design/design-page.tsx |
| design-brand-guidelines | inventoried | missing | Internal design route coverage gap | Missing coverage: /design brand tab is an internal static design-system route; no route or component test asserts BrandContent or brand tab rendering. | Add a small /design render test only if brand guidance is a maintained product contract; otherwise keep as accepted low-risk docs/demo coverage gap. | apps/web/app/design/brand-content.tsx; apps/web/app/design/design-page.tsx |
| design-component-gallery | inventoried | missing | Internal design route coverage gap | Missing coverage: /design components tab is an internal component gallery; no test asserts the expected component groups render. | Add a smoke test for the component gallery if the design route should stay supported. | apps/web/app/design/components-content.tsx |
| design-interactive-previews | inventoried | missing | Internal design route coverage gap | Missing coverage: interactive previews in the /design components tab use local client state; no DOM/client test clicks or verifies those preview states. | Cover with a focused client interaction test if these previews are still meant to be maintained. | apps/web/app/design/components-content.tsx |
| home-feature-highlights | inventoried | missing | Static marketing content coverage gap | Missing coverage: static home feature-card rendering from shared invite card data has no direct component assertion. | Low-risk static content gap; add a root-page assertion only if these cards are contractual copy. | apps/web/src/components/landing/feature-highlights.tsx; apps/web/test/page.test.ts |
| home-daily-assistant-demo | inventoried | missing | Static marketing content coverage gap | Missing coverage: landing assistant demo and phone mock copy are static marketing content outside the existing root-page assertions. | Add direct assertions for the assistant demo section if this copy is release-critical. | apps/web/src/components/landing/assistant-section.tsx; apps/web/test/page.test.ts |
| home-how-it-works-cards | inventoried | missing | Static marketing content coverage gap | Missing coverage: root-page tests assert high-level landing copy but not the How it works card grid or its static device/protocol/result details. | Add a lightweight root-page content assertion for the grid if it should be guarded against accidental removal. | apps/web/src/components/landing/how-it-works-section.tsx; apps/web/test/page.test.ts |
| home-persona-phone-demos | inventoried | missing | Static marketing content coverage gap | Missing coverage: persona phone demos are static marketing examples; tests do not assert persona cards, mock result tiles, or image rendering. | Add section-level render assertions if the persona examples are maintained content; otherwise keep as accepted marketing-copy gap. | apps/web/src/components/landing/personas-section.tsx; apps/web/src/components/landing/phone-mock.tsx |
| home-security-teaser | inventoried | missing | Static marketing content coverage gap | Missing coverage: security teaser section and /security CTA are not separately asserted by the root-page tests. | Add a root-page assertion for the security teaser CTA if this cross-link is contractually important. | apps/web/src/components/landing/security-teaser-section.tsx; apps/web/test/page.test.ts |
| home-trust-pillars | inventoried | missing | Static marketing content coverage gap | Missing coverage: trust-pillar card titles and bodies are not asserted by existing landing tests. | Add one section-level content assertion if trust copy should be guarded. | apps/web/src/components/landing/trust-section.tsx; apps/web/test/page.test.ts |
| pitch-product-step-panels | inventoried | missing | Pitch route interaction coverage gap | Missing coverage: pitch route test covers the deck shell and first slide only; product slide panel toggles are not clicked or asserted. | Add a client test that navigates to the product slide and exercises the product-step toggle state. | apps/web/app/pitch/_components/slides.tsx; apps/web/test/pitch-and-biomarkers-pages.test.tsx |
| pitch-team-achievement-toggle | inventoried | missing | Pitch route interaction coverage gap | Missing coverage: pitch route test covers the deck shell and first slide only; team card toggles and achievement panel state are not clicked or asserted. Personal identifiers remain omitted from audit artifacts. | Add an interaction test using non-identifying selectors/labels, or keep omitted if the team slide is volatile deck content. | apps/web/app/pitch/_components/slides.tsx; apps/web/test/pitch-and-biomarkers-pages.test.tsx |
| pitch-ask-live-link | inventoried | missing | Pitch route interaction coverage gap | Missing coverage: pitch route test covers the deck shell and first slide only; ask slide CTA/link and trajectory cells are not asserted. | Add pitch deck navigation assertions for the ask slide if investor-deck links are release-critical. | apps/web/app/pitch/_components/slides.tsx; apps/web/test/pitch-and-biomarkers-pages.test.tsx |
| security-promises | inventoried | missing | Security page content coverage gap | Missing coverage: SecurityPage tests cover metadata, nav, and install command only; promise cards are not asserted. | Add promise-card assertions if the trust promises are maintained product copy. | apps/web/app/security/page.tsx; apps/web/test/page.test.ts; apps/web/test/route-metadata-pages.test.ts |
| security-hosted-architecture-diagram | inventoried | missing | Security page content coverage gap | Missing coverage: SecurityPage tests cover metadata, nav, and install command only; hosted architecture diagram and legend are not asserted. | Add a render assertion for the hosted architecture diagram if the diagram is release-critical. | apps/web/app/security/page.tsx; apps/web/test/page.test.ts; apps/web/test/route-metadata-pages.test.ts |
| security-encryption-details | inventoried | missing | Security page content coverage gap | Missing coverage: SecurityPage tests cover metadata, nav, and install command only; encryption detail cards/meta are not asserted. | Add section-level assertions if /security is treated as contractual trust copy. | apps/web/app/security/page.tsx; apps/web/test/page.test.ts; apps/web/test/route-metadata-pages.test.ts |

## Suggested Order

1. Resolve the true reachability decisions first: passkey settings and design-gallery-only overview components. These are inventory/product-scope questions, not just missing tests.
2. Add tiny tests for operational surfaces if they are supported health endpoints: Linq GET health and Telegram GET health.
3. Add one populated fixture test for provider source health on `/signals`. This is a real data branch rather than static copy.
4. Treat homepage, security, design, and pitch rows as lower-risk content coverage unless those pages are release-critical contracts.
