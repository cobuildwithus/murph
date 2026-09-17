# Keep direct group asks through draft reconsideration and render requested graphs as images

Status: completed
Created: 2026-09-16
Updated: 2026-09-16

## Goal

- A direct, by-name request to Murph in a group chat still gets answered when
  another participant's human-to-human aside lands inside the four-second
  held-draft window. Today the reconsideration instruction tells the model that
  the latest accepted message alone decides the floor, so the completed answer
  is discarded and the room hears nothing.
- When someone asks Murph for a graph, chart, plot, or trend visualization and
  no dedicated chart or card tool fits, Murph renders it through
  `murph.generate_image` from data the conversation may already see, instead
  of declining or answering with text only.

## Success criteria

- The reconsideration instruction judges the beat from every accepted message,
  keeps an earlier direct ask unless a later message withdraws or replaces it,
  and reserves silence for turns where no accepted message still merits a reply.
- The live-input unit test asserts the production instruction text is what
  request 1 receives, and the real-Codex e2e journeys import that same
  constant instead of a retyped copy.
- Live journeys: an earlier direct ask survives a later human aside; a
  withdrawn ask still yields silence; a requested group sleep-trend graph
  produces exactly one `murph.generate_image` launch whose prompt carries the
  plotted values, with a reply that states the key numbers.
- The `murph.generate_image` contract and the always-on execution guidance say
  when a requested graph is a safe image, and the group spec records the floor
  rule and the new scenario.

## Scope

- In scope: `ASSISTANT_GROUP_REPLY_RECONSIDERATION_INSTRUCTION`, the
  `murph.generate_image` description, the messaging presentation guidance line
  about group images, the group-chat social dynamics spec, and the tests that
  pin those texts.
- Out of scope: a host-side floor classifier (the original plan deliberately
  refused one), a dedicated chart renderer, exact rich-draft preservation
  across reconsideration, and any change to image-generation plumbing,
  billing gates, or delivery.

## Constraints

- Technical constraints: the always-on execution guidance layer is size-capped
  by `model-behavior.test.ts`; keep the group-image wording within that cap.
  Live journeys need an authenticated local Codex home; every local home was
  broken or usage-limited on 2026-09-16, so the live proof runs when one is
  available again.
- Product/process constraints: one terminal action per beat is unchanged;
  Murph still yields when no accepted message asks it anything. Graph images
  may only plot data the room already may see, and the reply must restate key
  values because a rendered image is not a precise data surface.

## Product UX

- Outcome: a participant who asks Murph by name for something gets that answer
  even if a friend replies to someone else in the same few seconds; a request
  for a graph produces a picture plus the numbers.
- Entry and promise: group iMessage/Telegram thread; the person expects Murph
  to answer what they asked, in one bubble, within the usual wait. A graph
  arrives as a separate image after the text because hosted generation is
  background work.
- Affected people: the asker (answer no longer dropped); the participant whose
  aside landed in the window (still not answered, unless they asked Murph);
  the room owner on a Starter plan (image generation stays gated and the
  existing denied-completion explanation applies).
- Deliberate exclusions: no change for direct chats, scheduled sends, or
  email; no new chart tooling.
- Proof: deterministic tests on the composed instruction and tool contract;
  live journeys listed above once a Codex home is available.

## Risks and mitigations

1. Risk: the model over-answers human asides after the wording change.
   Mitigation: the instruction still ties silence to "no accepted message
   still merits a reply", the withdrawn-ask journey pins silence, and the
   group turn-priority rules are unchanged.
2. Risk: image-rendered charts show wrong numbers.
   Mitigation: the tool contract requires every plotted value in the prompt
   and the key values restated in the reply text.
3. Risk: the size-capped execution guidance breaks the ratchet test.
   Mitigation: keep the group-image line within the existing cap.

## Tasks

1. Reword and export the reconsideration instruction; update the live-input
   test to assert the production constant.
2. Import the constant in the real-Codex e2e file, flip the floor journey,
   add the withdrawn-ask and trend-graph journeys.
3. Add requested-graph guidance to `murph.generate_image` and adjust the
   group-image line in the execution guidance; pin both deterministically.
4. Update the group-chat social dynamics spec (reply cadence + scenarios).
5. Typecheck, run the focused tests, docs drift, then commit and open the PR.

## Decisions

- Fix the instruction text rather than add a host-side floor classifier; the
  original feature plan chose not to invent one and the model already gets
  every accepted message.
- Route requested graphs through the existing image tool instead of adding a
  chart renderer; the reply text carries the exact numbers.

## Verification

- Commands to run: `pnpm --dir packages/assistant-engine typecheck`;
  `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/dynamic-tools-generate-image.test.ts test/messaging-presentation-guidance.test.ts test/model-behavior.test.ts test/assistant-local-service-live-input.test.ts`;
  `pnpm docs:drift`; `pnpm test:assistant:live -- --test "<journey name>"`
  for the three journeys when a Codex home is available.
- Expected outcomes: typecheck clean; focused tests green; live journeys
  `Ready` with the asserted effects.
Completed: 2026-09-16
