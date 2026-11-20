---
name: TubeDeck VDJ
description: Two-deck YouTube video DJ booth for dark rooms; a streaming home screen at night.
colors:
  ground: "#0a0f0d"
  surface: "#131a17"
  raised: "#1b2420"
  raised-2: "#24302a"
  raised-3: "#2d3a33"
  ink: "#f3f1ea"
  ink-2: "#e4e7e1"
  ink-soft: "#c8cfc9"
  muted: "#8f9c95"
  faint: "#7c8983"
  faint-2: "#3a4740"
  deck-a: "#10d9a0"
  deck-b: "#f5c542"
  live: "#fff4dc"
  danger: "#f0524a"
  danger-soft: "#f7a49e"
typography:
  readout:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    fontFeature: "tnum"
  readout-sm:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    fontFeature: "tnum"
  deck-title:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  title:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  card-title:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  meta:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  label:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
  numeric:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontWeight: 600
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
components:
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "10px"
  button-control:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
    height: "44px"
  button-control-hover:
    backgroundColor: "{colors.raised-2}"
    textColor: "{colors.ink}"
  button-live:
    backgroundColor: "{colors.live}"
    textColor: "{colors.ground}"
    rounded: "{rounded.md}"
  chip-filter:
    backgroundColor: "{colors.raised-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  input-search:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "4px 4px 4px 12px"
  tag-on-air:
    backgroundColor: "{colors.live}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  card-video:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.lg}"
---

# Design System: TubeDeck VDJ

## Overview

**Creative North Star: "The Streaming Wall at Night"**

The booth reads like a streaming home screen in a dark room. Artwork and video thumbnails supply the colour; the chrome is green-tinted black that steps back. Whatever is in focus (the on-air deck, the hovered library card) lifts, and its siblings recede. Dense at 1920×1080, one humanist face, small type ranked by weight rather than size.

It refuses the grey-hardware-with-neon-accents default of DJ software.

**Key Characteristics:**
- Tonal dark layers (ground → surface → raised → raised-2/3), warm-white hairlines at 6–8%.
- Deck A emerald and Deck B gold as functional identity.
- Focus lift + sibling dim as the signature motion.
- lucide-react line icons; no emoji.

## Colors

Near-black chrome with three signal colours and one alarm.

### Primary
- **Booth Emerald** (deck-a): Deck A identity: deck badge, A-load buttons, on-air border and glow, caret, selection.
- **Marquee Gold** (deck-b): Deck B identity in the same roles.

### Tertiary
- **Live Warm White** (live): on-air tag, active toggles (tinted fill at 15–25% with a 50–60% border), primary action fill, preloaded queue line, focus ring.
- **Signal Red** (danger) / **Soft Red** (danger-soft): destructive actions, failed states and error text only.

### Neutral
- **Night Ground** (ground), **Panel** (surface), **Raised** (raised, raised-2, raised-3): background stack, in that order of elevation.
- **Ink** (ink, ink-2, ink-soft): primary and secondary text; off-air deck titles drop to ink-soft.
- **Muted / Faint** (muted, faint, faint-2): metadata, timestamps, disabled.

**The Earned Colour Rule.** Saturated colour appears only on actionable or live elements. Everything else is neutral or comes from the artwork.

**The Deck Identity Rule.** Emerald means Deck A and gold means Deck B, everywhere. Never use them decoratively or swap them.

**The Output Exemption Rule.** Screen 2 output art (src/renderer/video/*, frames) keeps its own colours and sits outside this system.

## Typography

**Body Font:** Figtree Variable, bundled locally via @fontsource-variable/figtree (with Segoe UI, system-ui)

**Character:** One warm humanist sans throughout; clocks, BPM, durations and start times use the same face with tabular numerals at weight 600.

### Hierarchy
- **Readout** (600 tabular, 28px; 20px for BPM): the deck clock and BPM, readable at arm's length in a dark booth.
- **Deck title** (600, 17px): the loaded track on each deck. Deck headers are container-query aware: below a 672px-wide deck the title and BPM drop to 14px, the clock to 20px, the artwork tile to 56px and the ÷2/×2 buttons hide.
- **Title** (600, 14px): panel and deck titles, "Siguiente" heading.
- **Card title** (600, 13px, 1.375): video card titles, two-line clamp.
- **Body** (500, 12px): controls, queue titles, top bar.
- **Meta** (400, 11px): channel, view counts, secondary lines.
- **Label** (600–700, 10px): tags, tab captions, status lines; uppercase plus wide tracking only for status tags such as "AL AIRE".

**The One Label Rule.** Labels share one small size; rank them by weight and case, not by new sizes.

## Layout

Fixed desktop console. A 40px top bar (brand mark, version, the single next decision with countdown, live toggles), then a cabin of Deck A, video master and Deck B over an FX/mixer row, then a dock split from the cabin by a draggable row separator. The dock holds browser tabs on the left and a persistent "Siguiente" column on the right. The library uses an auto-fill grid of 16:9 cards (min 200px, 12px column / 16px row gaps), which becomes a single horizontally scrolling shelf of cards (snap, width sized to the dock height) when the results area is under 250px; the list view is only an explicit user choice. Spacing runs 4/6/8/12px. Gaps are tight and padding is small.

## Elevation & Depth

Tonal layering at rest. Shadows mark state and never decorate.

### Shadow Vocabulary
- **On-air glow** (`0 14px 32px -16px` deck colour at 45%, with a 1px lift and the deck border at 45%): the live deck only.
- **Card lift** (`0 16px 32px -14px rgba(0,0,0,0.85)` + 2px live ring + 2px rise): hovered or focused library card.
- **Stored cue tint** (deck colour at 15% fill + 40% border): a hot-cue pad that holds a cue. Pads otherwise stay flat surfaces with a hairline; no bevels.

**The Lift and Dim Rule.** The focused item lifts and its siblings dim to 0.55. Dim identity chrome only, never controls the DJ needs.

## Shapes

Soft rectangles: pads and controls 6px, cards and bars 8px, deck and module panels 12px, tags 4px. Search fields, filter chips and the round A/B/play load buttons are full pills. All video is 16:9.

## Components

### Buttons
- **Control:** raised fill, 1px hairline, ink-soft text; hover raised-2 + ink. Press scales to 0.97.
- **Toggle on:** live tint fill, live border, live text.
- **Primary:** solid live or deck-colour fill with ground text.

### Chips
Pill filters, raised-2 fill when active and ink-soft when idle.

### Inputs
Pill search on ground with an 8% hairline that brightens to 25% on focus. Emerald caret.

### Video Card
16:9 thumbnail, 8px radius, with a duration badge on black at 85%. Hover reveals round A/B load buttons and a slight artwork zoom (1.03).

### Siguiente Queue Row
Thumbnail, title, a right-aligned tabular start time ("~13:59") and a radio reason line with like/dislike/block. State is shown by line form along the thumbnail base: dashed ink = pending, dashed live = preloading, solid live = preloaded. Failed rows are struck through in red.

### Brand Mark
A gold 16:9 screen behind an emerald one, with a knocked-out play glyph. The app icon sets it on a rounded green-black square.

## Do's and Don'ts

### Do:
- **Do** animate state at 150–200ms with cubic-bezier(0.16, 1, 0.3, 1). Respect reduced motion.
- **Do** show focus as a 1.5px live-white outline at 60%, 2px offset.
- **Do** let thumbnails and video carry the colour.

### Don't:
- **Don't** use emoji. Icons come from lucide-react.
- **Don't** put deck emerald or gold on anything not tied to that deck.
- **Don't** use danger red for anything that is not destructive or failed.
- **Don't** add new label sizes to create hierarchy.
