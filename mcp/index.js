#!/usr/bin/env node
/**
 * PixTaffy MCP server: generate infographics from Claude, Codex, or any MCP
 * client as your own PixTaffy account.
 *
 * Setup:
 *   1. In PixTaffy → Settings → API access, create a personal token (bdi_…).
 *   2. Configure your MCP client with:
 *        command: node   args: ["/path/to/pixtaffy/mcp/index.js"]
 *        env: { "PIXTAFFY_API_TOKEN": "bdi_…" }
 *
 * The server is a thin wrapper over the PixTaffy HTTPS API. Generation runs
 * with YOUR account's model keys (BYOK) and is rate-limited per account.
 * The token grants generate-only access — it cannot read or change account
 * settings, keys, or other users' data.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const API_URL =
  process.env.PIXTAFFY_API_URL ||
  process.env.BRANDOIT_API_URL ||
  "https://us-central1-brandoit.cloudfunctions.net/agentGenerateImage";
const TOKEN =
  process.env.PIXTAFFY_API_TOKEN ||
  process.env.BRANDOIT_API_TOKEN ||
  "";

if (!TOKEN) {
  console.error(
    "PIXTAFFY_API_TOKEN is not set. Create a token in PixTaffy → Settings → API access.",
  );
  process.exit(1);
}

const callApi = async (body) => {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json.error || `PixTaffy API error (HTTP ${resp.status})`);
  }
  return json;
};

const buildServer = () => {
  const server = new McpServer({ name: "pixtaffy", version: "1.1.0" });

  server.registerTool(
    "generate_infographic",
    {
      title: "Generate a PixTaffy infographic",
      description: [
        "Generate one or more infographic-style images with PixTaffy using the",
        "account's saved look (type, visual style, brand colors) and the",
        "account's own model API keys. Give a CONTENT prompt — the concepts,",
        "sections, and label wording to depict — and let the account's style",
        "settings control the look. Prefer passing presetName when the user has",
        "a saved preset for this kind of work. Generation takes 30-90 seconds",
        "per image. Returns hosted image URLs; images are saved to the user's",
        "PixTaffy gallery when saveToGallery is true (the default).",
      ].join(" "),
      inputSchema: z.object({
        prompt: z
          .string()
          .min(3)
          .describe("What the graphic should teach or show — content, not styling."),
        presetName: z
          .string()
          .optional()
          .describe(
            "Name of a saved PixTaffy preset (exact, case-insensitive) supplying style/colors/size/model and optional art direction.",
          ),
        model: z
          .string()
          .optional()
          .describe(
            "Model id override, e.g. 'gemini' (Nano Banana Pro), 'gemini-3.1-flash-image-preview' (Nano Banana 2), 'openai-2.5' (GPT Image 2.5), 'openai-flare' (GPT Image 2.5 Flare), 'openai-2' (GPT Image 2), 'openai-mini', or 'openrouter:<vendor/slug>' like 'openrouter:bytedance-seed/seedream-4.5'. Omit to use the account's default.",
          ),
        aspectRatio: z
          .string()
          .optional()
          .describe("Aspect ratio like '16:9', '1:1', '9:16'. Omit for the account default."),
        outputFormat: z
          .enum(["webp", "png", "jpeg"])
          .optional()
          .describe(
            "Delivered file format. Default 'webp' — lossless, same resolution, smaller file. Use 'png' or 'jpeg' only when a consumer requires it.",
          ),
        saveToGallery: z
          .boolean()
          .optional()
          .describe("Save the result to the user's PixTaffy gallery (default true)."),
        folderName: z
          .string()
          .optional()
          .describe("Gallery folder to save into (existing folder name)."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ prompt, presetName, model, aspectRatio, outputFormat, saveToGallery, folderName }) => {
      const body = {
        prompt,
        saveToGallery: saveToGallery !== false,
        returnImageBase64: false,
      };
      if (presetName) body.presetName = presetName;
      if (folderName) body.folderName = folderName;
      const settings = {};
      if (model) settings.selectedModel = model;
      if (aspectRatio) settings.aspectRatio = aspectRatio;
      if (outputFormat) settings.outputFormat = outputFormat;
      if (Object.keys(settings).length) body.settings = settings;

      const json = await callApi(body);
      const results = Array.isArray(json.results) ? json.results : [];
      const lines = results.map((r) => {
        if (!r.ok) return `✗ ${r.error || "failed"}`;
        const url = r.imageUrl || r.storageUrl || "(saved to gallery)";
        return `✓ ${r.modelId || "image"} @ ${r.aspectRatio || "?"} — ${url}`;
      });
      if (!lines.length) lines.push(JSON.stringify(json).slice(0, 800));
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  return server;
};

serveStdio(buildServer);
