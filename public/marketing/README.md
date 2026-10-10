# PixTaffy homepage marketing assets

Local experiment only. Do not push/deploy until Ray asks.

## Files present
- `hero-studio.png` / `hero-studio-web.png` — real studio UI (legacy BrandoIt chrome in source shot; still useful layout reference)
- `benefit-scale-byok.png` — full studio frame (starter)
- `benefit-presets-brand.png` — toolbar + colors dropdown crop (starter)
- `benefit-follow-ups.png` — refine bar / canvas crop (starter)
- `live-welcome-current.png` — live pixtaffy.com welcome as of capture (still candy-art homepage on production)

## Still needed (capture in signed-in or guest studio)
- `benefit-folder-instructions.png` — Recent Generations folder picker + Add/Edit folder instructions modal
- `benefit-consistent-animation.png` — Build Studio timeline with multiple consistent frames
- `benefit-frame-exports.png` — Build Studio export menu (MP4 / PPTX / PNG)
- `benefit-batch-compare.png` — QTY + compare models / juxtapose slider
- card-* variants for FeatureDemoGrid (optional; grid falls back to `/brand/feature-*.webp`)

## Best in-app surfaces
1. Scale + BYOK — ControlPanel model dropdown (multi-select / compare) + QTY + Settings API keys
2. Folder instructions — RecentGenerations folder dropdown + instructions modal
3. Consistent animation — BuildStudio after Animate on a still
4. Follow-ups — ImageDisplay refine row + Run analysis / full editor
5. Frame exports — BuildStudio export actions
6. Presets + brand PDF — ControlPanel presets bookmark + Brand upload / BrandAnalysisModal
7. Batch + compare — QTY, brace prompt, selection mode export/delete, comparison slider

## Landing edit targets
- `components/LandingPage.tsx`
- `components/FeatureDemoGrid.tsx`
- Assets under `public/marketing/`
