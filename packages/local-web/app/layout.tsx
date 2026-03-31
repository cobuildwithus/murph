import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

import "./globals.css";

const GITHUB_REPO_URL = "https://github.com/cobuildwithus/murph";

export const metadata: Metadata = {
  title: "Murph Observatory",
  description: "A local-only read surface over the open-source Murph vault, licensed under GPL 3.0.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-bg text-foreground selection:bg-accent selection:text-bg font-body antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="flex min-h-screen flex-col">
            <div className="flex-1">{children}</div>
            <footer className="border-t border-line/70 bg-paper/70">
              <div className="mx-auto flex max-w-[1080px] flex-col gap-2 px-6 py-4 text-sm text-muted max-sm:px-4">
                <p className="leading-relaxed">
                  Murph is open source and licensed under GPL 3.0.
                </p>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-display text-[0.8rem] font-bold tracking-[0.12em] uppercase text-accent transition-colors hover:text-foreground"
                >
                  View the GitHub repo
                </a>
              </div>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
