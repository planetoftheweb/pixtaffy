import type {
  BrandGuidelinesAnalysis,
  GeneratedImage,
  GenerationConfig,
  GraphicType,
  VisualStyle,
  BrandColor,
} from '../types';
import type { ImageCorrectionPlan } from './geminiService';
import type { AutoRegion } from './buildAutoSelect';
import { billingService } from './billingService';

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const resolveGeneratedImage = async (image: GeneratedImage): Promise<{ imageBase64: string; mimeType: string }> => {
  if (image.base64Data) return { imageBase64: image.base64Data, mimeType: image.mimeType || 'image/png' };
  if (!image.imageUrl) throw new Error('This image is not available for analysis.');
  const response = await fetch(image.imageUrl);
  if (!response.ok) throw new Error('Could not download this image for analysis.');
  const blob = await response.blob();
  return { imageBase64: await blobToBase64(blob), mimeType: blob.type || image.mimeType || 'image/png' };
};

const contextText = (
  config?: GenerationConfig,
  options?: { graphicTypes?: GraphicType[]; visualStyles?: VisualStyle[]; brandColors?: BrandColor[] },
  systemPrompt?: string,
): string => JSON.stringify({ config, options, systemPrompt: systemPrompt?.slice(0, 4_000) });

export const expandPromptPaid = async (
  text: string,
  config?: GenerationConfig,
  options?: { graphicTypes?: GraphicType[]; visualStyles?: VisualStyle[]; brandColors?: BrandColor[] },
  systemPrompt?: string,
): Promise<string> => billingService.runAiAssist<string>({
  action: 'expand_prompt',
  payload: { text, context: contextText(config, options, systemPrompt) },
});

export const describeImagePaid = async (
  imageBase64: string,
  mimeType: string,
): Promise<string> => billingService.runAiAssist<string>({
  action: 'image_description',
  payload: { imageBase64, mimeType },
});

export const analyzeImageForCorrectionPaid = async (
  image: GeneratedImage,
  config?: GenerationConfig,
  options?: { graphicTypes?: GraphicType[]; visualStyles?: VisualStyle[]; brandColors?: BrandColor[] },
  systemPrompt?: string,
): Promise<ImageCorrectionPlan> => {
  const resolved = await resolveGeneratedImage(image);
  return billingService.runAiAssist<ImageCorrectionPlan>({
    action: 'correction_analysis',
    payload: { ...resolved, context: contextText(config, options, systemPrompt) },
  });
};

export const analyzeFileOptionPaid = async (
  file: File,
  optionType: 'style' | 'color',
): Promise<{ name: string; description?: string; colors?: string[] }> =>
  billingService.runAiAssist({
    action: optionType === 'style' ? 'style_extraction' : 'image_analysis',
    payload: {
      imageBase64: await fileToBase64(file),
      mimeType: file.type || 'image/png',
      optionType,
    },
  });

export const analyzeBrandGuidelinesPaid = async (file: File): Promise<BrandGuidelinesAnalysis> => {
  const result = await billingService.runAiAssist<Partial<BrandGuidelinesAnalysis>>({
    action: file.type === 'application/pdf' ? 'brand_guidelines_pdf' : 'brand_guidelines_image',
    payload: {
      imageBase64: await fileToBase64(file),
      mimeType: file.type || 'application/pdf',
    },
  });
  return {
    brandColors: Array.isArray(result.brandColors) ? result.brandColors : [],
    visualStyles: Array.isArray(result.visualStyles) ? result.visualStyles : [],
    graphicTypes: Array.isArray(result.graphicTypes) ? result.graphicTypes : [],
  };
};

const imageElementToBase64 = (image: HTMLImageElement, width: number, height: number): string => {
  const scale = Math.min(1, 1024 / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the image for AI analysis.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
};

export const autoDetectBuildRegionsPaid = async (
  image: HTMLImageElement,
  width: number,
  height: number,
): Promise<AutoRegion[]> => {
  const result = await billingService.runAiAssist<{ regions?: Array<{ label?: string; x?: number; y?: number; w?: number; h?: number }> }>({
    action: 'region_detection',
    payload: {
      imageBase64: imageElementToBase64(image, width, height),
      mimeType: 'image/jpeg',
      width,
      height,
    },
  });
  const clamp = (value: unknown) => Math.min(1, Math.max(0, Number(value) || 0));
  return (result.regions ?? [])
    .map((region, index) => ({
      label: String(region.label || `Region ${index + 1}`).slice(0, 40),
      rect: {
        x: clamp(region.x),
        y: clamp(region.y),
        w: clamp(region.w),
        h: clamp(region.h),
      },
    }))
    .filter((region) => region.rect.w >= 0.02 && region.rect.h >= 0.02)
    .slice(0, 12);
};

export const nameBuildRegionsPaid = async (
  image: HTMLImageElement,
  width: number,
  height: number,
  regions: { index: number; rect: { x: number; y: number; w: number; h: number } }[],
): Promise<Map<number, string>> => {
  const result = await billingService.runAiAssist<{ names?: Array<string | { index?: number; label?: string }> }>({
    action: 'ai_name',
    payload: {
      imageBase64: imageElementToBase64(image, width, height),
      mimeType: 'image/jpeg',
      regions,
    },
  });
  const names = new Map<number, string>();
  (result.names ?? []).forEach((entry, index) => {
    if (typeof entry === 'string') names.set(regions[index]?.index ?? index, entry.slice(0, 40));
    else if (entry?.label) names.set(Number(entry.index ?? regions[index]?.index ?? index), entry.label.slice(0, 40));
  });
  return names;
};
