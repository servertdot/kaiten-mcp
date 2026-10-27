import { describe, expect, test } from "bun:test";

import {
  documentReferenceFromUrl,
  documentUrlFromProperty,
  proseMirrorToMarkdown,
} from "../src/document.js";

describe("Kaiten documents", () => {
  test("extracts a document UID from path and hash URLs", () => {
    const uid = "a3f7c2d1-84e5-4b2a-9c6f-1d2e3f4a5b6c";

    expect(
      documentReferenceFromUrl(
        `https://kaiten.example.test/space/419708/documents/${uid}`,
        "https://kaiten.example.test",
      ),
    ).toBe(uid);
    expect(
      documentReferenceFromUrl(
        `https://kaiten.example.test/#/space/419708/document/${uid}`,
        "https://kaiten.example.test",
      ),
    ).toBe(uid);
  });

  test("accepts an object-shaped URL property", () => {
    expect(
      documentUrlFromProperty({
        url: "https://kaiten.example.test/document/SPEC_1",
      }),
    ).toBe("https://kaiten.example.test/document/SPEC_1");
  });

  test("rejects a linked document on another origin", () => {
    expect(() =>
      documentReferenceFromUrl(
        "https://evil.example.test/document/SPEC_1",
        "https://kaiten.example.test",
      ),
    ).toThrow("expected https://kaiten.example.test");
  });

  test("converts common ProseMirror nodes to readable Markdown", () => {
    expect(
      proseMirrorToMarkdown({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Постановка" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Добавить ", marks: [{ type: "bold" }] },
              {
                type: "text",
                text: "новый сценарий",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://example.test/spec" },
                  },
                ],
              },
            ],
          },
          {
            type: "bullet_list",
            content: [
              {
                type: "list_item",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Первый пункт" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(
      "## Постановка\n\n**Добавить **[новый сценарий](https://example.test/spec)\n\n- Первый пункт",
    );
  });
});

test("converts Markdown structure and preserves line breaks", async () => {
  const { markdownToProseMirror } = await import("../src/document.js");
  const doc = markdownToProseMirror("# Заголовок\n\nОдин\nдва  \n**три**\n\n- пункт\n  - вложенный\n\n| A | B |\n|---|---|\n| C | D |");
  expect(doc.content?.map((node) => node.type)).toEqual(["heading1", "paragraph", "bullet_list", "table"]);
  expect(doc.content?.[1]?.content).toEqual([
    { type: "text", text: "Один" }, { type: "text", text: " " },
    { type: "text", text: "два" }, { type: "hard_break" },
    { type: "text", text: "три", marks: [{ type: "strong" }] },
  ]);
  expect(doc.content?.[2]?.content?.[0]?.content?.[1]?.type).toBe("bullet_list");
  expect(doc.content?.[3]?.content?.[0]?.content?.[0]?.type).toBe("table_header");
  expect(() => markdownToProseMirror("- [x] task")).toThrow("task lists");
});

test("extracts UID from the standard /documents/d/ URL", () => {
  const uid = "a3f7c2d1-84e5-4b2a-9c6f-1d2e3f4a5b6c";
  expect(documentReferenceFromUrl(`https://kaiten.example.test/documents/d/${uid}`, "https://kaiten.example.test")).toBe(uid);
});
