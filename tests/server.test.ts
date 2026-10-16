import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { KaitenConfig } from "../src/config.js";
import { KaitenClient } from "../src/kaiten-client.js";
import { createServer } from "../src/server.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("registers and serves kaiten_read_linked_document over MCP", async () => {
  const uid = "a3f7c2d1-84e5-4b2a-9c6f-1d2e3f4a5b6c";
  const config: KaitenConfig = {
    apiBaseUrl: new URL("https://kaiten.example.test/api/v1"),
    token: "secret-token",
    defaultSpaceId: 419708,
    allowedSpaceIds: new Set([419708]),
    allowedBoardIds: new Set([977529]),
    allowedFileHosts: new Set(),
    maxAttachmentBytes: 1024,
  };
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/cards/49505819") {
      return jsonResponse({
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        properties: {
          id_408025: `https://kaiten.example.test/document/${uid}`,
        },
      });
    }
    if (url.pathname === "/api/v1/spaces/419708/boards") {
      return jsonResponse([{ id: 977529, title: "Sprint" }]);
    }
    if (url.pathname === "/api/v1/company/custom-properties") {
      return jsonResponse([
        {
          id: 408025,
          name: "Ссылка на постановку",
          type: "url",
          condition: "active",
        },
      ]);
    }
    if (url.pathname === `/api/latest/documents/${uid}`) {
      return jsonResponse({
        uid,
        id: 42,
        title: "Постановка",
        version: 3,
        data: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Текст документа" }],
            },
          ],
        },
      });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const server = createServer(new KaitenClient(config, fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "kaiten_read_linked_document")).toBe(
      true,
    );

    const response = await client.callTool({
      name: "kaiten_read_linked_document",
      arguments: {
        card: 49505819,
        property_name: "Ссылка на постановку",
      },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as
      | { result?: unknown }
      | undefined;
    const result = structured?.result as
      | { document?: { title?: string; text?: string } }
      | undefined;
    expect(result?.document).toEqual(
      expect.objectContaining({
        title: "Постановка",
        text: "Текст документа",
      }),
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_add_time_log over MCP", async () => {
  const config: KaitenConfig = {
    apiBaseUrl: new URL("https://kaiten.example.test/api/v1"),
    token: "secret-token",
    defaultSpaceId: 419708,
    allowedSpaceIds: new Set([419708]),
    allowedBoardIds: new Set([977529]),
    allowedFileHosts: new Set(),
    maxAttachmentBytes: 1024,
    expectedActorId: 703452,
  };
  const requests: Array<{ method: string; url: string; body?: string }> = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({
      method: init?.method ?? "GET",
      url: String(input),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (url.pathname === "/api/v1/users/current") {
      return jsonResponse({ id: 703452, username: "andrey" });
    }
    if (url.pathname === "/api/v1/cards/49505819") {
      return jsonResponse({
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      });
    }
    if (url.pathname === "/api/v1/spaces/419708/boards") {
      return jsonResponse([{ id: 977529, title: "Sprint", columns: [], lanes: [] }]);
    }
    if (
      url.pathname === "/api/v1/cards/49505819/time-logs" &&
      (init?.method ?? "GET") === "POST"
    ) {
      return jsonResponse({
        id: 74041,
        card_id: 49505819,
        user_id: 703452,
        role_id: -1,
        author_id: 703452,
        time_spent: 90,
        for_date: "2026-10-16T00:00:00.000Z",
        comment: "research",
      });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const server = createServer(new KaitenClient(config, fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "kaiten_add_time_log")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "kaiten_list_time_logs")).toBe(
      true,
    );

    const response = await client.callTool({
      name: "kaiten_add_time_log",
      arguments: {
        card: 49505819,
        time_spent: 90,
        for_date: "2026-10-16",
        comment: "research",
      },
    });
    if (response.isError) {
      throw new Error(
        `kaiten_add_time_log failed: ${JSON.stringify(response.content)}`,
      );
    }
    const structured = response.structuredContent as
      | { result?: unknown }
      | undefined;
    const result = structured?.result as
      | {
          id?: number;
          time_spent?: number;
          for_date?: string;
          card?: { key?: string };
        }
      | undefined;
    expect(result).toEqual(
      expect.objectContaining({
        id: 74041,
        time_spent: 90,
        for_date: "2026-10-16",
        card: expect.objectContaining({ key: "CROSS-3907" }),
      }),
    );
    expect(
      requests.some(
        (request) =>
          request.method === "POST" &&
          request.url.includes("/time-logs") &&
          request.body ===
            JSON.stringify({
              role_id: -1,
              time_spent: 90,
              for_date: "2026-10-16",
              comment: "research",
            }),
      ),
    ).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
