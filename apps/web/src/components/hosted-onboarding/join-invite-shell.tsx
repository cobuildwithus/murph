import Link from "next/link";
import type { ReactNode } from "react";

export function JoinInviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <style>{`#site-footer { display: none; }`}</style>
      <aside className="relative hidden w-60 shrink-0 flex-col overflow-hidden bg-gradient-to-br from-[#2d3436] via-[#3a2e24] to-[#2a1f16] px-8 py-10 text-white md:flex lg:w-[280px] lg:px-10">
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

        <div className="relative mt-auto flex flex-col gap-3">
          <h2 className="font-serif text-[18px] leading-[1.3] font-light tracking-[-0.01em] text-white/90 lg:text-[20px]">
            Private experiments.
            <br />
            Clear results.
          </h2>
          <p className="text-[13px] leading-relaxed text-white/45">
            Murph helps you run personal health experiments with clarity and
            privacy. You own your data.
          </p>
        </div>

        <div className="relative mt-12 flex items-center gap-2.5">
          <span className="size-1.5 rounded-full bg-[#B5C4A1]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
            Private by default
          </span>
        </div>
      </aside>

      <header className="flex items-center bg-gradient-to-br from-[#2d3436] via-[#3a2e24] to-[#2a1f16] px-6 py-5 md:hidden">
        <Link href="/" aria-label="Murph home" className="inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.svg" alt="Murph" className="h-6" />
        </Link>
      </header>

      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-12 sm:px-10 sm:py-16 lg:px-20">
        <div className="w-full max-w-xl">{children}</div>
      </section>
    </main>
  );
}
