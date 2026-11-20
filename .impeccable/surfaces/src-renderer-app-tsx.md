---
version: 1
slug: "src-renderer-app-tsx"
primary_target: "src/renderer/App.tsx"
related_targets: []
---

# Surface brief: DJ booth (main window)

Scope: the whole main window of the Electron renderer (`src/renderer/App.tsx` and its components): top bar, two decks, video master, FX/sampler, mixer, browser dock and the "Siguiente" column. Visitor mode: **Operate**.

Audience and job: mobile DJs/VJs, bar and karaoke operators, home-party hosts; run a full event from one laptop in a dark booth, at 1920×1080, with a projector/TV as Screen 2. Task: load, cue, mix and queue YouTube videos without silences; glance-read what plays, what is next and which deck is on air.

Constraints: Deck A and Deck B must be unmistakable everywhere; fonts bundled locally (strict CSP); no emoji; keep every existing control, hotkey and accessible name working; E2E selectors rely on accessible names.

## Direction contract

seed: seed:3b2bb725dadbec4e (challenger chosen by the user: pop-culture-shelf-streaming-title-card-wall), palette chosen by the user: black + emerald and gold.

THESIS: The booth reads like a streaming home screen at night: artwork is the colour, the thing in focus lifts and everything else steps back. Refuses the category default of grey hardware panels with neon accents.

OWN-WORLD: Green-tinted black ground (#0A0F0D), surfaces #131A17 / #1B2420, hairlines in warm white at 6–8 %. Colour comes from thumbnails and video; Deck A emerald #10D9A0, Deck B gold #F5C542, on-air/live warm white #FFF4DC, danger red only for destructive actions. One humanist UI face (Figtree, bundled) with tabular numerals for clocks/BPM; rounded 8–10 px tiles, pill filters.

STORY: The operator sees which deck is on air at a glance (it lifts, the other steps back), what plays next and when, and browses YouTube exactly as on YouTube.

FIRST VIEWPORT: Top bar with brand mark, the single next decision ("Siguiente · title · in 01:23"), live toggles. Two decks with artwork-led headers, the on-air deck lifted with an AL AIRE tag. Video master centre. FX/mixer row. Dock: YouTube-style card grid + persistent Siguiente column showing when each song will start.

SIGNATURE: Focus lift + dim: the on-air deck and the hovered/focused library tile lift (ring, shadow, scale) while siblings dim; a focused queue row shows its start time.

RISK: Dimming the off-air deck can hide controls the DJ needs for cueing; dim only identity chrome, never controls. Raises kept: queue start times right-aligned (cassette J-card), saturated colour only on actionable/live (warm consumer), one label size ranked by weight/case (timetable), only the next decision in the top bar (airport), queue state by line form (emission rail).
