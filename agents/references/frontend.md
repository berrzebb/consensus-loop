# Frontend Implementation Reference

Read this when implementing WB items that touch frontend code (`web/`, `src/dashboard/`, or UI components).

## Component Architecture

### State Management by Complexity

| Complexity | Pattern | When to Use |
|-----------|---------|------------|
| Simple value | `createSignal` | Toggle, counter, input value |
| Derived value | `createMemo` | Computed from other signals, filtered list |
| Complex object | `createStore` | Nested state, form data, modal state |
| Async data | `createResource` | API fetch, server data |
| Shared state | Context + `createStore` | Cross-component state (auth, theme) |

### The 4-State Rule

Every data-driven component MUST handle 4 states. Missing states cause production bugs.

```tsx
<Show when={!resource.loading} fallback={<Skeleton />}>
  <Show when={!resource.error} fallback={<ErrorPanel error={resource.error} onRetry={refetch} />}>
    <Show when={data().length > 0} fallback={<EmptyState message={t("no_items")} />}>
      <DataList items={data()} />
    </Show>
  </Show>
</Show>
```

| State | Component | Required Elements |
|-------|-----------|------------------|
| **Loading** | `<Skeleton />` or spinner | Preserve layout (no layout shift) |
| **Error** | `<ErrorPanel />` or inline message | Error message + retry button |
| **Empty** | `<EmptyState />` | Descriptive message + CTA if applicable |
| **Success** | Content component | Actual data rendered |

### Error Boundaries

Wrap route-level components with `<ErrorBoundary>`:

```tsx
<ErrorBoundary fallback={(err, reset) => <ErrorPanel error={err} onRetry={reset} />}>
  <PageContent />
</ErrorBoundary>
```

## Styling (Tailwind)

### Spacing System

Use 4-unit increments only: `p-2` (8px), `p-4` (16px), `p-6` (24px), `p-8` (32px).
Do NOT use arbitrary values like `p-[13px]` unless matching a specific design token.

### Dark Mode

Every color class needs a `dark:` variant:
```tsx
<div class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
```

### Layout Patterns

```tsx
// Page layout — sidebar fixed, main responsive
<div class="flex h-screen">
  <aside class="w-64 flex-shrink-0">Sidebar</aside>
  <main class="flex-1 overflow-auto p-6">Content</main>
</div>

// Card grid — responsive columns
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <Card />
</div>

// Form layout — label + input pairs
<div class="space-y-4">
  <div>
    <label for="name" class="block text-sm font-medium">{t("name")}</label>
    <input id="name" type="text" class="mt-1 w-full rounded border p-2" />
  </div>
</div>
```

### Consistent Rounding & Shadows

```
Rounding: rounded-md (buttons, inputs) | rounded-lg (cards, modals)
Shadows:  shadow-sm (inputs) | shadow (cards) | shadow-lg (modals, dropdowns)
```

## Data Display Formats

| Data Type | Format | Example |
|-----------|--------|---------|
| KRW | Comma separator, no decimals | `1,234,567` |
| USD | `$` prefix, 2 decimals | `$1,234.56` |
| Percentage | `%` + color + arrow | `↑ 12.5%` (green) / `↓ 3.2%` (red) |
| Date | `YYYY-MM-DD HH:mm` | `2026-03-20 14:30` |
| Status | Badge with color | `<Badge color="green">Active</Badge>` |
| Duration | Human readable | `2h 15m` or `3 days ago` |
| File size | SI units | `1.2 MB`, `340 KB` |

Use `Intl.NumberFormat` and `Intl.DateTimeFormat` for locale-aware formatting.

## i18n

### Rules
- **No hardcoded user-facing strings** — use locale keys always
- **Both locales** — every new key must exist in `ko.json` AND `en.json`
- Use the bundled script to add keys:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/add-locale-key.mjs" "key.path" "한국어 값" "English value"
  ```

### Key Naming Convention
```
{page}.{section}.{element}
```
Examples: `workflows.header.title`, `settings.form.save_button`, `common.error.retry`

## Accessibility (a11y)

### Mandatory
- Every `<button>` and `<a>` has visible text OR `aria-label`
- Every `<input>` has an associated `<label>` (via `for`/`id`)
- Color is NEVER the sole indicator — add icon or text
- Tab order follows visual reading order
- Minimum contrast ratio: 4.5:1

### Interactive Elements
```tsx
// Icon-only button — needs aria-label
<button aria-label={t("close")} onClick={onClose}>
  <CloseIcon />
</button>

// Toggle — needs aria-checked
<button role="switch" aria-checked={isOn()} onClick={toggle}>
  {isOn() ? "ON" : "OFF"}
</button>
```

## Interactions

### Double-Click Prevention
```tsx
const [submitting, setSubmitting] = createSignal(false);

async function handleSubmit() {
  if (submitting()) return;
  setSubmitting(true);
  try {
    await submitForm(data());
    toast.success(t("saved"));
  } catch (e) {
    toast.error(e.message);
  } finally {
    setSubmitting(false);
  }
}

<button disabled={submitting()} onClick={handleSubmit}>
  {submitting() ? <Spinner /> : t("save")}
</button>
```

### Destructive Actions
Always show confirmation modal before delete, reset, or irreversible actions:
```tsx
<ConfirmModal
  title={t("confirm_delete")}
  message={t("delete_warning")}
  onConfirm={handleDelete}
  onCancel={closeModal}
  confirmLabel={t("delete")}
  variant="danger"
/>
```

### Toast Notifications
- **Success**: Green, auto-dismiss after 3s
- **Error**: Red, persist until dismissed, include retry if applicable
- **Info**: Blue, auto-dismiss after 5s

## Testing FE Components

### Test File Location
```
web/tests/{section}/{component-name}.test.tsx
```

### Test Patterns
```tsx
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";

describe("ComponentName", () => {
  it("renders success state with data", () => {
    render(() => <Component data={mockData} />);
    expect(screen.getByText("Expected Text")).toBeInTheDocument();
  });

  it("shows loading skeleton initially", () => {
    render(() => <Component loading={true} />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("displays error with retry button", () => {
    const onRetry = vi.fn();
    render(() => <Component error={new Error("fail")} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

### What to Test
- All 4 states render correctly
- User interactions trigger expected callbacks
- Form validation shows correct errors
- i18n keys render (not raw key strings)
- Accessibility: elements have correct roles/labels

## Performance

- **Lazy load** heavy components: `lazy(() => import("./HeavyComponent"))`
- **Virtualize** long lists (100+ items): use `@tanstack/solid-virtual`
- **Debounce** search inputs: 300ms minimum
- **Avoid unnecessary re-renders**: use `createMemo` for derived values, not inline computation
- **Image optimization**: use `loading="lazy"` and proper `width`/`height` attributes
