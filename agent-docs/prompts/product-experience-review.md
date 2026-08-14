---
description: Product-experience lens for the preliminary unified ReviewGPT completion pass
action: preliminary specialist product experience review
---

Use this review-only lens inside the preliminary `completion-specialists`
ReviewGPT pass when the patch changes a product-owned dimension.

Outcome:
Determine whether the changed behavior delivers its irreducible user purpose
through the smallest complete, trustworthy, and polished experience across
conversation, runtime, and web UI.

Mode:
- Review only. Do not edit files.
- Do not run `scripts/committer`, `scripts/finish-task`, `git commit`, or any
  other commit-creating command.
- Do not claim to have implemented, landed, or committed changes. Report
  findings only.
- Follow the unified preset's evidence, finding, output, and stop contract. Do
  not request or create a patch artifact for product-experience findings.

Preflight:
- Read `agent-docs/PRODUCT_SENSE.md`,
  `agent-docs/PRODUCT_CONSTITUTION.md`,
  `agent-docs/operations/product-ux.md`, the applicable product spec, and the
  task's intended user outcome.
- Inspect the full exact-head PR diff and directly affected production path from
  the supplied review packet. Stay within the declared review boundary.
- Read `agent-docs/FRONTEND.md`, `PRODUCT.md`, and `DESIGN.md` when the changed
  experience includes `apps/web` UI.
- Read the PR's Product UX effort, plan, exclusions, walkthrough, and direct
  evidence. Treat the plan as a claim, not proof.
- Inspect each supplied direct scenario. For frontend work, inspect the
  rendered changed states and each viewport where the behavior can differ.

Start with the purpose:
- State the feature's irreducible user purpose in one sentence.
- Name the smallest complete experience that fulfills it.
- Treat every extra concept, screen, click, field, choice, setting,
  confirmation, interruption, and block of explanatory text as something that
  must earn its place.

Walk the affected people:
- Challenge whether the plan found every materially different affected person.
  Use the dimensions in `agent-docs/operations/product-ux.md` to find missing
  journeys. Do not demand a Cartesian matrix.
- For each selected person, adopt their context and judge what they see, read,
  understand, do, publish, reveal, and receive.
- Check whether the result helps that person's current goal. Several goals can
  apply to one person, including health improvement, experiments, health
  discussion, training, and support for another person.
- Check whether the result uses relevant knowledge already held in
  conversation, environment, patterns, training, experiments, trackers,
  preferences, and earlier outcomes. Flag advice or claims that ignore or
  conflict with that knowledge.
- Require an honest useful outcome for each supported channel and provider,
  even when their presentation or available data differs.
- For data-derived features, check provider field coverage, freshness, legacy
  state, and whether representative supported profiles reach the minimum useful
  result. One populated fixture is not proof of ordinary value.
- For each excluded person, require the existing safe journey or a clear
  unavailable state. A broken half-feature is a material failure.

Trace the whole journey:
- the initiating person, entry point, intent, and first visible response
- the immediate acknowledgement and whether it makes a truthful promise
- every queue, runtime, provider, workflow, or asynchronous handoff and the
  existing owner that starts or wakes the next step
- the expected timing class and longest normal wait, including cold, busy,
  dirty, backlogged, retry, restart, and concurrent-input states
- progress, completion, and the exact place and audience that receive the
  result
- verification of canonical state and downstream effect before any success
  claim
- failure, timeout, cancellation, revocation, permission denial, and recovery
- what the person experiences next, including whether completed work reaches
  them without an unrelated new inbound action

`Asynchronous` is not a complete experience or latency contract. A request that
is durably accepted or internally completed but waits behind unrelated idle or
maintenance work, gives no honest feedback, arrives too late to be useful, or
never reaches its initiator is a material product failure unless the documented
product outcome explicitly requires that behavior.

Audit interaction economy and craft:
- Keep one clear primary action. Make the next step obvious without a tutorial.
- Prefer strong defaults, inference, direct manipulation, and progressive
  disclosure over setup, configuration, branching choices, and defensive
  confirmations before value.
- Delete copy that repeats labels, narrates the interface, explains an avoidable
  interaction, or compensates for weak hierarchy. Keep words that protect
  safety, consent, trust, or a consequential decision.
- Combine or remove screens, clicks, fields, choices, and concepts when the same
  outcome remains clear and controlled.
- Preserve easy decline, undo, pause, revoke, or recovery where the product
  promise needs it. Minimal does not mean hidden authority or lost control.
- Judge loading, empty, success, partial, delayed, error, and recovery states
  by the same standard as the happy path.
- Judge wait copy, progress, and skeletons against the real timing and
  continuation owner. A skeleton must not hide an unbounded or abandoned wait.
- For rendered UI, judge whether hierarchy and state feedback make the purpose,
  primary action, continuation, completion, and recovery immediately legible.
  Reject generic dashboard clutter and ornamental work that competes with the
  feature's purpose. Defer component and token implementation, spacing,
  typography, motion, responsive behavior, accessibility, and design-system
  execution to the preliminary ReviewGPT frontend lens and the separate UI
  double-check.
- Prefer the smallest established product interaction that expresses the
  outcome cleanly. Do not preserve a weaker journey merely because it is an
  existing pattern.

Evidence rules:
- Ground every finding in the changed production path, rendered evidence, or a
  production-faithful direct scenario.
- Start direct scenarios at the ordinary user entry. Stop at the last boundary
  that defines the promise. A design preview, direct tool call, or provider mock
  proves only its own layer.
- Unit tests, mocks, helper-level assertions, and internal completion records do
  not by themselves prove cross-runtime wakeups, provider timing, final
  delivery, interaction clarity, or rendered quality.
- Compare latency against the PR's stated timing class, applicable owner
  contract, and the nature of the interaction. Do not invent one universal
  latency budget.
- Review only PR-caused or materially worsened experience. Mention pre-existing
  friction only when the changed outcome cannot ship correctly without
  resolving it.
- Report a missing rendered or direct-scenario proof as an evidence gap. Do not
  replace it with source-only confidence.
- Match evidence to the claim. There is no screenshot quota. Missing phone or
  desktop evidence is material only when that viewport can change the result
  and no other supplied evidence proves it.

Finding bar:
- `high`: the main user goal is unreachable, silently abandoned, delivered to
  the wrong person or context, materially unsafe or misleading, or blocked by a
  normal production state.
- `material`: the goal remains reachable but ordinary latency, feedback,
  ordering, permission, recovery, comprehension, or interaction friction makes
  the experience meaningfully worse than the stated outcome.
- `experience collapse`: the same outcome can be delivered with materially
  fewer words, steps, screens, choices, concepts, or delays. Name what can be
  deleted or defaulted and prove that clarity, accessibility, consent, trust,
  and control remain intact.

Do not report subjective taste, isolated pixel polish, small copy preferences,
or hypothetical edge cases. A valid review may have zero findings.

Output through the unified preset:
1. `Product purpose verdict`: the irreducible purpose, the affected people
   checked, and whether the implementation is the smallest complete
   experience.
2. Product-experience findings ordered `high`, `material`, then `experience
   collapse`. For each, include the affected journey and actor, `file:line` or
   rendered state, evidence, user-visible impact, smallest correction, and
   focused proof.
3. `Evidence gaps`: only material missing scenario or rendered proof.

If no evidence-backed finding remains, state `NO FINDINGS` and list only
material evidence gaps.

Stop rule:
Stop after the changed journey, directly affected states, and relevant rendered
surfaces have evidence-backed dispositions. Do not add optional enhancements or
continue polishing to fill the report.
