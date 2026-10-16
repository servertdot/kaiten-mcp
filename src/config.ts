import "dotenv/config";

export interface KaitenConfig {
  apiBaseUrl: URL;
  token: string;
  defaultSpaceId?: number;
  allowedSpaceIds: ReadonlySet<number>;
  defaultOwnerId?: number;
  expectedActorId?: number;
  allowedBoardIds: ReadonlySet<number>;
  allowedFileHosts: ReadonlySet<string>;
  maxAttachmentBytes: number;
}

const DEFAULT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function optionalPositiveInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function integerSet(value: string | undefined, name: string): ReadonlySet<number> {
  if (!value?.trim()) {
    return new Set<number>();
  }

  return new Set(
    value.split(",").map((item) => {
      const parsed = optionalPositiveInteger(item.trim(), name);
      if (parsed === undefined) {
        throw new Error(`${name} contains an empty value`);
      }
      return parsed;
    }),
  );
}

function hostSet(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeApiBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("KAITEN_BASE_URL must use http or https");
  }

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/api\/(?:v\d+|latest)$/.test(path)
    ? path
    : `${path}/api/v1`.replace(/\/+/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): KaitenConfig {
  const token = env.KAITEN_TOKEN?.trim();
  if (!token) {
    throw new Error("KAITEN_TOKEN is required");
  }

  const baseUrl = env.KAITEN_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("KAITEN_BASE_URL is required");
  }

  const legacySpaceId = optionalPositiveInteger(
    env.KAITEN_SPACE_ID,
    "KAITEN_SPACE_ID",
  );
  const configuredDefaultSpaceId = optionalPositiveInteger(
    env.KAITEN_DEFAULT_SPACE_ID,
    "KAITEN_DEFAULT_SPACE_ID",
  );
  const defaultSpaceId = configuredDefaultSpaceId ?? legacySpaceId;
  const configuredAllowedSpaceIds = integerSet(
    env.KAITEN_SPACE_IDS,
    "KAITEN_SPACE_IDS",
  );
  const allowedSpaceIds =
    configuredAllowedSpaceIds.size > 0
      ? configuredAllowedSpaceIds
      : new Set(defaultSpaceId === undefined ? [] : [defaultSpaceId]);
  if (
    defaultSpaceId !== undefined &&
    allowedSpaceIds.size > 0 &&
    !allowedSpaceIds.has(defaultSpaceId)
  ) {
    throw new Error(
      `Default space ${defaultSpaceId} is not included in KAITEN_SPACE_IDS`,
    );
  }
  const defaultOwnerId = optionalPositiveInteger(
    env.KAITEN_DEFAULT_OWNER_ID,
    "KAITEN_DEFAULT_OWNER_ID",
  );
  const expectedActorId = optionalPositiveInteger(
    env.KAITEN_EXPECTED_ACTOR_ID,
    "KAITEN_EXPECTED_ACTOR_ID",
  );

  return {
    apiBaseUrl: normalizeApiBaseUrl(baseUrl),
    token,
    ...(defaultSpaceId === undefined ? {} : { defaultSpaceId }),
    allowedSpaceIds,
    ...(defaultOwnerId === undefined ? {} : { defaultOwnerId }),
    ...(expectedActorId === undefined ? {} : { expectedActorId }),
    allowedBoardIds: integerSet(
      env.KAITEN_ALLOWED_BOARD_IDS,
      "KAITEN_ALLOWED_BOARD_IDS",
    ),
    allowedFileHosts: hostSet(env.KAITEN_FILE_HOSTS),
    maxAttachmentBytes:
      optionalPositiveInteger(
        env.KAITEN_MAX_ATTACHMENT_BYTES,
        "KAITEN_MAX_ATTACHMENT_BYTES",
      ) ?? DEFAULT_MAX_ATTACHMENT_BYTES,
  };
}

export function webBaseUrl(config: KaitenConfig): URL {
  const url = new URL(config.apiBaseUrl);
  url.pathname = url.pathname.replace(/\/api\/(?:v\d+|latest)\/?$/, "/");
  return url;
}
