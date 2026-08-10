import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import {
  BLOG_KIND_LABELS,
  buildBlogArticlePath,
  type BlogArticle,
  type BlogArticleKind,
} from "@/src/lib/blog";

const KIND_DESCRIPTIONS: Record<BlogArticleKind, string> = {
  "case-study": "Verified stories with permission, evidence, and honest limits.",
  "field-note": "How we think about personal, private health help.",
  guide: "Practical ways to understand, decide, and follow through.",
};

export function BlogArchive({ articles }: { articles: readonly BlogArticle[] }) {
  const featuredArticle = articles.find((article) => article.featured);
  const remainingArticles = articles.filter((article) => !article.featured);

  if (!featuredArticle) {
    return null;
  }

  return (
    <main className="min-h-dvh bg-[#f5f0e8] text-[#2d3436] antialiased">
      <section className="bg-[#1f241c] px-6 pt-24 text-[#f5f0e8] sm:px-10 sm:pt-28 lg:px-16 lg:pt-32">
        <div className="mx-auto grid max-w-[1080px] overflow-hidden border-x border-t border-[#c4a882]/25 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)]">
          <div className="flex flex-col justify-between px-6 py-12 sm:px-10 sm:py-16 lg:px-12 lg:py-20">
            <div>
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="h-px w-10 bg-[#c4a882]/60" />
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c4a882]">
                  Murph field notes
                </p>
              </div>
              <h1 className="mt-6 max-w-[12ch] font-serif text-[clamp(2.5rem,6vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-balance">
                Better health decisions start with the whole picture.
              </h1>
            </div>
            <p className="mt-12 max-w-[48ch] text-[0.9375rem] leading-[1.7] text-[#f5f0e8]/68 sm:text-base">
              Practical guides, notes from building a personal health assistant,
              and case studies only when the evidence is ready.
            </p>
          </div>
          <div className="relative min-h-[280px] border-t border-[#c4a882]/25 lg:min-h-[560px] lg:border-t-0 lg:border-l">
            <Image
              alt="A person looking across a wide mountain landscape at sunrise"
              className="object-cover object-[70%_center]"
              fill
              priority
              sizes="(min-width: 1024px) 440px, 100vw"
              src="/hero.jpg"
            />
          </div>
        </div>
      </section>

      <section className="border-b border-[#c4a882]/25 px-6 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-[1080px] gap-8 md:grid-cols-3 md:gap-0">
          {(Object.keys(KIND_DESCRIPTIONS) as BlogArticleKind[]).map(
            (kind, index) => (
              <div
                className={`md:px-8 ${
                  index === 0
                    ? "md:pl-0"
                    : "border-t border-[#c4a882]/25 pt-8 md:border-t-0 md:border-l md:pt-0"
                }`}
                key={kind}
              >
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#5a6e32]">
                  {BLOG_KIND_LABELS[kind]}
                </p>
                <p className="mt-3 max-w-[34ch] text-sm leading-[1.6] text-[#635a48]">
                  {KIND_DESCRIPTIONS[kind]}
                </p>
              </div>
            ),
          )}
        </div>
      </section>

      <section
        className="px-6 py-16 sm:px-10 sm:py-20 lg:px-16 lg:py-24"
        id="articles"
      >
        <div className="mx-auto max-w-[1080px]">
          <div className="grid gap-8 border-b border-[#c4a882]/30 pb-16 lg:grid-cols-[0.36fr_0.64fr] lg:gap-16 lg:pb-20">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#5a6e32]">
                Start here
              </p>
              <p className="mt-4 max-w-[28ch] text-sm leading-[1.65] text-[#736a58]">
                One useful question, read with enough context to choose a next
                step.
              </p>
            </div>
            <ArticleLink article={featuredArticle} featured />
          </div>

          <div className="pt-14 sm:pt-16">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#5a6e32]">
                  Latest
                </p>
                <h2 className="mt-3 font-serif text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                  Read the field notes
                </h2>
              </div>
              <a
                className="hidden text-sm text-[#3a4a1e] underline-offset-4 hover:underline sm:inline"
                href="/blog/rss.xml"
              >
                RSS feed
              </a>
            </div>

            <div className="mt-10 divide-y divide-[#c4a882]/30 border-y border-[#c4a882]/30">
              {remainingArticles.map((article) => (
                <ArticleLink article={article} key={article.slug} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function ArticleLink({
  article,
  featured = false,
}: {
  article: BlogArticle;
  featured?: boolean;
}) {
  return (
    <Link
      className={`group grid min-h-11 gap-5 outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f5f0e8] ${
        featured
          ? "content-start"
          : "py-8 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-start sm:gap-8"
      }`}
      href={buildBlogArticlePath(article.slug)}
    >
      <ArticleMeta article={article} />
      <div>
        <h2
          className={`max-w-[22ch] font-serif font-semibold leading-[1.08] tracking-[-0.03em] text-balance transition-colors group-hover:text-[#3a4a1e] ${
            featured ? "text-3xl sm:text-4xl lg:text-[2.75rem]" : "text-2xl sm:text-[1.75rem]"
          }`}
        >
          {article.title}
        </h2>
        <p className="mt-4 max-w-[60ch] text-[0.9375rem] leading-[1.7] text-[#635a48]">
          {article.description}
        </p>
      </div>
      <ArrowUpRight
        aria-hidden="true"
        className={`size-5 text-[#5a6e32] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${
          featured ? "mt-2" : "hidden sm:block"
        }`}
      />
    </Link>
  );
}

function ArticleMeta({ article }: { article: BlogArticle }) {
  return (
    <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
      {BLOG_KIND_LABELS[article.kind]}
      <span aria-hidden="true"> · </span>
      {article.readingMinutes} min
    </p>
  );
}
