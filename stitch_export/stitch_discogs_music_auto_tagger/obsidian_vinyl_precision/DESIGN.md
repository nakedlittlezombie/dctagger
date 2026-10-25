---
name: Obsidian Vinyl Precision
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#bcc9cd'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#869397'
  outline-variant: '#3d494c'
  surface-tint: '#4cd7f6'
  primary: '#4cd7f6'
  on-primary: '#003640'
  primary-container: '#06b6d4'
  on-primary-container: '#00424f'
  inverse-primary: '#00687a'
  secondary: '#ffb95f'
  on-secondary: '#472a00'
  secondary-container: '#ee9800'
  on-secondary-container: '#5b3800'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#1bbd85'
  on-tertiary-container: '#00452e'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#acedff'
  primary-fixed-dim: '#4cd7f6'
  on-primary-fixed: '#001f26'
  on-primary-fixed-variant: '#004e5c'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  code-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.06em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system is engineered for audio archivists, digital DJs, vinyl collectors, and audio engineers who demand meticulous accuracy over aesthetic noise. The brand posture is ultra-technical, focused, and utilitarian—recalling rack-mounted audio processors, pristine mastering suites, and the deep taxonomic architecture of the Discogs database.

The visual style combines **Technical Precision** and **Subtle Modern Glassmorphism**. Dark slate and obsidian surfaces eliminate eye strain during multi-hour tagging sessions, while needle-sharp cyan and neon amber callouts evoke LED VU meters, laser tracking needles, and waveform peaks. Interfaces are dense yet legible, prioritizing high information throughput without visual clutter.

## Colors

The palette operates in a default dark mode environment built on three core slate and obsidian tones:
- **Canvas Base (`#0B0F17`)**: The primary viewport and root canvas layer.
- **Surface Layer 1 (`#131B2E`)**: Panel shells, primary navigation rails, and batch tables.
- **Surface Layer 2 (`#1E293B`)**: Inspect panels, floating toolbars, elevated modals, and nested track containers.

Accents serve strict semantic functions:
- **Electric Cyan (`#06B6D4`)**: Primary action, API sync states, active vinyl groove references, and high confidence indicators.
- **Neon Amber (`#F59E0B`)**: Warnings, catalog collision conflicts, unsaved tags, and medium confidence matches.
- **Signal Emerald (`#10B981`)**: Complete batch writes and validated Discogs release IDs.
- **Crimson Alert (`#EF4444`)**: Low confidence matches, missing metadata, and write failures.

## Typography

Typography establishes an immediate division between administrative interfaces and raw metadata:
- **Headings (Space Grotesk)**: Structural, wide-aperture sans-serif for release titles, artist aliases, and tool headers.
- **Body & Controls (Inter)**: Crisp, high-x-height sans-serif providing friction-free readability across high-density tables and option menus.
- **Technical & Metadata (JetBrains Mono)**: Reserved for file paths, matrix runout numbers, Discogs Release IDs (`[r1234567]`), bitrates, sample rates, durations, and field diffs.

All labels and micro-indicators use `uppercase` styling with extended tracking via `label-md` and `label-sm` to maintain instant recognition under minimal sizes.

## Layout & Spacing

This design system uses a modular 3-panel fluid workspace architecture:
1. **Source Browser & File Tree (Left)**: Fixed-width (260px–320px) collateral panel.
2. **Track Matching Workbench (Center)**: Flexible 12-column grid managing split file-to-catalog assignments.
3. **Inspector & Discogs Release View (Right)**: Collapsible fixed-width (340px–420px) inspection tray.

### Breakpoints & Adaptations
- **Desktop (≥ 1280px)**: Complete 3-pane layout visible simultaneously. Grid gutters sit at `1rem`, outer margins at `1.5rem`.
- **Tablet (768px – 1279px)**: Workbench retains dominant focus; Left and Right panels tuck into overlay slide-outs or bottom sheets.
- **Mobile (< 768px)**: Strict single-column stack with segmented tabs switching between "Files", "Match", and "Diff/Write". Outer margins compress to `1rem`.

Component padding relies strictly on compact increments (`space-xs` to `space-md`) to ensure audio lists display maximum rows per screen fold.

## Elevation & Depth

Visual hierarchy uses a hybrid of tonal layering and delicate cyan/amber edge luminescence, avoiding standard drop shadows:

- **Surface Tier 0 (Background)**: `#0B0F17` — Infinite base canvas.
- **Surface Tier 1 (Panel Ground)**: `#131B2E` with a 1px border of `rgba(255, 255, 255, 0.06)`.
- **Surface Tier 2 (Cards & Active Slots)**: `#1E293B` with a 1px border of `rgba(6, 182, 212, 0.2)` on hover/focus.
- **Surface Tier 3 (Overlays & Modals)**: `#131B2E` at 90% opacity paired with `backdrop-filter: blur(16px)` and a diffused ambient shadow: `0 8px 32px -4px rgba(0, 0, 0, 0.65), 0 0 1px 1px rgba(6, 182, 212, 0.3)`.

Active, drag-targeted, or selected slots emit an inner glow (`box-shadow: inset 0 0 12px rgba(6, 182, 212, 0.15)`), evoking backlight hardware synthesizers.

## Shapes

The interface implements a **Soft (Level 1)** geometric standard. Containers, track chips, inputs, and comparison cards use small 4px (`0.25rem`) corner radii, expanding to 8px (`0.5rem`) on modal window borders and preview covers. 

This strict corner control avoids toy-like bubbly aesthetics and reinforces an authentic digital audio workstation (DAW) and rack-mount tool visual feel. Circular shapes are strictly limited to vinyl center-label previews, spinning sync spinners, and audio play/pause toggle triggers.

## Components

### Buttons
- **Primary Action (Write Tags, Apply Match)**: Background in `#06B6D4`, text in `#0B0F17` (bold, JetBrains Mono), subtle hover illumination (`box-shadow: 0 0 14px rgba(6, 182, 212, 0.4)`).
- **Secondary (Fetch Discogs, Parse Filename)**: Transparent fill, 1px border in `rgba(255, 255, 255, 0.15)`, text in `#F8FAFC`. On hover, background shifts to `rgba(255, 255, 255, 0.05)`.
- **Destructive/Discard**: Background `rgba(239, 68, 68, 0.1)`, border in `rgba(239, 68, 68, 0.3)`, text in `#EF4444`.

### Confidence Badges
Monospaced indicator tags with micro status pips:
- **High Match (≥ 90%)**: Text and border in `#06B6D4`, background `rgba(6, 182, 212, 0.08)`. Pip pulses gently.
- **Medium Match (60–89%)**: Text and border in `#F59E0B`, background `rgba(245, 158, 11, 0.08)`.
- **Low Match (< 60%)**: Text and border in `#EF4444`, background `rgba(239, 68, 68, 0.08)`.

### File-to-Track Mapping Chips
- Paired interactive capsules displaying source local filename on the left and resolved Discogs track title/position (`A1`, `B2`, `01`, `02`) on the right.
- Connected via a thin, grooved cyan bridge connector that turns amber when manual overrides are applied.

### Artwork Comparison Cards
- Dual 1:1 image split containers set against `#131B2E`.
- Left: Embedded local ID3 file cover; Right: High-resolution Discogs master release artwork.
- Includes dimension tags (e.g., `600x600` vs `1400x1400 PNG`) rendered in `label-sm` JetBrains Mono along with quick replacement swap triggers.

### Batch Execution Progress Meters
- Thin 4px track styled as an audio VU meter. Background `#1E293B`, filled with `#06B6D4` gradient terminating in `#F59E0B` at the head.
- Running operations display live write-counter readouts (`WRITING: 142/380 TRACKS`) using `label-md` in JetBrains Mono.

### Inputs & Metadata Diff Cells
- Form inputs feature inset dark backgrounds (`#0B0F17`) with a 1px border in `rgba(255, 255, 255, 0.12)`.
- Metadata Diff Cells use strikethroughs with dim red text for existing tag data and neon cyan highlights for incoming Discogs data.