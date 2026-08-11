# Creator Programs

Last verified: 2026-08-11
Status: Specified for the creator-recruiting surface; no creator-program runtime ships yet

## Product decision

Murph may work directly with selected health educators, creators, coaches,
clinicians, researchers, trainers, and community leaders to turn an existing
body of work into a personalized, community-oriented health experience.

The public recruiting route is `/creators`. It uses ordinary language such as
**program**, **experience**, and **guidance** rather than introducing a permanent
Murph category name before creator demand is understood. Its central promise is:

> Give every member a personal health guide grounded in your work.

The page recruits founding partners. It is not a public program marketplace,
self-serve builder, install gallery, creator dashboard, payout ledger, or
runtime publication system.

## Intended creator

The best early partner has:

- a coherent body of health knowledge or a signature method;
- a repeatable action, routine, challenge, protocol, or bounded program;
- a community that asks how to apply the work;
- enough source material for Murph and the creator to review together; and
- willingness to pilot the experience with a small participant group.

Audience size alone is not qualification. A focused coach with a trusted,
repeatable system may be a better partner than a broad lifestyle influencer.

## Audience buying motives

The recruiting copy should work across five broad motive clusters rather than
speaking to a generic social-media creator:

1. **Research-led educators** care about source fidelity, nuance, approved
   claims, and helping an audience implement a large archive of work.
2. **Clinicians and professional educators** care about scope, participant
   privacy, reviewed guidance, and not implying individualized clinical care.
3. **Coaches and performance experts** care about adaptation, progression,
   tracking, accountability, and scaling beyond one-to-one support.
4. **Membership and community operators** care about participation, retention,
   shared launches, cohorts, milestones, and a stronger member experience.
5. **Creator-led health brands** care about intellectual-property control,
   brand fidelity, a new product or revenue line, and aggregate evidence that
   the experience is being used.

The page therefore leads with health expertise, personal guidance, and community
implementation. Creator economics remains visible but secondary.

## Founding-partner experience

The v0 route has one terminal action: a prefilled email to Murph's existing
support inbox with the partner's name, role or health brand, work link, trusted
health topic or outcome, source material to bring to life, intended participant
result, possible community goal, and approximate audience or member size. It
requires no account, application record, sign-in, or detached workflow.

After contact, the Murph team may manually:

1. review the partner's existing work;
2. define one participant journey, approved source set, adaptation boundary,
   community rhythm, and completion state;
3. build the first experience from existing Murph primitives;
4. run a small pilot;
5. revise it with the partner; and
6. agree separately on any wider launch.

The recruiting page does not promise response time, acceptance, publication, or
a launch date.

## Public value proposition

The creator-facing story has five ordered parts:

1. Turn an existing body of health work into guidance people can follow.
2. Give each member private support adapted to their life and authorized data.
3. Bring the community together around one reviewed health program and
   aggregate progress.
4. Keep content ownership, source review, scientific standards, brand control,
   and adaptation boundaries explicit.
5. Offer creator economics only after the product and trust proposition are clear.

The public page may use clearly labeled synthetic concepts to make the product
tangible. It must not imply that a named third-party creator is affiliated, that
illustrative participation numbers are real, or that a program already ships.

## Creator economics

Two reward concepts remain distinct:

- **Referral reward** recognizes the person who introduced a new participant to
  Murph through an existing referral path.
- **Creator reward** may recognize the person who created a health experience
  that produces qualified, retained participation.

For the founding program, any creator reward, qualification milestone, cap,
payment amount, or paid launch partnership is manually agreed before launch.
The public page may state that selected founding creators can earn based on
qualified retained use and may receive separate paid launch support. It must not
promise a payout amount, automatic settlement, revenue share, or typical income.

No creator reward gives the creator ownership of a member, a Murph account, a
subscription, or participant data.

## Ownership and versioning

A creator retains ownership of their original writing, recordings, media,
brand, and program intellectual property. Any production agreement must define
the license Murph receives to operate the approved experience.

The creator reviews the participant-facing health guidance, approved sources,
permitted adaptations, prohibited claims, and public presentation before
launch. A material change should create an explicit reviewed version rather
than silently changing the experience people joined. This document does not
create a runtime version store or publication mechanism.

## Member privacy and safety

A creator may receive only aggregate program information such as starts,
qualified participation, retention, and completion when the eventual product
supports those projections. They do not receive private messages, wearable
records, labs, meals, symptoms, schedules, individual outcomes, or other
member-level health information merely because a member joins their experience.

Creator-authored material never overrides Murph's safety, privacy, consent,
evidence, authorization, or health-data-sharing rules. V0 does not accept
arbitrary creator prompts, skills, tools, code, or unreviewed health programs.
Murph should preserve participant agency: no shame-based adherence, public body
ranking, creator surveillance, or claim that silence proves failure.

## Architecture and reuse

The recruiting page reuses the existing public marketing shell, metadata helper,
StickyNav, SiteFooter, design catalog, Vercel telemetry allowlist, and responsive
browser checks. Its only action is a deterministic mailto helper.

No database table, API route, form service, scheduler, queue, payout service,
creator account, program registry, assistant skill, prompt assembly, or health
runtime changes in the v0 page.

## Deferred work

Defer until manual pilots establish repeated demand and a stable common shape:

- a public builder or authoring schema;
- program discovery or installation;
- creator authentication and dashboards;
- automated attribution or payouts;
- paid participant access;
- remixing, forks, or contributor rewards;
- creator-facing member-level analytics; and
- any generic runtime object named Recipe, Practice, Program, or similar.

## Evidence to collect

The creator page should be evaluated by qualified creator conversations rather
than raw pageviews. Manual pilots should measure:

- creator outreach to qualified conversation;
- accepted concept to pilot launch;
- participant start to first useful result;
- retained participation at the agreed milestone;
- creator willingness to launch another experience;
- participant trust and opt-out signals; and
- Murph usage cost plus any creator payment per retained member.
