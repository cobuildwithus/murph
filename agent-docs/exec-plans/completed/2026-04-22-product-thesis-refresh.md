# Refresh the canonical Murph product thesis docs around protocol outcomes

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Update the canonical internal docs so Murph is described consistently as the experiment layer for personal health, with the assistant as the wedge and the long-term moat as a protocol outcome network and living Health Commons.

## Success criteria

- The top-level README and architecture summaries no longer frame Murph primarily as a generic personal health assistant and explicitly include the Health Commons package/layer.
- Product marketing docs describe the private experiment loop, opt-in outcome sharing, and Health Commons contribution model consistently.
- Product guardrail docs capture the new social/network constraints: compare interventions rather than bodies, rank learning instead of raw biomarker status, and keep sharing privacy-bounded and non-addictive.
- Health Commons and onboarding specs explicitly preserve the exact protocol revision needed for outcome cards, aggregate summaries, and protocol forks/variants.
- A durable product spec exists for the protocol outcome network layer and is indexed in the repo docs.
- The diff stays limited to docs/process files.

## Scope

- In scope:
  - `ARCHITECTURE.md`
  - `README.md`
  - `docs/architecture.md`
  - `agent-docs/PRODUCT_SENSE.md`
  - `agent-docs/PRODUCT_CONSTITUTION.md`
  - `agent-docs/index.md`
  - `agent-docs/product-marketing-context.md`
  - `agent-docs/product-specs/index.md`
  - `agent-docs/product-specs/health-commons.md`
  - `agent-docs/product-specs/experiment-onboarding.md`
  - new `agent-docs/product-specs/protocol-outcome-network.md`
- Out of scope:
  - runtime code, schemas, or UI implementation
  - Health Commons content pages under `packages/health-commons/content/**`
  - hosted product pricing or billing changes

## Constraints

- Preserve the existing anti-shame and privacy posture.
- Treat the provided text file as the thesis/input, then express it in repo-local durable docs instead of pasting it verbatim.
- Keep the repo on the docs/process-only path.

## Risks and mitigations

1. Risk: The new thesis could sprawl across too many docs and create overlapping or contradictory guidance.
   Mitigation: Centralize the new network/share rules in one new product-spec doc and update adjacent docs to point at it.
2. Risk: The new social framing could drift from the existing constitution and over-index on comparison dynamics.
   Mitigation: Encode explicit guardrails against raw biomarker leaderboards, shame mechanics, and identity-heavy social loops.
3. Risk: README and marketing docs could overpromise features that do not yet exist.
   Mitigation: Separate current product loop from the long-term network direction and describe the latter as the product Murph is building toward.

## Tasks

1. Audit the current product and marketing docs against the new thesis and identify the canonical source-of-truth files.
2. Rewrite the top-level and product docs around the experiment-layer plus protocol-outcome-network framing.
3. Add a durable product spec for outcome cards, contribution levels, trust ladders, and social guardrails, then align the related specs and indexes.
4. Read back the touched docs, run the docs-only verification lane, and land a scoped commit.

## Decisions

- Treat the completed experiment outcome card as the first-class social object in the product docs.
- Keep public Health Commons knowledge and aggregate outcome summaries distinct from private run data.
- Preserve the existing constitution's philosophy and extend it with explicit social/network rules rather than replacing it.

## Verification

- Commands to run:
  - direct readback of touched docs
  - `git diff --check`
- Expected outcomes:
  - The touched docs read coherently, stay internally consistent, and the diff remains Markdown-only.
Completed: 2026-04-22
