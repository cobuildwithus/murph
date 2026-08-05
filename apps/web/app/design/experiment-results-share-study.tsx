"use client";

import type { ReactNode } from "react";

import { ShareResultsCardPanel } from "@/src/components/experiments/experiment-detail/share-results-card";

const SYNTHETIC_RESULTS_CARD = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 780">
    <rect width="1200" height="780" fill="#F4EEE1"/>
    <text x="64" y="88" fill="#827C6C" font-family="monospace" font-size="20" letter-spacing="4">YOUR EXPERIMENT</text>
    <text x="64" y="165" fill="#2D3436" font-family="Georgia,serif" font-size="54" font-weight="600">Evening magnesium test</text>
    <text x="64" y="215" fill="#827C6C" font-family="sans-serif" font-size="25">Magnesium glycinate after dinner for 14 nights.</text>
    <rect x="64" y="286" width="332" height="185" rx="16" fill="#FFFCF6" stroke="#D4C4A8"/>
    <rect x="434" y="286" width="332" height="185" rx="16" fill="#FFFCF6" stroke="#D4C4A8"/>
    <rect x="804" y="286" width="332" height="185" rx="16" fill="#FFFCF6" stroke="#D4C4A8"/>
    <text x="92" y="330" fill="#827C6C" font-family="monospace" font-size="17" letter-spacing="2">SLEEP SCORE</text>
    <text x="92" y="412" fill="#2D3436" font-family="Georgia,serif" font-size="64" font-weight="600">82%</text>
    <text x="462" y="330" fill="#827C6C" font-family="monospace" font-size="17" letter-spacing="2">WAKEUPS</text>
    <text x="462" y="412" fill="#2D3436" font-family="Georgia,serif" font-size="64" font-weight="600">1.2</text>
    <text x="832" y="330" fill="#827C6C" font-family="monospace" font-size="17" letter-spacing="2">RESTING HR</text>
    <text x="832" y="412" fill="#2D3436" font-family="Georgia,serif" font-size="64" font-weight="600">58</text>
    <path d="M80 640 C210 610 290 650 390 600 S590 570 690 610 S890 560 1120 530" fill="none" stroke="#7A8C6E" stroke-width="7" stroke-linecap="round"/>
    <text x="64" y="726" fill="#827C6C" font-family="sans-serif" font-size="20">Private preview</text>
  </svg>
`)}`;

export function ExperimentResultsShareStudy() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-8">
      <div className="grid gap-8 xl:grid-cols-2" inert>
        <ResultsShareState title="Ready to share">
          <ShareResultsCardPanel
            busy={null}
            canNativeShare
            onDownload={() => {}}
            onRetry={() => {}}
            onShare={() => {}}
            previewStatus="ready"
            previewUrl={SYNTHETIC_RESULTS_CARD}
            shareError={false}
            title="Evening magnesium test"
          />
        </ResultsShareState>
        <ResultsShareState title="Download-only browser">
          <ShareResultsCardPanel
            busy={null}
            canNativeShare={false}
            onDownload={() => {}}
            onRetry={() => {}}
            onShare={() => {}}
            previewStatus="ready"
            previewUrl={SYNTHETIC_RESULTS_CARD}
            shareError={false}
            title="Evening magnesium test"
          />
        </ResultsShareState>
        <ResultsShareState title="Preparing preview">
          <ShareResultsCardPanel
            busy={null}
            canNativeShare={false}
            onDownload={() => {}}
            onRetry={() => {}}
            onShare={() => {}}
            previewStatus="loading"
            previewUrl={null}
            shareError={false}
            title="Evening magnesium test"
          />
        </ResultsShareState>
        <ResultsShareState title="Preview recovery">
          <ShareResultsCardPanel
            busy={null}
            canNativeShare={false}
            onDownload={() => {}}
            onRetry={() => {}}
            onShare={() => {}}
            previewStatus="error"
            previewUrl={null}
            shareError={false}
            title="Evening magnesium test"
          />
        </ResultsShareState>
        <ResultsShareState title="Native share recovery">
          <ShareResultsCardPanel
            busy={null}
            canNativeShare
            onDownload={() => {}}
            onRetry={() => {}}
            onShare={() => {}}
            previewStatus="ready"
            previewUrl={SYNTHETIC_RESULTS_CARD}
            shareError
            title="Evening magnesium test"
          />
        </ResultsShareState>
      </div>
    </div>
  );
}

function ResultsShareState({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="mx-auto w-full max-w-[34rem]">
      <div className="mb-5">
        <h3 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Preview your private results card, then share it or save a copy.
        </p>
      </div>
      {children}
    </div>
  );
}
