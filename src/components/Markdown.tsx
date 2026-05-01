"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createContext, useContext, useMemo, useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { useTheme } from "next-themes";
import { Check, Copy } from "lucide-react";
import { LinkCard } from "./LinkCard";
import { Carousel } from "./Carousel";
import { ArtifactBlock } from "./ArtifactBlock";
import { TemplateBlock } from "./TemplateBlock";
import { SvgBlock } from "./SvgBlock";
import { MermaidBlock } from "./MermaidBlock";

/** Per-table context: array of column header texts (the first <th> row),
 *  used by the <td> override to inject a data-label for the mobile
 *  card-stack CSS rule. */
const TableHeadersContext = createContext<string[]>([]);

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

// Models often emit Unicode box-drawing art (┌─┐ │ … │ └─┘) as plain
// paragraphs. Markdown then soft-wraps them and they render as mashed prose.
// Wrap any run of box-art / pipe-framed lines in a fenced code block so
// whitespace is preserved — outside existing fences only.
const BOX_CHAR = /[─-╿]/;
const PIPE_FRAME = /^\s*[|│].*[|│]\s*$/;

function fenceAsciiBoxes(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      inFence = !inFence;
      out.push(l);
      i++;
      continue;
    }
    if (!inFence && BOX_CHAR.test(l)) {
      let k = i;
      while (
        k < lines.length &&
        (BOX_CHAR.test(lines[k]) || PIPE_FRAME.test(lines[k]))
      ) {
        k++;
      }
      out.push("```");
      for (let j = i; j < k; j++) out.push(lines[j]);
      out.push("```");
      i = k;
      continue;
    }
    out.push(l);
    i++;
  }
  return out.join("\n");
}

export function Markdown({
  text,
  sessionId,
  assistantId,
  streaming = false,
  onArtifactAutoFix,
}: {
  text: string;
  sessionId?: string | null;
  assistantId?: string | null;
  /** True while the parent turn is still streaming. Used to suppress
   *  parse-error UI in template fences whose JSON isn't closed yet. */
  streaming?: boolean;
  /** Forwarded to ArtifactBlock: fires when the server rejects an
   *  artifact's JSX as invalid, so Chat can kick off a silent fix
   *  turn. */
  onArtifactAutoFix?: (error: string) => void;
}) {
  const processed = fenceAsciiBoxes(text);
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children, ...rest } = props;
            // react-markdown@10 dropped the `inline` prop. A fence
            // without a language (just ```) arrives with className=
            // undefined — same as inline ` foo `. Differentiate by
            // content: block fences always carry a newline; inline
            // code never does. Without this, ``` ASCII-art ``` blocks
            // render as inline <code> in flowing prose (boxes break).
            const text = String(children ?? "");
            const inline = !className && !text.includes("\n");
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
            const src = String(children);
            if (lang === "svg") {
              return <SvgBlock source={src} />;
            }
            if (lang === "mermaid") {
              return <MermaidBlock source={src} />;
            }
            if (lang.startsWith("template:")) {
              const tid = lang.slice("template:".length);
              return (
                <TemplateBlock
                  templateId={tid}
                  source={src}
                  streaming={streaming}
                />
              );
            }
            // Full HTML documents route to the artifact iframe (srcdoc path).
            // Bare/partial HTML snippets fall through to normal code rendering
            // — we never inject raw HTML into the prose stream (XSS risk).
            if (
              lang === "html" &&
              /^\s*(<!doctype\s+html|<html[\s>])/i.test(src)
            ) {
              return (
                <ArtifactBlock
                  source={src}
                  sessionId={sessionId}
                  assistantId={assistantId}
                  onAutoFix={onArtifactAutoFix}
                />
              );
            }
            const looksLikeArtifact =
              lang === "react-artifact" ||
              lang === "jsx-artifact" ||
              lang === "artifact" ||
              // `react`/`jsx`/`tsx` blocks are treated as artifacts when the
              // model gives an explicit `// title:` header, OR when they
              // define a React component (export default / function App).
              ((lang === "react" || lang === "jsx" || lang === "tsx") &&
                (/^\s*\/\/\s*(title|id)\s*:/m.test(src) ||
                  /export\s+default\s+function/.test(src) ||
                  /\bfunction\s+App\s*\(/.test(src)));
            if (looksLikeArtifact) {
              return (
                <ArtifactBlock
                  source={src}
                  sessionId={sessionId}
                  assistantId={assistantId}
                  onAutoFix={onArtifactAutoFix}
                />
              );
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
          table(props) {
            // Walk the table's children to find the header row's cell texts,
            // and count headers to set data-cols. Provide both via context to
            // child <td>s so they can self-label.
            const headers = extractTableHeaders(props.children);
            const cols = headers.length >= 3 ? "3+" : String(headers.length || 2);
            return (
              <TableHeadersContext.Provider value={headers}>
                <table data-cols={cols}>{props.children}</table>
              </TableHeadersContext.Provider>
            );
          },
          tr(props) {
            return <TrWithLabels {...props} />;
          },
          td(props) {
            return <TdWithLabel {...props} />;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

/** Walks the table's children for the header row's <th> texts. Tolerant
 *  of missing thead (returns empty array). */
function extractTableHeaders(children: React.ReactNode): string[] {
  const out: string[] = [];
  function visitElement(el: React.ReactElement<{ children?: React.ReactNode }>) {
    const type = el.type as string | { name?: string };
    const tag = typeof type === "string" ? type : type?.name;
    if (tag === "th") {
      out.push(reactNodeToText(el.props.children));
      return;
    }
    if (el.props.children) walk(el.props.children);
  }
  function walk(node: React.ReactNode) {
    if (Array.isArray(node)) {
      for (const c of node) walk(c);
      return;
    }
    if (
      node &&
      typeof node === "object" &&
      "type" in node &&
      "props" in node
    ) {
      visitElement(node as React.ReactElement<{ children?: React.ReactNode }>);
    }
  }
  walk(children);
  return out;
}

function reactNodeToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToText).join("");
  if (typeof node === "object" && "props" in node) {
    return reactNodeToText(
      (node as React.ReactElement<{ children?: React.ReactNode }>).props.children,
    );
  }
  return "";
}

/** A <td> wrapper that's a no-op for now — the actual data-label
 *  injection happens at the <tr> level via cloneElement, which is
 *  more reliable than trying to compute the column index from inside
 *  a <td> without sibling visibility. We still need this override so
 *  react-markdown doesn't strip the data-label that TrWithLabels
 *  attaches via cloneElement. */
function TdWithLabel(
  props: React.ComponentPropsWithoutRef<"td"> & { node?: unknown },
) {
  const { node: _ignored, ...rest } = props;
  return <td {...rest} />;
}

/** A <tr> that walks its children, finds <td> elements, and injects
 *  data-label by index from the surrounding TableHeadersContext. */
function TrWithLabels(props: React.ComponentPropsWithoutRef<"tr"> & { node?: unknown }) {
  const headers = useContext(TableHeadersContext);
  const { node: _ignored, children, ...rest } = props;
  const labeled = useMemo(() => {
    let tdIndex = 0;
    function map(node: React.ReactNode): React.ReactNode {
      if (Array.isArray(node)) return node.map(map);
      if (
        node &&
        typeof node === "object" &&
        "type" in node &&
        "props" in node
      ) {
        const el = node as React.ReactElement<{
          children?: React.ReactNode;
          [key: string]: unknown;
        }>;
        const type = el.type as string | { name?: string };
        const tag = typeof type === "string" ? type : type?.name;
        if (tag === "td" || (typeof type === "function" && (type as { name?: string }).name === "TdWithLabel")) {
          const label = headers[tdIndex] ?? "";
          tdIndex++;
          if (!label) return el;
          return {
            ...el,
            props: { ...el.props, "data-label": label },
          } as React.ReactElement;
        }
      }
      return node;
    }
    return map(children);
  }, [children, headers]);
  return <tr {...rest}>{labeled}</tr>;
}
