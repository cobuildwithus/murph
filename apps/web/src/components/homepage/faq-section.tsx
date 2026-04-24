import { formatHostedLandingPricingLongSummary } from "@/src/lib/hosted-onboarding/billing-plans";

const launchPricingSummary = formatHostedLandingPricingLongSummary();

const FAQ_ITEMS = [
  [
    "Where do the experiments come from?",
    "AI analyzes published studies, clinical trials, and peer-reviewed research to build each protocol. Every experiment links to its sources so you can check the evidence yourself.",
  ],
  [
    "Do I need a computer?",
    "The web dashboard works on any device with a browser. For daily guidance, Murph texts you through iMessage, Telegram, or email. You can use just the chat if you prefer.",
  ],
  [
    "How is this different from my wearable’s app?",
    "Your wearable shows data. Murph gives you something to do with it — a bounded experiment with baseline measurement and a clear conclusion at the end.",
  ],
  [
    "Can I run multiple experiments?",
    "One at a time. That’s what makes the results trustworthy — one variable means you know what caused the change.",
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
    "Your conversations never train AI models. Cloud inference runs through Venice AI with zero data retention — nothing is stored on their side. Hosted runs use encrypted snapshots with privacy-first defaults, so only you can access them.",
  ],
  [
    "Can I self-host Murph?",
    "Yes. Murph is open source under Apache 2.0. Run it locally with one command and bring your own models — OpenAI, Anthropic, Ollama, whatever. The hosted version is for people who'd rather not run anything themselves.",
  ],
  [
    "Can I cancel anytime?",
    `Yes. No contracts. ${launchPricingSummary}, cancel whenever. Your data stays yours.`,
  ],
] as const;

export function FaqSection() {
  return (
    <section id="faq" className="px-6 py-16 sm:px-10 lg:px-16 lg:py-24">
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
