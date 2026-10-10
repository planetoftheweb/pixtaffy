# BranDoIt MCP server

Generate BranDoIt infographics from Claude Code, Claude Desktop, Codex, or any
MCP client — as your own BranDoIt account, with your saved styles, presets,
and model keys.

## 1. Get a token

BranDoIt → **Settings → API access** → name a token (e.g. "Claude MCP") →
**Create token**. Copy the `bdi_…` value immediately — it is shown exactly
once. Revoke it from the same screen any time.

## 2. Configure your client

**Claude Code**

```bash
claude mcp add brandoit \
  --env BRANDOIT_API_TOKEN=bdi_YOUR_TOKEN \
  -- node /path/to/brandoit/mcp/index.js
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "brandoit": {
      "command": "node",
      "args": ["/path/to/brandoit/mcp/index.js"],
      "env": { "BRANDOIT_API_TOKEN": "bdi_YOUR_TOKEN" }
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`)

```toml
[mcp_servers.brandoit]
command = "node"
args = ["/path/to/brandoit/mcp/index.js"]
env = { BRANDOIT_API_TOKEN = "bdi_YOUR_TOKEN" }
```

## 3. Use it

Ask your assistant things like:

> Generate an infographic explaining how tides work, using my "What's New
> Hero" preset, 16:9, and save it to my Explainers folder.

The `generate_infographic` tool accepts `prompt`, `presetName`, `model`,
`aspectRatio`, `outputFormat`, `saveToGallery`, and `folderName`. Generation
takes 30–90s per image and returns hosted image URLs; results appear in your
BranDoIt gallery.

Images are delivered as lossless **webp** by default — identical pixels and
resolution to the model's PNG output, just a smaller file. Pass
`outputFormat: "png"` or `"jpeg"` when a consumer requires those.

## Using the raw HTTP API instead

Any app (e.g. a writing tool) can skip MCP and call the endpoint directly:

```bash
curl -X POST https://us-central1-brandoit.cloudfunctions.net/agentGenerateImage \
  -H "Authorization: Bearer bdi_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "How photosynthesis works",
    "presetName": "My preset",
    "saveToGallery": true,
    "settings": { "aspectRatio": "16:9" }
  }'
```

Response: `{ results: [{ ok, imageUrl, modelId, aspectRatio, … }], … }`.
Pass `"prompts": ["…", "…"]` (up to 15) for a batch, or
`"returnImageBase64": true` to get bytes inline instead of saving.

## Security model

- Tokens act only as the account that created them, spending that account's
  own BYOK model keys — there is no shared or server-side spending key.
- Only a SHA-256 hash of each token is stored; the plaintext is shown once.
- Tokens are generate-only: they cannot read or change settings, keys,
  presets, or other data, and cannot mint further tokens.
- Calls are rate-limited per account (default 60 images/hour, 300/day).
- Revocation is immediate (Settings → API access → Revoke).
