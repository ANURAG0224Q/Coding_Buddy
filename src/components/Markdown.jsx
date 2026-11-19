import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "./CodeBlock";

function MarkdownImpl({ content }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // CodeBlock renders its own <pre>; unwrap the markdown one.
          pre: ({ children }) => <>{children}</>,
          code({ className, children }) {
            const text = String(children ?? "").replace(/\n$/, "");
            const match = /language-([\w+#-]+)/.exec(className || "");
            const isBlock = Boolean(match) || text.includes("\n");
            if (!isBlock) return <code className="md-inline-code">{text}</code>;
            return <CodeBlock language={match ? match[1] : ""} code={text} />;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Memoised: during streaming only the growing message re-renders its markdown.
export default memo(MarkdownImpl);
