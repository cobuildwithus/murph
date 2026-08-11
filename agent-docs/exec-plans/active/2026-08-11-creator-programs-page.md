# Creator programs recruiting page

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

Ship a focused `/creators` page that helps a serious health educator, creator,
coach, clinician, researcher, or community leader imagine turning an existing
body of work into personalized health guidance and a community program, then
opens one white-glove conversation with the Murph team.

## Success criteria

- The hero leads with one concrete health-specific promise: give every member a
  personal health guide grounded in the partner's work.
- The page makes source fidelity, personal adaptation, aggregate community
  participation, creator control, privacy, and optional creator economics
  tangible without implying that a creator platform already ships.
- The copy serves research-led educators, clinicians, coaches, membership and
  community operators, and creator-led health brands rather than a generic
  social-media creator.
- The sole continuation is a prefilled email to Murph's existing support inbox.
- The production component appears in `/design?tab=sections` with synthetic,
  inert examples.
- Metadata, telemetry admission, focused rendering tests, responsive browser
  proof, exact-head CI, and required frontend review gates pass before merge.

## Scope

- In scope: `/creators`, metadata, static presentation, deterministic creator
  mailto, creator-program product spec, design-catalog study, focused tests, and
  telemetry allowlist alignment.
- Out of scope: creator accounts, database state, application forms, self-serve
  building, program installation, runtime prompts or skills, creator analytics,
  attribution, payouts, paid programs, galleries, or remixing.

## Constraints

- Keep the underlying strategy practical in the public interface. Do not expose
  academic language about body futurism, protocolism, or social forms.
- Make health expertise, reviewed guidance, member outcomes, and community
  implementation explicit; do not rely on generic creator-platform language.
- Use Murph's existing warm research-library design system with a more cinematic,
  restrained marketing composition rather than copying another brand's visual
  language.
- Use only synthetic creator concepts and aggregate values; imply no third-party
  partnership, testimonial, or production scale.
- Treat earnings as a secondary founding-partner possibility with no guaranteed
  amount, automatic settlement, or revenue-share promise.
- Keep participant-level health and conversation data private from creators.

## Risks and mitigations

1. Risk: the page sounds like an already-shipped creator marketplace.
   Mitigation: describe the founding program as white-glove, label examples
   illustrative, and state that no self-serve publishing system is implied.
2. Risk: generic creator language fails to explain the health-specific value.
   Mitigation: lead with a personal health guide grounded in the partner's work,
   then show source review, private adaptation, tracking, and shared health
   programs.
3. Risk: money-first copy attracts low-quality affiliate demand.
   Mitigation: lead with impact, personal support, community, and creator
   control; place economics late in the page.
4. Risk: creator authority weakens member agency or privacy.
   Mitigation: document aggregate-only creator reporting and keep Murph's safety,
   consent, evidence, and privacy boundaries superior.
5. Risk: a dense page loses the requested confidence and restraint.
   Mitigation: use large editorial typography, one concrete hero artifact,
   hairline-separated rows, and one primary CTA.

## Tasks

1. Add the durable creator-program recruiting contract.
2. Build the static `/creators` production page and deterministic contact handoff.
3. Register the real composed page in the design catalog.
4. Add focused rendering, metadata, mailto, telemetry, and responsive proof.
5. Audit the message against a broad synthetic set of health-creator buying
   motives and remove generic creator-platform copy.
6. Push a draft candidate and run exact-head CI, desktop/mobile design capture,
   the preliminary specialist review, Claude UI double-check when available,
   and the parent final review.
7. Resolve findings, archive this plan, and finish the scoped PR.

## Current verification state

- Connector-only implementation environment: repository dependencies and a
  runnable browser are unavailable locally.
- Static TypeScript/TSX parsing and direct mailto assertions are required before
  the draft candidate is pushed.
- Exact-head GitHub Actions, browser captures, and required review gates remain
  open completion requirements on the draft PR.
