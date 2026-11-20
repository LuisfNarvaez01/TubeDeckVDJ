# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app for Windows; the renderer is a web surface. Not a native-design-language app.)

## Users

- **Mobile DJs / VJs at events** (weddings, quinceañeras, parties): mix live on two decks while a second screen (projector or TV) shows the composed video to the audience.
- **Bars and karaoke venues**: music runs all night, often unattended, relying on Automix and Radio YT; karaoke videos are a core content type.
- **Home parties**: casual personal use where Radio YT keeps the music going.
- The owner intends to **sell / distribute it to other DJs**, so it must hold up as commercial software, not a hobby tool.

## Product Purpose

A two-screen DJ/VJ booth for Windows that mixes YouTube videos streamed into RAM (no media files written to disk during normal playback), interleaves local files, renders a 60 fps composited video for Screen 2 with WebGL transitions and frames, and keeps the dance floor going with Automix plus a YouTube Music–based radio that learns the operator's taste. Success: a DJ can run a full event from one laptop with no silences, no frozen video and no off-genre surprises.

## Positioning

YouTube as the music library, mixed like VirtualDJ: no downloading, no file management, a full deck/mixer/FX/sampler booth, and an audience-facing video output. The radio learns locally (likes, dislikes, skips, reference songs) instead of requiring a Google account.

## Operating Context

- Primary screen: laptop or monitor at **1920×1080**; the UI must also remain usable on smaller laptop screens.
- Screen 2: projector or TV for the audience, driven by the output window.
- **Dark booth at night**: low ambient light; brightness, glare and contrast matter; the operator glances at the screen between interactions.
- Input: mouse/keyboard, keyboard hotkeys, optional USB MIDI controllers (MIDI Learn).
- Network: depends on internet for YouTube; quality tiers and anti-freeze downgrades exist for weak connections.

## Capabilities and Constraints

- Two decks (A/B) with hot cues, loops, beat jump, key shift, pitch/key lock, jog wheels; 3-band EQ mixer with crossfader curves; per-deck FX (echo/reverb/flanger) and 8-pad sampler; CUE/PFL headphone preview routing.
- Video: WebGL2 transitions, 7 reactive video FX, frames (Marcos), logo, marquee, OSD, webcam; Screen 2 output via WebRTC loopback.
- Library: YouTube search/playlists, local files/folders, queue with Automix, history sessions, crates, batch download of history sessions.
- Radio YT: YouTube Music automix sources + local taste model; first-run reference-song setup.
- Constraints: Electron + React 19 + Tailwind v4 renderer; `contextIsolation`/`sandbox`; strict CSP (external scripts not allowed; fonts must be bundled locally); no media files written to `userData` by streaming (E2E enforces it).
- Deck identity colors are functional: Deck A and Deck B must stay instantly distinguishable everywhere (buttons, waveforms, queue load buttons).
- Open decision: product name. "TubeDeck VDJ" is open to renaming; package name and `appId` (`com.tubedeck.vdj`) must not change without explicit approval because auto-update depends on them.

## Brand Commitments

- No emoji in the UI; icons come from one consistent icon library (`lucide-react`) or authored SVG.
- Previous rule set (kept unless the new identity replaces it deliberately): no violet/purple accents.
- The product name is open; visual identity, logo and app icon are delegated to the designer.

## Evidence on Hand

- Working app with real YouTube content; no testimonials, customer logos, press or usage metrics exist. Do not fabricate any.
- Existing app icon: `build/icon.ico` (to be replaced).

## Product Principles

1. **Never silence the floor**: every design decision protects continuous playback (queue, Automix, radio, anti-freeze).
2. **Glanceable in the dark**: state (what is playing, what is next, which deck is live) must read in a one-second glance from arm's length.
3. **Decks are sacred**: Deck A and Deck B identity is consistent and unmistakable across every surface.
4. **Pro, not toy**: it must feel like commercial DJ software a professional would pay for.
5. **The library is YouTube**: browsing should feel as familiar as YouTube itself.

## Accessibility & Inclusion

- Low-light legibility: sufficient contrast for small labels on dark surfaces; avoid large bright fields that cause glare in a dark booth.
- Keyboard operability for core actions (existing hotkeys and focusable controls).
