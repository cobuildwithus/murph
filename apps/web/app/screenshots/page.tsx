import type { Metadata } from "next";
import Link from "next/link";
import { SCREENSHOT_CATEGORIES } from "./categories";

export const metadata: Metadata = {
  title: "Murph | Screenshots",
  description: "Synthetic presentation states for product review.",
  robots: { follow: false, index: false },
};

export default function ScreenshotsPage() {
  return (
    <main className="min-h-screen bg-[#f5f0e8] px-5 py-12 text-[#2d3436] sm:px-8 lg:px-12">
      <div className="mx-auto max-w-5xl">
        <header className="max-w-3xl border-b border-[#c4a882]/30 pb-10">
          <h1 className="font-serif text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">
            Screenshots
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[#736a58]">
            Stable synthetic states for checking presentation. Use the real
            product journey to prove behavior and value.
          </p>
        </header>

        <nav aria-label="Screenshot categories" className="mt-10">
          <ul className="divide-y divide-[#c4a882]/30 border-y border-[#c4a882]/30">
            {SCREENSHOT_CATEGORIES.map((category) => (
              <li key={category.id}>
                <Link
                  className="group grid gap-2 py-6 sm:grid-cols-[minmax(0,220px)_1fr_auto] sm:items-baseline sm:gap-8"
                  href={`/screenshots/${category.id}`}
                >
                  <span className="font-serif text-2xl font-semibold tracking-[-0.02em] transition-colors group-hover:text-[#5a6e32]">
                    {category.label}
                  </span>
                  <span className="max-w-2xl text-sm leading-6 text-[#736a58]">
                    {category.description}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-[0.11em] text-[#736a58] group-hover:text-[#2d3436]">
                    Open
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
