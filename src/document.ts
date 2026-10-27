import { createHash } from "node:crypto";
import type {
  KaitenCustomPropertyValue,
  ProseMirrorMark,
  ProseMirrorNode,
} from "./types.js";

const DOCUMENT_ROUTE =
  /(?:^|\/)(?:document|documents|doc|docs)\/(?:d\/)?([a-zA-Z0-9_-]+)(?:\/|$)/;

export function documentContentRevision(data: ProseMirrorNode | null | undefined, uid: string): string | null {
  if (!data || data.type !== "doc" || !Array.isArray(data.content)) return null;
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]));
    return value;
  };
  return createHash("sha256").update(JSON.stringify(stable({ uid, data }))).digest("hex");
}

function stringAttribute(
  attrs: Record<string, unknown> | undefined,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = attrs?.[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function documentUrlFromProperty(
  value: KaitenCustomPropertyValue | undefined,
): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && !Array.isArray(value) && typeof value === "object") {
    for (const name of ["url", "href", "value"]) {
      const candidate = value[name];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  throw new Error("Linked-document property does not contain a URL");
}

export function documentReferenceFromUrl(
  value: string,
  expectedOrigin: string,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Linked-document property is not a valid absolute URL");
  }

  if (url.origin !== expectedOrigin) {
    throw new Error(
      `Linked document belongs to ${url.origin}, expected ${expectedOrigin}`,
    );
  }

  for (const name of ["document_uid", "documentUid", "document", "uid"]) {
    const candidate = url.searchParams.get(name)?.trim();
    if (candidate) return candidate;
  }

  const route = decodeURIComponent(
    `${url.pathname}/${url.hash.replace(/^#\/?/, "")}`,
  );
  const match = route.match(DOCUMENT_ROUTE);
  if (!match?.[1]) {
    throw new Error("Kaiten document UID or key was not found in the URL");
  }
  return match[1];
}

export function isDocumentUid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function applyMarks(text: string, marks: ProseMirrorMark[] | undefined): string {
  return (marks ?? []).reduce((result, mark) => {
    switch (mark.type) {
      case "bold":
      case "strong":
        return `**${result}**`;
      case "italic":
      case "em":
        return `_${result}_`;
      case "strike":
      case "strikethrough":
        return `~~${result}~~`;
      case "code":
        return `\`${result}\``;
      case "link": {
        const href = stringAttribute(mark.attrs, "href", "url");
        return href ? `[${result}](${href})` : result;
      }
      default:
        return result;
    }
  }, text);
}

function renderInline(node: ProseMirrorNode): string {
  if (node.type === "text") return applyMarks(node.text ?? "", node.marks);
  if (["hard_break", "hardBreak"].includes(node.type)) return "\n";
  if (node.type === "image") {
    const src = stringAttribute(node.attrs, "src", "url");
    const alt = stringAttribute(node.attrs, "alt", "title") ?? "image";
    return src ? `![${alt}](${src})` : `[${alt}]`;
  }
  if (["mention", "user_mention", "userMention"].includes(node.type)) {
    return stringAttribute(node.attrs, "label", "name", "text") ?? "@user";
  }
  return (node.content ?? []).map(renderInline).join("");
}

function renderListItem(node: ProseMirrorNode, prefix: string): string {
  const blocks = (node.content ?? []).map(renderBlock).filter(Boolean);
  const body = blocks.join("\n\n").replace(/\n/g, "\n  ");
  return `${prefix}${body}`.trimEnd();
}

function renderTable(node: ProseMirrorNode): string {
  const rows = (node.content ?? [])
    .filter((row) => ["table_row", "tableRow"].includes(row.type))
    .map((row) =>
      (row.content ?? []).map((cell) =>
        (cell.content ?? [])
          .map(renderBlock)
          .join(" ")
          .replace(/\|/g, "\\|")
          .replace(/\n+/g, " ")
          .trim(),
      ),
    );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ]);
  const header = normalized[0]!;
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderBlock(node: ProseMirrorNode): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map(renderBlock).filter(Boolean).join("\n\n");
    case "paragraph":
      return (node.content ?? []).map(renderInline).join("");
    case "heading1":
    case "heading2":
    case "heading3":
      return `${"#".repeat(Number(node.type.slice(-1)))} ${(node.content ?? []).map(renderInline).join("")}`;
    case "heading": {
      const requestedLevel = Number(node.attrs?.level ?? 1);
      const level = Number.isInteger(requestedLevel)
        ? Math.min(Math.max(requestedLevel, 1), 6)
        : 1;
      return `${"#".repeat(level)} ${(node.content ?? []).map(renderInline).join("")}`;
    }
    case "bullet_list":
    case "bulletList":
      return (node.content ?? [])
        .map((item) => renderListItem(item, "- "))
        .join("\n");
    case "ordered_list":
    case "orderedList": {
      const start = Number(node.attrs?.start ?? node.attrs?.order ?? 1);
      return (node.content ?? [])
        .map((item, index) =>
          renderListItem(item, `${(Number.isFinite(start) ? start : 1) + index}. `),
        )
        .join("\n");
    }
    case "list_item":
    case "listItem":
      return (node.content ?? []).map(renderBlock).filter(Boolean).join("\n\n");
    case "task_list":
    case "taskList":
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked === true ? "x" : " ";
          return renderListItem(item, `- [${checked}] `);
        })
        .join("\n");
    case "task_item":
    case "taskItem":
      return (node.content ?? []).map(renderBlock).filter(Boolean).join("\n\n");
    case "blockquote":
      return (node.content ?? [])
        .map(renderBlock)
        .filter(Boolean)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "code_block":
    case "codeBlock": {
      const language = stringAttribute(node.attrs, "language", "lang") ?? "";
      const code = (node.content ?? []).map(renderInline).join("");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case "horizontal_rule":
    case "horizontalRule":
      return "---";
    case "table":
      return renderTable(node);
    case "image":
      return renderInline(node);
    default:
      return (node.content ?? []).map(renderBlock).filter(Boolean).join("\n\n");
  }
}

export function proseMirrorToMarkdown(data: ProseMirrorNode | null | undefined): string {
  if (!data) return "";
  return renderBlock(data).replace(/\n{3,}/g, "\n\n").trim();
}

// Parse Markdown with Bun and translate its element tree to Kaiten nodes.
export function markdownToProseMirror(markdown: string): ProseMirrorNode {
  type Element = { type?: string | symbol; props?: Record<string, unknown> };
  const unsupported = (name: string): never => { throw new Error(`Unsupported Markdown: ${name}`); };
  const convert = (value: unknown, marks: ProseMirrorMark[] = [], code = false): ProseMirrorNode[] => {
    if (Array.isArray(value)) return value.flatMap((item) => convert(item, marks, code));
    if (typeof value === "string") {
      const text = code ? value : value.replace(/\n/g, " ");
      return text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : [];
    }
    if (!value || typeof value !== "object") return [];
    const element = value as Element;
    const props = element.props ?? {};
    const type = element.type;
    const children = () => convert(props.children, marks, code);
    if (type === Symbol.for("react.fragment")) return children();
    const node = (name: string): ProseMirrorNode[] => [{ type: name, content: children() }];
    const marked = (mark: ProseMirrorMark) => convert(props.children, [...marks, mark], code);
    switch (type) {
      case undefined: return children();
      case "p": return node("paragraph");
      case "h1": case "h2": case "h3": return node(`heading${type[1]}`);
      case "h4": case "h5": case "h6": return unsupported("heading levels 4–6");
      case "strong": return marked({ type: "strong" });
      case "em": return marked({ type: "em" });
      case "del": return marked({ type: "strike" });
      case "code": return marked({ type: "code" });
      case "a": return marked({ type: "link", attrs: { href: props.href, ...(props.title ? { title: props.title } : {}) } });
      case "br": return [{ type: "hard_break" }];
      case "blockquote": return node("blockquote");
      case "pre": return [{ type: "code_block", ...(typeof props.language === "string" ? { attrs: { language: props.language } } : {}), content: convert(props.children, [], true) }];
      case "hr": return [{ type: "horizontal_rule" }];
      case "ul": return node("bullet_list");
      case "ol": return [{ type: "ordered_list", ...(typeof props.start === "number" ? { attrs: { order: props.start } } : {}), content: children() }];
      case "li": {
        if (props.checked !== undefined) return unsupported("task lists");
        const nodes = children();
        const firstBlock = nodes.findIndex((n) => n.type !== "text" && n.type !== "hard_break");
        const split = firstBlock < 0 ? nodes.length : firstBlock;
        const content = split > 0 ? [{ type: "paragraph", content: nodes.slice(0, split) }, ...nodes.slice(split)] : nodes;
        if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph", content: [] });
        return [{ type: "list_item", content }];
      }
      case "table": return node("table");
      case "thead": case "tbody": return children();
      case "tr": return node("table_row");
      case "th": case "td": return [{ type: type === "th" ? "table_header" : "table_cell", content: [{ type: "paragraph", content: children() }] }];
      case "img": return unsupported("images");
      case "html": return unsupported("HTML");
      default: return unsupported(String(type));
    }
  };
  const content = convert(Bun.markdown.react(markdown));
  if (!content.length) throw new Error("Markdown must contain at least one block");
  return { type: "doc", content };
}
