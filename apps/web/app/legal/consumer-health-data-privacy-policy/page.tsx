import fs from "node:fs/promises";
import path from "node:path";

import type { Metadata } from "next";
import Link from "next/link";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

interface HeadingBlock {
  level: 1 | 2 | 3;
  text: string;
  type: "heading";
}

interface ListBlock {
  items: string[];
  type: "list";
}

interface ParagraphBlock {
  text: string;
  type: "paragraph";
}

type MarkdownBlock = HeadingBlock | ListBlock | ParagraphBlock;

const POLICY_FILE_PATH = path.join(
  process.cwd(),
  "legal",
  "consumer-health-data-privacy-policy.md",
);

export const dynamic = "force-static";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/legal/consumer-health-data-privacy-policy",
  },
  description:
    "Murph's separate Consumer Health Data Privacy Policy covering consumer health data categories, sources, purposes, sharing, rights, deletion, appeals, and sale/no-sale.",
  openGraph: {
    type: "article",
  },
  title: "Murph Consumer Health Data Privacy Policy",
  twitter: {
    description:
      "Murph's separate Consumer Health Data Privacy Policy for health-related personal information.",
  },
});

export default async function ConsumerHealthDataPrivacyPolicyPage() {
  const markdown = await fs.readFile(POLICY_FILE_PATH, "utf8");
  const blocks = parsePolicyMarkdown(markdown);

  return (
    <main className="min-h-screen bg-[#f5f0e8] px-6 py-10 text-[#2d3436] antialiased sm:px-10 lg:px-16">
      <article className="mx-auto max-w-3xl rounded-lg border border-[#c4a882]/25 bg-[#fffcf6]/90 px-6 py-8 sm:px-10 sm:py-12">
        <div className="mb-8 flex flex-col gap-3 border-b border-[#c4a882]/25 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="text-[0.75rem] font-semibold uppercase text-[#736a58] transition-colors hover:text-[#2d3436]"
          >
            Murph
          </Link>
          <a
            href="/legal/consumer-health-data-privacy.pdf"
            className="text-[0.75rem] font-semibold uppercase text-[#5a6e32] transition-colors hover:text-[#2d3436]"
          >
            Download PDF
          </a>
        </div>
        <div className="space-y-5">{blocks.map(renderBlock)}</div>
      </article>
    </main>
  );
}

function parsePolicyMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      blocks.push({ text, type: "paragraph" });
    }
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push({ items: listItems, type: "list" });
    listItems = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        level: Math.min(headingMatch[1].length, 3) as 1 | 2 | 3,
        text: headingMatch[2],
        type: "heading",
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^-\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.type === "heading") {
    if (block.level === 1) {
      return (
        <h1
          key={`${block.type}-${index}`}
          className="font-serif text-4xl leading-tight text-[#2d3436] sm:text-5xl"
        >
          {renderInline(block.text)}
        </h1>
      );
    }

    if (block.level === 2) {
      return (
        <h2
          key={`${block.type}-${index}`}
          className="pt-5 font-serif text-2xl leading-tight text-[#2d3436]"
        >
          {renderInline(block.text)}
        </h2>
      );
    }

    return (
      <h3
        key={`${block.type}-${index}`}
        className="pt-2 text-base font-semibold text-[#2d3436]"
      >
        {renderInline(block.text)}
      </h3>
    );
  }

  if (block.type === "list") {
    return (
      <ul
        key={`${block.type}-${index}`}
        className="ml-5 list-disc space-y-2 text-[0.9375rem] leading-7 text-[#4d4533]"
      >
        {block.items.map((item, itemIndex) => (
          <li key={`${index}-${itemIndex}`}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }

  return (
    <p
      key={`${block.type}-${index}`}
      className="text-[0.9375rem] leading-7 text-[#4d4533]"
    >
      {renderInline(block.text)}
    </p>
  );
}

function renderInline(text: string) {
  const segments = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);

  return segments.map((segment, index) => {
    const linkMatch = segment.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`${segment}-${index}`}
          href={linkMatch[2]}
          className="font-semibold text-[#5a6e32] underline-offset-4 transition-colors hover:text-[#2d3436] hover:underline"
        >
          {linkMatch[1]}
        </a>
      );
    }

    const strongMatch = segment.match(/^\*\*([^*]+)\*\*$/);
    if (strongMatch) {
      return (
        <strong key={`${segment}-${index}`} className="font-semibold text-[#2d3436]">
          {strongMatch[1]}
        </strong>
      );
    }

    return segment;
  });
}
