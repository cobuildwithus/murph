# Evidence register

This register supports the decisions in `SKILL.md` and its references. It is a maintenance aid, not content to load on every user turn.

## How to use it

Prefer, in order:

1. current official rules for event-specific facts
2. consensus statements and systematic reviews for broad decisions
3. controlled trials for narrower interventions
4. observational or sport-specific studies for context and hypothesis generation
5. coach convention only when clearly labeled as practice rather than settled evidence

Evidence quality does not remove the need to individualize. Population, sport, training status, event duration, and outcome definitions often differ. Where findings are mixed or transfer is indirect, the runtime guidance should remain a range or decision rule rather than a universal prescription.

## Product and prompt architecture

| Source | What it supports | Design implication |
|---|---|---|
| [Murph `AGENTS.md`](https://github.com/cobuildwithus/murph/blob/main/AGENTS.md) | Default to deletion and radical simplicity; add complexity only for a concrete need or failing test. | One orchestration skill, no event-plan catalog, score, service, schema, or parallel habit engine. |
| [Murph `behavior-followthrough`](https://github.com/cobuildwithus/murph/blob/main/packages/assistant-engine/skills/behavior-followthrough/SKILL.md) | Existing ownership of anchors, tiny/fallback versions, reminders, repeated-miss repair, privacy, and support fading. | Competition training identifies the decisive behavior; `behavior-followthrough` implements adherence support. |
| [OpenAI: Using GPT-5.5](https://developers.openai.com/api/docs/guides/latest-model) | Start with the smallest prompt that preserves the contract; use outcome-first goals, success criteria, stopping rules, and representative evals. | Core skill states outcome and constraints, loads detail progressively, answers directly, and stops when the decision is resolved. |

## Training structure, load, and adaptation

| Source | Evidence type | What it supports in the skill |
|---|---|---|
| [Rosenblat et al., 2024](https://pubmed.ncbi.nlm.nih.gov/38717713/) | Systematic review and meta-analysis | Polarized training may help some endurance outcomes, but it is not a universal template. |
| [Network meta-analysis of endurance intensity distributions, 2025](https://pubmed.ncbi.nlm.nih.gov/39888556/) | Individual participant data network meta-analysis | Different intensity distributions can work; training status and context matter. |
| [Bosquet et al., taper meta-analysis](https://pubmed.ncbi.nlm.nih.gov/17762369/) | Meta-analysis | Tapers generally reduce load while retaining some intensity; exact form varies. |
| [Tapering and performance, 2023](https://pubmed.ncbi.nlm.nih.gov/37163550/) | Systematic review and meta-analysis | Supports fatigue reduction without a fixed taper formula. |
| [Strength training for distance runners, 2024](https://pubmed.ncbi.nlm.nih.gov/38165636/) | Systematic review and meta-analysis | Strength work can improve performance determinants when integrated without displacing decisive endurance work. |
| [Strength training and endurance performance, 2025](https://pubmed.ncbi.nlm.nih.gov/40153564/) | Umbrella review | Supports a strength-and-durability primitive across endurance events, with dosage individualized. |
| [Concurrent aerobic and strength training, 2022](https://pubmed.ncbi.nlm.nih.gov/34757594/) | Systematic review and meta-analysis | Concurrent training is usually compatible when fatigue, sequencing, and mode are managed. |
| [Periodization in trained cyclists, 2023](https://pubmed.ncbi.nlm.nih.gov/35418513/) | Systematic review | No single periodization model was clearly superior over the studied windows. |
| [Distance-running periodization review, 2022](https://pubmed.ncbi.nlm.nih.gov/35871903/) | Systematic review | Supports phase objectives while cautioning against rigid calendar dogma. |
| [IOC load and injury consensus](https://pubmed.ncbi.nlm.nih.gov/27535989/) | Consensus statement | Load should be progressed and monitored in context; excessive spikes and poor recovery can matter. |
| [IOC load and illness consensus](https://pubmed.ncbi.nlm.nih.gov/27535991/) | Consensus statement | Training stress interacts with illness risk, travel, sleep, and other stressors. |
| [Subjective monitoring systematic review](https://pubmed.ncbi.nlm.nih.gov/26423706/) | Systematic review | Athlete-reported fatigue, wellness, and symptoms can be useful alongside objective data. |
| [Acute-to-chronic workload ratio limitations](https://pubmed.ncbi.nlm.nih.gov/32502973/) | Methodological review | Do not use one ratio or "safe zone" as an injury oracle or clearance tool. |
| [Pacing strategy review](https://pubmed.ncbi.nlm.nih.gov/18278984/) | Review | Pacing is an event-specific decision skill shaped by duration, environment, competition, and feedback. |
| [Novice running progression and injury, 2014](https://pubmed.ncbi.nlm.nih.gov/25155475/) | Prospective cohort | Abrupt changes can be problematic, but the evidence does not establish a universal weekly percentage rule. |
| [Marathon training characteristics and outcomes, 2020](https://pubmed.ncbi.nlm.nih.gov/32421886/) | Observational study | Recent training history and long-run exposure are useful context, not guarantees. |
| [Recovery and performance consensus](https://pubmed.ncbi.nlm.nih.gov/29345524/) | Consensus statement | Recovery is part of the training dose; modalities should not substitute for sleep, nutrition, and load management. |
| [Athlete sleep consensus, 2021](https://pubmed.ncbi.nlm.nih.gov/33144349/) | Expert consensus | Sleep guidance should be individualized and focus on opportunity, regularity, symptoms, and context. |

## Competition-demand transfer

Direct evidence is uneven across event brands. These sources justify demand overlays, not brand-specific certainty.

| Source | Evidence type | What it supports in the skill |
|---|---|---|
| [Bike-to-run transition review, 2022](https://pubmed.ncbi.nlm.nih.gov/36640771/) | Systematic review | Multisport plans should include transition-specific practice and altered run mechanics/fatigue. |
| [HYROX physiological demands, 2025](https://pubmed.ncbi.nlm.nih.gov/40230601/) | Sport-specific study | Running under station fatigue is a meaningful hybrid demand; evidence remains emerging. |
| [CrossFit performance predictors, 2023](https://pubmed.ncbi.nlm.nih.gov/37368562/) | Systematic review | Predictors vary by workout and study; avoid a single universal readiness test. |
| [Hybrid functional fitness competition review, 2025](https://pubmed.ncbi.nlm.nih.gov/41133555/) | Systematic review | Supports combining aerobic capacity, strength endurance, skill, and repeated-effort recovery by event demand. |

## Population modifiers

Population modifiers should change decisions without creating separate plan engines or stereotypes.

| Source | Evidence type | What it supports in the skill |
|---|---|---|
| [IOC youth athletic development consensus](https://pubmed.ncbi.nlm.nih.gov/26084524/) | Consensus statement | Youth preparation should protect healthy development, broad skill, appropriate progression, recovery, and the athlete's long-term interests. |
| [IOC elite youth athletes competing at senior level, 2024](https://pubmed.ncbi.nlm.nih.gov/39197945/) | Consensus statement | Adult-level competition by youth requires individualized readiness, safeguarding, load, health, and developmental context rather than performance alone. |
| [Sports nutrition for the adolescent athlete](https://pubmed.ncbi.nlm.nih.gov/24668620/) | Position statement | Growth and training create distinct energy/nutrient needs; use food-first guidance and avoid overemphasizing supplements. |
| [Periodic health evaluation in Para athletes, 2024](https://pubmed.ncbi.nlm.nih.gov/39411023/) | Expert consensus position statement | Para-athlete health assessment should be individualized around impairment, equipment, sport demands, access, and athlete expertise. |
| [Nutrition for young, female, and masters athletes](https://pubmed.ncbi.nlm.nih.gov/30632423/) | Review | Life-stage nutrition needs differ; prioritize long-term health, adequate intake, at-risk patterns, and food before supplements. |

## Habit formation, motivation, and performance psychology

| Source | Evidence type | What it supports in the skill |
|---|---|---|
| [Habit formation timing, 2024](https://pubmed.ncbi.nlm.nih.gov/39685110/) | Systematic review and meta-analysis | Habit formation varies widely; do not promise a fixed day count or treat automaticity as required for elite practice. |
| [Habit-formation interventions for physical activity, 2023](https://pubmed.ncbi.nlm.nih.gov/37700303/) | Systematic review and meta-analysis | Context cues and repetition can help, but effects and intervention quality vary. |
| [Implementation intentions and exercise](https://pubmed.ncbi.nlm.nih.gov/31923898/) | Systematic review and meta-analysis | Specific if-then plans can improve follow-through, especially when paired with feasible action. |
| [Action planning for physical activity, 2022](https://pubmed.ncbi.nlm.nih.gov/35995541/) | Systematic review and meta-analysis | Action and coping plans are useful, but should remain low burden and context-specific. |
| [Goal setting in sport and physical activity](https://pubmed.ncbi.nlm.nih.gov/29189034/) | Systematic review and meta-analysis | Process and performance goals can improve behavior and performance when specific and appropriately challenging. |
| [Autonomy support in sport and exercise](https://doi.org/10.1080/1750984X.2022.2031252) | Systematic review and meta-analysis | Autonomy-supportive coaching is associated with stronger autonomous motivation, need support, and well-being. |
| [Sport self-efficacy and performance](https://pubmed.ncbi.nlm.nih.gov/10999265/) | Meta-analysis | Confidence should be task-specific and calibrated from relevant evidence rather than generic hype. |
| [Psychological interventions and sport performance, 2024](https://pubmed.ncbi.nlm.nih.gov/37812334/) | Systematic review and meta-analysis | Mental skills can help performance, but effects vary and should be practiced in task context. |
| [Psychological interventions in competitive sport, 2017](https://pubmed.ncbi.nlm.nih.gov/27241124/) | Meta-analysis | Supports selective use of imagery, goal setting, self-talk, and related skills rather than a large mandatory mental program. |
| [Self-talk and sport performance](https://pubmed.ncbi.nlm.nih.gov/26167788/) | Systematic review and meta-analysis | Brief task-relevant instructional or motivational cues can help; wording and task matter. |
| [Pre-performance routines](https://doi.org/10.1080/1750984X.2021.1944271) | Systematic review and meta-analysis | Short, rehearsed routines can stabilize attention and execution under pressure. |
| [Choking-prevention interventions, 2026](https://pubmed.ncbi.nlm.nih.gov/41951087/) | Systematic review and meta-analysis | Pressure skills should be trained, not introduced as slogans on competition day. |
| [Perfectionism and athlete burnout, 2023](https://pubmed.ncbi.nlm.nih.gov/37239703/) | Systematic review and meta-analysis | Perfectionistic concerns are associated with burnout; flexible standards and non-punitive review are protective design choices. |
| [Multidimensional perfectionism and burnout](https://pubmed.ncbi.nlm.nih.gov/26231736/) | Meta-analysis | Strivings and concerns differ; high standards are not the same as self-criticism or fear of mistakes. |
| [Athlete burnout review](https://pubmed.ncbi.nlm.nih.gov/28813331/) | Review | Monitor exhaustion, reduced accomplishment, devaluation, and context rather than labeling ordinary fatigue. |
| [Athlete self-compassion intervention](https://pubmed.ncbi.nlm.nih.gov/24197719/) | Controlled intervention | A non-punitive response to setbacks can support coping without lowering standards. |
| [Mental health in elite athletes](https://pubmed.ncbi.nlm.nih.gov/26896951/) | Systematic review | Elite status does not protect against mental-health problems; route distress and impairment appropriately. |
| [Psychological determinants of endurance performance](https://pubmed.ncbi.nlm.nih.gov/25771784/) | Systematic review | Perception of effort, motivation, and cognition matter, but should not override physical safety signals. |

## Fueling, recovery, and safety

| Source | Evidence type | What it supports in the skill |
|---|---|---|
| [IOC REDs consensus, 2023](https://pubmed.ncbi.nlm.nih.gov/37752011/) | Consensus statement | Protect energy availability; route suspected REDs and related health/performance changes to qualified care. |
| [IOC body-composition best practice, 2023](https://pubmed.ncbi.nlm.nih.gov/37752006/) | Consensus recommendations | Avoid default weight-loss framing, rapid manipulation, and appearance-based performance assumptions. |
| [Nutrition and athletic performance](https://pubmed.ncbi.nlm.nih.gov/26891166/) | Position statement | Everyday intake and event fueling should be matched to training, duration, intensity, and individual tolerance. |
| [Carbohydrate for training and competition](https://pubmed.ncbi.nlm.nih.gov/21660838/) | Review/consensus framework | Supports duration-based carbohydrate orientation ranges, translated into practiced practical units. |
| [Endurance nutrition review](https://pubmed.ncbi.nlm.nih.gov/21916794/) | Review | Fueling needs rise with duration and intensity; tolerance and logistics constrain the usable plan. |
| [Gut training systematic review, 2023](https://pubmed.ncbi.nlm.nih.gov/37061651/) | Systematic review | GI tolerance may be trainable; change one variable at a time and test before competition. |
| [Exercise-associated hyponatremia review, 2020](https://pubmed.ncbi.nlm.nih.gov/32097926/) | Review | Avoid forced overdrinking; neurologic symptoms during/after prolonged exercise require urgent evaluation. |
| [Exertional heat illness consensus, 2023](https://pubmed.ncbi.nlm.nih.gov/37036463/) | Consensus statement | Heat changes pacing and risk; altered mental status/collapse is an emergency and rapid cooling matters. |
| [Acute respiratory illness and return to sport, 2022](https://pubmed.ncbi.nlm.nih.gov/34789459/) | Systematic review | Return should be staged and symptom/context dependent; do not use a simplistic clearance rule. |
| [IOC acute respiratory infection consensus, 2022](https://pubmed.ncbi.nlm.nih.gov/35863871/) | Consensus statement | Supports risk assessment and graded return rather than making up missed training. |
| [Caffeine in exercise position stand, 2021](https://pubmed.ncbi.nlm.nih.gov/33388079/) | Position stand | Caffeine can help some athletes; dose, timing, tolerance, sleep, age, health, and product risk matter. |
| [IOC supplements consensus](https://pubmed.ncbi.nlm.nih.gov/29540367/) | Consensus statement | Supplements are situational, may be contaminated, and should not replace fundamentals. |
| [Menstrual-cycle phase and performance](https://pubmed.ncbi.nlm.nih.gov/32661839/) | Systematic review and meta-analysis | Average effects are small/variable; individual symptoms and patterns matter more than rigid phase-based programming. |
| [ACOG exercise during pregnancy and postpartum](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period) | Clinical guidance | Pregnancy and postpartum exercise decisions require current contraindications, warning signs, clinical context, and individualized progression. |
| [Postpartum return-to-running consensus, 2024](https://pubmed.ncbi.nlm.nih.gov/38148108/) | International expert consensus study | Return to running should be symptom-, recovery-, and context-informed rather than a single universal calendar rule. |
| [Protein and exercise position stand](https://pubmed.ncbi.nlm.nih.gov/28642676/) | Position stand | Supports adequate protein distributed through the day while avoiding unnecessary precision in ordinary coaching. |

## Official current event sources

Static skill text must not copy changing rules as durable truth. Verify the organizer, race guide, or governing body when a rule changes training or execution.

- [World Athletics rules](https://worldathletics.org/about-iaaf/documents/book-of-rules)
- [World Triathlon competition rules](https://triathlon.org/documents/competition-rules)
- [IRONMAN competition rules](https://www.ironman.com/resources/rules-and-policies/competition-rules)
- [UCI regulations](https://www.uci.org/regulations/3MyLDDrwJCJJ0BGGOFzOat)
- [HYROX rulebooks](https://hyrox.com/rulebook/)
- [Spartan race formats and official information](https://race.spartan.com/en/race)
- [Tough Mudder official event information](https://toughmudder.com/)
- [CrossFit Games rules](https://games.crossfit.com/rules)
- [WADA Prohibited List](https://www.wada-ama.org/en/prohibited-list)

## Maintenance rules

- Add a source only when it changes a decision, resolves a disputed claim, or replaces weaker evidence.
- Prefer updating an interpretation over growing the runtime prompt.
- Record uncertainty and population limits; do not convert association into causation.
- Recheck systematic reviews, consensus statements, and official rules periodically.
- Keep current event facts out of static adapters. Retrieve them at use time.
- Remove obsolete, duplicate, or non-decision-relevant citations rather than optimizing for citation count.
