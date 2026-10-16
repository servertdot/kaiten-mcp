import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { KaitenClient } from "./kaiten-client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const client = new KaitenClient(loadConfig());
  const server = createServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Kaiten MCP failed to start: ${message}`);
  process.exitCode = 1;
});
