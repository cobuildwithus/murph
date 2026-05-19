import Link from "next/link";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

const QUOTES = [
  {
    text: "The good physician treats the disease; the great physician treats the patient who has the disease.",
    author: "William Osler",
  },
  {
    text: "Those who think they have no time for exercise will sooner or later have to find time for illness.",
    author: "Edward Stanley",
  },
  {
    text: "The doctor of the future will give no medicine, but will instruct his patient in the care of the human frame, in diet, and in the cause and prevention of disease.",
    author: "Thomas Edison",
  },
  {
    text: "Walking is man's best medicine.",
    author: "Hippocrates",
  },
  {
    text: "The greatest wealth is health.",
    author: "Virgil",
  },
  {
    text: "Sleep is the best meditation.",
    author: "Dalai Lama",
  },
  {
    text: "Take care of your body. It's the only place you have to live.",
    author: "Jim Rohn",
  },
  {
    text: "The human body is the best picture of the human soul.",
    author: "Ludwig Wittgenstein",
  },
  {
    text: "The body keeps the score.",
    author: "Bessel van der Kolk",
  },
  {
    text: "What gets measured gets managed.",
    author: "Peter Drucker",
  },
  {
    text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
    author: "Aristotle",
  },
  {
    text: "The best time to plant a tree was 20 years ago. The second best time is now.",
    author: "Chinese proverb",
  },
];

function getRandomQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)]!;
}

export default async function NotFound() {
  const { authenticated } = await getHostedPageAuthSnapshot();
  const quote = getRandomQuote();
  const backHref = authenticated ? "/home" : "/";

  return (
    <>
      <main className="flex min-h-[80vh] flex-col items-center justify-center px-6">
        <div className="max-w-lg text-center">
          <h1 className="font-serif text-7xl font-semibold tracking-tight text-foreground">
            404
          </h1>

          <div className="mt-10 space-y-3">
            <p className="font-serif text-lg italic leading-relaxed text-foreground/80">
              &ldquo;{quote.text}&rdquo;
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {quote.author}
            </p>
          </div>

          <Link
            href={backHref}
            prefetch={false}
            className="mt-10 inline-block rounded-2xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Murph
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
