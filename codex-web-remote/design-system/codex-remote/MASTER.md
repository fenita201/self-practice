# Codex Remote — UI/UX system

Source: installed nextlevelbuilder/ui-ux-pro-max-skill, local searches 2026-10-09.
Verified style match: `minimal developer dashboard` → Minimalism & Swiss Style; coherent grid, whitespace, functional hierarchy, high contrast, support for light and dark. `SaaS productivity dashboard` → Flat Design; low-cost CSS interactions 150–200ms and simple controls. React `keyboard focus modal` → trap focus and restore it on dismissal.

The design-system generator returned marketing/FAQ landing patterns even after a narrower retry. Those patterns do not fit a working IDE and are not used. The workspace pattern below is a project-specific adaptation of the verified style guidance, not a database-matched landing template.

- Product: Vietnamese remote coding workspace. Four resizable panels on large screens; four navigation tabs on phone/tablet. Existing API, ownership and permission behavior remains authoritative.
- Palette: neutral slate surfaces; emerald accent for actions; distinct warning/error text and icons. Semantic tokens for both modes; normal text contrast ≥4.5:1. No decorative gradients/glow.
- Type: system sans-serif for UI to work offline; system monospace for code. Body 14px desktop, inputs 16px on touch devices, metadata at least12px.
- Rhythm: 4/8px scale; 8–12px corners, 16px panel padding, 24px empty-state space. Fine separators and few shadows (overlays only).
- Icons: consistent local SVG strokes,18px controls/24px primary icons; decorative aria-hidden, interactive icons have labels. No external font/icon fetch.
- Theme: visible switch on login and app header; saved in localStorage; use system preference initially. Theme includes dialogs, editor, badges, status and errors.
- Motion: 150ms colors/opacity,180ms overlay entrance; no layout animation; reduced-motion removes animation and smooth scrolling.
- Feedback: busy controls, informative empty/loading states, save/conflict/Steer feedback. Session updates5s/focus retain filters and already-loaded pages.
- Status: friendly metadata and quota bars first; missing/stale values explicit; detailed payloads behind disclosure. No invented usage/price.
- A11y: focus rings, labels, modal focus trap/Escape/restore,44px touch targets and safe-area insets. Test375/768/1024/1440 plus landscape and both themes.
