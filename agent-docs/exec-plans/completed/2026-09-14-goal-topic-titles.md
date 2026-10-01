# Clarify medical goal titles and chat handoffs

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

- Give 31 medical-topic goal guides three-to-five-word education, tracking, or existing-care titles.
- Carry each title through its matching chat draft and related-guide labels.

## Success criteria

- All 31 revised titles contain three to five words and match their goal phrases and chat drafts; all 252 routes resolve.
- Focused catalog, Web, assistant, and typecheck evidence passes.

## Scope

- In scope: 12 disease-focused, 12 biomarker, and seven risk-focused titles, matching summaries, phrases, chat drafts, related labels, and a public changelog entry.
- Out of scope: article guidance, private records, schemas, dependencies, and deployments.

## Constraints

- Technical constraints: keep stable keys, URLs, citations, and existing catalog consumers.
- Product/process constraints: retain each topic and use literal titles of three to five words.

## Risks and mitigations

1. Risk: title, generated catalog, and chat draft diverge.
   Mitigation: generate through the authored catalog and verify public projections and handoffs.
2. Risk: an informational prompt starts an unsolicited treatment or Goal plan.
   Mitigation: review a focused real-assistant journey against existing informational-request boundaries.

## Tasks

1. Update the authored titles, phrases, drafts, and related labels.
2. Record the copy change and goal-guide naming contract.
3. Generate the catalog and run focused verification.
4. Review the complete diff, privacy, rendering, and assistant reply.
5. Commit the scoped change and report every before/after title.

## Decisions

- Reuse existing authored Markdown and generated projections; add no runtime logic.

## Product UX

- Outcome: each title communicates a concrete learning or support request.
- Reaches: public browse, homepage biomarker cards, guide headings, related links, and private chat drafts.
- Proof: catalog checks, production component rendering, and an informational chat with no unapproved mutations.

## Verification

- Passed 73 focused Health Commons catalog, coverage, and goal artifact tests.
- Passed 44 focused Web tests covering guide rendering, homepage cards, goal handoffs, search, contact, and changelog rendering.
- Passed Health Commons, Web, and assistant-engine typechecks.
- Passed `pnpm complexity:diff`; the two authored TSX files add no complexity or hotspots.
- Direct generated-artifact checks prove every revised title has three to five words, matches its phrase and chat draft, and propagates through related links. The catalog retains 252 goals. The longest revised title is 39 characters.
- Compared all changed guide content with the base: only titles, summaries, phrases, drafts, and related link labels changed. Stable keys, routes, article guidance, citations, and workflow metadata remain intact.
- Inspected the homepage, remission guide, and blood-pressure guide at 390px and 1440px using a synthetic local preview. All six captures showed the revised copy without horizontal overflow. Preview server and browser were shut down after inspection.
- Passed both focused real-assistant journeys with `gpt-5.6-terra` and subscription authentication. The remission response explained the topic and included clinician context. The blood-pressure response checked existing records and asked why the user wanted to track. Neither promised a medical outcome or mutated goals, regimens, or automations.
- Initial subscription profiles failed before any model action; followed the documented alternate-home policy until one profile worked. No credential contents were exposed or copied into task artifacts.
- Read the complete candidate diff and passed whitespace, privacy, and scope checks.
- Reused the existing Frog entry for repository-root Web test invocation; no new friction entry was needed.

Focused live commands (each selects exactly one journey):

```sh
pnpm test:assistant:live -- --test "keeps renamed medical goal handoffs.*type-2-diabetes-remission" --codex-home <AUTHENTICATED_CODEX_HOME>
pnpm test:assistant:live -- --test "keeps renamed medical goal handoffs.*lower-blood-pressure" --codex-home <AUTHENTICATED_CODEX_HOME>
```

## Completion review

- Static content and chat-draft changes add no runtime logic or independently sensitive implementation. Final ReviewGPT is outside this change's eligibility.
- Browser, catalog, and focused assistant evidence: Ready. Both generated chat requests remain within their education or tracking scope.
- Scope is a local implementation and commit; no PR or deployment was requested.
Completed: 2026-09-14
