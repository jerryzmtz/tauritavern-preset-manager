---
name: TauriTavern Preset Stitcher
description: A native-feeling TauriTavern workbench for moving PromptManager entries safely between presets.
colors:
  theme-text: "#e7e1d0"
  theme-surface: "#102021"
  theme-border: "#7c8170"
  theme-accent: "#b9c49a"
  theme-danger: "#bd5b5b"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "14px"
components:
  button-neutral:
    backgroundColor: "{colors.theme-surface}"
    textColor: "{colors.theme-text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  row-entry:
    backgroundColor: "{colors.theme-surface}"
    textColor: "{colors.theme-text}"
    rounded: "{rounded.md}"
    padding: "7px 8px"
---

# Design System: TauriTavern Preset Stitcher

## 1. Overview

**Creative North Star: "Borrowed Tavern Furniture"**

This interface must feel like a practical piece of TauriTavern furniture placed in the existing room. It is dense, quiet, and immediate. The user is here to compare real prompt entries, move them, and save only when ready; nothing should compete with that task.

The system explicitly rejects standalone app branding, hero composition, decorative gradients, glassmorphism as decoration, and any color palette that fights the active tavern theme. The extension may introduce semantic aliases, but those aliases must resolve back to the host SmartTheme variables or conservative fallbacks.

**Key Characteristics:**
- Host-themed surfaces, borders, text, and accent states.
- Compact list rows built for scanning prompt names, roles, enabled state, and content length.
- Desktop side-by-side comparison; mobile tabbed full-screen workbench with button fallbacks.
- Explicit save state, visible dirty state, and no hidden writes.

## 2. Colors

The palette is not owned by this extension. It is inherited from TauriTavern.

### Primary
- **Theme Accent** (`var(--SmartThemeQuoteColor)`): used for current selection, primary save affordance, focus ring, and dirty-state indicator only.

### Neutral
- **Theme Text** (`var(--SmartThemeBodyColor)`): all primary labels, row titles, and button text.
- **Theme Surface** (`var(--SmartThemeBlurTintColor)`): panel, toolbar, list row, and input backgrounds, usually mixed with transparency.
- **Theme Border** (`var(--SmartThemeBorderColor)`): panel outlines, row borders, field borders, and separators.
- **Theme Shadow** (`var(--SmartThemeShadowColor)`): backdrop and panel shadow, never as a decorative glow.

### Named Rules
**The Borrowed Color Rule.** Every visible color must come from SmartTheme variables, `currentColor`, or a semantic danger/warning fallback mixed with `--SmartThemeBodyColor`.

**The Accent Rarity Rule.** The accent is reserved for selected, focused, dirty, or primary-save states. Inactive rows and inactive controls never carry saturated accent color.

## 3. Typography

**Display Font:** none.
**Body Font:** system UI stack.
**Label/Mono Font:** system UI for labels, `ui-monospace` stack only inside prompt content preview.

**Character:** The type is utilitarian and native. Prompt text stays readable; controls stay compact.

### Hierarchy
- **Title** (700, 16px, 1.3): panel title and pane headings.
- **Body** (400, 14px, 1.45): controls, row titles, and ordinary UI text.
- **Label** (500, 12px, 1.3): field labels, counts, metadata, and quiet status text.
- **Mono Preview** (400, 13px, 1.55): prompt content preview only.

### Named Rules
**The No Display Rule.** Do not use display fonts, fluid hero type, or viewport-scaled font sizes. This is a tool, not a landing page.

## 4. Elevation

Depth is conveyed through the host blur tint, border contrast, and one structural panel shadow. Rows are flat by default and become visually stronger only on hover, focus, or selection.

### Shadow Vocabulary
- **Panel Shadow** (`0 18px 48px color-mix(in srgb, var(--SmartThemeShadowColor) 42%, transparent)`): the main workbench floating above the tavern UI.
- **Launcher Shadow** (`0 8px 22px color-mix(in srgb, var(--SmartThemeShadowColor) 32%, transparent)`): the compact entry button.

### Named Rules
**The Flat Rows Rule.** List rows do not get decorative shadows. Selection uses border and tonal background shifts.

## 5. Components

### Buttons
- **Shape:** gently curved native tool buttons (8px radius).
- **Primary:** accent-tinted background, SmartTheme text, 36px minimum height.
- **Hover / Focus:** border changes to Theme Accent and adds a subtle accent-tinted background.
- **Icon Buttons:** 34px square, Font Awesome icons inherited from the tavern environment, with `title` and `aria-label` where needed.

### Chips
- **Style:** compact count pills using Theme Border and muted Theme Text.
- **State:** selected tabs use the same accent treatment as selected list rows.

### Cards / Containers
- **Corner Style:** 8px maximum.
- **Background:** SmartTheme blur tint mixed with transparency.
- **Shadow Strategy:** only the outer workbench panel uses a structural shadow.
- **Border:** one-pixel SmartTheme border or softened border mix.
- **Internal Padding:** 8px for rows, 12-14px for panel bands.

### Inputs / Fields
- **Style:** native select/input rectangles with 8px radius, host-colored text, and SmartTheme border.
- **Focus:** accent border plus a 2px accent-tinted focus ring.
- **Disabled:** opacity reduction only; no separate disabled palette.

### Navigation
- **Desktop:** persistent source, target, and favorites/preview columns.
- **Mobile:** four segmented tabs: 来源, 目标, 收藏, 预览. Mobile never requires drag; row buttons expose the same actions.

## 6. Do's and Don'ts

### Do:
- **Do** use SmartTheme variables for text, surface, border, accent, blur, and shadow.
- **Do** keep source and target entries visible at the same time on desktop.
- **Do** provide explicit copy, favorite, insert, move, toggle, remove, reset, and save buttons.
- **Do** use TauriTavern `layout-kit.js` or the hard `data-tt-mobile-surface` ABI for full-screen mobile behavior.
- **Do** test Chinese DOM text after rendering; evidence with `??` or mojibake is invalid.

### Don't:
- **Don't** introduce a standalone palette, purple-blue gradients, decorative glow, or glassmorphism as decoration.
- **Don't** build a hero page, landing page, nested card layout, or explanatory marketing surface.
- **Don't** rely on drag-and-drop as the only operation path.
- **Don't** write to a preset before the user clicks the explicit save button.
- **Don't** rewrite, normalize, or trim prompt content while moving entries.
