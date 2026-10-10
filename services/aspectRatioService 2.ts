import { ASPECT_RATIOS } from '../constants';
import { AspectRatioOption } from '../types';

// Gemini natively supports exactly these 10 ratios (documented by Google).
export const GEMINI_ALLOWED_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9'
] as const;

// gpt-image-1.5 and gpt-image-1-mini only produce 3 pixel sizes:
//   1024x1024 (1:1), 1024x1536 (2:3), 1536x1024 (3:2)
// Every other ratio silently maps to one of these, so only expose the real outputs.
export const OPENAI_ALLOWED_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2'
] as const;

// gpt-image-2 supports a much wider set. We enumerate the headline ratios we
// offer in the UI; openaiService picks concrete pixel sizes that satisfy
// OpenAI's constraints (edges multiples of 16, long:short <= 3:1).
export const OPENAI_2_ALLOWED_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '9:16',
  '16:9',
  '1:3',
  '3:1'
] as const;

const GEMINI_LABELS: Record<string, string> = {
  '1:1': 'Square (1:1)',
  '2:3': 'Tall Portrait (2:3)',
  '3:2': 'Classic Photo (3:2)',
  '3:4': 'Vertical (3:4)',
  '4:3': 'Presentation (4:3)',
  '4:5': 'Tall Print (4:5)',
  '5:4': 'Slide Friendly (5:4)',
  '9:16': 'Portrait (9:16)',
  '16:9': 'Landscape (16:9)',
  '21:9': 'Ultrawide (21:9)'
};

const OPENAI_LABELS: Record<string, string> = {
  '1:1': 'Square (1:1)',
  '2:3': 'Portrait (2:3)',
  '3:2': 'Landscape (3:2)'
};

const OPENAI_2_LABELS: Record<string, string> = {
  '1:1': 'Square (1:1)',
  '2:3': 'Portrait (2:3)',
  '3:2': 'Landscape (3:2)',
  '9:16': 'Tall (9:16)',
  '16:9': 'Widescreen (16:9)',
  '1:3': 'Skyscraper (1:3)',
  '3:1': 'Banner (3:1)'
};

export const normalizeAspectRatio = (value?: string): string => {
  const raw = (value || '').trim();
  if (!raw) return '';

  const compact = raw
    .replace(/\s+/g, '')
    .replace(/_/g, ':')
    .replace(/[xX×]/g, ':')
    .replace(/\//g, ':');

  const match = compact.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return compact;

  return `${match[1]}:${match[2]}`;
};

const parseRatio = (value: string): number | null => {
  const normalized = normalizeAspectRatio(value);
  const [width, height] = normalized.split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
};

const findClosestAspectRatio = (target: string, candidates: string[]): string | null => {
  const targetRatio = parseRatio(target);
  if (!targetRatio || candidates.length === 0) return null;

  let closest = candidates[0];
  let minDiff = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const candidateRatio = parseRatio(candidate);
    if (!candidateRatio) continue;
    const diff = Math.abs(targetRatio - candidateRatio);
    if (diff < minDiff) {
      minDiff = diff;
      closest = candidate;
    }
  }

  return closest;
};

const dedupeByValue = (ratios: AspectRatioOption[]): AspectRatioOption[] => {
  const map = new Map<string, AspectRatioOption>();
  for (const ratio of ratios) {
    const normalized = normalizeAspectRatio(ratio.value);
    if (!normalized || map.has(normalized)) continue;
    map.set(normalized, ratio);
  }
  return Array.from(map.values());
};

const buildFilteredRatios = (
  allowedRatios: readonly string[],
  labels: Record<string, string>,
  source: AspectRatioOption[]
): AspectRatioOption[] => {
  const sourceByValue = new Map(source.map(r => [normalizeAspectRatio(r.value), r]));
  return allowedRatios.map((value) => {
    const existing = sourceByValue.get(value);
    if (existing) {
      return {
        ...existing,
        value,
        label: labels[value],
        name: labels[value]
      };
    }

    return {
      id: `model-${value.replace(':', '-')}`,
      name: labels[value],
      label: labels[value],
      value,
      scope: 'system',
      authorId: 'system',
      authorName: 'System',
      votes: 0,
      voters: [],
      createdAt: 0,
      isSystem: true
    } as AspectRatioOption;
  });
};

export const extractAspectRatioFromText = (
  text: string,
  modelId: string,
  allRatios: AspectRatioOption[]
): string | null => {
  const value = (text || '').trim();
  if (!value) return null;

  const ratioMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:[:xX×/])\s*(\d+(?:\.\d+)?)/);
  if (ratioMatch) {
    const requested = normalizeAspectRatio(`${ratioMatch[1]}:${ratioMatch[2]}`);
    return requested ? getSafeAspectRatioForModel(modelId, requested, allRatios) : null;
  }

  const keywordMap: Array<{ pattern: RegExp; ratio: string }> = [
    { pattern: /\bultra[\s-]?wide\b|\b21\s*[:xX×/]\s*9\b/i, ratio: '21:9' },
    { pattern: /\blandscape\b|\bwidescreen\b|\b16\s*[:xX×/]\s*9\b/i, ratio: '16:9' },
    { pattern: /\bportrait\b|\b9\s*[:xX×/]\s*16\b/i, ratio: '9:16' },
    { pattern: /\bsquare\b|\b1\s*[:xX×/]\s*1\b/i, ratio: '1:1' }
  ];

  const keywordMatch = keywordMap.find((entry) => entry.pattern.test(value));
  if (!keywordMatch) return null;

  return getSafeAspectRatioForModel(modelId, keywordMatch.ratio, allRatios);
};

/**
 * Returns only the aspect ratios that the given model actually supports.
 * No silent conversions -- what you see is what you get.
 */
export const getAspectRatiosForModel = (
  modelId: string,
  allRatios: AspectRatioOption[]
): AspectRatioOption[] => {
  const source = dedupeByValue(allRatios?.length ? allRatios : ASPECT_RATIOS);

  if (
    modelId === 'gemini' ||
    modelId === 'gemini-3.1-flash-image-preview' ||
    modelId === 'gemini-3.1-flash-lite-image'
  ) {
    return buildFilteredRatios(GEMINI_ALLOWED_ASPECT_RATIOS, GEMINI_LABELS, source);
  }

  if (modelId === 'openai-2') {
    return buildFilteredRatios(OPENAI_2_ALLOWED_ASPECT_RATIOS, OPENAI_2_LABELS, source);
  }

  if (modelId === 'openai' || modelId === 'openai-mini') {
    return buildFilteredRatios(OPENAI_ALLOWED_ASPECT_RATIOS, OPENAI_LABELS, source);
  }

  // SVG & unknown models: all ratios supported
  return source;
};

/**
 * Ensures the requested aspect ratio is valid for the model.
 * If not, returns the closest supported ratio.
 */
export const getSafeAspectRatioForModel = (
  modelId: string,
  requestedAspectRatio: string,
  allRatios: AspectRatioOption[]
): string => {
  const normalizedRequested = normalizeAspectRatio(requestedAspectRatio);
  const modelRatios = getAspectRatiosForModel(modelId, allRatios);
  const modelValues = modelRatios.map(r => normalizeAspectRatio(r.value)).filter(Boolean);

  // If the requested ratio is directly supported, use it as-is
  if (normalizedRequested && modelValues.includes(normalizedRequested)) {
    return normalizedRequested;
  }

  // Otherwise find the closest match
  const closest = normalizedRequested
    ? findClosestAspectRatio(normalizedRequested, modelValues)
    : null;

  return closest || modelValues[0] || '1:1';
};
