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
