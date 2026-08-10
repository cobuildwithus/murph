import Link from "next/link";

import { MarkdownView } from "@/src/components/ui/markdown-view";
import {
  BLOG_KIND_LABELS,
  buildBlogArticlePath,
  type BlogArticle,
} from "@/src/lib/blog";

const ARTICLE_BODY_CLASSNAME = [
  "text-[#3f403d]",
  "[&_h2]:mt-12 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.025em] [&_h2]:text-[#2d3436] sm:[&_h2]:text-[1.75rem]",
  "[&_p]:mt-5 [&_p]:text-[1rem] [&_p]:leading-[1.82] sm:[&_p]:text-[1.0625rem]",
  "[&_ul]:mt-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul]:text-[1rem] [&_ul]:leading-[1.75] sm:[&_ul]:text-[1.0625rem]",
  "[&_ol]:mt-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_ol]:text-[1rem] [&_ol]:leading-[1.75] sm:[&_ol]:text-[1.0625rem]",
  "[&_strong]:font-semibold [&_strong]:text-[#2d3436]",
  "[&_a]:text-[#3a4a1e] [&_a]:underline [&_a]:underline-offset-4",
].join(" ");

export function BlogArticleView({
  article,
  relatedArticles,
}: {
  article: BlogArticle;
  relatedArticles: readonly BlogArticle[];
}) {
  return (
    <main className="min-h-dvh bg-[#f5f0e8] text-[#2d3436] antialiased">
      <article>
        <header className="bg-[#1f241c] px-6 pb-14 pt-24 text-[#f5f0e8] sm:px-10 sm:pb-16 sm:pt-28 lg:px-16 lg:pb-20 lg:pt-32">
          <div className="mx-auto max-w-[900px]">
            <Link
              className="inline-flex min-h-10 items-center font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#c4a882] underline-offset-4 hover:underline"
              href="/blog"
            >
              Field notes
            </Link>
            <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#f5f0e8]/58">
              <span>{BLOG_KIND_LABELS[article.kind]}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={article.publishedOn}>
                {formatBlogDate(article.publishedOn)}
              </time>
              <span aria-hidden="true">·</span>
              <span>{article.readingMinutes} min read</span>
            </div>
            <h1 className="mt-6 max-w-[20ch] font-serif text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[0.99] tracking-[-0.045em] text-balance">
              {article.title}
            </h1>
            <p className="mt-7 max-w-[58ch] text-[1rem] leading-[1.75] text-[#f5f0e8]/70 sm:text-[1.125rem]">
              {article.description}
            </p>
          </div>
        </header>

        <div className="mx-auto grid max-w-[900px] gap-10 px-6 py-14 sm:px-10 sm:py-16 lg:grid-cols-[170px_minmax(0,1fr)] lg:gap-16 lg:px-0 lg:py-20">
          <aside className="lg:pt-2">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#5a6e32]">
              About this note
            </p>
            <p className="mt-3 max-w-[28ch] text-sm leading-[1.65] text-[#736a58]">
              Educational information and a way to think through the decision.
              It is not diagnosis or a substitute for professional care.
            </p>
            {article.kind === "case-study" ? (
              <div className="mt-6 border-t border-[#c4a882]/30 pt-5">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#5a6e32]">
                  Verified result
                </p>
                <p className="mt-2 text-sm leading-[1.65] text-[#736a58]">
                  {article.evidence.resultSummary}
                </p>
              </div>
            ) : null}
          </aside>
          <MarkdownView className={ARTICLE_BODY_CLASSNAME} content={article.body} />
        </div>
      </article>

      {relatedArticles.length > 0 ? (
        <section className="border-t border-[#c4a882]/30 px-6 py-14 sm:px-10 sm:py-16 lg:px-16">
          <div className="mx-auto max-w-[900px]">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#5a6e32]">
              Keep reading
            </p>
            <div className="mt-6 grid border-y border-[#c4a882]/30 md:grid-cols-2">
              {relatedArticles.map((relatedArticle, index) => (
                <Link
                  className={`group py-7 outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] ${
                    index > 0
                      ? "border-t border-[#c4a882]/30 md:border-l md:border-t-0 md:pl-8"
                      : "md:pr-8"
                  }`}
                  href={buildBlogArticlePath(relatedArticle.slug)}
                  key={relatedArticle.slug}
                >
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
                    {BLOG_KIND_LABELS[relatedArticle.kind]}
                  </p>
                  <h2 className="mt-3 max-w-[20ch] font-serif text-2xl font-semibold leading-[1.1] tracking-[-0.025em] transition-colors group-hover:text-[#3a4a1e]">
                    {relatedArticle.title}
                  </h2>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export function formatBlogDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
