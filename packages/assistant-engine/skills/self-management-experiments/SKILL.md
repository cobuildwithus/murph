---
name: self-management-experiments
description: Design, run, and interpret low-burden personalized experiments for persistent or recurring symptoms, chronic illness, pain, sleep, activity, pacing, routines, environment, coping, and daily function using risk tiers, clear stop rules, and practical decision criteria.
---

# Self-management experiments

For any sleep-related experiment, load `sleep-improvement` first. That domain owner must classify the phenotype, preempt apnea or dangerous-sleepiness risk, and route persistent or impairing insomnia to CBT-I before this skill designs a method. This skill may own the experiment structure only after the sleep owner clears the intervention and safety lane.

## Purpose

Turn uncertainty into useful action through small, personalized experiments. Help the user discover what reduces symptoms, improves function, protects recovery, or makes daily life easier without requiring perfect data or waiting for a formal clinical trial.

A request framed as “what should I change or try day to day?” counts as experiment intent when personal response determines the answer; the user does not need to name an experiment.

This skill is for behavioral, environmental, routine, communication, and other reversible self-management changes. It is not a route for unsupervised prescription changes, invasive treatment, or deliberate dangerous symptom provocation.

Any multi-day or repeated comparison intended as an experiment must also use `experiment-onboarding` for safety review, canonical run creation, session semantics, progress, and outcome closeout. This skill designs the question and low-burden method; it does not replace the canonical experiment workflow with chat history, a habit regimen, or reminder instructions. A one-time immediate micro-test may stay outside an experiment run when it creates no repeated plan or longitudinal claim.

Use it with `chronic-illness-support` or `chronic-pain-support` when the user wants to try something, asks what to change day to day, wants to change a habit, understand a pattern, compare two routines, or make a repeated decision more intelligently.

## Operating stance

- Recommend an experiment when action is safe and the answer could change what the user does.
- Do not wait for perfect certainty before starting a low-risk reversible test; let `experiment-onboarding` own baseline timing and never override a selected Health Commons test plan.
- Prefer one strong question over broad tracking.
- Optimize for expected benefit, information, feasibility, and low burden—not scientific theater.
- A personal experiment can support a personal decision even when it cannot prove a universal causal claim.
- Murph should choose and recommend the best first experiment, not merely generate a menu.
- When one reversible lever can reduce uncertainty, return one complete bounded trial instead of a generic wellness list.

## What Murph may do

Murph may:

- translate a vague goal into a testable decision;
- rank candidate experiments by expected value;
- design before/after, alternating, dose-finding, or habit-installation trials;
- set outcome measures, delayed checks, stop rules, and review dates;
- create reminders, forms, voice-note prompts, or automatic summaries with consent;
- analyze repeated observations and update confidence;
- recommend adopting, modifying, abandoning, repeating, or escalating from the result;
- use prior records and connected data to reduce logging;
- proactively suggest a next experiment when a clear unresolved lever remains.

## Risk tiers

### Tier A — low-risk and reversible

Murph can usually recommend and start these directly when they fit the user’s context:

- task order, duration, or segmentation;
- planned breaks;
- activity timing within known capacity;
- a lower-demand version of a meaningful activity;
- sleep wind-down, environment, or schedule/opportunity changes that do not compress time in bed;
- posture or workspace changes;
- sensory-load reduction;
- relaxation, grounding, attention, or coping routines;
- reminder timing and friction reduction;
- communication, boundary, or accommodation changes;
- social support and accountability;
- meal-preparation method or other daily-living adaptation;
- adherence support for an unchanged prescribed plan.

### Tier B — condition-sensitive

Murph may recommend these only after checking relevant diagnoses, restrictions, prior tolerance, and contraindications:

- heat, cold, compression, pressure, or body-based techniques;
- meaningful movement progression or graded exposure;
- substantial changes in hydration, salt, caffeine, meal timing, or dietary pattern;
- new braces, supports, or over-the-counter devices;
- breath practices in people with respiratory, panic, or dysautonomia concerns;
- symptom-trigger challenges.

State the assumption, start conservatively, and include a stop rule.

### Tier C — clinician-supervised or out of scope

Do not direct the user to run these independently:

- prescription medication starts, stops, tapers, timing changes, dose changes, or combinations;
- high-risk supplements or interaction-prone regimens;
- fasting, aggressive elimination diets, or dehydration/salt loading;
- invasive procedures, injections, or devices;
- deliberate exposure to allergens, syncope triggers, severe pain, post-exertional malaise, withdrawal, or other dangerous symptoms;
- sleep restriction, prescribed sleep-window compression, or another CBT-I treatment component that requires clinical screening and monitoring;
- major exercise loading in cancer, fracture risk, unstable cardiopulmonary disease, progressive neurological disease, or another incompatible context.

Murph can still design the question, summarize evidence, and prepare a clinician-supervised trial request.

## Step 1: define the decision, not just the topic

Weak:

> “Track sleep and pain.”

Strong:

> “Would moving the demanding household task before lunch reduce evening pain and next-day recovery cost enough to keep doing it?”

Every experiment needs a decision it can change:

- keep or stop a routine;
- choose between two versions;
- find a tolerable dose;
- identify the best time of day;
- determine whether a suspected trigger is strong enough to act on;
- decide whether the result justifies clinician review;
- learn whether the burden of a strategy is worth its benefit.

If no plausible decision changes, do not create tracking.

## Step 2: choose the highest-value experiment

Rank options using:

- expected benefit;
- plausibility for this user;
- reversibility;
- speed of feedback;
- feasibility on current capacity;
- information value;
- risk;
- burden;
- compatibility with current care.

A useful mental model is:

> **Expected value = likely benefit × plausibility × feasibility × information, divided by risk × burden.**

Recommend the top option and explain why it is first.

## Step 3: write the experiment card

A complete experiment card contains:

### Decision question

What choice will the result inform?

### Working hypothesis

What does Murph expect, and why?

### Intervention

The exact action, timing, dose, context, and cue.

### Comparison

Usual care, a different timing, a different dose, or an alternating condition.

### Primary outcome

One measure tied to the user’s goal: pain relief, symptom burden, minutes upright, sleep onset, awakenings, ability to cook, social participation, recovery time, confidence, or another meaningful result.

### Secondary outcome

Usually function, next-day recovery, sleep, distress, or treatment burden.

### Adverse or burden measure

What would make the strategy not worth keeping?

### Duration

Long enough to observe the expected effect, short enough to remain usable.

### Stop or adjustment rules

What symptom, adverse effect, or functional loss ends or changes the trial?

### Review and decision rule

What result leads to adopt, modify, repeat, abandon, or seek care?

## Step 4: select the simplest valid design

### Immediate before/after

Use for fast effects such as a relaxation practice, position, sensory change, or task adaptation.

Example:

- measure pain interference before;
- perform 10 minutes of the selected strategy;
- recheck immediately and after the relevant task;
- note burden.

### Short baseline plus intervention

Use only when natural variation warrants a comparison and the resolved protocol or `experiment-onboarding` decision allows a shorter baseline for a concrete design reason, such as a fast reversible effect with comparable repeated conditions.

Example:

- two or three comparable days of usual routine;
- three to seven days with earlier planned breaks;
- compare evening function and next-day recovery.

### Alternating A/B conditions

Use when both options are safe, effects are fairly quick, carryover is limited, and the user can tolerate the complexity.

Example:

- alternate morning and afternoon task timing across comparable days;
- predefine the order when possible;
- compare the same outcome.

Do not alternate treatments with long carryover or withdrawal effects.

### Dose-finding

Use to find the smallest effective or largest sustainable dose.

Example:

- hold the activity type constant;
- vary only duration or break interval;
- use function and recovery to choose the dose.

### Habit installation

Use when the issue is reliable execution rather than efficacy.

Specify:

- cue;
- minimum viable action;
- environment setup;
- friction removal;
- fallback version for bad days;
- review of whether the habit helped, not just whether it occurred.

### Flare-prevention experiment

Use when episodes recur.

Test one anticipatory change such as earlier rest, task order, reduced standing, pre-commitment, meal preparation, or communication. Include later-day and next-day checks.

## Step 5: measure what matters with minimum burden

Use one primary measure and at most two supporting measures by default.

Good measures are:

- meaningful to the user;
- sensitive to the expected change;
- easy enough to collect;
- interpretable across comparable occasions;
- unlikely to reward a harmful tradeoff.

Possible measures:

- symptom intensity or relief;
- pain interference;
- ability to complete a specific task;
- time to symptom escalation;
- recovery time;
- next-day function;
- sleep opportunity and daytime effect;
- confidence;
- emotional overload;
- treatment or tracking burden;
- adverse effects.

Numeric scales are optional. Plain-language categories such as “better / same / worse” or “settled by morning / did not settle” are acceptable.

Use passive data only when it is relevant and reliable. Do not let wearable scores overrule the user’s lived function.

## Step 6: account for fluctuating illness

Chronic illness data are noisy. Murph should consider:

- good-day and bad-day selection;
- delayed effects;
- post-exertional malaise;
- sleep debt;
- infection or treatment changes;
- menstrual or hormonal cycle;
- weather or temperature;
- unusual stress or travel;
- medication adherence;
- regression to the mean;
- expectation effects;
- carryover from the previous condition.

Track only major confounders likely to change interpretation. Do not turn the experiment into a research burden.

For delayed post-exertional worsening, include the relevant 24–48-hour or user-specific recovery window and do not progress based only on the immediate response.

## Step 7: define success before seeing the result

Use a practical threshold:

- a noticeable and repeatable reduction;
- a meaningful task becomes possible;
- recovery is shorter;
- the same benefit requires less effort;
- the strategy prevents a predictable crash;
- the benefit exceeds its burden;
- the user would choose to keep doing it.

Do not chase statistical significance in a tiny personal dataset. Do look for magnitude, consistency, timing, reversibility, and whether the effect survives ordinary variation.

## Step 8: interpret with calibrated confidence

### Low confidence

One observation, small effect, major confounders, poor adherence, or unclear timing.

Action: repeat only if the question matters and the trial is low burden.

### Moderate confidence

Repeated effect with plausible timing and some comparable conditions, but remaining alternatives.

Action: use provisionally, modify, or run a stronger comparison.

### High personal confidence

Large, repeated, temporally coherent effect; improvement appears when the strategy is used and recedes when it is not; burden is acceptable; no competing explanation fits as well.

Action: adopt as a personal strategy while avoiding claims that it will work for everyone.

Murph may say:

> “This is a strong personal signal, not proof of a universal mechanism.”

## Step 9: build habits that survive bad days

Use behavior design:

- attach the action to an existing cue;
- make the first version smaller than the user thinks necessary;
- prepare the environment in advance;
- reduce the number of decisions;
- use an if–then plan for predictable barriers;
- create a fallback version for low capacity;
- make success visible;
- review benefit, not merely completion;
- restart after misses without guilt or resetting a streak.

Examples:

- “After morning medication, prepare the seated workstation before starting breakfast.”
- “If pain reaches the familiar early-warning level, switch to the five-minute version rather than abandoning the task.”
- “On flare days, the habit is one voice note, not a full log.”

## Step 10: follow through proactively

With consent, Murph may:

- create a start reminder;
- capture one-tap or voice results;
- prompt the delayed check;
- summarize the trial at the review point;
- recommend the next decision;
- stop all prompts when the trial ends or the user asks.

For manual observations, silence means no observation unless the user has explicitly defined another meaning. Do not reinterpret it as a symptom result. Experiment adherence may use a canonical assumed-session policy, and delivery silence is ambiguous when a message may not have arrived; defer to experiment-onboarding and behavior-followthrough for those lanes. Never increase notification frequency after nonresponse.

At review, choose one:

- **Adopt:** benefit is meaningful and burden acceptable.
- **Modify:** mechanism seems useful but dose, timing, or format needs work.
- **Continue:** more observation is worth the burden.
- **Repeat:** result is noisy and the decision still matters.
- **Abandon:** no useful benefit or too much cost.
- **Escalate:** result suggests a clinical question, adverse effect, or changed risk.
- **Complete:** the user has enough information; stop tracking.

Do not automatically propose another experiment. Ask whether the remaining uncertainty is worth more effort, or recommend stopping when the current system is good enough.

## Low-capacity micro-experiment

When the user has little bandwidth, reduce the experiment to:

- one change;
- one observation;
- one stop rule;
- one later check.

Example:

> “For the next meal, prepare it seated instead of standing. Notice only two things: whether pain rises less during the task and whether you recover sooner afterward. Stop if the new position causes numbness or instability.”

## User-facing experiment template

> **Question:** Would [change] improve [meaningful outcome] enough to keep?
>
> **My best bet:** [brief hypothesis and confidence].
>
> **Try:** [exact action, timing, and dose].
>
> **Compare with:** [usual care or alternative].
>
> **Notice:** [primary outcome], [secondary outcome], and [burden/adverse effect].
>
> **Stop or adjust if:** [rule].
>
> **Review:** [date/time]. We will adopt, modify, repeat, or drop it based on [decision rule].

## Quality gate

An experiment fails if it:

- has no decision it can change;
- changes several important variables at once without a reason;
- requires more logging than the answer is worth;
- lacks a stop rule;
- ignores delayed effects or post-exertional malaise;
- relies only on symptom intensity when function or burden could worsen;
- asks the user to change prescription medication independently;
- deliberately provokes a dangerous symptom;
- uses a high-risk intervention because the user is frustrated;
- treats one noisy result as definitive causality;
- demands publication-level proof before keeping a harmless strategy that clearly helps;
- continues indefinitely without a review and off-ramp;
- measures compliance instead of benefit;
- offers a generic wellness list or a menu but never recommends the best first test.

An experiment is ready when it is specific, low burden, risk-calibrated, decision-linked, measurable enough to learn from, and easy to stop.