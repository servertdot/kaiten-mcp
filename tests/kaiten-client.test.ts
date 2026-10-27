import { describe, expect, test } from "bun:test";

import type { KaitenConfig } from "../src/config.js";
import { KaitenClient } from "../src/kaiten-client.js";

function config(overrides: Partial<KaitenConfig> = {}): KaitenConfig {
  return {
    apiBaseUrl: new URL("https://kaiten.example.test/api/v1"),
    token: "secret-token",
    defaultSpaceId: 419708,
    allowedSpaceIds: new Set([419708]),
    expectedActorId: 703452,
    allowedBoardIds: new Set([977529]),
    allowedFileHosts: new Set(["files.example.test"]),
    maxAttachmentBytes: 1024,
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("KaitenClient", () => {
  test("handles the self-redirect WAF cookie without leaking the token", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, headers });
      if (calls.length === 1) {
        return new Response("blank", {
          status: 307,
          headers: [
            ["location", url],
            ["set-cookie", "spid=abc; Path=/; Secure"],
            ["set-cookie", "spsc=def; Path=/; Secure"],
          ],
        });
      }
      return jsonResponse({ id: 703452, username: "andrey_astafev" });
    }) as typeof fetch;

    const actor = await new KaitenClient(config(), fakeFetch).currentUser();

    expect(actor.id).toBe(703452);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers.get("cookie")).toContain("spid=abc");
    expect(calls[1]!.headers.get("cookie")).toContain("spsc=def");
    expect(calls[1]!.headers.get("authorization")).toBe(
      "Bearer secret-token",
    );
  });

  test("search uses the configured space and stable v2 options", async () => {
    let requestedUrl = "";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({ result: [], position: "next" });
    }) as typeof fetch;

    await new KaitenClient(config(), fakeFetch).searchCards({
      query: "CROSS-3907",
      limit: 10,
    });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/api/v1/cards");
    expect(url.searchParams.get("space_id")).toBe("419708");
    expect(url.searchParams.get("query")).toBe("CROSS-3907");
    expect(url.searchParams.get("version")).toBe("2");
    expect(url.searchParams.get("broken_api")).toBe("false");
  });

  test("search can select another allowed space", async () => {
    let requestedUrl = "";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({ result: [] });
    }) as typeof fetch;
    const client = new KaitenClient(
      config({ allowedSpaceIds: new Set([419708, 420000]) }),
      fakeFetch,
    );

    await client.searchCards({ spaceId: 420000, query: "CROSS-4048" });

    expect(new URL(requestedUrl).searchParams.get("space_id")).toBe("420000");
  });

  test("refuses a search outside the configured spaces", async () => {
    let requestCount = 0;
    const fakeFetch = (async (_input: RequestInfo | URL) => {
      requestCount += 1;
      return jsonResponse({ result: [] });
    }) as typeof fetch;
    const client = new KaitenClient(
      config({ allowedSpaceIds: new Set([419708, 420000]) }),
      fakeFetch,
    );

    await expect(client.searchCards({ spaceId: 999999 })).rejects.toThrow(
      "outside the configured boundary",
    );
    expect(requestCount).toBe(0);
  });

  test("lists custom properties by name", async () => {
    let requestedUrl = "";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse([
        {
          id: 123,
          name: "DoD",
          type: "string",
          condition: "active",
          multiline: true,
        },
      ]);
    }) as typeof fetch;

    const properties = await new KaitenClient(
      config(),
      fakeFetch,
    ).listCustomProperties({ query: "DoD", limit: 10 });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/api/v1/company/custom-properties");
    expect(url.searchParams.get("query")).toBe("DoD");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("compact")).toBe("false");
    expect(properties[0]?.name).toBe("DoD");
  });

  test("reads a document linked from an allowed card URL property", async () => {
    const uid = "a3f7c2d1-84e5-4b2a-9c6f-1d2e3f4a5b6c";
    const requestedUrls: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      if (url.pathname === "/api/v1/cards/49505819") {
        return jsonResponse({
          id: 49505819,
          key: "CROSS-3907",
          title: "Task",
          board_id: 977529,
          column_id: 4665754,
          properties: {
            id_408025: `https://kaiten.example.test/space/419708/documents/${uid}`,
          },
        });
      }
      if (url.pathname === "/api/v1/spaces/419708/boards") {
        return jsonResponse([
          { id: 977529, title: "Sprint", columns: [], lanes: [] },
        ]);
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
      return jsonResponse({ message: "not found" }, 404);
    }) as typeof fetch;

    const linked = await new KaitenClient(config(), fakeFetch).readLinkedDocument(
      {
        card: 49505819,
        propertyName: "Ссылка на постановку",
      },
    );

    expect(linked.document.title).toBe("Постановка");
    expect(linked.property.id).toBe(408025);
    expect(requestedUrls.some((url) => url.includes("/api/latest/documents/"))).toBe(
      true,
    );
  });

  test("resolves a document key from a linked URL before reading it", async () => {
    const uid = "b4e8d3c2-95f6-4c3b-ad7e-2e3f4a5b6c7d";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/cards/49505819") {
        return jsonResponse({
          id: 49505819,
          title: "Task",
          board_id: 977529,
          column_id: 4665754,
          properties: {
            id_408025: "https://kaiten.example.test/document/SPEC_1",
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
      if (url.pathname === "/api/latest/documents") {
        expect(url.searchParams.get("query")).toBe("SPEC_1");
        return jsonResponse([{ uid, id: 42, title: "Spec", key: "SPEC_1" }]);
      }
      if (url.pathname === `/api/latest/documents/${uid}`) {
        return jsonResponse({ uid, id: 42, title: "Spec", data: { type: "doc" } });
      }
      return jsonResponse({ message: "not found" }, 404);
    }) as typeof fetch;

    const linked = await new KaitenClient(config(), fakeFetch).readLinkedDocument(
      {
        card: 49505819,
        propertyName: "Ссылка на постановку",
      },
    );

    expect(linked.document.uid).toBe(uid);
  });

  test("refuses a stale move before sending PATCH", async () => {
    const methods: string[] = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [
        {
          id: 977529,
          title: "Sprint",
          columns: [{ id: 3460595, title: "Doing", type: 2, board_id: 977529 }],
          lanes: [],
        },
      ],
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).moveCard({
        card: 49505819,
        expectedColumnId: 123,
        targetColumnId: 3460595,
      }),
    ).rejects.toThrow("refusing stale move");
    expect(methods).not.toContain("PATCH");
  });

  test("moves only to a column inside the configured boundary", async () => {
    const requests: Array<{ method: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [
        {
          id: 977529,
          title: "Sprint",
          columns: [{ id: 3460595, title: "Doing", type: 2, board_id: 977529 }],
          lanes: [],
        },
      ],
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 3460595,
      },
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const moved = await new KaitenClient(config(), fakeFetch).moveCard({
      card: 49505819,
      expectedColumnId: 4665754,
      targetColumnId: 3460595,
    });

    expect(moved.column_id).toBe(3460595);
    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      body: JSON.stringify({ column_id: 3460595 }),
    });
  });

  test("does not move a card to a column from another allowed space", async () => {
    const methods: string[] = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [
        {
          id: 977529,
          title: "Source board",
          columns: [
            { id: 4665754, title: "Backlog", type: 1, board_id: 977529 },
          ],
          lanes: [],
        },
      ],
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse(responses.shift());
    }) as typeof fetch;
    const client = new KaitenClient(
      config({
        allowedSpaceIds: new Set([419708, 420000]),
        allowedBoardIds: new Set([977529, 888888]),
      }),
      fakeFetch,
    );

    await expect(
      client.moveCard({
        card: 49505819,
        spaceId: 419708,
        expectedColumnId: 4665754,
        targetColumnId: 9999999,
      }),
    ).rejects.toThrow("outside the configured boundary");
    expect(methods).not.toContain("PATCH");
  });

  test("refuses a stale card update before sending PATCH", async () => {
    const methods: string[] = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        version: 8,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).updateCard({
        card: 49505819,
        expectedVersion: 7,
        title: "Updated task",
      }),
    ).rejects.toThrow("refusing stale update");
    expect(methods).not.toContain("PATCH");
  });

  test("updates only explicitly provided card fields", async () => {
    const requests: Array<{ method: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        version: 8,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Updated task",
        description: null,
        board_id: 977529,
        column_id: 4665754,
        version: 9,
        asap: false,
        estimate_workload: 0,
      },
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const updated = await new KaitenClient(config(), fakeFetch).updateCard({
      card: 49505819,
      expectedVersion: 8,
      title: "Updated task",
      description: null,
      asap: false,
      estimateWorkload: 0,
    });

    expect(updated.version).toBe(9);
    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      body: JSON.stringify({
        title: "Updated task",
        description: null,
        asap: false,
        estimate_workload: 0,
      }),
    });
  });

  test("updates a custom property after verifying its exact name", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        version: 8,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      {
        id: 123,
        name: "DoD",
        type: "string",
        condition: "active",
        multiline: true,
      },
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        version: 9,
        properties: { id_123: "Тестовый DoD" },
      },
    ];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const updated = await new KaitenClient(config(), fakeFetch).updateCard({
      card: 49505819,
      expectedVersion: 8,
      customProperties: [
        { id: 123, expectedName: "DoD", value: "Тестовый DoD" },
      ],
    });

    expect(updated.properties).toEqual({ id_123: "Тестовый DoD" });
    expect(new URL(requests.at(-2)!.url).pathname).toBe(
      "/api/v1/company/custom-properties/123",
    );
    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      url: "https://kaiten.example.test/api/v1/cards/49505819",
      body: JSON.stringify({ properties: { id_123: "Тестовый DoD" } }),
    });
  });

  test("refuses a custom property update when its name has changed", async () => {
    const methods: string[] = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        version: 8,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      {
        id: 123,
        name: "Definition of Done",
        type: "string",
        condition: "active",
      },
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).updateCard({
        card: 49505819,
        expectedVersion: 8,
        customProperties: [
          { id: 123, expectedName: "DoD", value: "Тестовый DoD" },
        ],
      }),
    ).rejects.toThrow('named "Definition of Done", expected "DoD"');
    expect(methods).not.toContain("PATCH");
  });

  test("refuses an empty card update without making a request", async () => {
    let requestCount = 0;
    const fakeFetch = (async (_input: RequestInfo | URL) => {
      requestCount += 1;
      return jsonResponse({});
    }) as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).updateCard({
        card: 49505819,
        expectedVersion: 8,
      }),
    ).rejects.toThrow("At least one card field");
    expect(requestCount).toBe(0);
  });

  test("adds a card time log in minutes for the expected actor", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      {
        id: 74041,
        card_id: 49505819,
        user_id: 703452,
        role_id: -1,
        author_id: 703452,
        updater_id: null,
        time_spent: 120,
        for_date: "2026-10-16T00:00:00.000Z",
        comment: "implementation",
        created: "2026-10-16T09:00:00.000Z",
        updated: "2026-10-16T09:00:00.000Z",
      },
    ];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const created = await new KaitenClient(config(), fakeFetch).addTimeLog({
      card: 49505819,
      timeSpent: 120,
      forDate: "2026-10-16",
      comment: "implementation",
    });

    expect(created.id).toBe(74041);
    expect(requests.at(-1)).toEqual({
      method: "POST",
      url: "https://kaiten.example.test/api/v1/cards/49505819/time-logs",
      body: JSON.stringify({
        role_id: -1,
        time_spent: 120,
        for_date: "2026-10-16",
        comment: "implementation",
      }),
    });
  });

  test("refuses an invalid time log date before posting", async () => {
    let requestCount = 0;
    const fakeFetch = (async (_input: RequestInfo | URL) => {
      requestCount += 1;
      return jsonResponse({});
    }) as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).addTimeLog({
        card: 49505819,
        timeSpent: 30,
        forDate: "16.10.2026",
      }),
    ).rejects.toThrow("for_date must use YYYY-MM-DD");
    expect(requestCount).toBe(0);
  });

  test("lists card time logs with personal filter and pagination", async () => {
    let requestedUrl = "";
    const responses = [
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      [
        {
          id: 74041,
          card_id: 49505819,
          role_id: -1,
          time_spent: 60,
          for_date: "2026-10-16",
          comment: null,
        },
      ],
    ];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const timeLogs = await new KaitenClient(config(), fakeFetch).listCardTimeLogs(
      {
        card: 49505819,
        forDate: "2026-10-16",
        personal: true,
        limit: 50,
        offset: 0,
      },
    );

    expect(timeLogs).toHaveLength(1);
    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/api/v1/cards/49505819/time-logs");
    expect(url.searchParams.get("for_date")).toBe("2026-10-16");
    expect(url.searchParams.get("personal")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("0");
  });

  test("updates only explicitly provided time log fields", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      {
        id: 74041,
        card_id: 49505819,
        role_id: -1,
        time_spent: 150,
        for_date: "2026-10-16T00:00:00.000Z",
        comment: "adjusted",
      },
    ];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const updated = await new KaitenClient(config(), fakeFetch).updateTimeLog({
      card: 49505819,
      timeLogId: 74041,
      timeSpent: 150,
      comment: "adjusted",
    });

    expect(updated.time_spent).toBe(150);
    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      url: "https://kaiten.example.test/api/v1/cards/49505819/time-logs/74041",
      body: JSON.stringify({ time_spent: 150, comment: "adjusted" }),
    });
  });

  test("refuses an empty time log update without making a request", async () => {
    let requestCount = 0;
    const fakeFetch = (async (_input: RequestInfo | URL) => {
      requestCount += 1;
      return jsonResponse({});
    }) as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).updateTimeLog({
        card: 49505819,
        timeLogId: 74041,
      }),
    ).rejects.toThrow("At least one time log field");
    expect(requestCount).toBe(0);
  });

  test("removes a card time log after actor and boundary checks", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      { id: 74041 },
    ];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const removed = await new KaitenClient(config(), fakeFetch).removeTimeLog({
      card: 49505819,
      timeLogId: 74041,
    });

    expect(removed).toEqual({ id: 74041 });
    expect(requests.at(-1)).toEqual({
      method: "DELETE",
      url: "https://kaiten.example.test/api/v1/cards/49505819/time-logs/74041",
    });
  });

  test("creates a card after board and column boundary checks", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      [
        {
          id: 977529,
          title: "Sprint",
          columns: [{ id: 4665754, title: "Backlog", type: 1, board_id: 977529 }],
          lanes: [],
        },
      ],
      {
        id: 49509999,
        key: "CROSS-9999",
        title: "New task",
        board_id: 977529,
        column_id: 4665754,
        version: 1,
      },
    ];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const created = await new KaitenClient(config(), fakeFetch).createCard({
      title: "New task",
      boardId: 977529,
      columnId: 4665754,
    });

    expect(created.id).toBe(49509999);
    expect(requests.at(-1)).toEqual({
      method: "POST",
      url: "https://kaiten.example.test/api/v1/cards",
      body: JSON.stringify({
        title: "New task",
        board_id: 977529,
        column_id: 4665754,
      }),
    });
  });

  test("refuses create on a board outside the boundary without POST", async () => {
    const methods: string[] = [];
    const responses = [{ id: 703452 }, [{ id: 977529, title: "Sprint", columns: [], lanes: [] }]];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).createCard({
        title: "New task",
        boardId: 999999,
        columnId: 4665754,
      }),
    ).rejects.toThrow("outside the configured boundary");
    expect(methods).not.toContain("POST");
  });

  test("archives a card with condition=2 after version guard", async () => {
    const requests: Array<{ method: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        version: 8,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      {
        id: 49505819,
        key: "CROSS-3907",
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        version: 9,
        condition: 2,
      },
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const archived = await new KaitenClient(config(), fakeFetch).archiveCard({
      card: 49505819,
      expectedVersion: 8,
    });

    expect(archived.condition).toBe(2);
    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      body: JSON.stringify({ condition: 2 }),
    });
  });

  test("adds a checklist item on an allowed card", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      { id: 9001, text: "Do thing", checked: false },
    ];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const item = await new KaitenClient(config(), fakeFetch).addChecklistItem({
      card: 49505819,
      checklistId: 77,
      text: "Do thing",
    });

    expect(item.id).toBe(9001);
    expect(requests.at(-1)?.url).toBe(
      "https://kaiten.example.test/api/v1/cards/49505819/checklists/77/items",
    );
  });

  test("adds a card tag by name", async () => {
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      { id: 501, name: "urgent" },
    ];
    const fakeFetch = (async () =>
      jsonResponse(responses.shift())) as unknown as typeof fetch;

    const tag = await new KaitenClient(config(), fakeFetch).addCardTag({
      card: 49505819,
      name: "urgent",
    });

    expect(tag.name).toBe("urgent");
  });

  test("adds a card member", async () => {
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      { id: 888, username: "dev" },
    ];
    const fakeFetch = (async () =>
      jsonResponse(responses.shift())) as unknown as typeof fetch;

    const member = await new KaitenClient(config(), fakeFetch).addCardMember({
      card: 49505819,
      userId: 888,
    });

    expect(member.id).toBe(888);
  });

  test("lists card blockers after boundary resolution", async () => {
    let requestedUrl = "";
    const responses = [
      {
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      [{ id: 12, reason: "waiting" }],
    ];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const blockers = await new KaitenClient(config(), fakeFetch).listCardBlockers(
      { card: 49505819 },
    );

    expect(blockers).toHaveLength(1);
    expect(new URL(requestedUrl).pathname).toBe(
      "/api/v1/cards/49505819/blockers",
    );
  });

  test("links a child card when both are in boundary", async () => {
    const requests: Array<{ method: string; body?: string }> = [];
    const responses = [
      { id: 703452 },
      {
        id: 49505819,
        title: "Parent",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      {
        id: 49505820,
        title: "Child",
        board_id: 977529,
        column_id: 4665754,
      },
      [{ id: 977529, title: "Sprint", columns: [], lanes: [] }],
      {
        id: 49505820,
        title: "Child",
        board_id: 977529,
        column_id: 4665754,
      },
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    await new KaitenClient(config(), fakeFetch).addCardChild({
      card: 49505819,
      childCardId: 49505820,
    });

    expect(requests.at(-1)).toEqual({
      method: "POST",
      body: JSON.stringify({ card_id: 49505820 }),
    });
  });

  test("lists timesheet for a date range with personal user filter", async () => {
    let requestedUrl = "";
    const responses = [
      { id: 703452 },
      [
        {
          id: 74041,
          card_id: 49505819,
          role_id: -1,
          time_spent: 60,
          for_date: "2026-10-16",
        },
      ],
    ];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const logs = await new KaitenClient(config(), fakeFetch).listTimesheet({
      from: "2026-10-01",
      to: "2026-10-16",
      personal: true,
    });

    expect(logs).toHaveLength(1);
    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/api/v1/time-logs");
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-16");
    expect(url.searchParams.get("user_ids")).toBe("703452");
  });

  test("refuses create when actor mismatches expected id", async () => {
    let requestCount = 0;
    const fakeFetch = (async (_input: RequestInfo | URL) => {
      requestCount += 1;
      return jsonResponse({ id: 999999 });
    }) as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).createCard({
        title: "New task",
        boardId: 977529,
        columnId: 4665754,
      }),
    ).rejects.toThrow("expected 703452");
    expect(requestCount).toBe(1);
  });

  test("downloads only allow-listed attachments within the size limit", async () => {
    const responses = [
      jsonResponse({
        id: 49505819,
        title: "Task",
        board_id: 977529,
        column_id: 4665754,
        files: [
          {
            id: 44272585,
            url: "https://files.example.test/image.png",
            name: "image.png",
            type: 8,
            size: 3,
          },
        ],
      }),
      jsonResponse([
        {
          id: 977529,
          title: "Sprint",
          columns: [],
          lanes: [],
        },
      ]),
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "3" },
      }),
    ];
    const fakeFetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => responses.shift()!) as typeof fetch;

    const attachment = await new KaitenClient(config(), fakeFetch).readAttachment(
      49505819,
      44272585,
    );

    expect(attachment.contentType).toBe("image/png");
    expect([...attachment.bytes]).toEqual([1, 2, 3]);
  });

  test("lists users with pagination and inactive filter", async () => {
    let requestedUrl = "";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse([{ id: 1, full_name: "Ada", email: "hidden@example.test" }]);
    }) as typeof fetch;

    const users = await new KaitenClient(config(), fakeFetch).listUsers({
      query: "ada",
      limit: 10,
      offset: 5,
      includeInactive: true,
    });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/api/v1/users");
    expect(url.searchParams.get("query")).toBe("ada");
    expect(url.searchParams.get("include_inactive")).toBe("true");
    expect(users[0]?.full_name).toBe("Ada");
  });

  test("lists card types from latest API and hides archived by default", async () => {
    let requestedUrl = "";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse([
        { id: 1, name: "Task", archived: false },
        { id: 2, name: "Old", archived: true },
      ]);
    }) as typeof fetch;

    const types = await new KaitenClient(config(), fakeFetch).listCardTypes();

    expect(requestedUrl).toContain("/api/latest/card-types");
    expect(types.map((type) => type.id)).toEqual([1]);
  });

  test("updates a card comment after actor and boundary checks", async () => {
    const methods: string[] = [];
    const responses = [
      { id: 703452 },
      cardResponse(),
      boardsResponse(),
      { id: 900, text: "edited", author: { id: 703452 } },
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const updated = await new KaitenClient(config(), fakeFetch).updateComment({
      card: 49505819,
      commentId: 900,
      text: "edited",
    });
    expect(updated.text).toBe("edited");
    expect(methods).toContain("PATCH");
  });

  test("removes a card comment after actor and boundary checks", async () => {
    const methods: string[] = [];
    const responses = [
      { id: 703452 },
      cardResponse(),
      boardsResponse(),
      { id: 900 },
    ];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const removed = await new KaitenClient(config(), fakeFetch).removeComment({
      card: 49505819,
      commentId: 900,
    });
    expect(removed.id).toBe(900);
    expect(methods).toContain("DELETE");
  });

  test("searches documents with query and offset on latest API", async () => {
    let requestedUrl = "";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse([
        { uid: "doc-uid", id: 7, title: "Spec", key: "SPEC_1" },
      ]);
    }) as typeof fetch;

    const documents = await new KaitenClient(config(), fakeFetch).listDocuments({
      query: "Spec",
      limit: 20,
      offset: 10,
    });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/api/latest/documents");
    expect(url.searchParams.get("query")).toBe("Spec");
    expect(url.searchParams.get("offset")).toBe("10");
    expect(documents[0]?.key).toBe("SPEC_1");
  });

  test("reads a document by uid via latest API", async () => {
    const uid = "a3f7c2d1-84e5-4b2a-9c6f-1d2e3f4a5b6c";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === `/api/latest/documents/${uid}`) {
        return jsonResponse({ uid, id: 42, title: "Doc", data: { type: "doc" } });
      }
      return jsonResponse({ message: "not found" }, 404);
    }) as typeof fetch;

    const document = await new KaitenClient(config(), fakeFetch).readDocument(uid);
    expect(document.title).toBe("Doc");
  });

  test("lists company activity and maps card filter to card_id", async () => {
    let requestedUrl = "";
    const responses = [
      cardResponse(),
      boardsResponse(),
      {
        items: [{ id: 1, created: "2026-10-16T10:00:00Z", action: "comment_add" }],
        next_cursor: "next",
      },
    ];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const page = await new KaitenClient(config(), fakeFetch).listActivity({
      card: 49505819,
      limit: 25,
    });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/api/latest/company/activity");
    expect(url.searchParams.get("card_id")).toBe("49505819");
    expect(page.items[0]?.action).toBe("comment_add");
    expect(page.next_cursor).toBe("next");
  });

  test("surfaces company permission errors for activity feed", async () => {
    const fakeFetch = (async () =>
      jsonResponse({ message: "forbidden" }, 403)) as unknown as typeof fetch;

    await expect(new KaitenClient(config(), fakeFetch).listActivity()).rejects.toThrow(
      "company-level permission",
    );
  });

  test("uploads multipart attachments without forcing JSON content type", async () => {
    const payload = Buffer.from("hello").toString("base64");
    const headersSeen: Headers[] = [];
    const responses = [
      { id: 703452 },
      cardResponse(),
      boardsResponse(),
      {
        id: 44272585,
        url: "https://files.example.test/a.txt",
        name: "a.txt",
        type: 8,
        size: 5,
      },
    ];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      headersSeen.push(new Headers(init?.headers));
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const file = await new KaitenClient(config(), fakeFetch).uploadAttachment({
      card: 49505819,
      filename: "a.txt",
      contentBase64: payload,
      contentType: "text/plain",
    });

    expect(file.name).toBe("a.txt");
    const uploadHeaders = headersSeen.find(
      (headers) => headers.get("authorization") && !headers.get("content-type"),
    );
    expect(uploadHeaders).toBeDefined();
  });

  test("refuses oversized attachment uploads before posting", async () => {
    let requestCount = 0;
    const fakeFetch = (async () => {
      requestCount += 1;
      return jsonResponse({ id: 703452 });
    }) as unknown as typeof fetch;

    await expect(
      new KaitenClient(config(), fakeFetch).uploadAttachment({
        card: 49505819,
        filename: "big.bin",
        contentBase64: Buffer.alloc(1025, 1).toString("base64"),
      }),
    ).rejects.toThrow("limit is 1024");
    expect(requestCount).toBe(0);
  });
});

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

test("reads string-encoded ProseMirror document data", async () => {
  const uid = "a3f7c2d1-84e5-4b2a-9c6f-1d2e3f4a5b6c";
  const data = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Document text" }] }] };
  const fakeFetch = (async () => jsonResponse({ uid, id: 5, title: "Doc", data: JSON.stringify(data) })) as unknown as typeof fetch;
  const document = await new KaitenClient(config(), fakeFetch).getDocument(uid);
  expect(document.data).toEqual(data);
});

test("rejects malformed string-encoded document data", async () => {
  const uid = "a3f7c2d1-84e5-4b2a-9c6f-1d2e3f4a5b6c";
  for (const data of ["{broken", JSON.stringify({ type: "paragraph" })]) {
    const fakeFetch = (async () => jsonResponse({ uid, id: 5, title: "Doc", data })) as unknown as typeof fetch;
    await expect(new KaitenClient(config(), fakeFetch).getDocument(uid)).rejects.toThrow("Kaiten document data");
  }
});
