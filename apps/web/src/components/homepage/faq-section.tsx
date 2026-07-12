import { formatHostedLandingPricingLongSummary } from "@/src/lib/hosted-onboarding/billing-plans";

const launchPricingSummary = formatHostedLandingPricingLongSummary();

const FAQ_ITEMS = [
  [
    "What can Murph help with?",
    "Bring Murph a health question, decision, goal, task, record, or data point. It can research and explain, interpret your context, help make a plan, support follow-through, handle supported logistics, involve people you trust, or run an experiment when that is the right tool.",
  ],
  [
    "How does Murph get more personal?",
    "Murph remembers relevant history, routines, preferences, constraints, actions, and outcomes you share or connect. It uses that context when it improves a later answer or action. You can ask what Murph knows, correct it, or ask Murph to forget a saved memory.",
  ],
  [
    "Do I need a computer?",
    "The web dashboard works on any device with a browser. For daily help, Murph can talk with you through iMessage, Telegram, or email.",
  ],
  [
    "Do I need a wearable?",
    "No. A wearable can add useful signals, but Murph can also work from conversation, notes, labs, symptoms, meals, workouts, records, and manual measurements.",
  ],
  [
    "How is this different from my wearable’s app?",
    "Wearable apps are useful sources. Murph can interpret their signals alongside the rest of your health and life, remember the context, and help turn it into a decision or action.",
  ],
  [
    "What if I don’t have a health goal?",
    "You do not need to invent one. Start with any question or task that comes up, or ask Murph for an optional baseline review to figure out where attention may be useful.",
  ],
  [
    "Can I get support from friends or family?",
    "Yes, when you want it. Murph can run a challenge, support shared accountability, or send a family newsletter. Your direct relationship remains private, and other people see only the scope each person agrees to share.",
  ],
  [
    "What does a group actually see?",
    "Only what each person explicitly agrees to share for that group, challenge, or newsletter. Everything else stays private by default.",
  ],
  [
    "Can I set it up for a parent?",
    "Yes. Murph works over plain texting with no app to download. Their conversation and health context stay private, and they can opt into a narrowly scoped family recap when that is useful.",
  ],
  [
    "When would Murph run an experiment?",
    "When uncertainty about what works is the real problem. Murph can help choose a useful outcome, find or adapt a protocol, establish a baseline, support the run, and review what changed. A simple question, task, plan, or habit does not need to become an experiment.",
  ],
  [
    "Where do experiment protocols come from?",
    "Murph uses AI-assisted review of published studies, clinical trials, and other research sources to draft protocols, then presents sources so you can check the evidence. Research may be incomplete, mixed, or not applicable to your situation.",
  ],
  [
    "Can I run multiple experiments?",
    "Yes. Murph recommends one meaningful experiment at a time by default so the result stays interpretable, but separate experiments can overlap when they do not confound one another.",
  ],
  [
    "What if I can’t follow a protocol perfectly?",
    "Real life happens. Murph accounts for missed sessions and other context when interpreting a run. A useful experiment should tolerate ordinary noise.",
  ],
  [
    "What if nothing changes?",
    "That can still answer the question. Murph helps decide whether to stop, change, extend, or leave the intervention alone instead of treating every run as a success.",
  ],
  [
    "Is this medical advice?",
    "Murph helps with health understanding, decisions, organization, and follow-through, but it does not diagnose or replace a clinician or emergency care. It should be clear about uncertainty and point you to appropriate care when the situation calls for it.",
  ],
  [
    "What happens to my data?",
    "Unless Murph clearly says otherwise and gets any required consent, health data you submit through Murph is not used to train general-purpose AI models. Murph encrypts sensitive data at rest and keeps storage scoped by purpose. The service can decrypt data when it needs to run requested tasks or maintain the service. Local Murph keeps your vault on your device.",
  ],
  [
    "Can I self-host Murph?",
    "Yes. Murph is open source under Apache 2.0. Run it locally with one command. The hosted version is for people who'd rather not run anything themselves.",
  ],
  [
    "Can I cancel anytime?",
    `Yes. No contracts. ${launchPricingSummary}, cancel whenever. You can export your data.`,
  ],
] as const;

export function FaqSection() {
  return (
    <section id="faq" className="px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1080px]">
        <div className="grid gap-10 lg:grid-cols-[280px_1fr] lg:gap-20">
          <div>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
              FAQ
            </span>
            <h2 className="mt-4 font-serif text-[clamp(1.5rem,2.5vw,2rem)] font-semibold leading-[1.15] tracking-[-0.02em] text-[#2d3436]">
              Common questions
            </h2>
          </div>
          <div className="grid gap-x-16 gap-y-0 sm:grid-cols-2">
            {FAQ_ITEMS.map(([question, answer]) => (
              <div key={question} className="border-b border-[#c4a882]/15 py-5">
                <p className="text-[0.9375rem] font-semibold text-[#2d3436]">
                  {question}
                </p>
                <p className="mt-1.5 text-[0.8125rem] leading-[1.65] text-[#736a58]">
                  {answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
