export type AiAssistBackend = "vertex" | "apikey";

// firebase-tools does not load runtime .env settings during source discovery.
// Keep backend selection consistent so discovery declares only the needed secrets.
export const AI_ASSIST_BACKEND_BY_PROJECT: Readonly<Record<string, AiAssistBackend>> = {
  "pixtaffy-staging": "vertex",
};

export function resolveAiAssistBackend(env: Record<string, string | undefined>): AiAssistBackend {
  const project = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  return project && Object.prototype.hasOwnProperty.call(AI_ASSIST_BACKEND_BY_PROJECT, project)
    ? AI_ASSIST_BACKEND_BY_PROJECT[project]
    : "apikey";
}

export function resolveAiAssistVertexConfig(env: Record<string, string | undefined>): {
  project: string | undefined;
  location: string;
  model: string;
} {
  return {
    project: env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || undefined,
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
