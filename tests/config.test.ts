import { describe, expect, test } from "bun:test";

import { loadConfig, webBaseUrl } from "../src/config.js";

describe("loadConfig", () => {
  test("requires a token", () => {
    expect(() => loadConfig({})).toThrow("KAITEN_TOKEN is required");
  });

  test("requires a base URL", () => {
    expect(() => loadConfig({ KAITEN_TOKEN: "token" })).toThrow(
      "KAITEN_BASE_URL is required",
    );
  });

  test("normalizes an origin and parses safety boundaries", () => {
    const config = loadConfig({
      KAITEN_TOKEN: "temporary-token",
      KAITEN_BASE_URL: "https://kaiten.example.test/",
      KAITEN_SPACE_IDS: "419708,420000",
      KAITEN_DEFAULT_SPACE_ID: "419708",
      KAITEN_EXPECTED_ACTOR_ID: "703452",
      KAITEN_ALLOWED_BOARD_IDS: "977523,977529",
      KAITEN_FILE_HOSTS: "files.example.test, CDN.EXAMPLE.TEST ",
    });

    expect(config.apiBaseUrl.toString()).toBe(
      "https://kaiten.example.test/api/v1",
    );
    expect(config.defaultSpaceId).toBe(419708);
    expect([...config.allowedSpaceIds]).toEqual([419708, 420000]);
    expect(config.expectedActorId).toBe(703452);
    expect([...config.allowedBoardIds]).toEqual([977523, 977529]);
    expect(config.allowedFileHosts.has("cdn.example.test")).toBeTrue();
    expect(webBaseUrl(config).toString()).toBe("https://kaiten.example.test/");
  });

  test("rejects invalid integer settings", () => {
    expect(() =>
      loadConfig({
        KAITEN_TOKEN: "token",
        KAITEN_BASE_URL: "https://kaiten.example.test",
        KAITEN_SPACE_IDS: "419708.5",
      }),
    ).toThrow("KAITEN_SPACE_IDS must be a positive integer");
  });

  test("supports the legacy single-space setting", () => {
    const config = loadConfig({
      KAITEN_TOKEN: "token",
      KAITEN_BASE_URL: "https://kaiten.example.test",
      KAITEN_SPACE_ID: "419708",
    });

    expect(config.defaultSpaceId).toBe(419708);
    expect([...config.allowedSpaceIds]).toEqual([419708]);
  });

  test("rejects a default space outside the allowlist", () => {
    expect(() =>
      loadConfig({
        KAITEN_TOKEN: "token",
        KAITEN_BASE_URL: "https://kaiten.example.test",
        KAITEN_SPACE_IDS: "419708,420000",
        KAITEN_DEFAULT_SPACE_ID: "999999",
      }),
    ).toThrow("is not included in KAITEN_SPACE_IDS");
  });
});
