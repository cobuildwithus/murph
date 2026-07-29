# Make usage top-up success feel rewarding and on-brand

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make the fulfilled group usage top-up state feel rewarding, specific, and
  recognizably Murph while preserving the existing payment, polling, dismissal,
  and Messages handoff behavior.

## Success criteria

- The fulfilled group state no longer repeats the same confirmation in a
  bordered status card or shows payment-pending copy after fulfillment.
- The hierarchy clearly communicates payment completion, the added group
  capacity, and the honest next step into Messages.
- Personal and Family fulfilled states remain correct and usable.
- The real production component is reviewable on the design catalog's section
  study at desktop and mobile widths.
- Focused tests, web typecheck, frontend design proof, browser proof, required
  product/frontend review, exact-head CI, and the scoped commit/PR path complete.

## Scope

- In scope: fulfilled presentation and copy in the existing hosted usage top-up
  dialog owner, its focused tests, the existing group usage funding design
  study, and the durable design-system description.
- Out of scope: payment state transitions, Stripe or billing behavior, top-up
  amounts, Messages deep-link behavior, new imagery, new dependencies, and
  unrelated dialog states.

## Constraints

- Technical constraints: keep the current `HostedUsageTopUpDialog` state owner
  and shared button/dialog primitives; do not add a second success component or
  state machine.
- Product/process constraints: warm precision rather than gamified celebration;
  no false promise that `sms:` can deep-link to the group; preserve keyboard
  focus, accessible status meaning, responsive layout, and the worktree/PR
  review gates for user-facing frontend work.

## Risks and mitigations

1. Risk: stronger copy could imply a specific amount or exact chat destination
   that the fulfilled payload cannot prove.
   Mitigation: celebrate only the verified fulfilled state, keep the copy
   amount-neutral, and say that Messages opens so the member can choose the
   group.
2. Risk: styling the shared dialog could regress personal, Family, or
   nonterminal states.
   Mitigation: branch only on the existing fulfilled confirmation predicate and
   keep focused assertions for every scope.

## Tasks

1. Redesign the existing fulfilled presentation and tighten its scope-specific
   copy without changing payment state.
2. Update focused tests and the existing design-catalog study for the exact
   fulfilled group state.
3. Run focused verification and desktop/mobile browser proof, then resolve the
   required product, frontend, and second-model reviews.
4. Complete the scoped commit, PR, preliminary ReviewGPT pass, exact-head CI,
   final parent review, and mergeability proof.

## Decisions

- Use the existing modal because it closes a provider-owned payment handoff and
  returns the member to conversation; the problem is its success composition,
  not the presence of a modal.
- Skip generated imagery. This compact product state has sufficient brand
  character in the existing typography, paper palette, and one affirmative
  sage signal.
- Hide frozen sponsor recovery details only after fulfillment is verified.
  Nonterminal recovery keeps its original details and actions; the terminal
  receipt cannot show an impossible cancellation instruction.

## Verification

- Commands to run: focused hosted usage dialog Vitest; web typecheck; frontend
  design-proof guard; `git diff --check`; desktop and mobile browser capture on
  `/design?tab=sections`.
- Expected outcomes: fulfilled group copy and hierarchy are exact, `sms:` and
  dismissal behavior are unchanged, all focused tests and type checks pass, and
  rendered evidence is legible and balanced at both viewports.
- Completed locally: 90 focused dialog tests, web typecheck, scoped ESLint,
  full Web lint with no errors, 10 frontend design-proof tests, and desktop and
  mobile catalog proof with no overflow.
- Product-experience review found one stale frozen-recovery detail during the
  pending-to-fulfilled transition. The owner-minimal fix and regression proof
  were implemented locally; the required re-review returned `NO FINDINGS`.
- The Claude Code UI double-check stopped on explicit Fable usage-credit
  exhaustion, so no second-model pass is claimed.
