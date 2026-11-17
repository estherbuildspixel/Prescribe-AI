import { memo, type ReactNode } from "react";
import { parseMarkdown } from "@/lib/markdown";

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function FormattedComponent({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return block.level <= 3 ? (
            <h3 key={index} className="pt-0.5 text-sm font-semibold tracking-tight">
              {renderInline(block.text)}
            </h3>
          ) : (
            <h4
              key={index}
              className="pt-0.5 text-xs font-semibold uppercase tracking-wide text-primary"
            >
              {renderInline(block.text)}
            </h4>
          );
        }
        if (block.type === "hr") {
          return <hr key={index} className="border-border" />;
        }
        if (block.type === "p") {
          return (
            <p key={index} className="leading-relaxed">
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5 marker:text-primary">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="leading-relaxed">
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <ol
            key={index}
            className="list-decimal space-y-1.5 pl-5 marker:text-primary"
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="leading-relaxed">
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}

export const Formatted = memo(FormattedComponent);
