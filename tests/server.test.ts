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

test("registers and serves kaiten_list_users over MCP", async () => {
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/users") {
      return jsonResponse([{ id: 888, full_name: "Peer", username: "peer" }]);
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_list_users",
      arguments: { query: "peer" },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: { users?: Array<{ id?: number; full_name?: string }> };
    };
    expect(structured?.result?.users?.[0]?.full_name).toBe("Peer");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_list_card_types over MCP", async () => {
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/latest/card-types") {
      return jsonResponse([{ id: 3, name: "Bug", archived: false }]);
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_list_card_types",
      arguments: {},
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: { card_types?: Array<{ name?: string }> };
    };
    expect(structured?.result?.card_types?.[0]?.name).toBe("Bug");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_update_comment over MCP", async () => {
  const responses = [
    { id: 703452 },
    cardResponse(),
    boardsResponse(),
    { id: 12, text: "fixed typo", author: { id: 703452 } },
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
      name: "kaiten_update_comment",
      arguments: { card: 49505819, comment_id: 12, text: "fixed typo" },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as { result?: { text?: string } };
    expect(structured?.result?.text).toBe("fixed typo");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_remove_comment over MCP", async () => {
  const responses = [
    cardResponse(),
    boardsResponse(),
    { id: 703452 },
    cardResponse(),
    { id: 12 },
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
      name: "kaiten_remove_comment",
      arguments: { card: 49505819, comment_id: 12 },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: { id?: number; card?: { key?: string } };
    };
    expect(structured?.result?.id).toBe(12);
    expect(structured?.result?.card?.key).toBe("CROSS-3907");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_search_documents over MCP", async () => {
  const uid = "doc-search-uid";
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/latest/documents") {
      return jsonResponse([{ uid, id: 9, title: "Roadmap", key: "ROADMAP" }]);
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_search_documents",
      arguments: { query: "Road" },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: { documents?: Array<{ uid?: string; title?: string }> };
    };
    expect(structured?.result?.documents?.[0]?.title).toBe("Roadmap");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_read_document over MCP", async () => {
  const uid = "a3f7c2d1-84e5-4b2a-9c6f-1d2e3f4a5b6c";
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/latest/documents/${uid}`) {
      return jsonResponse({
        uid,
        id: 11,
        title: "Notes",
        data: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Body" }],
            },
          ],
        },
      });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_read_document",
      arguments: { document: uid },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: { document?: { text?: string } };
    };
    expect(structured?.result?.document?.text).toBe("Body");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_list_activity over MCP", async () => {
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/latest/company/activity") {
      return jsonResponse({
        items: [{ id: 1, created: "2026-10-16T09:00:00Z", action: "card_update" }],
        next_cursor: null,
      });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const server = createServer(new KaitenClient(baseWriteConfig(), fakeFetch));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const response = await client.callTool({
      name: "kaiten_list_activity",
      arguments: { limit: 10 },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: { items?: Array<{ action?: string }> };
    };
    expect(structured?.result?.items?.[0]?.action).toBe("card_update");
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers and serves kaiten_upload_attachment over MCP", async () => {
  const responses = [
    cardResponse(),
    boardsResponse(),
    { id: 703452 },
    cardResponse(),
    {
      id: 99,
      url: "https://files.example.test/x.txt",
      name: "x.txt",
      type: 8,
      size: 3,
    },
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
      name: "kaiten_upload_attachment",
      arguments: {
        card: 49505819,
        filename: "x.txt",
        content_base64: Buffer.from("hey").toString("base64"),
      },
    });
    expect(response.isError).not.toBe(true);
    const structured = response.structuredContent as {
      result?: { file?: { name?: string } };
    };
    expect(structured?.result?.file?.name).toBe("x.txt");
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
