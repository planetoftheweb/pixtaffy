import React, { useState, useRef, useEffect, useMemo } from 'react';
import { UserSettings, AspectRatioOption, GraphicType, User, Team, VisualStyle, BrandColor } from '../types';
import { ArrowLeft, Settings as SettingsIcon, Save, User as UserIcon, Camera, Loader2, Users, Plus, Key, CheckCircle, Layout, PenTool, Palette, Maximize, Sparkles, ChevronDown, X } from 'lucide-react';
import { uploadProfileImage } from '../services/imageService';
import { buildProfileImageCacheKey } from '../services/imageCache';
import { CachedImage } from './CachedImage';
import { teamService } from '../services/teamService';
import { SUPPORTED_MODELS, MODEL_GROUP_ORDER } from '../constants';
import { getAspectRatiosForModel, getSafeAspectRatioForModel } from '../services/aspectRatioService';
import { RichSelect } from './RichSelect';

interface SettingsPageProps {
  onBack: () => void;
  user: User;
  onSave: (
    newSettings: UserSettings,
    profileData?: { name: string; username: string; photoURL?: string; photoDataUrl?: string },
    geminiApiKey?: string,
    systemPrompt?: string,
    selectedModel?: string,
    apiKeys?: { [modelId: string]: string }
  ) => void | Promise<void>;
  graphicTypes: GraphicType[];
  visualStyles: VisualStyle[];
  brandColors: BrandColor[];
  aspectRatios: AspectRatioOption[];
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  onBack,
  user,
  onSave,
  graphicTypes,
  visualStyles,
  brandColors,
  aspectRatios
}) => {
  const [localSettings, setLocalSettings] = useState<UserSettings>(user.preferences.settings || { contributeByDefault: false, confirmDeleteHistory: true, confirmDeleteCurrent: true });
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username || '');
  const [photoURL, setPhotoURL] = useState<string | undefined>(user.photoURL);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>(user.photoDataUrl);
  const [apiKeys, setApiKeys] = useState<{ [key: string]: string }>(() => {
    const keys: { [key: string]: string } = {};
    if (user.preferences.apiKeys) {
      Object.assign(keys, user.preferences.apiKeys);
    }
    const legacyGemini = user.preferences.geminiApiKey?.trim();
    if (!keys['gemini']?.trim() && legacyGemini) {
      keys['gemini'] = legacyGemini;
    }
    return keys;
  });
  const [selectedModel, setSelectedModel] = useState<string>(user.preferences.selectedModel || 'gemini');
  const [systemPrompt, setSystemPrompt] = useState<string>(user.preferences.systemPrompt || '');
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-model key overrides are hidden by default to reduce clutter: every
  // Gemini variant uses the shared Google Gemini key, and every OpenAI-family
  // model uses the shared OpenAI key. Auto-expand the overrides section if
  // the user already has any per-model override saved, so existing data is
  // never hidden without explanation.
  const hasPerModelOverride = Object.entries(apiKeys).some(
    ([key, value]) =>
      key !== 'gemini' &&
      key !== 'openai' &&
      key !== 'openai-2' &&
      key !== 'openai-mini' &&
      !!value
  );
  const [showOverrides, setShowOverrides] = useState<boolean>(hasPerModelOverride);

  // Teams State
  const [teams, setTeams] = useState<Team[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  useEffect(() => {
    setLocalSettings(user.preferences.settings || { contributeByDefault: false, confirmDeleteHistory: true, confirmDeleteCurrent: true });
    setName(user.name);
    setUsername(user.username || '');
    setPhotoURL(user.photoURL);
    setPhotoDataUrl(user.photoDataUrl);
    const keys: { [key: string]: string } = {};
    if (user.preferences.apiKeys) Object.assign(keys, user.preferences.apiKeys);
    const legacyGemini = user.preferences.geminiApiKey?.trim();
    if (!keys['gemini']?.trim() && legacyGemini) keys['gemini'] = legacyGemini;
    setApiKeys(keys);
    setSelectedModel(user.preferences.selectedModel || 'gemini');
    setSystemPrompt(user.preferences.systemPrompt || '');
    setShowOverrides(
      Object.entries(keys).some(
        ([modelId, value]) =>
          modelId !== 'gemini' &&
          modelId !== 'openai' &&
          modelId !== 'openai-2' &&
          modelId !== 'openai-mini' &&
          !!value
      )
    );
    loadTeams();
  }, [user]);

  useEffect(() => {
    setLocalSettings(prev => {
      if (!prev.defaultAspectRatio) return prev;
      const safeDefault = getSafeAspectRatioForModel(selectedModel, prev.defaultAspectRatio, aspectRatios);
      if (safeDefault === prev.defaultAspectRatio) return prev;
      return { ...prev, defaultAspectRatio: safeDefault };
    });
  }, [selectedModel, aspectRatios]);

  const modelAspectRatios = getAspectRatiosForModel(selectedModel, aspectRatios);
  const scopeLabelMap: Record<string, string> = {
    system: 'Defaults',
    private: 'Private',
    team: 'Team',
    public: 'Public'
  };
  const groupOrder = ['Defaults', 'Private', 'Team', 'Public'];
  const graphicTypeOptions = useMemo(
    () => [
      { value: '', label: 'Use App Default' },
      ...[...graphicTypes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(type => ({
          value: type.id,
          label: type.name,
          group: scopeLabelMap[type.scope]
        }))
    ],
    [graphicTypes]
  );
  const visualStyleOptions = useMemo(
    () => [
      { value: '', label: 'Use App Default' },
      ...[...visualStyles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(style => ({
          value: style.id,
          label: style.name,
          description: style.description,
          group: scopeLabelMap[style.scope]
        }))
    ],
    [visualStyles]
  );
  const brandColorOptions = useMemo(
    () => [
      { value: '', label: 'Use App Default' },
      ...[...brandColors]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(color => ({
          value: color.id,
          label: color.name,
          description: color.colors.join(' · '),
          group: scopeLabelMap[color.scope]
        }))
    ],
    [brandColors]
  );
  const aspectRatioOptions = useMemo(
    () => [
      { value: '', label: 'Use App Default' },
      ...modelAspectRatios.map(ratio => ({
        value: ratio.value,
        label: ratio.label
      }))
    ],
    [modelAspectRatios]
  );
  const modelOptions = useMemo(
    () =>
      SUPPORTED_MODELS.map((model) => ({
        value: model.id,
        label: model.name,
        description: model.description,
        group: model.group
      })),
    []
  );

  // All Gemini-family models share one Google Gemini API key via @google/genai.
  // Only OpenAI-family models need their own key. Per-model overrides remain
  // possible (see the Advanced section below) but are optional.
  const API_PROVIDERS: Array<{
    keyId: 'gemini' | 'openai';
    label: string;
    description: string;
    placeholder: string;
    helpText: string;
  }> = [
    {
      keyId: 'gemini',
      label: 'Google Gemini API Key',
      description: 'Used by Nano Banana Pro, Nano Banana 2, and Gemini SVG.',
      placeholder: 'AIza...',
      helpText: 'Create one at aistudio.google.com/apikey.'
    },
    {
      keyId: 'openai',
      label: 'OpenAI API Key',
      description: 'Used by GPT Image 2, GPT Image Mini, and GPT Image 1.5.',
      placeholder: 'sk-...',
      helpText: 'Create one at platform.openai.com/api-keys.'
    }
  ];

  const OVERRIDE_MODELS = SUPPORTED_MODELS.filter(
    (model) =>
      model.id !== 'gemini' &&
      model.id !== 'openai' &&
      model.id !== 'openai-2' &&
      model.id !== 'openai-mini'
  );

  const loadTeams = async () => {
    const userTeams = await teamService.getUserTeams(user.id);
    setTeams(userTeams);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      // Delegate persistence to the parent (App.handleSaveSettings) so there is a single
      // source-of-truth write. Previously this component wrote directly to Firestore and
      // then the parent wrote again using stale state, which caused API key changes to be
      // reverted (see GitHub issue #1).
      await persistPreferences();

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApiKeyChange = (modelId: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [modelId]: value }));
  };

  const handleClearOverride = async (modelId: string) => {
    const next = { ...apiKeys };
    delete next[modelId];
    setApiKeys(next);
    try {
      await persistPreferences(next);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error("Failed to clear API key override:", err);
    }
  };

  const persistPreferences = async (nextApiKeys = apiKeys) => {
    // Use local state as the source of truth; pass apiKeys['gemini'] directly (no `||`
    // fallback) so clearing the Nano Banana key is actually persisted. sanitizePreferences
    // in authService strips empty-string entries.
    await onSave(
      localSettings,
      { name, username, photoURL, photoDataUrl },
      nextApiKeys['gemini'] ?? '',
      systemPrompt,
      selectedModel,
      nextApiKeys
    );
  };

  const handleApiKeyBlur = async (_modelId: string) => {
    try {
      await persistPreferences();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error("Failed to save API key:", err);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const uploaded = await uploadProfileImage(file, user.id);
      setPhotoURL(uploaded.downloadUrl);
      setPhotoDataUrl(uploaded.thumbnailDataUrl);
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // Team Handlers
  const handleCreateTeam = async () => {
      if (!newTeamName.trim()) return;
      try {
          await teamService.createTeam(newTeamName, user);
          setNewTeamName('');
          setIsCreatingTeam(false);
          loadTeams();
      } catch (e) {
          console.error("Failed to create team", e);
      }
  };

  const handleInviteMember = async (teamId: string) => {
      if (!inviteEmail.trim()) return;
      try {
          await teamService.addMember(teamId, inviteEmail);
          setInviteEmail('');
          alert("Member invited successfully!");
          loadTeams();
      } catch (e: any) {
          alert("Failed to invite member: " + e.message);
      }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0d1117] transition-colors duration-200">
      {/* Success Toast */}
      {saveSuccess && (
        <div className="fixed top-20 right-6 z-50 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle size={20} />
          <span className="text-sm font-medium">Settings saved successfully!</span>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="mb-8 flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-lg transition-colors"
          >
            <ArrowLeft size={20} className="text-slate-600 dark:text-slate-300" />
          </button>
          <div className="flex items-center gap-2">
            <SettingsIcon size={24} className="text-brand-teal" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          {/* LEFT COLUMN: API Key */}
          <div className="xl:col-span-1">
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-6 space-y-4 sticky top-20">
              <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                <Key size={14} /> API Configuration
              </h4>
              
              {/* Provider API keys. Every Gemini variant shares the Google
                  Gemini key, so we present two provider-level inputs instead
                  of one per model. Per-model overrides live in the Advanced
                  section below and are optional. */}
              <div className="space-y-4">
                {API_PROVIDERS.map((provider) => (
                  <div
                    key={provider.keyId}
                    className="rounded-lg border border-gray-200 dark:border-[#30363d] bg-gray-50/60 dark:bg-[#0f141c] p-3 space-y-2"
                  >
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {provider.label}
                    </label>
                    <p className="text-xs text-slate-500">{provider.description}</p>
                    <input
                      type="password"
                      value={apiKeys[provider.keyId] || ''}
                      onChange={(e) => handleApiKeyChange(provider.keyId, e.target.value)}
                      onBlur={() => handleApiKeyBlur(provider.keyId)}
                      className="w-full bg-white dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-brand-teal focus:outline-none text-slate-900 dark:text-white"
                      placeholder={provider.placeholder}
                      autoComplete="off"
                    />
                    <p className="text-[11px] text-slate-500">{provider.helpText}</p>
                  </div>
                ))}
                <p className="text-xs text-slate-500">
                  Keys are stored on your account and only used for your own requests.
                </p>
              </div>

              {/* Advanced: per-model key overrides. Only needed if you want a
                  specific Gemini variant to use a different key than the
                  provider key above. */}
              {OVERRIDE_MODELS.length > 0 && (
                <div className="pt-3 border-t border-gray-200 dark:border-[#30363d]">
                  <button
                    type="button"
                    onClick={() => setShowOverrides((v) => !v)}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    aria-expanded={showOverrides}
                  >
                    <span>Advanced: per-model overrides (optional)</span>
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${showOverrides ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {showOverrides && (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-slate-500">
                        Leave blank to use the provider key above. Set a value only if this model should use a different key.
                      </p>
                      {OVERRIDE_MODELS.map((model) => {
                        const override = apiKeys[model.id] || '';
                        return (
                          <div
                            key={model.id}
                            className="rounded-lg border border-gray-200 dark:border-[#30363d] bg-gray-50/60 dark:bg-[#0f141c] p-3 space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                                {model.name} override
                              </label>
                              {override && (
                                <button
                                  type="button"
                                  onClick={() => handleClearOverride(model.id)}
                                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                  title={`Remove override for ${model.name}`}
                                >
                                  <X size={12} /> Clear
                                </button>
                              )}
                            </div>
                            <input
                              type="password"
                              value={override}
                              onChange={(e) => handleApiKeyChange(model.id, e.target.value)}
                              onBlur={() => handleApiKeyBlur(model.id)}
                              className="w-full bg-white dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-2 text-sm focus:ring-1 focus:ring-brand-teal focus:outline-none text-slate-900 dark:text-white"
                              placeholder={`Use Google Gemini key (default)`}
                              autoComplete="off"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2 pt-3 border-t border-gray-200 dark:border-[#30363d]">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                  System Prompt (applied to generations)
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={3}
                  className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-brand-teal focus:outline-none text-slate-900 dark:text-white"
                  placeholder="Optional instruction sent with every generation/refinement (e.g., brand voice, safety constraints)."
                />
                <p className="text-xs text-slate-500">
                  Prepended as a system instruction to every AI request: generation, refinement, prompt expansion, and brand/image analysis.
                </p>
              </div>
            </div>
          </div>

          {/* MIDDLE COLUMN: Profile & Preferences */}
          <div className="xl:col-span-1 space-y-6">
            
            {/* Profile Section */}
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-6 space-y-4">
              <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                <UserIcon size={14} /> Profile
              </h4>
              
              <div className="grid grid-cols-[auto_1fr] gap-4">
                {/* Photo Upload - Left Side */}
                <div className="flex flex-col items-center gap-2">
                  <div className="relative group">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-200 dark:bg-[#21262d] flex items-center justify-center border-2 border-gray-200 dark:border-[#30363d]">
                      {isUploading ? (
                        <Loader2 size={24} className="animate-spin text-brand-teal" />
                      ) : photoURL || photoDataUrl ? (
                        <CachedImage
                          src={photoURL}
                          fallbackSrc={photoDataUrl}
                          fallback={<span className="text-2xl font-bold text-slate-400">{name.charAt(0).toUpperCase()}</span>}
                          cacheKey={buildProfileImageCacheKey(user.id)}
                          alt={name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl font-bold text-slate-400">{name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute bottom-0 right-0 p-1.5 bg-brand-teal text-white rounded-full shadow-lg hover:bg-teal-600 transition-colors"
                      title="Upload Photo"
                    >
                      <Camera size={14} />
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*"
                      onChange={handleFileSelect}
                    />
                  </div>
                  {uploadError && <p className="text-xs text-red-500 text-center">{uploadError}</p>}
                </div>

                {/* Profile Fields - Right Side */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-brand-teal focus:outline-none text-slate-900 dark:text-white"
                      placeholder="Your Name"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Username (for Community)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">@</span>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg py-2.5 pl-7 pr-3 text-sm focus:ring-1 focus:ring-brand-teal focus:outline-none text-slate-900 dark:text-white"
                        placeholder="username"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Preferences Section */}
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-6 space-y-4">
              <h4 className="text-xs font-bold text-slate-500 uppercase">Defaults</h4>
              
              <div className="flex items-start gap-3">
                <input 
                  type="checkbox" 
                  id="contributeDefault"
                  checked={localSettings.contributeByDefault}
                  onChange={(e) => setLocalSettings(prev => ({ ...prev, contributeByDefault: e.target.checked }))}
                  className="mt-1 w-4 h-4 text-brand-red rounded border-gray-300 focus:ring-brand-red cursor-pointer"
                />
                <div>
                  <label htmlFor="contributeDefault" className="block text-sm font-medium cursor-pointer text-slate-900 dark:text-white">
                    Contribute to Community Catalog by Default
                  </label>
                  <p className="text-xs text-slate-500 mt-1">
                    Automatically share new styles publicly.
                  </p>
                </div>
              </div>

              <div className="pt-1 border-t border-gray-200 dark:border-[#30363d]">
                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Generation Defaults</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Type
                    </label>
                    <RichSelect
                      value={localSettings.defaultGraphicTypeId || ''}
                      onChange={(value) => setLocalSettings(prev => ({ ...prev, defaultGraphicTypeId: value }))}
                      options={graphicTypeOptions}
                      icon={Layout}
                      subLabel="Type"
                      searchable
                      groupOrder={groupOrder}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Style
                    </label>
                    <RichSelect
                      value={localSettings.defaultVisualStyleId || ''}
                      onChange={(value) => setLocalSettings(prev => ({ ...prev, defaultVisualStyleId: value }))}
                      options={visualStyleOptions}
                      icon={PenTool}
                      subLabel="Style"
                      searchable
                      groupOrder={groupOrder}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Colors
                    </label>
                    <RichSelect
                      value={localSettings.defaultColorSchemeId || ''}
                      onChange={(value) => setLocalSettings(prev => ({ ...prev, defaultColorSchemeId: value }))}
                      options={brandColorOptions}
                      icon={Palette}
                      subLabel="Colors"
                      searchable
                      groupOrder={groupOrder}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Size
                    </label>
                    <RichSelect
                      value={localSettings.defaultAspectRatio || ''}
                      onChange={(value) => setLocalSettings(prev => ({ ...prev, defaultAspectRatio: value }))}
                      options={aspectRatioOptions}
                      icon={Maximize}
                      subLabel="Size"
                      searchable
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Model
                    </label>
                    <RichSelect
                      value={selectedModel}
                      onChange={setSelectedModel}
                      options={modelOptions}
                      icon={Sparkles}
                      subLabel="Model"
                      searchable
                      groupOrder={[...MODEL_GROUP_ORDER]}
                      hideOptionDescriptions
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      {selectedModel === 'openai-2'
                        ? 'GPT Image 2: supports 2K/4K and ratios from 3:1 to 1:3.'
                        : selectedModel === 'openai' || selectedModel === 'openai-mini'
                          ? 'Showing only ratios GPT Image outputs natively.'
                          : selectedModel === 'gemini-svg'
                            ? 'SVG: all ratios available (mapped to viewBox).'
                            : 'Showing only ratios Nano Banana models support natively.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 space-y-3 border-t border-gray-200 dark:border-[#30363d]">
                <h4 className="text-xs font-bold text-slate-500 uppercase">Confirmations</h4>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={localSettings.confirmDeleteHistory ?? true}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, confirmDeleteHistory: e.target.checked }))}
                    className="mt-1 w-4 h-4 text-brand-red rounded border-gray-300 focus:ring-brand-red cursor-pointer"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-white">Confirm before deleting recent generations</span>
                    <p className="text-xs text-slate-500 mt-1">Show a prompt before removing items from history.</p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={localSettings.confirmDeleteCurrent ?? true}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, confirmDeleteCurrent: e.target.checked }))}
                    className="mt-1 w-4 h-4 text-brand-red rounded border-gray-300 focus:ring-brand-red cursor-pointer"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-white">Confirm before deleting current preview</span>
                    <p className="text-xs text-slate-500 mt-1">Show a prompt before clearing the main preview image.</p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Teams Management */}
          <div className="xl:col-span-1 space-y-6">
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                   <Users size={14} /> My Teams
                </h4>
                <button 
                  onClick={() => setIsCreatingTeam(!isCreatingTeam)}
                  className="text-xs text-brand-teal hover:underline font-bold"
                >
                   {isCreatingTeam ? 'Cancel' : '+ New Team'}
                </button>
              </div>

              {/* Create Team Form */}
              {isCreatingTeam && (
                  <div className="p-3 bg-brand-teal/5 rounded-lg border border-brand-teal/20 animate-in fade-in slide-in-from-top-2">
                     <input
                       type="text"
                       value={newTeamName}
                       onChange={(e) => setNewTeamName(e.target.value)}
                       placeholder="Team Name"
                       className="w-full mb-2 p-2 text-sm border border-gray-200 dark:border-[#30363d] rounded bg-gray-50 dark:bg-[#0d1117] text-slate-900 dark:text-white"
                       autoFocus
                     />
                     <button 
                       onClick={handleCreateTeam}
                       className="w-full py-1.5 bg-brand-teal text-white text-xs font-bold rounded hover:bg-teal-600 transition-colors"
                     >
                         Create Team
                     </button>
                  </div>
              )}

              {/* Teams List */}
              <div className="space-y-3">
                 {teams.length === 0 ? (
                     <p className="text-sm text-slate-500 italic">You aren't in any teams yet.</p>
                 ) : (
                     teams.map(team => (
                         <div key={team.id} className="border border-gray-200 dark:border-[#30363d] rounded-lg overflow-hidden">
                             <div 
                                 className="p-3 bg-gray-50 dark:bg-[#0d1117] flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-[#161b22]"
                                 onClick={() => setActiveTeamId(activeTeamId === team.id ? null : team.id)}
                             >
                                 <span className="font-bold text-sm text-slate-900 dark:text-white">{team.name}</span>
                                 <span className="text-xs text-slate-500">{team.members.length} members</span>
                             </div>
                             
                             {/* Team Details (Expanded) */}
                             {activeTeamId === team.id && (
                                 <div className="p-3 border-t border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22]">
                                     <div className="flex gap-2 mb-3">
                                         <input
                                           type="email"
                                           value={inviteEmail}
                                           onChange={(e) => setInviteEmail(e.target.value)}
                                           placeholder="user@example.com"
                                           className="flex-1 p-1.5 text-xs border border-gray-200 dark:border-[#30363d] rounded bg-gray-50 dark:bg-[#0d1117] text-slate-900 dark:text-white"
                                         />
                                         <button 
                                           onClick={() => handleInviteMember(team.id)}
                                           className="p-1.5 bg-slate-100 dark:bg-[#30363d] text-slate-600 dark:text-slate-300 rounded hover:text-brand-teal"
                                           title="Invite Member"
                                         >
                                             <Plus size={14} />
                                         </button>
                                     </div>
                                     <div className="space-y-1">
                                         <p className="text-[10px] uppercase font-bold text-slate-400">Members</p>
                                         <div className="text-xs text-slate-600 dark:text-slate-400">
                                             {team.members.map(mid => (
                                                 <div key={mid} className="flex items-center gap-2">
                                                     <div className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                                                     <span className={mid === user.id ? "font-bold text-brand-teal" : ""}>
                                                         {mid === user.id ? "You" : "User " + mid.substring(0,4)}
                                                     </span>
                                                 </div>
                                             ))}
                                         </div>
                                     </div>
                                 </div>
                             )}
                         </div>
                     ))
                 )}
              </div>
            </div>
          </div>

        </div>

        {/* Footer Save Button */}
        <div className="mt-8 flex justify-end gap-3">
          <button 
            onClick={onBack}
            className="px-6 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-lg font-medium text-sm transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-teal hover:bg-teal-600 text-white rounded-lg font-medium transition-colors text-sm shadow-lg shadow-brand-teal/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Saving...
              </>
            ) : saveSuccess ? (
              <>
                <CheckCircle size={16} /> Saved!
              </>
            ) : (
              <>
                <Save size={16} /> Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
