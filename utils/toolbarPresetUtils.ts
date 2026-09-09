import { ToolbarPreset } from '../types';

/** Fields persisted when saving/updating a toolbar preset. */
export type ToolbarPresetSnapshot = Omit<ToolbarPreset, 'id' | 'name' | 'createdAt'>;

const normalizeOpenAIImageQuality = (
  q: ToolbarPreset['openaiImageQuality']
): NonNullable<ToolbarPreset['openaiImageQuality']> => q ?? 'auto';

const normalizeOpenAIImageBackground = (
  b: ToolbarPreset['openaiImageBackground']
): NonNullable<ToolbarPreset['openaiImageBackground']> => b ?? 'auto';

/**
 * True when the live toolbar would write a different snapshot than `preset`
 * currently stores.
 */
export const presetToolbarDiffersFromSnapshot = (
  preset: ToolbarPreset,
  current: ToolbarPresetSnapshot
): boolean => {
  return (
    (preset.graphicTypeId || undefined) !== (current.graphicTypeId || undefined) ||
    (preset.visualStyleId || undefined) !== (current.visualStyleId || undefined) ||
    (preset.colorSchemeId || undefined) !== (current.colorSchemeId || undefined) ||
    (preset.aspectRatio || undefined) !== (current.aspectRatio || undefined) ||
    preset.svgMode !== current.svgMode ||
    (preset.selectedModel || undefined) !== (current.selectedModel || undefined) ||
    normalizeOpenAIImageQuality(preset.openaiImageQuality) !==
      normalizeOpenAIImageQuality(current.openaiImageQuality) ||
    normalizeOpenAIImageBackground(preset.openaiImageBackground) !==
      normalizeOpenAIImageBackground(current.openaiImageBackground) ||
    (preset.customInstructions?.trim() || undefined) !==
      (current.customInstructions?.trim() || undefined)
  );
};

export const sanitizeToolbarPreset = (raw: unknown): ToolbarPreset | null => {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as ToolbarPreset;
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return null;
  const trimmedName = p.name.trim();
  if (!trimmedName) return null;
  const preset: ToolbarPreset = {
    id: p.id,
    name: trimmedName,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
  };
  if (p.graphicTypeId) preset.graphicTypeId = p.graphicTypeId;
  if (p.visualStyleId) preset.visualStyleId = p.visualStyleId;
  if (p.colorSchemeId) preset.colorSchemeId = p.colorSchemeId;
  if (p.aspectRatio) preset.aspectRatio = p.aspectRatio;
  if (p.svgMode) preset.svgMode = p.svgMode;
  if (p.selectedModel) preset.selectedModel = p.selectedModel;
  if (p.openaiImageQuality) preset.openaiImageQuality = p.openaiImageQuality;
  if (p.openaiImageBackground) preset.openaiImageBackground = p.openaiImageBackground;
  if (typeof p.customInstructions === 'string' && p.customInstructions.trim()) {
    preset.customInstructions = p.customInstructions.trim().slice(0, 2000);
  }
  return preset;
};

export const sanitizeToolbarPresetList = (rawList: unknown): ToolbarPreset[] => {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map(sanitizeToolbarPreset)
    .filter((p): p is ToolbarPreset => p !== null);
};
