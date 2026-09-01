# Public Goal Guides

Last verified: 2026-08-31

## Current State

Murph publishes a public library of practical, evidence-grounded outcome
guides at `/goals`. A guide answers a goal such as `Sleep better`, `Lower my
resting heart rate`, or `Run an Ironman`. It is useful on its own and offers an
optional handoff into a private Murph conversation.

Goal guides are not experiments. An experiment is one optional private
primitive Murph may propose when uncertainty is the real bottleneck. A goal may
instead need a training plan, habits, tracking, care support, or a combination
of existing private primitives.

## Product Boundary

- Public reusable guidance lives in Health Commons as `entityType:
  goal_template` Markdown under `packages/health-commons/content/goals/**`.
- Private member goals remain canonical Goal records in the member vault.
- A public guide never reads private data and never creates a Goal, regimen,
  automation, experiment, or message by itself.
- Generated public indexes and page projections are build artifacts. Authored
  Markdown remains the source of truth.
- The authored `Sources` section is the citation authority for the public page
  and Murph's compact goal lookup. Generated `sources` records preserve its
  labels and URLs; legacy `evidenceSourceKeys` remain internal catalog metadata
  and must not replace or contradict the citations shown to readers.
- One `goal-setup` assistant skill coordinates the private workflow. Do not add
  one skill or plugin per public guide.
- Typed `goal save` is the only production caller that may supply public
  lineage. The lower-level core writer is a trusted storage primitive that
  validates lineage shape but does not load the public catalog; do not expose
  it as a lineage-binding surface without the same current-revision check.

## Information Architecture

The public library has seven stable categories:

1. Sleep
2. Nutrition
3. Cardio
4. Strength
5. Mind
6. Biomarkers
7. Life stages

Each guide represents one outcome a person can recognize and ask for. Titles
stay short and literal. Scientific limits, measurement caveats, and population
specifics belong in the article, not in a parenthetical title clause.

Use `parentGoalKey` only for an honest outcome hierarchy, such as joint-specific
mobility guides under `Improve my mobility`. Category membership remains the
primary browse structure. Parent links must resolve to another goal template
and the graph must remain acyclic.

## Guide Contract

Every indexable guide includes:

- one plain summary;
- one category and outcome kind;
- a natural `goalPhrase`;
- one or more observable success signals;
- at least two direct public citations with human-readable labels and HTTPS URLs;
- a workflow kind and one to four existing owner skill ids;
- the exact start prompt `Hey Murph, help me <goalPhrase>.`;
- proportional safety metadata;
- a substantive article with `What to do`, `A simple plan`, `How to know it is
  working`, `If you get stuck`, `A quick note`, and `Sources` sections.

The article should give a reader enough concrete sequencing, progression,
measurement context, and troubleshooting to act without Murph. It must not be
padding around a CTA. `A quick note` is usually one short paragraph. Longer
safety treatment is reserved for genuinely higher-risk or clinician-led goals.

`field-testing` plus `usable` means the page is published and useful but has
not been represented as named human expert review. Do not display or encode a
review claim unless that review actually occurred and its owner is recorded.

## Public Handoff

The primary action shows the Murph mark followed by `Ask Murph to help`.

- The action is one direct handoff, not a review dialog or channel chooser.
- A signed-in member with a verified phone and resolved assigned Murph line
  resolves that private route at click time and opens native Messages directly
  with the guide-owned start prompt prefilled. The static article never caches
  member routing.
- Before that signed-in route resolves, the action is an inert button rather
  than an anonymous link; an early click waits for the same private resolution.
- Anonymous visitors open Telegram directly with the same prefilled prompt. A
  signed-in member uses Telegram only when Telegram is their available linked
  messaging channel and no text route is expected.
- If authenticated routing cannot be resolved, the action stays on the page
  with a retry message instead of falling back to another messaging vendor.
- Email, clipboard mutation, review dialogs, and client-side line assignment
  are intentionally excluded from the public handoff.
- If the first direct Telegram message arrives before that Telegram account is
  linked, the setup reply restores a draft only when the inbound text exactly
  matches a published goal prompt. Arbitrary inbound text is never copied into
  a URL, persisted as pending setup state, or replayed automatically.
- Nothing is sent and no private record is created until the person sends the
  message and later accepts Murph's proposed setup.

## Private Setup Workflow

After the person sends the prompt, `goal-setup`:

1. resolves the public guide through `commons goal list` and `commons goal show`;
2. retains the exact public key, page revision, and workflow revision;
3. reads only the private context needed to avoid repeating known facts;
4. for repeated action, loads `behavior-followthrough` before setup, reuses or
   learns the person's reason, current pattern, prior attempts, action window,
   and main friction one focused question per reply when they matter;
5. proposes a small, reviewable plan using the guide and relevant domain skill,
   with one editable finite reminder-and-review default or explicit quiet
   support for repeated action;
6. waits for explicit acceptance before any private write;
7. saves one canonical private Goal with `commonsGoalRef` lineage;
8. for an accepted non-experiment `habit_plan` or `training_plan`, reuses or
   creates exactly one `kind=habit` regimen linked to the Goal as the durable
   behavior-loop and support owner; domain workout or tracking records may hold
   details but do not replace it;
9. preserves the user's own reason, material constraints, complete accepted
   loop, support boundary, review, and off-ramp in that regimen;
10. inventories every page of `habit:<regimenId>` support before effects,
    creates only missing accepted support, and reconciles the series to its
    exact desired ids;
11. reads back the saved state and explains the next action in plain language.

A guide revision mismatch before persistence requires reopening the changed
setup. It must not silently bind a private Goal to a different workflow.

## Search And Indexing

- Publish one canonical URL for each real outcome.
- Treat alternate phrasings as browse-search aliases that resolve to the
  canonical guide. Do not publish alias routes or indexable keyword variants
  with duplicate advice.
- Include canonical guide and category URLs in the generated sitemap.
- Use truthful Article and Breadcrumb structured data when present. Do not add
  deprecated HowTo or broad FAQ rich-result markup.
- Goal search filters the public index in the browser and never writes the
  reader's health query to a URL, history entry, or server request.
- Health claims show visible sources. Content exists to solve the reader's
  goal, not to manufacture search inventory.

## Versioning

Generated goal artifacts carry:

- `pageRevisionId` for the full public page;
- `workflowSpecRevisionId` for the goal phrase, outcome, success signals,
  workflow ownership, start prompt, and safety setup;
- `catalogHash` for the generated Health Commons release.

The private Goal stores the public key and both exact goal revisions under
`commonsGoalRef`. It does not copy the public article into the private vault.
Only typed `goal save` flags may bind that lineage after checking it against
the packaged public index. Generic `goal import-json` accepts private Goal
fields but rejects `commonsGoalRef`.

## Deployment And Rollback

`commonsGoalRef` is optional to the compatible Goal reader, so existing Goals
need no migration. The Goal frontmatter contract is strict, however, and the
preceding reader does not recognize the new field. Deploy the Cloudflare Worker
and runner bundle together with `container_rollout=immediate`, require the
managed-container smoke to prove the exact compatible bundle fingerprint and
Goal/Commons CLI surface, and publish the Web discovery surface after runner
convergence.

Before the first lineage-bearing Goal write, the preceding runner remains a
safe rollback. After that write, the compatible reader is the rollback floor
for the affected workspace. Recover with a forward fix or a release that
retains the reader; do not roll that workspace back to the preceding strict
schema. The Web library and direct messaging handoff create no private state
and can roll back independently.

## Verification

Shipping changes require:

- Health Commons contract, catalog, generated-artifact, and exact-count checks;
- duplicate key, slug, title, prompt, and parent-cycle checks;
- owner-skill and source-key resolution checks;
- public browse, canonical routing, metadata, sitemap, structured-data, and
  direct contact-link tests;
- private Goal lineage persistence tests;
- deterministic assistant workflow tests plus one focused real-Codex journey;
- desktop and phone visual proof for the real browse and detail routes.
