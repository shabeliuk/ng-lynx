// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * A2UI v1.0 `@accessibility` → Lynx accessibility attributes: port of
 * upstream `accessibilityProps` (react/accessibility.js).
 *
 * `label` and `description` become `accessibility-label` (joined with
 * ". ") on an `accessibility-element`; `hidden` becomes
 * `accessibility-elements-hidden`. The `aria-*` forms upstream also sets
 * for Lynx for Web are set too, so a catalog behaves the same on both.
 *
 * Upstream spreads these attributes onto each component's root element.
 * Angular templates can't spread, so catalog components put the
 * {@link A2uiAccessibility} directive (`a2uiA11y`) on their root instead.
 */
import { Directive, effect, ElementRef, inject, Renderer2 } from '@angular/core';

import { A2UI_NODE_CONTEXT } from './node-context.js';
import { coerceA2uiBoolean } from './resolve-props.js';

/**
 * Lynx (and Web) attributes for a resolved `@accessibility` value.
 *
 * @experimental
 */
export function a2uiAccessibilityAttributes(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const fields = value as Record<string, unknown>;
  const label = typeof fields['label'] === 'string' ? fields['label'] : undefined;
  const description = typeof fields['description'] === 'string' ? fields['description'] : undefined;
  const out: Record<string, unknown> = {};
  if (label !== undefined) out['aria-label'] = label;
  if (description !== undefined) out['aria-description'] = description;
  if (label !== undefined || description !== undefined) {
    out['accessibility-element'] = true;
    out['accessibility-label'] = [label, description].filter(Boolean).join('. ');
  }
  if (fields['hidden'] !== undefined) {
    const hidden = coerceA2uiBoolean(fields['hidden']);
    out['aria-hidden'] = hidden;
    out['accessibility-elements-hidden'] = hidden;
  }
  if (['off', 'polite', 'assertive'].includes(String(fields['live']))) {
    out['aria-live'] = fields['live'];
  }
  return out;
}

/**
 * Applies the node's resolved `@accessibility` to its host element. Put it on
 * a catalog component's root element: `<view a2uiA11y ...>`.
 *
 * @experimental
 */
@Directive({
  selector: '[a2uiA11y]',
  standalone: true,
})
export class A2uiAccessibility {
  private readonly ctx = inject(A2UI_NODE_CONTEXT);
  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private applied: Record<string, unknown> = {};

  constructor() {
    effect(() => {
      const next = a2uiAccessibilityAttributes(this.ctx.props()['@accessibility']);
      const host = this.el.nativeElement;
      for (const name of Object.keys(this.applied)) {
        if (!(name in next)) this.renderer.removeAttribute(host, name);
      }
      for (const [name, value] of Object.entries(next)) {
        if (this.applied[name] !== value) this.renderer.setProperty(host, name, value);
      }
      this.applied = next;
    });
  }
}
