import type { ReactNode } from "react";

export type PhoneMockMessage = {
  bare?: boolean;
  body: ReactNode;
  from: "user" | "murph";
  reaction?: string;
};

export function PhoneMock({
  channel,
  messages,
}: {
  channel: string;
  messages: readonly PhoneMockMessage[];
}) {
  return (
    <div className="mt-5 w-full max-w-[320px] overflow-hidden rounded-[20px] border border-[#2d3436]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_30px_-18px_rgba(45,52,54,0.22)]">
      <div className="flex items-center justify-between border-b border-[#2d3436]/8 bg-[#fafaf6] px-4 py-2.5">
        <p className="font-mono text-[10px] font-medium tracking-[0.18em] text-[#736a58] uppercase">
          {channel}
        </p>
        <span
          aria-hidden="true"
          className="font-mono text-[10px] text-[#a39684]"
        >
          now
        </span>
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        {messages.map((message, index) => (
          <ChatBubble key={index} message={message} />
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: PhoneMockMessage }) {
  const isUser = message.from === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end pl-6" : "justify-start pr-6"}`}
    >
      <div className="relative max-w-full">
        <div
          className={
            message.bare
              ? "w-full"
              : isUser
                ? "rounded-2xl rounded-br-md bg-[#3a4a1e] px-3.5 py-2 text-[13px] leading-[1.45] text-[#f5f0e8]"
                : "rounded-2xl rounded-bl-md bg-[#eee9da] px-3.5 py-2 text-[13px] leading-[1.45] text-[#2d3436]"
          }
        >
          {message.body}
        </div>
        {message.reaction ? (
          <span
            className={`absolute -bottom-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[#2d3436]/10 bg-white px-1 text-[13px] leading-none shadow-[0_1px_2px_rgba(0,0,0,0.06)] ${
              isUser ? "-left-1" : "-right-1"
            }`}
            aria-label={`Murph reacted with ${message.reaction}`}
          >
            {message.reaction}
          </span>
        ) : null}
      </div>
    </div>
  );
}
