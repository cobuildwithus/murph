import Markdown from "markdown-to-jsx/react";
import type { ComponentProps } from "react";

type Props = {
  content: string;
  className?: string;
};

function SafeLink(props: ComponentProps<"a">) {
  const href = props.href ?? "";
  const isExternal =
    href.startsWith("http://") || href.startsWith("https://");

  return (
    <a
      {...props}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
    />
  );
}

export function MarkdownView({ content, className }: Props) {
  return (
    <article className={className ?? "prose max-w-none"}>
      <Markdown
        options={{
          disableParsingRawHTML: true,
          overrides: {
            a: SafeLink,
          },
        }}
      >
        {content}
      </Markdown>
    </article>
  );
}
