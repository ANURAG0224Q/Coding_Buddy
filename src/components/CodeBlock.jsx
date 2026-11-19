import { useMemo, useState } from "react";
import hljs from "highlight.js";
import { Check, Copy } from "lucide-react";

function escapeHtml(text) {
  return text
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll(">", ">");
}

export default function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => {
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  }, [code, language]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions/insecure context) — nothing to do
    }
  };

  return (
    <div className="codeblock" data-testid="code-block">
      <div className="codeblock-header">
        <span className="codeblock-lang">{language || "text"}</span>
        <button
          type="button"
          className={`codeblock-copy${copied ? " copied" : ""}`}
          data-testid="code-copy-button"
          onClick={copy}
          aria-label={copied ? "Code copied" : "Copy code"}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
