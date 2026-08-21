import type { PublicTrustPageContent as PublicTrustPageContentModel } from "@/src/lib/public-trust-pages";

export function PublicTrustPageContent({
  content,
}: {
  content: PublicTrustPageContentModel;
}) {
  const titleId = `public-trust-${content.eyebrow.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <article aria-labelledby={titleId}>
      <header className="bg-[#2a2520] px-6 pb-20 pt-32 text-[#f5f0e8] sm:px-10 sm:pb-24 sm:pt-36 lg:px-16 lg:pb-28 lg:pt-40">
        <div className="mx-auto max-w-[1080px]">
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="h-px w-12 bg-[#c4a882]/60" />
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c4a882]">
              {content.eyebrow}
            </p>
          </div>
          <h1
            className="mt-8 max-w-[16ch] text-balance font-serif text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-none tracking-[-0.035em]"
            id={titleId}
          >
            {content.title}
          </h1>
          <p className="mt-8 max-w-[62ch] text-pretty text-[1rem] leading-[1.75] text-[#f5f0e8]/70 sm:text-[1.0625rem]">
            {content.introduction}
          </p>
          {content.action ? (
            <div className="mt-10 border-l border-[#c4a882]/60 pl-5">
              <a
                className="font-serif text-[clamp(1.35rem,3vw,2rem)] font-semibold text-[#f5f0e8] underline decoration-[#c4a882]/60 underline-offset-4 transition-colors hover:text-[#c4a882]"
                href={content.action.href}
              >
                {content.action.label}
              </a>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#f5f0e8]/50">
                {content.action.detail}
              </p>
            </div>
          ) : null}
        </div>
      </header>

      <div className="bg-[#f5f0e8] px-6 py-16 text-[#2d3436] sm:px-10 sm:py-20 lg:px-16 lg:py-24">
        <div className="mx-auto max-w-[1080px]">
          {content.sections.map((section) => (
            <section
              className="grid gap-5 border-t border-[#c4a882]/35 py-10 first:pt-0 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-16"
              key={section.title}
            >
              <h2 className="max-w-[20ch] font-serif text-[clamp(1.6rem,3vw,2.35rem)] font-semibold leading-[1.08] tracking-[-0.025em]">
                {section.title}
              </h2>
              <div className="max-w-[66ch] space-y-5 text-[0.975rem] leading-[1.75] text-[#4d4533]">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}
