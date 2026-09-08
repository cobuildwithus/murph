import { defineComparisons } from "../types";

export const LONGEVITY_APP_COMPARISONS = defineComparisons([
  {
    aliases: ["Immortals Bryan Johnson", "Blueprint"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Immortals if you want Bryan Johnson's protocol turned into a free app that reads your wearables and any lab report, with prescriptions, a yearly biomarker panel, and supplements sold alongside it.",
    chooseMurph:
      "Choose Murph if you want one ongoing conversation that reads the same wearables and labs, then handles reminders, health errands, records, and personal experiments without steering you toward one protocol or one shop.",
    competitor: {
      clinicalRole:
        "Immortals is run by Continuance LLC, which also operates Blueprint and Don't Die. Its terms say the services are educational, not medical advice, and that its tests do not diagnose or treat disease. Immortals Medicine adds telehealth prescriptions written by US licensed physicians for adults in eligible states, and the App Store listing says the app is not a medical device.",
      followThrough:
        "BryanAI produces a personalized protocol with daily insights in plain language. Immortals Medicine offers a doctor review within 72 hours and unlimited portal follow-up for up to 12 months. Immortals Concierge adds a dedicated physician, coach, and care coordinator for members paying from $75,000 per year.",
      format:
        "A free iPhone app with a protocol view, plus a web store for Blueprint supplements, Immortals Medicine prescriptions, and Blueprint Biomarkers testing. The homepage founder note still calls the app the coming home base while the App Store shows version 1.9.1.",
      hardware:
        "No proprietary device. The site says the app supports all major wearables and names Oura, WHOOP, Apple, Fitbit, Eight Sleep, Dexcom, FreeStyle Libre, Ultrahuman, Polar, Withings, Google Fit, Strava, Peloton, Wahoo, Hammerhead, Omron, Cronometer, and Beurer. The App Store listing also names Garmin.",
      inputs:
        "Wearable data, biomarkers uploaded from any lab in any format, and results from Blueprint Biomarkers, a $365 per year Quest Diagnostics program with a baseline draw and a six month follow-up covering 200+ blood and urine tests. The privacy policy also lists genetic results, biometric identifiers, and precise location.",
      insightStyle:
        "BryanAI compares your data against Bryan Johnson's protocol and population research, then adapts recommendations to your biology. The output is a protocol with daily insights rather than a single composite score.",
      platforms:
        "iPhone and iPad on iOS 15.1 or later, Apple silicon Macs, and Apple Vision, per the App Store. The pages reviewed do not link an Android app. Blueprint Biomarkers results appear in a separate Biomarkers platform app.",
      pricing:
        "The app is free to download with in-app purchases for Blueprint products. Blueprint Biomarkers costs $365 per year billed annually. Immortals Medicine charges $0 membership fees and bills per medication after physician approval. Concierge tiers run from $75,000 to $1,000,000 per year. Subscription payments are described as nonrefundable.",
      primaryJob:
        "Turn your wearable and lab data into a personalized longevity protocol modeled on Bryan Johnson's, and route you to the company's biomarker testing, prescriptions, and supplements when they fit.",
    },
    competitorEvidence: {
      clinicalRole: [2, 6, 7],
      followThrough: [1, 2, 3],
      format: [1, 7],
      hardware: [1, 7],
      inputs: [1, 4, 5],
      insightStyle: [1],
      platforms: [4, 7],
      pricing: [1, 2, 3, 4, 6],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "They overlap on wearable and lab inputs and daily guidance. Immortals gives you a protocol modeled on Bryan Johnson's routine and sells testing, prescriptions, and supplements to go with it. Murph works in iMessage or Telegram and adds reminders, health errands, records, and personal experiments. Nothing connects the two, so pick one as your daily tool.",
        question: "Does Immortals replace Murph, or the other way around?",
      },
      {
        answer:
          "Yes, the download is free and the site says biomarker panels, prescriptions, and supplements are optional paid add-ons. Blueprint Biomarkers costs $365 per year, Immortals Medicine bills per medication with no membership fee, and Concierge starts at $75,000 per year.",
        question: "Is the Immortals app really free?",
      },
      {
        answer:
          "The app and protocol are educational, and the terms say its tests do not diagnose or treat disease. Immortals Medicine is a separate telehealth service where US licensed physicians review an intake and can prescribe. Murph offers no prescriptions or clinician visits.",
        question: "Does Immortals give medical care?",
      },
    ],
    headline:
      "Immortals builds a Bryan Johnson style protocol from your data. Murph runs the rest of your health in one conversation.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Immortals is Bryan Johnson's free protocol app with wearable sync, lab uploads, and paid testing and prescriptions. Murph is a personal health assistant for the everyday follow through.",
    name: "Immortals",
    quickComparison: [
      { capability: "Visual protocol dashboard", competitor: "yes", evidence: "format", murph: "limited" },
      { capability: "Optional telehealth prescriptions", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Optional yearly lab panel", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "Wearable and lab context", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Personalized daily protocol", competitor: "yes", evidence: "primaryJob", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "immortals",
    sources: [
      { label: "Immortals overview, app, and supported wearables", url: "https://immortals.com/" },
      { label: "Immortals Medicine telehealth and pricing", url: "https://immortals.com/pages/immortals-medicine" },
      { label: "Immortals Concierge membership", url: "https://immortals.com/pages/immortals-concierge" },
      { label: "Blueprint Biomarkers testing program", url: "https://immortals.com/pages/biomarkers" },
      { label: "Immortals privacy policy", url: "https://immortals.com/policies/privacy-policy" },
      { label: "Immortals terms of service", url: "https://immortals.com/policies/terms-of-service" },
      { label: "Immortals Bryan Johnson App Store listing", url: "https://apps.apple.com/us/app/id6761206137" },
    ],
    tradeoffs: [
      "Immortals is built around one person's protocol and a store that sells the matching supplements, tests, and prescriptions, so the recommendations and the shopping are hard to separate.",
      "The homepage founder note still describes the app as coming soon while the App Store lists version 1.9.1, so expect the product to change quickly. The pages reviewed do not link an Android app.",
      "Murph has no visual protocol dashboard, no supplement or prescription options, and no bundled lab panel. It reads results you bring in and works through messaging instead.",
    ],
  },
  {
    aliases: ["Don't Die App", "Don't Die Bryan Johnson"],
    category: "health-data",
    chooseCompetitor:
      "Choose Don't Die if a free daily score, a biological age readout, and leaderboards against friends and Bryan Johnson are what will get you moving every day.",
    chooseMurph:
      "Choose Murph if you want an assistant that reads the same wearables but also keeps your labs, records, symptoms, and meals in one conversation and helps you follow through on plans and errands.",
    competitor: {
      clinicalRole:
        "Don't Die is a consumer habit and tracking app from Continuance LLC, the company behind Blueprint and Immortals. Its App Store listing describes score tracking, community, and wearable sync, and the pages reviewed make no claim of clinician involvement, diagnosis, treatment, or medical-device status.",
      followThrough:
        "The app frames progress as leveling up a Don't Die Score, comparing it with friends, family, and Bryan Johnson on leaderboards, earning badges, and joining local Don't Die communities and events.",
      format:
        "A free mobile app with a daily score, a biological age estimate from multiple methods, biomarker tracking, community feeds, and leaderboards. The dontdie.com site also sells a separate Citizenship membership and promotes summits and a documentary.",
      hardware:
        "No proprietary device. The App Store listing says you connect a wearable to calculate the daily score automatically and names WHOOP and Apple Watch.",
      inputs:
        "Wearable data, tracked biomarkers, habits, workouts, and the health data you choose to share with the community. The privacy policy and terms are hosted on Notion and linked from dontdie.com.",
      insightStyle:
        "A single daily Don't Die Score built on longevity best practices, plus a biological age estimate and progress over time. Motivation comes from competition and community rather than from personalized analysis of labs or records.",
      platforms:
        "iPhone and iPad on iOS 16 or later, Apple silicon Macs, and Apple Vision, plus an Android app on Google Play. Account pages live at app.dontdie.com.",
      pricing:
        "Free on the App Store, and the listing does not mention in-app purchases. Citizenship membership on dontdie.com is a separate paid program.",
      primaryJob:
        "Turn longevity habits into one daily score you can improve and compare with a community.",
    },
    competitorEvidence: {
      clinicalRole: [3],
      followThrough: [1, 3],
      format: [1, 2, 3],
      hardware: [3],
      inputs: [1, 3],
      insightStyle: [2, 3],
      platforms: [3, 6],
      pricing: [1, 3],
      primaryJob: [2, 3],
    },
    faqs: [
      {
        answer:
          "No. There is no connection between the two apps. Both can read the same wearables separately. If you use both, Don't Die keeps the score and leaderboard while Murph holds the labs, records, plans, and reminders.",
        question: "Does Don't Die connect to Murph?",
      },
      {
        answer:
          "The app describes it as a daily score based on longevity best practices, calculated automatically once a wearable is connected and improved by building habits. The site says biological age is measured through multiple methods. Neither is a medical assessment.",
        question: "What does the Don't Die Score measure?",
      },
      {
        answer:
          "The app is free on the App Store and Google Play, and the App Store listing mentions no in-app purchases. Citizenship on dontdie.com is a separate paid membership. Murph also starts free without a card.",
        question: "Is Don't Die free?",
      },
    ],
    headline:
      "Don't Die turns longevity into a daily score and a leaderboard. Murph keeps the whole picture in one conversation.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Don't Die is Bryan Johnson's free app with a daily score, biological age, wearable sync, and leaderboards. Murph is a personal health assistant that works in iMessage or Telegram.",
    name: "Don't Die",
    quickComparison: [
      { capability: "Daily composite score", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Leaderboards with friends", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Biological age estimates", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "dont-die",
    sources: [
      { label: "Don't Die movement site and app links", url: "https://dontdie.com/" },
      { label: "Don't Die app site", url: "https://dontdieapp.com/" },
      { label: "Don't Die App Store listing", url: "https://apps.apple.com/us/app/dont-die-bryan-johnson/id6479563760" },
      { label: "Don't Die app privacy policy", url: "https://dontdieapp.notion.site/Don-t-Die-App-Privacy-Policy-14272cd579f280a088cbcc09012ff6e0" },
      { label: "Don't Die app terms of service", url: "https://dontdieapp.notion.site/Don-t-Die-App-Terms-of-Service-10472cd579f280738b55f0af738f27a5" },
      { label: "Don't Die Google Play listing", url: "https://play.google.com/store/apps/details?id=org.bryanjohnson.blueprint" },
    ],
    tradeoffs: [
      "Don't Die's score and leaderboards are motivating if competition works for you, but a single score can hide which habit actually moved your results.",
      "Its privacy policy and terms are hosted on Notion rather than on the product site, and the pages reviewed do not describe lab report uploads beyond biomarker tracking.",
      "Murph does not produce a composite daily score, a biological age estimate, or leaderboards, and it has no community events.",
    ],
    useTogether:
      "Keep Don't Die for the score and the friendly competition. Use Murph for the labs, records, reminders, and errands the score does not cover. No data passes between them.",
  },
  {
    aliases: ["Instinct AI", "Spear Street Technology"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Instinct if you can get into its private beta and want a general assistant that reads your email, messages, screen, audio, and location to book, coordinate, and follow up across your whole life.",
    chooseMurph:
      "Choose Murph if you want an assistant built for health specifically, available today in iMessage or Telegram, that reads wearables, labs, and records and handles health errands and experiments.",
    competitor: {
      clinicalRole:
        "Instinct is a general personal assistant from Spear Street Technology, Inc. Its terms say you should not rely on its output for medical, legal, or financial advice. The privacy policy says it may process health information when the assistant books a medical appointment or summarizes a message from your provider.",
      followThrough:
        "Instinct acts on your behalf across apps and devices, from booking transport and a handyman to handling email. Health tasks appear only as examples of general errands. The pages reviewed describe no health plans, reminders, or check-ins.",
      format:
        "There is no new interface. Instinct is trained to use a phone and a computer the way a person does, and you text or call it. It connects to email, messaging, screen, audio, location, and calendar.",
      hardware:
        "No dedicated device. It uses your existing phone and computer. The privacy policy names a Mac OS application and mobile applications.",
      inputs:
        "Email, messages, calendar, screen content, audio, location, and contacts, per the privacy policy. Health information is incidental to tasks rather than a tracked data source, and no wearable, lab, or record connections are documented.",
      insightStyle:
        "Task completion and coordination across your accounts, not health analysis. It does not publish scores, trends, or biomarker interpretation.",
      platforms:
        "A macOS app and mobile apps are named in the privacy policy, with text and call access. The service is currently available to a private access group with a waitlist while the company scales compute.",
      pricing:
        "No pricing is published. The terms describe paid services billed in US dollars with nonrefundable payments and say beta offerings are provided as is.",
      primaryJob:
        "Act as an autonomous personal assistant that understands what you are working on and handles life logistics across your devices and accounts.",
    },
    competitorEvidence: {
      clinicalRole: [2, 3],
      followThrough: [1, 2],
      format: [1],
      hardware: [1, 2],
      inputs: [1, 2],
      insightStyle: [1],
      platforms: [1, 2],
      pricing: [1, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Instinct is a general assistant for email, messages, scheduling, and errands. Health shows up only when a task touches it, such as booking a medical appointment. Murph is built around health data and health follow through.",
        question: "Is Instinct a health assistant?",
      },
      {
        answer:
          "Only if you are admitted. The site says Instinct is available to a private access group while the company scales compute, with a waitlist for everyone else. No pricing is published. Murph starts free without a card.",
        question: "Can I use Instinct today?",
      },
      {
        answer:
          "Not through any documented connection. In practice one could handle general life admin while the other handles health data, plans, and errands. Instinct's terms say not to rely on it for medical advice, and Murph is educational support rather than medical care.",
        question: "Could Instinct and Murph work together?",
      },
    ],
    headline:
      "Instinct runs your life admin from your devices. Murph is the assistant built for your health.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Instinct is a private beta assistant that acts across email, messages, screen, and calendar. Murph is a personal health assistant for wearables, labs, records, errands, and experiments.",
    name: "Instinct",
    quickComparison: [
      { capability: "General life automation", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Acts across email and calendar", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Phone call interaction", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Screen and audio awareness", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "Works without dedicated hardware", competitor: "yes", evidence: "hardware", murph: "yes" },
      { capability: "Works on iPhone and Mac", competitor: "yes", evidence: "platforms", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "instinct",
    sources: [
      { label: "Instinct overview and private access", url: "https://instinct.com/" },
      { label: "Instinct privacy policy", url: "https://instinct.com/privacy-policy" },
      { label: "Instinct terms of service", url: "https://instinct.com/terms" },
    ],
    tradeoffs: [
      "Instinct's real strength is breadth. It can act on anything it can see on your screen or in your accounts, which no health app matches, but that breadth also means deep access to messages, audio, and location.",
      "It is not generally available, has no published price, and its beta terms say the service is provided as is.",
      "Murph does not book non-health tasks, read your screen, or take phone calls, and it does not act inside your other apps.",
    ],
  },
  {
    aliases: ["Viome Full Body Intelligence", "Viome Gut Intelligence"],
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Viome if you want an at-home stool, saliva, and blood test that scores your microbiome and cellular activity and turns it into personal food lists and custom supplements.",
    chooseMurph:
      "Choose Murph if you want help using those results day to day, alongside your wearables, meals, symptoms, and records, with reminders for the six month retest and someone to ask when a food list conflicts with your life.",
    competitor: {
      clinicalRole:
        "Viome Life Sciences says its information is for educational and informational use only, is not for diagnostic purposes, and is not a substitute for medical advice. Samples are processed at a CLIA certified lab, and its supplement statements carry the standard FDA disclaimer.",
      followThrough:
        "Personalized food recommendations sorted into Superfoods, Enjoy, Minimize, and Avoid, plus Precision Supplements shipped about every 30 days and personalized probiotics and oral care. Viome recommends retesting every six months so recommendations update.",
      format:
        "An at-home test kit that collects stool, saliva, and blood in about 20 minutes, with results and scores delivered in the Viome app and a web login at app.viome.com.",
      hardware:
        "No device beyond the collection kit. The app integrates with Apple HealthKit for activity and sleep metrics.",
      inputs:
        "Stool, saliva, and blood samples analyzed with mRNA sequencing across 400+ biological pathways, plus questionnaire answers and HealthKit data. The pages reviewed do not describe uploads of outside lab reports.",
      insightStyle:
        "70+ health scores for digestion, metabolism, inflammation, mood, immune health, and energy, a biological age estimate, 370+ personalized food recommendations, and a supplement formula built from your results.",
      platforms:
        "iPhone, iPad, Apple silicon Mac, and Apple Vision on the App Store, plus a web login. The App Store listing was last updated in August 2025 at version 7.5.13.",
      pricing:
        "Full Body Intelligence lists at $399 and Gut Intelligence at $279 when reviewed, with a Labor Day sale showing $299 and $209. Precision Supplements were shown at $119 per month. Personalized products require a test first and are sold as separate subscriptions.",
      primaryJob:
        "Measure microbiome and cellular activity from home and turn it into specific food and supplement guidance that updates with each retest.",
    },
    competitorEvidence: {
      clinicalRole: [1, 3, 4],
      followThrough: [1, 2, 5],
      format: [1, 2],
      hardware: [2, 5],
      inputs: [1, 2, 5],
      insightStyle: [1, 2],
      platforms: [1, 5],
      pricing: [1, 2, 4],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph runs no tests. Viome collects stool, saliva, and blood and sequences RNA activity in its lab. You can share Viome's scores and food lists with Murph so they sit next to your meals, wearables, and other labs.",
        question: "Can Murph analyze my microbiome like Viome?",
      },
      {
        answer:
          "The test is a one time purchase, $399 for Full Body Intelligence when reviewed. Precision Supplements were listed at $119 per month, and personalized probiotics and oral care are separate subscriptions. Viome suggests retesting every six months.",
        question: "How much does Viome cost after the test?",
      },
      {
        answer:
          "No. Viome says its results are educational and not for diagnostic purposes, and its supplements carry the FDA disclaimer. Murph is educational support too. Digestive symptoms that worry you belong with a clinician.",
        question: "Are Viome results a diagnosis?",
      },
    ],
    headline:
      "Viome tests your microbiome and writes a food list. Murph helps you live with the list.",
    integration: "import",
    lastVerified: "2026-09-04",
    metaDescription:
      "Viome sells at-home stool, saliva, and blood tests with food scores and custom supplements. Murph is a personal health assistant that keeps those results in your daily context.",
    name: "Viome",
    quickComparison: [
      { capability: "Microbiome activity testing", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "Personalized food scores", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Custom made supplements", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Apple Health data sync", competitor: "yes", evidence: "hardware", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "viome",
    sources: [
      { label: "Viome products and current prices", url: "https://www.viome.com/" },
      { label: "Viome Full Body Intelligence test", url: "https://www.viome.com/products/full-body-intelligence" },
      { label: "Viome privacy policy", url: "https://www.viome.com/privacy-policy" },
      { label: "Viome terms", url: "https://www.viome.com/terms" },
      { label: "Viome App Store listing", url: "https://apps.apple.com/us/app/id1206984146" },
    ],
    tradeoffs: [
      "Viome's scores and food lists are specific, but the company's own pages say they are educational rather than diagnostic, and the RNA based food scoring is Viome's own method.",
      "The test is $399 before discounts, supplements were $119 per month, and results only refresh when you buy a retest.",
      "Murph cannot measure your microbiome, generate a 370 item food list, or formulate supplements. It works with the results you bring in.",
    ],
    useTogether:
      "Take the Viome test and let Viome build the food list and supplement formula. Then share the scores with Murph. Murph logs your meals against the list, watches how symptoms and sleep respond, and reminds you when the six month retest comes up.",
  },
  {
    aliases: ["Death Clock: The Life Lab", "Death Clock AI"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Death Clock if a life expectancy estimate that updates as you add blood work and wearable data is the framing that motivates you, and you want its blood panels drawn at Quest or Labcorp.",
    chooseMurph:
      "Choose Murph if you want the same lab and wearable inputs read inside an ongoing conversation that also handles records, symptoms, reminders, errands, and personal experiments, without a countdown.",
    competitor: {
      clinicalRole:
        "Most Days Inc., which runs Death Clock, says in its terms that it does not offer medical treatment, perform clinical health services, or provide medical advice. A Clinical Board designs the blood panels and framework, and partner labs perform the draws.",
      followThrough:
        "A personalized longevity plan built by its AI on the Clinical Board framework, an AI health concierge that reads bloodwork and habits, and progress tracking as biomarkers change. The pages reviewed do not describe reminders, human coaching, or errand help.",
      format:
        "An iPhone app with a web app at app.deathclock.co. You start with a 29 question estimate, then optionally add blood panels and wearable syncs so the estimate updates.",
      hardware:
        "No proprietary device. The App Store listing says you can sync Apple Health and wearables such as WHOOP and Oura. Blood draws happen at partner Quest and Labcorp locations.",
      inputs:
        "A 29 question intake based on 1,200+ longevity studies, blood panels including a Baseline panel and add-ons for Alzheimer's risk, stress, hormones, micronutrients, kidney, and liver, plus Apple Health and wearable data and past medical history uploads.",
      insightStyle:
        "A life expectancy estimate that is refined as new data arrives, a personalized longevity plan, and biomarker trends explained by the AI concierge.",
      platforms:
        "iPhone on iOS 15.1 or later, Apple silicon Macs, and Apple Vision, plus the web app. The pages reviewed do not link an Android app. Blood work is offered to US adults at about 4,200 partner locations, which the pricing page says covers 49 states.",
      pricing:
        "The pricing page renders its plans as an image and offers a three day free trial. The App Store lists in-app purchases including Digital Only at $49.99 per year, a Baseline blood package with a three day trial at $99.99, and Death Clock memberships from $9.99 to $99.99. Payments are described as final and nonrefundable unless Most Days decides otherwise.",
      primaryJob:
        "Estimate how long you will live, then show how blood work and habit changes move that estimate.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4],
      followThrough: [1, 5],
      format: [1, 5],
      hardware: [1, 5],
      inputs: [1, 3, 5],
      insightStyle: [1, 5],
      platforms: [1, 2, 5],
      pricing: [2, 4, 5],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "It is a model estimate from a 29 question intake and, if you add them, blood results and wearable data. Death Clock says it is built on longevity research, and its terms say it provides no medical advice. Treat the number as a motivational estimate, not a prognosis.",
        question: "Is the Death Clock estimate accurate?",
      },
      {
        answer:
          "The web pricing page shows plans as an image, so the clearest figures are in the App Store: Digital Only at $49.99 per year, a Baseline blood package with a three day trial at $99.99, and memberships between $9.99 and $99.99 when reviewed.",
        question: "How much does Death Clock cost?",
      },
      {
        answer:
          "Partly. Murph does not estimate life expectancy or sell blood panels. It can read the blood results you upload, connect them with your wearables and records, and help you follow the plan you choose.",
        question: "Can Murph do what Death Clock does?",
      },
    ],
    headline:
      "Death Clock counts down and updates with your bloodwork. Murph works the plan in between.",
    integration: "import",
    lastVerified: "2026-09-04",
    metaDescription:
      "Death Clock estimates your lifespan and updates it with blood panels and wearable data. Murph is a personal health assistant that reads those results and keeps the plan moving.",
    name: "Death Clock",
    quickComparison: [
      { capability: "Life expectancy estimate", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Ordered blood panels", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "Questionnaire based longevity plan", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Wearable and lab context", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Plain language lab review", competitor: "yes", evidence: "insightStyle", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Free start without a card", competitor: "limited", evidence: "pricing", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "death-clock",
    sources: [
      { label: "Death Clock overview", url: "https://deathclock.co/" },
      { label: "Death Clock pricing", url: "https://deathclock.co/pricing" },
      { label: "Death Clock privacy policy", url: "https://deathclock.co/privacy-policy" },
      { label: "Death Clock terms of use", url: "https://deathclock.co/terms-of-use" },
      { label: "Death Clock App Store listing", url: "https://apps.apple.com/us/app/id6499554412" },
    ],
    tradeoffs: [
      "A countdown is a strong motivator for some people and a source of anxiety for others. Death Clock's own terms say it provides no medical advice, so the estimate is not a clinical prognosis.",
      "The web pricing page shows plans as an image, and the App Store lists ten different in-app purchases, so check what a given tier includes before paying.",
      "Murph offers no life expectancy model, no ordered blood panels, and no partner draw sites. It works with results you bring in.",
    ],
  },
  {
    aliases: ["Ageless Rx"],
    category: "labs-longevity",
    chooseCompetitor:
      "Choose AgelessRx if you want a US telehealth service that can prescribe rapamycin, metformin, NAD+, or microdosed GLP-1s after an online evaluation, with biological age tests and lab panels sold alongside.",
    chooseMurph:
      "Choose Murph if you want help understanding those labs and living with a protocol between refills, with wearables, meals, symptoms, and records in the same conversation.",
    competitor: {
      clinicalRole:
        "AgelessRx says it is not a healthcare provider. It is a platform that connects you with independent US licensed providers and pharmacies who evaluate an online intake, sometimes with a short video consult, and decide whether to prescribe. Its terms tell you to call 911 in an emergency.",
      followThrough:
        "Provider guided titration with unlimited protocol adjustments and messaging on the rapamycin plan, monthly shipping from US pharmacies, and the ability to pause or cancel before the next refill with 48 hours notice.",
      format:
        "An online intake and portal. Treatments are monthly subscriptions shipped to your door, and tests are ordered as one time purchases.",
      hardware:
        "No device is required. Blood work for treatments such as rapamycin is included and drawn at labs, and the site also sells a continuous glucose monitor program from $99 per month.",
      inputs:
        "Your medical intake, required baseline and ongoing blood work for certain medications, and optional tests including a PhenoAge blood test from $75, a TruMe saliva biological age kit from $170, a 40+ biomarker Core Longevity Panel from $95, and a Galleri multi-cancer screen from $949.",
      insightStyle:
        "Clinical decisions from providers, and lab results with expert interpretation for the biological age tests. The pages reviewed describe a free online biological age calculator but no ongoing dashboard or wearable analysis.",
      platforms:
        "Website and online portal. The FAQ does not mention a mobile app, and AgelessRx says it serves every US state with some treatments restricted by state law.",
      pricing:
        "Rapamycin is $65 per month including baseline and ongoing blood work. Metformin and low dose naltrexone start at $25, NAD+ injections at $79, sermorelin at $99, and microdosed tirzepatide at $159 per month. Video consults carry no extra charge, insurance is not accepted, and HSA or FSA cards may work.",
      primaryJob:
        "Get longevity prescriptions and biological age testing to people through telehealth without a membership fee or insurance.",
    },
    competitorEvidence: {
      clinicalRole: [2, 6],
      followThrough: [2, 3],
      format: [1, 2],
      hardware: [3, 4],
      inputs: [3, 4],
      insightStyle: [4],
      platforms: [2],
      pricing: [1, 2, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "The FAQ says video consultations come at no additional cost, and the product pages show a single monthly price such as $65 for rapamycin that includes the required blood work. Its terms note that the price combines platform, pharmacy, and provider costs.",
        question: "Does AgelessRx charge a consultation fee?",
      },
      {
        answer:
          "No. Murph does not prescribe, order labs, or replace a clinician. It can hold the results and the schedule AgelessRx gives you, explain the labs in plain terms, and remind you about refills and follow up draws.",
        question: "Can Murph prescribe rapamycin or metformin?",
      },
      {
        answer:
          "No. The FAQ says its products and services are not eligible for insurance coverage or reimbursement, though HSA and FSA cards may be accepted. Murph starts free and does not bill insurance either.",
        question: "Does AgelessRx take insurance?",
      },
    ],
    headline:
      "AgelessRx prescribes longevity medications online. Murph keeps the protocol and the labs in view between refills.",
    integration: "import",
    lastVerified: "2026-09-04",
    metaDescription:
      "AgelessRx is a US telehealth platform for rapamycin, metformin, NAD+, and GLP-1 microdosing with biological age tests. Murph is a personal health assistant for everything in between.",
    name: "AgelessRx",
    quickComparison: [
      { capability: "Prescription longevity treatments", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Biological age blood test", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "Provider guided dose changes", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Works without dedicated hardware", competitor: "yes", evidence: "hardware", murph: "yes" },
      { capability: "Plain language lab review", competitor: "yes", evidence: "insightStyle", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "agelessrx",
    sources: [
      { label: "AgelessRx treatments and prices", url: "https://agelessrx.com/" },
      { label: "AgelessRx FAQ", url: "https://agelessrx.com/faq/" },
      { label: "AgelessRx rapamycin plan", url: "https://agelessrx.com/rapamycin/" },
      { label: "AgelessRx testing and tracking", url: "https://agelessrx.com/testing-tracking/" },
      { label: "AgelessRx privacy policy", url: "https://agelessrx.com/privacy-policy/" },
      { label: "AgelessRx terms of service", url: "https://agelessrx.com/terms-services/" },
    ],
    tradeoffs: [
      "AgelessRx is a platform, not the prescriber. Independent providers make the medical decisions, and the company says it is not responsible for their outcomes.",
      "Its privacy policy shows a 2020 last updated date with no HIPAA language, so read it closely before sharing your intake.",
      "Murph cannot prescribe, ship medication, or order biological age testing. It works with the results and instructions you bring in.",
    ],
    useTogether:
      "Use AgelessRx for the evaluation, the prescription, and the required blood work. Then bring the results and the dosing schedule to Murph. Murph explains the markers, reminds you about refills and follow up draws, and tracks how sleep, energy, and symptoms change against your own baseline.",
  },
  {
    aliases: ["Healthspan Longevity Clinic", "gethealthspan"],
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Healthspan if you want a digital longevity clinic where a clinician prescribes rapamycin, metformin, or GLP-1s and your membership includes the BioAge+ lab panel and PhD level coaching.",
    chooseMurph:
      "Choose Murph if you want the lab results and protocol from a clinic like Healthspan connected to your wearables, meals, symptoms, and records, with reminders and errands handled in one conversation.",
    competitor: {
      clinicalRole:
        "Healthspan is operated by ZenPatient, Inc. The terms say Healthspan itself does not provide health care services and is not licensed to practice medicine. Affiliated licensed providers prescribe, and the site says its providers do not address emergencies.",
      followThrough:
        "A membership that includes lab testing, PhD led health coaching, and a personalized protocol, with medications recommended separately by your clinician. Protocol pages describe ongoing dosing optimization and the ability to modify or cancel anytime.",
      format:
        "An online assessment, physician designed protocols, home delivery of medications, and a member portal at app.gethealthspan.com. Lab draws happen at a partner lab near you.",
      hardware:
        "No device. Blood is drawn at partner labs, and the pages reviewed do not describe wearable connections.",
      inputs:
        "Your intake, the BioAge+ panel with 25+ biomarkers across kidney, liver, metabolic, immune, and inflammatory systems, and the 70+ biomarkers the site says it tracks across 9 biological systems.",
      insightStyle:
        "BioAge+ results with clinical interpretation, a protocol built by a longevity expert, and coaching on nutrition, exercise, and sleep. The site says BioAge+ predicts mortality 11 percent more accurately than a standard 9 marker panel.",
      platforms:
        "Web portal. Healthspan serves all US states except New York, New Jersey, and Rhode Island, where lab ordering rules limit it, and it offers alternatives on request.",
      pricing:
        "Treatment prices are listed per month: The Rapamycin Protocol from $64, Metformin $27, Acarbose $25, LDN $40, Methylene Blue $99, Zepbound with ongoing care $299, and the Wegovy pill $149. The FAQ says membership covers labs, coaching, and the protocol with medications billed separately, but the pages reviewed do not publish a standalone membership price. Consult fees, if charged, are nonrefundable.",
      primaryJob:
        "Run a longevity clinic online, pairing prescription protocols with an included biomarker panel and coaching.",
    },
    competitorEvidence: {
      clinicalRole: [5, 6],
      followThrough: [2, 3],
      format: [1, 4],
      hardware: [1, 4],
      inputs: [1, 4],
      insightStyle: [1, 4],
      platforms: [1, 2],
      pricing: [1, 2, 6],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "The FAQ says lab testing, PhD led health coaching, and a personalized protocol, with medications available separately if your clinician recommends them. The BioAge+ page says the panel is included with membership. A standalone membership price is not on the pages reviewed.",
        question: "What does a Healthspan membership include?",
      },
      {
        answer:
          "No. Murph does not draw blood or run panels. You can upload the BioAge+ report and Murph will chart the markers, explain them plainly, and keep them next to your wearables and other labs.",
        question: "Can Murph replace the BioAge+ panel?",
      },
      {
        answer:
          "The FAQ says it serves all US states except New York, New Jersey, and Rhode Island because of lab ordering rules, and suggests contacting the team for alternatives. Murph works anywhere iMessage or Telegram does.",
        question: "Is Healthspan available where I live?",
      },
    ],
    headline:
      "Healthspan pairs prescriptions with an included biomarker panel. Murph connects those results to the rest of your life.",
    integration: "import",
    lastVerified: "2026-09-04",
    metaDescription:
      "Healthspan is a digital longevity clinic with rapamycin from $64 per month, GLP-1 care, and the BioAge+ panel. Murph is a personal health assistant that carries the plan between visits.",
    name: "Healthspan",
    quickComparison: [
      { capability: "Clinician prescribed protocols", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Included biomarker panel", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "PhD level performance coaching", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Works without dedicated hardware", competitor: "yes", evidence: "hardware", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "healthspan",
    sources: [
      { label: "Healthspan treatments and prices", url: "https://www.gethealthspan.com/" },
      { label: "Healthspan FAQ", url: "https://www.gethealthspan.com/faqs" },
      { label: "Healthspan rapamycin protocol", url: "https://www.gethealthspan.com/protocols/rapamycin" },
      { label: "Healthspan BioAge+ panel", url: "https://www.gethealthspan.com/bioage" },
      { label: "Healthspan privacy policy", url: "https://www.gethealthspan.com/policy/privacy-policy" },
      { label: "Healthspan terms and conditions", url: "https://www.gethealthspan.com/policy/terms-condition" },
    ],
    tradeoffs: [
      "Healthspan's treatment prices are clear, but the membership price that covers labs and coaching is not on the public pages, so ask before you sign up.",
      "Its lab ordering does not cover New York, New Jersey, or Rhode Island, and the pages reviewed describe no wearable connections.",
      "Murph offers no clinicians, prescriptions, coaches, or included lab panel. It works with results you bring in.",
    ],
    useTogether:
      "Let Healthspan run the BioAge+ panel and manage the prescription. Upload the results to Murph. Murph explains each marker, watches how your sleep, weight, and energy respond, and reminds you about refills and the next draw.",
  },
  {
    aliases: ["Marek", "Guided Optimization"],
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Marek Health if you want a US telehealth program with its own lab panels, a dedicated health coach, and partner physicians who can prescribe hormone, peptide, and other protocols.",
    chooseMurph:
      "Choose Murph if you want those labs and that protocol connected to your wearables, meals, symptoms, and records in one conversation, with reminders and health errands handled for you.",
    competitor: {
      clinicalRole:
        "Marek Health LLC says it is not a healthcare clinic and does not prescribe. It connects clients with partnered licensed providers through affiliated Marek Medical Groups, and those providers must approve any treatment. Services are elective and direct pay.",
      followThrough:
        "A Proactive Care Team with a health coach and a partnered provider, follow up labs at 6 to 12 weeks and then every six months, and email contact through your coach. Marek says it offers no set subscription plans and you can cancel whenever you want.",
      format:
        "Guided Optimization starts with a one on one video intake with a Marek health coach, then comprehensive lab work, then a provider consultation and a personalized protocol shipped to your door.",
      hardware:
        "No device. Marek requires its own customized lab panels rather than accepting prior lab work, with draws through partner labs. Marek Diagnostics separately sells self ordered panels at 2,000+ Quest locations.",
      inputs:
        "Your symptoms, history, and goals from the intake, plus Marek's own comprehensive panels with 5 to 14 day turnaround. Marek Diagnostics panels include an 80+ biomarker Total Health Panel at $595 and genetic tests such as APOE.",
      insightStyle:
        "Coach and provider interpretation of your labs, symptoms, and goals turned into a treatment protocol. The pages reviewed describe no app dashboard, scores, or wearable analysis.",
      platforms:
        "Web sign up and video conferencing with your coach, available in all 50 states with some treatments varying by state. Overseas US citizens with an APO box may be able to receive select items.",
      pricing:
        "Marek Health does not publish program prices. The payment at booking is a nonrefundable deposit toward the provider exam, web sales are final, and missed or late rescheduled appointments can incur a fee up to $50. Insurance is not accepted, and FSA or HSA payments often work.",
      primaryJob:
        "Combine custom lab work, one on one coaching, and partnered physicians into a personalized optimization protocol for people paying out of pocket.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 3],
      followThrough: [1, 2],
      format: [1, 2],
      hardware: [2, 5],
      inputs: [2, 5],
      insightStyle: [1, 2],
      platforms: [1, 2],
      pricing: [1, 2, 4],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "The public pages do not publish program prices. The cancellation policy says the amount paid at booking is a nonrefundable deposit toward the provider exam, and the FAQ says there are no set subscription plans. Ask Marek for a quote before booking. Murph publishes its pricing and starts free.",
        question: "How much does Marek Health cost?",
      },
      {
        answer:
          "The FAQ says Marek requires its own customized panels rather than accepting prior lab work. Murph accepts results from any lab, including Marek's, by upload or paste.",
        question: "Can I bring my own labs to Marek Health?",
      },
      {
        answer:
          "No. Murph does not prescribe or run labs and has no coaches or physicians. It can keep Marek's results and protocol next to your wearables and daily logs and help you follow through.",
        question: "Does Murph offer hormone or peptide protocols?",
      },
    ],
    headline:
      "Marek Health pairs its own labs with a coach and a prescriber. Murph carries the protocol into daily life.",
    integration: "import",
    lastVerified: "2026-09-04",
    metaDescription:
      "Marek Health is a US telehealth optimization program with custom labs, a health coach, and partner physicians. Murph is a personal health assistant that keeps those results in daily context.",
    name: "Marek Health",
    quickComparison: [
      { capability: "Physician partnered treatment", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Dedicated human health coach", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Custom diagnostic lab panels", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "Hormone and peptide protocols", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Works without dedicated hardware", competitor: "yes", evidence: "hardware", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "marek-health",
    sources: [
      { label: "Marek Health overview and Guided Optimization", url: "https://marekhealth.com/" },
      { label: "Marek Health FAQ", url: "https://marekhealth.com/faqs" },
      { label: "Marek Health privacy policy", url: "https://marekhealth.com/privacy-policy" },
      { label: "Marek Health cancellation and refund policy", url: "https://marekhealth.com/cancellation-refund-policy" },
      { label: "Marek Diagnostics self ordered labs", url: "https://marekdiagnostics.com/" },
    ],
    tradeoffs: [
      "Marek does not publish prices, requires its own lab panels, and treats the booking payment as a nonrefundable deposit, so the total cost is only clear once you are inside the program.",
      "It is direct pay only. Marek does not communicate with insurers and cannot supply CPT or ICD-10 codes.",
      "Murph has no coach, no physician network, and no lab panels of its own. It works with the results and protocol you bring in.",
    ],
    useTogether:
      "Use Marek Health for the labs, the coach, and the provider approved protocol. Upload the panels to Murph. Murph explains the markers, tracks how training, sleep, and symptoms respond, and reminds you about the 6 to 12 week follow up draw.",
  },
  {
    aliases: ["Vitality AI Health", "Vaya Chat"],
    category: "health-data",
    chooseCompetitor:
      "Choose Vidaya if you want a $10 per month dashboard that pulls eight wearables, lab PDFs, DNA, DEXA, and CGM data into one healthspan score with a chat you can question.",
    chooseMurph:
      "Choose Murph if you want the same data read inside an ongoing conversation in iMessage or Telegram, with reminders, health errands, records, and personal experiments, starting free.",
    competitor: {
      clinicalRole:
        "Vidaya LLC says its insights are for informational purposes only and are not medical advice, and its terms describe AI coaching that does not replace professional recommendations. The privacy policy says it handles US data in line with HIPAA where applicable.",
      followThrough:
        "A dashboard that shows your healthspan score, biological age, and what to do next, plus challenges and leaderboards across connected devices. The pages reviewed do not describe reminders, errand help, or human coaching.",
      format:
        "A web dashboard with iOS and Android apps. Sections cover blood tests, DEXA scans, DNA analysis, supplements, medications, nutrition, and integrations, and Vaya Chat answers questions about your own data.",
      hardware:
        "No proprietary device. Vidaya connects Apple Watch, Oura, WHOOP, Garmin, Fitbit, Google Fit, Polar, and Withings.",
      inputs:
        "Wearable data from eight named devices, uploaded lab PDFs scored against optimal zones, 23andMe DNA files, DEXA scans, and CGM data from Dexcom and Levels, plus medications and symptoms.",
      insightStyle:
        "A healthspan score, a biological age, lab values graded against optimal rather than normal ranges, and a chat limited to 400 messages per month.",
      platforms:
        "Web, an iOS app whose App Store listing still carries the Vitality AI Health name, and an Android app on Google Play.",
      pricing:
        "$10 per month or $89 per year with a 30 day money back guarantee, per the homepage. The terms say there is no free tier, subscriptions renew automatically, and refunds are otherwise limited to service failures or billing errors.",
      primaryJob:
        "Consolidate wearables, labs, DNA, and scans into one healthspan dashboard you can question in chat.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 3],
      followThrough: [1],
      format: [1, 4],
      hardware: [1],
      inputs: [1, 2],
      insightStyle: [1, 3],
      platforms: [1, 4, 5],
      pricing: [1, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Vidaya is a dashboard first. It scores your data, grades labs against optimal zones, and lets you ask a chat about it, with a 400 message monthly cap. Murph is a conversation first, in iMessage or Telegram, and adds reminders, errands, records, and experiments. Both read the major wearables.",
        question: "How is Vidaya different from Murph?",
      },
      {
        answer:
          "Yes. The homepage says Vidaya was formerly Vitality AI Health, and the App Store and Google Play listings still use the old name and package id.",
        question: "Is Vidaya the same app as Vitality AI Health?",
      },
      {
        answer:
          "No. The terms say there is no free tier. Pricing is $10 per month or $89 per year with a 30 day money back guarantee. Murph starts free without a card.",
        question: "Does Vidaya have a free plan?",
      },
    ],
    headline:
      "Vidaya scores your health in one dashboard. Murph talks it through with you and acts on it.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Vidaya is a $10 per month dashboard that scores wearables, labs, DNA, and DEXA data with a chat. Murph is a personal health assistant that works in iMessage or Telegram and starts free.",
    name: "Vidaya",
    quickComparison: [
      { capability: "Composite healthspan score", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "DNA and DEXA uploads", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Challenges and leaderboards", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Visual data dashboard", competitor: "yes", evidence: "format", murph: "limited" },
      { capability: "Wearable and lab context", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works on iPhone and Android", competitor: "yes", evidence: "platforms", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "vidaya",
    sources: [
      { label: "Vidaya overview, integrations, and pricing", url: "https://vidaya.ai/" },
      { label: "Vidaya privacy policy", url: "https://vidaya.ai/privacy-policy" },
      { label: "Vidaya terms of service", url: "https://vidaya.ai/terms-of-service" },
      { label: "Vitality AI Health App Store listing", url: "https://apps.apple.com/us/app/vitalityaihealth/id6756726183" },
      { label: "Vitality AI Health Google Play listing", url: "https://play.google.com/store/apps/details?id=com.vitalityaihealth" },
    ],
    tradeoffs: [
      "Vidaya's healthspan score and optimal range grading make a lot of data scannable, but they are Vidaya's own models, and the company says the output is informational rather than medical.",
      "Vidaya's chat is capped at 400 messages a month, there is no free tier, and the app stores still show the old Vitality AI Health branding.",
      "Murph has no composite healthspan score, no leaderboards, and no DNA file analysis. It uses a web account for review but works mainly through conversation.",
    ],
  },
]);
