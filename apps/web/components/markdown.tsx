// Text that people and agents wrote, read as Markdown: bold and italics, lists, tables, task lists, code and links
// (GitHub-flavoured), with a single line break kept where it was typed. Raw HTML is never rendered and unsafe link
// schemes are dropped. Size and colour come from the element around it; `.md` in globals.css spaces the blocks.
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

type Plugins = NonNullable<Options["remarkPlugins"]>;

const external = (href?: string) => Boolean(href && /^(https?:)?\/\//i.test(href));

const base: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a href={href} {...rest} {...(external(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  ),
  // A wide table scrolls inside its own frame rather than widening the page.
  table: ({ node: _node, children, ...rest }) => (
    <div className="md-table">
      <table {...rest}>{children}</table>
    </div>
  ),
  // An image in someone's text is shown as a link to it, never fetched on the page.
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || src}
      </a>
    ) : (
      (alt ?? null)
    ),
};

// Inline: for one-liners inside a sentence, a list row, a link or a clamped preview. Every block (paragraph, list,
// quote, code, table) is drawn with spans styled like it, so the markup stays valid inside a <p>, <a> or <button>:
// a real <ul> or <div> there would make the browser close the <p> early and the server render stop matching.
// Inside a link or button (`links={false}`) its own links and checkboxes are unwrapped to their text.
const BLOCKS = [
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
] as const;

const inline: Components = {
  ...base,
  ...Object.fromEntries(
    BLOCKS.map((tag) => [
      tag,
      ({ children, className, style }: { children?: ReactNode; className?: string; style?: CSSProperties }) => (
        <span className={className ? `mdi-${tag} ${className}` : `mdi-${tag}`} style={style}>
          {children}
        </span>
      ),
    ]),
  ),
};

export function Markdown({
  children,
  className = "",
  remarkPlugins = [],
  components,
}: {
  children: string;
  className?: string;
  remarkPlugins?: Plugins;
  components?: Components;
}) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, ...remarkPlugins]}
        components={components ? { ...base, ...components } : base}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function InlineMarkdown({
  children,
  className = "",
  links = true,
}: {
  children: string;
  className?: string;
  links?: boolean;
}) {
  return (
    <span className={`md md-inline ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={inline}
        disallowedElements={links ? undefined : ["a", "img", "input"]}
        unwrapDisallowed
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}
