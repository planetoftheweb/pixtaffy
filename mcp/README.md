# PixTaffy MCP server

Generate PixTaffy infographics from Claude Code, Claude Desktop, Codex, or any
MCP client as your own PixTaffy account, with your saved styles, presets,
and model keys.

This package supports the MCP 2026-07-28 protocol and older 2025-era MCP
clients over the same stdio command. Node.js 20 or newer is required.

## 1. Get a token

PixTaffy → **Settings → API access** → name a token (e.g. "Claude MCP") →
**Create token**. Copy the `bdi_…` value immediately — it is shown exactly
once. Revoke it from the same screen any time.

Existing `BRANDOIT_API_TOKEN` and `BRANDOIT_API_URL` environment variables
still work as compatibility aliases.

## 2. Install the MCP server dependencies

From the PixTaffy repository root:

```bash
npm --prefix mcp install
```

## 3. Configure your client

**Claude Code**

```bash
claude mcp add pixtaffy \
  --env PIXTAFFY_API_TOKEN=bdi_YOUR_TOKEN \
  -- node /path/to/pixtaffy/mcp/index.js
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "pixtaffy": {
      "command": "node",
      "args": ["/path/to/pixtaffy/mcp/index.js"],
      "env": { "PIXTAFFY_API_TOKEN": "bdi_YOUR_TOKEN" }
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`)

```toml
[mcp_servers.pixtaffy]
command = "node"
args = ["/path/to/pixtaffy/mcp/index.js"]
env = { PIXTAFFY_API_TOKEN = "bdi_YOUR_TOKEN" }
```

## 4. Use it

Ask your assistant things like:

> Generate an infographic explaining how tides work, using my "What's New
> Hero" preset, 16:9, and save it to my Explainers folder.

The `generate_infographic` tool accepts `prompt`, `presetName`, `model`,
`aspectRatio`, `outputFormat`, `saveToGallery`, and `folderName`. Generation
takes 30–90s per image and returns hosted image URLs; results appear in your
PixTaffy gallery.

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
