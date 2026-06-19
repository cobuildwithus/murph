"use client";

import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

export function PhoneChatScroller({
  children,
  conversationHeight,
}: {
  children: ReactNode;
  conversationHeight: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  const style: CSSProperties = {
    height: conversationHeight,
    scrollbarWidth: "none",
    msOverflowStyle: "none",
    maskImage:
      "linear-gradient(to bottom, transparent 0px, rgba(0,0,0,0.5) 42px, #000 96px)",
    WebkitMaskImage:
      "linear-gradient(to bottom, transparent 0px, rgba(0,0,0,0.5) 42px, #000 96px)",
  };

  return (
    <div
      ref={ref}
      className="overflow-y-auto [&::-webkit-scrollbar]:hidden"
      style={style}
    >
      {children}
    </div>
  );
}
