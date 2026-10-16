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

function baseWriteConfig(): KaitenConfig {
  return {
    apiBaseUrl: new URL("https://kaiten.example.test/api/v1"),
    token: "secret-token",
    defaultSpaceId: 419708,
    allowedSpaceIds: new Set([419708]),
    allowedBoardIds: new Set([977529]),
    allowedFileHosts: new Set(),
    maxAttachmentBytes: 1024,
    expectedActorId: 703452,
  };
}

function boardsResponse() {
  return [
    {
      id: 977529,
      title: "Sprint",
      columns: [{ id: 4665754, title: "Backlog", type: 1, board_id: 977529 }],
      lanes: [],
    },
  ];
}

function cardResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 49505819,
    key: "CROSS-3907",
    title: "Task",
    board_id: 977529,
    column_id: 4665754,
    version: 8,
    ...overrides,
  };
}

test("registers and serves kaiten_create_card over MCP", async () => {
  const requests: Array<{ method: string; body?: string }> = [];
  const responses = [
    { id: 703452 },
    boardsResponse(),
    cardResponse({ id: 49509999, key: "CROSS-NEW", title: "Created", version: 1 }),
  ];
  const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      method: init?.method ?? "GET",
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    return jsonResponse(responses.shift());
  }) as typeof fetch;

  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_create_card",
      arguments: {
        title: "Created",
        board_id: 977529,
        column_id: 4665754,
      },
    });
    expect(response.isError).not.toBe(true);
    expect(requests.some((r) => r.method === "POST" && r.body?.includes("Created"))).toBe(
      true,
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_add_checklist_item over MCP", async () => {
  const responses = [
    { id: 703452 },
    cardResponse(),
    boardsResponse(),
    { id: 9001, text: "Ship it", checked: false },
  ];
  const fakeFetch = (async () =>
    jsonResponse(responses.shift())) as unknown as typeof fetch;
  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_add_checklist_item",
      arguments: {
        card: 49505819,
        checklist_id: 55,
        text: "Ship it",
      },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as { result?: { text?: string } };
    expect(structured?.result?.text).toBe("Ship it");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_add_card_tag over MCP", async () => {
  const responses = [
    { id: 703452 },
    cardResponse(),
    boardsResponse(),
    { id: 501, name: "blocked" },
  ];
  const fakeFetch = (async () =>
    jsonResponse(responses.shift())) as unknown as typeof fetch;
  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_add_card_tag",
      arguments: { card: 49505819, name: "blocked" },
    });
    expect(response.isError).not.toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_add_card_member over MCP", async () => {
  const responses = [
    { id: 703452 },
    cardResponse(),
    boardsResponse(),
    { id: 888, username: "peer" },
  ];
  const fakeFetch = (async () =>
    jsonResponse(responses.shift())) as unknown as typeof fetch;
  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_add_card_member",
      arguments: { card: 49505819, user_id: 888 },
    });
    expect(response.isError).not.toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_list_card_blockers over MCP", async () => {
  const responses = [cardResponse(), boardsResponse(), [{ id: 3, reason: "deps" }]];
  const fakeFetch = (async () =>
    jsonResponse(responses.shift())) as unknown as typeof fetch;
  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_list_card_blockers",
      arguments: { card: 49505819 },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: Array<{ reason?: string }>;
    };
    expect(structured?.result?.[0]?.reason).toBe("deps");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_add_card_child over MCP", async () => {
  const responses = [
    { id: 703452 },
    cardResponse({ title: "Parent" }),
    boardsResponse(),
    cardResponse({ id: 49505820, title: "Child" }),
    boardsResponse(),
    cardResponse({ id: 49505820, title: "Child" }),
  ];
  const fakeFetch = (async () =>
    jsonResponse(responses.shift())) as unknown as typeof fetch;
  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_add_card_child",
      arguments: { card: 49505819, card_id: 49505820 },
    });
    expect(response.isError).not.toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_list_timesheet over MCP", async () => {
  const responses = [
    { id: 703452 },
    [
      {
        id: 74041,
        card_id: 49505819,
        role_id: -1,
        time_spent: 45,
        for_date: "2026-10-16",
      },
    ],
  ];
  const fakeFetch = (async () =>
    jsonResponse(responses.shift())) as unknown as typeof fetch;
  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_list_timesheet",
      arguments: { from: "2026-10-01", to: "2026-10-16" },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: { time_logs?: Array<{ time_spent?: number }> };
    };
    expect(structured?.result?.time_logs?.[0]?.time_spent).toBe(45);
  } finally {
    await client.close();
    await server.close();
  }
});
