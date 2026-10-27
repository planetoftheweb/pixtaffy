export type AiAssistBackend = "vertex" | "apikey";

export function parseAiAssistBackend(raw: string | undefined): AiAssistBackend {
  return raw?.trim().toLowerCase() === "vertex" ? "vertex" : "apikey";
}

export function resolveAiAssistVertexConfig(env: Record<string, string | undefined>): {
  project: string | undefined;
  location: string;
  model: string;
} {
  return {
    project: env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT,
    location: env.AI_ASSIST_VERTEX_LOCATION?.trim() || "global",
    model: env.AI_ASSIST_VERTEX_MODEL?.trim() || "gemini-3.8-flash",
  };
}

export function buildRunAiAssistOptions<Base extends object, Secret>(
  base: Base,
  backend: AiAssistBackend,
  getSecret: () => Secret,
): Base & { secrets?: Secret[] } {
  return backend === "apikey" ? { ...base, secrets: [getSecret()] } : { ...base };
}
