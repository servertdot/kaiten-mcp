import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.argv.includes("--confirm-live-write")) {
  throw new Error("Pass --confirm-live-write to run the reversible Kaiten test");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for live smoke`);
  }
  return value;
}

function requirePositiveInt(name: string): number {
  const parsed = Number(requireEnv(name));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

const CARD = requireEnv("KAITEN_SMOKE_CARD");
const SPACE_ID = requirePositiveInt("KAITEN_SMOKE_SPACE_ID");
const TARGET_COLUMN_ID = requirePositiveInt("KAITEN_SMOKE_TARGET_COLUMN_ID");
const CUSTOM_PROPERTY_ID = requirePositiveInt("KAITEN_SMOKE_CUSTOM_PROPERTY_ID");
const CUSTOM_PROPERTY_NAME = requireEnv("KAITEN_SMOKE_CUSTOM_PROPERTY_NAME");

const smokeEnv: Record<string, string> = {
  ...getDefaultEnvironment(),
  KAITEN_TOKEN: requireEnv("KAITEN_TOKEN"),
  KAITEN_BASE_URL: requireEnv("KAITEN_BASE_URL"),
  KAITEN_SPACE_IDS: process.env.KAITEN_SPACE_IDS?.trim() || String(SPACE_ID),
  KAITEN_DEFAULT_SPACE_ID:
    process.env.KAITEN_DEFAULT_SPACE_ID?.trim() || String(SPACE_ID),
};

for (const name of [
  "KAITEN_DEFAULT_OWNER_ID",
  "KAITEN_EXPECTED_ACTOR_ID",
  "KAITEN_ALLOWED_BOARD_IDS",
  "KAITEN_FILE_HOSTS",
  "KAITEN_MAX_ATTACHMENT_BYTES",
] as const) {
  const value = process.env[name]?.trim();
  if (value) smokeEnv[name] = value;
}

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "src/index.ts"],
  cwd: process.cwd(),
  env: smokeEnv,
  stderr: "inherit",
});

const client = new Client({ name: "kaiten-live-smoke", version: "0.1.0" });

type CardSnapshot = {
  id: number;
  key: string;
  version: number;
  column_id: number;
  lane_id: number | null;
  properties: Record<string, unknown>;
};

function textContent(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) =>
    item &&
    typeof item === "object" &&
    item.type === "text" &&
    typeof item.text === "string"
      ? [item.text]
      : [],
  );
}

function resultOf(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const structuredContent = (value as { structuredContent?: unknown })
    .structuredContent;
  if (!structuredContent || typeof structuredContent !== "object") {
    return undefined;
  }
  return (structuredContent as Record<string, unknown>)["result"];
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) {
    throw new Error(textContent(response).join("\n") || `${name} failed`);
  }
  return resultOf(response);
}

async function expectToolFailure(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await client.callTool({ name, arguments: args });
  if (!response.isError) {
    throw new Error(`${name} unexpectedly succeeded`);
  }
  return textContent(response).join("\n");
}

function asCard(value: unknown): CardSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Kaiten returned no card context");
  }
  const card = (value as { card?: unknown }).card;
  if (!card || typeof card !== "object") {
    throw new Error("Kaiten returned malformed card context");
  }
  const snapshot = card as Partial<CardSnapshot>;
  if (
    typeof snapshot.id !== "number" ||
    typeof snapshot.key !== "string" ||
    typeof snapshot.version !== "number" ||
    typeof snapshot.column_id !== "number"
  ) {
    throw new Error("Kaiten card context is missing required fields");
  }
  return {
    id: snapshot.id,
    key: snapshot.key,
    version: snapshot.version,
    column_id: snapshot.column_id,
    lane_id: snapshot.lane_id ?? null,
    properties: snapshot.properties ?? {},
  };
}

async function readCard(): Promise<CardSnapshot> {
  return asCard(
    await callTool("kaiten_get_card_context", {
      card: CARD,
      space_id: SPACE_ID,
      include_children: false,
    }),
  );
}

async function setCustomProperty(
  snapshot: CardSnapshot,
  value: unknown,
): Promise<void> {
  await callTool("kaiten_update_card", {
    card: CARD,
    space_id: SPACE_ID,
    expected_version: snapshot.version,
    custom_properties: [
      {
        property_id: CUSTOM_PROPERTY_ID,
        expected_name: CUSTOM_PROPERTY_NAME,
        value,
      },
    ],
  });
}

async function moveCard(
  snapshot: CardSnapshot,
  targetColumnId: number,
  targetLaneId: number | null,
): Promise<void> {
  await callTool("kaiten_move_card", {
    card: CARD,
    space_id: SPACE_ID,
    expected_column_id: snapshot.column_id,
    target_column_id: targetColumnId,
    ...(targetLaneId === null ? {} : { target_lane_id: targetLaneId }),
  });
}

let initial: CardSnapshot | undefined;
let primaryError: unknown;
let cleanupError: unknown;

try {
  await client.connect(transport);
  const identity = (await callTool("kaiten_get_identity", {})) as {
    matches_expected_actor?: boolean;
  };
  if (
    smokeEnv.KAITEN_EXPECTED_ACTOR_ID &&
    !identity.matches_expected_actor
  ) {
    throw new Error("Kaiten actor does not match the configured actor");
  }

  const definitions = (await callTool("kaiten_list_custom_properties", {
    query: CUSTOM_PROPERTY_NAME,
    include_inactive: false,
    limit: 10,
  })) as Array<{ id?: number; name?: string }>;
  if (
    !definitions.some(
      (property) =>
        property.id === CUSTOM_PROPERTY_ID &&
        property.name === CUSTOM_PROPERTY_NAME,
    )
  ) {
    throw new Error(
      `Expected custom property ${CUSTOM_PROPERTY_NAME} (${CUSTOM_PROPERTY_ID}) was not found`,
    );
  }

  initial = await readCard();
  const propertyKey = `id_${CUSTOM_PROPERTY_ID}`;
  const originalPropertyValue = initial.properties[propertyKey] ?? null;
  const temporaryValue = `${String(originalPropertyValue)} [MCP smoke]`;

  const staleUpdateError = await expectToolFailure("kaiten_update_card", {
    card: CARD,
    space_id: SPACE_ID,
    expected_version: Math.max(0, initial.version - 1),
    custom_properties: [
      {
        property_id: CUSTOM_PROPERTY_ID,
        expected_name: CUSTOM_PROPERTY_NAME,
        value: temporaryValue,
      },
    ],
  });

  await setCustomProperty(initial, temporaryValue);
  const afterUpdate = await readCard();
  if (afterUpdate.properties[propertyKey] !== temporaryValue) {
    throw new Error("Temporary custom property update was not observed");
  }

  await setCustomProperty(afterUpdate, originalPropertyValue);
  const afterUpdateRestore = await readCard();
  if (afterUpdateRestore.properties[propertyKey] !== originalPropertyValue) {
    throw new Error("Custom property was not restored");
  }

  const staleMoveError = await expectToolFailure("kaiten_move_card", {
    card: CARD,
    space_id: SPACE_ID,
    expected_column_id: initial.column_id + 1,
    target_column_id: TARGET_COLUMN_ID,
    ...(initial.lane_id === null ? {} : { target_lane_id: initial.lane_id }),
  });

  await moveCard(afterUpdateRestore, TARGET_COLUMN_ID, initial.lane_id);
  const afterMove = await readCard();
  if (afterMove.column_id !== TARGET_COLUMN_ID) {
    throw new Error("Temporary card move was not observed");
  }

  await moveCard(afterMove, initial.column_id, initial.lane_id);
  const final = await readCard();
  if (
    final.column_id !== initial.column_id ||
    final.properties[propertyKey] !== originalPropertyValue
  ) {
    throw new Error("Final card state does not match the initial state");
  }

  console.log(
    JSON.stringify(
      {
        card: CARD,
        space_id: SPACE_ID,
        update: {
          temporary_value_observed: true,
          original_value_restored: true,
          stale_version_rejected: staleUpdateError.includes("refusing stale update"),
        },
        move: {
          from_column_id: initial.column_id,
          temporary_column_id: TARGET_COLUMN_ID,
          original_column_restored: true,
          stale_column_rejected: staleMoveError.includes("refusing stale move"),
        },
        final_version: final.version,
      },
      null,
      2,
    ),
  );
} catch (error) {
  primaryError = error;
} finally {
  if (initial !== undefined) {
    try {
      const propertyKey = `id_${CUSTOM_PROPERTY_ID}`;
      const originalPropertyValue = initial.properties[propertyKey] ?? null;
      let current = await readCard();
      if (current.column_id !== initial.column_id) {
        await moveCard(current, initial.column_id, initial.lane_id);
        current = await readCard();
      }
      if (current.properties[propertyKey] !== originalPropertyValue) {
        await setCustomProperty(current, originalPropertyValue);
        current = await readCard();
      }
      if (
        current.column_id !== initial.column_id ||
        current.properties[propertyKey] !== originalPropertyValue
      ) {
        throw new Error("Cleanup could not restore the initial card state");
      }
    } catch (error) {
      cleanupError = error;
    }
  }
  await client.close();
}

if (cleanupError) {
  throw new AggregateError(
    [primaryError, cleanupError].filter(Boolean),
    "Live smoke test failed and cleanup also failed",
  );
}
if (primaryError) throw primaryError;
