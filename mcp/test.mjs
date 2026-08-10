import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
);
env.PIXTAFFY_API_TOKEN = "bdi_protocol_test";

const connect = async (versionNegotiation) => {
  const client = new Client(
    { name: "pixtaffy-mcp-test", version: "1.0.0" },
    { versionNegotiation },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
    stderr: "pipe",
  });
  await client.connect(transport);
  return { client, transport };
};

const assertToolList = async (client) => {
  const first = await client.listTools();
  const second = await client.listTools();
  assert.deepEqual(second, first, "tools/list should be deterministic");
  assert.equal(first.tools.length, 1);
  assert.equal(first.tools[0].name, "generate_infographic");
  assert.equal(
    first.tools[0].inputSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
};

test("negotiates MCP 2026-07-28 and exposes a deterministic tool list", async () => {
  const { client } = await connect({ mode: { pin: "2026-07-28" } });
  try {
    assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
    assert.deepEqual(client.getServerVersion(), {
      name: "pixtaffy",
      version: "1.1.0",
    });
    await assertToolList(client);
  } finally {
    await client.close();
  }
});

test("continues to serve legacy MCP clients", async () => {
  const { client } = await connect({ mode: "legacy" });
  try {
    assert.notEqual(client.getNegotiatedProtocolVersion(), "2026-07-28");
    await assertToolList(client);
  } finally {
    await client.close();
  }
});
