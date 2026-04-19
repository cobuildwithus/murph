"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function InstallCopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied install command" : "Copy install command"}
      className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-[#f5f0e8]/45 transition-colors hover:bg-white/5 hover:text-[#f5f0e8]/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#f5f0e8]/40"
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}
