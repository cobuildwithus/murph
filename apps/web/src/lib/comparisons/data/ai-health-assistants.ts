import { defineComparisons } from "../types";

export const AI_HEALTH_ASSISTANT_COMPARISONS = defineComparisons([
  {
    aliases: ["ChatGPT"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose ChatGPT Health if you already use ChatGPT for everything else and want it to read your Apple Health data, US medical records, One Medical, or Function Health results inside the same app.",
    chooseMurph:
      "Choose Murph if you want a health-only assistant in iMessage or Telegram that reads your wearables, labs, meals, and symptoms together, then follows through with reminders, health errands, and personal experiments.",
    competitor: {
      clinicalRole:
        "OpenAI says Health supports, not replaces, medical care and is not intended for diagnosis or treatment. Physicians tested the feature before release, and OpenAI still tells people to verify important information with their own provider.",
      followThrough:
        "The Health pages describe appointment prep, summaries of what changed since a visit, suggested prompts, and permission checks before ChatGPT shares health data through another connected plugin. They do not describe scheduling, refills, or paperwork done on your behalf.",
      format:
        "A Health area in the ChatGPT sidebar that stores connected accounts, recent data and trends, synced records, and past health conversations. Once connected, health context can also be used in ordinary chats, or called explicitly with @Health.",
      hardware:
        "No device is required. Apple Health connection needs an iPhone, and wearable, fitness, or nutrition apps reach ChatGPT only through what they share into Apple Health; some proprietary scores may not transfer.",
      inputs:
        "Apple Health data, medical records from supported US hospital systems through b.well, One Medical, and Function Health, plus conditions, medications, and family history you review and edit. The January launch also named MyFitnessPal as a connectable wellness app.",
      insightStyle:
        "Conversational answers grounded in connected data: comparing a new result with prior tests, summarizing changes since the last appointment, explaining a visit note, or relating sleep and activity to a routine. Paid plans use GPT-5.6 Sol, which OpenAI describes as its strongest health model.",
      platforms:
        "Health rolled out to logged-in US users 18 and older on web and iOS in July 2026, and is not available in Codex. The ChatGPT App Store listing covers iPhone, iPad, and an iMessage app. OpenAI publishes some open-weight models, but ChatGPT Health itself is a hosted service.",
      pricing:
        "Health is included on the Free, Go, Plus, and Pro plans at no extra charge. The pricing page reviewed lists the plan tiers without stating dollar amounts in its text and notes that the Go plan may include ads.",
      primaryJob:
        "Bring a person's scattered health information into ChatGPT so health questions, meal and exercise planning, and appointment prep can use their own records and Apple Health data.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [1],
      format: [1, 2],
      hardware: [1, 2],
      inputs: [1, 2, 3],
      insightStyle: [1],
      platforms: [1, 5],
      pricing: [1, 4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "Indirectly. ChatGPT connects to Apple Health on iPhone, and any wearable or fitness app that shares data into Apple Health can reach it that way. OpenAI notes that available fields vary by app and that some proprietary scores may not transfer. Murph offers direct connections to WHOOP, Oura, Garmin, Fitbit, Dexcom, and many other devices, plus Apple Health and Health Connect.",
        question: "Does ChatGPT Health connect to wearables?",
      },
      {
        answer:
          "OpenAI says connected medical records, Apple Health information, and conversations that use them are not used to train its foundation models or target ads, regardless of the training setting you choose. Its Health Privacy Notice adds that a limited number of authorized staff or service providers may access this data to improve safety unless you opt out.",
        question: "Is my health data used to train OpenAI models?",
      },
      {
        answer:
          "ChatGPT Health adds records and Apple Health context to a general assistant that also writes, codes, and plans trips, and it lives in the ChatGPT app. Murph is a health-only assistant in iMessage or Telegram that connects wearables directly, logs meals and symptoms, runs personal experiments, sets reminders, and handles practical health errands. Neither diagnoses or treats.",
        question: "How is ChatGPT Health different from Murph?",
      },
    ],
    headline:
      "ChatGPT Health adds your records to a general assistant. Murph is a health assistant that follows through in your messages.",
    lastVerified: "2026-09-04",
    metaDescription:
      "ChatGPT Health links Apple Health and US medical records to ChatGPT on every plan. Murph is a personal health assistant in iMessage or Telegram with wearables, labs, and errands.",
    name: "ChatGPT Health",
    quickComparison: [
      { capability: "Records and lab connectors", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Apple Health sync", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Trend and record dashboard", competitor: "yes", evidence: "format", murph: "limited" },
      { capability: "Everyday non health tasks", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "limited", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "chatgpt-health",
    sources: [
      { label: "Launching Health in ChatGPT", url: "https://openai.com/index/health-in-chatgpt/" },
      { label: "Introducing ChatGPT Health", url: "https://openai.com/index/introducing-chatgpt-health/" },
      { label: "OpenAI Health Privacy Notice", url: "https://openai.com/policies/health-privacy-policy/" },
      { label: "ChatGPT pricing", url: "https://openai.com/chatgpt/pricing/" },
      { label: "ChatGPT App Store listing", url: "https://apps.apple.com/us/app/chatgpt/id6448311069" },
    ],
    tradeoffs: [
      "ChatGPT Health reaches into US hospital records, One Medical, and Function Health, and it sits inside an assistant many people already open daily. Murph's records path is narrower: an Epic import in beta plus uploads and pasted results.",
      "Wearables reach ChatGPT only through Apple Health on an iPhone, so Android users and people who want direct device connections get less. Murph connects WHOOP, Oura, Garmin, Fitbit, Dexcom, and dozens more directly.",
      "Health is US only, 18 and older, and unavailable in Codex, and OpenAI says ChatGPT can still make mistakes. Murph does not offer ChatGPT's trend dashboard or its general-purpose help with non-health tasks.",
    ],
    useTogether:
      "Keep ChatGPT Health for records-grounded questions inside ChatGPT, and use Murph for the daily loop in iMessage or Telegram: wearable check-ins, meal and symptom logging, experiments, reminders, and errands. No connection between the two is documented.",
  },
  {
    aliases: ["Claude by Anthropic"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Claude if you want one general assistant for work and life that can also, on a US Pro or Max plan, read your HealthEx records, Function labs, Apple Health, or Health Connect data and explain them in plain language.",
    chooseMurph:
      "Choose Murph if you want a health-only assistant that lives in iMessage or Telegram, connects your wearables and glucose monitors directly, logs meals and symptoms, and follows through with reminders, errands, and personal experiments.",
    competitor: {
      clinicalRole:
        "Anthropic describes the consumer health integrations as a way to understand health information and prepare for conversations with clinicians. It says Claude includes contextual disclaimers, acknowledges uncertainty, and directs people to healthcare professionals for personalized guidance.",
      followThrough:
        "The announcement describes summarizing medical history, explaining test results, detecting patterns across fitness and health metrics, and preparing questions for appointments. Scheduling, refills, reminders, and check-ins are not described for the health integrations, although Gmail and Google Calendar connectors exist.",
      format:
        "A general-purpose chat assistant on web, iOS, Android, and desktop with memory across conversations. Health data arrives through connectors a person opts into, then Claude discusses it in ordinary chat.",
      hardware:
        "No device is required. Apple Health and Android Health Connect integrations run through the Claude iOS and Android apps, so wearables that sync to those platforms can contribute data.",
      inputs:
        "Lab results and health records through HealthEx and Function connectors, plus Apple Health and Android Health Connect data, all in beta for US Pro and Max subscribers when announced in January 2026. Claude also accepts uploaded photos, PDFs, and screenshots and connects Google Drive, Gmail, and Calendar. Health app consent can be withdrawn in Settings.",
      insightStyle:
        "Plain-language summaries and explanations with an emphasis on uncertainty and referral to professionals. Anthropic says Claude can detect patterns across fitness and health metrics, but the pages do not describe structured personal experiments or a health dashboard.",
      platforms:
        "Web, iOS, Android, Mac and Windows desktop apps, and Chrome. The App Store rates the app 18 plus. No iMessage, Telegram, or self-hosted option is documented for the consumer product.",
      pricing:
        "Free plan at $0. Pro is $17 per month billed annually ($200 up front) or $20 monthly. Max starts at $100 per month for 5x or 20x Pro usage. Health connectors were announced for Pro and Max subscribers in the US.",
      primaryJob:
        "Serve as a general thinking partner for writing, research, coding, and everyday questions, with optional health connectors that let it explain a person's own records and metrics.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 6],
      format: [3, 6],
      hardware: [1],
      inputs: [1, 2, 4, 5, 6],
      insightStyle: [1],
      platforms: [3, 6],
      pricing: [1, 3],
      primaryJob: [1, 6],
    },
    faqs: [
      {
        answer:
          "Yes, within limits. Anthropic announced HealthEx and Function connectors for records and labs, and Apple Health and Android Health Connect integrations through the mobile apps, all in beta for US Pro and Max subscribers. Wearables reach Claude through those two platform layers rather than direct device connections. Murph connects WHOOP, Oura, Garmin, Dexcom, and dozens of others directly, plus Apple Health and Health Connect.",
        question: "Does Claude connect to wearables and lab results?",
      },
      {
        answer:
          "Anthropic says it does not use users' health data to train models, that health integrations require explicit opt-in, and that you can disconnect or edit permissions at any time. Its consumer health data privacy policy adds that consent for third-party health integrations can be revoked in Settings.",
        question: "Is Claude's health data used for training?",
      },
      {
        answer:
          "Only for the health part. Claude is a general assistant for writing, research, coding, and files, and Murph does not attempt that. For health specifically, Murph adds direct device connections, meal and symptom logging, personal experiments, reminders, errands, and delivery in iMessage or Telegram. Neither product diagnoses or treats.",
        question: "Can Murph replace Claude?",
      },
    ],
    headline:
      "Claude is a general assistant with health connectors on paid plans. Murph is a health assistant built for follow through.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Claude is a general assistant whose US Pro and Max plans read HealthEx, Function, and Apple Health data. Murph is a personal health assistant that follows through in your messages.",
    name: "Claude",
    quickComparison: [
      { capability: "Lab and records connectors", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Apple Health and Health Connect", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Everyday non health tasks", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Desktop and web apps", competitor: "yes", evidence: "platforms", murph: "limited" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "claude",
    sources: [
      { label: "Anthropic healthcare announcement", url: "https://www.anthropic.com/news/healthcare-life-sciences" },
      { label: "Claude for healthcare", url: "https://claude.com/solutions/healthcare" },
      { label: "Claude pricing", url: "https://claude.com/pricing" },
      { label: "Anthropic privacy policy", url: "https://www.anthropic.com/legal/privacy" },
      { label: "Anthropic consumer health data privacy policy", url: "https://www.anthropic.com/legal/consumer-health-data-privacy-policy" },
      { label: "Claude App Store listing", url: "https://apps.apple.com/us/app/claude-by-anthropic/id6473753684" },
    ],
    tradeoffs: [
      "Claude's health connectors cover records, labs, Apple Health, and Health Connect, but they were announced in beta for US Pro and Max subscribers, so the free tier gets none of them. Murph's records path is an Epic import in beta plus uploads.",
      "Claude does everything else too, from documents to code, and Murph does not. If you want one assistant for work and health, Claude wins on breadth.",
      "Claude's device data comes through Apple Health or Health Connect rather than direct WHOOP, Oura, Garmin, or Dexcom connections, and there is no iMessage, Telegram, or self-hosted option. Murph does not match Claude's desktop apps or general-purpose breadth.",
    ],
    useTogether:
      "Keep Claude for general work and for explaining a record you have connected there. Use Murph as the daily health loop in iMessage or Telegram, with direct device connections, meal and symptom logs, reminders, and errands. No link between the two is documented.",
  },
  {
    aliases: ["Microsoft Copilot"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Copilot Health if you already pay for Microsoft 365 Personal, Family, or Premium, live in the US, and want health records from US providers, Apple Health data, insight cards, and a provider search inside Copilot.",
    chooseMurph:
      "Choose Murph if you want a health assistant that works on any phone through iMessage or Telegram, connects wearables directly, starts free, and follows through with reminders, health errands, and personal experiments.",
    competitor: {
      clinicalRole:
        "Microsoft says Copilot Health is not intended to diagnose, treat, or prevent disease and is not a substitute for professional medical advice. It was developed with an internal clinical team and an external panel of more than 250 physicians, and the service holds ISO/IEC 42001 certification.",
      followThrough:
        "Copilot Health prepares people for appointments, shows insight cards that can suggest a small action for the week or a follow-up on an earlier conversation, and finds local providers by specialty, language, gender, insurance, and location. It does not book, refill, or handle paperwork.",
      format:
        "A dedicated Health space inside Microsoft Copilot with a Health Profile, a personal homepage of insight cards, and conversations kept separate from the rest of Copilot. Connectors add wearable and record data.",
      hardware:
        "No device is required. Wearable connections start with Apple Health, with more sources promised, so a wearable that syncs to Apple Health can contribute sleep and activity trends.",
      inputs:
        "A Health Profile you build in chat, Apple Health data, health records from more than 50,000 US provider organizations, prior Copilot conversations you choose to import once, and your questions. Connected data is accessed during conversations rather than stored in Copilot Health.",
      insightStyle:
        "Personalized insights informed by your profile and connected data, follow-up questions, and guidance sourced from health organizations selected under National Academy of Medicine principles plus Harvard Health content. Insight cards surface trends such as sleep.",
      platforms:
        "Rolling out on the web, the Copilot app for Windows, and the Copilot iOS app; Microsoft says it is not on Android yet. In September 2026 the FAQ said Copilot Health was temporarily unavailable for some users while its features moved into the updated Copilot app.",
      pricing:
        "Copilot Health is in preview for Microsoft 365 Personal, Family, and Premium subscribers who are 18 or older in the US; work accounts are not eligible. No separate health fee is listed, and the pages reviewed do not state the Microsoft 365 subscription prices.",
      primaryJob:
        "Bring health records, wearable data, and a health profile into one private Copilot space so people can understand symptoms and lab results, spot trends, and prepare for care.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [1, 2],
      format: [1, 2],
      hardware: [1, 2],
      inputs: [1, 2, 3],
      insightStyle: [1, 2],
      platforms: [2, 4],
      pricing: [1, 2],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "Yes, when reviewed. Microsoft says the preview is open to Microsoft 365 Personal, Family, and Premium subscribers who are 18 or older in the US, and work accounts are not eligible. Murph starts free without a card.",
        question: "Do I need Microsoft 365 to use Copilot Health?",
      },
      {
        answer:
          "Microsoft says no. Copilot Health conversations are not shared with the rest of Copilot, are not used to train AI models, and are not used for advertising, and health data is not sold. Conversation activity is stored for 18 months by default and can be deleted at any time.",
        question: "Is my Copilot Health data used to train AI or for ads?",
      },
      {
        answer:
          "Not directly, according to the FAQ. Copilot Health runs on the web, Windows, and iOS, and its wearable connections start with Apple Health, so a device must sync into Apple Health to contribute. Murph runs in iMessage or Telegram on any phone and connects Garmin, WHOOP, Oura, Fitbit, and Health Connect directly.",
        question: "Can I use Copilot Health on Android or with a Garmin or WHOOP?",
      },
    ],
    headline:
      "Copilot Health brings records and Apple Health into Microsoft 365. Murph follows through on any phone.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Copilot Health is a Microsoft 365 preview that reads US health records and Apple Health data. Murph is a personal health assistant in iMessage or Telegram with direct device connections.",
    name: "Copilot Health",
    quickComparison: [
      { capability: "Health records connection", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Apple Health sync", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Care provider directory", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Proactive insight cards", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "copilot-health",
    sources: [
      { label: "Copilot Health preview announcement", url: "https://www.microsoft.com/en-us/microsoft-copilot/blog/2026/05/29/copilot-health-now-in-preview/" },
      { label: "About Copilot Health support FAQ", url: "https://support.microsoft.com/en-us/microsoft-copilot/copilot-health" },
      { label: "Microsoft Privacy Statement", url: "https://www.microsoft.com/privacy/privacystatement" },
      { label: "Microsoft Copilot App Store listing", url: "https://apps.apple.com/us/app/microsoft-copilot/id541164041" },
    ],
    tradeoffs: [
      "Copilot Health's record connections span more than 50,000 US provider organizations and its provider search filters by insurance, both of which Murph does not offer. Murph's records path is an Epic import in beta plus uploads.",
      "Copilot Health requires a paid Microsoft 365 consumer plan, is US and iOS or web only, and was partly paused in September 2026 while Microsoft moved it into a new app. Murph starts free and runs in iMessage or Telegram on any phone.",
      "Wearables reach Copilot Health only through Apple Health for now. Murph connects WHOOP, Oura, Garmin, Fitbit, Dexcom, and others directly, but it has no insight-card homepage or provider directory.",
    ],
    useTogether:
      "Use Copilot Health for record-grounded questions and provider search inside Microsoft 365, then use Murph for the daily loop in your messages: wearable check-ins, meals, symptoms, reminders, and errands. No connection between the two is documented.",
  },
  {
    aliases: ["One Medical", "Amazon Health AI"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Amazon One Medical if you want an actual primary care practice with offices, 24/7 video and message care, prescriptions, and a Health AI in the app that reads your One Medical records and books your visits.",
    chooseMurph:
      "Choose Murph for the space between visits: a health assistant in iMessage or Telegram that reads your wearables, labs, meals, and symptoms, runs personal experiments, and handles reminders and health errands, without replacing your doctor.",
    competitor: {
      clinicalRole:
        "One Medical is a membership-based primary care practice with licensed providers, offices in many US cities, and 24/7 virtual care. The Health AI assistant is designed to complement providers, hands off to the care team when clinical judgment is needed, and its conversations are not automatically added to the medical record.",
      followThrough:
        "Health AI books same or next day appointments, requests prescription renewals that can be filled through Amazon Pharmacy, routes people to messaging, video, or in-person care, and coaches members on their care plan. The app also sends visit reminders and service recommendations.",
      format:
        "A primary care practice delivered through the One Medical app: scheduling, secure messages, records and care plans, on-demand Treat Me Now and Urgent Video Chat, and a Health AI assistant available to all members since January 2026.",
      hardware:
        "No device is required. The App Store listing says the app can sync data with Apple Health.",
      inputs:
        "Complete One Medical medical records, lab results, current medications, vaccinations, and visit history, plus the questions you ask. The public pages do not describe reading outside wearable data beyond the Apple Health sync.",
      insightStyle:
        "Personalized explanations grounded in the member's own records: what a lab result means, which care option fits a symptom, and what to do next, with clinical safeguards that escalate to a human when needed. Powered by models on Amazon Bedrock.",
      platforms:
        "iPhone app rated 16 plus, plus web login. The App Store listing says only members can use the app. No Android listing was reviewed and no self-hosted option exists.",
      pricing:
        "Membership is $9 per month or $99 per year for Prime members, $66 per year for each additional family member, or $199 per year without Prime. Scheduled visits are billed to you or your insurance; on-demand virtual care is included. Non-members can pay $29 for a message visit or $49 for a video visit.",
      primaryJob:
        "Deliver ongoing primary care, urgent virtual care, and prescriptions through one practice, with an AI assistant that helps members understand their records and get to the right care faster.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 3],
      followThrough: [1, 4],
      format: [1, 4],
      hardware: [4],
      inputs: [1, 4],
      insightStyle: [1],
      platforms: [4],
      pricing: [1, 2, 3],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. Amazon says the assistant explains records and labs, answers questions, and helps choose care, then connects you to One Medical providers when clinical judgment is needed. Prescriptions and diagnoses come from the licensed care team, often through a same or next day appointment the assistant books.",
        question: "Does Amazon One Medical's Health AI diagnose or prescribe?",
      },
      {
        answer:
          "Yes. The App Store listing says only One Medical members can access the app, and Amazon says the Health AI is live for all members. Membership was $9 per month or $99 per year with Prime, or $199 per year without Prime, when reviewed. Murph starts free.",
        question: "Do I need a membership to use the Health AI?",
      },
      {
        answer:
          "No. One Medical is a medical practice with clinicians, offices, prescriptions, and labs, and Murph provides none of that. Murph fits alongside it as the daily assistant that reads your wearables and meals, keeps your records and labs in one place, and handles reminders and errands between visits.",
        question: "Can Murph replace One Medical?",
      },
    ],
    headline:
      "Amazon One Medical is a doctor's office with an AI inside. Murph is the assistant between visits.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Amazon One Medical pairs primary care, prescriptions, and 24/7 virtual visits with a Health AI. Murph is a personal health assistant in iMessage or Telegram for everything between visits.",
    name: "Amazon One Medical",
    quickComparison: [
      { capability: "Primary care visits", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Prescription renewals", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "In person offices", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Lab results explained", competitor: "yes", evidence: "insightStyle", murph: "yes" },
      { capability: "Handles health errands", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Apple Health sync", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "amazon-one-medical",
    sources: [
      { label: "Amazon One Medical Health AI announcement", url: "https://www.aboutamazon.com/news/retail/one-medical-ai-health-assistant" },
      { label: "One Medical with Prime", url: "https://health.amazon.com/prime" },
      { label: "One Medical membership", url: "https://www.onemedical.com/membership/" },
      { label: "One Medical App Store listing", url: "https://apps.apple.com/us/app/one-medical/id393507802" },
    ],
    tradeoffs: [
      "One Medical's assistant sits inside a real practice: it books visits, renews prescriptions, and hands off to clinicians who can treat you. Murph cannot book inside a clinic system, prescribe, or provide care.",
      "One Medical requires a paid membership and centers on its own records; the pages reviewed do not describe reading outside wearables beyond Apple Health sync. Murph connects dozens of devices directly and starts free.",
      "The Health AI is iPhone app based for members in the US. Murph has no offices, no clinicians, and no composite dashboard, but it works in iMessage or Telegram.",
    ],
    useTogether:
      "Keep One Medical for care, prescriptions, and its Health AI grounded in your chart. Use Murph to carry wearable trends, meals, symptoms, and questions between visits, and to prepare what you want to raise at the next one. No connection between the two is documented.",
  },
  {
    aliases: ["AskMD by Sharecare"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose AskMD if your main need is turning a health question into a next step inside the US system: in-network doctors, coverage and cost checks, connected records, and rewards for following through, all free.",
    chooseMurph:
      "Choose Murph if you want an ongoing assistant in iMessage or Telegram that reads your wearables, labs, meals, and symptoms together, tests what works for you, and handles reminders and health errands over time.",
    competitor: {
      clinicalRole:
        "Sharecare says AskMD does not diagnose, prescribe, or replace a clinician. Clinical standards, safety controls, and escalation pathways decide when to hand someone to a healthcare professional, and its education content is NCQA-accredited. The web app notes that AskMD uses AI and may make mistakes.",
      followThrough:
        "AskMD organizes history, concerns, questions, and next steps into a portable summary for appointments, matches people to in-network doctors, and rewards healthy actions such as connecting records or completing a follow-up visit with Bilt Rewards points. Reminders and check-ins are not described.",
      format:
        "A question-first navigation app: describe a symptom or worry in plain language, get guidance, then see doctors, coverage, and cost options. It also includes the RealAge assessment and Sharecare's health library.",
      hardware:
        "No device is required. The App Store listing documents an Apple Health connection, and the launch announcement mentions wearables among connectable sources.",
      inputs:
        "Your question, medical records connected after CLEAR identity verification, health plan eligibility and payer data, Apple Health, location, and RealAge answers. The announcement also lists labs and wearables as connectable sources.",
      insightStyle:
        "Evidence-based guidance grounded in your history and coverage, with insurance-aware doctor matching and cost visibility for prescriptions and procedures in and out of network. Sharecare describes a multi-model architecture with clinical safety controls.",
      platforms:
        "iPhone and iPad app rated 13 plus, Google Play, and the web, plus a listing in the Medicare App Library. Launched nationwide in the US in August 2026. No messaging-app or self-hosted option is documented.",
      pricing:
        "Free on the App Store, Google Play, and the web when reviewed. Sharecare's privacy policy notes its services may also be offered through employers, health plans, or other sponsors.",
      primaryJob:
        "Turn any health question into a personalized plan: understand what is happening, decide whether to self-treat or see someone, and find the right in-network doctor with the cost known in advance.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [1, 4],
      format: [1, 4],
      hardware: [1, 4],
      inputs: [1, 4],
      insightStyle: [1, 4],
      platforms: [1, 4],
      pricing: [1, 3, 4],
      primaryJob: [1, 2, 4],
    },
    faqs: [
      {
        answer:
          "Yes, with your permission. Sharecare says you verify your identity through CLEAR, then connect medical records and health plan details so guidance, doctor matches, and cost estimates reflect your coverage. The App Store listing also documents an Apple Health connection.",
        question: "Does AskMD connect to my medical records and insurance?",
      },
      {
        answer:
          "Yes. Sharecare says AskMD is free on the App Store, Google Play, and the web, and it is listed in the Medicare App Library. The web app notes that AskMD uses AI and may make mistakes. Murph also starts free without a card.",
        question: "Is AskMD free?",
      },
      {
        answer:
          "AskMD is built for navigation inside the US system: which doctor, what your plan covers, what it costs, and a summary to bring to the visit. Murph is built for the long stretch between visits: wearables, meals, symptoms, labs, experiments, reminders, and errands in iMessage or Telegram. Neither diagnoses or prescribes.",
        question: "How is AskMD different from Murph?",
      },
    ],
    headline:
      "AskMD turns a question into an in-network next step. Murph keeps the rest of your health moving.",
    lastVerified: "2026-09-04",
    metaDescription:
      "AskMD is Sharecare's free navigator for in-network doctors, coverage, and costs. Murph is a personal health assistant in iMessage or Telegram for daily follow through between visits.",
    name: "AskMD",
    quickComparison: [
      { capability: "In network doctor matching", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Health plan coverage lookup", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Health records connection", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Wearable and lab context", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "askmd",
    sources: [
      { label: "Sharecare AskMD nationwide launch", url: "https://about.sharecare.com/press-releases/sharecare-launches-askmd-nationwide-to-turn-any-health-question-into-a-personalized-plan/" },
      { label: "AskMD web app", url: "https://askmd.sharecare.com/" },
      { label: "Sharecare privacy policy", url: "https://www.sharecare.com/terms/privacypolicy" },
      { label: "AskMD App Store listing", url: "https://apps.apple.com/us/app/askmd-smart-health-guidance/id739298964" },
    ],
    tradeoffs: [
      "AskMD's insurance-aware doctor matching and cost visibility have no equivalent in Murph, and its records connection through CLEAR is broader than Murph's Epic import in beta.",
      "AskMD centers on the moment of a question and a next step; its pages do not describe reminders, check-ins, meal or symptom logging, or personal experiments over time.",
      "AskMD launched nationwide only in August 2026, so wearable connections beyond Apple Health are described in the announcement but not yet detailed in the app listing. Murph has no provider network, coverage data, or rewards program.",
    ],
    useTogether:
      "Use AskMD when you need a doctor, a coverage check, or a cost estimate. Bring the result to Murph and let it hold the follow-up: reminders, questions for the visit, and the wearable, meal, and symptom context around it. No connection between the two is documented.",
  },
  {
    category: "health-assistants",
    chooseCompetitor:
      "Choose Doctronic if you want a free, anonymous AI consult that ends in a clinical note, with a $39 video visit from a licensed US physician who can prescribe when you need more than answers.",
    chooseMurph:
      "Choose Murph if you want an ongoing health assistant in iMessage or Telegram that connects your wearables, logs meals and symptoms, and follows through with reminders, health errands, and personal experiments.",
    competitor: {
      clinicalRole:
        "Doctronic says its AI is not a licensed doctor, does not practice medicine, and does not provide medical advice or patient care. Licensed US physicians are available in all 50 states and DC for video visits and can prescribe, order tests, and refer.",
      followThrough:
        "Each consult produces a free SOAP note to bring to any doctor. Doctronic offers on-demand or scheduled video visits, prescription renewals, specialist referrals, and, with a free account, a lifelong record; the App Store listing also mentions medication reminders and lab coordination.",
      format:
        "A chat with an AI doctor that asks questions and returns a treatment plan and clinical note, available on the web and in an iPhone app, with a one-tap handoff to a human physician by video.",
      hardware:
        "No device is required. The privacy notice lists Apple HealthKit data such as heart rate, blood pressure, sleep, and activity among data the service can collect.",
      inputs:
        "Your symptoms and answers, Apple HealthKit data, prescription history through Surescripts, and medical records retrieved through TEFCA and Carequality after CLEAR identity verification for account holders. Anonymous consults need none of this.",
      insightStyle:
        "A structured assessment with likely explanations, a treatment plan, and a SOAP note, grounded in what Doctronic calls peer-reviewed research. It claims more than 25 million AI consults and describes itself as clinically validated.",
      platforms:
        "Web and an iPhone app rated 18 plus. Physician visits are available in all 50 US states and DC. No Android listing, messaging-app delivery, or self-hosted option is documented.",
      pricing:
        "AI consults, specialist referrals, and the health record are free. Video visits with a physician are $39 per visit or your insurance copay, with no subscription; prescription renewals start as low as $0. FSA and HSA are accepted.",
      primaryJob:
        "Give people a free AI medical consult with a shareable clinical note, then connect them to a licensed physician quickly and cheaply when treatment or a prescription is needed.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 4],
      followThrough: [1, 4],
      format: [1, 2, 4],
      hardware: [3],
      inputs: [3, 4],
      insightStyle: [1, 2],
      platforms: [1, 4],
      pricing: [1, 4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "The chat is an AI. Doctronic says it is not a licensed doctor, does not practice medicine, and does not give medical advice. After a chat you can book a video visit with a licensed US physician for $39 or your copay, and that physician can prescribe, order tests, and refer.",
        question: "Is Doctronic a real doctor?",
      },
      {
        answer:
          "For account holders, yes. The privacy notice documents medical records retrieved through TEFCA and Carequality after CLEAR identity verification, prescription history through Surescripts, and Apple HealthKit data. The free anonymous consult does not require any of it.",
        question: "Does Doctronic connect to my records or Apple Health?",
      },
      {
        answer:
          "Doctronic is a consult: describe symptoms, get a plan and a note, and escalate to a physician. Murph is an ongoing assistant in iMessage or Telegram that reads wearables, meals, labs, and symptoms over time, runs personal experiments, and handles reminders and errands. Murph offers no physicians or prescriptions.",
        question: "How is Doctronic different from Murph?",
      },
    ],
    headline:
      "Doctronic is a free AI consult with a $39 doctor behind it. Murph is the assistant you keep talking to.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Doctronic pairs free anonymous AI doctor chats and a clinical note with $39 licensed physician visits. Murph is a personal health assistant in iMessage or Telegram for daily follow through.",
    name: "Doctronic",
    quickComparison: [
      { capability: "Licensed doctor video visits", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Medication renewals", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Shareable visit summary", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Health records connection", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Apple Health sync", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "doctronic",
    sources: [
      { label: "Doctronic home and pricing", url: "https://www.doctronic.ai/" },
      { label: "Doctronic AI consultation", url: "https://www.doctronic.ai/diagnose-me/" },
      { label: "Doctronic privacy and security notice", url: "https://www.doctronic.ai/privacy-policy/" },
      { label: "Doctronic App Store listing", url: "https://apps.apple.com/us/app/doctronic/id6753094320" },
    ],
    tradeoffs: [
      "Doctronic's physician visits, prescriptions, referrals, and records retrieval through TEFCA are things Murph does not offer. Murph's records path is an Epic import in beta plus uploads.",
      "Doctronic markets its AI as a diagnostic system on some pages while its footer says it does not practice medicine or give medical advice; read both before relying on a plan. Murph does not diagnose.",
      "Doctronic centers on the consult and the visit. Its pages do not describe direct wearable connections beyond Apple HealthKit, meal logging, or personal experiments over time, which are Murph's focus.",
    ],
    useTogether:
      "Use Doctronic when a symptom needs a fast consult or a prescription. Bring the SOAP note to Murph and keep the aftermath there: medication reminders, symptom logging, wearable context, and the follow-up question for your regular doctor. No connection between the two is documented.",
  },
  {
    aliases: ["Counsel"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Counsel Health if you want free medical AI with a board certified physician one tap away for $29 per visit, including prescriptions, lab orders, referrals, and check-ins, or unlimited visits for $300 a year.",
    chooseMurph:
      "Choose Murph if you want a health assistant in iMessage or Telegram that connects your wearables directly, logs meals and symptoms, runs personal experiments, and handles reminders and errands, without clinician care.",
    competitor: {
      clinicalRole:
        "Counsel is a clinical service: Counsel Health Medical Group, P.A. physicians supervise the AI and can prescribe non-controlled medications, order labs, write work notes, and refer. It is for adults 18 and older, is unavailable in seven states plus DC, and recommends keeping an in-person PCP.",
      followThrough:
        "Counsel advertises unlimited follow-ups and proactive check-ins so care continues after a chat, plus medication refills, specialist referrals, provider suggestions, and help booking in-person appointments. Physicians typically respond within 15 minutes during clinical hours of 8am to 9pm, seven days a week.",
      format:
        "A chat-based service on desktop and mobile: ask the medical AI anything for free, then add a doctor to the same conversation with one click. Since June 2026 the same AI and physicians are also offered inside the Oura App for eligible members.",
      hardware:
        "No device is required. Through its Oura partnership, Counsel's AI can incorporate a member's Oura biometrics when they chat from the Oura App; the homepage also lists wearable data review as a service.",
      inputs:
        "Your questions and symptoms, medical history shared by connecting a patient portal into a unified record, lab results from Counsel's own panels, and Oura data for members using the Oura App integration. Every conversation and medical detail is saved so doctors keep context.",
      insightStyle:
        "Physician-style assessment from a medical AI that reviews history, asks follow-up questions, and identifies likely explanations, with pattern recognition across a person's whole record. A human physician makes treatment decisions.",
      platforms:
        "Web app and an iPhone or iPad app rated 16 plus, plus the Oura App integration in 43 US states. Unavailable in Arkansas, DC, Kansas, Mississippi, Rhode Island, Washington, and West Virginia when reviewed. No messaging-app or self-hosted option.",
      pricing:
        "The medical AI is free. Adding a physician costs $29 for a seven day visit, or Counsel Signature at $300 per year covers unlimited visits and early access to features. No insurance is needed; the pages do not describe accepting insurance.",
      primaryJob:
        "Be the first point of contact for medical questions, from advice and lab review to urgent care and refills, by combining always-on medical AI with physicians who join the chat in minutes.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 4],
      followThrough: [1],
      format: [1, 3, 4],
      hardware: [1, 3],
      inputs: [1, 2, 3],
      insightStyle: [1, 3],
      platforms: [1, 3, 4],
      pricing: [1],
      primaryJob: [1, 4],
    },
    faqs: [
      {
        answer:
          "Both. The free chat is Counsel's medical AI, which gathers information and gives initial guidance. When you want treatment, a refill, or deeper review, a board certified Counsel physician joins the same conversation, usually within 15 minutes during clinical hours, for $29 per seven day visit.",
        question: "Is Counsel Health an AI or a real doctor?",
      },
      {
        answer:
          "Partly. Counsel's own pages document the Oura integration, where Oura members chat with Counsel's AI and physicians inside the Oura App with their biometrics as context, and list wearable data review as a service. Other direct device connections are not documented. Murph connects Oura, WHOOP, Garmin, Fitbit, Dexcom, and many more directly.",
        question: "Does Counsel Health work with wearables?",
      },
      {
        answer:
          "Not for care. Counsel's physicians prescribe, order labs, and refer, and Murph does none of that. Murph is the daily assistant in iMessage or Telegram that reads your devices and meals, runs personal experiments, and handles reminders and errands, then helps you decide when a Counsel visit is worth $29.",
        question: "Can Murph replace Counsel Health?",
      },
    ],
    headline:
      "Counsel Health puts a physician one tap from free medical AI. Murph is the assistant that runs the rest of your health.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Counsel Health pairs free medical AI with board certified physicians at $29 per visit, plus prescriptions and labs. Murph is a personal health assistant in iMessage or Telegram.",
    name: "Counsel Health",
    quickComparison: [
      { capability: "Physician added to chat", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Medication refills online", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "On demand lab ordering", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Health records connection", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "counsel-health",
    sources: [
      { label: "Counsel Health home, pricing, and FAQ", url: "https://www.counselhealth.com/" },
      { label: "Counsel Health health information privacy policy", url: "https://www.counselhealth.com/hipaa-statement" },
      { label: "Counsel Health on the Oura partnership", url: "https://www.counselhealth.com/blog/introducing-a-new-era-of-care-our-partnership-with-oura" },
      { label: "Counsel Health App Store listing", url: "https://apps.apple.com/us/app/counsel-health/id6478027487" },
    ],
    tradeoffs: [
      "Counsel's physicians, prescriptions, lab orders, and referrals are real care that Murph cannot provide, and its proactive check-ins come from a medical group rather than a wellness assistant.",
      "Counsel is US only, excludes seven states and DC, requires adults 18 and older, and prices physician time per visit or at $300 a year. Murph starts free and works anywhere iMessage or Telegram does.",
      "Counsel's wearable context is documented for Oura through the Oura App; its pages do not list direct connections to other devices, meal photo logging, or personal experiments. Murph has no clinicians and no lab ordering.",
    ],
    useTogether:
      "Use Counsel when a question needs a physician, a prescription, or a lab order. Use Murph for the ongoing loop in your messages: wearable trends, meals, symptoms, reminders, and errands, and to carry Counsel's plan forward. No connection between the two is documented.",
  },
  {
    category: "health-assistants",
    chooseCompetitor:
      "Choose Docus if you want a web-based AI Doctor that interprets uploaded lab reports with biomarker trends, checks symptoms, and can escalate to a paid second opinion from a specialist, starting free or from $3.99 a month.",
    chooseMurph:
      "Choose Murph if you want a health assistant in iMessage or Telegram that reads labs alongside wearables, meals, and symptoms, then follows through with reminders, health errands, and personal experiments.",
    competitor: {
      clinicalRole:
        "Docus says its AI tool is not a substitute for professional medical advice, diagnosis, or treatment. Paid second opinions come from doctors in the US and Europe and are billed separately from the AI plans.",
      followThrough:
        "Docus keeps chat history, conversation summaries, and AI long-term memory, and its lab reports include recommendations. The patient pages do not describe reminders, check-ins, scheduling, or refills.",
      format:
        "A web platform with a personal AI Doctor chat, a lab test interpretation tool that accepts PDFs, images, and screenshots, a symptom checker, and a marketplace of more than 350 doctors for second opinions.",
      hardware:
        "No device is required and no wearable connection is documented. Personally identifiable information is not mandatory for the AI tools, and lab uploads can be cropped or redacted.",
      inputs:
        "Your symptoms and health profile, uploaded blood, urine, swab, stool, Pap smear, and semen analysis results, chat attachments, and conversation history. Wearables, records connectors, and meal logging are not described.",
      insightStyle:
        "Clinical reasoning with a list of possible conditions, biomarker-by-biomarker explanations with normal ranges and status, trend charts across repeated tests, and written reports with clinical significance and recommendations.",
      platforms:
        "A web application; the pages reviewed do not link to iOS or Android apps. Available in the user's native language. No messaging-app or self-hosted option.",
      pricing:
        "Free plan with 3 AI Doctor messages per week and 1 interpreted test, no credit card required. Lite is $3.99 per month billed annually ($47.88) for 50 messages and 5 tests per month; Pro is $7.99 per month billed annually ($95.88) for 500 messages and 15 tests. Second opinions cost $490 each.",
      primaryJob:
        "Help patients understand symptoms and lab results through an AI Doctor, then validate important decisions with a specialist second opinion when needed.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 4],
      followThrough: [1, 3],
      format: [1, 2, 3],
      hardware: [2, 3],
      inputs: [2, 3],
      insightStyle: [2, 3],
      platforms: [2, 4],
      pricing: [1],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "Yes. Upload blood, urine, swab, stool, Pap smear, or semen analysis results as PDFs, images, or screenshots and Docus returns biomarker values, ranges, out-of-range explanations, trend charts across tests, and a report with recommendations. The free plan interprets one test; Lite covers 5 and Pro 15 per month.",
        question: "Can Docus read my lab results?",
      },
      {
        answer:
          "Not according to its pages. Docus works from what you type and upload, and its lab tool says identifying details are not required. Murph connects WHOOP, Oura, Garmin, Dexcom, Apple Health, and many more directly and also accepts uploaded labs and records.",
        question: "Does Docus connect to wearables or medical records?",
      },
      {
        answer:
          "Docus is a web tool focused on interpreting labs and symptoms, with a paid specialist second opinion as its escalation. Murph is an ongoing assistant in iMessage or Telegram that reads labs next to wearables, meals, and symptoms, runs personal experiments, and handles reminders and errands. Murph does not rank possible conditions or offer second opinions.",
        question: "How is Docus different from Murph?",
      },
    ],
    headline:
      "Docus interprets your labs on the web. Murph carries them into your daily health conversation.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Docus is a web AI Doctor that interprets uploaded labs with trend charts and sells specialist second opinions. Murph is a personal health assistant in iMessage or Telegram with device data.",
    name: "Docus",
    quickComparison: [
      { capability: "Lab report interpretation", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Biomarker trend charts", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Doctor second opinions", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Possible condition lists", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "docus",
    sources: [
      { label: "Docus pricing", url: "https://docus.ai/pricing" },
      { label: "Docus AI Health Assistant", url: "https://docus.ai/ai-health-assistant" },
      { label: "Docus lab test interpretation", url: "https://docus.ai/lab-test-interpretation" },
      { label: "Docus privacy policy", url: "https://docus.ai/privacy-policy" },
    ],
    tradeoffs: [
      "Docus's biomarker charts, structured reports, and $490 specialist second opinions are things Murph does not offer, and its per-biomarker explanations are more formal than a chat reply.",
      "Docus is web only with no documented wearable, records, or meal inputs, and its free plan allows three AI messages a week. Murph connects devices directly and starts free without a card.",
      "Docus's privacy policy was last revised in March 2024 while its product pages describe newer features; check current terms before uploading sensitive results. Murph does not provide Docus's possible-condition lists.",
    ],
    useTogether:
      "Use Docus for a formal interpretation of a lab report. Paste the summary into Murph so the result sits next to your wearable trends, meals, and symptoms, then set a reminder for the recheck. No connection between the two is documented.",
  },
  {
    category: "health-assistants",
    chooseCompetitor:
      "Choose August if you want a free 24/7 health AI that assesses symptoms without an account and can hand off to a licensed US physician for a $39 chat-based visit with a prescription sent to your pharmacy.",
    chooseMurph:
      "Choose Murph if you want an ongoing assistant in iMessage or Telegram that connects your wearables, logs meals and symptoms, and follows through with reminders, health errands, and personal experiments.",
    competitor: {
      clinicalRole:
        "August Labs says it is not a telehealth provider, medical practice, or pharmacy. Paid consultations are delivered by independent MD Integrations clinicians who make every clinical decision; the AI does not diagnose, treat, or prescribe. Adults 18 and older in the US only; no controlled substances.",
      followThrough:
        "Consultations end with a written care plan and, when appropriate, a non-controlled prescription sent to your chosen pharmacy, and August says you can follow up with your doctor. The App Store listing describes goals and reminders in a wellness framing; scheduling, refills, and errands are not described.",
      format:
        "A chat: describe symptoms in plain words, get guidance and a plan, then optionally start an asynchronous chat-based doctor visit with no video or microphone required. Available on the web and in iOS and Android apps.",
      hardware:
        "No device is required. The privacy policy lists wearable data among sources a user can authorize, but the product pages do not describe any specific device connection.",
      inputs:
        "Symptoms, medications, allergies, labs, vitals, photos, documents, insurance and billing documents, and telehealth intake answers. The privacy policy also lists user-authorized medical records, EHR exports, wearable data, lab reports, and pharmacy information.",
      insightStyle:
        "A symptom assessment with plain-language guidance sourced, August says, from peer-reviewed literature, and a benchmark claim of a perfect USMLE score. Clinical conclusions come only from the clinician in a paid visit.",
      platforms:
        "Web, iOS, and Android. The App Store listing is rated 18 plus and describes a general wellness companion, which differs from the website's symptom and doctor-visit framing. No messaging-app or self-hosted option is documented.",
      pricing:
        "Chat with August is free for US residents with no subscription. An online doctor visit is $39 per visit with no membership. Prescriptions are filled and paid at your own pharmacy.",
      primaryJob:
        "Answer health questions and assess symptoms for free at any hour, then get people to a licensed clinician and a prescription quickly when they need treatment.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 3],
      followThrough: [1, 2, 4],
      format: [1, 2],
      hardware: [3],
      inputs: [3],
      insightStyle: [1, 2],
      platforms: [1, 4],
      pricing: [1, 2],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "The AI chat is free for US residents, with no account required to check symptoms. A chat-based visit with a licensed doctor costs $39 with no membership, and any prescription is paid at your pharmacy. Murph also starts free without a card.",
        question: "Is August free?",
      },
      {
        answer:
          "The official pages reviewed describe web, iOS, and Android apps and do not mention WhatsApp. The privacy policy lists wearable data among sources you can authorize, but no specific device connection is described. Murph connects WHOOP, Oura, Garmin, Fitbit, Dexcom, Apple Health, and Health Connect directly.",
        question: "Does August use WhatsApp or connect to wearables?",
      },
      {
        answer:
          "August is a quick path from symptom to plan to prescription, with clinicians available for $39. Murph is a long-running assistant in iMessage or Telegram that reads wearables, meals, labs, and symptoms over time, runs personal experiments, and handles reminders and errands. Murph offers no clinician visits.",
        question: "How is August different from Murph?",
      },
    ],
    headline:
      "August takes you from symptom to prescription in one chat. Murph keeps the conversation going.",
    lastVerified: "2026-09-04",
    metaDescription:
      "August is a free health AI with $39 chat-based visits from licensed US doctors who can prescribe. Murph is a personal health assistant in iMessage or Telegram with wearables and errands.",
    name: "August",
    quickComparison: [
      { capability: "Chat based doctor visits", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Prescriptions to your pharmacy", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Anonymous symptom chat", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Lab report uploads", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "august",
    sources: [
      { label: "August home, pricing, and FAQ", url: "https://meetaugust.ai/" },
      { label: "August terms of service", url: "https://meetaugust.ai/terms" },
      { label: "August privacy policy", url: "https://www.meetaugust.ai/privacy" },
      { label: "August App Store listing", url: "https://apps.apple.com/us/app/august-your-24-7-health-ai/id6746088428" },
    ],
    tradeoffs: [
      "August's $39 physician visits, prescriptions sent to your pharmacy, and anonymous no-account chat are things Murph does not offer.",
      "August's App Store listing describes a general wellness companion while its website describes symptom assessment and doctor visits; expect the two to differ. Its terms say AI features are free only for US residents.",
      "August documents no specific wearable connection, meal photo logging, or personal experiments, and its follow-through is tied to a visit. Murph has no clinicians and cannot prescribe.",
    ],
    useTogether:
      "Use August when a symptom needs a quick assessment or a prescription. Bring the care plan to Murph and keep the aftermath there: medication reminders, symptom logging, wearable context, and the note for your regular doctor. No connection between the two is documented.",
  },
  {
    aliases: ["WebMD Symptom Checker", "WebMD AI"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose WebMD if you want a free, well-known reference app with an AI symptom checker, a drug interaction checker, medication reminders, a pharmacy discount card, and a doctor directory.",
    chooseMurph:
      "Choose Murph if you want a private, ongoing assistant in iMessage or Telegram that knows your wearables, labs, meals, and symptoms and follows through with reminders, health errands, and personal experiments.",
    competitor: {
      clinicalRole:
        "WebMD says it does not provide medical advice, diagnosis, or treatment, and the AI symptom checker carries the same notice. It is an information and tools publisher, not a care provider.",
      followThrough:
        "Medication reminders with daily schedules, pill images, and dosing details that sync across devices with a WebMD account; a doctor directory to find and book nearby doctors; and an appointment prep option in the AI checker. Scheduling on your behalf, refills, and check-ins are not described.",
      format:
        "A free reference app and website: an AI symptom chat that lists possible conditions or answers a health question, plus drug and condition libraries, a pill identifier, an interaction checker, saved items, and WebMD Rx pricing.",
      hardware:
        "No device is required and no wearable or health record connection is documented.",
      inputs:
        "Symptoms you choose or type, questions you ask, medications you enter for reminders or interaction checks, saved conditions and doctors, and your location for the directory. The privacy policy describes device identifiers and geolocation used for content and advertising.",
      insightStyle:
        "Reference-style: possible conditions for a symptom set, medically reviewed articles on causes and treatments, drug uses and warnings, and interaction alerts, all general rather than personalized to your records.",
      platforms:
        "iPhone and iPad app rated 16 plus, an Android app, and the web. The AI symptom checker runs at symptoms.webmd.com. No messaging-app or self-hosted option.",
      pricing:
        "The app, the AI symptom checker, and WebMD Rx are free, with no in-app purchases listed. WebMD is advertising supported, and its privacy policy describes advertising based on location and device data.",
      primaryJob:
        "Help people look up what a symptom might mean, check drugs and interactions, remember medications, and find a doctor, from a widely used health information brand.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4],
      followThrough: [1, 2, 4],
      format: [1, 2, 4],
      hardware: [2, 4],
      inputs: [1, 3, 4],
      insightStyle: [1, 2, 4],
      platforms: [1, 2, 4],
      pricing: [2, 3, 4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. WebMD's tool says it does not provide medical advice, and WebMD states it does not provide diagnosis or treatment. It lists possible conditions and answers general questions so you can decide on next steps with a professional.",
        question: "Is the WebMD AI symptom checker medical advice?",
      },
      {
        answer:
          "Not according to its pages. The app works from symptoms, drugs, and items you enter or save. Murph connects WHOOP, Oura, Garmin, Fitbit, Dexcom, Apple Health, and Health Connect directly and accepts uploaded labs and records.",
        question: "Does WebMD connect to wearables or medical records?",
      },
      {
        answer:
          "WebMD is a free reference: general information, a symptom checker, drug tools, reminders, and a directory, funded by advertising. Murph is a private assistant in iMessage or Telegram that works from your own data, remembers your history, runs personal experiments, and handles errands. Murph does not rank possible conditions.",
        question: "How is WebMD different from Murph?",
      },
    ],
    headline:
      "WebMD answers the general question. Murph knows your particular case.",
    lastVerified: "2026-09-04",
    metaDescription:
      "WebMD is a free reference app with an AI symptom checker, drug tools, reminders, and a doctor finder. Murph is a personal health assistant in iMessage or Telegram built on your own data.",
    name: "WebMD",
    quickComparison: [
      { capability: "Possible condition lists", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Drug interaction checker", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Pharmacy discount card", competitor: "yes", evidence: "pricing", murph: "no" },
      { capability: "Doctor directory", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Medication reminders", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Longitudinal history", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "webmd",
    sources: [
      { label: "WebMD AI Symptom Checker", url: "https://symptoms.webmd.com/aisc" },
      { label: "WebMD app", url: "https://www.webmd.com/webmdapp" },
      { label: "WebMD privacy policy", url: "https://www.webmd.com/about-webmd-policies/about-privacy-policy" },
      { label: "WebMD App Store listing", url: "https://apps.apple.com/us/app/webmd-symptom-checker/id295076329" },
    ],
    tradeoffs: [
      "WebMD's drug interaction checker, pharmacy discount pricing, doctor directory, and possible-condition lists have no equivalent in Murph, and its medically reviewed library is far larger.",
      "WebMD is advertising supported and its privacy policy describes location and device data used for ads; little personal context persists beyond saved items and reminders. Murph keeps a private longitudinal record.",
      "WebMD does not read wearables, labs, or records and cannot run personal experiments or handle errands. Murph has no interaction checker and no discount card.",
    ],
    useTogether:
      "Look things up in WebMD, then bring the question to Murph, where it can be answered against your own wearables, labs, meals, and history and turned into a reminder or an errand. No connection between the two is documented.",
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Choose PicnicHealth if you want someone to collect your complete medical records from every provider into one timeline with imaging, lab trends, plain-language highlights, and an assistant that answers from your own chart.",
    chooseMurph:
      "Choose Murph if you want a daily health assistant in iMessage or Telegram that reads wearables, meals, symptoms, and the labs you share with it, then follows through with reminders, health errands, and personal experiments.",
    competitor: {
      clinicalRole:
        "PicnicHealth's core product is a records platform, not care. Its separate Clinic offers Connected Care video visits with a primary care provider who reviews your records and care plan. The app assistant explains records and terms; it does not diagnose.",
      followThrough:
        "PicnicHealth refreshes records automatically through the year, including imaging and office outreach, keeps a Smart Medication List current, and lets you print or share a Health Snapshot with a new provider or family member. Push notifications flag new records and study tasks.",
      format:
        "A visit timeline organized by date, type, and doctor, with pinboards, an imaging viewer for original MRI, X-ray, and CT files, lab and vital trends, a Health Snapshot, and an AI search assistant, on the web and in an iPhone or iPad app for members.",
      hardware:
        "No device is required and no wearable connection is documented. Vitals such as weight and blood pressure come from your records.",
      inputs:
        "Medical records PicnicHealth retrieves on your behalf after you sign an authorization: provider notes, labs, procedures, imaging reports and files, medications, and vitals from every point of care you list. Its privacy policy limits use of that information to providing and improving the service.",
      insightStyle:
        "Plain-language Smart Highlights for unfamiliar terms in your own records, trend charts for labs and vitals that flag what is in and out of range, and quick answers from the assistant with links back to the source record.",
      platforms:
        "Web and an iPhone or iPad app rated 13 plus for existing members. Connected Care is virtual and available where PicnicHealth is licensed in the US. Caregivers can open accounts for people they are authorized to represent.",
      pricing:
        "Membership is $499 per year billed annually, or $0 for the duration of a research study, and you keep collected records if you cancel. A Connected Care visit is $149, or possibly $0 through insurance. HSA and FSA are accepted.",
      primaryJob:
        "Gather a person's complete medical history from every provider into one owned, organized record, help them understand it, and offer a clinic visit that works from that record.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 5],
      followThrough: [2, 3, 5],
      format: [3, 5],
      hardware: [3],
      inputs: [1, 2, 3, 4],
      insightStyle: [3, 5],
      platforms: [2, 5],
      pricing: [2],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "You sign an authorization and tell PicnicHealth where you have received care. It then requests records from each provider, including imaging files, and refreshes them through the year. Everything lands in a timeline you own and keep even if you cancel.",
        question: "How does PicnicHealth get my records?",
      },
      {
        answer:
          "Only through research. Membership is $499 per year, or $0 while you participate in a PicnicHealth study, after which you keep the records already collected. A Connected Care visit is $149 or possibly $0 with insurance. Murph starts free without a card.",
        question: "Is PicnicHealth free?",
      },
      {
        answer:
          "Not automatically. PicnicHealth lets you print or share a Health Snapshot and specific records, and Murph's records vault accepts uploads and pasted results, so you can bring the summary and key labs over yourself. No direct connection exists.",
        question: "Can PicnicHealth records reach Murph?",
      },
    ],
    headline:
      "PicnicHealth assembles your whole medical history. Murph puts it to work every day.",
    integration: "import",
    lastVerified: "2026-09-04",
    metaDescription:
      "PicnicHealth gathers complete medical records from every provider into one timeline with imaging and trends. Murph is a personal health assistant in iMessage or Telegram that uses them.",
    name: "PicnicHealth",
    quickComparison: [
      { capability: "Records gathered for you", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Imaging file viewer", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Lab and vitals trends", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Primary care review visits", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Shareable health snapshot", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Plain language explanations", competitor: "yes", evidence: "insightStyle", murph: "yes" },
      { capability: "Free start without a card", competitor: "limited", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "limited", evidence: "followThrough", murph: "yes" },
    ],
    relationship: "complement",
    slug: "picnichealth",
    sources: [
      { label: "PicnicHealth home", url: "https://picnichealth.com/" },
      { label: "PicnicHealth pricing", url: "https://www.picnichealth.com/pricing" },
      { label: "PicnicHealth app features", url: "https://www.picnichealth.com/explore-the-app" },
      { label: "PicnicHealth privacy policy", url: "https://www.picnichealth.com/privacy-policy" },
      { label: "PicnicHealth App Store listing", url: "https://apps.apple.com/us/app/picnichealth/id6746083574" },
    ],
    tradeoffs: [
      "PicnicHealth does the record chasing for you, including original imaging files, which is far beyond Murph's Epic import in beta and manual uploads.",
      "PicnicHealth costs $499 a year unless you join a research study, is US only, and documents no wearable inputs. Murph connects devices directly and starts free.",
      "PicnicHealth's assistant answers from your chart; it does not log meals or symptoms, run experiments, or handle errands. Murph has no imaging viewer and no clinic.",
    ],
    useTogether:
      "Let PicnicHealth assemble and refresh the record. Share its Health Snapshot and key labs into Murph's vault so daily conversations about wearables, meals, and symptoms can draw on your history, and set reminders for the follow-ups PicnicHealth surfaces. No automatic sync exists.",
  },
]);
