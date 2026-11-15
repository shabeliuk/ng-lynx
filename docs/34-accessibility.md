# Accessibility

Lynx's accessibility model is a set of `accessibility-*` attributes (plus a
couple of differently-named ones) on `StandardProps` — meaning **every**
element supports them, the same way every element supports `id` or `style`.
They configure the platform's native accessibility service (iOS
`UIAccessibility`, Android `AccessibilityNodeInfo`, HarmonyOS) directly; there
is no separate "accessibility tree" ng-lynx builds — it's the same
native element tree everything else renders into, just with extra attributes
the OS-level screen reader reads.

## Typed attributes

All ten are on `LynxStandardElement` (`ng-lynx/elements`), curated from
`@lynx-js/types`' `StandardProps`, which is more precise than the prose on
lynxjs.org's accessibility guide (see the callout below):

| Attribute | Type | Platforms | What it does |
| --- | --- | --- | --- |
| `accessibility-label` | `string` | iOS, Android, Harmony | The text a screen reader speaks for this node. |
| `accessibility-element` | `boolean` | iOS, Android, Harmony, PC | Whether the node is itself an accessibility element (`<image>`/`<text>` default to `true`; everything else defaults to `false`). |
| `accessibility-traits` | `'text' \| 'image' \| 'button' \| 'link' \| 'header' \| 'search' \| 'selected' \| 'playable' \| 'keyboard' \| 'summary' \| 'disabled' \| 'updating' \| 'adjustable' \| 'tabbar' \| 'none'` | iOS, Android, Harmony | The combination of traits that best characterizes the node (default `'none'`) — the screen reader adds type-specific narration for some values (e.g. `'button'`, `'adjustable'`). |
| `accessibility-value` | `string` | iOS, Android | A localized current-value string (e.g. a slider's `"50%"`, read alongside the label). |
| `accessibility-heading` | `boolean` | Android | Marks the node as a heading for accessibility navigation (default `false`). |
| `accessibility-role-description` | `'switch' \| 'checkbox' \| 'image' \| 'progressbar' \| string` | Android | A custom role description (the common values are typed, but any string is accepted). |
| `accessibility-actions` | `string[]` | iOS, Android | Names of custom accessibility actions exposed on the node (beyond a plain activation). |
| `accessibility-elements-hidden` | `boolean` | iOS, Android, Harmony | Hides this node **and its whole subtree** from the accessibility tree (default `false`) — for purely decorative content. |
| `accessibility-exclusive-focus` | `boolean` | iOS, Android, Harmony | Restricts sequential accessibility navigation to this node's subtree only (default `false`) — for modal-like regions. |
| `ios-platform-accessibility-id` | `string` | iOS only | The `accessibilityIdentifier` of the underlying `UIView` (for UI-testing tools, not the screen reader itself). |

```html
<text accessibility-traits="header">Profile</text>
<image src="avatar.png" accessibility-label="Profile photo of Ada Lovelace" />
<view [accessibility-elements-hidden]="true">…decorative divider…</view>
<view
  accessibility-role-description="progressbar"
  [accessibility-value]="completeness() + '%'"
>…</view>
<view accessibility-traits="button" accessibility-label="Follow Ada Lovelace" (tap)="toggleFollow()">…</view>
<view [accessibility-actions]="['Reply', 'Archive']" accessibility-label="Message from Ada">…</view>
```

> **`accessibility-traits` is plural.** lynxjs.org's accessibility guide and its
> `<view>` reference say `accessibility-trait`, but `@lynx-js/types`' `StandardProps`
> and the engine code use the plural, with a richer value union than the guide's.

> **Typed, but not yet run with a screen reader:** `accessibility-elements` (a parent-level
> attribute setting the focus order among its descendants by `a11y-id`),
> `accessibility-elements-a11y` and `a11y-id`. The imperative `requestAccessibilityFocus()`
> method goes through `ShadowElement.invoke({ method: 'requestAccessibilityFocus' })`
> ([10 — Element queries](10-element-queries.md)), and hasn't been measured here either.

## `accessibility-actions` is a real array on the wire, not a CSV string

`[accessibility-actions]="['Reply', 'Archive']"` ships as a genuine JSON array
through the Background→Main-Thread wire protocol (confirmed by the headless
harness — `npm run verify:elements` asserts the array survives intact, not
stringified). On the **web preview** specifically, the final hop is a real
DOM `element.setAttribute(name, arrayValue)` call, and the DOM coerces any
non-string attribute value with `.toString()` — so reading it back via
`getAttribute('accessibility-actions')` in a browser gives you the
**comma-joined string** `"Reply,Archive"` (confirmed live). This is a
DOM-specific stringification on the way *out*, not a wire-protocol
limitation — on-device, the native PAPI receives the real array (same as any
other array-typed attribute).

## Already shipped, used alongside these attributes

- **`LynxObject.accessibilityAnnounce(content)`** — imperatively announces
  text to the screen reader (e.g. after a state change that doesn't move
  focus). See [29 — Platform APIs](29-platform-apis.md).
- **`LynxSlider`/`LynxStepper`** ([09 — Forms](09-forms.md)) wire these
  attributes in themselves: the slider's track carries
  `accessibility-traits="adjustable"` and a live `accessibility-value`
  (the current number, as a string); the stepper's `−`/`+` buttons carry
  `accessibility-traits="button"` and a descriptive `accessibility-label`
  ("Increase"/"Decrease"). Any control you build should do the same —
  see `runtime/src/slider.ts` / `stepper.ts` for the pattern.

## ⚠️ Confirmed on a real device: `accessibility-traits="adjustable"` alone does not make VoiceOver's swipe-up/down adjust the value

`LynxSlider` sets `accessibility-traits="adjustable"` and a live
`accessibility-value` (see `runtime/src/slider.ts`), and both attributes do
reach the native accessibility tree correctly — VoiceOver announces the
element as adjustable. But **swiping up/down while it's focused does not
change the value**; it moves focus to the next/previous element instead, as
if the trait weren't set at all. Confirmed on a real iPhone.

Root cause, per iOS's own `UIAccessibilityTraitAdjustable` contract: setting
the trait only changes what VoiceOver *announces* — actually responding to
the up/down swipe requires the underlying native view to implement
`accessibilityIncrement()`/`accessibilityDecrement()` and update its value
when VoiceOver calls them. Without that, VoiceOver has nothing to invoke and
falls back to its default gesture handling (focus navigation) — exactly what
was observed.

**This isn't fixable from `ng-lynx` or application code.** `LynxSlider`
is a custom `<view>` driven by plain `touchstart`/`touchmove` (Lynx has no
native `<input type="range">` — see slider.ts's doc comment), and there is no
`accessibility-increment`/`accessibility-decrement` event, PAPI method, or any
other hook in `@lynx-js/types`' `StandardProps` that application code could
listen to in order to implement increment/decrement ourselves. The gap is
between the `adjustable` trait and the engine's native view — below what any
attribute or event exposes to JS.

If you need a slider that's genuinely operable by VoiceOver today, expose
separate, individually-focusable "Decrease"/"Increase" controls alongside it
(the same pattern `LynxStepper`'s `−`/`+` buttons already use, which *are*
real `accessibility-traits="button"` elements VoiceOver can double-tap) rather
than relying on the adjustable-trait swipe gesture.

## What's been measured with a screen reader

**iOS VoiceOver, on a real iPhone:** the heading, the avatar's label, the skipped
divider, the progress bar and its value, the Follow button and its changing label,
the message row's custom actions in the rotor, and the stepper's buttons all
announce correctly. The slider's adjustable trait is the gap above.
`accessibilityAnnounce` is confirmed to reach native, not that it's audible.

**Android TalkBack hasn't been run.**

The web preview can't check any of this: `@lynx-js/web-core` and
`@lynx-js/web-elements` map no `accessibility-*` attribute to ARIA, so the values
reach the DOM and nothing reads them.

## Verifying

`npm run verify:elements` covers all ten typed attributes reaching the wire
protocol with the right (non-stringified) types, including the array case.
`npm run verify:controls` covers `LynxSlider`'s/`LynxStepper`'s built-in
wiring. `examples/accessibility` is a full example screen — a profile card
using every attribute above in a realistic layout — live-verified in the web
preview (attribute values on the real DOM, and interactive state changes
reflected in `accessibility-label`).

Continue to [35 — i18n](35-i18n.md).
