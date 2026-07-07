import { formatHostedLandingPricingLongSummary } from "@/src/lib/hosted-onboarding/billing-plans";

const launchPricingSummary = formatHostedLandingPricingLongSummary();

const FAQ_ITEMS = [
  [
    "Where do the experiments come from?",
    "Murph uses AI-assisted review of published studies, clinical trials, and other research sources to draft protocols, then presents sources so you can check the evidence yourself. Research may be incomplete, mixed, or not applicable to your situation.",
  ],
  [
    "Do I need a computer?",
    "The web dashboard works on any device with a browser. For daily guidance, Murph texts you through iMessage, Telegram, or email.",
  ],
  [
    "Do I need a wearable?",
    "No. A wearable can add useful signals, but Murph can also work from notes, labs, symptoms, meals, workouts, and manual measurements. The point is the before-and-after experiment loop.",
  ],
  [
    "How is this different from my wearable’s app?",
    "Wearable apps show status. Murph turns whatever evidence you have into a bounded experiment with a baseline and a clear outcome.",
  ],
  [
    "Can I do challenges with friends and family?",
    "Yes. Start a group with Murph and invite your people. Murph referees the challenge: fair baselines across different devices, scoring, reminders, and a winner at the end. Scoring is adherence and change against your own baseline, never raw body stats.",
  ],
  [
    "What does the group actually see?",
    "Only what each person agrees to share when they join a challenge or newsletter. The weekly newsletter is a short recap of how everyone's week went. Everything else stays private by default.",
  ],
  [
    "Can I set it up for a parent?",
    "Yes. Murph works over plain texting with no app to download, which makes it a good fit for parents and grandparents. Their answers stay grounded in their own labs and routines, and the weekly newsletter keeps the family in the loop if they opt in.",
  ],
  [
    "Can I run multiple experiments?",
    "Yes. We recommend one at a time so you know what caused the change, but you can run more if they don’t overlap.",
  ],
  [
    "What if I can’t follow the protocol perfectly?",
    "Real life happens. Murph accounts for missed sessions in the analysis. A good experiment tolerates some noise.",
  ],
  [
    "What if nothing changes?",
    "That’s useful too. Each experiment ends with a verdict: what worked, what didn’t, what to try next. Knowing what doesn’t work saves you from doing it forever.",
  ],
  [
    "Is this medical advice?",
    "No. Murph helps you run self-experiments using published research. It’s not a substitute for medical care. Talk to your doctor about health concerns.",
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
