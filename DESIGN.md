# PixTaffy Design System

The source of truth for how PixTaffy looks, moves, and behaves. These are
decisions, not suggestions: they were made (and often re-made) across releases
0.1 → 0.24. When adding UI, copy a recipe from here; when a rule and existing
code disagree, this document names the canonical form and the code is the
migration target. Interaction taste rules also live in `CLAUDE.md`; this
document is the superset that adds tokens, recipes, and motion.

---

## 1. Philosophy

**Minimal, direct-manipulation interfaces. Every control must earn its pixels.**

- **Manipulate the value itself.** A readout IS the control: drag it to scrub,
  click it to type in place (`ScrubValue` in Build Studio). Never add a second
  input elsewhere for the same value.
- **Rename in place.** Double-click the name where it's displayed → it becomes
  an input. No "name" field in a details panel.
- **Hide, then reveal.** Actions appear on hover, details expand on selection,
  settings collapse into titled sections. The default view is a quiet list —
  the gallery must read as a **clean image grid** at rest (details toggle
  defaults off; version pills live on the viewer, not the tiles).
- **Drag beats buttons.** Reorder by dragging the row, move by dragging the
  badge, nest by dropping on the row, resize by dragging corners. No up/down
  arrow buttons.
- **Don't cover, don't fight the primary surface.** Progress banners dock out
  of the way, chrome hides while the user scrubs a slider, arrows disappear
  when they'd collide with another control's affordances.
- **De-duplicate affordances.** If a control duplicates something that already
  lives elsewhere (header nav vs. panel controls, reset button vs. Settings),
  delete it.
- **Discoverability through rich tooltips, never onboarding tours.**
- **Honest feedback.** Never toast success before the action has actually
  happened — the tile disappearing IS the feedback. Busy state appears only on
  the control that triggered the work.

## 2. Color

Tokens are defined in `index.css` (Tailwind v4 `@theme`). Dark mode is the
class strategy (`<html class="dark">` is currently hard-set).

| Token | Hex | Meaning |
|---|---|---|
| `brand-teal` | `#009EAA` | Primary product accent: actions, active/selected states, links, focus rings, toggles, and drop indicators |
| `brand-cyan` | `#08D5E8` | Bright highlight for creative tools, sparkle details, active imagery, and grid lines on dark brand surfaces |
| `brand-orange` | `#FF7A18` | Warm creative accent for starts, badges, and one end of the candy spectrum |
| `brand-red` | `#E72D58` | Candy coral on marketing surfaces; destructive fired state, errors, failed runs, and AI-busy pulse in product chrome |
| `brand-pink` | `#F22991` | Playful accent for primary marketing actions and selected promotional moments |
| `brand-purple` | `#9B35E3` | Supporting brand accent for editorial labels, plans, and the far end of spectrum gradients |
| `brand-dark` | `#103653` | Deep navy foundation for dark artwork, readable contrast, and grid lines on light surfaces |
| `brand-cream` | `#FFF2E3` | Warm light-mode brand surface; use as a wash, not as body text or a control state |
| `dark-bg` | `#0d1117` | Page background (dark) |
| `dark-card` | `#161b22` | Card / panel surface (dark) |
| `dark-border` | `#30363d` | Hairline borders (dark) |
| `dark-hover` | `#21262d` | Hover wash (dark) |

Semantic states: **teal** = active/primary · **amber-500** = armed
(destructive confirm) and warnings · **red** = destructive/error ·
**green/emerald** = success (rare) · **slate** = neutral/stopped/dim.

### Candy-spectrum discipline

- Product chrome stays mostly dark navy, slate, white, and teal. The full
  spectrum belongs on marketing pages, generated artwork, and deliberate
  celebratory moments.
- Use at most one multicolor gradient per major section. Individual cards get
  one accent color or a very faint two-color wash, never the entire palette.
- The graph-paper background uses a 42px grid at roughly 5–6% opacity. Fade or
  mask it near section boundaries so it provides structure without becoming
  visual noise.
- Light marketing surfaces may use `brand-cream` as a translucent wash. Keep
  content cards white and text slate for dependable contrast.
- The studio workspace may reuse the 42px grid with one pink edge glow and one
  cyan edge glow at 3–7% opacity. Keep control fills neutral, use category
  colors on toolbar icons, and reserve the orange-to-purple gradient for the
  primary Generate action. Secondary and gallery controls remain neutral.

Light/dark pairs (the house combinations — use these, don't invent new ones):

```
Surface (card):   bg-white dark:bg-[#161b22]
Surface (inset):  bg-gray-50 dark:bg-[#0d1117]
Border:           border-gray-200 dark:border-[#30363d]
Text (primary):   text-slate-800 dark:text-slate-100
Text (muted):     text-slate-500 dark:text-slate-400
Status quad ex.:  bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300
                  border-red-200 dark:border-red-800
```

Foreground text is always **slate**; light-mode surfaces/borders are **gray**.
Never `zinc`/`neutral`.

> **Canonical going forward:** prefer the semantic tokens (`dark:bg-dark-card`,
> `dark:border-dark-border`) over raw hex arbitrary values. The codebase
> currently uses hex literals (`dark:bg-[#161b22]`) in ~300 places — matching
> them is acceptable when editing nearby code, but new surfaces should use the
> tokens.

## 3. Typography

Font: **Mona Sans** (variable, self-hosted `/fonts/Mona-Sans.woff2`), falling
back to Inter. The Tailwind text scale is **remapped one step up** in
`index.css` — don't be fooled by the class names:

| Class | Renders | Use |
|---|---|---|
| `text-2xl font-bold` | — | Page / section headings |
| `text-base` | 18px | Long-form body (rare) |
| `text-sm` | 16px | Body, standard button labels |
| `text-xs` | 14px | Labels, dense body |
| `text-[13px]` | 13px | Tooltips, compact button labels |
| `text-[11px] font-semibold` | 11px | Micro-copy, chips, segment labels |
| `text-[10px] font-bold uppercase tracking-wider text-slate-400` | 10px | Micro section labels |

- Weights: `font-semibold` and `font-bold` for labels/buttons, `font-medium`
  for body. Nothing lighter than normal.
- **Section/eyebrow labels**: 10–11px, bold/semibold, `uppercase
  tracking-wider`, slate-400/500. Dropdown section headers:
  `px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider
  text-slate-500 dark:text-slate-400`.
- **Counters and page numbers get `tabular-nums`** (often + `leading-none`) so
  digits don't jitter as values change.
- `font-mono` appears ONLY inside `<kbd>` chips.
- Timestamps: `MM-DD HH:MM AM/PM`.

### Wordmark

- In the compact logo lockup, keep **Pix** neutral (`slate-900` in light mode,
  white in dark mode) and set **Taffy** in the homepage orange → coral → purple
  gradient. This keeps the name readable while connecting it to the candy
  artwork.
- **Pix** uses `font-normal`; **Taffy** uses `font-black`. Keep the pair tight at
  `tracking-[-0.035em]` and never split the wordmark across lines.
- Do not apply the text gradient to the circular brandmark. It already carries
  the complete palette and needs a quiet wordmark beside it.

## 4. Iconography

**lucide-react only.** Icons + rich tooltips beat text labels for compact
controls; text only when an icon would be ambiguous (the "AI" tag).
`Loader2` + `animate-spin` is the universal spinner. Icon allowlists that
resolve dynamic names (What's New `ICON_MAP`) fall back to `HelpCircle`.

## 5. Shape, depth, spacing

Radius map — smaller radius for smaller things:

| Radius | Use |
|---|---|
| `rounded-md` | Compact controls: segments, chips, small tooltips |
| `rounded-lg` | **Default**: buttons, inputs, standard cards, toasts |
| `rounded-xl` | Elevated cards, rich tooltips |
| `rounded-2xl` | Large dropdown panels, modal panels |
| `rounded-full` | Pills, circular icon buttons, toggles, badges |

- Borders are 1px hairlines in the standard pair. Dashed borders
  (`border-dashed border-brand-teal/50`) mark add/empty affordances.
- **Cards are flat** — defined by border, not shadow. Shadows mark *floating*
  things: dropdown panels `shadow-xl`, modals/toasts `shadow-2xl`, floating
  icon buttons `shadow-lg`, primary CTAs `shadow-lg shadow-brand-teal/20`.
- **Touch targets: 44×44 minimum.** On compact desktop layouts reserve it
  responsively: `min-h-[44px] sm:min-h-0`.
- Scrollbars: auto-hide overlay style (global in `index.css`) — transparent
  until the scroll area is hovered/focused. Long surfaces stay visually clean.

## 6. Motion

- Default transition: `transition-colors` (or bare `transition`),
  **150–200ms**, default ease. Theme toggle: `transition-colors duration-200`.
- Hover reveal (the workhorse, used everywhere):
  `opacity-0 group-hover:opacity-100 transition-opacity` — always paired with
  `group-focus-within:` or `group-focus-visible:` for keyboard parity, and
  `pointer-events-none` while hidden.
  - Touch devices: gate with `[@media(hover:hover)]` (or
    `opacity-100 lg:opacity-0 lg:group-hover:opacity-100`) so controls stay
    reachable on tablets/phones. Keep hidden controls in the DOM
    (opacity-only) for tab-focus and screen readers.
  - **Scope your groups** (`group/tip`, `group/tb`, …). An unscoped `group`
    on an ancestor lights up every nested `group-hover:` at once.
- **No layout shift, ever.** Overlays are absolute/fixed and fade in; hidden
  rails keep their layout slot; `tabular-nums` for changing digits.
- Fullscreen entrance: `fullscreenOverlayIn` 180ms ease-out backdrop fade +
  `fullscreenContentIn` 220ms `cubic-bezier(0.16,1,0.3,1)` scale 0.97→1.
  Decelerating curves that settle at rest — never overshoot.
- Idle-hide: fullscreen/preview chrome and cursor fade after ~4s idle
  (`cursor-none`); any mouse move or key brings everything back instantly.
- `animate-pulse` = armed confirms, in-flight moves, skeletons.
  `animate-spin` = `Loader2` only.

> The `animate-in fade-in zoom-in-95 …` utilities are backed by
> `tw-animate-css` (imported in `index.css`). Modal/popover entrances use
> `animate-in fade-in duration-200` (+ `zoom-in-95` on the panel).

## 7. Tooltips

**Rich styled overlays, never native `title`.** Every interactive control gets
one — the tooltip is part of the control, not an afterthought.

- **Canonical implementation:** the portal `Tip` (BuildStudio) — rendered via
  `createPortal` to `document.body`, `position: fixed`, viewport-clamped with
  8px edge margin and 6px gap, so **no ancestor can ever clip it**. Prefer
  this for anything inside a scroll container or `overflow-hidden` ancestor.
- Simple CSS tooltips are fine for shallow contexts:
  `pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2
  whitespace-nowrap text-[13px] font-medium px-3 py-1.5 rounded-lg
  bg-black/90 text-white shadow-xl opacity-0 group-hover/tb:opacity-100
  transition-opacity` (11px/`px-2 py-1 rounded-md` for the small variant).
- Always `bg-black/90 text-white` — the "dark glass" pill. No delay on show.
- **Two-part long-form**: bold headline (`block font-semibold`) + muted body
  (`block text-slate-300 font-normal mt-0.5`), or the rich card
  (`w-56 px-3 py-2.5 rounded-xl` + uppercase micro-label header). Never one
  run-on paragraph.
- Keyboard shortcuts render as `<kbd>` chips inside tooltips:
  `inline-flex items-center justify-center h-5 min-w-5 px-1 rounded
  bg-white/10 border border-white/15 text-[10px] font-mono`.
- **Tooltips must never crop.** The two recurring killers: an
  `overflow-hidden` ancestor (round the child buttons instead of clipping the
  group — or portal the tip), and screen-edge overflow (clamp or flip).
  Hover-test after any layout change.
- Suppress the hover tip while the control is `disabled`; instead, prefer a
  **disabled button + explanatory tooltip over a thrown error**.

## 8. Destructive & paid actions

**Inline confirm, never a dialog.** First tap arms, second tap fires,
auto-disarm. Everything destructive must also be undoable (⌘Z).

- **Canonical: the `useConfirmAction` hook** — one armed key at a time,
  auto-disarm ~2.5–3s (hook default 3000ms).
- Armed visual: **`bg-amber-500 text-white animate-pulse`**, icon swaps to
  `Check`, label/tooltip swaps to **"Sure?"** (compact) or **"Click again to
  confirm"** (roomier). Idle state hints intent:
  `text-slate-500 hover:text-red-500 hover:bg-red-500/10`.
  Amber = armed; red is what *fires* or is *in-flight* (AI-busy pulses
  brand-red).
- The same double-tap discipline applies across surfaces (tile delete, main
  preview delete, bulk delete, context menus) **so muscle memory transfers**.
- No "don't ask me again" bypasses for destructive taps.
- **No button inside a button** — a delete badge over a thumbnail is a sibling
  `<div>`, never nested in the thumb's `<button>`.
- Batch shortcuts that use number keys (hold 1–9 + click) must guard against
  form fields, like all shortcuts (§12).

## 9. Buttons & controls (recipes)

```
Primary CTA:   px-6 py-2 bg-brand-teal hover:bg-teal-600 text-white rounded-lg
               font-medium text-sm shadow-lg shadow-brand-teal/20
               disabled:opacity-50 disabled:cursor-not-allowed
Compact CTA:   px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-teal
               text-white hover:bg-teal-600 disabled:opacity-40
Secondary:     px-3 py-2 rounded-lg border border-gray-200 dark:border-[#30363d]
               bg-white dark:bg-[#0d1117] text-slate-800 dark:text-slate-100
               hover:bg-brand-teal hover:border-brand-teal hover:text-white
Ghost (teal):  px-2 py-0.5 rounded-md text-brand-teal text-[11px] font-semibold
               hover:bg-brand-teal/10
Icon (canvas): h-11 w-11 rounded-full border border-gray-300/80
               dark:border-white/15 bg-white/90 dark:bg-[#1f252d]/90 shadow-lg
               backdrop-blur-sm hover:bg-brand-teal hover:border-brand-teal
               hover:text-white focus:ring-2 focus:ring-brand-teal/70
On-image chip: px-2.5 py-1.5 rounded-md text-xs font-semibold text-white
               bg-black/60 hover:bg-black/75 backdrop-blur-sm
```

- Primary hover is always `hover:bg-teal-600`; secondary/neutral controls
  **fill teal on hover** rather than darkening.
- Segmented groups: container `inline-flex rounded-md border`, items
  `first:rounded-l-md last:rounded-r-md`, selected `bg-brand-teal text-white`.
  Round the child buttons — never `overflow-hidden` on the group (tooltip
  killer).
- Toggle (`Switch`): `w-8 h-[18px] rounded-full`, on `bg-brand-teal`, off
  `bg-[#30363d]`, white knob slides via `transition-transform`.
- Focus convention everywhere: `focus:outline-none focus:ring-1` (or `ring-2`)
  `focus:ring-brand-teal`.
- Count badge: `absolute -top-1.5 -right-1.5 min-w-6 h-6 px-1.5 rounded-full
  bg-brand-teal text-white text-[11px] font-bold shadow-lg ring-2 ring-white
  dark:ring-[#0d1117] tabular-nums pointer-events-none`.
- Settings rows: label left (`text-xs text-slate-400`), control right, one
  line, `min-h-[26px]`.

## 10. Overlays & layering

- Modal: backdrop `fixed inset-0 z-[100] flex items-center justify-center p-4
  bg-black/60 backdrop-blur-sm`, panel `bg-white dark:bg-[#161b22] rounded-2xl
  shadow-2xl`. Esc and backdrop-click close; ⌘/Ctrl+Enter submits editors.
- Dropdown/popover: `absolute top-full mt-2` + `rounded-2xl shadow-xl` panel;
  dismissed via a sibling full-screen click-catcher
  (`<div className="fixed inset-0 z-10" onClick={close} />`).
- **Anything inside a scroll container gets portaled** to `document.body` with
  viewport-aware flip positioning. This bug (clipped dropdowns) has been fixed
  at least five separate times — reach for the portal first. Watch for
  `overflow-x-auto` implicitly setting `overflow-y: auto`.
  Portaled satellites need outside-click awareness (`closest('[data-…]')`) so
  they don't self-close their parent.
- Z-scale: `z-10` click-catchers → `z-20` inline tooltips → `z-30` rich
  tooltips/dropdowns → `z-40` toasts → `z-50` busy banners → `z-[100]` modals
  → `z-[140–300]` nested/fullscreen layers → `500` portal tips.

## 11. Esc: one obvious escape hatch

Esc peels back **one layer at a time**, never jumps straight to closing:

> typing field (blur only) → draft/drag cancel → play/clean mode → zoom/focus
> reset → selection clear → close.

Every layer's handler `stopPropagation()`s so parents don't also close. If
the user is typing in an input/textarea/contenteditable, Esc only blurs.

## 12. Keyboard

- Shortcuts (←/→ marks, ↑/↓ versions, 1–9 batch, ⌥ zoom) **always guard
  against typing contexts** — inputs, textareas, contenteditables, and open
  editor modals.
- Enter submits, Shift+Enter newlines (prompt box); ⌘/Ctrl+Enter submits
  modals; ⌘Z / ⇧⌘Z undo/redo covers every destructive structural edit.
- Hover-revealed controls stay in the DOM so Tab reaches them; toasts carry
  `role="status" aria-live="polite"`.

## 13. Feedback & status

- Toasts: centered pill, auto-clear ~1.8s, `pointer-events-none fixed inset-0
  z-40 flex items-center justify-center`, pill `text-white text-sm px-4 py-3
  rounded-lg shadow-2xl`. Two tones: **neutral** (default) = dark glass
  `bg-black/90 border-white/10`; **error** = `bg-brand-red border-brand-red/70`.
  Red is reserved for errors — pass the tone explicitly at error call sites.
- Progress lives in a dockable pill ("2 running · 1 queued") that auto-expands
  on each new run and docks out of the preview's way.
- Generate clears the previous result **immediately** and shows a
  "Generating…" placeholder; batches show N pulsing teal-bordered
  placeholders up front so upcoming Marks are visible.
- Status colors: teal running · red failed · slate stopped · amber refinement.
- Empty states are one quiet muted sentence (`text-xs text-slate-500`) that
  says what to do — no illustrations.

## 14. Voice & copy

- Version labels are Roman-numeral **"Mark I / Mark II"** — full wording,
  never abbreviated.
- **Copy tracks scope**: "Download all in this tile", "Version deleted" (not
  "Refinement deleted" once non-refinements qualify).
- Renames don't migrate data (Items→Frames, X-Small→Tiny changed labels only).
  Prefer short labels that survive narrow widths without wrapping.
- One-sentence summaries in What's New rows. CTA voice: "Read the guide →" /
  "Got it". Busy voice: "AI is working…". Arming voice: "Sure?".
- Sentence case; concise; no marketing fluff inside the app.

## 15. Generated-image house style

- The canonical generation set is **PixTaffy Character Scene** + **PixTaffy
  Candy 3D** + **PixTaffy Candy**. Its paint palette is teal `#009EAA`, cyan
  `#08D5E8`, orange `#FF7A18`, coral `#E72D58`, pink `#F22991`, purple
  `#9B35E3`, navy `#103653`, and cream `#FFF2E3`.
- Characters are glossy soft-taffy creatives with twisted stripes, expressive
  eyes, small white-gloved hands, colorful sneakers, toy-like proportions,
  smooth studio light, soft shadows, tactile surfaces, and playful sparkles.
  Keep silhouettes and tools varied so a group reads as a creative team rather
  than duplicated mascots.
- Every What's New release ships a **16:9 brand-palette hero illustration**
  (`public/whats-new/`), generated via the "What's New Hero" preset —
  an unskippable step of the release flow.
- Palettes are **paint-mixing instructions, never content**: prompt builders
  frame brand colors with an explicit never-render clause so hex codes and
  swatch chips don't appear inside images. Type/Style/Colors/Size are
  settings, not content.
- Presets are **partial snapshots** — they override only the fields they
  carry, composing with the rest of the toolbar.
- The external API (`agentGenerateImage`) delivers **lossless webp by
  default** — full resolution, smaller files; `png`/`jpeg` on request.

## 16. Known drift (migration targets)

1. Raw dark hex literals → semantic `dark-*` tokens in new code — §2.
2. Four tooltip implementations → prefer the portal `Tip`; consolidate when
   touching call sites — §7.

(Resolved 2026-07: inert `animate-in` utilities now backed by
`tw-animate-css`; ad-hoc red confirms migrated to `useConfirmAction`;
toast tones split neutral/error.)
