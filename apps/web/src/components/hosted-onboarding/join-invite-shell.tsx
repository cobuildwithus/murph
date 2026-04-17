import Link from "next/link";
import type { ReactNode } from "react";

export function JoinInviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-[#f5f0e8] text-[#2d3436]">
      <header className="px-6 pt-6 sm:px-10 sm:pt-8 lg:px-16">
        <Link href="/" className="inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Murph" className="h-6" />
        </Link>
      </header>
      <div className="flex flex-1 items-start justify-center px-5 py-10 sm:px-8 sm:py-16">
        <div className="w-full max-w-xl">{children}</div>
      </div>
    </main>
  );
}
