import Link from "next/link";
import type { ReactNode } from "react";

export function JoinInviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <aside className="relative flex items-center overflow-hidden bg-gradient-to-br from-[#2d3436] via-[#3a2e24] to-[#2a1f16] px-6 py-5 text-white md:w-[260px] md:flex-col md:items-stretch md:justify-between md:px-8 md:py-10 lg:w-[300px] lg:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <Link href="/" aria-label="Murph home" className="relative inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.svg" alt="Murph" className="h-6" />
        </Link>
        <div className="relative hidden items-center gap-2.5 md:flex">
          <span className="size-1.5 rounded-full bg-[#B5C4A1]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
            Private by default
          </span>
        </div>
      </aside>

      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-12 sm:px-10 sm:py-16 lg:px-16">
        <div className="w-full max-w-2xl">{children}</div>
      </section>
    </main>
  );
}
