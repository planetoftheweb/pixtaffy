export interface OpenRouterImageResult {
  base64Data: string;
  mimeType: string;
  providerRequestId: string | null;
  usage: Record<string, unknown> | null;
  actualCostUsd: number;
}

const SIZES_BY_ASPECT: Record<string, [string, string]> = {
  "1:1": ["2048x2048", "1024x1024"],
  "16:9": ["2560x1440", "1920x1080"],
  "9:16": ["1440x2560", "1080x1920"],
  "4:3": ["2304x1728", "1600x1200"],
  "3:4": ["1728x2304", "1200x1600"],
  "3:2": ["2448x1632", "1728x1152"],
  "2:3": ["1632x2448", "1152x1728"],
  "5:4": ["2160x1728", "1600x1280"],
  "4:5": ["1728x2160", "1280x1600"],
  "21:9": ["2940x1260", "2520x1080"],
  "9:21": ["1260x2940", "1080x2520"],
  "2:1": ["2720x1360", "2048x1024"],
  "1:2": ["1360x2720", "1024x2048"],
  "3:1": ["3330x1110", "2496x832"],
};

export async function generateOpenRouterImageCore(input: {
  apiKey: string;
  modelSlug: string;
  prompt: string;
  aspectRatio?: string;
  user?: string;
  title?: string;
}): Promise<OpenRouterImageResult> {
  const aspect = (input.aspectRatio || "").trim().replace(/_/g, ":").replace(/\s+/g, "");
  const baseBody: Record<string, unknown> = {
    model: input.modelSlug,
    prompt: input.prompt,
    output_format: "png",
    ...(input.user ? { user: input.user } : {}),
  };
  const sizes = SIZES_BY_ASPECT[aspect];
  const attempts: Array<Record<string, unknown>> = sizes
    ? [{ ...baseBody, size: sizes[0] }, { ...baseBody, size: sizes[1] }, { ...baseBody, aspect_ratio: aspect }]
    : [aspect ? { ...baseBody, aspect_ratio: aspect } : baseBody];

  let json: any = null;
  let lastError = "request failed";
  for (const body of attempts) {
    const response = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey.trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://pixtaffy.com",
        "X-Title": input.title || "PixTaffy",
      },
      body: JSON.stringify(body),
    });
    const candidate = await response.json().catch(() => null) as any;
    if (response.ok) {
      json = candidate;
      break;
    }
    lastError = candidate?.error?.message ?? candidate?.error ?? `HTTP ${response.status}`;
    if (response.status !== 400) break;
  }
  if (!json) throw new Error(`OpenRouter (${input.modelSlug}): ${lastError}`);
  const entry = json?.data?.[0];
  if (typeof entry?.b64_json !== "string" || entry.b64_json.length < 100) {
    throw new Error(`OpenRouter (${input.modelSlug}) returned no image data`);
  }
  const usage = json?.usage && typeof json.usage === "object"
    ? json.usage as Record<string, unknown>
    : null;
  return {
    base64Data: entry.b64_json,
    mimeType: entry.media_type || "image/png",
    providerRequestId: typeof json.id === "string" ? json.id : null,
    usage,
    actualCostUsd: Number((usage as { cost?: unknown } | null)?.cost ?? 0),
  };
}
