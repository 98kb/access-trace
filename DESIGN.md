---
name: Accessibility Inspector
description: A compact inspection ledger connecting accessibility findings to live page targets.
colors:
  canvas: "#f7f7f5"
  surface: "#ffffff"
  surface-raised: "#f0f0ed"
  ink: "#17171b"
  muted: "#5d5d67"
  rule: "#d5d5d0"
  action-violet: "#5b35d5"
  action-violet-hover: "#4524b4"
  action-violet-soft: "#ece7ff"
  review-amber: "#7a4b00"
  review-amber-soft: "#fff1c2"
  review-border: "#d9b968"
  review-ink: "#3e2900"
  danger-red: "#a32222"
  danger-soft: "#fde4e4"
  danger-ink: "#8d1515"
  error-border: "#d17a7a"
  error-soft: "#fff0f0"
  error-ink: "#711a1a"
  evidence-surface: "#ededeb"
  evidence-ink: "#303038"
  focus-blue: "#006dcc"
  canvas-dark: "#16161a"
  surface-dark: "#202026"
  surface-raised-dark: "#2a2a31"
  ink-dark: "#f4f3f7"
  muted-dark: "#aaa8b4"
  rule-dark: "#3b3a43"
  action-violet-dark: "#a88cff"
  action-violet-hover-dark: "#c1afff"
  action-violet-soft-dark: "#33285b"
  button-violet-dark: "#7654e8"
  button-violet-hover-dark: "#8869ef"
  review-amber-dark: "#ffd47b"
  review-amber-soft-dark: "#493612"
  review-border-dark: "#765d27"
  review-ink-dark: "#ffdda0"
  error-border-dark: "#884b4b"
  error-soft-dark: "#402424"
  error-ink-dark: "#ffc7c7"
  danger-soft-dark: "#522727"
  danger-ink-dark: "#ffb4b4"
  evidence-ink-dark: "#dedce5"
  focus-blue-dark: "#68b8ff"
  overlay-fuchsia: "#d946ef"
  overlay-violet: "#7c3aed"
  overlay-emphasis: "#facc15"
  overlay-label: "#111827"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(22px, 7vw, 30px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.03em"
  evidence:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  square: "0"
  overlay-label: "3px"
  evidence: "6px"
  field: "7px"
  control: "8px"
  notice: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action-violet}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.action-violet-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  filter-select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 28px 0 9px"
    height: "36px"
  finding-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "12px"
  evidence-strip:
    backgroundColor: "{colors.evidence-surface}"
    textColor: "{colors.evidence-ink}"
    typography: "{typography.evidence}"
    rounded: "{rounded.evidence}"
    padding: "7px 8px"
---

# Design System: Accessibility Inspector

## Overview

**Creative North Star: "The Compact Inspection Ledger"**

The interface is a restrained developer instrument: page identity, scan state, filters, findings, and live-target feedback read as one continuous inspection record. Neutral ink and paper-like surfaces carry most of the interface; violet is reserved for actions and selection, while amber identifies review work.

Information density is intentional. Square finding rows, hairline rules, compact labels, and monospace evidence make repeated scanning fast without turning the side panel into a generic dashboard. The voice stays direct, local, and factual.

**Key Characteristics:**

- Flat neutral surfaces separated by 1px rules.
- One violet action and selection accent, with amber reserved for review cues.
- Dense ledger rows instead of detached cards or metric tiles.
- System UI for explanation; monospace for rule IDs, evidence, tags, and overlay labels.
- Visible focus and textual status labels; meaning never relies on color alone.

## Colors

Warm-neutral surfaces and near-black ink keep the interface quiet; violet drives action and selection, amber signals review, and red is limited to confirmed danger or error states. Native dark mode swaps the complete neutral and semantic palette through `prefers-color-scheme`.

### Primary

- **Action Violet** (`#5b35d5`; dark `#a88cff`): primary actions, links, status emphasis, selected rows, and active overlay controls.
- **Deep Action Violet** (`#4524b4`; dark `#c1afff`): hover and stronger active text.
- **Violet Wash** (`#ece7ff`; dark `#33285b`): selected toggle and low-intensity accent surfaces.

### Neutral

- **Paper Canvas** (`#f7f7f5`; dark `#16161a`): application background.
- **Clear Surface** (`#ffffff`; dark `#202026`): masthead, controls, count strip, and finding rows.
- **Raised Mist** (`#f0f0ed`; dark `#2a2a31`): hover feedback and quiet evidence surfaces.
- **Inspector Ink** (`#17171b`; dark `#f4f3f7`): primary copy and strong counts.
- **Muted Graphite** (`#5d5d67`; dark `#aaa8b4`): metadata, secondary copy, and quiet labels.
- **Hairline Rule** (`#d5d5d0`; dark `#3b3a43`): structural dividers and control borders.

### Semantic

- **Review Amber** (`#7a4b00` on `#fff1c2`; dark `#ffd47b` on `#493612`): manual-review statuses and coverage notes.
- **Danger Red** (`#a32222`): errors and confirmed high-impact cues, always paired with text.
- **Focus Blue** (`#006dcc`; dark `#68b8ff`): the exclusive keyboard focus outline.
- **Target Fuchsia** (`#d946ef`) and **Target Violet** (`#7c3aed`): live-page overlay bounds; selected targets add white separation and animate toward **Emphasis Yellow** (`#facc15`).

**The One Accent Rule.** Keep violet rare and operational. Do not distribute additional decorative accent colors through the side panel.

## Typography

**Display Font:** Inter with the native system sans-serif stack
**Body Font:** Inter with the native system sans-serif stack
**Label/Mono Font:** `ui-monospace`, SFMono-Regular, Consolas, monospace

**Character:** Compact, utilitarian system typography keeps the tool native to Chrome. Monospace is an evidence channel, not a decorative voice.

### Hierarchy

- **Display** (700, `clamp(22px, 7vw, 30px)`, 1.08): centered launch, loading, clean, and error-state headings only.
- **Headline** (700, 15–16px, 1.25–1.3): product identity and scanned-page title.
- **Section title** (700, 13px): ledger section headings.
- **Body** (400, 12–13px, 1.45–1.55): finding summaries and explanatory state copy.
- **Label** (700–800, 10px, `0.03em` where space permits): filters, statuses, counts metadata, and compact supporting copy.
- **Evidence** (400–700, 10–13px, 1.2–1.4): rule IDs, selectors, standards tags, and live overlay labels.

**The Evidence Channel Rule.** Use monospace only when the text names or quotes technical evidence; explanatory prose remains sans-serif.

## Layout

The side panel is a single vertical flow with a 16px outer gutter. After a scan, page identity and rescan action lead into a permanent two-column count strip, optional notices, sticky filters, and one continuous finding ledger. The results list uses 6px top breathing room and 24px bottom padding; finding content uses 12px internal padding.

The panel supports widths down to 280px. At 320px and below, long page titles and URLs wrap to two lines and the two filter fields stack; the count strip remains two columns. Sticky controls stay at the top of the scrolling results context so narrowing and overlay control remain available.

## Elevation & Depth

The system has no ambient shadows. Depth comes from tonal layering, 1px dividers, and state changes. The single inset 4px violet edge on a selected finding communicates selection inside the ledger rather than floating the row above it.

**The Flat Instrument Rule.** Do not introduce card shadows or floating dashboard layers; use rules, surface tone, and inset selection instead.

## Shapes

Structural data remains square: findings join edge-to-edge with zero radius, and count cells are divided by hairlines. Controls use restrained 7–8px radii, notices use 10px, evidence strips use 6px, and compact impact labels use a full pill. Circular geometry is limited to the launch crosshair and scan-state glyphs.

The live-page overlay is intentionally angular: 3px bounds become 5px when selected, with a 2px white outline separating the target from arbitrary page content.

## Components

### Buttons

- **Shape:** restrained control radius (`8px`) with 36px secondary and 44px primary minimum heights.
- **Primary:** Action Violet, white text, `11px 16px` padding, and 700 weight; hover deepens the violet.
- **Secondary:** Clear Surface with a 1px Hairline Rule; hover changes only to Raised Mist.
- **Focus:** every button uses the 3px Focus Blue outline with a 2px offset.

### Filters

- **Style:** native select controls in Clear Surface with a 1px Hairline Rule, 7px radius, and 36px minimum height.
- **Labels:** 10px, 700 weight, and restrained tracking above each field.
- **Responsive behavior:** two equal columns normally, one column at 320px and below.

### Count Strip

- **Style:** exactly two equal cells on Clear Surface, joined by a vertical Hairline Rule.
- **Numbers:** 24px bold tabular numerals over 12px muted labels.
- **Role:** summary band feeding the ledger, not independent metric cards.

### Finding Ledger

- **Row:** square Clear Surface with contiguous 1px rules and 12px content padding.
- **Selection:** Action Violet border plus a 4px inset leading edge.
- **Evidence:** one-line Raised Mist strip in 11px monospace with 6px radius and ellipsis overflow.
- **Footer:** 1px top rule, monospace standards tags, and a violet text link.
- **Status:** uppercase text is always shown; impact color never carries status alone.

### Notices

- **Coverage:** Review Amber Wash, amber border, 10px radius, and a strong textual heading.
- **Command error:** pale red tonal surface and border with a textual rescan action.

### Live Target Overlay

- **Default:** 3px Target Fuchsia bounds with a 12% fill and a dark monospace label.
- **Selected:** 5px Target Violet bounds, 14% fill, 2px white outline, and a two-cycle 650ms emphasis animation toward yellow.
- **Reduced motion:** remove the animation entirely when requested by the operating system.

## Do's and Don'ts

### Do:

- **Do** preserve the sequence page identity → explicit scan → filters → selected finding → live target.
- **Do** use 1px rules and shared edges to keep dense results legible.
- **Do** retain visible text for violation, needs-review, impact, error, and coverage states.
- **Do** keep focus visible with the established 3px blue outline and honor reduced-motion preferences.
- **Do** adapt long page metadata and filters at the established 320px narrow-panel breakpoint.

### Don't:

- **Don't** turn counts or findings into detached dashboard tiles.
- **Don't** use monospace for general product copy or explanation.
- **Don't** add shadows, gradients, decorative color, or rounded containers to create hierarchy.
- **Don't** communicate severity, review status, or selection by color alone.
- **Don't** imply that a clean automated scan proves accessibility compliance.
