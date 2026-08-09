import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GenerationConfig, BrandColor, VisualStyle, GraphicType, AspectRatioOption, User, Team, SvgMode, ToolbarPreset, GeneratedImage, PromptImageStyleInfluenceMode, PromptImageStyleReference } from '../types';
import { analyzeFileOptionPaid, describeImagePaid, expandPromptPaid } from '../services/paidAiService';
import { SITE_FUNDED_MODEL_MILLICREDITS } from '../services/billingService';
import { resourceService } from '../services/resourceService';
import { teamService } from '../services/teamService';
import { SUPPORTED_MODELS, MODEL_GROUP_ORDER } from '../constants';
import { getAspectRatiosForModel } from '../services/aspectRatioService';
import { expandPromptPermutations } from '../services/promptExpansionService';
import {
  batchCapFor,
  isAdminUser,
  DEFAULT_BATCH_CONCURRENCY,
} from '../services/batchGenerationService';
import {
  estimateBatchDuration,
  formatDuration,
  getModelSecondsPerGen,
} from '../services/timeEstimationService';
import {
  Palette, 
  PenTool, 
  Layout, 
  Maximize, 
  Maximize2,
  Sparkles, 
  ChevronDown,
  Check,
  Plus,
  Trash2,
  X,
  Pencil,
  UploadCloud,
  Loader2,
  Image as ImageIcon,
  Globe,
  Lock,
  Users,
  Search,
  Settings,
  Send,
  Wand2,
  Copy,
  Play,
  Pause,
  MousePointer2,
  Gauge,
  GitCompare,
  Check as CheckIcon,
  KeyRound,
  UserPlus,
  Bookmark,
  BookmarkPlus,
  MoreHorizontal,
} from 'lucide-react';
import { RichSelect } from './RichSelect';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { AnchorRect, PresetActionPopover } from './PresetActionPopover';
import { PresetHoverPreview } from './PresetHoverPreview';

/** Fields persisted when saving/updating a toolbar preset (see App `handleSavePreset`). */
type ToolbarPresetSnapshot = Omit<ToolbarPreset, 'id' | 'name' | 'createdAt'>;

const normalizeOpenAIImageQuality = (
  q: ToolbarPreset['openaiImageQuality']
): NonNullable<ToolbarPreset['openaiImageQuality']> => q ?? 'auto';

/**
 * True when the live toolbar would write a different snapshot than `preset`
 * currently stores. OpenAI quality treats missing preset value like `auto`
 * so older presets without that field don't look perpetually "modified".
 */
const presetToolbarDiffersFromSnapshot = (
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
      normalizeOpenAIImageQuality(current.openaiImageQuality)
  );
};

interface ControlPanelProps {
  config: GenerationConfig;
  setConfig: React.Dispatch<React.SetStateAction<GenerationConfig>>;
  onGenerate: (count: number) => void;
  /** PixTaffy-funded cost for one pass across the selected models. */
  paidBatchMilliCredits?: number;
  isGenerating: boolean;
  options: {
    brandColors: BrandColor[];
    visualStyles: VisualStyle[];
    graphicTypes: GraphicType[];
    aspectRatios: AspectRatioOption[];
  };
  setOptions: {
    setBrandColors: React.Dispatch<React.SetStateAction<BrandColor[]>>;
    setVisualStyles: React.Dispatch<React.SetStateAction<VisualStyle[]>>;
    setGraphicTypes: React.Dispatch<React.SetStateAction<GraphicType[]>>;
    setAspectRatios: React.Dispatch<React.SetStateAction<AspectRatioOption[]>>;
  };
  onUploadGuidelines: (file: File) => void;
  isAnalyzing: boolean;
  user: User | null; // Pass user for contribution
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  /**
   * Dynamic models beyond SUPPORTED_MODELS (currently OpenRouter BYOK
   * models). Rendered as extra groups in the model picker; `description`
   * is the rollover blurb explaining what the model is good at.
   */
  extraModels?: Array<{
    id: string;
    name: string;
    description: string;
    format: 'raster' | 'vector';
    group: string;
  }>;
  openaiQuality?: 'low' | 'medium' | 'high' | 'auto';
  onOpenAIQualityChange?: (quality: 'low' | 'medium' | 'high' | 'auto') => void;
  /**
   * Full set of models picked for the next Generate click. When length > 1,
   * the app fans out the batch generation across every selected model and
   * tags the results with a shared comparisonBatchId. Always equals
   * [selectedModel] in single-select mode.
   */
  selectedModelIds?: string[];
  onModelIdsChange?: (ids: string[]) => void;
  setupRequired?: boolean;
  setupActionLabel?: string;
  setupActionDescription?: string;
  onSetupAction?: () => void;
  /**
   * Saved toolbar presets the user can recall. When omitted/empty the
   * dropdown shows an empty state inviting the user to save their first
   * preset.
   */
  presets?: ToolbarPreset[];
  /** Apply a preset's snapshot to the current toolbar config. */
  onApplyPreset?: (preset: ToolbarPreset) => void;
  /** Persist the current toolbar settings as a new named preset. */
  onSavePreset?: (name: string, customInstructions?: string) => Promise<void> | void;
  onEditPresetInstructions?: (presetId: string, instructions: string) => Promise<void>;
  /**
   * Overwrite an existing preset with the current toolbar settings. Used by
   * the "update from current" affordance so users can iterate on a preset
   * (tweak a style or model, then re-save) without accumulating duplicates.
   */
  onUpdatePreset?: (presetId: string) => Promise<void> | void;
  /** Rename a preset by id without touching its toolbar snapshot. */
  onRenamePreset?: (presetId: string, name: string) => Promise<void> | void;
  /** Remove a preset by id. */
  onDeletePreset?: (presetId: string) => Promise<void> | void;
  /** Convert a preset to human-readable labels for the hover preview. */
  getPresetLabels?: (preset: ToolbarPreset) => import('./PresetHoverPreview').PresetLabels;
  /**
   * When true the secondary "options" row (Type/Style/Colors/Size/Model/etc)
   * collapses to zero height so the user can focus on previews. The prompt
   * input row stays visible so refinements remain one keystroke away. The
   * App owns the state so a manual header toggle and an auto-hide-on-scroll
   * effect can both drive it.
   */
  isOptionsCollapsed?: boolean;
  /**
   * True once the user has at least one finished generation showing in the
   * main viewport. Used to hide the "Will run X generations…" predictive
   * batch-info line once the user is past the planning phase — they're
   * looking at a real result, not deciding what to queue. Predictive info
   * still shows during the first-ever planning phase and during the run
   * itself (so the user gets feedback while waiting).
   */
  hasGenerated?: boolean;
  activePromptImageStyleReference?: PromptImageStyleReference | null;
  onPromptImageStyleReferenceChange?: (reference: PromptImageStyleReference | null) => void;
}

// Modal Component
const Modal = ({ 
  isOpen, 
  onClose, 
  title, 
  children 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  children?: React.ReactNode 
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl w-full max-w-md shadow-2xl p-6 relative animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#30363d] transition-colors">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const DEFAULT_PALETTE_COLOR = '#000000';

let colorParserContext: CanvasRenderingContext2D | null | undefined;

const getColorParserContext = () => {
  if (colorParserContext !== undefined) return colorParserContext;
  if (typeof document === 'undefined') {
    colorParserContext = null;
    return colorParserContext;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  colorParserContext = canvas.getContext('2d');
  return colorParserContext;
};

const stripWrappingQuotes = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
};

const normalizeHex = (hexValue: string): string | null => {
  const hex = hexValue.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  if (hex.length === 3 || hex.length === 4) {
    const expanded = hex.split('').map(char => `${char}${char}`).join('');
    return `#${expanded.slice(0, 6).toUpperCase()}`;
  }
  if (hex.length === 6 || hex.length === 8) {
    return `#${hex.slice(0, 6).toUpperCase()}`;
  }
  return null;
};

const normalizeColorToken = (rawColor: string): string | null => {
  const input = stripWrappingQuotes(rawColor);
  if (!input) return null;

  const styleProbe = new Option().style;
  styleProbe.color = '';
  styleProbe.color = input;
  if (!styleProbe.color) return null;

  const ctx = getColorParserContext();
  if (!ctx) return null;

  ctx.fillStyle = '#000000';
  ctx.fillStyle = styleProbe.color;
  const parsed = String(ctx.fillStyle).trim();
  if (!parsed || parsed.toLowerCase() === 'transparent') return null;

  if (parsed.startsWith('#')) {
    return normalizeHex(parsed);
  }

  const channels = parsed.match(/[\d.]+%?/g);
  if (!channels || channels.length < 3) return null;

  const rgb = channels.slice(0, 3).map(channel => {
    if (channel.endsWith('%')) {
      const value = Math.max(0, Math.min(100, Number.parseFloat(channel)));
      return Math.round((value / 100) * 255);
    }
    const value = Math.max(0, Math.min(255, Number.parseFloat(channel)));
    return Math.round(value);
  });

  if (rgb.some(channel => Number.isNaN(channel))) return null;

  return `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

const parseInlineCollectionValues = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '|' || trimmed === '>') return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(part => stripWrappingQuotes(part))
      .filter(Boolean);
  }
  return [stripWrappingQuotes(trimmed)].filter(Boolean);
};

const collectStringLeaves = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringLeaves);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectStringLeaves);
  }
  return [];
};

const parseJsonColorTokens = (input: string): string[] | null => {
  try {
    const parsed = JSON.parse(input);
    return collectStringLeaves(parsed).map(stripWrappingQuotes).filter(Boolean);
  } catch {
    return null;
  }
};

const parseYamlColorTokens = (input: string): string[] => {
  const lines = input.split(/\r?\n/);
  const tokens: string[] = [];
  let inColorBlock = false;
  let colorBlockIndent = -1;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();

    if (inColorBlock && indent <= colorBlockIndent && !line.startsWith('-')) {
      inColorBlock = false;
      colorBlockIndent = -1;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1].toLowerCase();
      const value = keyMatch[2] ?? '';

      if (key.includes('color')) {
        tokens.push(...parseInlineCollectionValues(value));
        if (!value.trim() || value.trim() === '|' || value.trim() === '>') {
          inColorBlock = true;
          colorBlockIndent = indent;
        } else {
          inColorBlock = false;
          colorBlockIndent = -1;
        }
      } else if (inColorBlock && indent <= colorBlockIndent) {
        inColorBlock = false;
        colorBlockIndent = -1;
      }
      continue;
    }

    if (line.startsWith('-')) {
      tokens.push(stripWrappingQuotes(line.slice(1).trim()));
      continue;
    }

    if (inColorBlock) {
      tokens.push(...parseInlineCollectionValues(line));
    }
  }

  return tokens.filter(Boolean);
};

const parseLooseColorTokens = (input: string) => {
  const regex = /#(?:[0-9a-fA-F]{3,8})\b|(?:rgb|hsl)a?\([^)]+\)/g;
  return input.match(regex) ?? [];
};

const normalizeColorList = (tokens: string[]) => {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const cleaned = stripWrappingQuotes(token);
    if (!cleaned) continue;
    const normalized = normalizeColorToken(cleaned);
    if (normalized) {
      if (!seen.has(normalized)) {
        seen.add(normalized);
        valid.push(normalized);
      }
    } else {
      invalid.push(cleaned);
    }
  }

  return { valid, invalid };
};

type ColorValueFormat = 'HEX' | 'RGB' | 'HSL' | 'NAME' | 'UNKNOWN';

const detectColorFormat = (value: string): ColorValueFormat => {
  const cleaned = stripWrappingQuotes(value).trim();
  if (!cleaned) return 'UNKNOWN';
  if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(cleaned)) return 'HEX';
  if (/^rgba?\(/i.test(cleaned)) return 'RGB';
  if (/^hsla?\(/i.test(cleaned)) return 'HSL';
  if (/^[a-zA-Z-]+$/.test(cleaned)) return 'NAME';
  return 'UNKNOWN';
};

type HsvColor = { h: number; s: number; v: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgbChannels = (hexColor: string) => {
  const cleaned = normalizeHex(hexColor);
  if (!cleaned) return null;
  return {
    r: Number.parseInt(cleaned.slice(1, 3), 16),
    g: Number.parseInt(cleaned.slice(3, 5), 16),
    b: Number.parseInt(cleaned.slice(5, 7), 16)
  };
};

const rgbChannelsToHex = (r: number, g: number, b: number) => {
  const toHex = (channel: number) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbChannelsToHsv = (r: number, g: number, b: number): HsvColor => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  const saturation = max === 0 ? 0 : (delta / max) * 100;
  const value = max * 100;

  return { h: clamp(hue, 0, 360), s: clamp(saturation, 0, 100), v: clamp(value, 0, 100) };
};

const hsvToRgbChannels = (h: number, s: number, v: number) => {
  const saturation = clamp(s, 0, 100) / 100;
  const value = clamp(v, 0, 100) / 100;
  const chroma = value * saturation;
  const hueSection = (clamp(h, 0, 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hueSection % 2) - 1));
  const m = value - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSection >= 0 && hueSection < 1) [red, green, blue] = [chroma, x, 0];
  else if (hueSection < 2) [red, green, blue] = [x, chroma, 0];
  else if (hueSection < 3) [red, green, blue] = [0, chroma, x];
  else if (hueSection < 4) [red, green, blue] = [0, x, chroma];
  else if (hueSection < 5) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];

  return {
    r: Math.round((red + m) * 255),
    g: Math.round((green + m) * 255),
    b: Math.round((blue + m) * 255)
  };
};

const hexToHsv = (hexColor: string): HsvColor => {
  const rgb = hexToRgbChannels(hexColor);
  if (!rgb) return { h: 0, s: 0, v: 0 };
  return rgbChannelsToHsv(rgb.r, rgb.g, rgb.b);
};

const hsvToHex = (hsv: HsvColor) => {
  const rgb = hsvToRgbChannels(hsv.h, hsv.s, hsv.v);
  return rgbChannelsToHex(rgb.r, rgb.g, rgb.b);
};

const rgbChannelsToHsl = (r: number, g: number, b: number) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  return { h: hue, s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
};

const commonHexNames: Record<string, string> = {
  '#000000': 'black',
  '#FFFFFF': 'white',
  '#FF0000': 'red',
  '#00FF00': 'lime',
  '#0000FF': 'blue',
  '#00FFFF': 'aqua',
  '#FF00FF': 'fuchsia',
  '#FFFF00': 'yellow',
  '#008080': 'teal',
  '#FFA500': 'orange',
  '#800080': 'purple',
  '#FFC0CB': 'pink',
  '#808080': 'gray'
};

const formatColorValue = (hexColor: string, format: Exclude<ColorValueFormat, 'UNKNOWN'>, fallbackName?: string) => {
  const normalized = normalizeHex(hexColor) || DEFAULT_PALETTE_COLOR;
  const rgb = hexToRgbChannels(normalized);
  if (!rgb) return normalized;

  if (format === 'HEX') return normalized;
  if (format === 'RGB') return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  if (format === 'HSL') {
    const hsl = rgbChannelsToHsl(rgb.r, rgb.g, rgb.b);
    return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  }
  if (fallbackName && detectColorFormat(fallbackName) === 'NAME') return fallbackName;
  return commonHexNames[normalized] || normalized;
};

export const ControlPanel: React.FC<ControlPanelProps> = ({
  config,
  setConfig,
  onGenerate,
  paidBatchMilliCredits = 0,
  isGenerating,
  options,
  setOptions,
  onUploadGuidelines,
  isAnalyzing,
  user,
  selectedModel,
  onModelChange,
  extraModels = [],
  openaiQuality = 'auto',
  onOpenAIQualityChange,
  selectedModelIds,
  onModelIdsChange,
  setupRequired = false,
  setupActionLabel,
  setupActionDescription,
  onSetupAction,
  presets = [],
  onApplyPreset,
  onSavePreset,
  onEditPresetInstructions,
  onUpdatePreset,
  onRenamePreset,
  onDeletePreset,
  getPresetLabels,
  isOptionsCollapsed = false,
  hasGenerated = false,
  activePromptImageStyleReference = null,
  onPromptImageStyleReferenceChange,
}) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  // Model picker accordion: one provider category open at a time, anchored
  // to the selected model's category each time the picker opens.
  const [expandedModelGroup, setExpandedModelGroup] = useState<string | null>(null);
  // Rich rollover card for model rows (portal — the dropdown clips overflow).
  const [modelTip, setModelTip] = useState<{
    name: string;
    description: string;
    x: number;
    y: number;
    flipLeft: boolean;
  } | null>(null);
  const [compareModelsMode, setCompareModelsMode] = useState(false);
  const effectiveSelectedModelIds = useMemo(() => {
    if (selectedModelIds && selectedModelIds.length > 0) return selectedModelIds;
    return [selectedModel];
  }, [selectedModelIds, selectedModel]);
  const isMultiModelActive = compareModelsMode && effectiveSelectedModelIds.length > 1;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPromptDropActive, setIsPromptDropActive] = useState(false);
  const [promptImageFile, setPromptImageFile] = useState<File | null>(null);
  const [promptImageError, setPromptImageError] = useState<string | null>(null);
  const [isPromptImageAnalyzing, setIsPromptImageAnalyzing] = useState(false);

  // Modal & Edit State
  const [modalType, setModalType] = useState<'type' | 'style' | 'color' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // New Item Form State
  const [newItemName, setNewItemName] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemColors, setNewItemColors] = useState<string[]>([]);
  
  // Scoping State
  const [itemScope, setItemScope] = useState<'private' | 'public' | 'team'>('private');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [userTeams, setUserTeams] = useState<Team[]>([]);
  
  // Search State
  const [searchTerm, setSearchTerm] = useState('');

  const [isAnalysingOption, setIsAnalysingOption] = useState(false);
  const optionFileInputRef = useRef<HTMLInputElement>(null);
  const [isExpandingPrompt, setIsExpandingPrompt] = useState(false);

  // Preset save flow state. The dropdown lists existing presets and shows
  // an inline "name your preset" input when the user clicks the save CTA so
  // we don't need a full modal for a one-field interaction.
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [presetInstructionsDraft, setPresetInstructionsDraft] = useState('');
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isNamingPreset, setIsNamingPreset] = useState(false);
  const presetNameInputRef = useRef<HTMLInputElement>(null);

  const closePresetDropdown = () => {
    setActiveDropdown(null);
    setIsNamingPreset(false);
    setPresetNameDraft('');
    setPresetError(null);
  };

  const handleApplyPreset = (preset: ToolbarPreset) => {
    onApplyPreset?.(preset);
    closePresetDropdown();
  };

  const handleStartSavePreset = () => {
    setPresetError(null);
    setIsNamingPreset(true);
    // Suggest a name to make the common case zero-friction.
    setPresetNameDraft(`Preset ${presets.length + 1}`);
    // Prefill with whatever art direction is currently active so
    // save-after-apply keeps it without retyping.
    setPresetInstructionsDraft(config.customInstructions || '');
    // Defer focus so the input has mounted.
    window.setTimeout(() => presetNameInputRef.current?.focus(), 0);
  };

  const handleConfirmSavePreset = async () => {
    if (!onSavePreset) return;
    const trimmed = presetNameDraft.trim();
    if (!trimmed) {
      setPresetError('Name this preset to save it.');
      return;
    }
    if (presets.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
      setPresetError('A preset with this name already exists.');
      return;
    }
    setIsSavingPreset(true);
    setPresetError(null);
    try {
      await onSavePreset(trimmed, presetInstructionsDraft.trim() || undefined);
      closePresetDropdown();
    } catch (err: any) {
      setPresetError(err?.message || 'Failed to save preset.');
    } finally {
      setIsSavingPreset(false);
    }
  };

  // Inline "click twice to confirm" pattern, mirrors the image-related
  // delete buttons. First click arms the trash icon (swaps to a check on a
  // pulsing amber background); second click within 3s actually deletes.
  // Row-side popover + hover preview state. The actual rename/overwrite/delete
  // logic lives inside `PresetActionPopover` — this menu just tracks which row
  // is open and where to anchor the floating panels.
  const [actionMenuPresetId, setActionMenuPresetId] = useState<string | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<AnchorRect | null>(null);
  const [hoverPresetId, setHoverPresetId] = useState<string | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<AnchorRect | null>(null);

  const handleToggleActionMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    presetId: string
  ) => {
    e.stopPropagation();
    if (actionMenuPresetId === presetId) {
      setActionMenuPresetId(null);
      setActionMenuAnchor(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setActionMenuAnchor({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    });
    setActionMenuPresetId(presetId);
    setHoverPresetId(null);
    setHoverAnchor(null);
  };

  const handlePresetRowEnter = (
    e: React.MouseEvent<HTMLDivElement>,
    presetId: string
  ) => {
    if (actionMenuPresetId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverAnchor({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    });
    setHoverPresetId(presetId);
  };

  const handlePresetRowLeave = () => {
    setHoverPresetId(null);
    setHoverAnchor(null);
  };

  // When the toolbar's presets dropdown closes, clear the satellite panels too.
  useEffect(() => {
    if (activeDropdown !== 'presets') {
      setActionMenuPresetId(null);
      setActionMenuAnchor(null);
      setHoverPresetId(null);
      setHoverAnchor(null);
    }
  }, [activeDropdown]);

  // Close the action popover and hover preview on scroll/resize since they are
  // anchored to viewport coordinates and would otherwise drift off-target.
  useEffect(() => {
    if (!actionMenuPresetId && !hoverPresetId) return;
    const close = () => {
      setActionMenuPresetId(null);
      setActionMenuAnchor(null);
      setHoverPresetId(null);
      setHoverAnchor(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [actionMenuPresetId, hoverPresetId]);

  // The variations dropdown is portaled with a captured anchor rect, so close
  // it on scroll/resize rather than letting it float detached from its trigger.
  useEffect(() => {
    if (activeDropdown !== 'batch-count') return;
    const close = () => setActiveDropdown(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [activeDropdown]);

  const activeActionPreset = actionMenuPresetId
    ? presets.find((p) => p.id === actionMenuPresetId) ?? null
    : null;
  const activeHoverPreset = hoverPresetId
    ? presets.find((p) => p.id === hoverPresetId) ?? null
    : null;

  const currentToolbarPresetSnapshot = useMemo<ToolbarPresetSnapshot>(
    () => ({
      graphicTypeId: config.graphicTypeId || undefined,
      visualStyleId: config.visualStyleId || undefined,
      colorSchemeId: config.colorSchemeId || undefined,
      aspectRatio: config.aspectRatio || undefined,
      svgMode: config.svgMode,
      selectedModel,
      openaiImageQuality: openaiQuality,
    }),
    [
      config.graphicTypeId,
      config.visualStyleId,
      config.colorSchemeId,
      config.aspectRatio,
      config.svgMode,
      selectedModel,
      openaiQuality,
    ]
  );

  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);

  // Batch generation controls: variations-per-prompt count and brace expansion preview.
  const [batchCount, setBatchCount] = useState<number>(1);
  // The variations dropdown lives inside the prompt row, which is clipped by
  // `overflow-hidden` (needed for the toolbar collapse animation) and sits on
  // the base stacking layer — so an in-flow `top-full` panel gets cut off and
  // painted behind the image below. Portal it to <body> (like
  // PresetActionPopover) and anchor it to the trigger instead.
  const batchCountTriggerRef = useRef<HTMLDivElement>(null);
  const [batchCountAnchor, setBatchCountAnchor] = useState<DOMRect | null>(null);
  const batchCap = batchCapFor(user);
  const isAdmin = isAdminUser(user);
  const batchCapLabel = Number.isFinite(batchCap) ? String(batchCap) : 'unlimited';
  const expansion = useMemo(
    () => expandPromptPermutations(config.prompt || ''),
    [config.prompt]
  );
  const expandedPromptCount = expansion.prompts.length;
  const promptEntryCount = expansion.promptEntries.length;
  const safeBatchCount = Math.max(1, Math.floor(batchCount || 1));
  const perModelBatchRuns = expandedPromptCount * safeBatchCount;
  const modelCount = isMultiModelActive ? effectiveSelectedModelIds.length : 1;
  const totalBatchRuns = perModelBatchRuns * modelCount;
  const totalPaidBatchMilliCredits = paidBatchMilliCredits * perModelBatchRuns;
  const paidBatchCreditLabel = Number.isInteger(totalPaidBatchMilliCredits / 1_000)
    ? String(totalPaidBatchMilliCredits / 1_000)
    : (totalPaidBatchMilliCredits / 1_000).toFixed(1);
  const exceedsBatchCap = Number.isFinite(batchCap) && totalBatchRuns > batchCap;
  const hasSetupAction = setupRequired && typeof onSetupAction === 'function';
  const generateButtonLabel = hasSetupAction
    ? (setupActionLabel || (user ? 'Add API key' : 'Create account'))
    : isGenerating
      ? totalBatchRuns > 1
        ? `Start x${totalBatchRuns}`
        : 'Start'
      : totalBatchRuns > 1
        ? `Generate x${totalBatchRuns}`
        : 'Generate';
  const generateButtonDisabled = !hasSetupAction && (!config.prompt || exceedsBatchCap);
  const generateButtonTitle = hasSetupAction
    ? (setupActionDescription || generateButtonLabel)
    : isGenerating
      ? totalBatchRuns > 1
        ? `Start ${totalBatchRuns} more images`
        : 'Start another image'
    : totalBatchRuns > 1
      ? `Generate ${totalBatchRuns} images`
      : 'Generate image';
  const durationEstimate = useMemo(
    () => {
      // Sum per-model duration estimates so a compare run with a slow + fast
      // model reflects true parallel wall-clock behavior.
      if (isMultiModelActive) {
        const totals = effectiveSelectedModelIds.map((id) =>
          estimateBatchDuration({
            total: perModelBatchRuns,
            concurrency: DEFAULT_BATCH_CONCURRENCY,
            secondsPerGen: getModelSecondsPerGen(id),
          })
        );
        const totalSeconds = totals.reduce((maxSoFar, t) => Math.max(maxSoFar, t.totalSeconds), 0);
        const aggregateParallelism = totals.reduce((sum, t) => sum + t.effectiveConcurrency, 0);
        const effectiveConcurrency = Math.max(1, Math.min(aggregateParallelism, Math.max(1, totalBatchRuns)));
        return {
          totalSeconds,
          // Display-only field; pick the slower model's baseline so labels stay conservative.
          secondsPerGen: Math.max(...totals.map((t) => t.secondsPerGen)),
          effectiveConcurrency,
        };
      }
      return estimateBatchDuration({
        total: perModelBatchRuns,
        concurrency: DEFAULT_BATCH_CONCURRENCY,
        secondsPerGen: getModelSecondsPerGen(selectedModel),
      });
    },
    [perModelBatchRuns, selectedModel, isMultiModelActive, effectiveSelectedModelIds]
  );
  const estimatedLabel = formatDuration(durationEstimate.totalSeconds);
  // Predictive batch-info ("Will run X generations…") is most useful while
  // the user is staging a request. Once a finished generation is on screen
  // it's just visual noise reiterating numbers the user can already see in
  // the gallery, so we suppress it once `hasGenerated` is true UNLESS a
  // batch is actively running (then we still want the line to show progress
  // expectations — concurrency, ETA, etc.). The exceeds-cap warning always
  // surfaces because it blocks Generate.
  const hasBatchInfo =
    !!config.prompt &&
    (totalBatchRuns > 0 || expansion.hasBraces || expansion.hasPromptList || exceedsBatchCap) &&
    (!hasGenerated || isGenerating || exceedsBatchCap || totalPaidBatchMilliCredits > 0);
  const [paletteCopyMessage, setPaletteCopyMessage] = useState<string | null>(null);
  const paletteCopyTimerRef = useRef<number | null>(null);
  const [bulkPaletteInput, setBulkPaletteInput] = useState('');
  const [activeColorIndex, setActiveColorIndex] = useState<number | null>(null);
  const [pickerHsv, setPickerHsv] = useState<HsvColor>({ h: 0, s: 0, v: 0 });
  const [pickerFormat, setPickerFormat] = useState<Exclude<ColorValueFormat, 'UNKNOWN'>>('HEX');
  const [pickerInput, setPickerInput] = useState('');
  const pickerPanelRef = useRef<HTMLDivElement>(null);
  const saturationValueRef = useRef<HTMLDivElement>(null);
  const hueSliderRef = useRef<HTMLDivElement>(null);

  const handleExpandPrompt = async () => {
    if (!config.prompt || isExpandingPrompt) return;
    setIsExpandingPrompt(true);
    try {
      if (!user) {
        console.warn('Expand prompt: sign in and add credits first.');
        return;
      }
      const ctx = { ...options, aspectRatios: options.aspectRatios };
      const expanded = await expandPromptPaid(config.prompt, config, ctx, user.preferences?.systemPrompt);
      setConfig((prev) => ({ ...prev, prompt: expanded }));
    } catch (err) {
      console.error('Failed to expand prompt:', err);
    } finally {
      setIsExpandingPrompt(false);
    }
  };

  // Load teams when user is present
  useEffect(() => {
    if (user) {
        teamService.getUserTeams(user.id).then(teams => {
            setUserTeams(teams);
            if (teams.length > 0) setSelectedTeamId(teams[0].id);
        });
    }
  }, [user]);

  // Close dropdowns when clicking outside the toolbar. Portaled satellites
  // (the preset action popover / hover preview) live outside `containerRef`
  // but should not count as "outside" — they belong to the same widget.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const insidePortal = target.closest?.('[data-preset-popover], [data-batch-count-popover]');
      if (insidePortal) return;
      // The variations dropdown is portaled OUT of the toolbar, so a click
      // anywhere else in the toolbar (empty space, the adjacent send/expand
      // buttons) is genuinely outside it — only its own trigger keeps it
      // open. The in-toolbar dropdowns (type/style/…) keep the broad
      // container exemption since their panels live inside `containerRef`.
      if (activeDropdown === 'batch-count') {
        if (batchCountTriggerRef.current?.contains(target)) return;
        setActiveDropdown(null);
        return;
      }
      if (containerRef.current?.contains(target)) return;
      setActiveDropdown(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown]);

  // Clear search when dropdown changes
  useEffect(() => {
    setSearchTerm('');
  }, [activeDropdown]);

  // Close any open toolbar dropdown when the options row collapses so the
  // dropdown panel doesn't briefly clip during the height transition (and so
  // it isn't left "ghosted" behind the collapsed bar after expanding).
  useEffect(() => {
    if (isOptionsCollapsed) {
      setActiveDropdown(null);
    }
  }, [isOptionsCollapsed]);

  // Reset the inline preset-name input whenever the user closes the
  // presets dropdown or pivots to a different one. Without this, reopening
  // the dropdown would still be in "naming" mode with stale text.
  useEffect(() => {
    if (activeDropdown !== 'presets') {
      setIsNamingPreset(false);
      setPresetNameDraft('');
      setPresetError(null);
    }
  }, [activeDropdown]);

  const handleChange = (key: keyof GenerationConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setActiveDropdown(null);
  };

  const toggleDropdown = (name: string) => {
    setActiveDropdown(activeDropdown === name ? null : name);
  };

  const handleToggleDefault = async (e: React.MouseEvent, type: 'type'|'style'|'color', item: any) => {
    e.stopPropagation();
    if (!item.id || item.scope === 'system') return; // Cannot toggle already system items easily without unsetting? Wait, we want to toggle.
    // Actually, if it is system, we might want to unset it.
    
    // Logic: If scope is 'system', set to 'public'. If not 'system', set to 'system'.
    const newScope = item.scope === 'system' ? 'public' : 'system';
    
    try {
        let collectionName = '';
        if (type === 'type') collectionName = 'graphic_types';
        else if (type === 'style') collectionName = 'visual_styles';
        else if (type === 'color') collectionName = 'brand_colors';

        await resourceService.updateCustomItem(collectionName, item.id, { scope: newScope, isSystem: newScope === 'system' });
        
        // Optimistic Update
        const updateState = (prev: any[]) => prev.map(x => (x.id === item.id ? { ...x, scope: newScope, isSystem: newScope === 'system' } : x));
        
        if (type === 'type') setOptions.setGraphicTypes(updateState);
        else if (type === 'style') setOptions.setVisualStyles(updateState);
        else if (type === 'color') setOptions.setBrandColors(updateState);

    } catch (e) {
        console.error("Failed to toggle default status", e);
        alert("Failed to update default status.");
    }
  };

  // Grouped List Component
  const GroupedList = ({ items, type, configKey, onSelect }: any) => {
    const filtered = items.filter((item: any) => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (item.name || item.label || '').toLowerCase().includes(term) || (item.description || '').toLowerCase().includes(term);
    });

    const groups = {
        default: filtered.filter((i: any) => i.scope === 'system' || (i.isSystem && i.scope !== 'private')), // Fallback for legacy
        private: filtered.filter((i: any) => i.scope === 'private'),
        team: filtered.filter((i: any) => i.scope === 'team'),
        public: filtered.filter((i: any) => i.scope === 'public' && !i.isSystem)
    };

    const renderGroup = (groupItems: any[], title: string) => {
        if (groupItems.length === 0) return null;
        // Pin the currently-selected item to the top of its group so users
        // can see at a glance which one is active. Everything else stays
        // alphabetical.
        //
        // Subtle bug we just fixed: this used to compare `config[configKey]
        // === (a.id || a.value)`. The `||` short-circuits on `a.id`, so for
        // size (where `configKey: 'aspectRatio'` stores the item's *value*
        // like "1:1" but items also have an unrelated `id` like
        // "model-1-1"), no item ever matched and the selection never
        // pinned/highlighted. Comparing both fields independently handles
        // size correctly without changing how type/style/color behave
        // (those don't have a `value` field, so the second clause is just
        // `=== undefined` which never matches).
        const matchesConfig = (it: any) =>
            config[configKey] === it.id || config[configKey] === it.value;
        const sortedItems = [...groupItems].sort((a: any, b: any) => {
            const aSel = matchesConfig(a);
            const bSel = matchesConfig(b);
            if (aSel && !bSel) return -1;
            if (!aSel && bSel) return 1;
            return (a.name || a.label).localeCompare(b.name || b.label);
        });
        return (
            <div className="mb-2">
                <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-gray-50 dark:bg-[#161b22] sticky top-0 z-10 border-b border-gray-100 dark:border-[#30363d]">
                    {title}
                </div>
                {sortedItems.map((item: any) => {
                    const Icon = item.icon || (type === 'type' ? Layout : type === 'style' ? PenTool : type === 'size' ? Maximize : Palette);
                    // Same dual-field comparison as the sort above — keeps
                    // size's value-based matching working alongside the
                    // id-based matching everything else uses.
                    const isSelected = matchesConfig(item);

                    return (
                        <div
                            key={item.id || item.value}
                            aria-selected={isSelected}
                            className={`group relative flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                                isSelected
                                    ? 'bg-brand-teal/10 ring-1 ring-brand-teal/30 dark:ring-brand-teal/40 hover:bg-brand-teal/15'
                                    : 'hover:bg-gray-100 dark:hover:bg-[#21262d]'
                            }`}
                            onClick={() => {
                                handleChange(configKey, item.id || item.value);
                                setActiveDropdown(null);
                            }}
                        >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <Icon size={16} className={isSelected ? 'text-brand-teal dark:text-brand-teal shrink-0' : 'text-slate-500 shrink-0'} />
                                <div className="flex flex-col min-w-0">
                                    <span className={`text-xs truncate ${isSelected ? 'text-brand-teal dark:text-brand-teal font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
                                        {item.name || item.label}
                                    </span>
                                    {type === 'style' && item.description && (
                                        <span className="text-[10px] text-slate-500 truncate pr-2">
                                            {item.description}
                                        </span>
                                    )}
                                    {type === 'color' && (
                                        <div className="flex h-4 w-24 rounded-sm overflow-hidden ring-1 ring-black/5 mt-1">
                                            {item.colors.map((c: string, i: number) => (
                                                <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-1">
                                {/* Admin "Make Default" Toggle -- hidden for size (model-locked).
                                    Prefers the Firebase Auth admin claim; keeps `planetoftheweb`
                                    as a bootstrap fallback. */}
                                {type !== 'size' && !!user && (user.isAdmin || user.username === 'planetoftheweb') && (
                                    <button
                                        onClick={(e) => handleToggleDefault(e, type, item)}
                                        className={`p-1.5 rounded-md transition-colors ${
                                            item.scope === 'system' 
                                                ? 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20' 
                                                : 'text-slate-300 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-[#30363d]'
                                        }`}
                                        title={item.scope === 'system' ? "Remove from System Defaults" : "Promote to System Default"}
                                    >
                                        <Settings size={12} fill={item.scope === 'system' ? "currentColor" : "none"} />
                                    </button>
                                )}

                                <ItemActions type={type} item={item} isSelected={isSelected} />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="max-h-60 overflow-y-auto custom-scrollbar p-1 space-y-1">
            {renderGroup(groups.default, 'Defaults')}
            {renderGroup(groups.private, 'Private')}
            {renderGroup(groups.team, 'Team')}
            {renderGroup(groups.public, 'Public')}
            {filtered.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-500">
                    No items found.
                </div>
            )}
        </div>
    );
  };

  const openModal = (type: 'type' | 'style' | 'color') => {
    setModalType(type);
    setActiveDropdown(null); // Close dropdown
    setEditingId(null); // Reset edit state
    setPaletteCopyMessage(null);
    setActiveColorIndex(null);
    setNewItemName('');
    setNewItemDescription('');
    setNewItemColors([DEFAULT_PALETTE_COLOR]); // Default color
    setBulkPaletteInput('');
    
    // Default Scope
    if (user?.preferences?.settings?.contributeByDefault) {
        setItemScope('public');
    } else {
        setItemScope('public');
    }
  };

  const handleEdit = (e: React.MouseEvent, type: 'type' | 'style' | 'color', item: any) => {
    e.stopPropagation();
    setModalType(type);
    setActiveDropdown(null);
    setEditingId(item.id || item.value);
    setActiveColorIndex(null);

    setNewItemName(item.name || item.label);
    setNewItemDescription(item.description || '');
    
    // Set scope if available
    if (item.scope) setItemScope(item.scope);
    if (item.teamId) setSelectedTeamId(item.teamId);

    if (type === 'color') {
      setNewItemColors(item.colors || []);
      setBulkPaletteInput('');
    }
  };

  const closeModal = () => {
    setModalType(null);
    setEditingId(null);
    setPaletteCopyMessage(null);
    setBulkPaletteInput('');
    setActiveColorIndex(null);
  };

  const fileToGeneratedImage = (file: File): Promise<GeneratedImage> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read image file.'));
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const marker = ';base64,';
        const markerIndex = result.indexOf(marker);
        const base64Data = markerIndex >= 0 ? result.slice(markerIndex + marker.length) : result;
        resolve({
          imageUrl: result,
          base64Data,
          mimeType: file.type || 'image/png',
          timestamp: Date.now(),
        });
      };
      reader.readAsDataURL(file);
    });

  const openPromptImageDialog = (file: File) => {
    // PDFs are now valid drops too — they used to live behind the
    // standalone "Upload brand" button. Routing them through the same
    // dialog lets the user pick the action (brand analysis) right where
    // they're already aiming, and frees up a toolbar slot.
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) {
      setPromptImageError('Drop an image or PDF file onto the prompt box.');
      return;
    }
    setPromptImageFile(file);
    setPromptImageError(null);
  };

  const handlePromptDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsPromptDropActive(true);
    }
  };

  const handlePromptDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsPromptDropActive(false);
    }
  };

  const handlePromptDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPromptDropActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) openPromptImageDialog(file);
  };

  const closePromptImageDialog = () => {
    setPromptImageFile(null);
    setPromptImageError(null);
    setIsPromptImageAnalyzing(false);
  };

  const handlePromptImageToPrompt = async () => {
    if (!promptImageFile) return;
    if (!user) {
      setPromptImageError('Sign in and add credits to analyze dropped images.');
      return;
    }

    setIsPromptImageAnalyzing(true);
    setPromptImageError(null);
    try {
      const image = await fileToGeneratedImage(promptImageFile);
      const contentPrompt = await describeImagePaid(image.base64Data, image.mimeType);
      setConfig((prev) => ({ ...prev, prompt: contentPrompt }));
      closePromptImageDialog();
    } catch (err) {
      console.error('Failed to describe prompt image:', err);
      setPromptImageError(err instanceof Error ? err.message : 'Could not generate a prompt from this image.');
    } finally {
      setIsPromptImageAnalyzing(false);
    }
  };

  /**
   * Route the currently-dropped file (image or PDF) to the parent's brand
   * guidelines analysis pipeline — the same code path the old "Upload
   * brand" toolbar button used. Closes the drop dialog immediately so the
   * parent's `BrandAnalysisModal` can take focus once analysis finishes.
   */
  const handlePromptImageAsBrand = () => {
    if (!promptImageFile) return;
    const file = promptImageFile;
    closePromptImageDialog();
    onUploadGuidelines(file);
  };

  const handlePromptImageAsStyle = async (influenceMode: PromptImageStyleInfluenceMode) => {
    if (!promptImageFile) return;
    if (!user) {
      setPromptImageError('Sign in and add credits to analyze dropped images.');
      return;
    }

    setIsPromptImageAnalyzing(true);
    setPromptImageError(null);
    try {
      const [image, style] = await Promise.all([
        fileToGeneratedImage(promptImageFile),
        analyzeFileOptionPaid(promptImageFile, 'style'),
      ]);
      onPromptImageStyleReferenceChange?.({
        image,
        fileName: promptImageFile.name,
        styleName: style.name || 'Image style',
        styleDescription: style.description || 'Use the dropped image as a visual style reference.',
        influenceMode,
      });
      closePromptImageDialog();
    } catch (err) {
      console.error('Failed to analyze prompt image style:', err);
      setPromptImageError(err instanceof Error ? err.message : 'Could not use this image as a style reference.');
    } finally {
      setIsPromptImageAnalyzing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    
    if (file && file.type.startsWith('image/')) {
        processOptionFile(file);
    }
  };

  const processOptionFile = async (file: File) => {
    if (!modalType || (modalType !== 'style' && modalType !== 'color')) return;

    setIsAnalysingOption(true);
    try {
      if (!user) throw new Error('Sign in and add credits to analyze images.');
      const result = await analyzeFileOptionPaid(file, modalType);
      
      setNewItemName(result.name);
      if (modalType === 'style' && result.description) setNewItemDescription(result.description);
      if (modalType === 'color' && result.colors) setNewItemColors(result.colors);

    } catch (err) {
      console.error("Failed to analyze option image:", err);
    } finally {
      setIsAnalysingOption(false);
      if (optionFileInputRef.current) optionFileInputRef.current.value = '';
    }
  };

  const handleOptionFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        processOptionFile(file);
    }
  };

  // (Outside-click dismissal is handled by the single comprehensive handler
  // above — it exempts the portaled satellites and treats the variations
  // dropdown's clicks correctly. A second, simpler copy used to live here but
  // it closed the portaled panel on its own clicks, so it was removed.)

  useEffect(() => {
    if (activeColorIndex === null) return;

    const handlePickerOutsideClick = (event: MouseEvent) => {
      if (pickerPanelRef.current && !pickerPanelRef.current.contains(event.target as Node)) {
        setActiveColorIndex(null);
      }
    };

    document.addEventListener('mousedown', handlePickerOutsideClick);
    return () => document.removeEventListener('mousedown', handlePickerOutsideClick);
  }, [activeColorIndex]);

  useEffect(() => {
    if (activeColorIndex !== null && activeColorIndex >= newItemColors.length) {
      setActiveColorIndex(null);
    }
  }, [activeColorIndex, newItemColors.length]);

  useEffect(() => {
    return () => {
      if (paletteCopyTimerRef.current) {
        window.clearTimeout(paletteCopyTimerRef.current);
      }
    };
  }, []);

  const showPaletteCopyMessage = (message: string) => {
    if (paletteCopyTimerRef.current) {
      window.clearTimeout(paletteCopyTimerRef.current);
    }
    setPaletteCopyMessage(message);
    paletteCopyTimerRef.current = window.setTimeout(() => setPaletteCopyMessage(null), 1800);
  };

  const buildPaletteYaml = () => {
    const paletteName = (newItemName.trim() || 'Custom Palette').replace(/"/g, '\\"');
    const normalized = normalizeColorList(newItemColors).valid;
    const colors = (normalized.length > 0 ? normalized : ['#888888']).map(color => color.trim());
    const colorList = colors.map(color => `  - "${color}"`).join('\n');
    return `palette:\n  name: "${paletteName}"\n  colors:\n${colorList}`;
  };

  const fallbackCopyText = (text: string) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textArea);
    return copied;
  };

  const handleCopyPaletteYaml = async () => {
    if (modalType !== 'color') return;
    const yaml = buildPaletteYaml();
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(yaml);
      } else if (!fallbackCopyText(yaml)) {
        throw new Error('Clipboard write is not available');
      }
      showPaletteCopyMessage('Palette YAML copied');
    } catch (err) {
      console.error('Failed to copy palette YAML:', err);
      showPaletteCopyMessage('Copy failed');
    }
  };

  const formatBadgeClassMap: Record<ColorValueFormat, string> = {
    HEX: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    RGB: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    HSL: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    NAME: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
    UNKNOWN: 'bg-slate-500/10 text-slate-300 border-slate-500/30'
  };

  const setColorAtIndex = (index: number, color: string) => {
    setNewItemColors(prev => prev.map((existing, i) => (i === index ? color : existing)));
  };

  const openColorPicker = (index: number, rawColor?: string) => {
    const source = rawColor ?? newItemColors[index] ?? DEFAULT_PALETTE_COLOR;
    const normalized = normalizeColorToken(source) || DEFAULT_PALETTE_COLOR;
    const detectedFormat = detectColorFormat(source);
    const nextFormat = detectedFormat === 'UNKNOWN' ? 'HEX' : detectedFormat;

    setActiveColorIndex(index);
    setPickerHsv(hexToHsv(normalized));
    setPickerFormat(nextFormat);
    setPickerInput(formatColorValue(normalized, nextFormat, source));
  };

  const handleAddPaletteColor = () => {
    const nextIndex = newItemColors.length;
    setNewItemColors(prev => [...prev, DEFAULT_PALETTE_COLOR]);
    openColorPicker(nextIndex, DEFAULT_PALETTE_COLOR);
  };

  const commitHsv = (updater: (prev: HsvColor) => HsvColor) => {
    if (activeColorIndex === null) return;

    setPickerHsv(prev => {
      const candidate = updater(prev);
      const next = {
        h: clamp(candidate.h, 0, 360),
        s: clamp(candidate.s, 0, 100),
        v: clamp(candidate.v, 0, 100)
      };
      const hex = hsvToHex(next);
      setColorAtIndex(activeColorIndex, hex);
      setPickerFormat('HEX');
      setPickerInput(hex);
      return next;
    });
  };

  const handlePointerDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    onMove: (clientX: number, clientY: number) => void
  ) => {
    event.preventDefault();
    onMove(event.clientX, event.clientY);

    const move = (nextEvent: PointerEvent) => {
      onMove(nextEvent.clientX, nextEvent.clientY);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const updateSaturationValueFromPointer = (clientX: number, clientY: number) => {
    const element = saturationValueRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    const saturation = (x / rect.width) * 100;
    const value = 100 - (y / rect.height) * 100;

    commitHsv(prev => ({ ...prev, s: saturation, v: value }));
  };

  const updateHueFromPointer = (clientX: number) => {
    const element = hueSliderRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const hue = (x / rect.width) * 360;
    commitHsv(prev => ({ ...prev, h: hue }));
  };

  const handlePickerFormatChange = (format: Exclude<ColorValueFormat, 'UNKNOWN'>) => {
    if (activeColorIndex === null) return;

    const currentRaw = newItemColors[activeColorIndex] ?? DEFAULT_PALETTE_COLOR;
    const normalized = normalizeColorToken(currentRaw) || DEFAULT_PALETTE_COLOR;
    setPickerFormat(format);
    setPickerInput(formatColorValue(normalized, format, currentRaw));
  };

  const applyPickerInput = () => {
    if (activeColorIndex === null) return;
    const normalized = normalizeColorToken(pickerInput);
    if (!normalized) {
      showPaletteCopyMessage(`Invalid color format: ${pickerInput || 'empty value'}`);
      return;
    }

    setColorAtIndex(activeColorIndex, normalized);
    setPickerHsv(hexToHsv(normalized));
    setPickerInput(formatColorValue(normalized, pickerFormat, pickerInput));
  };

  const handleImportColorList = () => {
    if (modalType !== 'color') return;

    if (!bulkPaletteInput.trim()) {
      showPaletteCopyMessage('Paste JSON or YAML with colors first');
      return;
    }

    const jsonTokens = parseJsonColorTokens(bulkPaletteInput) || [];
    const yamlTokens = jsonTokens.length > 0 ? [] : parseYamlColorTokens(bulkPaletteInput);
    const looseTokens = jsonTokens.length > 0 || yamlTokens.length > 0 ? [] : parseLooseColorTokens(bulkPaletteInput);
    const tokens = jsonTokens.length > 0 ? jsonTokens : yamlTokens.length > 0 ? yamlTokens : looseTokens;
    const { valid, invalid } = normalizeColorList(tokens);

    if (valid.length === 0) {
      showPaletteCopyMessage('No valid colors found in JSON/YAML');
      return;
    }

    setNewItemColors(valid);
    showPaletteCopyMessage(
      invalid.length > 0
        ? `Imported ${valid.length} colors (${invalid.length} skipped)`
        : `Imported ${valid.length} colors`
    );
  };

  const handleSaveItem = async () => {
    if (!newItemName) return;

    try {
      if (modalType === 'type') {
        const newType = { name: newItemName, scope: itemScope, teamId: selectedTeamId };
        if (user) {
           if (editingId) {
             const updated = await resourceService.updateCustomItem('graphic_types', editingId, newType);
             setOptions.setGraphicTypes(prev => prev.map(x => x.id === editingId ? { ...x, ...updated } as GraphicType : x));
           } else {
             const saved = await resourceService.addCustomItem('graphic_types', newType, user.id, itemScope, selectedTeamId);
             setOptions.setGraphicTypes(prev => [...prev, saved as GraphicType]);
             handleChange('graphicTypeId', saved.id);
           }
        }
      } 
      else if (modalType === 'style') {
        const newStyle = { name: newItemName, description: newItemDescription || newItemName, scope: itemScope, teamId: selectedTeamId };
        if (user) {
           if (editingId) {
             const updated = await resourceService.updateCustomItem('visual_styles', editingId, newStyle);
             setOptions.setVisualStyles(prev => prev.map(x => x.id === editingId ? { ...x, ...updated } as VisualStyle : x));
           } else {
             const saved = await resourceService.addCustomItem('visual_styles', newStyle, user.id, itemScope, selectedTeamId);
             setOptions.setVisualStyles(prev => [...prev, saved as VisualStyle]);
             handleChange('visualStyleId', saved.id);
           }
        }
      }
      else if (modalType === 'color') {
        const { valid, invalid } = normalizeColorList(newItemColors);
        if (valid.length === 0) {
          showPaletteCopyMessage('Add at least one valid color before saving');
          return;
        }
        if (invalid.length > 0) {
          showPaletteCopyMessage(`Fix invalid colors before saving (${invalid.length})`);
          return;
        }
        const colors = valid.length > 0 ? valid : ['#888888'];
        const newColor = { name: newItemName, colors, scope: itemScope, teamId: selectedTeamId };
        if (user) {
           if (editingId) {
             const updated = await resourceService.updateCustomItem('brand_colors', editingId, newColor);
             setOptions.setBrandColors(prev => prev.map(x => x.id === editingId ? { ...x, ...updated } as BrandColor : x));
           } else {
             const saved = await resourceService.addCustomItem('brand_colors', newColor, user.id, itemScope, selectedTeamId);
             setOptions.setBrandColors(prev => [...prev, saved as BrandColor]);
             handleChange('colorSchemeId', saved.id);
           }
        }
      }
    } catch (e) {
      console.error("Error saving item:", e);
      alert("Failed to save item. Ensure you are logged in.");
    }

    closeModal();
  };

  // Catalog-item delete uses the same double-tap pattern. We key by
  // "type:id" so a brand-color id can't accidentally arm a visual-style row
  // that happens to share an id.
  const confirmCatalogDelete = useConfirmAction<string>({
    onConfirm: (key) => {
      const [type, idOrValue] = key.split(':', 2);
      if (type === 'type') {
        setOptions.setGraphicTypes(prev => prev.filter(x => x.id !== idOrValue));
        if (user) resourceService.deleteCustomItem('graphic_types', idOrValue);
      } else if (type === 'style') {
        setOptions.setVisualStyles(prev => prev.filter(x => x.id !== idOrValue));
        if (user) resourceService.deleteCustomItem('visual_styles', idOrValue);
      } else if (type === 'color') {
        setOptions.setBrandColors(prev => prev.filter(x => x.id !== idOrValue));
        if (user) resourceService.deleteCustomItem('brand_colors', idOrValue);
      }
    },
  });
  const handleDelete = (e: React.MouseEvent, type: 'type'|'style'|'color', idOrValue: string) => {
    e.stopPropagation();
    confirmCatalogDelete.trigger(`${type}:${idOrValue}`);
  };

  const DropdownButton = ({ icon: Icon, label, isActive, onClick, subLabel, colors }: any) => {
    // Menu-style item (no per-button border). Five responsive tiers driven by pure CSS:
    //   - base  (< md):   icon-only 44x44 tap target (tooltip shows label)
    //   - md+  (>=768):   icon + UPPERCASE category label (TYPE, STYLE, ...)
    //   - lg+  (>=1024):  icon + selected value (Infographic, Hand Drawn, ...)
    //   - xl+  (>=1280):  icon + stacked SUBLABEL/value + chevron
    //   - 2xl+ (>=1536):  adds color-palette preview strip under value
    // The compact category-label tier replaces the old icon-only-only tier
    // at tablet widths so users can still recognize each control by name.
    const titleText =
      subLabel && (typeof label === 'string' || typeof label === 'number')
        ? `${subLabel}: ${label}`
        : typeof subLabel === 'string'
          ? subLabel
          : undefined;
    return (
      <button
        onClick={onClick}
        title={titleText}
        aria-label={titleText}
        className={`h-11 rounded-md flex items-center transition-colors group shrink-0 lg:shrink lg:min-w-0
          w-11 justify-center p-0
          md:w-auto md:justify-start md:px-2.5 md:gap-2
          xl:px-3 xl:gap-2.5
          ${
            isActive
              ? 'bg-brand-teal/10 text-brand-teal dark:text-brand-teal'
              : 'text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#1c2128]'
          }`}
      >
        <Icon
          size={20}
          className={`shrink-0 ${
            isActive ? 'text-brand-teal' : 'text-slate-500 dark:text-slate-400 group-hover:text-brand-teal'
          }`}
        />
        {/* Compact category label — only md..lg (when there's no room for the full value). */}
        <span className={`hidden md:inline lg:hidden text-[11px] uppercase font-bold tracking-wider whitespace-nowrap ${
          isActive ? 'text-brand-teal' : 'text-slate-600 dark:text-slate-300 group-hover:text-brand-teal'
        }`}>
          {subLabel}
        </span>
        {/* Selected value (and optional stacked sublabel + palette) — lg+ */}
        <div className="hidden lg:flex flex-col flex-1 min-w-0 text-left">
          <span className="hidden xl:block text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider leading-none mb-0.5">
            {subLabel}
          </span>
          {typeof label === 'string' || typeof label === 'number' ? (
            <span className={`truncate font-semibold text-sm xl:text-[15px] max-w-[100px] xl:max-w-none ${
              isActive ? 'text-brand-teal' : 'text-slate-700 dark:text-slate-100 group-hover:text-brand-teal'
            }`}>{label}</span>
          ) : (
            <div className={`min-w-0 truncate text-sm xl:text-[15px] max-w-[100px] xl:max-w-none ${
              isActive ? 'text-brand-teal' : 'text-slate-700 dark:text-slate-100 group-hover:text-brand-teal'
            }`}>{label}</div>
          )}
          {colors && colors.length > 0 && (
            <div className="hidden 2xl:flex h-[3px] mt-1 rounded-sm overflow-hidden ring-1 ring-black/5 dark:ring-white/10 opacity-90">
              {colors.map((hex: string, i: number) => (
                <div key={i} className="flex-1 h-full" style={{ backgroundColor: hex }} />
              ))}
            </div>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`hidden xl:block shrink-0 ml-0.5 transition-transform duration-200 text-slate-400 dark:text-slate-500 ${
            isActive ? 'rotate-180 text-brand-teal' : ''
          }`}
        />
      </button>
    );
  };

  const currentType = options.graphicTypes.find(t => t.id === config.graphicTypeId);
  const isSvgModel = SUPPORTED_MODELS.find(m => m.id === selectedModel)?.format === 'vector';
  const filteredStyles = options.visualStyles.filter(s => {
    if (!s.supportedFormats || s.supportedFormats.length === 0) return true;
    return s.supportedFormats.includes(isSvgModel ? 'vector' : 'raster');
  });
  const currentStyle = filteredStyles.find(s => s.id === config.visualStyleId)
    || options.visualStyles.find(s => s.id === config.visualStyleId);
  const currentColor = options.brandColors.find(c => c.id === config.colorSchemeId);
  const modelAspectRatios = getAspectRatiosForModel(selectedModel, options.aspectRatios);
  const currentRatio =
    modelAspectRatios.find(r => r.value === config.aspectRatio) ||
    options.aspectRatios.find(r => r.value === config.aspectRatio);
  const modelLabelMap: Record<string, string> = {
    gemini: 'Nano Banana Pro',
    'gemini-3.1-flash-image-preview': 'Nano Banana 2',
    'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite',
    'openai-2': 'GPT Image 2',
    'openai-mini': 'GPT Image Mini',
    openai: 'GPT Image 1.5',
    'gemini-svg': 'Gemini SVG'
  };
  // Native models + dynamic (OpenRouter) models, and the group headers to
  // render them under. Extra groups always come after the native ones.
  const allModels = useMemo(() => [...SUPPORTED_MODELS, ...extraModels], [extraModels]);
  const modelGroupNames = useMemo(() => {
    const names: string[] = [...MODEL_GROUP_ORDER];
    for (const m of extraModels) {
      if (!names.includes(m.group)) names.push(m.group);
    }
    return names;
  }, [extraModels]);

  const getModelLabel = (id: string): string =>
    modelLabelMap[id] || allModels.find((m) => m.id === id)?.name || id || 'Model';

  // Open the picker with the selected model's category expanded.
  useEffect(() => {
    if (activeDropdown === 'model') {
      setExpandedModelGroup(
        allModels.find((m) => m.id === selectedModel)?.group ?? modelGroupNames[0] ?? null
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDropdown]);
  const modelLabel: React.ReactNode = (() => {
    if (!isMultiModelActive) return getModelLabel(selectedModel);
    const ids = effectiveSelectedModelIds;
    if (ids.length === 0) return 'Model';
    if (ids.length === 1) return getModelLabel(ids[0]);
    return `${getModelLabel(ids[0])} +${ids.length - 1}`;
  })();

  const inputClass = "w-full bg-white dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] text-slate-900 dark:text-white text-base rounded-lg p-3.5 focus:outline-none focus:ring-1 focus:ring-brand-red focus:border-brand-red transition-all placeholder-slate-400 dark:placeholder-slate-600";
  const labelClass = "block text-xs md:text-sm font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1";

  // Helper to render scope icon
  const ScopeIcon = ({ scope }: { scope?: string }) => {
    if (scope === 'public') return <Globe size={12} className="text-brand-teal" />;
    if (scope === 'team') return <Users size={12} className="text-brand-orange" />;
    if (scope === 'private') return <Lock size={12} className="text-slate-400" />;
    return null; // System items or undefined
  };

  const ItemActions = ({ type, item, isSelected }: { type: 'type'|'style'|'color'|'size', item: any, isSelected: boolean }) => (
    <div className="flex items-center gap-1">
      {/* Scope Badge (Always Visible if not system) */}
      {!item.isSystem && (
         <div className="mr-1 opacity-70" title={item.scope}>
           <ScopeIcon scope={item.scope} />
         </div>
      )}
      
      <div className={`flex items-center gap-1`}>
        {/* Sizes are model-locked -- no edit/delete allowed.
            Admin-override: the claim-derived `user.isAdmin` (or the legacy
            `planetoftheweb` bootstrap username) can edit any item. */}
        {type !== 'size' && user && ((!item.isSystem && item.authorId === user.id) || user.isAdmin || user.username === 'planetoftheweb') && (
          <>
            <button 
              onClick={(e) => handleEdit(e, type, item)} 
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-[#30363d] rounded-md text-slate-500 hover:text-brand-teal dark:hover:text-brand-teal transition-colors"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            {(() => {
              const catalogKey = `${type}:${item.id || item.value}`;
              const isArmed = confirmCatalogDelete.isArmed(catalogKey);
              return (
                <button
                  onClick={(e) => handleDelete(e, type, item.id || item.value)}
                  className={`p-1.5 rounded-md transition-colors ${
                    isArmed
                      ? 'bg-amber-500 text-white hover:bg-amber-600 animate-pulse'
                      : 'hover:bg-gray-100 dark:hover:bg-[#30363d] text-slate-500 hover:text-red-500 dark:hover:text-red-400'
                  }`}
                  title={isArmed ? 'Click again to confirm' : 'Delete'}
                  aria-label={isArmed ? 'Click again to confirm delete' : 'Delete'}
                >
                  {isArmed ? <Check size={12} /> : <Trash2 size={12} />}
                </button>
              );
            })()}
          </>
        )}
      </div>
      {isSelected && <Check size={14} className="text-brand-teal dark:text-brand-teal ml-1" />}
    </div>
  );

  const SearchInput = () => (
    <div className="p-2 border-b border-gray-200 dark:border-[#30363d] sticky top-0 bg-white dark:bg-[#161b22] z-10">
        <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
                type="text" 
                placeholder="Search..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-md focus:outline-none focus:ring-1 focus:ring-brand-teal text-slate-900 dark:text-white"
            />
        </div>
    </div>
  );

  return (
    <>
      <div
        className={`sticky top-[73px] z-40 w-full transition-[padding] duration-300 [overflow-anchor:none] ${
          isOptionsCollapsed
            // Collapsed = truly invisible: no padding, no glass strip, no
            // border. Otherwise the toolbar leaves a thin bordered band that
            // — together with the header's own border — reads as a weird
            // "double line" with dead space where the prompt used to be.
            ? 'p-0 border-b-0'
            : 'p-4 bg-white/95 dark:bg-[#0d1117]/95 backdrop-blur-md border-b border-gray-200 dark:border-[#30363d]'
        }`}
        ref={containerRef}
        data-toolbar-region
      >
        <div className={`max-w-[96rem] mx-auto flex flex-col ${isOptionsCollapsed ? 'gap-0' : 'gap-4'}`}>

          {/* 1. Toolbar Controls — menu bar. The collapsible wrapper hides
              this row entirely so the user can focus on previews. We keep
              `overflow:visible` while expanded so dropdown panels (which
              are absolute children with `top-full`) can still escape this
              box; only the brief collapsed state clips them. At lg+ the
              row is forced to a single line (`flex-nowrap`); the dropdown
              buttons truncate their value labels via `lg:min-w-0` when
              there isn't enough room. Below lg we still allow a wrap
              fallback so tiny viewports never produce a horizontal
              scrollbar that would clip the dropdown panels. */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
              isOptionsCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
            }`}
            aria-hidden={isOptionsCollapsed}
            // `inert` keeps Tab focus from landing on the hidden controls;
            // `aria-hidden` alone doesn't remove them from the focus order.
            inert={isOptionsCollapsed}
          >
          <div className={`min-h-0 ${isOptionsCollapsed ? 'overflow-hidden' : 'overflow-visible'}`}>
          <div className="flex flex-wrap lg:flex-nowrap items-center justify-center gap-0.5 md:gap-1 xl:gap-1.5 w-full lg:min-w-0">
            
            {/* Graphic Type */}
            <div className="relative">
              <DropdownButton 
                icon={currentType?.icon || Layout} 
                subLabel="Type" 
                label={currentType?.name || 'Select'} 
                isActive={activeDropdown === 'type'} 
                onClick={() => toggleDropdown('type')} 
              />
              {activeDropdown === 'type' && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
                  {user && <SearchInput />}
                  <GroupedList 
                    items={options.graphicTypes} 
                    type="type" 
                    configKey="graphicTypeId" 
                  />
                  {user && (
                    <button onClick={() => openModal('type')} className="w-full text-left p-3 text-xs font-bold text-brand-teal dark:text-brand-teal border-t border-gray-200 dark:border-[#30363d] hover:bg-gray-100 dark:hover:bg-[#21262d] flex items-center gap-2 transition-colors">
                       <Plus size={14} /> Add Custom Type
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Visual Style */}
            <div className="relative">
              <DropdownButton 
                icon={currentStyle?.icon || PenTool} 
                subLabel="Style" 
                label={currentStyle?.name || 'Select'} 
                isActive={activeDropdown === 'style'} 
                onClick={() => toggleDropdown('style')} 
              />
               {activeDropdown === 'style' && (
                <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
                  {user && <SearchInput />}
                  <GroupedList 
                    items={filteredStyles} 
                    type="style" 
                    configKey="visualStyleId" 
                  />
                  {user && (
                    <button onClick={() => openModal('style')} className="w-full text-left p-3 text-xs font-bold text-brand-teal dark:text-brand-teal border-t border-gray-200 dark:border-[#30363d] hover:bg-gray-100 dark:hover:bg-[#21262d] flex items-center gap-2 transition-colors">
                       <Plus size={14} /> Add Custom Style
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* SVG Mode (only for vector models) */}
            {isSvgModel && (
              <div className="relative">
                <DropdownButton 
                  icon={config.svgMode === 'animated' ? Play : config.svgMode === 'interactive' ? MousePointer2 : Pause} 
                  subLabel="Mode" 
                  label={config.svgMode === 'animated' ? 'Animated' : config.svgMode === 'interactive' ? 'Interactive' : 'Static'} 
                  isActive={activeDropdown === 'svgmode'} 
                  onClick={() => toggleDropdown('svgmode')} 
                />
                {activeDropdown === 'svgmode' && (
                  <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
                    {([
                      { id: 'static' as SvgMode, label: 'Static', icon: Pause, desc: 'No animations' },
                      { id: 'animated' as SvgMode, label: 'Animated', icon: Play, desc: 'CSS/SMIL animations' },
                      { id: 'interactive' as SvgMode, label: 'Interactive', icon: MousePointer2, desc: 'Hover & focus states' },
                    ]).map(mode => {
                      const isSel = (config.svgMode || 'static') === mode.id;
                      return (
                      <button
                        key={mode.id}
                        onClick={() => {
                          setConfig(prev => ({ ...prev, svgMode: mode.id }));
                          setActiveDropdown(null);
                        }}
                        aria-selected={isSel}
                        className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                          isSel
                            ? 'bg-brand-teal/10 text-brand-teal font-semibold border-l-2 border-brand-teal'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] border-l-2 border-transparent'
                        }`}
                      >
                        <mode.icon size={14} className={isSel ? 'text-brand-teal' : 'text-slate-500 dark:text-slate-400'} />
                        <div className="flex flex-col flex-1">
                          <span className="font-medium">{mode.label}</span>
                          <span className={`text-xs ${isSel ? 'text-brand-teal/80' : 'text-slate-500 dark:text-slate-400'}`}>{mode.desc}</span>
                        </div>
                        {isSel && <CheckIcon size={14} className="text-brand-teal shrink-0" />}
                      </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Color Palette */}
            <div className="relative">
              <DropdownButton 
                icon={Palette} 
                subLabel="Colors" 
                label={currentColor?.name || 'Select'} 
                isActive={activeDropdown === 'color'} 
                onClick={() => toggleDropdown('color')}
                colors={currentColor?.colors}
              />
              {activeDropdown === 'color' && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
                  {user && <SearchInput />}
                  <GroupedList 
                    items={options.brandColors} 
                    type="color" 
                    configKey="colorSchemeId" 
                  />
                  {user && (
                    <button onClick={() => openModal('color')} className="w-full text-left p-3 text-xs font-bold text-brand-red dark:text-brand-orange border-t border-gray-200 dark:border-[#30363d] hover:bg-gray-100 dark:hover:bg-[#21262d] flex items-center gap-2 transition-colors">
                       <Plus size={14} /> Add Custom Palette
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Aspect Ratio */}
            <div className="relative">
              <DropdownButton 
                icon={currentRatio?.icon || Maximize} 
                subLabel="Size" 
                label={currentRatio?.label.split(' ')[0] || config.aspectRatio} 
                isActive={activeDropdown === 'size'} 
                onClick={() => toggleDropdown('size')} 
              />
              {activeDropdown === 'size' && (
                <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
                  {user && <SearchInput />}
                  <GroupedList 
                    items={modelAspectRatios} 
                    type="size" 
                    configKey="aspectRatio" 
                  />
                  <div className="w-full text-left p-3 text-[11px] text-slate-500 border-t border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117]">
                    {isSvgModel
                      ? 'SVG: all ratios available (mapped to viewBox).'
                      : selectedModel === 'openai-2'
                        ? 'Showing ratios GPT Image 2 supports (incl. 2K/4K & 3:1).'
                        : selectedModel === 'openai' || selectedModel === 'openai-mini'
                          ? 'Showing only ratios GPT Image outputs natively.'
                          : 'Showing only ratios Nano Banana models support natively.'}
                  </div>
                </div>
              )}
            </div>
            {/* Model Selector (fancy dropdown) */}
            <div className="relative">
              <DropdownButton 
                icon={Sparkles} 
                subLabel="Model" 
                label={modelLabel} 
                isActive={activeDropdown === 'model'} 
                onClick={() => toggleDropdown('model')} 
              />
              {activeDropdown === 'model' && (
                <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      setCompareModelsMode((prev) => {
                        const next = !prev;
                        if (!next && onModelIdsChange) {
                          onModelIdsChange([selectedModel]);
                        } else if (next && onModelIdsChange && (!selectedModelIds || selectedModelIds.length === 0)) {
                          onModelIdsChange([selectedModel]);
                        }
                        return next;
                      });
                    }}
                    title="Toggle multi-model generation. When two or more models are selected, each Generate click runs once per model and tags the results as a comparison batch."
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium border-b border-gray-100 dark:border-[#30363d] transition-colors ${
                      compareModelsMode
                        ? 'bg-brand-teal/10 text-brand-teal'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d]'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <GitCompare size={15} className={compareModelsMode ? 'text-brand-teal' : 'text-slate-500'} />
                      <span>Compare models</span>
                    </span>
                    <span className={`text-[11px] uppercase tracking-wider font-bold ${compareModelsMode ? 'text-brand-teal' : 'text-slate-400'}`}>
                      {compareModelsMode ? 'On' : 'Off'}
                    </span>
                  </button>
                  {modelGroupNames.map((groupName) => {
                    const groupModels = allModels.filter((m) => m.group === groupName);
                    if (groupModels.length === 0) return null;
                    const isExpanded = expandedModelGroup === groupName;
                    const selectedInGroup = groupModels.find((m) => m.id === selectedModel);
                    const checkedInGroup = compareModelsMode
                      ? groupModels.filter((m) => effectiveSelectedModelIds.includes(m.id)).length
                      : 0;
                    return (
                      <div key={groupName}>
                        {/* Category header — accordion toggle. Collapsed rows
                            still show which model inside is active. */}
                        <button
                          type="button"
                          onClick={() => setExpandedModelGroup(isExpanded ? null : groupName)}
                          aria-expanded={isExpanded}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-gray-50 dark:bg-[#0d1117] border-b border-gray-100 dark:border-[#30363d] hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                          <ChevronDown
                            size={12}
                            className={`shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                          />
                          <span>{groupName}</span>
                          <span className="ml-auto flex items-center gap-1.5 min-w-0 normal-case tracking-normal font-medium">
                            {checkedInGroup > 0 && (
                              <span className="px-1.5 rounded-full bg-brand-teal/15 text-brand-teal text-[10px] font-bold">
                                {checkedInGroup}
                              </span>
                            )}
                            {!isExpanded && selectedInGroup && (
                              <span className="truncate text-brand-teal">{getModelLabel(selectedInGroup.id)}</span>
                            )}
                            {!isExpanded && !selectedInGroup && (
                              <span className="text-slate-400 dark:text-slate-500">{groupModels.length}</span>
                            )}
                          </span>
                        </button>
                        {isExpanded && groupModels.map((model) => {
                          const isChecked = effectiveSelectedModelIds.includes(model.id);
                          const isPrimary = selectedModel === model.id;
                          return (
                            <button
                              key={model.id}
                              onClick={() => {
                                if (compareModelsMode) {
                                  if (!onModelIdsChange) return;
                                  const currentIds = effectiveSelectedModelIds;
                                  let nextIds: string[];
                                  if (currentIds.includes(model.id)) {
                                    nextIds = currentIds.filter((id) => id !== model.id);
                                    if (nextIds.length === 0) {
                                      // Never fully deselect — keep at least one model.
                                      return;
                                    }
                                  } else {
                                    nextIds = [...currentIds, model.id];
                                  }
                                  onModelIdsChange(nextIds);
                                  if (!nextIds.includes(selectedModel)) {
                                    onModelChange(nextIds[0]);
                                  }
                                } else {
                                  onModelChange(model.id);
                                  if (onModelIdsChange) onModelIdsChange([model.id]);
                                  setActiveDropdown(null);
                                  setModelTip(null);
                                }
                              }}
                              onMouseEnter={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                const flipLeft = r.right + 296 > window.innerWidth;
                                setModelTip({
                                  name: modelLabelMap[model.id] || model.name,
                                  description: model.description,
                                  x: flipLeft ? r.left - 8 : r.right + 8,
                                  y: r.top + r.height / 2,
                                  flipLeft
                                });
                              }}
                              onMouseLeave={() => setModelTip(null)}
                              aria-selected={compareModelsMode ? isChecked : isPrimary}
                              className={`w-full text-left pl-5 pr-3 py-2 text-[15px] flex items-center gap-2 transition-colors border-l-2 ${
                                (compareModelsMode ? isChecked : isPrimary)
                                  ? 'bg-brand-teal/10 text-brand-teal font-semibold border-brand-teal hover:bg-brand-teal/15'
                                  : 'text-slate-700 dark:text-slate-200 border-transparent hover:bg-gray-100 dark:hover:bg-[#21262d]'
                              }`}
                            >
                              {compareModelsMode ? (
                                <span
                                  className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                    isChecked
                                      ? 'bg-brand-teal border-brand-teal text-white'
                                      : 'border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#0d1117]'
                                  }`}
                                >
                                  {isChecked && <CheckIcon size={12} strokeWidth={3} />}
                                </span>
                              ) : (
                                <Sparkles size={14} className="text-brand-teal shrink-0" />
                              )}
                              <span className="font-medium">{modelLabelMap[model.id] || model.name}</span>
                              {SITE_FUNDED_MODEL_MILLICREDITS[model.id] && (
                                <span className="ml-auto shrink-0 rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-200">
                                  {SITE_FUNDED_MODEL_MILLICREDITS[model.id] / 1_000} cr or BYOK
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                  {compareModelsMode && (
                    <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 bg-gray-50 dark:bg-[#0d1117] border-t border-gray-100 dark:border-[#30363d]">
                      {effectiveSelectedModelIds.length < 2
                        ? 'Pick a second model to compare.'
                        : `Each Generate click will run ${effectiveSelectedModelIds.length} times — once per model.`}
                    </div>
                  )}
                </div>
              )}
              {activeDropdown === 'model' && modelTip && createPortal(
                <div
                  className="fixed z-[400] pointer-events-none w-72"
                  style={{
                    top: modelTip.y,
                    ...(modelTip.flipLeft
                      ? { right: window.innerWidth - modelTip.x }
                      : { left: modelTip.x }),
                    transform: 'translateY(-50%)'
                  }}
                >
                  <div className="rounded-lg bg-black/90 px-3 py-2 text-[13px] leading-snug text-white shadow-xl">
                    <div className="font-semibold">{modelTip.name}</div>
                    <div className="mt-0.5 text-white/70">{modelTip.description}</div>
                  </div>
                </div>,
                document.body
              )}
            </div>

            {/* Quality (OpenAI models only — gpt-image-1.5 ignores this but is harmless) */}
            {(selectedModel === 'openai-2' || selectedModel === 'openai-mini') && onOpenAIQualityChange && (
              <div className="relative">
                <DropdownButton
                  icon={Gauge}
                  subLabel="Quality"
                  label={
                    openaiQuality === 'auto'
                      ? 'Auto'
                      : openaiQuality.charAt(0).toUpperCase() + openaiQuality.slice(1)
                  }
                  isActive={activeDropdown === 'quality'}
                  onClick={() => toggleDropdown('quality')}
                />
                {activeDropdown === 'quality' && (
                  <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
                    {([
                      { id: 'auto' as const, label: 'Auto', desc: 'Model picks the best' },
                      { id: 'low' as const, label: 'Low', desc: 'Fastest, cheapest' },
                      { id: 'medium' as const, label: 'Medium', desc: 'Balanced' },
                      { id: 'high' as const, label: 'High', desc: 'Best detail, slower' }
                    ]).map((q) => {
                      const isSel = openaiQuality === q.id;
                      return (
                      <button
                        key={q.id}
                        onClick={() => {
                          onOpenAIQualityChange(q.id);
                          setActiveDropdown(null);
                        }}
                        aria-selected={isSel}
                        className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                          isSel
                            ? 'bg-brand-teal/10 text-brand-teal font-semibold border-l-2 border-brand-teal'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] border-l-2 border-transparent'
                        }`}
                      >
                        <Gauge size={14} className={isSel ? 'text-brand-teal' : 'text-slate-500 dark:text-slate-400'} />
                        <div className="flex flex-col flex-1">
                          <span className="font-medium">{q.label}</span>
                          <span className={`text-xs ${isSel ? 'text-brand-teal/80' : 'text-slate-500 dark:text-slate-400'}`}>{q.desc}</span>
                        </div>
                        {isSel && <CheckIcon size={14} className="text-brand-teal shrink-0" />}
                      </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Presets — recall a saved grouping of toolbar settings.
                Hidden for guests (saving requires a user document). */}
            {user && (
              <div className="relative">
                <DropdownButton
                  icon={Bookmark}
                  subLabel="Presets"
                  label={presets.length === 0 ? 'None saved' : `${presets.length} saved`}
                  isActive={activeDropdown === 'presets'}
                  onClick={() => toggleDropdown('presets')}
                />
                {activeDropdown === 'presets' && (
                  // right-0: Presets is the toolbar's right-most control, so a
                  // left-anchored panel runs past the viewport edge and clips
                  // its right column (the ⋯ per-preset actions!).
                  <div className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
                    {/* Active art direction — free text riding along with every
                        generation (seeded by a preset or typed at save time).
                        Shown here so it never steers prompts invisibly. */}
                    {config.customInstructions?.trim() && (
                      <div className="px-3 py-2 border-b border-gray-100 dark:border-[#30363d] bg-brand-teal/5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-brand-teal">
                              Art direction active
                            </span>
                            <p className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300 line-clamp-3">
                              {config.customInstructions}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setConfig(prev => ({ ...prev, customInstructions: undefined }))}
                            className="group/tip relative shrink-0 p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            aria-label="Clear art direction"
                          >
                            <X size={13} />
                            <span className="pointer-events-none absolute -top-8 right-0 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity">
                              Stop applying these instructions
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="max-h-72 overflow-y-auto custom-scrollbar p-1">
                      {presets.length === 0 ? (
                        <div className="px-3 py-6 text-center text-xs text-slate-500">
                          No saved presets yet.
                          <div className="mt-1 text-[11px] text-slate-400">
                            Save your current toolbar setup to recall it later.
                          </div>
                        </div>
                      ) : (
                        // Sort: presets whose snapshot matches the current
                        // toolbar are pinned to the top (these are the
                        // "currently applied" ones), then alphabetical
                        // within each bucket. Mirrors the sort-selected-
                        // to-top behavior of Type / Style / Colors / Size
                        // so the user can scan the dropdown and instantly
                        // see which preset they're on.
                        //
                        // We reuse `presetToolbarDiffersFromSnapshot` —
                        // already imported for the dirty-state overwrite
                        // row — so "applied" and "dirty" stay in lockstep
                        // (a preset is applied iff it's not dirty).
                        [...presets]
                          .sort((a, b) => {
                            const aApplied = !presetToolbarDiffersFromSnapshot(
                              a,
                              currentToolbarPresetSnapshot
                            );
                            const bApplied = !presetToolbarDiffersFromSnapshot(
                              b,
                              currentToolbarPresetSnapshot
                            );
                            if (aApplied && !bApplied) return -1;
                            if (!aApplied && bApplied) return 1;
                            return a.name.localeCompare(b.name);
                          })
                          .map(preset => {
                            const isDirty = presetToolbarDiffersFromSnapshot(
                              preset,
                              currentToolbarPresetSnapshot
                            );
                            const isApplied = !isDirty;
                            const isActionMenuOpen = actionMenuPresetId === preset.id;
                            const hasAnyAction = !!(onRenamePreset || onUpdatePreset || onDeletePreset || onEditPresetInstructions);
                            return (
                            <div
                              key={preset.id}
                              aria-selected={isApplied}
                              onMouseEnter={(e) => handlePresetRowEnter(e, preset.id)}
                              onMouseLeave={handlePresetRowLeave}
                              className={`rounded-md transition-colors border-b border-gray-100 dark:border-[#21262d] last:border-b-0 ${
                                isApplied
                                  ? 'bg-brand-teal/10 ring-1 ring-brand-teal/30 dark:ring-brand-teal/40 hover:bg-brand-teal/15'
                                  : 'hover:bg-gray-100 dark:hover:bg-[#21262d]'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 px-2 py-1.5">
                                <div
                                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                                  onClick={() => handleApplyPreset(preset)}
                                  title={`Apply preset: ${preset.name}`}
                                >
                                  <Bookmark
                                    size={16}
                                    className={`shrink-0 mt-0.5 ${
                                      isApplied ? 'text-brand-teal' : 'text-brand-teal'
                                    }`}
                                  />
                                  <div className="flex flex-col min-w-0">
                                    <span
                                      className={`text-xs truncate font-semibold ${
                                        isApplied
                                          ? 'text-brand-teal dark:text-brand-teal font-bold'
                                          : 'text-slate-700 dark:text-slate-200'
                                      }`}
                                    >
                                      {preset.name}
                                    </span>
                                    <span
                                      className={`text-[10px] truncate ${
                                        isApplied
                                          ? 'text-brand-teal/80 dark:text-brand-teal/80'
                                          : 'text-slate-500'
                                      }`}
                                    >
                                      {[
                                        preset.selectedModel && (modelLabelMap[preset.selectedModel] || preset.selectedModel),
                                        preset.aspectRatio,
                                        preset.svgMode && preset.svgMode !== 'static' ? preset.svgMode : null
                                      ].filter(Boolean).join(' · ') || 'Toolbar snapshot'}
                                    </span>
                                  </div>
                                </div>
                                {hasAnyAction && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleToggleActionMenu(e, preset.id)}
                                    aria-expanded={isActionMenuOpen}
                                    aria-label={
                                      isActionMenuOpen
                                        ? `Close actions for ${preset.name}`
                                        : `Actions for ${preset.name}`
                                    }
                                    className={`p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 shrink-0 flex items-center justify-center rounded-md transition-colors ${
                                      isActionMenuOpen
                                        ? 'bg-gray-200 dark:bg-[#30363d] text-slate-700 dark:text-slate-200'
                                        : 'hover:bg-gray-100 dark:hover:bg-[#30363d] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                                    }`}
                                  >
                                    <MoreHorizontal size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                            );
                          })
                      )}
                    </div>

                    {isNamingPreset ? (
                      <div className="border-t border-gray-200 dark:border-[#30363d] p-3 space-y-2 bg-gray-50 dark:bg-[#0d1117]">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Preset name
                        </label>
                        <input
                          ref={presetNameInputRef}
                          type="text"
                          value={presetNameDraft}
                          onChange={(e) => {
                            setPresetNameDraft(e.target.value);
                            if (presetError) setPresetError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleConfirmSavePreset();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setIsNamingPreset(false);
                              setPresetNameDraft('');
                              setPresetInstructionsDraft('');
                              setPresetError(null);
                            }
                          }}
                          placeholder="e.g. Square Hand Drawn"
                          className="w-full bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] text-slate-900 dark:text-white text-sm rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-teal focus:border-brand-teal"
                          maxLength={60}
                        />
                        <label className="block pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Art direction (optional)
                        </label>
                        <textarea
                          value={presetInstructionsDraft}
                          onChange={(e) => setPresetInstructionsDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setIsNamingPreset(false);
                              setPresetNameDraft('');
                              setPresetInstructionsDraft('');
                              setPresetError(null);
                            }
                          }}
                          rows={3}
                          maxLength={2000}
                          placeholder="Extra guidance the menus can't capture — mood, composition rules, motifs, things to avoid. Appended to every generation while active."
                          className="w-full bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] text-slate-900 dark:text-white text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-teal focus:border-brand-teal resize-none"
                        />
                        {presetError && (
                          <p className="text-[11px] text-red-500" role="alert">{presetError}</p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setIsNamingPreset(false);
                              setPresetNameDraft('');
                              setPresetInstructionsDraft('');
                              setPresetError(null);
                            }}
                            className="flex-1 px-2 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-[#30363d] text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleConfirmSavePreset}
                            disabled={isSavingPreset || !presetNameDraft.trim()}
                            className="flex-1 px-2 py-1.5 text-xs font-bold rounded-md bg-brand-teal text-white hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                          >
                            {isSavingPreset && <Loader2 size={12} className="animate-spin" />}
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartSavePreset}
                        className="w-full text-left p-3 text-xs font-bold text-brand-teal dark:text-brand-teal border-t border-gray-200 dark:border-[#30363d] hover:bg-gray-100 dark:hover:bg-[#21262d] flex items-center gap-2 transition-colors"
                      >
                        <BookmarkPlus size={14} /> Save current as preset
                      </button>
                    )}
                  </div>
                )}
                {activeActionPreset && actionMenuAnchor && (
                  <PresetActionPopover
                    preset={activeActionPreset}
                    anchor={actionMenuAnchor}
                    isApplied={!presetToolbarDiffersFromSnapshot(activeActionPreset, currentToolbarPresetSnapshot)}
                    onClose={() => {
                      setActionMenuPresetId(null);
                      setActionMenuAnchor(null);
                    }}
                    onUpdate={onUpdatePreset ? (id) => Promise.resolve(onUpdatePreset(id)) : undefined}
                    onDelete={onDeletePreset ? (id) => Promise.resolve(onDeletePreset(id)) : undefined}
                    onRename={onRenamePreset ? (id, name) => Promise.resolve(onRenamePreset(id, name)) : undefined}
                    onEditInstructions={onEditPresetInstructions}
                  />
                )}
                {activeHoverPreset && hoverAnchor && getPresetLabels && (
                  <PresetHoverPreview
                    anchor={hoverAnchor}
                    name={activeHoverPreset.name}
                    labels={getPresetLabels(activeHoverPreset)}
                  />
                )}
              </div>
            )}

          </div>
          </div>
          </div>

          {/* 2. Prompt Input Area — also tucked away while the toolbar is
              docked. The user explicitly OK'd hiding the prompt when
              scrolling so the entire top bar shrinks to a thin glass
              strip and the gallery / large preview gets every available
              vertical pixel. The header's Maximize toggle (and scrolling
              back to the top of the page) restores it. */}
          <div
            className={`w-full max-w-5xl mx-auto grid transition-[grid-template-rows] duration-300 ease-in-out ${
              isOptionsCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
            }`}
            aria-hidden={isOptionsCollapsed}
            inert={isOptionsCollapsed}
          >
            <div className="flex flex-col gap-1.5 min-w-0 overflow-hidden min-h-0">
            <div className="flex flex-nowrap items-stretch gap-2 min-w-0 w-full">
              <div
                className={`relative flex-1 basis-0 min-w-0 rounded-lg transition-shadow ${
                  isPromptDropActive ? 'ring-2 ring-brand-teal ring-offset-2 ring-offset-white dark:ring-offset-[#0d1117]' : ''
                }`}
                onDragOver={handlePromptDragOver}
                onDragLeave={handlePromptDragLeave}
                onDrop={handlePromptDrop}
              >
                <textarea 
                  value={config.prompt}
                  onChange={(e) => handleChange('prompt', e.target.value)}
                  placeholder='Prompt, or drop an image / brand PDF ({a,b} or ["tile 1","tile 2"])...'
                  className="min-h-[48px] h-12 focus:h-32 w-full min-w-0 bg-white dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] text-slate-900 dark:text-white text-base rounded-lg py-3 pl-4 pr-11 focus:outline-none focus:ring-1 focus:ring-brand-red focus:border-brand-red transition-all duration-200 ease-in-out placeholder-slate-400 dark:placeholder-slate-600 shadow-sm dark:shadow-inner resize-y overflow-y-auto"
                />
                {isPromptDropActive && (
                  <div className="pointer-events-none absolute inset-0 rounded-lg border-2 border-dashed border-brand-teal bg-brand-teal/10 flex items-center justify-center text-xs font-semibold text-brand-teal">
                    Drop image or brand PDF here
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setIsPromptModalOpen(true)}
                  className="absolute top-2 right-2 p-1.5 rounded-md text-slate-400 hover:text-brand-teal hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                  title="Open full-screen prompt editor"
                  aria-label="Open full-screen prompt editor"
                >
                  <Maximize2 size={14} />
                </button>
              </div>

              <>
                {/* Variations: typable number with a 1–5 quick-pick dropdown. */}
                <div
                  ref={batchCountTriggerRef}
                  className="relative group flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] shadow-sm"
                  title={`Variations per prompt${Number.isFinite(batchCap) ? ` (max ${batchCapLabel})` : ''}`}
                >
                  <label htmlFor="batch-count-input" className="sr-only">Variations per prompt</label>
                  <div className="flex items-center justify-center leading-none">
                    <input
                      id="batch-count-input"
                      type="number"
                      min={1}
                      max={Number.isFinite(batchCap) ? batchCap : 99}
                      step={1}
                      value={batchCount}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        if (!Number.isFinite(raw)) {
                          setBatchCount(1);
                          return;
                        }
                        const hardMax = Number.isFinite(batchCap) ? batchCap : 99;
                        const clamped = Math.max(1, Math.min(Math.floor(raw), hardMax));
                        setBatchCount(clamped);
                      }}
                      className="w-6 bg-transparent text-slate-900 dark:text-white text-base font-semibold text-center tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      aria-label="Variations per prompt"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeDropdown !== 'batch-count') {
                        setBatchCountAnchor(
                          batchCountTriggerRef.current?.getBoundingClientRect() ?? null
                        );
                      }
                      toggleDropdown('batch-count');
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={activeDropdown === 'batch-count'}
                    aria-label="Pick a preset count"
                    className="h-8 w-4 sm:w-5 flex items-center justify-center rounded-md text-slate-500 hover:text-brand-teal hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                  >
                    <ChevronDown
                      size={14}
                      className={`transition-transform duration-200 ${
                        activeDropdown === 'batch-count' ? 'rotate-180 text-brand-teal' : ''
                      }`}
                    />
                  </button>

                  {activeDropdown === 'batch-count' && batchCountAnchor && typeof document !== 'undefined' &&
                    createPortal(
                      <div
                        data-batch-count-popover
                        style={{
                          position: 'fixed',
                          top: batchCountAnchor.bottom + 8,
                          left: Math.max(8, batchCountAnchor.right - 64),
                          width: 64,
                          zIndex: 70,
                        }}
                        className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 py-0.5"
                        role="listbox"
                        aria-label="Variations per prompt"
                      >
                        {[1, 2, 3, 4, 5].map((n) => {
                          const isSelected = batchCount === n;
                          return (
                            <button
                              key={n}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => {
                                setBatchCount(n);
                                setActiveDropdown(null);
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-0.5 text-sm tabular-nums transition-colors ${
                                isSelected
                                  ? 'bg-brand-teal/10 text-brand-teal font-semibold'
                                  : 'text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d]'
                              }`}
                            >
                              <span>{n}</span>
                              {isSelected && <Check size={12} />}
                            </button>
                          );
                        })}
                      </div>,
                      document.body
                    )}
                </div>

                <button
                  type="button"
                  onClick={handleExpandPrompt}
                  disabled={!config.prompt || isExpandingPrompt}
                  className={`relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border font-semibold transition-all group ${
                    !config.prompt || isExpandingPrompt
                      ? 'bg-gray-100 dark:bg-[#21262d] text-slate-400 dark:text-slate-500 border-gray-200 dark:border-[#30363d] cursor-not-allowed'
                      : 'bg-white dark:bg-[#161b22] text-slate-800 dark:text-slate-100 border-gray-200 dark:border-[#30363d] hover:bg-brand-teal hover:border-brand-teal hover:text-white shadow-sm'
                  }`}
                  aria-label="Expand prompt with additional creative detail"
                >
                  {isExpandingPrompt ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                  <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    Expand prompt
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (hasSetupAction) {
                      onSetupAction?.();
                      return;
                    }
                    onGenerate(safeBatchCount);
                  }}
                  disabled={generateButtonDisabled}
                  title={generateButtonTitle}
                  className={`relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-bold shadow-md transition-all active:translate-y-0.5 group ${
                    generateButtonDisabled
                      ? 'bg-gray-200 dark:bg-[#21262d] text-slate-400 dark:text-slate-500 cursor-not-allowed'
                      : 'bg-brand-red hover:bg-red-700 text-white shadow-brand-red/20'
                  }`}
                  aria-label={generateButtonTitle}
                >
                  {hasSetupAction ? (
                    user ? <KeyRound size={16} className="text-white" /> : <UserPlus size={16} className="text-white" />
                  ) : (
                    <Send size={16} className="text-white" />
                  )}
                  <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    {generateButtonTitle}
                  </span>
                </button>
              </>
            </div>

            {activePromptImageStyleReference && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-3 py-2 text-xs text-slate-700 dark:text-slate-200">
                <div className="flex min-w-0 items-center gap-2">
                  <ImageIcon size={14} className="shrink-0 text-brand-teal" />
                  <span className="truncate">
                    Style reference: <span className="font-semibold">{activePromptImageStyleReference.styleName}</span>
                    {' '}
                    <span className="text-slate-500 dark:text-slate-400">
                      ({activePromptImageStyleReference.influenceMode === 'image' ? 'image style overrides menu' : 'style menu overrides image'})
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onPromptImageStyleReferenceChange?.(null)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:hover:bg-[#21262d] dark:hover:text-white"
                  aria-label="Remove prompt image style reference"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {hasBatchInfo && (
              <div
                className={`text-xs pl-1 ${
                  exceedsBatchCap
                    ? 'text-red-600 dark:text-red-400 font-medium'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
                role={exceedsBatchCap ? 'alert' : undefined}
                aria-live="polite"
              >
                {exceedsBatchCap ? (
                  `Will run ${totalBatchRuns} generations, which exceeds your ${batchCapLabel} cap. Reduce the count, prompt-list entries, brace options, or selected models.`
                ) : (
                  <>
                    {expansion.hasPromptList
                      ? `Prompt list: ${promptEntryCount} tile${promptEntryCount === 1 ? '' : 's'}, ${expandedPromptCount} prompt${expandedPromptCount === 1 ? '' : 's'} x ${safeBatchCount}${modelCount > 1 ? ` x ${modelCount} models` : ''} = ${totalBatchRuns} generation${totalBatchRuns === 1 ? '' : 's'}.`
                      : expansion.hasBraces
                        ? `Brace expansion: ${expandedPromptCount} prompt${expandedPromptCount === 1 ? '' : 's'} x ${safeBatchCount}${modelCount > 1 ? ` x ${modelCount} models` : ''} = ${totalBatchRuns} generation${totalBatchRuns === 1 ? '' : 's'}.`
                      : modelCount > 1
                        ? `Will run ${totalBatchRuns} generations across ${modelCount} models.`
                        : `Will run ${totalBatchRuns} generation${totalBatchRuns === 1 ? '' : 's'}.`}
                    {totalBatchRuns > 0 && (
                      <span className="text-slate-400 dark:text-slate-500">
                        {' '}Est. ~{estimatedLabel}
                        {totalBatchRuns > 1 && durationEstimate.effectiveConcurrency > 1
                          ? ` (${durationEstimate.effectiveConcurrency} in parallel)`
                          : ''}
                        .
                      </span>
                    )}
                    {totalPaidBatchMilliCredits > 0 && (
                      <span className="font-semibold text-brand-teal">
                        {' '}PixTaffy cost: {paidBatchCreditLabel} credit{totalPaidBatchMilliCredits === 1_000 ? '' : 's'}.
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
            </div>

        </div>
      </div>

      {/* PROMPT EDITOR MODAL — full-screen view of the prompt so long text and
          brace-expansion options stay readable without resizing the inline
          textarea (which can otherwise hide preview imagery below). */}
      {isPromptModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsPromptModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Edit prompt"
        >
          <div
            className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-200 dark:border-[#30363d]">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Edit prompt</h3>
              <button
                onClick={() => setIsPromptModalOpen(false)}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#30363d] transition-colors"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div
              className="flex-1 overflow-hidden p-5"
              onDragOver={handlePromptDragOver}
              onDragLeave={handlePromptDragLeave}
              onDrop={(event) => {
                handlePromptDrop(event);
                setIsPromptModalOpen(false);
              }}
            >
              <textarea
                autoFocus
                value={config.prompt}
                onChange={(e) => handleChange('prompt', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsPromptModalOpen(false);
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (!generateButtonDisabled) {
                      setIsPromptModalOpen(false);
                      if (hasSetupAction) {
                        onSetupAction?.();
                      } else {
                        onGenerate(safeBatchCount);
                      }
                    }
                  }
                }}
                placeholder='Prompt or drop image ({a,b} or ["tile 1","tile 2"])...'
                className="w-full h-[55vh] min-h-[280px] bg-white dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] text-slate-900 dark:text-white text-base rounded-lg p-4 focus:outline-none focus:ring-1 focus:ring-brand-red focus:border-brand-red placeholder-slate-400 dark:placeholder-slate-600 resize-none leading-relaxed"
              />
              {hasBatchInfo && (
                <div
                  className={`text-xs mt-2 ${
                    exceedsBatchCap
                      ? 'text-red-600 dark:text-red-400 font-medium'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {exceedsBatchCap ? (
                    `Will run ${totalBatchRuns} generations, which exceeds your ${batchCapLabel} cap. Reduce the count, prompt-list entries, brace options, or selected models.`
                  ) : (
                    <>
                      {expansion.hasPromptList
                        ? `Prompt list: ${promptEntryCount} tile${promptEntryCount === 1 ? '' : 's'}, ${expandedPromptCount} prompt${expandedPromptCount === 1 ? '' : 's'} x ${safeBatchCount}${modelCount > 1 ? ` x ${modelCount} models` : ''} = ${totalBatchRuns} generation${totalBatchRuns === 1 ? '' : 's'}.`
                        : expansion.hasBraces
                          ? `Brace expansion: ${expandedPromptCount} prompt${expandedPromptCount === 1 ? '' : 's'} x ${safeBatchCount}${modelCount > 1 ? ` x ${modelCount} models` : ''} = ${totalBatchRuns} generation${totalBatchRuns === 1 ? '' : 's'}.`
                        : modelCount > 1
                          ? `Will run ${totalBatchRuns} generations across ${modelCount} models.`
                          : `Will run ${totalBatchRuns} generation${totalBatchRuns === 1 ? '' : 's'}.`}
                      {totalBatchRuns > 0 && (
                        <span className="text-slate-400 dark:text-slate-500">
                          {' '}Est. ~{estimatedLabel}.
                        </span>
                      )}
                      {totalPaidBatchMilliCredits > 0 && (
                        <span className="font-semibold text-brand-teal">
                          {' '}PixTaffy cost: {paidBatchCreditLabel} credit{totalPaidBatchMilliCredits === 1_000 ? '' : 's'}.
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-200 dark:border-[#30363d]">
              <button
                type="button"
                onClick={handleExpandPrompt}
                disabled={!config.prompt || isExpandingPrompt}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                  !config.prompt || isExpandingPrompt
                    ? 'bg-gray-100 dark:bg-[#21262d] text-slate-400 dark:text-slate-500 border-gray-200 dark:border-[#30363d] cursor-not-allowed'
                    : 'bg-white dark:bg-[#0d1117] text-slate-700 dark:text-slate-200 border-gray-200 dark:border-[#30363d] hover:bg-brand-teal hover:border-brand-teal hover:text-white'
                }`}
              >
                {isExpandingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                Expand prompt
              </button>
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline text-[11px] text-slate-400 dark:text-slate-500">
                  Esc to close - Cmd/Ctrl+Enter to generate
                </span>
                <button
                  type="button"
                  onClick={() => setIsPromptModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-brand-red hover:bg-red-700 text-white font-semibold text-sm shadow-md shadow-brand-red/20 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={!!promptImageFile}
        onClose={closePromptImageDialog}
        title={
          promptImageFile?.type === 'application/pdf'
            ? 'Use dropped PDF'
            : 'Use dropped image'
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] p-3">
            <div className="mt-0.5 rounded-lg bg-white dark:bg-[#161b22] p-2 text-brand-teal shadow-sm">
              {promptImageFile?.type === 'application/pdf' ? (
                <UploadCloud size={18} />
              ) : (
                <ImageIcon size={18} />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {promptImageFile?.name || 'Dropped file'}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {promptImageFile?.type === 'application/pdf'
                  ? 'Analyze this PDF as brand guidelines to extract colors, type, and style.'
                  : 'Turn it into prompt content, use its visual style, or analyze it as brand guidelines.'}
              </p>
            </div>
          </div>

          {promptImageError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200">
              {promptImageError}
            </div>
          )}

          <div className="grid gap-2">
            {promptImageFile?.type !== 'application/pdf' && (
              <>
                <button
                  type="button"
                  onClick={handlePromptImageToPrompt}
                  disabled={isPromptImageAnalyzing}
                  className="flex min-h-11 w-full items-center justify-between rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] px-3 py-2 text-left text-sm font-semibold text-slate-800 dark:text-slate-100 hover:border-brand-teal hover:text-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>Generate content prompt</span>
                  {isPromptImageAnalyzing && <Loader2 size={14} className="animate-spin" />}
                </button>
                <p className="px-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Describes only subjects, objects, visible text, and meaning. Menus still drive layout, style, palette, and size.
                </p>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handlePromptImageAsStyle('image')}
                    disabled={isPromptImageAnalyzing}
                    className="min-h-11 rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] px-3 py-2 text-left text-sm font-semibold text-slate-800 dark:text-slate-100 hover:border-brand-teal hover:text-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Use image style
                    <span className="mt-1 block text-[11px] font-normal text-slate-500 dark:text-slate-400">
                      Image style overrides the Style menu.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePromptImageAsStyle('menus')}
                    disabled={isPromptImageAnalyzing}
                    className="min-h-11 rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] px-3 py-2 text-left text-sm font-semibold text-slate-800 dark:text-slate-100 hover:border-brand-teal hover:text-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Keep menu style
                    <span className="mt-1 block text-[11px] font-normal text-slate-500 dark:text-slate-400">
                      Style menu overrides the image.
                    </span>
                  </button>
                </div>
              </>
            )}

            {/* Brand guidelines analysis — formerly the standalone Upload
                brand toolbar button. Available for both images and PDFs;
                the user, not the toolbar, picks intent here. */}
            {user && (
              <button
                type="button"
                onClick={handlePromptImageAsBrand}
                disabled={isPromptImageAnalyzing || isAnalyzing}
                className={`flex min-h-11 w-full items-center justify-between rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] px-3 py-2 text-left text-sm font-semibold text-slate-800 dark:text-slate-100 hover:border-brand-teal hover:text-brand-teal disabled:cursor-not-allowed disabled:opacity-60 ${
                  promptImageFile?.type !== 'application/pdf' ? 'mt-2' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  <UploadCloud size={14} className="text-slate-500 dark:text-slate-400" />
                  Use as brand guidelines
                </span>
                {isAnalyzing && <Loader2 size={14} className="animate-spin" />}
              </button>
            )}
            {user && (
              <p className="px-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Extracts brand colors, visual styles, and other identity cues you can save to your brand library.
              </p>
            )}
          </div>
        </div>
      </Modal>

      {/* MODAL FOR ADDING/EDITING CUSTOM OPTIONS */}
      <Modal 
        isOpen={!!modalType} 
        onClose={closeModal} 
        title={
          editingId ? 'Edit Option' : 
          modalType === 'type' ? 'Add Custom Graphic Type' :
          modalType === 'style' ? 'Add Custom Brand Style' :
          modalType === 'color' ? 'Add Custom Palette' : ''
        }
      >
        <div className="space-y-4">
          
          {/* Image Upload for Style/Color Auto-fill */}
          {!editingId && (modalType === 'style' || modalType === 'color') && (
            <div 
              className="mb-4 p-6 bg-gray-50 dark:bg-[#0d1117] rounded-lg border-2 border-dashed border-gray-300 dark:border-[#30363d] hover:border-brand-teal dark:hover:border-brand-teal transition-colors text-center cursor-pointer relative"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => optionFileInputRef.current?.click()}
            >
              <input 
                 type="file" 
                 ref={optionFileInputRef} 
                 className="hidden" 
                 accept="image/*"
                 onChange={handleOptionFileChange}
               />
               <div className="flex flex-col items-center justify-center gap-2 pointer-events-none">
                 {isAnalysingOption ? (
                   <>
                     <Loader2 size={24} className="animate-spin text-brand-teal" />
                     <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Analyzing Image...</span>
                   </>
                 ) : (
                   <>
                     <div className="p-3 bg-white dark:bg-[#161b22] rounded-full shadow-sm text-brand-teal mb-1">
                        <ImageIcon size={20} />
                     </div>
                     <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        Click or Drag & Drop Image
                     </span>
                     <p className="text-[10px] text-slate-400">
                       Auto-extract {modalType === 'style' ? 'style description' : 'colors'}
                     </p>
                   </>
                 )}
               </div>
            </div>
          )}

          <div>
            <label className={labelClass}>Name</label>
            <input
              autoFocus
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Enter name..."
              className={inputClass}
            />
          </div>

          {modalType === 'style' && (
            <div>
              <label className={labelClass}>Description / Instructions</label>
              <textarea
                value={newItemDescription}
                onChange={(e) => setNewItemDescription(e.target.value)}
                placeholder="Describe the visual style in detail..."
                className={`${inputClass} min-h-[80px] resize-none`}
              />
            </div>
          )}

          {modalType === 'color' && (
            <div ref={pickerPanelRef}>
               <label className={labelClass}>Palette Colors</label>
               <div className="flex flex-wrap items-center gap-2">
                 {newItemColors.map((color, idx) => {
                   const normalizedColor = normalizeColorToken(color) || DEFAULT_PALETTE_COLOR;
                   const isActive = activeColorIndex === idx;
                   return (
                      <div key={idx} className="relative">
                        <button
                          type="button"
                          onClick={() => openColorPicker(idx)}
                          className={`relative w-9 h-9 rounded-full overflow-hidden transition-all ${
                            isActive
                              ? 'ring-2 ring-brand-teal ring-offset-2 ring-offset-white dark:ring-offset-[#161b22] scale-105'
                              : 'ring-1 ring-black/10 dark:ring-white/10 hover:scale-105'
                          }`}
                          style={{ backgroundColor: normalizedColor }}
                          title={`Edit color ${idx + 1}`}
                        >
                          <span className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/20" />
                        </button>
                        {newItemColors.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setNewItemColors(newItemColors.filter((_, i) => i !== idx));
                            }}
                            className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center rounded-full bg-white dark:bg-[#1f2937] border border-gray-200 dark:border-[#30363d] text-slate-500 hover:text-red-400 transition-colors"
                            title="Remove color"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                   );
                 })}
                 <button
                   type="button"
                   onClick={handleAddPaletteColor}
                   className="h-9 px-3 rounded-full border border-dashed border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-500 hover:text-brand-teal hover:border-brand-teal transition-colors flex items-center gap-1"
                   title="Add Color"
                 >
                   <Plus size={12} />
                   Add
                 </button>
               </div>

               {activeColorIndex !== null && (
                 <div className="mt-3 rounded-2xl border border-gray-200 dark:border-[#30363d] bg-gradient-to-br from-white to-slate-50 dark:from-[#111827] dark:to-[#0b1220] p-3 shadow-xl shadow-slate-900/10 dark:shadow-black/30 space-y-2.5">
                   <div className="flex items-center justify-between gap-2">
                     <div className="flex items-center gap-2 min-w-0">
                       <div
                         className="w-6 h-6 rounded-md ring-1 ring-black/10 dark:ring-white/10 shrink-0"
                         style={{ backgroundColor: hsvToHex(pickerHsv) }}
                       />
                       <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                         Edit color {activeColorIndex + 1}
                       </span>
                     </div>
                     <button
                       type="button"
                       onClick={() => setActiveColorIndex(null)}
                       className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-gray-200/70 dark:hover:bg-[#1f2937] transition-colors"
                       title="Close color picker"
                     >
                       <X size={14} />
                     </button>
                   </div>

                   <div
                     ref={saturationValueRef}
                     className="relative h-32 rounded-xl overflow-hidden cursor-crosshair ring-1 ring-black/10 dark:ring-white/10"
                     style={{ backgroundColor: `hsl(${pickerHsv.h} 100% 50%)` }}
                     onPointerDown={(event) => handlePointerDrag(event, updateSaturationValueFromPointer)}
                   >
                     <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
                     <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
                     <div
                       className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-lg ring-1 ring-black/40 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                       style={{ left: `${pickerHsv.s}%`, top: `${100 - pickerHsv.v}%` }}
                     />
                   </div>

                   <div
                     ref={hueSliderRef}
                     className="relative h-3 rounded-full overflow-hidden cursor-ew-resize ring-1 ring-black/10 dark:ring-white/10 bg-[linear-gradient(90deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)]"
                     onPointerDown={(event) => handlePointerDrag(event, (clientX) => updateHueFromPointer(clientX))}
                   >
                     <div
                       className="absolute top-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-md ring-1 ring-black/30 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                       style={{ left: `${(pickerHsv.h / 360) * 100}%` }}
                     />
                   </div>

                   <div className="flex items-center gap-2">
                     <div className="inline-flex rounded-lg border border-gray-200 dark:border-[#30363d] overflow-hidden shrink-0">
                       {(['HEX', 'RGB', 'HSL', 'NAME'] as const).map(format => (
                         <button
                           key={format}
                           type="button"
                           onClick={() => handlePickerFormatChange(format)}
                           className={`px-2 py-1 text-[10px] font-semibold transition-colors ${
                             pickerFormat === format
                               ? 'bg-brand-teal/15 text-brand-teal'
                               : 'bg-white dark:bg-[#0d1117] text-slate-500 dark:text-slate-300 hover:text-brand-teal'
                           }`}
                         >
                           {format}
                         </button>
                       ))}
                     </div>
                     <div className="relative flex-1 min-w-0">
                       <input
                         type="text"
                         value={pickerInput}
                         onChange={(event) => setPickerInput(event.target.value)}
                         onKeyDown={(event) => {
                           if (event.key === 'Enter') {
                             event.preventDefault();
                             applyPickerInput();
                           }
                         }}
                         placeholder="#0B4F6C, rgb(...), hsl(...), teal"
                         className="w-full bg-white dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-teal text-slate-900 dark:text-white"
                       />
                       <span className={`absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md border text-[9px] font-bold ${formatBadgeClassMap[pickerFormat]}`}>
                         {pickerFormat}
                       </span>
                     </div>
                     <button
                       type="button"
                       onClick={applyPickerInput}
                       className="px-2.5 py-1.5 rounded-lg bg-brand-teal/15 text-brand-teal border border-brand-teal/40 text-[10px] font-semibold hover:bg-brand-teal/25 transition-colors shrink-0"
                     >
                       Apply
                     </button>
                   </div>
                 </div>
               )}

               <div className="mt-3">
                 <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                   Paste Colors (JSON or YAML)
                 </label>
                 <textarea
                   value={bulkPaletteInput}
                   onChange={(e) => setBulkPaletteInput(e.target.value)}
                   placeholder={'["#0B4F6C", "rgb(0, 169, 165)"]\n\ncolors:\n  - "#0B4F6C"\n  - hsl(178, 100%, 33%)'}
                   className="w-full min-h-[92px] resize-y bg-white dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg px-3 py-2 text-xs leading-5 focus:outline-none focus:ring-1 focus:ring-brand-teal text-slate-900 dark:text-white"
                 />
                 <button
                   type="button"
                   onClick={handleImportColorList}
                   className="mt-2 inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-[#30363d] px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                 >
                   <UploadCloud size={12} />
                   Import Colors
                 </button>
               </div>

               <div className="mt-3 flex items-center justify-between gap-2">
                 <p className="text-[10px] text-slate-400">
                   Use the picker or enter hex, rgb, hsl, or named colors.
                 </p>
                 <button
                   type="button"
                   onClick={handleCopyPaletteYaml}
                   className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-[#30363d] px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                 >
                   <Copy size={12} />
                   Copy YAML
                 </button>
               </div>
               {paletteCopyMessage && (
                 <p className="text-[10px] text-brand-teal mt-1">{paletteCopyMessage}</p>
               )}
            </div>
          )}

          {/* --- NEW SCOPE SELECTOR --- */}
          {user && (
             <div className="pt-4 border-t border-gray-100 dark:border-[#30363d] space-y-3">
                <label className={labelClass}>Visibility & Sharing</label>
                <div className="grid grid-cols-3 gap-2">
                   <button
                     onClick={() => setItemScope('private')}
                     className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs font-medium transition-all ${
                       itemScope === 'private'
                        ? 'bg-slate-100 dark:bg-[#21262d] border-slate-400 dark:border-slate-500 text-slate-900 dark:text-white ring-1 ring-slate-400'
                        : 'bg-white dark:bg-[#0d1117] border-gray-200 dark:border-[#30363d] text-slate-500 hover:bg-gray-50 dark:hover:bg-[#161b22]'
                     }`}
                   >
                     <Lock size={16} />
                     Private
                   </button>
                   <button
                     onClick={() => setItemScope('public')}
                     className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs font-medium transition-all ${
                       itemScope === 'public'
                        ? 'bg-teal-50 dark:bg-teal-900/20 border-brand-teal text-brand-teal ring-1 ring-brand-teal'
                        : 'bg-white dark:bg-[#0d1117] border-gray-200 dark:border-[#30363d] text-slate-500 hover:bg-gray-50 dark:hover:bg-[#161b22]'
                     }`}
                   >
                     <Globe size={16} />
                     Public
                   </button>
                   <button
                     onClick={() => setItemScope('team')}
                     disabled={userTeams.length === 0}
                     className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs font-medium transition-all ${
                       itemScope === 'team'
                        ? 'bg-orange-50 dark:bg-orange-900/20 border-brand-orange text-brand-orange ring-1 ring-brand-orange'
                        : 'bg-white dark:bg-[#0d1117] border-gray-200 dark:border-[#30363d] text-slate-500 hover:bg-gray-50 dark:hover:bg-[#161b22] disabled:opacity-50 disabled:cursor-not-allowed'
                     }`}
                   >
                     <Users size={16} />
                     Team
                   </button>
                </div>

                {/* Team Selection Dropdown */}
                {itemScope === 'team' && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <RichSelect
                      value={selectedTeamId}
                      onChange={setSelectedTeamId}
                      options={userTeams.map(team => ({ value: team.id, label: team.name }))}
                      placeholder={userTeams.length > 0 ? 'Select a team' : 'No teams available'}
                      disabled={userTeams.length === 0}
                      compact
                    />
                  </div>
                )}
             </div>
          )}

          <div className="pt-4 flex gap-3">
             <button 
                onClick={closeModal}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 dark:border-[#30363d] text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] font-medium text-sm transition-colors"
             >
               Cancel
             </button>
             <button 
                onClick={handleSaveItem}
                disabled={!newItemName}
                className="flex-1 py-2.5 rounded-lg bg-brand-red hover:bg-red-700 text-white font-medium text-sm shadow-lg shadow-brand-red/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
             >
               {editingId ? 'Update' : 'Save'} Option
             </button>
          </div>
        </div>
      </Modal>
    </>
  );
};
