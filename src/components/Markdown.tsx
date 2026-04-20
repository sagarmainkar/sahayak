"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { useTheme } from "next-themes";
import { Check, Copy } from "lucide-react";
import { LinkCard } from "./LinkCard";
import { Carousel } from "./Carousel";

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const lang = (className ?? "").replace("language-", "") || "text";
  const code = String(children).replace(/\n$/, "");
  const { resolvedTheme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    codeToHtml(code, {
      lang,
      theme: resolvedTheme === "dark" ? "vitesse-dark" : "vitesse-light",
    })
      .then((h) => {
        if (!cancelled) setHtml(h);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, resolvedTheme]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  return (
    <div className="my-3 overflow-hidden rounded-md border border-border bg-bg-paper">
      <div className="flex items-center justify-between border-b border-border bg-bg-muted/60 px-3 py-1 font-sans text-[10.5px] uppercase tracking-[0.15em] text-fg-subtle">
        <span>{lang}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-fg-subtle hover:text-fg"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> copy
            </>
          )}
        </button>
      </div>
      {html ? (
        <div
          className="overflow-x-auto p-3 font-mono text-[13px] leading-[1.55] [&_pre]:!bg-transparent"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-[1.55]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

function isUrlOnly(text: string): string | null {
  const s = text.trim();
  if (!/^https?:\/\//.test(s)) return null;
  if (/\s/.test(s)) return null;
  return s;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children, ...rest } = props;
            const inline = !className;
            if (inline) {
              return <code {...rest}>{children}</code>;
            }
            const lang = (className ?? "").replace("language-", "");
            if (lang === "carousel" || lang === "gallery") {
              const urls = String(children)
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => /^https?:\/\//.test(l));
              return <Carousel urls={urls} />;
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          pre(props) {
            // When CodeBlock returns null-ish (we render carousel at `code`
            // level and want to suppress pre wrapping), pass children through.
            return <>{props.children}</>;
          },
          a(props) {
            return (
              <a {...props} target="_blank" rel="noreferrer">
                {props.children}
              </a>
            );
          },
          p(props) {
            // If paragraph contains only a URL, show a link card
            const kids = props.children;
            const only =
              typeof kids === "string"
                ? isUrlOnly(kids)
                : Array.isArray(kids) && kids.length === 1 && typeof kids[0] === "string"
                  ? isUrlOnly(kids[0] as string)
                  : null;
            if (only) return <LinkCard url={only} />;
            return <p>{kids}</p>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
