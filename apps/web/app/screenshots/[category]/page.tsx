import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionsContent } from "../../design/sections-content";
import { SCREENSHOT_CATEGORIES } from "../categories";

export const dynamicParams = false;

export function generateStaticParams() {
  return SCREENSHOT_CATEGORIES.map(({ id }) => ({ category: id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const requestedCategory = (await params).category;
  const category = SCREENSHOT_CATEGORIES.find(
    (candidate) => candidate.id === requestedCategory,
  );

  return {
    title: category
      ? `${category.label} | Murph screenshots`
      : "Murph | Screenshots",
    robots: { follow: false, index: false },
  };
}

export default async function ScreenshotCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const requestedCategory = (await params).category;
  const category = SCREENSHOT_CATEGORIES.find(
    (candidate) => candidate.id === requestedCategory,
  );

  if (!category) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f5f0e8] text-[#2d3436]">
      <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 lg:px-12">
        <Link
          className="text-sm text-[#736a58] underline decoration-[#c4a882] underline-offset-4 hover:text-[#2d3436]"
          href="/screenshots"
        >
          All screenshot studies
        </Link>
      </div>
      <SectionsContent category={category.id} />
    </main>
  );
}
