# UI Specification Guide

## Purpose

The UI spec defines **what the user sees and interacts with** — component hierarchy, layout, states, and interactions. It bridges the gap between PRD requirements (what to build) and frontend implementation (how to build it).

## Location

`{planning_dir}/{track}/ui-spec.md` — one per track that includes frontend work.

## When to Write

- Track has FE work items (WBs that touch `web/`, `src/dashboard/`, or UI components)
- New page, modal, or significant component is being added
- Existing UI is being redesigned or restructured

Do NOT write for backend-only tracks or minor style changes.

## Structure

```markdown
# UI Specification: {Feature Name}

## Overview
Brief description of what the user will see and do.

## Page / Component Map

```
PageName/
├── Layout (grid/flex structure)
├── HeaderSection
│   ├── Title
│   └── ActionButtons (Create, Filter)
├── MainContent
│   ├── DataTable / CardGrid
│   │   └── RowItem / Card
│   └── EmptyState
├── SidePanel (conditional)
│   ├── DetailView
│   └── EditForm
└── Footer / Pagination
```

## States

Every component must handle 4 states:

| State | Trigger | Display |
|-------|---------|---------|
| **Loading** | Data fetching in progress | Skeleton / spinner |
| **Empty** | No data available | Illustration + CTA |
| **Success** | Data loaded | Content rendered |
| **Error** | Fetch failed | Error message + retry |

## Layout

Use **SVG wireframes** for layout definitions. SVG is readable by both humans and AI agents, version-controllable, and renders in markdown previews.

### Desktop (≥ 1280px)

Save as `{planning_dir}/{track}/wireframes/{page-name}-desktop.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" font-family="monospace" font-size="12">
  <!-- Page frame -->
  <rect x="0" y="0" width="800" height="500" fill="none" stroke="#333" rx="4"/>

  <!-- Header -->
  <rect x="0" y="0" width="800" height="48" fill="#f3f4f6" stroke="#333" rx="4"/>
  <text x="16" y="30" font-weight="bold">Page Title</text>
  <rect x="640" y="10" width="70" height="28" fill="#3b82f6" rx="4"/>
  <text x="655" y="29" fill="white" font-size="11">Action 1</text>
  <rect x="720" y="10" width="70" height="28" fill="#e5e7eb" rx="4"/>
  <text x="735" y="29" font-size="11">Action 2</text>

  <!-- Sidebar -->
  <rect x="0" y="48" width="200" height="452" fill="#f9fafb" stroke="#e5e7eb"/>
  <text x="16" y="80" font-size="11">Nav Item 1</text>
  <text x="16" y="104" font-size="11">Nav Item 2</text>
  <text x="16" y="128" font-size="11">Nav Item 3</text>

  <!-- Main Content -->
  <rect x="216" y="64" width="568" height="180" fill="none" stroke="#d1d5db" rx="4"/>
  <text x="232" y="90" fill="#6b7280">Component A</text>

  <rect x="216" y="260" width="568" height="180" fill="none" stroke="#d1d5db" rx="4"/>
  <text x="232" y="286" fill="#6b7280">Component B</text>

  <!-- Footer -->
  <rect x="0" y="468" width="800" height="32" fill="#f3f4f6" stroke="#e5e7eb"/>
  <text x="16" y="489" font-size="10" fill="#9ca3af">Status bar</text>
</svg>
```

### Wireframe Rules
- Save SVG files in `{planning_dir}/{track}/wireframes/`
- One SVG per page per breakpoint (e.g., `workflows-desktop.svg`, `workflows-tablet.svg`)
- Use monospace font, neutral colors (`#f3f4f6`, `#e5e7eb`, `#3b82f6`)
- Label every region with its component name
- Mark interactive elements with blue (`#3b82f6`) fill

### Responsive breakpoints
- Desktop: ≥ 1280px (primary target)
- Tablet: 768px–1279px (sidebar collapses)
- Mobile: < 768px (stack layout, if supported)

## Components

### ComponentName
- **Purpose**: What it does
- **Props/Inputs**: Data it receives
- **User Actions**: Click, hover, drag, keyboard shortcuts
- **Output/Events**: What happens on interaction (API call, state change, navigation)

### Data Display Rules
- Currency: KRW → comma separator / USD → `$` + 2 decimals
- Percentages: `%` + color (green positive, red negative) + direction arrow
- Dates: `YYYY-MM-DD HH:mm`
- Status: Badge with color coding

## Interactions

### {Action Name}
- **Trigger**: Button click / keyboard shortcut / hover
- **Validation**: Input constraints before action
- **Confirmation**: Required for destructive actions (modal with explicit confirm)
- **Feedback**: Toast notification on success / inline error on failure
- **Loading**: Button disabled + spinner during async operation

## Accessibility (a11y)
- All interactive elements have `aria-label`
- Color is never the sole indicator (add icon or text)
- Tab order follows visual reading order
- Form inputs have associated `<label>`
- Minimum contrast ratio: 4.5:1
```

## Writing Principles

1. **SVG wireframes + component tree** — Use SVG for layout wireframes (version-controllable, renders in previews). Use tree notation for component hierarchy. Both are readable by AI agents.
2. **States are mandatory** — Every data-driven component must define Loading/Empty/Success/Error states. Missing states cause UI bugs that are expensive to fix later.
3. **Interactions are specific** — "User can edit" is vague. "Click edit button → inline form appears → Enter saves, Esc cancels → toast on success" is implementable.
4. **Data formats are explicit** — Don't leave formatting to the implementer's judgment. Define exactly how currencies, dates, percentages, and statuses appear.
5. **Accessibility is not optional** — a11y requirements are part of the spec, not a follow-up task. The implementer should include aria attributes from the start.
6. **Link to PRD** — Each page/component traces to an FR. If there's no FR for it, either add one to the PRD or question whether it's needed.

## Relationship to Other Documents

- **PRD** → defines WHAT the user needs (FR acceptance criteria)
- **UI Spec** → defines HOW the user sees and interacts with it
- **API Contract** → defines WHAT data the UI receives/sends
- **Work Breakdown** → the WB implements the UI spec, referencing specific components
- **frontend-design skill** → the implementer uses this skill to write the actual code

## Anti-Patterns

- **Screenshot-only spec** — Screenshots without component breakdown are not implementable by AI agents. Use SVG wireframes instead
- **"Make it look good"** — Subjective without defining spacing, colors, typography rules
- **Missing error states** — Happy path only specs cause production bugs
- **No mobile consideration** — Even desktop-first apps need responsive breakpoints defined
