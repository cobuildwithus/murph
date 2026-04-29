import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function JoinInviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <aside className="relative flex items-center overflow-hidden bg-gradient-to-br from-dark-warm via-dark-mid to-dark-deep px-6 py-5 text-white md:w-[260px] md:flex-col md:items-stretch md:justify-between md:px-8 md:py-10 lg:w-[300px] lg:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <Link
          href="/"
          aria-label="Murph home"
          className="relative -m-3 inline-flex min-h-11 min-w-11 items-center p-3"
        >
          <Image
            src="/logo-dark.svg"
            alt="Murph"
            height={24}
            width={96}
            priority
            className="h-6 w-auto"
          />
        </Link>
        <div className="relative hidden items-center gap-2.5 md:flex">
          <span className="size-1.5 rounded-full bg-sage" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/70">
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
