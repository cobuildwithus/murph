import { defineComparisons } from "../types";

export const MESSAGING_AGENT_COMPARISONS = defineComparisons([
  {
    aliases: ["Tomo AI", "Tomo: Your Personal AI"],
    category: "fitness",
    chooseCompetitor:
      "Choose Tomo if you want a personal AI in your texts that learns a goal such as getting in shape, checks in first, builds small custom trackers for workouts or meals, and can also manage your calendar and email.",
    chooseMurph:
      "Choose Murph if the goal sits inside a wider health picture and you want one assistant that reads connected wearables, labs, and records, logs meals and symptoms, runs personal experiments, and handles practical health errands.",
    competitor: {
      clinicalRole:
        "Tomo is a general accountability and productivity service. Its terms say it does not offer medical, psychiatric, psychological, or therapeutic advice, is not a substitute for diagnosis or treatment, and cannot provide emergency intervention.",
      followThrough:
        "Tomo learns your goals, holds you accountable, texts first with proactive check-ins, sends reminders, and organizes your schedule around what you said you wanted. The App Store listing describes it building custom tools such as workout trackers, habit streaks, meal logs, and budgets.",
      format:
        "A personal AI that lives in your texts. You message Tomo in iMessage or open the iOS app for a fuller view, and it can also join group chats.",
      hardware:
        "No proprietary device is documented. You need a phone that can text, and the app requires iOS 18 or later. Apple Health data is optional and only read with your permission.",
      inputs:
        "Goals, messages, photos, and the calendar and email accounts you connect. With consent the app reads Apple HealthKit data such as workouts, steps, energy, sleep, heart rate, and body measurements, and it stores messages and memories so context carries across conversations. Labs, medical records, and named third-party wearables are not documented.",
      insightStyle:
        "Conversational coaching and organization rather than scores or dashboards. Tomo remembers context across conversations, searches the web, and adapts the tools it builds to the goal you set.",
      platforms:
        "iMessage plus an App Store app for iPhone, iPad, and Apple Vision, with a web dashboard for account, billing, and data controls. The terms mention integrations such as Google, Notion, and Airtable. No Android app or Telegram channel is documented.",
      pricing:
        "The about page says the base plan starts at $19.99 per month with higher tiers for more messaging, and that pricing can vary by user and promotion. The App Store listed Tomo Pro at $19.99 and $119.99 in-app purchases when reviewed. Purchases are described as non-refundable.",
      primaryJob:
        "Turn a personal goal into steady follow-through by texting first, remembering everything, and building the small tools that goal needs, for an audience the homepage describes as people working out.",
    },
    competitorEvidence: {
      clinicalRole: [2, 3],
      followThrough: [2, 5],
      format: [2, 5],
      hardware: [4, 5],
      inputs: [2, 4, 5],
      insightStyle: [2, 5],
      platforms: [2, 3, 5],
      pricing: [2, 3, 5],
      primaryJob: [1, 2, 5],
    },
    faqs: [
      {
        answer:
          "Not only. Tomo's homepage says it is trusted by more than 500,000 people working out, and its App Store listing names getting in shape as a typical goal, but the product is a general personal AI for goals, schedules, calendar, and email. Fitness is one of the goals it supports rather than its whole scope.",
        question: "Is Tomo a fitness coach?",
      },
      {
        answer:
          "Its privacy policy says the app can read Apple HealthKit data such as workouts, steps, sleep, heart rate, and body measurements with your explicit permission. The public pages do not document direct connections to WHOOP, Oura, Garmin, or other wearable accounts, and they do not mention labs or medical records.",
        question: "Does Tomo read Apple Health or wearable data?",
      },
      {
        answer:
          "Tomo's about page puts the base plan at $19.99 per month and says prices vary by promotion, with no documented free tier. Murph starts free without a card and adds paid plans for more usage. Neither product replaces medical care.",
        question: "How do Tomo and Murph differ on price?",
      },
    ],
    headline:
      "Tomo is a personal AI that texts first and keeps goals moving. Murph brings health data and follow-through into one conversation.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Tomo is a $19.99 monthly personal AI in your texts that tracks goals like getting in shape. Murph is a personal health assistant for wearables, labs, records, meals, and errands.",
    name: "Tomo",
    quickComparison: [
      { capability: "Builds custom goal trackers", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Calendar and email help", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Group chat participation", competitor: "yes", evidence: "format", murph: "limited" },
      { capability: "Texts you first", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "limited", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "tomo",
    sources: [
      { label: "Tomo homepage", url: "https://www.tomo.ai/" },
      { label: "Tomo about page and FAQ", url: "https://www.tomo.ai/about" },
      { label: "Tomo terms of service", url: "https://www.tomo.ai/terms" },
      { label: "Tomo privacy policy", url: "https://www.tomo.ai/privacy" },
      { label: "Tomo App Store listing", url: "https://apps.apple.com/us/app/tomo-your-personal-ai/id6757726935" },
    ],
    tradeoffs: [
      "Tomo's real strengths are texting first, remembering everything, building custom trackers, and joining group chats. Murph does not build custom mini apps or join group chats, and it does not manage your calendar and inbox as a general assistant.",
      "Tomo's health inputs stop at Apple Health and what you type. The public pages do not document labs, records, or direct wearable account connections, and its terms frame the service as productivity support rather than health guidance.",
      "Tomo's base price is $19.99 per month with no documented free tier, and the about page says pricing can differ between users. Confirm the current price before you commit.",
    ],
    useTogether:
      "Keep Tomo for general goal accountability, calendar, and email, and bring wearable patterns, labs, records, meals, and health errands to Murph. No connection between the two products is documented.",
  },
  {
    aliases: ["Sidekicks AI", "Dash by Sidekicks"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Sidekicks if you want to text one number in iMessage or SMS and switch between personas, with Dash for calorie tracking and sleep reminders and Haven for mood check-ins and breathing, starting on a free tier.",
    chooseMurph:
      "Choose Murph if you want one ongoing health conversation that reads connected wearables and labs, keeps records, runs personal experiments, and handles practical health errands instead of switching personas.",
    competitor: {
      clinicalRole:
        "Sidekicks is an informational text service. Its terms say it does not provide medical, legal, or professional advice, is not a substitute for licensed mental health services or therapy, and does not offer emergency or crisis response.",
      followThrough:
        "Reminders, to-do lists, and proactive check-ins are core features, with proactive check-ins on Pro. Dash follows up when you stop logging, and Haven offers daily mood check-ins, breathing exercises, and journaling prompts.",
      format:
        "An AI assistant you text at one phone number in iMessage or SMS, with no app, account, or login. You pick a persona by asking for it, and you can add the number to a group chat.",
      hardware:
        "Any phone that can send texts. No device, wearable, or app download is required or documented.",
      inputs:
        "Messages, photos, and voice messages. Dash tracks meals and calories from what you describe or photograph and scans food labels for nutrition and ultra-processed ingredients. Free plans limit image analysis and memory. No wearable, lab, or record connections are documented.",
      insightStyle:
        "Persona-based conversation. Otto handles productivity, Dash gives nutrition, sleep, and movement coaching with ultra-processed food alerts, and Haven offers stress support and mood pattern tracking. Companion personas for adults are also offered.",
      platforms:
        "iMessage and SMS on iPhone and Android through a US number, with US or Canadian phone numbers required by the terms. Group chats work in iMessage or SMS. No app, web dashboard, Telegram, or WhatsApp channel is documented.",
      pricing:
        "A free tier includes limited messages, image analysis, voice messages, memory, and reminders. Pro was $19.99 per month when reviewed, with unlimited messages, image generation and analysis, web search, voice, proactive check-ins, improved memory, and all personas. You upgrade by texting.",
      primaryJob:
        "Give people an assistant, health coach, wellness coach, or friend they can reach by texting one number, with no app to install.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1, 2],
      format: [1, 4],
      hardware: [1],
      inputs: [1, 2, 3],
      insightStyle: [1],
      platforms: [1, 4],
      pricing: [1, 2],
      primaryJob: [1, 4],
    },
    faqs: [
      {
        answer:
          "Yes, within plan limits. The feature list documents calorie tracking through conversation and a food label scanner that reads nutrition from a photo, and the free tier caps image analysis. Pro includes image analysis and unlimited messages.",
        question: "Can Sidekicks track meals from photos?",
      },
      {
        answer:
          "Yes. The FAQ says the same number works over SMS for Android and anyone without iMessage, and group chats work in either. The terms require a US or Canadian phone number.",
        question: "Does Sidekicks work on Android?",
      },
      {
        answer:
          "Sidekicks splits help across personas, with Dash covering food, sleep, and movement from what you text or photograph. Murph keeps one conversation and can add connected wearables, labs, records, symptom logs, personal experiments, and health errands. Neither replaces a clinician.",
        question: "How does Sidekicks compare with Murph for health?",
      },
    ],
    headline:
      "Sidekicks gives you named personas at one text number. Murph gives you one health conversation with connected data.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Sidekicks is a free-to-start iMessage and SMS assistant with Dash for calories and Haven for mood. Murph is a personal health assistant for wearables, labs, records, and errands.",
    name: "Sidekicks",
    quickComparison: [
      { capability: "Multiple named personas", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Group chat participation", competitor: "yes", evidence: "format", murph: "limited" },
      { capability: "Ultra processed food alerts", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "sidekicks",
    sources: [
      { label: "Sidekicks product overview and FAQ", url: "https://sidekicks.chat/" },
      { label: "Sidekicks pricing", url: "https://sidekicks.chat/#pricing" },
      { label: "Sidekicks privacy policy", url: "https://sidekicks.chat/privacy" },
      { label: "Sidekicks terms of service", url: "https://sidekicks.chat/terms" },
    ],
    tradeoffs: [
      "Sidekicks' persona model, group chat support, and ultra-processed food alerts are real strengths, and it starts free with no signup. Murph does not offer switchable personas or join group chats.",
      "The free tier limits messages, image analysis, memory, and reminders per persona, so daily meal logging realistically means the $19.99 Pro plan. The terms also allow submitted content to be used to train and refine its AI systems.",
      "Sidekicks' health coaching works from what you text or photograph. It documents no wearable, lab, or record connections, and its terms say it is not a substitute for licensed mental health services.",
    ],
    useTogether:
      "Use Dash or Haven for quick texting-based coaching and use Murph when meals, sleep, and mood need to sit beside wearable data, labs, records, and follow-through. No connection between the products is documented.",
  },
  {
    aliases: ["KickerAI", "Kicker AI Health Bestie"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Kicker if you want a playful app that plans meals inside a calorie budget, logs food from photos, syncs Apple Health, WHOOP, and Oura, and rewards streaks with a character you dress up.",
    chooseMurph:
      "Choose Murph if you want a plainer assistant in iMessage or Telegram that reads wearables and labs, keeps records, logs meals and symptoms, tests changes against your own baseline, and handles health errands.",
    competitor: {
      clinicalRole:
        "Kicker is a wellness companion. Its App Store listing says it does not provide medical advice, diagnosis, or treatment, and its terms say you are responsible for reviewing AI output before acting on medical or safety decisions.",
      followThrough:
        "Daily check-ins, a daily health plan for meals, workouts, and sleep, proactive reminders about what is coming up, calendar time blocks for the gym, meeting shifts after a late night, streaks, weigh-ins, and a daily recap with one insight for tomorrow.",
      format:
        "A gamified iPhone and Android app with an Apple Watch app, a home screen calorie budget, chat with a coach that turns suggestions into tasks, and a character that earns seeds and outfits as you complete plans.",
      hardware:
        "No proprietary device. A phone running the app is required, and an Apple Watch is optional. Wearable syncing with Apple Health, WHOOP, and Oura adds signals.",
      inputs:
        "Meal photos, quick water and drink logs, weight, tasks, chat, voice notes, and connected Gmail, Google Calendar, Notion, Reminders, Google Drive, and X. The app reads Apple Health or Health Connect data such as steps, workouts, and active energy with your permission, and the pricing page lists WHOOP and Oura sync. Labs and records are not documented.",
      insightStyle:
        "A friendly, low-judgment coach voice. Kicker picks the three things that matter most today, plans breakfast, lunch, and dinner around a calorie budget, and summarizes the day in a recap with a trend curve for weight.",
      platforms:
        "App Store app for iPhone, iPad, Apple Silicon Mac, Apple Vision, and Apple Watch, plus Google Play per the terms. Sign-in uses Apple or Google. No iMessage, Telegram, or web dashboard is documented.",
      pricing:
        "The pricing page shows weekly at $3.99, monthly at $14.99, and yearly at $9.99 per month billed as $119.88, each with a 7-day free trial and no card required. The App Store listed Kicker Pro at $14.99 monthly and $119.99 yearly, and the app terms describe a 14-day trial that needs a payment method, so trial terms differ between pages.",
      primaryJob:
        "Help people build healthier habits and reach a weight goal through daily plans, photo calorie logging, wearable context, and a game-like companion that stays warm and proactive.",
    },
    competitorEvidence: {
      clinicalRole: [4, 5],
      followThrough: [1, 2, 5],
      format: [1, 5],
      hardware: [2, 5],
      inputs: [1, 2, 3, 5],
      insightStyle: [1, 5],
      platforms: [4, 5],
      pricing: [2, 4, 5],
      primaryJob: [1, 5],
    },
    faqs: [
      {
        answer:
          "The pages reviewed do not document an iMessage or SMS channel. Kicker is an app for iPhone, iPad, Mac, Apple Vision, and Apple Watch, with Android through Google Play, and its calendar and reminder features run through connected accounts inside the app.",
        question: "Does Kicker work over iMessage?",
      },
      {
        answer:
          "The pricing page lists Apple Health, WHOOP, and Oura. The app privacy policy adds Health Connect on Android and says the app only reads the data types you approve and never writes to them. Labs and medical records are not documented.",
        question: "Which wearables does Kicker sync?",
      },
      {
        answer:
          "The pricing page says every plan starts with a 7-day free trial and no credit card. The app terms describe a 14-day trial that requires a payment method through the App Store or Google Play. Check the offer shown at checkout, since the two pages disagree.",
        question: "Is Kicker's free trial really without a card?",
      },
    ],
    headline:
      "Kicker gamifies meals, workouts, and sleep with a companion you dress up. Murph keeps the health picture in one plain conversation.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Kicker is a $14.99 monthly gamified health app with photo calorie logging and WHOOP, Oura, and Apple Health sync. Murph is a personal health assistant for labs, records, and errands.",
    name: "Kicker",
    quickComparison: [
      { capability: "Calorie budget meal plans", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Calendar time blocking", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Gamified streaks and rewards", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Apple Watch app", competitor: "yes", evidence: "platforms", murph: "no" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "kicker",
    sources: [
      { label: "Kicker homepage", url: "https://www.usekicker.com/" },
      { label: "Kicker pricing", url: "https://www.usekicker.com/pricing" },
      { label: "Kicker app privacy policy", url: "https://www.usekicker.com/kicker/privacy" },
      { label: "Kicker app terms of service", url: "https://www.usekicker.com/kicker/terms" },
      { label: "KickerAI App Store listing", url: "https://apps.apple.com/us/app/kickerai-your-health-bestie/id6760602821" },
    ],
    tradeoffs: [
      "Kicker's game loop, calorie budget plans, calendar time blocking, and Apple Watch app are real strengths for people who want structure and fun. Murph offers none of those, and it does not block time on your calendar.",
      "Kicker's own pages disagree about the trial, its general website terms and privacy pages describe different companies and products than the app pages, and the homepage describes a productivity assistant while the App Store describes a calorie tracker. Read the app pages, which are the current ones.",
      "Kicker documents wearable sync but no labs, records, or health errands, and it lives inside an app rather than a messaging thread.",
    ],
  },
  {
    aliases: ["Overlord AI", "Overlord by Forfeit"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Overlord if you want enforcement, not encouragement: real money stakes, wake-up calls, bedtime device locks, GPS and photo proof, heart rate checks for workouts, and strip or breathalyzer tests for sobriety goals.",
    chooseMurph:
      "Choose Murph if you want a health assistant that reads wearables, labs, and records, logs meals and symptoms, runs personal experiments, handles health errands, and checks in without charging you when life gets in the way.",
    competitor: {
      clinicalRole:
        "Overlord is an accountability product from Forfeit Inc, not a clinical or medical service. Its pages describe habit enforcement and self-control tools, and the sobriety use cases rely on consumer test strips and breathalyzers you buy yourself. No clinician involvement is documented.",
      followThrough:
        "Escalating interventions when you slip: texts, real voice calls, messages to a trusted contact, app and website blocks, phone lockouts, and Stripe stakes that are captured the moment a rule breaks. Goals are assessed nightly, and you can appeal a failure for review.",
      format:
        "An AI partner you chat with in iMessage, Telegram, WhatsApp, or the app, with goals created and refined in conversation. Personality ranges from gentle to strict, and it remembers your patterns and weak hours.",
      hardware:
        "No proprietary device. Overlord runs on iOS, Android, and Mac, with a Mac agent for screen and site blocking. Verification can use your phone camera, GPS, Apple Watch heart rate, IFTTT smart buttons, and store-bought cotinine, THC, or breathalyzer tests.",
      inputs:
        "Photos, videos, and screenshots as evidence, GPS location, Screen Time and Mac activity, Apple Health and Health Connect data such as heart rate, steps, workouts, sleep, and Mindful Minutes, Sleep Cycle, calendar, and Plaid bank transactions for purchase scans, plus a long-term memory of your patterns and excuses. The Forfeit app also accepts Apple Health, Strava, WHOOP, and MyFitnessPal evidence.",
      insightStyle:
        "Rule enforcement with weekly recaps and long-term memory of excuses and slip patterns. It answers questions such as average protein intake from what you logged, but its center is verification and consequences rather than health analysis.",
      platforms:
        "iOS, Android, and a Mac app, with chat in iMessage, Telegram, and WhatsApp. Overlord ships inside the Forfeit app, and its download links open the Forfeit listings on the App Store and Google Play.",
      pricing:
        "The App Store lists a one-month Overlord subscription at $12.99 inside the Forfeit app, alongside Forfeit Pro and Premium tiers. Stakes are separate money you put on the line, with typical examples from $5 to $200 per miss, and the terms cap repeat charges at three failures in a row. No free tier or trial is documented.",
      primaryJob:
        "Force follow-through on habits you keep breaking by watching your phone, location, spending, and health data and applying consequences you agreed to in advance.",
    },
    competitorEvidence: {
      clinicalRole: [1, 3],
      followThrough: [1, 3],
      format: [1],
      hardware: [1, 2],
      inputs: [1, 2, 4],
      insightStyle: [1],
      platforms: [1, 4],
      pricing: [1, 3, 4],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "Yes, when you set a stake. Stripe pre-authorizes the amount when you commit, the hold is captured when a rule breaks, and the terms allow a charge for each failure up to three in a row for the same commitment. You can appeal, and Forfeit decides the appeal.",
        question: "Does Overlord actually charge me money?",
      },
      {
        answer:
          "Workouts can require a GPS stay inside your gym geofence, an Apple Health heart rate floor, or photo and video evidence. Sobriety goals use cotinine or THC strip photos, breathalyzer videos, geofences around bars or dispensaries, and Plaid scans for tobacco, alcohol, or gambling charges. Overlord does not diagnose or treat substance use.",
        question: "How does Overlord verify workouts and sobriety?",
      },
      {
        answer:
          "Yes. Neither connects to the other, but Overlord can enforce the two or three rules you keep breaking while Murph holds the wider health context, reads labs and wearables, tests whether a change helps, and handles errands. Keep reminders in one place to avoid duplicate nudges.",
        question: "Can Overlord and Murph work together?",
      },
    ],
    headline:
      "Overlord enforces your rules with stakes, calls, and locks. Murph keeps the rest of your health moving without penalties.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Overlord is a $12.99 monthly accountability partner with money stakes, wake-up calls, GPS proof, and sobriety tests. Murph is a personal health assistant for labs, wearables, and errands.",
    name: "Overlord",
    quickComparison: [
      { capability: "Real money stakes", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Voice calls and app blocking", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "GPS and photo verification", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Sobriety strip test checks", competitor: "yes", evidence: "hardware", murph: "no" },
      { capability: "Works in iMessage or Telegram", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "overlord",
    sources: [
      { label: "Overlord product page, use cases, and FAQ", url: "https://overlord.app/" },
      { label: "Overlord privacy policy", url: "https://overlord.app/privacy" },
      { label: "Overlord terms of service", url: "https://overlord.app/terms.html" },
      { label: "Forfeit App Store listing", url: "https://apps.apple.com/us/app/forfeit-habit-contracts/id1633125787" },
    ],
    tradeoffs: [
      "Overlord's enforcement stack is unmatched here: stakes, calls, friend escalation, device locks, GPS, and test strips. Murph applies no financial pressure and cannot lock your phone or block apps.",
      "Overlord's health data use is verification, not understanding. It reads heart rate and steps to approve a goal, but it documents no labs, records, or symptom tracking, and its sobriety checks depend on tests you buy and photograph correctly.",
      "Cost is open-ended. The subscription is $12.99 per month and stakes add whatever you risk, and the terms allow three consecutive charges on a repeatedly failed commitment. Read the appeal rules before staking large amounts.",
    ],
    useTogether:
      "Use Overlord for the few habits that need hard consequences, such as bedtime, wake-up, or a sobriety rule, and use Murph for the surrounding health work: wearables, labs, records, meals, experiments, and errands. No connection between the products is documented.",
  },
  {
    aliases: ["Lucas AI", "MeetLucas"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Lucas if you want a general assistant in iMessage or WhatsApp that texts first, manages email and calendar, books and cancels things on the web, and can fold WHOOP recovery or Strava activity into your day.",
    chooseMurph:
      "Choose Murph if health is the job: one assistant that reads many wearables plus labs and records, logs meals and symptoms, runs personal experiments, and handles health errands rather than general life admin.",
    competitor: {
      clinicalRole:
        "Lucas is a consumer assistant. Its terms say output is not professional advice of any kind, including medical advice, and should be independently verified before important decisions.",
      followThrough:
        "Lucas texts first with briefings, nudges, and follow-ups, sets reminders, runs plain-language automations, and completes web errands such as bookings, cancellations, and check-ins through its browser. Its changelog describes canceling a gym membership and booking a dentist appointment.",
      format:
        "A conversational assistant that lives in your existing message thread. Voice notes are accepted, and a browser live view lets you tap through a captcha when a site needs a person.",
      hardware:
        "No proprietary device or app is required. A phone with iMessage or WhatsApp is enough, and connected services add data.",
      inputs:
        "Messages, voice notes, shared location pins, and connected accounts including Gmail, Google Calendar, Outlook, Notion, GitHub, Mercury, Strava, and WHOOP. WHOOP recovery, sleep, and strain and Strava activity are read-only. Its privacy policy treats connected health data as sensitive information you consent to when you connect it. Labs and records are not documented.",
      insightStyle:
        "Practical, proactive, and casual. Lucas answers questions from connected data, such as how a training week compared with the last, and can adjust a plan when WHOOP shows low recovery, but it does not present structured health analysis or experiments.",
      platforms:
        "iMessage and WhatsApp are the documented channels, and the privacy policy also names SMS. A web app handles login, integrations, and billing. Telegram is not documented.",
      pricing:
        "No prices are published on the pages reviewed. The changelog refers to Pro accounts with more monthly headroom, and the terms describe auto-renewing subscriptions, possible free trials that convert to paid, and a payment card requirement for paid features.",
      primaryJob:
        "Handle the small admin of daily life from the thread you already answer: email, calendar, bookings, habits, and proactive nudges.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1, 2],
      format: [1, 2],
      hardware: [1, 3],
      inputs: [2, 3],
      insightStyle: [1, 2],
      platforms: [1, 2, 3],
      pricing: [2, 4],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Yes. The changelog describes WHOOP as a first-class integration that reads recovery, sleep, and strain and can change the day's plan when recovery is low. Strava is also connected read-only. Other wearables, labs, and records are not documented.",
        question: "Does Lucas connect to WHOOP?",
      },
      {
        answer:
          "The public pages do not show prices. The changelog mentions Pro accounts with more monthly headroom, and the terms describe auto-renewing subscriptions and trials that convert to paid unless canceled. Ask Lucas or check the account page for current pricing.",
        question: "How much does Lucas cost?",
      },
      {
        answer:
          "Not primarily. Lucas is a general assistant for email, calendar, bookings, and habits, and health shows up through automations such as water reminders, calorie estimates from meal photos, and WHOOP-aware planning. Murph is built around health context and follow-through.",
        question: "Is Lucas a health assistant?",
      },
    ],
    headline:
      "Lucas runs your daily admin from your texts. Murph runs your health from the same kind of thread.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Lucas is an iMessage and WhatsApp assistant that handles email, calendar, bookings, and WHOOP-aware habits. Murph is a personal health assistant for labs, records, experiments, and errands.",
    name: "Lucas",
    quickComparison: [
      { capability: "Email and calendar management", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "General life admin tasks", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Voice note requests", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Plain text automations", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Texts you first", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Handles health errands", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "limited", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "limited", evidence: "pricing", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "lucas",
    sources: [
      { label: "Lucas homepage", url: "https://meetlucas.ai/" },
      { label: "Lucas changelog", url: "https://meetlucas.ai/updates" },
      { label: "Lucas privacy policy", url: "https://meetlucas.ai/privacy-policy" },
      { label: "Lucas terms of service", url: "https://meetlucas.ai/terms-of-service" },
    ],
    tradeoffs: [
      "Lucas covers email, calendar, travel, and web bookings in a way Murph does not attempt. Murph does not check you into flights, cancel your broadband, or manage your inbox.",
      "Lucas's health reach is WHOOP, Strava, and what you text. It documents no labs, records, symptom logs, or personal experiments, and its terms class any health data as sensitive information you handle at your own choice.",
      "Pricing is not published, cancellation requires 30 days' notice before the next term, and fees are non-refundable under the terms. Confirm the plan before connecting accounts.",
    ],
    useTogether:
      "Let Lucas own email, calendar, and general bookings, and let Murph own health data, experiments, and health errands. No connection between the products is documented, so decide which assistant sends reminders.",
  },
  {
    aliases: ["Poke AI", "Poke by Interaction"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Poke if you want a proactive general assistant in Apple Messages, WhatsApp, or Telegram that connects email, calendar, Notion, Oura, and Fitbit, with a free tier and a human operator on Ultra.",
    chooseMurph:
      "Choose Murph if the point is health: one assistant that reads many wearables plus labs and records, logs meals and symptoms, tests what helps you, and handles health errands on every plan.",
    competitor: {
      clinicalRole:
        "Poke is a general assistant from The Interaction Company. Its terms say the service is not designed to store or handle protected health information or other sensitive data, and its privacy notice includes a consumer health data supplement. No clinical role is claimed.",
      followThrough:
        "Poke creates reminders, gets a head start on tasks from a text or voice message, runs real-time automations in the background on paid plans, and proactively surfaces what matters from connected services and memory. Poke Human on Ultra dispatches reservations, calls, and orders to a real person.",
      format:
        "A texting-first assistant with a friend-like personality that lives in your messages, plus a web app for settings, recipes, and billing.",
      hardware:
        "No proprietary device. Any phone with a supported messaging app works, and wearable data arrives through connected accounts such as Oura and Fitbit.",
      inputs:
        "Messages, voice messages, memory, and connected apps including Gmail, Outlook, calendar, Notion, GitHub, Linear, Oura sleep stages and readiness, and Fitbit, with custom MCP integrations for developers. Labs, records, and meal photo analysis are not documented as first-party features.",
      insightStyle:
        "Proactive updates and conversational answers drawn from integrated services and memory rather than scores or dashboards. Recipes package integrations and automations you can share.",
      platforms:
        "Apple Messages, WhatsApp, Telegram, and more, with a settings page for choosing the channel and a web app for account and recipes. A homepage banner says Poke is joining Cognition.",
      pricing:
        "Free forever with no card, connected apps, email, and calendar. Pro is $19 per month for frontier models, background automations, and higher limits. Ultra is $199 per month with Poke Human and pay-as-you-go usage beyond credits. Expenses an operator pays are charged at cost.",
      primaryJob:
        "Be the one contact that keeps your life in the loop by texting proactively, connecting your apps, and handling tasks on your schedule.",
    },
    competitorEvidence: {
      clinicalRole: [4, 5],
      followThrough: [1, 3],
      format: [1, 3],
      hardware: [1],
      inputs: [1, 3, 4],
      insightStyle: [1],
      platforms: [1, 3],
      pricing: [2, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Its homepage shows Oura sleep stages, readiness, and activity as an integration and lists Fitbit among connected apps. Labs, medical records, and other wearables are not documented, and the terms say Poke is not built for protected health information.",
        question: "Does Poke connect to health wearables?",
      },
      {
        answer:
          "A real person who handles real-world tasks such as reservations, phone calls, and orders when you ask. It is included with the $199 Ultra plan, operators see only the task details, and expenses they pay are charged at cost.",
        question: "What is Poke Human?",
      },
      {
        answer:
          "The Free plan is free forever with no card and connects your apps, email, and calendar. Pro is $19 per month and Ultra is $199 per month. Murph also starts free without a card.",
        question: "Is Poke free?",
      },
    ],
    headline:
      "Poke is a proactive general assistant with recipes and a human on Ultra. Murph is the health-specific version of that thread.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Poke is a free-to-start texting assistant on Messages, WhatsApp, and Telegram with Oura, Fitbit, and email recipes. Murph is a personal health assistant for labs, records, and errands.",
    name: "Poke",
    quickComparison: [
      { capability: "Custom recipes and MCP tools", competitor: "yes", evidence: "platforms", murph: "no" },
      { capability: "Human operator for tasks", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Email and calendar management", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Works in iMessage or Telegram", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "poke",
    sources: [
      { label: "Poke homepage", url: "https://poke.com/" },
      { label: "Poke pricing", url: "https://poke.com/pricing" },
      { label: "Poke FAQ", url: "https://poke.com/faq" },
      { label: "Interaction privacy notice", url: "https://poke.com/privacy" },
      { label: "Poke terms of service", url: "https://poke.com/terms" },
    ],
    tradeoffs: [
      "Poke's recipe system, MCP extensibility, email and calendar depth, and Poke Human are strengths Murph does not match. Murph has no human operator tier and no developer recipe directory.",
      "Poke treats health as one category among many. It documents Oura and Fitbit but no labs, records, symptom logging, or personal experiments, and its terms say it is not designed for protected health information.",
      "The full experience costs $19 or $199 per month, the homepage announces the company is joining Cognition, and the terms require 30 days' notice to cancel before the next term. Check how the acquisition affects the product before relying on it.",
    ],
    useTogether:
      "Keep Poke for email, calendar, apps, and general proactive nudges, and bring wearables, labs, records, meals, and health errands to Murph. No connection between the products is documented, so choose one owner for reminders.",
  },
  {
    aliases: ["Orchid AI", "Orchid personal assistant"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Orchid if you want a calm assistant over iMessage or SMS that triages your inbox, keeps your calendar in order, and runs habits such as a photo calorie tracker or a 9 pm medication reminder.",
    chooseMurph:
      "Choose Murph if health is the center: connected wearables and labs, records, meal and symptom logs, personal experiments, group support, and health errands in one iMessage or Telegram conversation.",
    competitor: {
      clinicalRole:
        "Orchid is a productivity assistant for founders, investors, lawyers, and other busy people. The public pages make no clinical claims, and the FAQ frames health tasks as admin, such as booking the doctor visit you keep putting off.",
      followThrough:
        "Nudges before things slip, recurring habits that run on schedule, inbox triage with drafts, calendar holds with your approval, bookings, bills, forms, and follow-ups. Replies stay as drafts until you send them.",
      format:
        "A personal assistant you message. The homepage shows an iMessage thread and a start button that opens a text to its number, with a web app behind Google sign-in.",
      hardware:
        "No device or app install is required. A phone that can text and a Google account for sign-in are the documented needs.",
      inputs:
        "Messages and photos, Gmail and Google Calendar today, with Outlook, Slack, Notion, and Linear listed as coming. The footer also names Google Drive, Granola, and Sentry. Memory holds details you tell it. No wearable, lab, or record connections are documented.",
      insightStyle:
        "Quiet, proactive admin with a second-brain memory: it recalls the restaurant, the allergy, or where you parked, and catches deadlines and birthdays before you remember to worry. It does not present health analysis.",
      platforms:
        "iMessage and SMS through a US number, delivered by a messaging provider named in the privacy policy, plus a web app. Enterprise and a separate Keiki product are offered. No Telegram, WhatsApp, or Android app is documented.",
      pricing:
        "The pricing page is rendered in the browser and shows no plan details in the pages reviewed. The terms say certain features require a paid subscription billed monthly or annually, fees are non-refundable, and you can cancel from account settings.",
      primaryJob:
        "Give busy professionals the kind of assistant that used to be reserved for a few: inbox, calendar, travel, admin, and the small recurring things, all through messages.",
    },
    competitorEvidence: {
      clinicalRole: [2, 4],
      followThrough: [1, 2],
      format: [1, 3],
      hardware: [1, 3],
      inputs: [1, 2, 3],
      insightStyle: [1],
      platforms: [1, 3],
      pricing: [4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "As habits, yes. The homepage shows a calorie tracker you send pictures to and a 9 pm medication reminder set up by asking. Orchid documents no wearable, lab, or record connections, and it does not position itself as a health product.",
        question: "Can Orchid track calories or medications?",
      },
      {
        answer:
          "Prices are not published on the pages reviewed because the pricing page renders in the browser. The terms describe paid subscriptions billed monthly or annually that you can cancel from settings, with fees non-refundable.",
        question: "What does Orchid cost?",
      },
      {
        answer:
          "Its privacy policy names a provider for SMS and iMessage when you enable it, and the start button opens a text to a US number. A web app handles sign-in and settings. Telegram and WhatsApp are not documented.",
        question: "Does Orchid work outside iMessage?",
      },
    ],
    headline:
      "Orchid keeps your inbox, calendar, and habits in order by text. Murph keeps your health in order the same way.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Orchid is an iMessage and SMS assistant for inbox triage, bookings, and habits like photo calorie tracking. Murph is a personal health assistant for labs, wearables, and errands.",
    name: "Orchid",
    quickComparison: [
      { capability: "Inbox triage and drafting", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Travel and admin bookings", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Recurring habit automations", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Medication reminders", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "limited", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "orchid",
    sources: [
      { label: "Orchid homepage", url: "https://orchid.ai/" },
      { label: "Orchid FAQ", url: "https://orchid.ai/faq" },
      { label: "Orchid privacy policy", url: "https://orchid.ai/legal/privacy" },
      { label: "Orchid terms of service", url: "https://orchid.ai/legal/terms" },
    ],
    tradeoffs: [
      "Orchid's inbox triage, drafting in your voice, travel booking, and admin follow-through go well beyond what Murph does. Murph does not draft your email or book your flights.",
      "Orchid's health features are habits layered on a productivity assistant. No wearables, labs, records, or symptom tracking are documented, and the FAQ names only Gmail and Google Calendar as live integrations.",
      "Pricing is not visible without a browser session, and the terms make fees non-refundable. Confirm the plan and the current integration list before moving your routines over.",
    ],
    useTogether:
      "Use Orchid for inbox, calendar, and admin, and use Murph for health data, experiments, and health errands. No connection between the products is documented, so pick which one sends medication or habit reminders.",
  },
  {
    aliases: ["Tether", "Eugene AI"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Eugene if you want a text-only memory and reminder assistant on any phone, with routines, a caregiving mode for meds, appointments, and refills, and a dashboard where you can edit everything it remembers.",
    chooseMurph:
      "Choose Murph if you want reminders to sit beside connected wearables, labs, records, meal and symptom logs, personal experiments, and health errands in one iMessage or Telegram conversation.",
    competitor: {
      clinicalRole:
        "Eugene is a personal admin assistant, not a health service. Its terms say the assistant may make mistakes and that reminders and other actions should be reviewed, and the caregiving page frames medication help as reminders rather than advice.",
      followThrough:
        "Eugene reaches out first, fires reminders on time, runs recurring routines and scheduled digests, follows up, and with consent texts reminders to other people labeled as coming from you. The fitness page describes a morning session text and a check-in afterward, with no streaks to break.",
      format:
        "Plain text conversation with an assistant that remembers, over SMS in the US and Canada or Telegram elsewhere. There is no app or signup; an account is created when you say hi, and an optional web dashboard shows memory, activity logs, reminders, and routines.",
      hardware:
        "Any phone that can send SMS in the US or Canada, or Telegram elsewhere. No device or app is required.",
      inputs:
        "Messages, saved facts and preferences, Google Calendar events, Notion pages, and group chat messages when added to a group. Caregiving memory can hold a loved one's doctors, insurance, and schedule. No wearable, lab, photo, or record inputs are documented, and voice memos are not supported on SMS.",
      insightStyle:
        "Memory with a time on it. Eugene saves facts you share, carries them across conversations, surfaces what is on your plate, and recaps group chats. It does not analyze health data or run experiments.",
      platforms:
        "SMS at a toll-free US number for the US and Canada, Telegram for everyone else, and a web dashboard with magic-link sign-in. Google Calendar and Notion connect with one tap, Outlook is on the roadmap, and an Eugene for Business front desk product exists.",
      pricing:
        "No prices are published on the pages reviewed, and the site has no pricing page. The public pages describe texting to start with no signup but do not state whether or when a paid plan applies.",
      primaryJob:
        "Remember the details of your life and remind you in time, by text, with no app to maintain and no shame when you fall off.",
    },
    competitorEvidence: {
      clinicalRole: [2, 5],
      followThrough: [1, 2, 3],
      format: [1, 4],
      hardware: [1],
      inputs: [1, 2, 4],
      insightStyle: [1, 4],
      platforms: [1, 4, 5],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "The former trytether.ai address now opens meeteugene.com, and Eugene's privacy policy still uses a tether opt-out command for group chats. Treat Tether as the earlier name for the same text assistant.",
        question: "Is Eugene the same product as Tether?",
      },
      {
        answer:
          "Yes, with their consent. You connect with them, they confirm once, and Eugene texts them dose reminders labeled as coming from you. They can stop at any time. Eugene keeps the schedule and remembers doctors and insurance details, but it does not give medical advice.",
        question: "Can Eugene remind my parent about medication?",
      },
      {
        answer:
          "Yes. It runs over SMS on any phone in the US and Canada and over Telegram elsewhere, with no app to install. Murph works in iMessage or Telegram and adds a web account for review, but it does not offer SMS.",
        question: "Does Eugene work on iPhone and Android?",
      },
    ],
    headline:
      "Eugene remembers and reminds by plain text. Murph adds the health data and follow-through around those reminders.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Eugene, formerly Tether, is an SMS and Telegram memory assistant with reminders, routines, and caregiving support. Murph is a personal health assistant for wearables, labs, and errands.",
    name: "Eugene",
    quickComparison: [
      { capability: "Reminds other people for you", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Editable memory dashboard", competitor: "yes", evidence: "platforms", murph: "limited" },
      { capability: "Works on any phone by SMS", competitor: "yes", evidence: "platforms", murph: "no" },
      { capability: "Group chat recaps", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Texts you first", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "limited", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "eugene",
    sources: [
      { label: "Eugene homepage and FAQ", url: "https://www.meeteugene.com/" },
      { label: "Eugene for caregivers", url: "https://www.meeteugene.com/care" },
      { label: "Eugene for training", url: "https://www.meeteugene.com/fitness" },
      { label: "Eugene privacy policy", url: "https://www.meeteugene.com/privacy" },
      { label: "Eugene terms of service", url: "https://www.meeteugene.com/terms" },
    ],
    tradeoffs: [
      "Eugene works on any phone over SMS, reminds other people for you with consent, recaps group chats, and lets you read and edit every stored memory. Murph does not support SMS and does not text reminders to third parties.",
      "Eugene stays deliberately narrow on personal admin. It documents no wearable, lab, photo, or record inputs, no meal logging, and no health analysis, so medication support is scheduling rather than context.",
      "Eugene publishes no pricing, and its terms are brief with no specific health or emergency disclaimer. Ask what a paid plan costs before building routines around it.",
    ],
    useTogether:
      "Let Eugene hold family schedules and caregiving reminders, and let Murph hold your own health data, experiments, and errands. No connection between the products is documented.",
  },
  {
    aliases: ["CareSupport.com", "CareSupport care coordinator"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose CareSupport if you are the person carrying a loved one's care and want an iMessage or SMS coordinator that assigns meds, appointments, and refills to family members, texts them reminders, collects confirmations, and reports back to you.",
    chooseMurph:
      "Choose Murph if you want a personal health assistant for your own health, with connected wearables and labs, records, meal and symptom logs, personal experiments, optional group support, and health errands.",
    competitor: {
      clinicalRole:
        "CareSupport is coordination, not clinical advice. Its terms say it is not a healthcare provider, does not diagnose or treat, and is not for emergencies, and its privacy policy says it is not a HIPAA covered entity, so care details are protected by its policy rather than medical-record law.",
      followThrough:
        "You describe who does what, CareSupport texts each caregiver a reminder such as a morning medication, collects a confirmation, reports back to you, flags gaps, and runs the loop again the next day. It keeps an audit trail of every outreach and only contacts people you approve.",
      format:
        "A family care coordinator that lives in the iMessage thread. Onboarding happens in the conversation, and there is no app or dashboard for you or the people it texts.",
      hardware:
        "Any phone with iMessage or SMS. No device, wearable, or app is required for the account holder or the caregivers it texts.",
      inputs:
        "Messages, medication names and times, schedules, care notes, and the names and phone numbers of caregivers you ask it to coordinate. Replies from caregivers are stored in the same care record, and context is kept across conversations while a care case is active. No wearable, lab, or medical record connections are documented.",
      insightStyle:
        "Operational, not analytical. It tells you what was done and when, catches what slipped, and remembers context across days, which the privacy policy calls the product. It does not interpret symptoms, labs, or data.",
      platforms:
        "iMessage and SMS through a US texting program with STOP and HELP keywords, for adults 18 and older. No app, web dashboard, Telegram, or WhatsApp is documented.",
      pricing:
        "Free during the beta when reviewed. The homepage calls it a private beta that is free for the first cohort, the terms call it an open beta with limited capacity, and no paid plan is published.",
      primaryJob:
        "Run the daily loop of family care, so the right person does the right thing on time and the coordinator stops chasing everyone.",
    },
    competitorEvidence: {
      clinicalRole: [2, 3],
      followThrough: [1, 2, 3],
      format: [1],
      hardware: [1],
      inputs: [1, 2],
      insightStyle: [1, 2],
      platforms: [1, 2, 3],
      pricing: [1, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. CareSupport texts caregivers in the iMessage or SMS they already have, identifies itself, and lets anyone reply STOP. You approve each person before it contacts them, and their replies join the same care record.",
        question: "Do my family members need to install anything for CareSupport?",
      },
      {
        answer:
          "No. Its privacy policy says it is a coordination tool, not a healthcare provider, and not a HIPAA covered entity. Care details are covered by its own policy and security practices, and it suggests sharing only what you are comfortable having stored.",
        question: "Is CareSupport HIPAA protected?",
      },
      {
        answer:
          "CareSupport coordinates other people around one person's care. Murph is a personal assistant for your own health data, records, experiments, and errands. A caregiver could use CareSupport to run the family loop and Murph to manage their own health, but no connection between the two is documented.",
        question: "How do CareSupport and Murph fit together?",
      },
    ],
    headline:
      "CareSupport coordinates a family around one person's care. Murph is the assistant for your own health.",
    lastVerified: "2026-09-04",
    metaDescription:
      "CareSupport is a free beta iMessage coordinator that assigns meds and appointments to family caregivers. Murph is a personal health assistant for labs, wearables, and errands.",
    name: "CareSupport",
    quickComparison: [
      { capability: "Coordinates a care team by text", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Caregiver task confirmations", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Audit trail of outreach", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Medication reminders", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "limited", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
    ],
    relationship: "complement",
    slug: "caresupport",
    sources: [
      { label: "CareSupport homepage and FAQ", url: "https://caresupport.com/" },
      { label: "CareSupport privacy policy", url: "https://caresupport.com/privacy" },
      { label: "CareSupport terms of service", url: "https://caresupport.com/terms" },
    ],
    tradeoffs: [
      "CareSupport's caregiver loop, confirmations, and audit trail solve a coordination problem Murph does not address. Murph does not text tasks to your relatives or collect their confirmations.",
      "CareSupport is a beta with no published paid price, no app, and no wearable, lab, or record inputs. Its terms say it does not guarantee that messages deliver, reminders fire, or gaps get filled.",
      "CareSupport is not a HIPAA covered entity and its terms disclaim medical advice, so it is a scheduling layer rather than a source of health guidance.",
    ],
    useTogether:
      "Run the family medication and appointment loop in CareSupport, and keep your own wearables, labs, records, experiments, and health errands in Murph. No connection between the products is documented.",
  },
  {
    aliases: ["Duckbill AI", "Duckbill Technologies"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Duckbill if you want background-checked humans to make the calls: find an in-network therapist or dentist with openings, track down a hard-to-find prescription, dispute a denied insurance claim, or cancel the gym, submitted by app, text, or email.",
    chooseMurph:
      "Choose Murph if you want an ongoing health assistant that understands your wearables, labs, records, meals, and symptoms, answers open questions, tests what helps, and handles routine health errands as part of that conversation.",
    competitor: {
      clinicalRole:
        "Duckbill is a life-admin service, not a healthcare provider. Its privacy policy says it is not a HIPAA covered entity even though members share insurance and medical details for tasks, and its terms say it does not guarantee task outcomes.",
      followThrough:
        "Human specialists call, negotiate, follow up, and escalate until a task is finished, with real-time task updates in the app and recurring tasks handled on schedule. Examples include calling six pharmacies for a prescription, three calls and two escalations to reverse a $340 insurance charge, and booking a family's dentist appointments.",
      format:
        "A concierge you delegate to by app, text, or email, or from Claude and ChatGPT through an MCP connector. AI breaks the task down and a person picks it up.",
      hardware:
        "No device required. An iPhone app is available, and text or email works without it.",
      inputs:
        "Task descriptions, forwarded emails, screenshots, insurance details, and whatever context the team asks for. The privacy policy lists health insurance and other medical information among the data members provide, and the App Store listing says the service anticipates to-dos as it learns you. No wearable, lab, or record connections are documented.",
      insightStyle:
        "Execution rather than insight. Duckbill researches options, filters by insurance and availability, then completes the task and reports what happened. It does not analyze health data or answer open-ended health questions.",
      platforms:
        "iOS app for iPhone and iPad requiring iOS 15.1 or later, text and email intake, a web account, and an MCP integration for Claude and ChatGPT. No Android app is documented.",
      pricing:
        "Essentials $49 per month for roughly 3 to 5 tasks, Individual $99 for 4 to 6, Household $169 for 8 to 12 with two member accounts, and Household Plus $350 for 16 to 20 with priority handling, all billed monthly with bandwidth boosts available. Fees are non-refundable under the terms.",
      primaryJob:
        "Take the dreaded real-world admin off your plate by pairing AI planning with background-checked humans who finish the job.",
    },
    competitorEvidence: {
      clinicalRole: [3, 4],
      followThrough: [1, 2],
      format: [1, 2, 5],
      hardware: [2, 5],
      inputs: [1, 3, 5],
      insightStyle: [1, 2],
      platforms: [2, 5],
      pricing: [2, 4],
      primaryJob: [1, 5],
    },
    faqs: [
      {
        answer:
          "Both. AI handles research, prep, and planning, and background-checked human specialists make the calls, wait on hold, negotiate, and follow up. The pricing page says more than 200 trained operators work on tasks.",
        question: "Are Duckbill's tasks done by people or by AI?",
      },
      {
        answer:
          "Yes. Its own examples include finding in-network therapists, psychiatrists, and dentists with openings, locating a prescription in stock, fixing a prescription price error, disputing denied claims, and rescheduling checkups. It is not a healthcare provider and not a HIPAA covered entity.",
        question: "Can Duckbill handle health errands?",
      },
      {
        answer:
          "Duckbill starts at $49 per month for a handful of tasks and scales to $350. Murph starts free without a card and handles routine health errands inside an ongoing health conversation, but it has no human doers who will sit on hold or negotiate for you.",
        question: "How does Duckbill compare with Murph on price and scope?",
      },
    ],
    headline:
      "Duckbill sends humans to finish your errands. Murph understands your health and handles the routine ones itself.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Duckbill sends vetted humans to find in-network doctors, fight insurance denials, and chase prescriptions from $49 a month. Murph is a personal health assistant for labs and errands.",
    name: "Duckbill",
    quickComparison: [
      { capability: "Human specialists make calls", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Disputes bills and denied claims", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Shared household plans", competitor: "yes", evidence: "pricing", murph: "no" },
      { capability: "General life admin tasks", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Handles health errands", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Open ended health questions", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "duckbill",
    sources: [
      { label: "Duckbill homepage", url: "https://getduckbill.com/" },
      { label: "Duckbill pricing", url: "https://getduckbill.com/pricing" },
      { label: "Duckbill privacy policy", url: "https://getduckbill.com/privacy" },
      { label: "Duckbill terms of use", url: "https://getduckbill.com/terms" },
      { label: "Duckbill App Store listing", url: "https://apps.apple.com/us/app/duckbill/id6455085338" },
    ],
    tradeoffs: [
      "Duckbill's human specialists will sit on hold, argue with an insurer, and call six pharmacies. Murph has no human operators, so complex disputes and negotiations stay with you or a service like this.",
      "Duckbill executes tasks but does not understand your health. It documents no wearables, labs, records, or symptom tracking, and it does not answer open-ended health questions.",
      "Plans start at $49 per month for a few tasks and reach $350, fees are non-refundable, and outcomes are not guaranteed. Duckbill is also not a HIPAA covered entity despite handling insurance and medical details.",
    ],
    useTogether:
      "Use Murph to understand the problem and handle routine health errands, and hand the hold-queue disputes, hard-to-find prescriptions, and in-network searches to Duckbill when you want a human to finish them. No connection between the products is documented.",
  },
]);
