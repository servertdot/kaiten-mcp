import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for smoke (set it in .env or the environment)`);
  }
  return value;
}

const smokeEnv: Record<string, string> = {
  ...getDefaultEnvironment(),
  KAITEN_TOKEN: requireEnv("KAITEN_TOKEN"),
  KAITEN_BASE_URL: requireEnv("KAITEN_BASE_URL"),
};

for (const name of [
  "KAITEN_SPACE_IDS",
  "KAITEN_DEFAULT_SPACE_ID",
  "KAITEN_SPACE_ID",
  "KAITEN_DEFAULT_OWNER_ID",
  "KAITEN_EXPECTED_ACTOR_ID",
  "KAITEN_ALLOWED_BOARD_IDS",
  "KAITEN_FILE_HOSTS",
  "KAITEN_MAX_ATTACHMENT_BYTES",
] as const) {
  const value = process.env[name]?.trim();
  if (value) smokeEnv[name] = value;
}

const smokeCard = process.env.KAITEN_SMOKE_CARD?.trim() || "1";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "src/index.ts"],
  cwd: process.cwd(),
  env: smokeEnv,
  stderr: "inherit",
});
const client = new Client({ name: "kaiten-smoke", version: "0.1.0" });

function resultOf(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const structuredContent = (value as { structuredContent?: unknown })
    .structuredContent;
  if (!structuredContent || typeof structuredContent !== "object") {
    return undefined;
  }
  return (structuredContent as Record<string, unknown>)["result"];
}

function contentTypes(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) =>
    item && typeof item === "object" && typeof item.type === "string"
      ? [item.type]
      : [],
  );
}

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

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const identity = await client.callTool({
    name: "kaiten_get_identity",
    arguments: {},
  });
  const context = await client.callTool({
    name: "kaiten_get_card_context",
    arguments: { card: /^\d+$/.test(smokeCard) ? Number(smokeCard) : smokeCard, include_children: true },
  });
  const customProperties = await client.callTool({
    name: "kaiten_list_custom_properties",
    arguments: { include_inactive: false, limit: 10 },
  });

  const result = resultOf(context) as
    | {
        card?: { id?: number; key?: string; title?: string; column?: string };
        comments?: unknown[];
        checklists?: unknown[];
        attachments?: Array<{ id?: number }>;
      }
    | undefined;
  const card = result?.card as
    | {
        board_id?: number;
        space_id?: number;
      }
    | undefined;
  const workspace = await client.callTool({
    name: "kaiten_get_workspace_map",
    arguments:
      card?.space_id === undefined ? {} : { space_id: card.space_id },
  });
  const workspaceResult = resultOf(workspace) as
    | { boards?: Array<{ id?: number; title?: string; columns?: unknown[] }> }
    | undefined;
  const currentBoard = workspaceResult?.boards?.find(
    (board) => board.id === card?.board_id,
  );
  const firstAttachmentId = result?.attachments?.[0]?.id;
  const attachment =
    firstAttachmentId === undefined
      ? undefined
      : await client.callTool({
          name: "kaiten_read_attachment",
          arguments: {
            card: /^\d+$/.test(smokeCard) ? Number(smokeCard) : smokeCard,
            file_id: firstAttachmentId,
          },
        });
  const timeLogs = await client.callTool({
    name: "kaiten_list_time_logs",
    arguments: {
      card: /^\d+$/.test(smokeCard) ? Number(smokeCard) : smokeCard,
      personal: true,
      limit: 5,
    },
  });

  console.log(
    JSON.stringify(
      {
        tools: tools.tools.map((tool) => tool.name),
        identity: resultOf(identity),
        identity_error: identity.isError ? textContent(identity) : null,
        card: result?.card,
        current_board: currentBoard,
        workspace_error: workspace.isError ? textContent(workspace) : null,
        context_error: context.isError ? textContent(context) : null,
        custom_properties: resultOf(customProperties),
        custom_properties_error: customProperties.isError
          ? textContent(customProperties)
          : null,
        time_logs: resultOf(timeLogs),
        time_logs_error: timeLogs.isError ? textContent(timeLogs) : null,
        counts: {
          comments: result?.comments?.length ?? 0,
          checklists: result?.checklists?.length ?? 0,
          attachments: result?.attachments?.length ?? 0,
        },
        attachment_smoke:
          attachment === undefined
            ? null
            : {
                is_error: attachment.isError ?? false,
                content_types: contentTypes(attachment),
                text: textContent(attachment),
              },
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
