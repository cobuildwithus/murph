import { defineComparisons } from "../types";

export const HEALTH_ASSISTANT_COMPARISONS = defineComparisons([
  {
    aliases: [
      "BodyBuddy: Better Health",
      "BodyBuddy: Daily Health Coach",
      "BodyBuddy HQ",
    ],
    category: "health-assistants",
    chooseCompetitor:
      "Pick BodyBuddy if you already have a plan or program and want a coach that texts you every day to keep you on it. You also get photo and voice logging, points, badges, and leaderboards.",
    chooseMurph:
      "Choose Murph if you want the daily check-ins but your health does not fit one fixed plan. Murph reads your wearable data, labs, and records, summarizes an appointment from a voice memo, and makes the follow-up calls and bookings.",
    competitor: {
      clinicalRole:
        "BodyBuddy is a consumer wellness and accountability coach. It says it does not give medical advice, does not diagnose conditions, and does not independently verify instructions from a health professional.",
      followThrough:
        "BodyBuddy checks in by text every day and keeps your plan and action items running between check-ins. It also has reminders, progress views, points, badges, and leaderboards. Sharing a plan is optional.",
      format:
        "BodyBuddy is an AI accountability coach that works mainly through texts it sends you first. An app and a website hold your plans, logs, documents, and progress.",
      hardware:
        "You do not need any special hardware. Texting works without installing an app. The iPhone app adds Apple Health and Dynamic Island features.",
      inputs:
        "BodyBuddy takes text, photos, and voice. You can log meals, movement, sleep, and hydration, record appointment audio, upload care or training documents, and share Apple Health data you authorize.",
      insightStyle:
        "BodyBuddy turns your stated goals and any imported instructions into action items. When you log something each day, it replies with encouragement, summaries, and accountability prompts.",
      platforms:
        "BodyBuddy runs on iPhone and iMessage with iOS 15.1 or later, plus web access as described in its terms. It is for adults 18 and older.",
      pricing:
        "BodyBuddy advertises $29 per month with a seven-day trial. Its App Store listing shows several in-app purchase amounts, and its terms say you see the selected price and billing period at checkout.",
      primaryJob:
        "Turn a health goal, a professional's plan, or a program into daily action. It does that with texts it sends first, easy logging, and accountability you can see.",
    },
    competitorEvidence: {
      clinicalRole: [3],
      followThrough: [1],
      format: [1, 3],
      hardware: [1],
      inputs: [1, 2],
      insightStyle: [1],
      platforms: [2, 3],
      pricing: [1, 2, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "This guide covers the health coaching app from BodyBuddy HQ, listed in the US App Store as BodyBuddy: Better Health. The App Store seller is Please Clap, LLC. It does not cover the EMS controller, pregnancy course, or Apple Health utility that share the name.",
        question: "Which BodyBuddy app is this guide about?",
      },
      {
        answer:
          "Yes. BodyBuddy can record an appointment, write a transcript or summary, and turn the instructions into action items. It says the output can contain errors, the professional's original instructions still come first, and you are responsible for any recording consent that is required.",
        question: "Can BodyBuddy record and summarize a doctor's appointment?",
      },
      {
        answer:
          "Only through Apple Health. BodyBuddy documents Apple Health access for steps, workouts, weight, sleep, active energy, and dietary calories, and says Fitbit, Garmin, Oura, and WHOOP data can reach it that way. That relay is not the same as a documented direct connection to each service.",
        question: "Does BodyBuddy connect to Fitbit, Garmin, Oura, or WHOOP?",
      },
    ],
    headline: "BodyBuddy coaches a set plan by text. Murph does that, plus labs and records.",
    lastVerified: "2026-08-31",
    metaDescription:
      "BodyBuddy texts you every day to keep a set plan on track. Murph is a personal health assistant that texts too, and also reads your labs, records, and wearable data.",
    name: "BodyBuddy",
    quickComparison: [
      {
        capability: "Daily accountability loop",
        murph: "yes",
        competitor: "yes",
        evidence: "followThrough",
      },
      {
        capability: "Support beyond a defined plan",
        murph: "yes",
        competitor: "limited",
        evidence: "primaryJob",
      },
      {
        capability: "Records and lab context",
        murph: "yes",
        competitor: "limited",
        evidence: "inputs",
      },
      {
        capability: "Appointment summaries",
        murph: "yes",
        competitor: "yes",
        evidence: "inputs",
      },
      {
        capability: "Game based motivation",
        murph: "limited",
        competitor: "yes",
        evidence: "followThrough",
      },
      {
        capability: "Works in iMessage or Telegram",
        murph: "yes",
        competitor: "yes",
        evidence: "format",
      },
      {
        capability: "Handles health errands",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Tests what works for you",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Free start without a card",
        murph: "yes",
        competitor: "limited",
        evidence: "pricing",
      },
      {
        capability: "Open source option",
        murph: "yes",
        competitor: "no",
        evidence: "platforms",
      },
    ],
    relationship: "alternative",
    slug: "bodybuddy",
    sources: [
      {
        label: "BodyBuddy product overview",
        url: "https://bodybuddy.app/",
      },
      {
        label: "BodyBuddy App Store listing",
        url: "https://apps.apple.com/us/app/bodybuddy-better-health/id6756154234",
      },
      {
        label: "BodyBuddy terms",
        url: "https://bodybuddy.app/terms",
      },
      {
        label: "BodyBuddy privacy policy",
        url: "https://bodybuddy.app/privacy",
      },
    ],
    tradeoffs: [
      "BodyBuddy's daily text loop is a real strength when you have a set plan to carry out. Murph does not have its points, badges, streaks, leaderboards, or game-style daily accountability.",
      "Appointment transcripts, imported plan summaries, and other AI output can be wrong. Check them against the original.",
      "Several of the device connections BodyBuddy advertises work only after the data reaches Apple Health first. They are not direct BodyBuddy integrations.",
    ],
    useTogether:
      "Keep BodyBuddy for the set plan and the daily check-ins. Bring a surprise symptom, lab result, or tradeoff to Murph when it changes what you should do, then update BodyBuddy's plan yourself with what you decide. The two products do not document a direct connection.",
  },
  {
    aliases: ["Ada - your health portal", "Ada Health"],
    category: "health-assistants",
    chooseCompetitor:
      "Ada is the better fit when you have a symptom right now and want structured questions, a report of possible causes, and guidance on whether you may need medical support. Ada is a Class IIa medical device under EU MDR, and Murph is not.",
    chooseMurph:
      "Choose Murph for everything around a symptom: your records, lab results, wearable data, reminders, and booking the appointment. Murph does not diagnose or treat, and it does not rank possible causes the way Ada does.",
    competitor: {
      clinicalRole:
        "Ada says its consumer assessment is a Class IIa medical device under EU MDR. It gives possible explanations and care guidance. It does not diagnose a condition and does not replace professional or emergency care.",
      followThrough:
        "Ada keeps a history of your assessments, and you can review, export, or share the reports. It is not built around daily coaching or habit accountability.",
      format:
        "A structured symptom assessment that works like a conversation. Ada asks follow-up questions and then produces a personalized report.",
      hardware:
        "Ada's symptom assessment needs no special device or wearable.",
      inputs:
        "Ada works from your current symptoms, age, demographic details, health profile, and risk factors, plus your answers to its follow-up questions.",
      insightStyle:
        "Ada compares what you report against a clinical knowledge base and ranks the possible explanations. It then suggests possible next steps, including whether you may need medical support.",
      platforms:
        "Ada runs on iPhone, Android phones and tablets, and Chromebooks, and there is a web version of the symptom assessment. Ada advertises support for seven languages.",
      pricing:
        "Ada says its consumer symptom assessment is free. Its current official app listings also show the consumer app as free.",
      primaryJob:
        "Help you think through a symptom you have right now and decide what kind of care or next step may make sense.",
    },
    competitorEvidence: {
      clinicalRole: [5, 6],
      followThrough: [3],
      format: [2],
      hardware: [1],
      inputs: [2],
      insightStyle: [2, 3, 5],
      platforms: [3, 4, 5],
      pricing: [1, 3, 4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. Ada says its consumer assessment is a Class IIa medical device under EU MDR, but its possible causes and suggested next steps are not a diagnosis. They are also not clinical decision support or a replacement for professional care.",
        question: "Can Ada diagnose a medical condition?",
      },
      {
        answer:
          "Not according to Ada's current consumer materials. Ada asks about your symptoms, basic profile details, and relevant risk factors. It does not document Apple Health, Health Connect, wearable, or medical-record input for the symptom assessment.",
        question: "Does Ada use Apple Health, wearable, or medical record data?",
      },
      {
        answer:
          "No, because they do different jobs. Ada runs a bounded symptom assessment that ends in a report of possible causes and next-step guidance, and Murph does not rank conditions or replace that flow. Murph does not diagnose, but it keeps your questions, data, plans, reminders, and later results connected over time.",
        question: "Can Murph replace Ada?",
      },
    ],
    headline: "Ada assesses a symptom. Murph keeps the rest of your health in one chat.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Ada is a regulated symptom checker that ranks possible causes. Murph is a personal health assistant that does not diagnose but keeps your records, data, and reminders in one chat.",
    name: "Ada",
    quickComparison: [
      {
        capability: "Structured symptom assessment",
        murph: "limited",
        competitor: "yes",
        evidence: "format",
      },
      {
        capability: "Regulated medical device",
        murph: "no",
        competitor: "yes",
        evidence: "clinicalRole",
      },
      {
        capability: "Ongoing health memory",
        murph: "yes",
        competitor: "limited",
        evidence: "followThrough",
      },
      {
        capability: "Wearable and lab context",
        murph: "yes",
        competitor: "no",
        evidence: "inputs",
      },
      {
        capability: "Reminders and follow through",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Works in iMessage or Telegram",
        murph: "yes",
        competitor: "limited",
        evidence: "format",
      },
      {
        capability: "Handles health errands",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Tests what works for you",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Free start without a card",
        murph: "yes",
        competitor: "yes",
        evidence: "pricing",
      },
      {
        capability: "Open source option",
        murph: "yes",
        competitor: "no",
        evidence: "platforms",
      },
    ],
    relationship: "different-role",
    slug: "ada",
    sources: [
      {
        label: "Ada consumer app",
        url: "https://ada.com/app/",
      },
      {
        label: "Ada symptom assessment guide",
        url: "https://ada.com/help/how-do-i-start-a-symptom-assessment/",
      },
      {
        label: "Ada App Store listing",
        url: "https://apps.apple.com/us/app/ada-your-health-portal/id1099986434",
      },
      {
        label: "Ada Google Play listing",
        url: "https://play.google.com/store/apps/details?id=com.ada.app",
      },
      {
        label: "Ada consumer medical-device status",
        url: "https://ada.com/help/what-degree-of-liability-does-ada-accept/",
      },
      {
        label: "Ada terms and regulatory status",
        url: "https://ada.com/terms-and-conditions/",
      },
    ],
    tradeoffs: [
      "Ada's Class IIa status under EU MDR does not make its possible-cause report a diagnosis. It also cannot cover everything a clinician can observe or test.",
      "Ada's structured, finite assessment is the better tool for a symptom you have right now. Murph does not reproduce that regulated assessment and does not rank possible causes.",
      "Typing symptoms in your own words, and some other product details, vary by country, language, and app version.",
    ],
    useTogether:
      "Use Ada for the symptom assessment itself and keep its report to show a clinician. Use Murph to organize the questions that remain and the practical follow-up: appointments, reminders, and records. Neither product documents a direct sync with the other.",
  },
  {
    aliases: ["Hume", "Hume Pod", "Hume Band"],
    category: "health-assistants",
    chooseCompetitor:
      "Pick Hume Health if you want to own the Pod or Band 2.0, collect their measurements, and follow Hume's recovery, body composition, and longevity scores in one app.",
    chooseMurph:
      "Murph is the better fit when the question goes past what a scale or band can measure, like how a weight trend fits with your labs, symptoms, and routines. Murph has no sensors, so it works from the data you connect or upload.",
    competitor: {
      clinicalRole:
        "Hume Health is a consumer wellness system. Hume says the Pod and Band are not medical devices and are not meant to diagnose, monitor, or manage medical conditions.",
      followThrough:
        "Hume gives you a daily briefing, trend views, weekly reports, and personalized guidance. Extra coaching features come with its subscription.",
      format:
        "A phone dashboard with an AI insight layer, paired with a multi-frequency body composition scale and a screenless wearable that measures continuously.",
      hardware:
        "The Hume Pod and Hume Band 2.0 are the main advertised data sources. The app can also read some phone health-platform data, but the body composition and continuous wearable measurements that set Hume apart come from Hume hardware.",
      inputs:
        "Hume takes estimated body composition from the Pod, sleep and recovery data from the Band, and selected Apple Health or Google Fit data.",
      insightStyle:
        "Hume shows metric trends, recovery and activity scores, and daily recommendations. It also produces its own scores, such as Pace of Aging and metabolic scores.",
      platforms:
        "Hume runs on iPhone and iPad with iOS 15 or later, Android phones and tablets, and Chromebook, used together with supported Hume hardware.",
      pricing:
        "Hume's pages list a one-time reference price of $229 for the Pod and $249 for the Band 2.0, with promotional discounts that change. Core scores and data are marketed as free of any subscription, while the App Store lists an optional Hume Plus Annual purchase at $99.99.",
      primaryJob:
        "Bring Hume's body composition and wearable measurements together in one wellness dashboard, with guidance based on your trends.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [2, 3],
      format: [1, 2],
      hardware: [1, 2, 4],
      inputs: [1, 2, 3],
      insightStyle: [1, 2],
      platforms: [3, 4],
      pricing: [1, 2, 3],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "Yes. Hume's current Google Play listing says a Body Pod or Band is required. The Pod supplies body composition estimates and the Band supplies continuous sleep, recovery, and activity data, and selected Apple Health or Google Fit data do not reproduce those Hume measurements.",
        question: "Do I need the Hume Pod or Band to use the Hume Health app?",
      },
      {
        answer:
          "No. Hume describes Pod body composition as an estimate, not a DEXA-equivalent clinical measurement. It describes the Band's blood pressure insights as directional PPG trends, not cuff readings and not a replacement for a validated cuff.",
        question: "Are Hume Health's measurements clinical readings?",
      },
      {
        answer:
          "Not for core scores and data, according to Hume's current product pages. Hume Plus is optional and adds deeper coaching and reports, and the App Store lists it as a $99.99 annual purchase. Hardware prices and promotions change, so check the terms at checkout.",
        question: "Does Hume Health require a subscription?",
      },
    ],
    headline: "Hume measures you with its Pod and Band. Murph helps you decide what to do next.",
    integration: "apple-health",
    lastVerified: "2026-08-31",
    metaDescription:
      "Hume Health pairs its Pod and Band with body composition and recovery estimates. Murph is a personal health assistant with no sensors that keeps labs, records, and wearables in one chat.",
    name: "Hume Health",
    quickComparison: [
      {
        capability: "Body composition estimates",
        murph: "connected",
        competitor: "yes",
        evidence: "inputs",
      },
      {
        capability: "Continuous wearable sensing",
        murph: "connected",
        competitor: "yes",
        evidence: "hardware",
      },
      {
        capability: "Conversational health support",
        murph: "yes",
        competitor: "limited",
        evidence: "insightStyle",
      },
      {
        capability: "Records and lab context",
        murph: "yes",
        competitor: "no",
        evidence: "inputs",
      },
      {
        capability: "Reminders and follow through",
        murph: "yes",
        competitor: "limited",
        evidence: "followThrough",
      },
      {
        capability: "Works without dedicated hardware",
        murph: "yes",
        competitor: "no",
        evidence: "hardware",
      },
      {
        capability: "Handles health errands",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Tests what works for you",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Free start without a card",
        murph: "yes",
        competitor: "no",
        evidence: "pricing",
      },
      {
        capability: "Open source option",
        murph: "yes",
        competitor: "no",
        evidence: "platforms",
      },
    ],
    relationship: "different-role",
    slug: "hume-health",
    sources: [
      {
        label: "Hume Pod",
        url: "https://humehealth.com/pages/the-hume-pod",
      },
      {
        label: "Hume Band",
        url: "https://humehealth.com/pages/the-hume-band",
      },
      {
        label: "Hume Health App Store listing",
        url: "https://apps.apple.com/us/app/hume-health/id1477782599",
      },
      {
        label: "Hume Health Google Play listing",
        url: "https://play.google.com/store/apps/details?id=com.elink.fittrackhealth.pro",
      },
    ],
    tradeoffs: [
      "Hume's experience needs an upfront Pod or Band purchase and ongoing use of the device, though Hume markets its core scores and data without a required subscription. Murph cannot produce Pod body composition or Band sleep and recovery measurements.",
      "The Pod estimates body composition with bioelectrical impedance, so hydration, timing, and calibration can shift the numbers. Band outputs are directional wellness estimates, not clinical readings.",
      "Hume's own aging, recovery, and metabolic scores are not diagnoses, and they do not guarantee a change in outcomes.",
    ],
    useTogether:
      "Keep Hume for the Pod and Band measurements. When a trend raises a question, bring it to Murph and look at it next to the records, labs, symptoms, and routines you have shared, then keep the decision and a later check-in in the chat. No direct Hume-Murph connection is documented.",
  },
  {
    aliases: ["HUMANITY - AI Health Coach", "Humanity Health"],
    category: "health-assistants",
    chooseCompetitor:
      "Humanity is the better fit if you want your phone and wearable data boiled down to Rate of Aging, Biological Age, and H Score. Streaks and daily actions keep the longevity goal in front of you, and blood-based analysis is optional.",
    chooseMurph:
      "Choose Murph if an aging score is one clue among many and you want to weigh it against your records, labs, symptoms, and daily routine. Murph then turns the decision into a plan, a reminder, a check-in, or a small personal experiment.",
    competitor: {
      clinicalRole:
        "Humanity is a consumer wellness and longevity app. It says its scores and guidance are for information only. They are not medical advice, diagnosis, or treatment, and not a reason to change medication or care without a professional.",
      followThrough:
        "Humanity recommends actions across movement, nutrition, mind, and recovery. It also has streaks, weekly reports, and optional social Circles.",
      format:
        "A phone longevity dashboard and AI coach built around Humanity's own aging scores, daily actions, and optional blood-test analysis.",
      hardware:
        "No special hardware is required. A supported phone, an Apple Watch, or another source connected through Apple Health or Health Connect can supply the data.",
      inputs:
        "Humanity reads movement, steps, heart-rate patterns, resting heart rate, and sleep from your phone and wearable. It also counts the actions you mark complete and, if you add them, recent blood-test results.",
      insightStyle:
        "Humanity sums up your inputs as Rate of Aging, Biological Age, H Score, and Blood Age. It then recommends wellness actions meant to move those estimates.",
      platforms:
        "Humanity runs on iPhone with iOS 16 or later, Apple Watch with watchOS 9.3 or later, and Android with supported Health Connect data.",
      pricing:
        "A free account can generate a Rate of Aging score. The US App Store lists Premium purchases, including one at $49.99, and a separate Pro purchase. Humanity's terms allow several billing periods, so confirm the duration and price at checkout.",
      primaryJob:
        "Get you to act on longevity by showing model-based aging estimates and a game-like set of daily wellness actions.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [2],
      format: [2],
      hardware: [2, 3],
      inputs: [2, 3],
      insightStyle: [1, 2],
      platforms: [2, 3],
      pricing: [2, 4],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Humanity's Biological Age and Rate of Aging are wellness estimates produced by a model. They can make your direction and daily actions easier to see, but Humanity does not present them as a clinical diagnosis or a precise forecast for one person.",
        question: "Is Humanity's Biological Age a real medical measurement?",
      },
      {
        answer:
          "No. Humanity can produce its core Rate of Aging from compatible phone and wearable data. Its Pro features can add recent blood-test data for blood-based insights, so lab input is optional and not required for the basic experience.",
        question: "Do I need a blood test to use Humanity?",
      },
      {
        answer:
          "Humanity turns compatible data into an aging score and a loop of daily actions. Murph keeps your different health threads in one ongoing conversation, so a wearable trend, a record, a symptom, a decision, and a later result can inform each other. Longevity does not have to be the frame.",
        question: "How is Humanity different from Murph?",
      },
    ],
    headline: "Humanity gives an aging score and daily actions. Murph adds records and errands.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Humanity turns wearable data into an aging score with daily actions and streaks. Murph, a personal health assistant, keeps records, labs, and reminders in one chat, no score required.",
    name: "Humanity",
    quickComparison: [
      {
        capability: "Biological age estimates",
        murph: "no",
        competitor: "yes",
        evidence: "insightStyle",
      },
      {
        capability: "Game based daily actions",
        murph: "limited",
        competitor: "yes",
        evidence: "primaryJob",
      },
      {
        capability: "Open ended health questions",
        murph: "yes",
        competitor: "limited",
        evidence: "primaryJob",
      },
      {
        capability: "Records and care context",
        murph: "yes",
        competitor: "no",
        evidence: "inputs",
      },
      {
        capability: "Handles health errands",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Tests what works for you",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Free start without a card",
        murph: "yes",
        competitor: "yes",
        evidence: "pricing",
      },
      {
        capability: "Open source option",
        murph: "yes",
        competitor: "no",
        evidence: "platforms",
      },
      {
        capability: "Optional group support",
        murph: "yes",
        competitor: "yes",
        evidence: "followThrough",
      },
      {
        capability: "Reminders and check ins",
        murph: "yes",
        competitor: "limited",
        evidence: "followThrough",
      },
    ],
    relationship: "alternative",
    slug: "humanity",
    sources: [
      {
        label: "Humanity product overview",
        url: "https://humanity.health/",
      },
      {
        label: "Humanity App Store listing",
        url: "https://apps.apple.com/us/app/humanity-ai-health-coach/id1519091344",
      },
      {
        label: "Humanity Google Play listing",
        url: "https://play.google.com/store/apps/details?id=health.humanity.android",
      },
      {
        label: "Humanity terms",
        url: "https://www.humanity.health/terms",
      },
    ],
    tradeoffs: [
      "Humanity's aging scores make a longevity goal concrete and easy to revisit, but an in-house wellness estimate can look more precise than its non-clinical role supports. Murph does not calculate Humanity's Rate of Aging, Biological Age, H Score, or Blood Age.",
      "Blood-based features and deeper analysis sit outside the free core, and may need a higher-priced plan.",
      "Humanity's recommendations are general wellness guidance. They should not drive medication, diagnosis, or treatment decisions.",
    ],
    useTogether:
      "Keep Humanity if its aging scores and daily actions keep you motivated. When a score or weekly pattern raises a bigger question about your records, symptoms, labs, routines, or a tradeoff, bring it to Murph and keep the decision and follow-up there. No direct Humanity-Murph connection is documented.",
  },
  {
    aliases: ["Health Tracker: Healthily", "Your.MD"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Healthily when a predictable tracker is what you want: log selected factors, set goals and reminders, follow a 28-day plan, and read weekly reports and self-care content, all in one iPhone app.",
    chooseMurph:
      "Pick Murph when logging is not the point and you want to put a pattern next to your records, lab results, and wearable data, then talk it through. Murph works in iMessage or Telegram, sets reminders, and checks back in later.",
    competitor: {
      clinicalRole:
        "Healthily is a consumer self-care and wellness app. It says its content and tools do not give medical advice, diagnosis, or treatment and do not replace a health professional.",
      followThrough:
        "Healthily offers goals, reminders, manual trackers, notes, and weekly reports. Its 28-day plans cover activity, mind, nutrition, and sleep.",
      format:
        "A structured health journal for your phone, with trackers, plans, reports, reminders, a back-pain hub, and a library of health information.",
      hardware:
        "No special hardware is required. The current iPhone listing documents Apple Health and Fitbit connections, though the supported fields and how you connect can vary.",
      inputs:
        "You log activity, sleep, mental wellbeing, symptoms, medication, habits, goals, and notes by hand. Healthily can also take selected connected health or Fitbit data.",
      insightStyle:
        "Healthily shows your logs, progress, reminders, and weekly self-care reports. The store listings still advertise a DOT AI checker, but whether it is live for consumers is not established.",
      platforms:
        "Healthily runs on iPhone with iOS 14 or later. It retired and discontinued its Android app on March 31, 2026.",
      pricing:
        "Healthily advertises a seven-day trial. Its App Store list includes a $4.99 weekly entry, $6.49 and $24.99 subscription entries, and a $29.99 lifetime entry. Some durations are unclear, and the checkout terms control.",
      primaryJob:
        "Help you record wellness factors, follow short self-care plans, and review your progress in a structured journal on your phone.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [2],
      format: [2],
      hardware: [2],
      inputs: [2],
      insightStyle: [2, 5],
      platforms: [2, 3],
      pricing: [2],
      primaryJob: [2],
    },
    faqs: [
      {
        answer:
          "Not as far as the current official evidence shows. The iPhone listing still advertises Healthily's DOT chatbot and symptom checker, but Healthily's consumer symptom-checker page says the feature has been temporarily removed.",
        question: "Does Healthily still have an AI symptom checker?",
      },
      {
        answer:
          "Healthily has manual trackers for activity, sleep, mental wellbeing, symptoms, medication, and custom habits. Its iPhone listing also advertises Apple Health and Fitbit connections, though the supported fields and how you connect can vary.",
        question: "What can I track in Healthily?",
      },
      {
        answer:
          "Healthily's terms rule out emergency use. They also say the service is not intended for children under 16, pregnancy, immunosuppression, or managing long-term conditions such as diabetes. A qualified professional is still the right source for medical decisions.",
        question: "Who should not use Healthily?",
      },
    ],
    headline: "Healthily is an iPhone self-care journal. Murph is a health assistant you text.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Healthily is an iPhone self-care journal with trackers, weekly reports, and 28-day plans. Murph is a personal health assistant you text that also reads your records, labs, and wearables.",
    name: "Healthily",
    quickComparison: [
      {
        capability: "Structured daily journal",
        murph: "limited",
        competitor: "yes",
        evidence: "format",
      },
      {
        capability: "Guided self care plans",
        murph: "limited",
        competitor: "yes",
        evidence: "followThrough",
      },
      {
        capability: "Ongoing health conversation",
        murph: "yes",
        competitor: "no",
        evidence: "insightStyle",
      },
      {
        capability: "Records and lab context",
        murph: "yes",
        competitor: "no",
        evidence: "inputs",
      },
      {
        capability: "Works beyond iPhone",
        murph: "yes",
        competitor: "no",
        evidence: "platforms",
      },
      {
        capability: "Handles changing priorities",
        murph: "yes",
        competitor: "limited",
        evidence: "primaryJob",
      },
      {
        capability: "Handles health errands",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Tests what works for you",
        murph: "yes",
        competitor: "no",
        evidence: "followThrough",
      },
      {
        capability: "Free start without a card",
        murph: "yes",
        competitor: "limited",
        evidence: "pricing",
      },
      {
        capability: "Reminders and check ins",
        murph: "yes",
        competitor: "yes",
        evidence: "followThrough",
      },
    ],
    relationship: "different-role",
    slug: "healthily",
    sources: [
      {
        label: "Healthily consumer product",
        url: "https://www.healthily.app/",
      },
      {
        label: "Healthily App Store listing",
        url: "https://apps.apple.com/us/app/health-tracker-healthily/id1491316446",
      },
      {
        label: "Healthily Android retirement notice",
        url: "https://www.healthily.ai/legal-pages/health-tracker-app-for-android-retirement-notice",
      },
      {
        label: "Healthily terms of service",
        url: "https://www.healthily.app/terms-of-service",
      },
      {
        label: "Healthily symptom checker status",
        url: "https://www.livehealthily.com/symptom-checker/",
      },
    ],
    tradeoffs: [
      "Healthily gives you a predictable journal, reports, guided plans, and a content library, but its advertised AI checker cannot be counted on as a live feature. Murph does not have Healthily's dedicated tracker screens, weekly reports, or 28-day plans.",
      "Manual tracking only shows a pattern if you log often enough for the weekly report to have something to work with.",
      "Healthily retired and discontinued its Android app on March 31, 2026, so the current consumer tracker is iPhone only.",
      "Healthily's terms say its self-care use is not intended for children under 16, pregnancy, immunosuppression, or managing long-term conditions such as diabetes.",
    ],
    useTogether:
      "Keep logging symptoms, mood, medication, and habits in Healthily. When a weekly report shows a pattern, send the summary to Murph along with any records, labs, or wearable data you have connected, then decide on a next step and set a later check-in. No automatic Healthily-Murph connection is documented.",
  },
]);
