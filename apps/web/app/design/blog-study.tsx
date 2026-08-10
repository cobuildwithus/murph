import { BlogArchive } from "@/src/components/blog/blog-archive";
import { BlogArticleView } from "@/src/components/blog/blog-article-view";
import type { BlogArticle } from "@/src/lib/blog";

const DESIGN_BLOG_ARTICLES = [
  {
    body: `
## Begin with the decision

The chart is useful when it helps answer a real question. Start with the choice you are trying to make, then bring in the smallest amount of context that can change it.

## Keep the next step light

An answer, a small adjustment, or a short watch period may be enough. More tracking is not automatically more useful.
    `.trim(),
    description:
      "A synthetic guide showing how the production archive and article typography work together.",
    featured: true,
    keywords: ["design guide"],
    kind: "guide",
    publishedOn: "2030-01-17",
    readingMinutes: 4,
    slug: "design-read-the-pattern",
    title: "Read the pattern before choosing the next step",
  },
  {
    body: "## Useful context\n\nRemember only what can make later help more useful.",
    description:
      "A synthetic field note about using context carefully and purposefully.",
    featured: false,
    keywords: ["design context"],
    kind: "field-note",
    publishedOn: "2030-01-14",
    readingMinutes: 3,
    slug: "design-context-with-a-job",
    title: "Every remembered detail should have a job",
  },
  {
    body: "## One useful change\n\nKeep the question small enough to answer.",
    description:
      "A synthetic guide that exercises the compact archive row at phone and desktop widths.",
    featured: false,
    keywords: ["design experiment"],
    kind: "guide",
    publishedOn: "2030-01-11",
    readingMinutes: 5,
    slug: "design-one-useful-change",
    title: "Make one change small enough to learn from",
  },
] satisfies readonly BlogArticle[];

export function BlogArchiveStudy() {
  return (
    <div data-design-study="blog-archive" inert>
      <BlogArchive articles={DESIGN_BLOG_ARTICLES} />
    </div>
  );
}

export function BlogArticleStudy() {
  const [article, ...relatedArticles] = DESIGN_BLOG_ARTICLES;

  return (
    <div data-design-study="blog-article" inert>
      <BlogArticleView
        article={article}
        relatedArticles={relatedArticles}
      />
    </div>
  );
}
