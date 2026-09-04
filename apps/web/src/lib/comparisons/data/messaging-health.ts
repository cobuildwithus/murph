import { defineComparisons } from "../types";

export const MESSAGING_HEALTH_COMPARISONS = defineComparisons([
  {
    aliases: ["Tempo Health", "Tempo AI Health Assistant"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Tempo if an iPhone dashboard with one Healthspan Score, a concrete goal protocol, daily actions, iMessage food logging, and step challenges is the structure that will keep you moving.",
    chooseMurph:
      "Choose Murph if you want one ongoing assistant across records, symptoms, labs, devices, meals, reminders, and practical health errands, and you want to test changes against your own baseline instead of centering everything on one score.",
    competitor: {
      clinicalRole:
        "Tempo is a consumer wellness product. Its terms say its wearable, self-reported, and AI-generated insights are general wellness guidance, not medical advice, diagnosis, treatment, or clinical care.",
      followThrough:
        "Tempo turns a chosen goal into daily actions, weekly adjustments, reminders, custom protocols, and step challenges. The public materials describe automated coaching rather than accountability from a clinician or human coach.",
      format:
        "An iPhone-first health app with a visual Healthspan Score and protocol dashboard, plus an iMessage companion for food logging and health questions.",
      hardware:
        "Tempo sells no proprietary device. An iPhone running iOS 18 or later is the core requirement, while Apple Health and connected wearables add many of the physiological signals used by its signature insights.",
      inputs:
        "Goals, Apple Health and wearable data, uploaded bloodwork, meal photos, nutrition, habits, soreness, and schedule context. Tempo names Apple Watch, Oura, Garmin, WHOOP, and Fitbit or Google Health across its current materials and release notes.",
      insightStyle:
        "Tempo combines cardiorespiratory fitness, metabolic health, recovery and sleep, and lifestyle behavior into a Healthspan Score. It also surfaces plain-language patterns and one prioritized action tied to a selected goal.",
      platforms:
        "Tempo is designed for iPhone and iMessage. Its App Store listing also allows Apple-silicon Mac and Apple Vision installations with limitations, but no Android app, web dashboard, or self-hosted option is documented.",
      pricing:
        "Tempo is free to download with in-app purchases. The US App Store listed Tempo Pro at $9.99 monthly or $34.99 annually when reviewed, while the product site did not publish a clear free-versus-Pro feature matrix.",
      primaryJob:
        "Turn a chosen health goal into adaptive daily actions by combining wearable signals, labs, food, and habits, with a composite score that makes the next priority easy to see.",
    },
    competitorEvidence: {
      clinicalRole: [3],
      followThrough: [1, 4],
      format: [1, 4],
      hardware: [2, 4],
      inputs: [1, 2, 4],
      insightStyle: [1],
      platforms: [4],
      pricing: [4],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Tempo is built around a Healthspan Score, goal-specific protocols, and daily actions inside an iPhone app. Murph is built around an ongoing conversation that can include records, symptoms, labs, wearable data, reminders, personal experiments, and practical health errands.",
        question: "How is Tempo different from Murph?",
      },
      {
        answer:
          "Tempo does not sell or require proprietary hardware. Its public materials also accept labs, food, habits, and self-reported context, but many signature insights use Apple Health or connected-wearable signals. The official pages do not define the minimum experience without a wearable.",
        question: "Do I need a wearable to use Tempo?",
      },
      {
        answer:
          "No. Tempo presents the score as a personal, science-grounded wellness summary, and its terms say the service does not provide medical advice, diagnosis, or treatment. Treat it as guidance rather than a clinical result.",
        question: "Is Tempo's Healthspan Score a medical assessment?",
      },
    ],
    headline:
      "Tempo scores your healthspan and structures a goal plan. Murph keeps the wider context moving.",
    lastVerified: "2026-09-03",
    metaDescription:
      "Tempo turns wearables, labs, food, and habits into a Healthspan Score and daily protocol. Murph is a personal health assistant for records, experiments, reminders, and errands.",
    name: "Tempo",
    quickComparison: [
      { capability: "Composite Healthspan Score", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Adaptive goal protocols", competitor: "yes", evidence: "primaryJob", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Photo food logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Visual protocol dashboard", competitor: "yes", evidence: "format", murph: "limited" },
      { capability: "Reminders and check ins", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "limited", evidence: "format", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "tempo",
    sources: [
      { label: "Tempo product and Healthspan Score", url: "https://jointempo.app/#score" },
      { label: "Tempo privacy policy", url: "https://jointempo.app/privacy" },
      { label: "Tempo terms", url: "https://jointempo.app/terms" },
      { label: "Tempo App Store listing", url: "https://apps.apple.com/us/app/tempo-ai-health-assistant/id6753098010" },
    ],
    tradeoffs: [
      "Tempo's composite score and narrow goal loop are easy to scan, but a generated wellness score can look more precise than its non-clinical role supports. The cited pages do not publish a score-validation method.",
      "Tempo has real breadth across wearables, labs, nutrition, habits, and AI chat, but its current site does not publish a stable integration and field matrix.",
      "Tempo is Apple-centric and gives exact Pro prices in the App Store without clearly explaining plan gating on its site. Murph does not offer Tempo's visual Healthspan Score or challenge dashboard.",
    ],
    useTogether:
      "Keep Tempo for its score, goal protocol, and challenge loop, then use Murph for broader record context, personal experiments, reminders, and practical follow-through. No direct connection is documented, so do not expect automatic Tempo data import.",
  },
  {
    aliases: ["Nudge AI Health Coach", "Nudge Health Coach"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Nudge if your main need is a focused fitness or nutrition plan with firm daily accountability delivered through SMS or iMessage.",
    chooseMurph:
      "Choose Murph if you want an ongoing health assistant that can coach habits while also reading connected wearables, labs, records, symptoms, meals, and workouts, then help with errands and personal experiments.",
    competitor: {
      clinicalRole:
        "Nudge describes itself as an AI health coach for workout plans, nutrition advice, check-ins, and accountability. Its public materials do not claim clinician involvement, diagnosis, treatment, or regulated medical-device status.",
      followThrough:
        "Nudge texts daily about workouts, meals, and habits, notices when you stop responding, follows up, adjusts a plan when it is not working, and recognizes progress.",
      format:
        "An AI coach delivered through ordinary text messages. Nudge markets the coaching experience as requiring no app download, though it also provides a web login for account management.",
      hardware:
        "A texting-capable phone is required. Nudge does not advertise proprietary hardware or a required wearable.",
      inputs:
        "Nudge learns from goals, schedule, health history, previous approaches, and text replies about workouts, meals, and habits. Its privacy policy says information is user-disclosed and is not collected from third parties.",
      insightStyle:
        "Conversational and behavior-focused. It builds a practical plan, changes the plan from reported feedback, gives direct accountability prompts, and calls out or celebrates progress rather than presenting clinical analysis.",
      platforms:
        "SMS and iMessage, with a web login and account surface. Its terms describe an SMS coaching program and the site says its start action opens iMessage or another texting app.",
      pricing:
        "The product page advertises $29 per month and a 30-day money-back guarantee. The terms say subscriptions renew monthly until canceled and separately say all purchases are non-refundable, creating an official policy conflict.",
      primaryJob:
        "Build a personalized fitness and nutrition plan around daily life, then keep the member following it through proactive text check-ins and accountability.",
    },
    competitorEvidence: {
      clinicalRole: [1, 3],
      followThrough: [1, 3],
      format: [1, 3],
      hardware: [1, 3],
      inputs: [1, 2],
      insightStyle: [1],
      platforms: [1, 3],
      pricing: [1, 3],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "No. Nudge says it is powered by AI. It builds fitness and nutrition plans, texts daily, adapts from your replies, and follows up when you go quiet. Its public materials do not describe an assigned human coach.",
        question: "Is Nudge a human health coach?",
      },
      {
        answer:
          "No such connection is documented in the official materials reviewed. Nudge describes learning from what you tell it by text, and its privacy policy says it does not collect information from third parties.",
        question: "Does Nudge connect to wearables, labs, or records?",
      },
      {
        answer:
          "Both can coach and check in through messaging. Nudge is the more narrowly positioned daily fitness and nutrition accountability product. Murph is broader when coaching needs to sit beside wearables, labs, records, symptoms, errands, or personal experiments.",
        question: "Can Murph replace Nudge?",
      },
    ],
    headline:
      "Nudge keeps a fitness plan moving by text. Murph connects the rest of your health.",
    lastVerified: "2026-09-03",
    metaDescription:
      "Nudge is a $29 monthly AI coach with daily fitness and nutrition accountability. Murph is a personal health assistant for wearables, labs, records, experiments, and errands.",
    name: "Nudge",
    quickComparison: [
      { capability: "Daily accountability loop", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Personalized fitness plans", competitor: "yes", evidence: "primaryJob", murph: "yes" },
      { capability: "Firm coaching pressure", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "No app download required", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab data", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "nudge",
    sources: [
      { label: "Nudge product overview", url: "https://www.nudge.gs/" },
      { label: "Nudge privacy policy", url: "https://www.nudge.gs/privacy" },
      { label: "Nudge terms and SMS program", url: "https://www.nudge.gs/terms" },
    ],
    tradeoffs: [
      "Nudge's narrow daily accountability loop is a strength when fitness or nutrition consistency is the main problem. Murph does not promise the same deliberately firm coaching tone.",
      "Nudge's public materials do not document connected wearables, labs, medical records, health errands, or group support.",
      "Nudge's sales page advertises a 30-day money-back guarantee, while its legal terms say all purchases are non-refundable. Confirm the checkout terms before relying on the guarantee.",
    ],
    useTogether:
      "Use Nudge for the daily fitness or nutrition accountability loop. Bring wearable patterns, lab results, records, symptoms, or a health decision to Murph and keep the broader follow-through there. No direct connection is documented.",
  },
  {
    category: "health-assistants",
    chooseCompetitor:
      "Choose Matcha if you want a calm general-life chief of staff that watches your calendar, inbox, notes, commitments, and optional health context, then nudges you in messaging.",
    chooseMurph:
      "Choose Murph if your main job is understanding and acting on your health across wearables, labs, records, routines, and personal experiments.",
    competitor: {
      clinicalRole:
        "Matcha is a consumer informational, planning, coaching, and lifestyle assistant. Its policies say it is not a medical provider, diagnostic service, emergency service, or substitute for professional advice.",
      followThrough:
        "Matcha tracks goals and loose ends, checks in, and prepares reminders, plans, drafts, and authorized calendar actions. Booking, ordering, and message sending are still being rolled out during its private beta.",
      format:
        "A private AI assistant centered on familiar messaging rather than another dashboard or streak system. Optional integrations enrich the conversation.",
      hardware:
        "No proprietary device or wearable is required, and chat works without installing an app. Apple Health may require a small iOS companion app, while wearables are optional context.",
      inputs:
        "Chat, calendar, Gmail, notes, reminders, Apple Health records, activity, workouts, sleep, recovery, body measurements, and other optional wearable data. Its homepage displays WHOOP, Oura, Withings, and Strava.",
      insightStyle:
        "Context-aware, proactive triage of what needs attention, producing personalized recommendations, summaries, coaching, reminders, drafts, and planning support. Structured personal experiments are not documented.",
      platforms:
        "The homepage markets iMessage and Android RCS, while its privacy and terms pages also name Telegram as a service channel. Matcha has no public number yet and is onboarding small private-beta batches.",
      pricing:
        "Matcha is free during its private beta. It promises a future free version and an unspecified paid plan, but no paid price is currently published.",
      primaryJob:
        "Remember goals, routines, people, commitments, and preferences, notice loose ends, and turn them into timely reminders, drafts, plans, or next steps across everyday life.",
    },
    competitorEvidence: {
      clinicalRole: [3, 4],
      followThrough: [1, 3],
      format: [1, 2],
      hardware: [1],
      inputs: [1, 3],
      insightStyle: [1, 3],
      platforms: [1, 3, 4],
      pricing: [1, 2],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "Matcha's own FAQ says it is not exactly a health app. It can use health context and support sleep, movement, food, and recovery routines, but its larger job is follow-through across plans, people, reminders, errands, and goals.",
        question: "Is Matcha a health app or a general assistant?",
      },
      {
        answer:
          "No. Matcha says ordinary messaging works without an installed app or special hardware. Apple Health may require a small companion app, and all connected sources are optional.",
        question: "Do I need an app or wearable to use Matcha?",
      },
      {
        answer:
          "Only on a limited beta basis. Matcha documents reminders, planning, drafts, and connected calendar actions, but says deeper actions such as booking, ordering, and sending messages are still being rolled out carefully.",
        question: "Can Matcha book, order, or send things for me?",
      },
    ],
    headline:
      "Matcha keeps life's loose ends moving. Murph focuses that relationship on health.",
    lastVerified: "2026-09-03",
    metaDescription:
      "Matcha is a general-life chief of staff for messages, calendars, inboxes, and loose ends. Murph is a personal health assistant for labs, records, experiments, and health errands.",
    name: "Matcha",
    quickComparison: [
      { capability: "Broad daily life scope", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Native Android RCS", competitor: "yes", evidence: "platforms", murph: "no" },
      { capability: "Messaging first assistant", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Calendar and email help", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Wearable and health data", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Records and lab data", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "matcha",
    sources: [
      { label: "Matcha product overview", url: "https://heymatcha.app/" },
      { label: "About Matcha", url: "https://heymatcha.app/about" },
      { label: "Matcha privacy policy", url: "https://heymatcha.app/privacy" },
      { label: "Matcha terms", url: "https://heymatcha.app/terms" },
    ],
    tradeoffs: [
      "Matcha's genuine advantage is breadth across calendars, inboxes, notes, personal commitments, errands, and optional health data. Murph's advantage is health depth.",
      "Matcha remains a private beta with no public number and no finalized paid pricing. Booking, ordering, and message sending are still rolling out.",
      "Matcha deliberately avoids a dashboard and streak system. That can feel calmer, but Murph is better suited to records, labs, and explicit personal experiments.",
    ],
    useTogether:
      "Use Matcha for general-life follow-through and Murph for health decisions and execution. If both see the same calendar, inbox, or wearable sources, choose which assistant owns reminders to avoid duplicate follow-ups. No direct connection is documented.",
  },
  {
    aliases: ["IrisChat", "Iris AI for your mind"],
    category: "sleep-mental",
    chooseCompetitor:
      "Choose Iris if you mainly want a dedicated, judgment-free place to talk through thoughts and feelings by text. It is built around emotional reflection, remembers the conversation, and supports iMessage and RCS.",
    chooseMurph:
      "Choose Murph when how you feel needs to be weighed with sleep, symptoms, wearable data, labs, or records, and you want reminders, personal experiments, or practical health errands afterward. Murph is not therapy or emergency care.",
    competitor: {
      clinicalRole:
        "Iris is a consumer mental-health and emotional-wellbeing companion, not a medical or clinical service. It does not diagnose, treat, or replace care, and its automated crisis detection may miss emergencies.",
      followThrough:
        "Iris says it remembers the thread and carries context across conversations. Its public pages do not document reminders, habit programs, personal experiments, appointment booking, or other health errands.",
      format:
        "An AI companion reached through an ordinary messaging app. Iris says there is no new app or login; you text it like a private confidant and it responds conversationally.",
      hardware:
        "No proprietary hardware is documented. You need a device and messaging app that can send and receive on a supported platform, tied to an active phone number or platform account.",
      inputs:
        "Messages and conversation content, onboarding and wellbeing-assessment responses, demographic details, emotional state, support preferences, and information authorized from unnamed third parties. No named wearable, lab, or record integration is published.",
      insightStyle:
        "Empathetic, open-ended reflection rather than a score or clinical assessment. Iris says it uses memory, context, and emotional intelligence to adapt to your language and patterns and surface possibilities.",
      platforms:
        "Apple iMessage and RCS are the currently documented messaging platforms. The service is for adults 18 and older, and Telegram support is not documented.",
      pricing:
        "Iris's terms describe an automatically renewing subscription billed at the frequency agreed when purchased. Its public pages do not state a dollar price or free-trial allowance.",
      primaryJob:
        "Give adults an always-available AI confidant for talking, reflecting, and making sense of thoughts and feelings over time.",
    },
    competitorEvidence: {
      clinicalRole: [3, 4, 5],
      followThrough: [2],
      format: [1, 2, 4],
      hardware: [4],
      inputs: [3],
      insightStyle: [2],
      platforms: [4],
      pricing: [4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. Iris says it is an AI wellness and emotional-support service, not a therapist, clinician, or medical service. Its responses may be inaccurate or incomplete and should not replace professional care.",
        question: "Is Iris an AI therapist?",
      },
      {
        answer:
          "No. Iris can display crisis resources when its automated system detects certain content, but the system may miss a crisis and does not contact clinicians, emergency services, or another support person. Use appropriate local crisis services in an emergency.",
        question: "Can Iris respond to a mental health emergency?",
      },
      {
        answer:
          "Not in any named, verifiable way on the public pages reviewed. Iris allows for authorized third-party information in its privacy policy, but does not name Apple Health, wearables, labs, or medical-record connections.",
        question: "Does Iris connect to wearables, labs, or records?",
      },
    ],
    headline:
      "Iris helps you reflect by text. Murph connects the rest of your health.",
    lastVerified: "2026-09-03",
    metaDescription:
      "Iris is an AI companion for emotional reflection in iMessage and RCS. Murph is a personal health assistant for wearable, lab, record, experiment, reminder, and errand context.",
    name: "Iris",
    quickComparison: [
      { capability: "Focused emotional support", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Remembers prior chats", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Native Android RCS", competitor: "yes", evidence: "platforms", murph: "no" },
      { capability: "Works in iMessage or Telegram", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab data", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "iris",
    sources: [
      { label: "Iris product overview", url: "https://chatwithiris.com/" },
      { label: "The story of Iris", url: "https://chatwithiris.com/learn-more/" },
      { label: "Iris privacy policy", url: "https://chatwithiris.com/privacy/" },
      { label: "Iris terms and conditions", url: "https://chatwithiris.com/terms-conditions/" },
      { label: "Iris safety protocol", url: "https://chatwithiris.com/safety-protocol/" },
    ],
    tradeoffs: [
      "Iris is more deliberately shaped around empathetic reflection and emotional companionship. Murph can discuss mental wellbeing, but it is not a dedicated emotional companion.",
      "Iris's memory can make the conversation feel continuous, but AI responses may be inaccurate or incomplete, and automated safety detection is not reliable crisis care.",
      "Iris describes itself as a private confidant, while its policy allows some conversation content to support improvement and research. Review the retention and processing details before sharing sensitive information.",
    ],
    useTogether:
      "Use Iris when you want a dedicated space to talk through thoughts and feelings. Use Murph when the question reaches sleep, symptoms, labs, records, routines, or an action you want carried through. Their histories remain separate.",
  },
  {
    aliases: ["Sam", "Sunflower", "Sunflower Sober", "Sunflower Quit Any Addiction"],
    category: "sleep-mental",
    chooseCompetitor:
      "Choose Sam by Sunflower if addiction recovery is the main job and you want an always-available recovery companion, CBT-style exercises, a sober-day tracker, and an anonymous recovery community.",
    chooseMurph:
      "Choose Murph if you need one assistant across symptoms, medications, workouts, labs, records, and wearable data, with reminders and practical health errands. Murph is not a dedicated addiction-recovery program.",
    competitor: {
      clinicalRole:
        "Sam is a consumer recovery companion, not therapy, diagnosis, emergency care, or a clinician replacement. Sunflower says clinicians review responses, but its terms direct active crisis, detox, and hospital needs to human care.",
      followThrough:
        "Sam logs check-ins, celebrates wins, helps process slips, set goals, and practice recovery skills. The Sunflower app adds sober-day tracking, milestone tracking, journaling, education, and an anonymous support community.",
      format:
        "A 24-hour AI recovery companion inside the Sunflower app and through a separate AI-powered SMS feature. The app adds visual progress, exercises, courses, and community.",
      hardware:
        "No proprietary hardware is required. The text experience needs a phone, while the full Sunflower experience uses a supported phone or tablet app. No wearable or sensor connection is documented.",
      inputs:
        "Text about cravings, slips, goals, emotions, and recovery, plus check-ins. The app records a quit date, sober days, milestones, and guided journal entries, but does not document lab, record, or wearable inputs.",
      insightStyle:
        "Recovery-specific support using CBT-style dialogue, motivational-interviewing tone, trauma-informed framing, relapse processing, and next-step skills. Clinical review does not make the service clinical care.",
      platforms:
        "Phone-based SMS support, plus the Sunflower app on iPhone, iPad, and Android phones and tablets.",
      pricing:
        "Sunflower is free to download with in-app purchases. A subscription is required for unlimited AI-sponsor messaging. The US App Store shows several purchase amounts without clearly mapping every price to a billing period.",
      primaryJob:
        "Help people reduce or stop substance use and sustain recovery through craving support, recovery-focused conversation, sober-day tracking, guided exercises, education, and peer community.",
    },
    competitorEvidence: {
      clinicalRole: [2, 3, 4, 6],
      followThrough: [1, 2, 3, 4],
      format: [1, 3, 4, 6],
      hardware: [3, 4, 6],
      inputs: [1, 2, 5, 6],
      insightStyle: [1, 2],
      platforms: [3, 4, 6],
      pricing: [3],
      primaryJob: [1, 2, 3, 4],
    },
    faqs: [
      {
        answer:
          "No. Sam is an AI recovery companion created by Sunflower. Sunflower says Sam is clinically reviewed and can redirect high-risk disclosures toward crisis resources, but it is not therapy, diagnosis, emergency care, or a human recovery relationship.",
        question: "Is Sam a human sponsor or therapist?",
      },
      {
        answer:
          "Yes. Sunflower's current terms describe a separate AI-powered SMS feature for exchanging text messages with Sam. The visual sober-day tracker, guided journals, courses, and anonymous community remain app features, so texting is not the whole product.",
        question: "Can I text Sam outside the Sunflower app?",
      },
      {
        answer:
          "The official pages reviewed do not document wearable, lab, or medical-record connections. Sam works mainly from recovery conversations and check-ins, while the app records recovery-specific progress and journal activity.",
        question: "Does Sam connect to wearables, labs, or records?",
      },
    ],
    headline:
      "Sam specializes in staying sober. Murph connects the rest of your health.",
    lastVerified: "2026-09-03",
    metaDescription:
      "Sam by Sunflower specializes in sobriety, cravings, CBT exercises, and sober-day tracking. Murph is a personal health assistant for records, labs, wearables, and follow-through.",
    name: "Sam by Sunflower",
    quickComparison: [
      { capability: "Recovery specific coaching", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Sober day milestone tracker", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "CBT recovery exercises", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Recovery peer community", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Separate SMS support", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab data", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "sam-by-sunflower",
    sources: [
      { label: "Sunflower features", url: "https://sunflowersober.com/features" },
      { label: "Sunflower recovery AI safety", url: "https://sunflowersober.com/magazine/earning-trust-in-recovery-ai" },
      { label: "Sunflower App Store listing", url: "https://apps.apple.com/us/app/sunflower-quit-any-addiction/id1547099435" },
      { label: "Sunflower Google Play listing", url: "https://play.google.com/store/apps/details?id=app.sunflowersober.com" },
      { label: "Sunflower privacy policy", url: "https://sunflowersober.com/privacy-policy" },
      { label: "Sunflower terms", url: "https://sunflowersober.com/terms-of-service" },
    ],
    tradeoffs: [
      "Sam's recovery specialization is a real advantage. Murph does not provide Sunflower's visual garden, built-in sobriety milestones, structured recovery courses, or dedicated anonymous community.",
      "Clinical review does not make Sam therapy or emergency care. Sunflower directs active crisis, detox, and hospital needs away from messaging and toward human help.",
      "Recovery conversations are sensitive. Sunflower says it may use third-party AI providers to process message content, and unlimited messaging requires a subscription with pricing that is not clearly tiered publicly.",
    ],
    useTogether:
      "Use Sam for recovery-specific craving support, sober-day tracking, exercises, and peer community. Use Murph to connect that work with medications, sleep, workouts, labs, records, appointments, and broader health follow-through.",
  },
  {
    aliases: ["Bo AI", "Bo Personal Assistant", "Bo Health and Life Assistant"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Bo if you want one proactive text assistant for both wellness and everyday logistics, including meal logging, macros, movement and sleep summaries, workout plans, reminders, calendar and inbox briefs, weather, and headlines.",
    chooseMurph:
      "Choose Murph if you want a health-specific relationship that keeps labs, records, symptoms, meals, and connected wearables together, helps run personal experiments, and handles practical health follow-through.",
    competitor: {
      clinicalRole:
        "Bo is a consumer health, fitness, and life assistant. It provides general information and coaching, not medical advice, diagnosis, treatment, or emergency care, and its AI replies may be inaccurate or incomplete.",
      followThrough:
        "Bo offers daily check-ins, reminders, movement and nutrition targets, progress tracking, scheduled sleep and activity summaries, and calendar scheduling. Its public pages do not describe provider calls or medical bookings.",
      format:
        "An AI assistant delivered primarily through SMS and iMessage. A companion app manages integrations, and Bo's terms say web dashboards may be available for analytics and reporting.",
      hardware:
        "No proprietary device is required for text coaching. A companion app connects optional sources such as Apple Health, Apple Watch, Oura, Strava, WHOOP, and Garmin.",
      inputs:
        "Conversations, goals, lifestyle profile, meal photos, voice notes, food and workout logs, preferences, allergies, and authorized heart, sleep, activity, recovery, weight, and body-composition data. Bo also supports calendar and inbox inputs.",
      insightStyle:
        "Conversational plans, recommendations, reminders, target tracking, and daily or weekly summaries personalized from stated goals, conversation history, preferences, and connected health data.",
      platforms:
        "Primarily SMS and iMessage, with a companion app for integrations and possible web dashboards for reporting. The policies limit the service to adults 18 and older.",
      pricing:
        "Bo is a recurring subscription. Its terms say the fee and billing cycle appear during signup, but the public product page did not publish a dollar price or clearly promise a free tier or trial when reviewed.",
      primaryJob:
        "Be one proactive personal assistant over text for health and daily life, tracking nutrition, activity, sleep, and goals while also organizing calendars, inbox updates, weather, headlines, and general questions.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 3],
      followThrough: [1, 3],
      format: [1, 3],
      hardware: [1, 2],
      inputs: [1, 2],
      insightStyle: [1, 2],
      platforms: [1, 2, 3],
      pricing: [3],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "Bo is broader, combining health coaching with calendar, inbox, weather, news, search, and utility work. Murph stays centered on health, adding labs, records, personal experiments, and practical health follow-through. Neither replaces a clinician.",
        question: "How is Bo different from Murph?",
      },
      {
        answer:
          "Yes. Bo names Apple Health, Apple Watch, Oura, and Strava on its product page, while its privacy policy also names WHOOP and Garmin as examples of health applications you can authorize.",
        question: "Does Bo connect to health and wearable apps?",
      },
      {
        answer:
          "No. Bo says it is a health assistant rather than a doctor, its coaching is general information rather than medical advice, and its responses may be inaccurate, incomplete, or inconsistent.",
        question: "Can Bo replace a doctor?",
      },
    ],
    headline:
      "Bo combines health and productivity over text. Murph goes deeper on your health.",
    lastVerified: "2026-09-03",
    metaDescription:
      "Bo combines health coaching, tracking, and productivity over text. Murph is a personal health assistant for deeper records, labs, experiments, and health follow-through.",
    name: "Bo",
    quickComparison: [
      { capability: "General life assistance", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Calendar and email help", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Photo and voice meal logs", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Wearable activity summaries", competitor: "yes", evidence: "insightStyle", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Records and lab data", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "bo",
    sources: [
      { label: "Bo product overview", url: "https://getbo.com/" },
      { label: "Bo privacy policy", url: "https://getbo.com/privacy-policy" },
      { label: "Bo terms", url: "https://getbo.com/terms-of-service" },
    ],
    tradeoffs: [
      "Bo has the broader general-assistant surface, with calendar and inbox briefs, weather, headlines, search, utility questions, detailed meal logging, and custom workout plans. Murph is deliberately more health-specific.",
      "Bo documents wellness connections and coaching, but its public materials do not document lab-result or medical-record ingestion, appointment recording, provider calls, or structured experiments.",
      "Bo is subscription-based without a public price, and its privacy policy says message content and imported health data are stored in its cloud. Murph does not offer Bo's broad productivity scope.",
    ],
    useTogether:
      "Use Bo for broad daily logistics, productivity, meal logging, and wellness reminders. Use Murph when a question needs labs, records, symptoms, experiments, or health-specific follow-through. No direct sync is documented.",
  },
  {
    aliases: ["MeAgain", "MeAgain Capy", "Capy AI Companion"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Capy if your main need is a GLP-1-specific companion with dose and injection-site tracking, food logging, side-effect records, nutrition targets, and everyday questions in the same app.",
    chooseMurph:
      "Choose Murph when the question extends beyond one medication journey. Murph can bring wearable data, labs, medical records, other conditions, reminders, and health errands into one conversation.",
    competitor: {
      clinicalRole:
        "Capy and MeAgain are consumer tracking and educational tools, not a medical provider. MeAgain says they do not give medical advice, diagnose, treat, or recommend dose changes.",
      followThrough:
        "Capy sits beside MeAgain's dose, food, symptom, hydration, weight, and progress tools, so an answer can become a log, target, reminder, or routine. Provider calls and medical bookings are not documented.",
      format:
        "An AI companion inside the MeAgain GLP-1 tracker, with separate beta access through iMessage. The mobile app supplies dashboards, timelines, trackers, progress views, and a Capy widget.",
      hardware:
        "No dedicated wearable or medical device is required. MeAgain runs on compatible iPhone and Android phones, while iMessage uses Apple Messages. Apple Health and Health Connect are optional inputs.",
      inputs:
        "Questions, shots or pills, dose timing, injection sites, symptoms and severity, weight, photos, and progress. Food can be logged by photo, barcode, voice, search, or quick-add, and health data can sync through phone health platforms.",
      insightStyle:
        "Plain-language education focused on GLP-1 routines, food, protein, side effects, dose-cycle questions, plateaus, and doctor-visit preparation, placed beside the user's logs and an estimated medication-level curve.",
      platforms:
        "Capy is available inside the MeAgain app on iPhone and Android. A separate iMessage experience is labeled Beta Early Access. No web dashboard, Telegram bot, or self-hosted version is documented.",
      pricing:
        "MeAgain is free to download with in-app purchases. Unlimited Capy chat is included with MeAgain Premium on a cancel-anytime monthly subscription, while exact current pricing appears through checkout or the app store.",
      primaryJob:
        "Give people using GLP-1 medication one focused place to ask everyday questions and keep doses, meals, symptoms, hydration, weight, and progress connected.",
    },
    competitorEvidence: {
      clinicalRole: [2, 7],
      followThrough: [2, 3, 4, 5],
      format: [1, 2],
      hardware: [1, 4, 5],
      inputs: [2, 3, 4, 5],
      insightStyle: [2, 3],
      platforms: [1, 4, 5],
      pricing: [2, 4, 5, 6],
      primaryJob: [2, 3, 4, 5],
    },
    faqs: [
      {
        answer:
          "Capy is MeAgain's GLP-1 AI companion. It lives inside the MeAgain tracker and is also available through a beta iMessage experience. Most structured trackers and progress views remain app features.",
        question: "Is Capy a separate app from MeAgain?",
      },
      {
        answer:
          "No. MeAgain says Capy is for education and everyday support, not medical advice, diagnosis, treatment, or dose-change recommendations. Keep medication decisions with the clinician who prescribed it.",
        question: "Can Capy tell me whether to change a GLP-1 dose?",
      },
      {
        answer:
          "Yes, but no direct connection is documented. Capy can remain the focused GLP-1 tracker and daily companion, while Murph handles broader wearable, lab, record, appointment, and health-context work.",
        question: "Can Capy and Murph be used together?",
      },
    ],
    headline:
      "Capy is built for one GLP-1 journey. Murph connects the rest of your health.",
    lastVerified: "2026-09-03",
    metaDescription:
      "Capy specializes in GLP-1 doses, food, symptoms, and progress. Murph is a personal health assistant that adds broader records, labs, experiments, and follow-through.",
    name: "Capy",
    quickComparison: [
      { capability: "GLP 1 focused companion", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Dose and injection tracking", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Medication level curve", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Photo and voice food logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Structured symptom tracking", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "limited", evidence: "format", murph: "yes" },
      { capability: "Records and lab data", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "capy",
    sources: [
      { label: "Capy on iMessage", url: "https://meagain.com/imessage" },
      { label: "Ask Capy GLP-1 questions", url: "https://meagain.com/glp-1-questions" },
      { label: "MeAgain product overview", url: "https://meagain.com/" },
      { label: "MeAgain App Store listing", url: "https://apps.apple.com/us/app/meagain-glp-1-tracker-app/id6744178534" },
      { label: "MeAgain Google Play listing", url: "https://play.google.com/store/apps/details?id=app.meagain.app" },
      { label: "MeAgain terms", url: "https://meagain.com/terms" },
      { label: "MeAgain privacy policy", url: "https://meagain.com/privacy" },
    ],
    tradeoffs: [
      "Capy's dedicated shot log, injection-site memory, medication curve, nutrition targets, and GLP-1-specific interface are stronger than Murph's general-purpose medication support for this routine.",
      "Capy is an educational consumer product and does not recommend dose changes. Its iMessage experience is labeled Beta Early Access, with most structured tracking in the MeAgain app.",
      "Unlimited Capy chat requires Premium and the public pages do not show one unambiguous current US price. Murph does not have Capy's dedicated medication curve or injection-site tracker.",
    ],
    useTogether:
      "Use Capy for doses, food, symptoms, nutrition targets, and quick daily GLP-1 questions. Use Murph when those observations need broader records, labs, wearable trends, another condition, or an appointment. No direct integration is documented.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Mochi if your main goal is a dedicated calorie and macro tracker inside iMessage, with barcode and restaurant lookup, streaks, badges, and scheduled coaching nudges.",
    chooseMurph:
      "Choose Murph if logging the meal is the start of the question. Murph estimates calories and macros, then reads them beside symptoms, sleep, training, labs, and records and carries a realistic plan forward.",
    competitor: {
      clinicalRole:
        "Mochi is a consumer wellness tracker and coaching-style service. It says it is not a medical service, its calorie and macro estimates are approximations, and it does not replace a dietitian or clinician.",
      followThrough:
        "Pro adds daily recaps and streak tracking. Max adds morning and midday check-ins, inactivity nudges, milestone badges, coach personalities, an accountability partner, and weekly summaries.",
      format:
        "An AI calorie and macro tracker that operates through a text conversation in iMessage without a separate app.",
      hardware:
        "No dedicated hardware or app is required. Mochi needs iMessage on an iPhone or Mac, and Android is not currently supported.",
      inputs:
        "Meal photos, text descriptions, voice notes, barcodes, restaurant lookups, saved meals, water, weight, dietary preferences, allergies, and authorized Apple Health data.",
      insightStyle:
        "Meal-level calorie and macro estimates, daily goal progress, evening recaps, streaks, weight trends, and weekly summary cards.",
      platforms:
        "iMessage on iPhone and Mac. The official FAQ says Android is not yet supported.",
      pricing:
        "A three-day full-access trial needs no card. Pro is $9 monthly or $90 yearly, and Max is $14 monthly or $140 yearly. The homepage also presents annual prices as monthly equivalents.",
      primaryJob:
        "Make calorie and macro logging fast through a meal photo, message, or voice note in iMessage, then reinforce the habit with goals, recaps, streaks, and badges.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1],
      format: [1, 2, 4],
      hardware: [1],
      inputs: [1, 3],
      insightStyle: [1, 4],
      platforms: [1],
      pricing: [1, 4],
      primaryJob: [1, 4],
    },
    faqs: [
      {
        answer:
          "No separate app is required. Mochi runs through iMessage, so it currently works on iPhone and Mac. Its official FAQ says Android support is not yet available.",
        question: "Do I need to download an app to use Mochi?",
      },
      {
        answer:
          "No. Mochi says labeled-food lookups use USDA and barcode information and claims restaurant and home-cooked estimates are typically within 10 to 15 percent. Its terms still describe every estimate as an approximation whose accuracy varies.",
        question: "Are Mochi calorie estimates exact?",
      },
      {
        answer:
          "For photo or text calorie and macro logging, often yes. Murph also puts meals beside sleep, training, symptoms, labs, and records. Mochi remains stronger for barcode lookup, restaurant lookup, streaks, and badges.",
        question: "Can Murph replace Mochi?",
      },
    ],
    headline:
      "Mochi tracks calories in iMessage. Murph connects the meal to the rest of your health.",
    lastVerified: "2026-09-03",
    metaDescription:
      "Mochi is an iMessage calorie tracker with photos, voice, streaks, and nudges. Murph is a personal health assistant connecting meals with sleep, training, labs, and records.",
    name: "Mochi",
    quickComparison: [
      { capability: "Photo calorie estimates", competitor: "yes", evidence: "primaryJob", murph: "yes" },
      { capability: "Barcode and restaurant lookup", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "Calorie and macro ledger", competitor: "yes", evidence: "insightStyle", murph: "yes" },
      { capability: "Streaks and milestone badges", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Apple Health nutrition sync", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "mochi",
    sources: [
      { label: "Mochi product and pricing", url: "https://mochitext.com/" },
      { label: "Mochi calorie tracker comparisons", url: "https://mochitext.com/alternatives" },
      { label: "Mochi privacy policy", url: "https://mochitext.com/privacy" },
      { label: "Mochi terms", url: "https://mochitext.com/terms" },
    ],
    tradeoffs: [
      "Mochi removes app-opening friction by living inside iMessage, but that limits it to Apple's messaging ecosystem. Murph also supports Telegram.",
      "Photo and description-based calorie counts remain estimates. Mochi's terms say accuracy varies, and Murph's photo estimates also need an ingredient and portion check.",
      "Barcode scanning, restaurant lookup, voice logging, Apple Health sync, weight trends, and proactive nudges require Max. Murph has no barcode scanner, streaks, or milestone badges.",
    ],
    useTogether:
      "Keep Mochi for fast calorie logging, its macro ledger, streaks, and nudges. Use Murph when a meal needs to be considered beside symptoms, sleep, training, labs, or records. No direct connection is documented.",
  },
  {
    aliases: ["AskPetal", "Petal", "Petal Wellness"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose AskPetal if you want an iMessage or SMS companion built specifically around menstrual cycles, hormonal transitions, symptoms, recovery, nutrition, and training through a female-physiology lens.",
    chooseMurph:
      "Choose Murph when the question reaches beyond hormonal health into records, labs, wearable data, appointments, reminders, and follow-through across the rest of your health.",
    competitor: {
      clinicalRole:
        "AskPetal is a consumer health-education and wellness service focused on female physiology and hormonal health. It does not provide medical advice, diagnosis, treatment, or clinical services.",
      followThrough:
        "AskPetal sends proactive personalized texts, supports ongoing check-ins, and turns cycle, symptom, recovery, and training signals into daily guidance. Calendar changes, class booking, and grocery ordering are marked beta or early access.",
      format:
        "A private, cycle-aware companion delivered through iMessage and SMS. AskPetal says the current service needs no app download, while a mobile app is planned.",
      hardware:
        "No AskPetal hardware is documented. Wearable data is optional and can come from authorized services such as Apple Health, Garmin, and Oura.",
      inputs:
        "Cycle, ovulation, fertility, pregnancy, symptoms, mood, medications, hormonal conditions, lifestyle habits, fitness goals, and optional sleep, HRV, temperature, and step data.",
      insightStyle:
        "AskPetal interprets daily signals through menstrual-cycle phase and broader female physiology. It says its guidance uses peer-reviewed literature, practitioner review, and explicit uncertainty labels.",
      platforms:
        "iMessage and SMS tied to a phone number. No app download is currently required, a mobile app is planned, and the website also hosts account and community surfaces.",
      pricing:
        "AskPetal documents a 30-day trial with proactive personalized texts. Questions remain available afterward, while proactive daily texts become premium. No public paid subscription amount is stated.",
      primaryJob:
        "Help women understand hormonal and menstrual-cycle patterns and adapt fitness, recovery, nutrition, and daily routines to those signals across hormonal stages.",
    },
    competitorEvidence: {
      clinicalRole: [2, 4],
      followThrough: [1, 3, 5],
      format: [1, 3],
      hardware: [2],
      inputs: [1, 2],
      insightStyle: [1, 4],
      platforms: [1, 3],
      pricing: [1, 3],
      primaryJob: [1, 4],
    },
    faqs: [
      {
        answer:
          "Yes. AskPetal says the current service works through iMessage and SMS and does not require an app download. Its site describes a future mobile app, which should not be presented as a current requirement.",
        question: "Does AskPetal work without downloading an app?",
      },
      {
        answer:
          "AskPetal documents a 30-day trial that includes proactive personalized texts. After that, people can still ask questions, while proactive daily texts belong to premium. The public pages do not publish the paid amount.",
        question: "How much does AskPetal cost?",
      },
      {
        answer:
          "No. AskPetal describes itself as a health-education platform, not a medical provider, and says its AI content may contain inaccuracies or become outdated. Medical concerns belong with qualified professionals.",
        question: "Does AskPetal provide medical advice or diagnosis?",
      },
    ],
    headline:
      "AskPetal specializes in hormone-aware guidance. Murph connects the rest of your health.",
    lastVerified: "2026-09-03",
    metaDescription:
      "AskPetal gives hormone-aware cycle guidance in iMessage and SMS. Murph is a personal health assistant for broader records, labs, data, plans, and follow-through.",
    name: "AskPetal",
    quickComparison: [
      { capability: "Hormone and cycle guidance", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Cycle and symptom tracking", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Proactive text check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Wearable data context", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Records and lab data", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free starter questions", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "askpetal",
    sources: [
      { label: "AskPetal product overview", url: "https://askpetal.com/" },
      { label: "AskPetal privacy policy", url: "https://askpetal.com/privacy" },
      { label: "AskPetal terms", url: "https://askpetal.com/terms" },
      { label: "AskPetal clinical review standards", url: "https://askpetal.com/clinical-review-standards" },
      { label: "AskPetal Lifestyle beta", url: "https://askpetal.com/lifestyle" },
    ],
    tradeoffs: [
      "AskPetal's specialization is the point: it puts cycle phase and female physiology at the center of fitness, recovery, nutrition, and symptom guidance. Murph is broader but not hormone-first.",
      "AskPetal marks calendar actions, class booking, and grocery ordering as beta or early access, so they should not be treated as universally available core service.",
      "AskPetal is educational, not medical care, and its own policy says AI output can be inaccurate or outdated. Murph is also not a clinician or diagnostic service.",
    ],
    useTogether:
      "Use AskPetal for hormone-specific daily guidance and cycle-aware coaching. Bring a relevant pattern to Murph beside other records, labs, and wearable context, then use Murph for the broader plan, reminder, or health task.",
  },
  {
    aliases: ["Miora", "Miora AI Health Agent"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose miora if your priority is daily protocol execution, especially peptide or GLP-1 support, with the option to pay for a clinician-guided tier.",
    chooseMurph:
      "Choose Murph if you want broader health-data synthesis, explicit baseline-controlled experiments, group challenges, more communication options, or open-source control.",
    competitor: {
      clinicalRole:
        "Essential is an AI-led wellness assistant. Concierge adds a longevity clinician, monthly consults, and human concierge access. Miora says its AI is not a medical device and does not diagnose, treat, prescribe, or sell medication.",
      followThrough:
        "Proactive iMessage check-ins, reminders, dose and symptom tracking, weekly scoring, recovery-aware recommendations, class booking or cancellation, and monthly protocol adjustments on Concierge.",
      format:
        "A conversational AI health assistant centered on iMessage, with an iPhone app as a dashboard and settings hub. Concierge adds a human clinical team around the messaging interface.",
      hardware:
        "No proprietary wearable is required. Existing wearables are optional inputs. The companion app is iPhone-focused and currently requires iOS 26 or later.",
      inputs:
        "Goals, health history, labs, supplements and peptide regimen, symptoms, meal photos, calendars, and data from Apple Health, Oura, WHOOP, Garmin, Strava, and Withings.",
      insightStyle:
        "Protocol-oriented and action-first. Miora turns readiness, sleep, HRV, strain, meals, and adherence into daily recommendations, schedule changes, and weekly scores, but does not document controlled experiments.",
      platforms:
        "Primarily iMessage and iPhone, plus an iOS dashboard and web account or settings experience. An official blog mentions WhatsApp, while the current homepage and App Store listing emphasize iMessage.",
      pricing:
        "Essential costs $14 monthly or $99 yearly after a seven-day trial. Concierge costs $129 monthly, is application based, and does not include the cost of peptides. Both are advertised as cancel-anytime.",
      primaryJob:
        "Run a daily health protocol spanning training, nutrition, supplements, habits, and peptides or GLP-1s, with an optional clinician-guided Concierge tier.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [1, 2, 3],
      format: [1, 2],
      hardware: [1, 2],
      inputs: [1, 2, 3],
      insightStyle: [1, 2, 3],
      platforms: [1, 2, 3],
      pricing: [1, 2],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "The miora AI is not a medical device and says it does not diagnose, provide treatment advice, prescribe, or sell medication. Its Concierge membership does include human longevity clinicians who design and adjust protocols.",
        question: "Is miora a doctor or medical service?",
      },
      {
        answer:
          "Miora's current experience is centered on iMessage and an iPhone dashboard that requires iOS 26 or later. A wearable is optional, while connected devices add sleep, recovery, HRV, activity, and related context.",
        question: "Do I need an iPhone or wearable to use miora?",
      },
      {
        answer:
          "Choose miora for protocol execution, peptide or GLP-1 specialization, and an optional clinician-guided tier. Choose Murph for explicit personal experiments, group support, more communication options, or open-source control.",
        question: "Should I choose miora or Murph?",
      },
    ],
    headline:
      "miora runs a daily protocol with optional clinicians. Murph keeps your wider health moving.",
    lastVerified: "2026-09-03",
    metaDescription:
      "miora runs health protocols in iMessage with an optional clinician tier. Murph is a personal health assistant for broader experiments, group support, records, and errands.",
    name: "miora",
    quickComparison: [
      { capability: "Human clinician membership", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Peptide protocol support", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Daily protocol coaching", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Meal photo logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Health class booking", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Optional group support", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "miora",
    sources: [
      { label: "miora product and pricing", url: "https://getmiora.com/" },
      { label: "miora App Store listing", url: "https://apps.apple.com/us/app/miora-ai-health-agent/id6745145922" },
      { label: "miora peptide tracker guide", url: "https://www.getmiora.com/blog/best-peptide-tracker-apps" },
    ],
    tradeoffs: [
      "miora has the clearer advantage for peptide or GLP-1 users who want a clinician to design and revisit their protocol. Murph is not a clinical-care membership.",
      "Murph has the clearer advantage for controlled personal experiments, group challenges, broader communication channels, and an open-source option.",
      "Both emphasize action. miora's distinctive actions are protocol reminders, meal and class logistics, and clinician escalation, while its clinician tier costs substantially more than its AI-only plan.",
    ],
    useTogether:
      "Use miora for daily protocol execution and its clinician tier if that is the service you want. Use Murph for broader records, explicit experiments, group support, and health errands. No direct connection is documented.",
  },
]);
