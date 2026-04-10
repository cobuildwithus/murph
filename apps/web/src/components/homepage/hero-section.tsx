import { GitHubIcon } from "./github-icon";
import { HomepageAuthPanel } from "./homepage-auth-panel";

const GITHUB_REPO_URL = "https://github.com/cobuildwithus/murph";

export function HeroSection({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-20 pt-16 md:px-12 md:pb-28 md:pt-24 lg:px-16">
      <div className="grid items-start gap-12 lg:grid-cols-[1fr_400px] lg:gap-16 xl:grid-cols-[1fr_440px] xl:gap-24">
        <div className="animate-fade-up [animation-delay:0.1s]">
          <h1 className="text-[clamp(2.75rem,6.5vw,5.5rem)] font-bold leading-[0.92] tracking-[-0.04em] text-stone-900">
            Your personal health assistant.
          </h1>
          <p className="mt-8 max-w-lg text-lg leading-relaxed text-stone-400 md:text-xl md:leading-relaxed">
            Murph meets you where you already are — Telegram, Linq, or email.
            Ask questions, track meals, and spot patterns without
            downloading another app.
          </p>
          <div className="mt-6 flex items-center gap-3 text-sm text-stone-500">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white/80 px-4 py-2.5 font-medium text-stone-600 transition-colors hover:text-stone-900"
            >
              <GitHubIcon className="h-5 w-5" />
              Open source — Apache 2.0
            </a>
          </div>
        </div>

        <div className="animate-fade-up [animation-delay:0.2s]">
          <HomepageAuthPanel authenticated={authenticated} />
        </div>
      </div>
    </section>
  );
}
