import { BrandColor, VisualStyle, GraphicType, AspectRatioOption } from './types';
import { 
  FileChartColumn, 
  Image, 
  PieChart, 
  AppWindow, 
  Megaphone,
  Minimize2,
  Building2,
  PenTool,
  Box,
  Frame,
  Tv,
  Tablet,
  Monitor,
  Smartphone,
  Layers,
  Spline,
  Hexagon,
  CircleDot,
  Workflow,
  Shapes
} from 'lucide-react';

export const BRAND_COLORS: BrandColor[] = [
  {
    id: 'tech-blue',
    name: 'Tech Enterprise',
    colors: ['#0B4F6C', '#00A9A5', '#FFFFFF', '#708090'] // Deep Navy, Electric Blue, White, Slate Gray
  },
  {
    id: 'warm-earth',
    name: 'Organic Earth',
    colors: ['#E2725B', '#9DC183', '#F5F5DC', '#36454F'] // Terracotta, Sage Green, Beige, Charcoal
  },
  {
    id: 'monochrome',
    name: 'Sleek Monochrome',
    colors: ['#000000', '#A9A9A9', '#D3D3D3', '#FFFFFF'] // Black, Dark Gray, Light Gray, White
  },
  {
    id: 'vibrant-pop',
    name: 'Vibrant Pop',
    colors: ['#FF69B4', '#00FFFF', '#FFFF00', '#000000'] // Hot Pink, Cyan, Yellow, Black
  }
];

export const VISUAL_STYLES: VisualStyle[] = [
  {
    id: 'minimalist-vector',
    name: 'Minimalist Vector',
    description: 'Flat design, clean lines, no gradients, plenty of whitespace.',
    icon: Minimize2,
    supportedFormats: ['raster', 'vector']
  },
  {
    id: 'corporate-flat',
    name: 'Corporate Flat',
    description: 'Professional, trustworthy, isometric clean shapes.',
    icon: Building2,
    supportedFormats: ['raster', 'vector']
  },
  {
    id: 'hand-drawn',
    name: 'Hand Drawn Sketch',
    description: 'Rough edges, pencil texture, approachable and human.',
    icon: PenTool,
    supportedFormats: ['raster']
  },
  {
    id: '3d-render',
    name: 'Soft 3D Render',
    description: 'Smooth lighting, soft shadows, claymorphism style.',
    icon: Box,
    supportedFormats: ['raster']
  },
  {
    id: 'geometric-abstract',
    name: 'Geometric Abstract',
    description: 'Bold geometric shapes, overlapping forms, vivid color blocking.',
    icon: Hexagon,
    supportedFormats: ['vector']
  },
  {
    id: 'line-art',
    name: 'Line Art',
    description: 'Single-weight continuous strokes, elegant outlines, no fills.',
    icon: Spline,
    supportedFormats: ['vector']
  },
  {
    id: 'isometric',
    name: 'Isometric',
    description: 'Precise 30-degree isometric projection, technical illustration feel.',
    icon: Layers,
    supportedFormats: ['vector']
  },
  {
    id: 'duotone',
    name: 'Duotone',
    description: 'Two-color gradient overlays, modern editorial aesthetic.',
    icon: CircleDot,
    supportedFormats: ['raster', 'vector']
  },
  {
    id: 'flowchart',
    name: 'Diagram / Flowchart',
    description: 'Connected nodes, directional arrows, clear information hierarchy.',
    icon: Workflow,
    supportedFormats: ['vector']
  },
  {
    id: 'flat-icon',
    name: 'Flat Icon Set',
    description: 'Uniform stroke weight, rounded corners, icon-grid consistent.',
    icon: Shapes,
    supportedFormats: ['vector']
  }
];

export const GRAPHIC_TYPES: GraphicType[] = [
  { id: 'infographic', name: 'Infographic', icon: FileChartColumn },
  { id: 'illustration', name: 'Spot Illustration', icon: Image },
  { id: 'chart', name: 'Data Chart', icon: PieChart },
  { id: 'icon', name: 'App Icon', icon: AppWindow },
  { id: 'marketing-banner', name: 'Marketing Banner', icon: Megaphone }
];

export const SUPPORTED_MODELS = [
  {
    id: 'gemini',
    name: 'Nano Banana Pro',
    description: 'Gemini 3 Pro Image Preview',
    format: 'raster' as const,
    group: 'Gemini' as const
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Nano Banana 2',
    description: 'Gemini 3.1 Flash Image Preview',
    format: 'raster' as const,
    group: 'Gemini' as const
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    name: 'Nano Banana 2 Lite',
    description: 'Gemini 3.1 Flash Lite Image — fastest, most cost-efficient',
    format: 'raster' as const,
    group: 'Gemini' as const
  },
  {
    id: 'gemini-svg',
    name: 'Gemini SVG',
    description: 'Gemini 3.1 Pro \u2014 SVG vector graphics',
    format: 'vector' as const,
    group: 'Gemini' as const
  },
  {
    id: 'openai-2',
    name: 'GPT Image 2',
    description: 'OpenAI gpt-image-2 \u2014 flagship image model (2K/4K, wide ratios)',
    format: 'raster' as const,
    group: 'OpenAI' as const
  },
  {
    id: 'openai-mini',
    name: 'GPT Image Mini',
    description: 'OpenAI gpt-image-1-mini \u2014 budget-tier image model',
    format: 'raster' as const,
    group: 'OpenAI' as const
  },
  {
    id: 'openai',
    name: 'GPT Image 1.5',
    description: 'OpenAI gpt-image-1.5 \u2014 previous-generation image model',
    format: 'raster' as const,
    group: 'OpenAI' as const
  }
];

export const MODEL_GROUP_ORDER = ['Gemini', 'OpenAI'] as const;

/**
 * OpenRouter (BYOK) — model ids are namespaced `openrouter:<vendor/slug>` so
 * generation dispatch and key resolution can route them without colliding
 * with native model ids. Direct provider keys ALWAYS win: when the user has
 * a Google or OpenAI key configured, the `google/*` / `openai/*` OpenRouter
 * entries are hidden from the picker so those models generate via the
 * native API instead of being re-billed through OpenRouter.
 */
export const OPENROUTER_MODEL_PREFIX = 'openrouter:';

export interface OpenRouterCuratedModel {
  slug: string;          // OpenRouter model slug, e.g. 'bytedance-seed/seedream-4.5'
  name: string;
  goodAt: string;        // rollover blurb: what this model is good at
  costPerImageUsd?: number;
}

/**
 * Curated defaults shown when an OpenRouter key is configured — the top
 * image-generation models by benchmark (Artificial Analysis image
 * leaderboard / LMArena image arena) with a bias toward infographic
 * strengths (text rendering, typography, layout). Users can disable these
 * or add their own slugs in Settings (`preferences.openRouterModels`).
 */
export const OPENROUTER_CURATED_MODELS: OpenRouterCuratedModel[] = [
  {
    slug: 'bytedance-seed/seedream-4.5',
    name: 'Seedream 4.5',
    goodAt: 'Best-in-class small-text rendering and native 4K output — the top benchmark pick for dense, text-heavy infographics.',
    costPerImageUsd: 0.03
  },
  {
    slug: 'black-forest-labs/flux.2-pro',
    name: 'FLUX.2 Pro',
    goodAt: 'Flagship all-rounder near the top of quality leaderboards — strong prompt adherence, clean composition, reliable layouts.',
    costPerImageUsd: 0.04
  },
  {
    slug: 'recraft/recraft-v4.1-pro',
    name: 'Recraft V4.1 Pro',
    goodAt: 'Design-native model — the strongest typography, brand styles, and graphic-design layouts of any API model.',
    costPerImageUsd: 0.08
  },
  {
    slug: 'x-ai/grok-imagine-image-quality',
    name: 'Grok Imagine',
    goodAt: 'xAI’s quality-tuned image model — strong general aesthetics and stylized looks.',
    costPerImageUsd: 0.07
  },
  {
    slug: 'google/gemini-3-pro-image',
    name: 'Nano Banana Pro (OR)',
    goodAt: 'Google’s flagship routed through OpenRouter. Hidden automatically when you have a direct Gemini key — the direct API is used instead.',
    costPerImageUsd: 0.134
  },
  {
    slug: 'openai/gpt-image-2',
    name: 'GPT Image 2 (OR)',
    goodAt: 'OpenAI’s flagship routed through OpenRouter. Hidden automatically when you have a direct OpenAI key — the direct API is used instead.',
    costPerImageUsd: 0.053
  }
];

export const ASPECT_RATIOS: AspectRatioOption[] = [
  { label: 'Square (1:1)', value: '1:1', icon: Frame },
  { label: 'Tall Portrait (2:3)', value: '2:3', icon: Smartphone },
  { label: 'Classic Photo (3:2)', value: '3:2', icon: Monitor },
  { label: 'Vertical (3:4)', value: '3:4', icon: Tablet },
  { label: 'Presentation (4:3)', value: '4:3', icon: Monitor },
  { label: 'Tall Print (4:5)', value: '4:5', icon: Smartphone },
  { label: 'Slide Friendly (5:4)', value: '5:4', icon: Monitor },
  { label: 'Portrait (9:16)', value: '9:16', icon: Smartphone },
  { label: 'Landscape (16:9)', value: '16:9', icon: Tv },
  { label: 'Ultrawide (21:9)', value: '21:9', icon: Tv }
];

/**
 * Estimated API cost per generated image, in USD, by model id. Used for the
 * "estimated spend" figures on the Stats page so pricing decisions can factor
 * in real costs. These are ESTIMATES at standard settings (≈1K output,
 * medium quality) — providers bill by tokens/resolution/quality, so actuals
 * vary. Last checked against published pricing: July 2026.
 */
export const MODEL_COST_PER_IMAGE_USD: Record<string, number> = {
  'gemini': 0.134,                          // Nano Banana Pro (Gemini 3 Pro Image, 1K/2K)
  'gemini-3.1-flash-image-preview': 0.067,  // Nano Banana 2 (1K)
  'gemini-3.1-flash-lite-image': 0.03,      // Nano Banana 2 Lite (est.)
  'gemini-svg': 0.01,                       // Gemini SVG — token-based text output (est.)
  'openai-2': 0.053,                        // GPT Image 2 (1024², medium)
  'openai-mini': 0.01,                      // GPT Image Mini (est.)
  'openai': 0.06,                           // GPT Image 1.5 (medium, est.)
};

for (const m of OPENROUTER_CURATED_MODELS) {
  if (m.costPerImageUsd) {
    MODEL_COST_PER_IMAGE_USD[`${OPENROUTER_MODEL_PREFIX}${m.slug}`] = m.costPerImageUsd;
  }
}

/** Fallback for unknown/legacy model ids in cost estimates. */
export const DEFAULT_COST_PER_IMAGE_USD = 0.05;
