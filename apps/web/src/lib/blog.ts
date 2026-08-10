export const BLOG_ARTICLE_KINDS = [
  "guide",
  "field-note",
  "case-study",
] as const;

export type BlogArticleKind = (typeof BLOG_ARTICLE_KINDS)[number];

type BlogArticleBase = {
  body: string;
  description: string;
  featured: boolean;
  keywords: readonly string[];
  kind: BlogArticleKind;
  publishedOn: string;
  readingMinutes: number;
  slug: string;
  title: string;
};

export type BlogGuide = BlogArticleBase & {
  kind: "guide" | "field-note";
  evidence?: never;
};

export type BlogCaseStudy = BlogArticleBase & {
  evidence: {
    consentConfirmed: true;
    resultSummary: string;
    verifiedOn: string;
  };
  kind: "case-study";
};

export type BlogArticle = BlogGuide | BlogCaseStudy;

const BLOG_ARTICLE_REGISTRY = [
  {
    body: `
## A number is not a decision

A wearable can tell you that last night looked different. It cannot always tell you why, whether the change matters, or what to do next. Those questions depend on context the chart usually does not have: how you feel, what changed in your routine, what you are trying to accomplish, and what else is happening with your health.

The useful move is to treat a number as a clue. Start with the question behind the dashboard. Are you deciding whether to train today? Trying to understand a run of poor sleep? Wondering whether a new routine is helping? A clear decision gives the data a job.

## Read the pattern, not the alarm

One unusual day is often less informative than a repeated pattern. Look at the direction over time, whether several related signals moved together, and whether the change matches anything you already know about the week.

Then add the details a device cannot observe well. Travel, illness, stress, medication changes, alcohol, a late meal, a hard workout, or simply a bad night can change how a signal should be interpreted. The point is not to explain every fluctuation. It is to avoid treating a measurement as a verdict.

## Choose the lightest useful next step

Once the pattern is clear enough, decide what kind of help the moment needs:

- **An answer:** understand what the metric can and cannot mean.
- **A small adjustment:** change one obvious part of today and move on.
- **A short watch period:** keep an eye on the pattern before acting.
- **A bounded experiment:** try one change when the uncertainty is worth resolving.
- **A clinical conversation:** bring the pattern and the surrounding context to a qualified professional when symptoms, risk, or concern make that the right next step.

The best next step is rarely the one that produces the most tracking. It is the one that helps you make a better decision with the least extra work.

## Keep the context for later

The real value appears when the next question does not start from zero. If the same sleep pattern returns after travel, or a training adjustment changes both energy and recovery, the earlier context should be available. That is where a personal health assistant can become more useful than another isolated dashboard: not by collecting everything, but by remembering what changed the answer.
    `.trim(),
    description:
      "A practical way to turn wearable signals into a useful next step without treating every number as a verdict.",
    featured: true,
    keywords: [
      "wearable data",
      "health tracker data",
      "recovery score",
      "sleep data",
      "what to do with wearable data",
    ],
    kind: "guide",
    publishedOn: "2026-08-10",
    readingMinutes: 4,
    slug: "your-wearable-has-the-numbers-what-happens-next",
    title: "Your wearable has the numbers. What should happen next?",
  },
  {
    body: `
## Good health help starts in the middle

Most health questions arrive with a backstory. The sleep question may also be about a new medication, a late work schedule, an upcoming race, and the fact that the same problem happened last winter. If those details disappear between conversations, the person asking has to rebuild the whole picture before the help can become personal again.

A personal health assistant should be designed to start in the middle of that story. It should remember the parts that can change a later answer and leave the rest alone.

## Memory should earn its place

Remembering more is not automatically better. Useful context has a clear future job. It might change a safety boundary, explain a pattern, rule out an unrealistic plan, or prevent the same question from being asked again.

That creates a simple standard for saved context:

1. It came from a normal conversation or an authorized source.
2. It has a clear reason to matter later.
3. It can be retrieved when it changes the answer or action.
4. The person can inspect, correct, or remove it through the appropriate control.

Without the third step, memory is just collection. The proof is a later moment that becomes more useful because the right detail returned at the right time.

## Context is more than data

Wearables, labs, and records matter, but so do ordinary constraints. A plan that ignores shift work, childcare, budget, food preferences, an old injury, or the way someone likes to communicate is not personal merely because it contains biometric data.

The assistant also needs to know when not to reuse something. Private context should stay private by default. A detail shared in one relationship should not drift into a group conversation or public surface because it happens to be relevant.

## The goal is less repetition, not more surveillance

The best sign that memory is working is quiet. Fewer repeated questions. A recommendation that fits without another intake. A reminder that arrives with the reason it matters. A new suggestion that acknowledges what already failed.

That is the whole-picture advantage Murph is built to pursue. It is a product direction we still have to prove through better later decisions, not a claim that more stored data automatically creates better health.
    `.trim(),
    description:
      "Why useful health context is about better later decisions, not collecting the largest possible profile.",
    featured: false,
    keywords: [
      "personal health assistant",
      "AI health assistant memory",
      "health context",
      "personalized health AI",
    ],
    kind: "field-note",
    publishedOn: "2026-08-08",
    readingMinutes: 4,
    slug: "a-personal-health-assistant-should-remember-the-whole-picture",
    title: "A personal health assistant should remember the whole picture",
  },
  {
    body: `
## Start with a decision worth changing

A personal health experiment is useful when the real problem is uncertainty. You are not asking for another list of possible benefits. You want to know whether one reasonable change is worth keeping in your own life.

Begin with the decision you expect to make at the end. Keep the routine? Stop it? Change the timing? Try a different option? If no result could change what you do, the experiment probably does not need to happen.

## Make one question small enough to answer

Choose one intervention and a short list of outcomes that matter to you. A useful outcome can be a measurement, but it can also be a consistent observation such as afternoon energy, ease of falling asleep, or whether a routine fits the day.

Write down the basics before starting:

- what you are changing
- what you are keeping steady when practical
- how long you will try it
- what you will notice or measure
- what would make you stop early
- what decision each possible result would support

This is enough structure to learn something without turning ordinary life into a lab.

## Expect imperfect days

Travel, illness, missed days, and unusual stress are not moral failures. They are context. Record the few events that could materially change the interpretation, then keep going if the experiment still makes sense.

Avoid rewriting the rules halfway through just to rescue the result. If the setup was not workable, that is useful information. End it, adjust the design, and decide whether a cleaner second attempt is worth the effort.

## Review what changed and what did not

At the end, compare the result with the original decision. Look at the direction, consistency, size of the change, and how confident you are that the intervention mattered. Also ask whether the routine was tolerable enough to keep.

The honest conclusions are often modest: worth continuing, probably not worth it, promising but unclear, or stopped for a good reason. An experiment should reduce uncertainty. It does not need to manufacture certainty.

## Know when not to experiment

Do not use a self-directed experiment as a substitute for diagnosis, urgent care, or professional guidance when risk or symptoms call for it. The lightest useful next step may be a direct answer or a conversation with a clinician, not a protocol.

The point is not to run more experiments. It is to use one when learning what works for you would change a real decision.
    `.trim(),
    description:
      "A lightweight framework for learning from one change without turning your life into a spreadsheet.",
    featured: false,
    keywords: [
      "personal health experiment",
      "n of 1 experiment",
      "self experiment health",
      "health experiment template",
    ],
    kind: "guide",
    publishedOn: "2026-08-06",
    readingMinutes: 5,
    slug: "how-to-run-a-useful-health-experiment",
    title: "How to run a useful health experiment",
  },
] satisfies readonly BlogArticle[];

export const BLOG_KIND_LABELS: Record<BlogArticleKind, string> = {
  "case-study": "Case study",
  "field-note": "Field note",
  guide: "Guide",
};

export const BLOG_ARTICLES = validateBlogArticles(BLOG_ARTICLE_REGISTRY);

export function buildBlogArticlePath(slug: string): string {
  return `/blog/${slug}`;
}

export function getBlogArticle(slug: string): BlogArticle | null {
  return BLOG_ARTICLES.find((article) => article.slug === slug) ?? null;
}

export function listRelatedBlogArticles(
  article: BlogArticle,
  limit = 2,
): readonly BlogArticle[] {
  const articleKeywords = new Set(article.keywords.flatMap(tokenizeSearchText));

  return BLOG_ARTICLES
    .filter((candidate) => candidate.slug !== article.slug)
    .map((candidate) => ({
      article: candidate,
      score: candidate.keywords
        .flatMap(tokenizeSearchText)
        .filter((token) => articleKeywords.has(token)).length,
    }))
    .sort((left, right) =>
      right.score - left.score
      || right.article.publishedOn.localeCompare(left.article.publishedOn),
    )
    .slice(0, limit)
    .map(({ article: candidate }) => candidate);
}

export function validateBlogArticles(
  articles: readonly BlogArticle[],
): readonly BlogArticle[] {
  const slugs = new Set<string>();
  let featuredCount = 0;

  for (const article of articles) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(article.slug)) {
      throw new TypeError(`Invalid blog slug: ${article.slug}`);
    }
    if (slugs.has(article.slug)) {
      throw new TypeError(`Duplicate blog slug: ${article.slug}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(article.publishedOn)) {
      throw new TypeError(`Invalid blog publication date: ${article.slug}`);
    }
    if (!Number.isInteger(article.readingMinutes) || article.readingMinutes < 1) {
      throw new TypeError(`Invalid blog reading time: ${article.slug}`);
    }
    if (article.keywords.length === 0) {
      throw new TypeError(`Missing blog search keywords: ${article.slug}`);
    }
    if (article.kind === "case-study") {
      if (!article.evidence.consentConfirmed) {
        throw new TypeError(`Unconfirmed case-study consent: ${article.slug}`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(article.evidence.verifiedOn)) {
        throw new TypeError(`Invalid case-study verification date: ${article.slug}`);
      }
      if (!article.evidence.resultSummary.trim()) {
        throw new TypeError(`Missing case-study result: ${article.slug}`);
      }
    }

    slugs.add(article.slug);
    featuredCount += article.featured ? 1 : 0;
  }

  if (featuredCount !== 1) {
    throw new TypeError("The blog registry must contain exactly one featured article.");
  }

  return [...articles].sort((left, right) =>
    right.publishedOn.localeCompare(left.publishedOn),
  );
}

export function tokenizeSearchText(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length > 2);
}
