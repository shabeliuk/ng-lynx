// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Angular ports of the A2UI v0.9 basic-catalog components.
 *
 * Each mirrors the behavior contract of its ReactLynx counterpart in
 * `@lynx-js/genui/a2ui/catalog` — same protocol prop names, same
 * `setValue('value', …)` write-back convention, same `sendAction(action)`
 * dispatch — while rendering angular-lynx / native Lynx elements. Styling is
 * intentionally minimal inline flex (Lynx CSS differs from the web theme
 * tokens the upstream CSS files target); apps can restyle via the class
 * names, which match upstream (`text-body`, `button-primary`, `row`, …).
 *
 * Full catalog (20 of 20): Text, Button, Row, Column, Card, Divider, Image,
 * List, Loading, TextField, CheckBox, Slider, Icon, RadioGroup, ChoicePicker,
 * Modal, Tabs, DateTimeInput, LineChart, PieChart.
 *
 * `checks` arrive with their conditions already resolved (the node renderer
 * resolves function calls / bindings inside props reactively — the same
 * pipeline upstream uses), so components only need `Boolean(condition)`
 * over the array. The upstream `FormContext` cross-input registry is not
 * ported.
 *
 * A few components simplify upstream's ReactLynx behavior deliberately (each
 * one documented at its class below): `Modal` skips upstream's
 * `suppressActionDispatch` on its trigger child (a wrapping tap-to-open view,
 * same as upstream, but a trigger with its own action fires both); and
 * `ChoicePicker` renders one visual style rather than switching
 * checkbox-vs-chips chrome — the interaction (filter, single/multi select,
 * checks) is complete either way.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  Directive,
  inject,
  NO_ERRORS_SCHEMA,
  signal,
  Signal,
} from '@angular/core';

import type { ComponentInstance } from '@lynx-js/genui/a2ui/store';

import {
  buildLineChartSvg,
  buildPieChartSvg,
  type ChartSeries,
  DEFAULT_CHART_COLORS,
  formatPercent,
  formatValue,
  normalizeSeries,
  type PieSlice,
  sampleIndices,
} from './chart-utils.js';
import type { A2uiCatalogInput } from './catalog.js';
import {
  addMonths,
  dateTimePartsToDate,
  buildDateTimeMonthPage,
  formatDateTimeInputValue,
  getDateTimeInputPlaceholder,
  getDefaultDateTimeParts,
  getWeekdayLabels,
  incrementDateTimePart,
  isDateTimeAfterMax,
  isDateTimeBeforeMin,
  type MonthDay,
  normalizeDateTimeInputLabel,
  normalizeDateTimeInputMode,
  normalizeDateTimeInputValue,
  startOfMonth,
  withDate,
} from './datetime-utils.js';
import { A2UI_NODE_CONTEXT } from './node-context.js';
import { A2uiNode } from './node.directive.js';
import { resolveBindingPath } from './resolve-props.js';

// ─── shared helpers ─────────────────────────────────────────────────────────

interface ChildItem {
  key: string;
  component: ComponentInstance;
}

/** Outcome of an input's (pre-resolved) `checks` array. */
function checksOutcome(props: Record<string, unknown>): { ok: boolean; message: string | undefined } {
  const checks = props['checks'];
  if (!Array.isArray(checks) || checks.length === 0) return { ok: true, message: undefined };
  for (const rule of checks as Array<{ condition?: unknown; message?: string }>) {
    const condition = rule?.condition;
    // Unknown shapes pass rather than block the user, like upstream.
    const ok = typeof condition === 'boolean' ? condition : Boolean(condition ?? true);
    if (!ok) return { ok: false, message: rule?.message };
  }
  return { ok: true, message: undefined };
}

/**
 * Base for catalog components: injects the node context and exposes common
 * derived state. Containers get `childItems()`, which handles both explicit
 * child-id arrays and templated children (`{ path, componentId }`) — the
 * latter by bridging the bound data-model signal into an Angular signal so
 * item lists re-render when only the data changes (the counterpart of
 * upstream `useDataBinding` inside `Column`).
 */
@Directive()
abstract class A2uiCatalogBase {
  protected readonly ctx = inject(A2UI_NODE_CONTEXT);
  protected readonly destroyRef = inject(DestroyRef);
  protected readonly props = this.ctx.props;

  /** Bridge a data-model path into an Angular signal (cleaned up on destroy). */
  protected bindPath(path: string): Signal<unknown> {
    const sig = this.ctx.surface.store.getSignal(path);
    const out = signal<unknown>(sig.value);
    const off = sig.subscribe((v) => out.set(v));
    this.destroyRef.onDestroy(off);
    return out.asReadonly();
  }

  private templateData: Signal<unknown> | undefined;
  private templatePath: string | undefined;

  protected readonly childItems = computed<ChildItem[]>(() => {
    const props = this.props();
    const children = props['children'];
    const surface = this.ctx.surface;
    const dataContextPath = this.ctx.dataContextPath;
    if (Array.isArray(children)) {
      return (children as string[]).flatMap((childId) => {
        const child = surface.components.get(childId);
        if (!child) return [];
        const component = dataContextPath ? { ...child, dataContextPath } : child;
        return [{ key: childId, component }];
      });
    }
    // Templated children: expand the bound array against the template id.
    if (children && typeof children === 'object' && 'path' in children && 'componentId' in children) {
      const template = children as { path: string; componentId: string };
      const fullPath = resolveBindingPath(template.path, dataContextPath);
      if (!this.templateData || this.templatePath !== fullPath) {
        this.templatePath = fullPath;
        this.templateData = this.bindPath(fullPath);
      }
      const data = this.templateData();
      if (!Array.isArray(data)) return [];
      return data.flatMap((item, index) => {
        const child = surface.components.get(template.componentId);
        if (!child) return [];
        const key = item && typeof item === 'object' && 'key' in item
          ? String((item as Record<string, unknown>)['key'])
          : `${index}`;
        return [{ key, component: { ...child, dataContextPath: `${fullPath}/${index}` } }];
      });
    }
    return [];
  });

  protected weightOf(component: ComponentInstance): number | undefined {
    const weight = (component as Record<string, unknown>)['weight'];
    return typeof weight === 'number' && weight > 0 ? weight : undefined;
  }
}

// ─── components ─────────────────────────────────────────────────────────────

/** Styled text from a literal, data binding, or function call. */
@Component({
  selector: 'a2ui-text',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text [class]="className()">{{ text() }}</text>`,
})
export class A2uiText extends A2uiCatalogBase {
  protected readonly text = computed(() => {
    const value = this.props()['text'];
    return value === undefined || value === null ? '' : String(value);
  });
  protected readonly className = computed(() => {
    const variant = (this.props()['variant'] as string | undefined) ?? 'body';
    const emphasis = this.props()['emphasis'] as string | undefined;
    return `text-${variant}${emphasis ? ` text-emphasis-${emphasis}` : ''}`;
  });
}

/** Interactive button dispatching an A2UI event or function call. */
@Component({
  selector: 'a2ui-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiNode],
  template: `
    <view [class]="className()" style="padding:10px 16px;border-radius:8px;align-items:center" (tap)="onTap()">
      @if (childComponent(); as child) {
        <ng-container [a2uiNode]="child" [a2uiNodeSurface]="ctx.surface" />
      } @else {
        <text class="button-fallback">Button</text>
      }
    </view>
    @if (failureMessage(); as message) {
      <text class="button-error">{{ message }}</text>
    }
  `,
})
export class A2uiButton extends A2uiCatalogBase {
  protected readonly checks = computed(() => checksOutcome(this.props()));
  protected readonly enabled = computed(
    () => (this.props()['isValid'] as boolean | undefined ?? true) && this.checks().ok,
  );
  protected readonly failureMessage = computed(() =>
    this.checks().ok ? undefined : this.checks().message,
  );
  protected readonly className = computed(() => {
    const variant = (this.props()['variant'] as string | undefined) ?? 'primary';
    const isValid = this.props()['isValid'] as boolean | undefined ?? true;
    return `button button-${variant}${isValid ? '' : ' button-disabled'}${this.checks().ok ? '' : ' button-invalid'}`;
  });
  protected readonly childComponent = computed(() => {
    const childId = this.props()['child'] as string | undefined;
    if (!childId) return null;
    const child = this.ctx.surface.components.get(childId);
    if (!child) return null;
    return this.ctx.dataContextPath ? { ...child, dataContextPath: this.ctx.dataContextPath } : child;
  });

  protected onTap(): void {
    const action = this.props()['action'];
    if (this.enabled() && action && typeof action === 'object') {
      this.ctx.sendAction(action as Record<string, unknown>);
    }
  }
}

/** Child component ids in horizontal order. */
@Component({
  selector: 'a2ui-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiNode],
  template: `
    <view [class]="className()" style="display:flex;flex-direction:row">
      @for (item of childItems(); track item.key) {
        @if (weightOf(item.component); as weight) {
          <view [style]="'flex:' + weight + ' ' + weight + ' 0'">
            <ng-container [a2uiNode]="item.component" [a2uiNodeSurface]="ctx.surface" />
          </view>
        } @else {
          <ng-container [a2uiNode]="item.component" [a2uiNodeSurface]="ctx.surface" />
        }
      }
    </view>
  `,
})
export class A2uiRow extends A2uiCatalogBase {
  protected readonly className = computed(() => {
    const justify = (this.props()['justify'] as string | undefined) ?? 'start';
    const align = (this.props()['align'] as string | undefined) ?? 'stretch';
    return `row alignment-${align} distribution-${justify}`;
  });
}

/** Child component ids in vertical order. */
@Component({
  selector: 'a2ui-column',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiNode],
  template: `
    <view [class]="className()" style="display:flex;flex-direction:column">
      @for (item of childItems(); track item.key) {
        @if (weightOf(item.component); as weight) {
          <view [style]="'flex:' + weight + ' ' + weight + ' 0'">
            <ng-container [a2uiNode]="item.component" [a2uiNodeSurface]="ctx.surface" />
          </view>
        } @else {
          <ng-container [a2uiNode]="item.component" [a2uiNodeSurface]="ctx.surface" />
        }
      }
    </view>
  `,
})
export class A2uiColumn extends A2uiCatalogBase {
  protected readonly className = computed(() => {
    const justify = (this.props()['justify'] as string | undefined) ?? 'start';
    const align = (this.props()['align'] as string | undefined) ?? 'stretch';
    return `column alignment-${align} distribution-${justify}`;
  });
}

/** Card container around a single child. */
@Component({
  selector: 'a2ui-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiNode],
  template: `
    <view class="card" style="border-radius:12px;border:1px solid #e2e2e2;padding:12px">
      @if (childComponent(); as child) {
        <ng-container [a2uiNode]="child" [a2uiNodeSurface]="ctx.surface" />
      }
    </view>
  `,
})
export class A2uiCard extends A2uiCatalogBase {
  protected readonly childComponent = computed(() => {
    const childId = this.props()['child'] as string | undefined;
    if (!childId) return null;
    const child = this.ctx.surface.components.get(childId);
    if (!child) return null;
    return this.ctx.dataContextPath ? { ...child, dataContextPath: this.ctx.dataContextPath } : child;
  });
}

/** Horizontal or vertical rule. */
@Component({
  selector: 'a2ui-divider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view [class]="'divider divider-' + axis()" [style]="style()"></view>`,
})
export class A2uiDivider extends A2uiCatalogBase {
  protected readonly axis = computed(() => (this.props()['axis'] as string | undefined) ?? 'horizontal');
  protected readonly style = computed(() =>
    this.axis() === 'vertical'
      ? 'width:1px;align-self:stretch;background-color:#e2e2e2'
      : 'height:1px;width:100%;background-color:#e2e2e2',
  );
}

/** Image from a URL. */
@Component({
  selector: 'a2ui-image',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<image class="image" [src]="url()" [mode]="mode()" style="width:100%;min-height:100px"></image>`,
})
export class A2uiImage extends A2uiCatalogBase {
  protected readonly url = computed(() => String(this.props()['url'] ?? ''));
  protected readonly mode = computed(() => {
    // A2UI `fit` → Lynx image mode.
    const fit = (this.props()['fit'] as string | undefined) ?? 'fit';
    return fit === 'fill' ? 'scaleToFill' : fit === 'crop' ? 'aspectFill' : 'aspectFit';
  });
}

/** Scrollable list of children. */
@Component({
  selector: 'a2ui-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiNode],
  template: `
    <scroll-view
      [class]="'list list-' + direction()"
      [scroll-orientation]="direction()"
      style="flex:1"
    >
      @for (item of childItems(); track item.key) {
        <ng-container [a2uiNode]="item.component" [a2uiNodeSurface]="ctx.surface" />
      }
    </scroll-view>
  `,
})
export class A2uiList extends A2uiCatalogBase {
  protected readonly direction = computed(
    () => (this.props()['direction'] as string | undefined) ?? 'vertical',
  );
}

/** Loading placeholder. */
@Component({
  selector: 'a2ui-loading',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="loading" style="padding:12px;align-items:center">
      <text class="loading-label">Loading…</text>
    </view>
  `,
})
export class A2uiLoading extends A2uiCatalogBase {}

/** Single-line or multi-line text input bound to the data model. */
@Component({
  selector: 'a2ui-textfield',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="textfield" style="display:flex;flex-direction:column">
      @if (label(); as labelText) {
        <text class="textfield-label">{{ labelText }}</text>
      }
      @if (longText()) {
        <textarea
          class="textfield-control textfield-textarea"
          [value]="value()"
          (input)="onInput($event)"
        ></textarea>
      } @else {
        <input class="textfield-control" [value]="value()" (input)="onInput($event)" />
      }
      @if (invalidMessage(); as message) {
        <text class="textfield-error">{{ message }}</text>
      }
    </view>
  `,
})
export class A2uiTextField extends A2uiCatalogBase {
  private readonly touched = signal(false);

  protected readonly label = computed(() => {
    const label = this.props()['label'];
    return label === undefined || label === null ? '' : String(label);
  });
  protected readonly value = computed(() => {
    const value = this.props()['value'];
    return value === undefined || value === null ? '' : String(value);
  });
  protected readonly longText = computed(
    () => (this.props()['variant'] as string | undefined) === 'longText',
  );
  protected readonly invalidMessage = computed(() => {
    if (!this.touched()) return undefined;
    const pattern = this.props()['validationRegexp'] as string | undefined;
    if (!pattern) return undefined;
    try {
      return new RegExp(pattern).test(this.value()) ? undefined : 'Invalid value';
    } catch {
      return undefined;
    }
  });

  protected onInput(event: unknown): void {
    this.touched.set(true);
    const next = String(
      (event as { detail?: { value?: unknown } } | undefined)?.detail?.value ?? '',
    );
    this.ctx.setValue('value', next);
  }
}

/** Boolean checkbox bound to the data model. */
@Component({
  selector: 'a2ui-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="checkbox" style="display:flex;flex-direction:row;align-items:center" (tap)="toggle()">
      <view
        class="checkbox-box"
        style="width:18px;height:18px;border:1px solid #999;border-radius:4px;margin-right:8px;align-items:center;justify-content:center"
      >
        @if (checked()) {
          <text class="checkbox-mark">✓</text>
        }
      </view>
      <text class="checkbox-label">{{ label() }}</text>
    </view>
    @if (failureMessage(); as message) {
      <text class="checkbox-error">{{ message }}</text>
    }
  `,
})
export class A2uiCheckBox extends A2uiCatalogBase {
  protected readonly checked = computed(() => Boolean(this.props()['value']));
  protected readonly label = computed(() => String(this.props()['label'] ?? 'CheckBox'));
  protected readonly failureMessage = computed(() => checksOutcome(this.props()).message);

  protected toggle(): void {
    this.ctx.setValue('value', !this.checked());
  }
}

/** Numeric slider bound to the data model (tap-step fallback UI). */
@Component({
  selector: 'a2ui-slider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="slider" style="display:flex;flex-direction:row;align-items:center">
      @if (label(); as labelText) {
        <text class="slider-label" style="margin-right:8px">{{ labelText }}</text>
      }
      <view class="slider-decrement" style="padding:4px 10px" (tap)="step(-1)"><text>−</text></view>
      <text class="slider-value">{{ value() }}</text>
      <view class="slider-increment" style="padding:4px 10px" (tap)="step(1)"><text>+</text></view>
    </view>
  `,
})
export class A2uiSlider extends A2uiCatalogBase {
  protected readonly label = computed(() => {
    const label = this.props()['label'];
    return label === undefined || label === null ? '' : String(label);
  });
  protected readonly min = computed(() => Number(this.props()['minValue'] ?? this.props()['min'] ?? 0));
  protected readonly max = computed(() => Number(this.props()['maxValue'] ?? this.props()['max'] ?? 100));
  protected readonly stepSize = computed(() => Number(this.props()['step'] ?? 1));
  protected readonly value = computed(() => {
    const value = Number(this.props()['value'] ?? this.min());
    return Number.isFinite(value) ? value : this.min();
  });

  protected step(direction: -1 | 1): void {
    const next = Math.min(this.max(), Math.max(this.min(), this.value() + direction * this.stepSize()));
    this.ctx.setValue('value', next);
  }
}

/** Google Material icon ligature name from a possibly camelCase input. */
function toMaterialIconName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`) : '';
}

/** Named icon from the catalog's supported Material icon set. */
@Component({
  selector: 'a2ui-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text [class]="className()">{{ iconName() }}</text>`,
})
export class A2uiIcon extends A2uiCatalogBase {
  protected readonly iconName = computed(() => toMaterialIconName(this.props()['name']));
  protected readonly className = computed(() => {
    const size = (this.props()['size'] as string | undefined) ?? 'md';
    const color = (this.props()['color'] as string | undefined) ?? 'inherit';
    return `icon icon-${size} icon-color-${color}`;
  });
}

/** Single-choice radio group bound to the data model. */
@Component({
  selector: 'a2ui-radiogroup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view [class]="className()">
      @for (item of items(); track item) {
        <view class="radio-option" style="display:flex;flex-direction:row;align-items:center;margin-bottom:6px" (tap)="select(item)">
          <view
            class="radio-indicator"
            style="width:16px;height:16px;border-radius:8px;border:1px solid #999;margin-right:8px;align-items:center;justify-content:center"
          >
            @if (item === value()) {
              <view class="radio-dot-selected" style="width:8px;height:8px;border-radius:4px;background-color:#0057d9"></view>
            }
          </view>
          <text class="radio-option-label">{{ item }}</text>
        </view>
      }
      @if (failureMessage(); as message) {
        <text class="radio-group-error">{{ message }}</text>
      }
    </view>
  `,
})
export class A2uiRadioGroup extends A2uiCatalogBase {
  protected readonly items = computed(() => {
    const items = this.props()['items'];
    return Array.isArray(items) ? (items as string[]) : [];
  });
  protected readonly value = computed(() => this.props()['value'] as string | undefined);
  protected readonly usageHint = computed(() => (this.props()['usageHint'] as string | undefined) ?? 'default');
  protected readonly checks = computed(() => checksOutcome(this.props()));
  protected readonly className = computed(
    () => `radio-group radio-group-${this.usageHint()}${this.checks().ok ? '' : ' radio-group-invalid'}`,
  );
  protected readonly failureMessage = computed(() => this.checks().message);

  protected select(value: string): void {
    this.ctx.setValue('value', value);
  }
}

// ─── ChoicePicker helpers (ported from upstream's ChoicePicker/utils) ───────

interface ChoicePickerOption {
  label: string;
  value: string;
}

function normalizeChoicePickerLabel(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}
function normalizeChoicePickerVariant(value: unknown): 'multipleSelection' | 'mutuallyExclusive' {
  return value === 'multipleSelection' || value === 'multiSelect' ? 'multipleSelection' : 'mutuallyExclusive';
}
function normalizeChoicePickerOptions(value: unknown): ChoicePickerOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: ChoicePickerOption[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const optionValue = record['value'];
    if (typeof optionValue !== 'string' || seen.has(optionValue)) continue;
    seen.add(optionValue);
    options.push({ label: normalizeChoicePickerLabel(record['label']) || optionValue, value: optionValue });
  }
  return options;
}
function normalizeChoicePickerValue(value: unknown, options: ChoicePickerOption[]): string[] {
  const allowed = new Set(options.map((option) => option.value));
  const rawValues: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const item of rawValues) {
    if (typeof item !== 'string' || !allowed.has(item) || seen.has(item)) continue;
    seen.add(item);
    selected.push(item);
  }
  return selected;
}
function toggleChoicePickerValue(current: string[], optionValue: string, variant: string): string[] {
  if (variant === 'mutuallyExclusive') return [optionValue];
  return current.includes(optionValue) ? current.filter((v) => v !== optionValue) : [...current, optionValue];
}
function filterChoicePickerOptions(options: ChoicePickerOption[], query: string): ChoicePickerOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter(
    (option) => option.label.toLowerCase().includes(normalized) || option.value.toLowerCase().includes(normalized),
  );
}

/** Single- or multi-select choice picker, optionally filterable. */
@Component({
  selector: 'a2ui-choicepicker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view [class]="rootClassName()">
      @if (labelText(); as text) {
        <text class="choice-picker-label">{{ text }}</text>
      }
      @if (filterable()) {
        <input class="choice-picker-filter" [value]="query()" (input)="onQueryInput($event)" />
      }
      <view class="choice-picker-options">
        @for (option of visibleOptions(); track option.value) {
          <view class="choice-picker-option" style="display:flex;flex-direction:row;align-items:center;margin-bottom:6px" (tap)="onOptionTap(option.value)">
            <view class="choice-picker-indicator" [style]="indicatorStyle()">
              @if (isSelected(option.value)) {
                <text class="choice-picker-checkmark">✓</text>
              }
            </view>
            <text class="choice-picker-option-text">{{ option.label }}</text>
          </view>
        }
      </view>
      @if (failureMessage(); as message) {
        <text class="choice-picker-error">{{ message }}</text>
      }
    </view>
  `,
})
export class A2uiChoicePicker extends A2uiCatalogBase {
  protected readonly query = signal('');
  protected readonly variant = computed(() => normalizeChoicePickerVariant(this.props()['variant']));
  protected readonly options = computed(() => normalizeChoicePickerOptions(this.props()['options']));
  protected readonly selectedValues = computed(() => normalizeChoicePickerValue(this.props()['value'], this.options()));
  protected readonly visibleOptions = computed(() => filterChoicePickerOptions(this.options(), this.query()));
  protected readonly filterable = computed(() => this.props()['filterable'] === true);
  protected readonly labelText = computed(() => normalizeChoicePickerLabel(this.props()['label']) || undefined);
  protected readonly checks = computed(() => checksOutcome(this.props()));
  protected readonly failureMessage = computed(() => (this.checks().ok ? undefined : this.checks().message));
  protected readonly rootClassName = computed(
    () => `choice-picker choice-picker-${this.variant()}${this.checks().ok ? '' : ' choice-picker-invalid'}`,
  );
  protected readonly indicatorStyle = computed(() =>
    this.variant() === 'mutuallyExclusive'
      ? 'width:16px;height:16px;border-radius:8px;border:1px solid #999;margin-right:8px;align-items:center;justify-content:center'
      : 'width:16px;height:16px;border-radius:4px;border:1px solid #999;margin-right:8px;align-items:center;justify-content:center',
  );

  protected isSelected(value: string): boolean {
    return this.selectedValues().includes(value);
  }

  protected onOptionTap(value: string): void {
    const variant = this.variant();
    if (variant === 'mutuallyExclusive') {
      if (this.selectedValues()[0] === value) return;
      this.ctx.setValue('value', [value]);
      return;
    }
    this.ctx.setValue('value', toggleChoicePickerValue(this.selectedValues(), value, variant));
  }

  protected onQueryInput(event: unknown): void {
    this.query.set(String((event as { detail?: { value?: unknown } } | undefined)?.detail?.value ?? ''));
  }
}

/**
 * Trigger + content pair opening a dialog on tap. Simplification vs
 * upstream: the trigger is wrapped in a tap-to-open view (like upstream),
 * but without upstream's `suppressActionDispatch` — a trigger that itself
 * carries an action fires it in addition to opening the modal.
 */
@Component({
  selector: 'a2ui-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiNode],
  template: `
    <view class="modal-trigger" (tap)="open()">
      @if (triggerComponent(); as trigger) {
        <ng-container [a2uiNode]="trigger" [a2uiNodeSurface]="ctx.surface" />
      }
    </view>
    @if (isOpen()) {
      <view
        class="modal-backdrop"
        style="position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.4);align-items:center;justify-content:center"
        (tap.self)="close()"
      >
        <view class="modal-content" style="background-color:#fff;border-radius:12px;padding:16px;max-width:90%">
          @if (contentComponent(); as content) {
            <ng-container [a2uiNode]="content" [a2uiNodeSurface]="ctx.surface" />
          }
        </view>
      </view>
    }
  `,
})
export class A2uiModal extends A2uiCatalogBase {
  protected readonly isOpen = signal(false);
  protected readonly triggerComponent = computed(() => this.childById(this.props()['trigger'] as string | undefined));
  protected readonly contentComponent = computed(() => this.childById(this.props()['content'] as string | undefined));

  private childById(id: string | undefined): ComponentInstance | null {
    if (!id) return null;
    const child = this.ctx.surface.components.get(id);
    if (!child) return null;
    return this.ctx.dataContextPath ? { ...child, dataContextPath: this.ctx.dataContextPath } : child;
  }

  protected open(): void {
    this.isOpen.set(true);
  }

  protected close(): void {
    this.isOpen.set(false);
  }
}

interface A2uiTabItem {
  title: string;
  child: string;
}

/** Tabbed container whose tabs reference child component ids. */
@Component({
  selector: 'a2ui-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiNode],
  template: `
    <view class="tabs">
      <view class="tabs-headers" style="display:flex;flex-direction:row">
        @for (tab of tabs(); track $index) {
          <view [class]="'tabs-header' + (isActive($index) ? ' tabs-header-active' : '')" style="padding:8px 12px" (tap)="select($index)">
            <text class="tabs-header-text">{{ tab.title }}</text>
          </view>
        }
      </view>
      <view class="tabs-content">
        <!--
          @for + track (Angular's counterpart of upstream's key=childId on
          NodeRenderer) rather than @if: the active child switches between
          different sibling ids while staying non-null, and A2uiNode has no
          ngOnChanges — without a track-keyed remount here, switching tabs
          would leave the previous tab's content on screen (confirmed via the
          a2ui verify harness before this comment was added).
        -->
        @for (child of activeChildList(); track child.id) {
          <ng-container [a2uiNode]="child" [a2uiNodeSurface]="ctx.surface" />
        }
      </view>
    </view>
  `,
})
export class A2uiTabs extends A2uiCatalogBase {
  protected readonly activeIndex = signal(0);
  protected readonly tabs = computed(() => {
    const tabs = this.props()['tabs'];
    return Array.isArray(tabs) ? (tabs as A2uiTabItem[]) : [];
  });
  protected readonly activeChildList = computed<ComponentInstance[]>(() => {
    const tabs = this.tabs();
    if (tabs.length === 0) return [];
    const index = Math.min(this.activeIndex(), tabs.length - 1);
    const childId = tabs[index]?.child;
    if (!childId) return [];
    const child = this.ctx.surface.components.get(childId);
    if (!child) return [];
    return [this.ctx.dataContextPath ? { ...child, dataContextPath: this.ctx.dataContextPath } : child];
  });

  protected isActive(index: number): boolean {
    const tabs = this.tabs();
    return tabs.length > 0 && Math.min(this.activeIndex(), tabs.length - 1) === index;
  }

  protected select(index: number): void {
    this.activeIndex.set(index);
  }
}

const DATETIME_MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Local date and/or time picker (dialog with calendar grid + time steppers). */
@Component({
  selector: 'a2ui-datetimeinput',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="datetime-input">
      @if (labelText(); as text) {
        <text class="datetime-input-label">{{ text }}</text>
      }
      <view class="datetime-input-control" style="padding:8px;border:1px solid #ccc;border-radius:6px;display:flex;flex-direction:row;justify-content:space-between" (tap)="openDialog()">
        <text class="datetime-input-value">{{ displayValue() }}</text>
      </view>
      @if (invalidMessage(); as message) {
        <text class="datetime-input-error">{{ message }}</text>
      }
      @if (isOpen()) {
        <view
          class="datetime-dialog-backdrop"
          style="position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.4);align-items:center;justify-content:center"
          (tap.self)="cancel()"
        >
          <view class="datetime-dialog-content" style="background-color:#fff;border-radius:12px;padding:16px;max-width:90%">
            @if (mode().enableDate) {
              <view class="datetime-calendar">
                <view class="datetime-calendar-header" style="display:flex;flex-direction:row;justify-content:space-between;align-items:center">
                  <view (tap)="previousMonth()"><text>‹</text></view>
                  <text class="datetime-calendar-caption">{{ monthCaption() }}</text>
                  <view (tap)="nextMonth()"><text>›</text></view>
                </view>
                <view class="datetime-weekdays" style="display:flex;flex-direction:row">
                  @for (weekday of weekdayLabels(); track $index) {
                    <view class="datetime-weekday" style="flex:1 1 0;align-items:center"><text>{{ weekday }}</text></view>
                  }
                </view>
                <view class="datetime-month" style="display:flex;flex-direction:row;flex-wrap:wrap">
                  @for (day of monthDays(); track day.dateKey) {
                    <view [class]="dayClassName(day)" style="width:14.28%;align-items:center;padding:4px" (tap)="selectDay(day)">
                      <text class="datetime-day-text">{{ day.day }}</text>
                    </view>
                  }
                </view>
              </view>
            }
            @if (mode().enableTime) {
              <view class="datetime-time" style="display:flex;flex-direction:row;align-items:center;justify-content:center;margin-top:8px">
                <view (tap)="stepHour(1)"><text>▲</text></view>
                <text class="datetime-time-value">{{ hourText() }}</text>
                <view (tap)="stepHour(-1)"><text>▼</text></view>
                <text class="datetime-time-separator">:</text>
                <view (tap)="stepMinute(1)"><text>▲</text></view>
                <text class="datetime-time-value">{{ minuteText() }}</text>
                <view (tap)="stepMinute(-1)"><text>▼</text></view>
              </view>
            }
            @if (draftOutOfRange()) {
              <text class="datetime-dialog-error">Date is out of range</text>
            }
            <view class="datetime-dialog-actions" style="display:flex;flex-direction:row;justify-content:flex-end;margin-top:12px">
              <view class="datetime-dialog-button" style="padding:8px 12px" (tap)="cancel()"><text>Cancel</text></view>
              <view class="datetime-dialog-button datetime-dialog-button-primary" style="padding:8px 12px" (tap)="confirm()"><text>Done</text></view>
            </view>
          </view>
        </view>
      }
    </view>
  `,
})
export class A2uiDateTimeInput extends A2uiCatalogBase {
  protected readonly isOpen = signal(false);
  protected readonly draftParts = signal(getDefaultDateTimeParts());
  protected readonly visibleMonth = signal(startOfMonth(new Date()));

  protected readonly labelText = computed(() => normalizeDateTimeInputLabel(this.props()['label']) || undefined);
  protected readonly mode = computed(() => normalizeDateTimeInputMode(this.props()['enableDate'], this.props()['enableTime']));
  protected readonly valueParts = computed(() => normalizeDateTimeInputValue(this.props()['value']));
  protected readonly minParts = computed(() => normalizeDateTimeInputValue(this.props()['min']));
  protected readonly maxParts = computed(() => normalizeDateTimeInputValue(this.props()['max']));
  protected readonly outputFormat = computed(() => this.props()['outputFormat']);
  protected readonly checks = computed(() => checksOutcome(this.props()));

  protected readonly currentOutOfRange = computed(() => {
    const value = this.valueParts();
    return value ? isDateTimeBeforeMin(value, this.minParts()) || isDateTimeAfterMax(value, this.maxParts()) : false;
  });
  protected readonly invalidMessage = computed(() => {
    if (!this.checks().ok) return this.checks().message;
    return this.currentOutOfRange() ? 'Date is out of range' : undefined;
  });
  protected readonly displayValue = computed(() => {
    const value = this.valueParts();
    return value ? formatDateTimeInputValue(value, this.outputFormat(), this.mode()) : getDateTimeInputPlaceholder(this.mode());
  });
  protected readonly monthCaption = computed(() => {
    const month = this.visibleMonth();
    return `${DATETIME_MONTH_LABELS[month.getMonth()]} ${month.getFullYear()}`;
  });
  protected readonly weekdayLabels = computed(() => getWeekdayLabels());
  protected readonly monthDays = computed(() => {
    const min = this.minParts();
    const max = this.maxParts();
    return buildDateTimeMonthPage({
      month: this.visibleMonth(),
      selectedDate: dateTimePartsToDate(this.draftParts()),
      today: new Date(),
      minDate: min ? dateTimePartsToDate(min) : null,
      maxDate: max ? dateTimePartsToDate(max) : null,
    }).days;
  });
  protected readonly draftOutOfRange = computed(() => {
    const draft = this.draftParts();
    return isDateTimeBeforeMin(draft, this.minParts()) || isDateTimeAfterMax(draft, this.maxParts());
  });
  protected readonly hourText = computed(() => String(this.draftParts().hour).padStart(2, '0'));
  protected readonly minuteText = computed(() => String(this.draftParts().minute).padStart(2, '0'));

  protected openDialog(): void {
    const initial = this.valueParts() ?? getDefaultDateTimeParts();
    this.draftParts.set(initial);
    this.visibleMonth.set(startOfMonth(dateTimePartsToDate(initial)));
    this.isOpen.set(true);
  }

  protected cancel(): void {
    this.isOpen.set(false);
  }

  protected confirm(): void {
    if (this.draftOutOfRange()) return;
    this.ctx.setValue('value', formatDateTimeInputValue(this.draftParts(), this.outputFormat(), this.mode()));
    this.isOpen.set(false);
  }

  protected previousMonth(): void {
    this.visibleMonth.update((m) => addMonths(m, -1));
  }

  protected nextMonth(): void {
    this.visibleMonth.update((m) => addMonths(m, 1));
  }

  protected selectDay(day: MonthDay): void {
    if (day.disabled) return;
    this.draftParts.update((parts) => withDate(parts, day.date));
    if (day.outside) this.visibleMonth.set(startOfMonth(day.date));
  }

  protected stepHour(delta: number): void {
    this.draftParts.update((parts) => incrementDateTimePart(parts, 'hour', delta));
  }

  protected stepMinute(delta: number): void {
    this.draftParts.update((parts) => incrementDateTimePart(parts, 'minute', delta));
  }

  protected dayClassName(day: MonthDay): string {
    return [
      'datetime-day',
      day.outside ? 'datetime-day-outside' : '',
      day.selected ? 'datetime-day-selected' : '',
      day.today ? 'datetime-day-today' : '',
      day.disabled ? 'datetime-day-disabled' : '',
    ].filter(Boolean).join(' ');
  }
}

/** One or more numeric line series rendered via a native `<svg>` element. */
@Component({
  selector: 'a2ui-linechart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="line-chart">
      <view class="line-chart-header">
        <text class="line-chart-title">{{ yLabel() }}</text>
        <text class="line-chart-caption">{{ caption() }}</text>
      </view>
      <svg class="line-chart-svg" [content]="svgMarkup()" [style]="'width:100%;height:' + height() + 'px'"></svg>
      <view class="line-chart-axis-row" style="display:flex;flex-direction:row;justify-content:space-between">
        @for (index of visibleLabelIndices(); track index) {
          <text class="line-chart-axis-tick-label">{{ labels()[index] ?? '' }}</text>
        }
      </view>
      @if (showLegend()) {
        <view class="line-chart-legend" style="display:flex;flex-direction:row;flex-wrap:wrap">
          @for (item of series(); track item.name) {
            <view class="line-chart-legend-item" style="display:flex;flex-direction:row;align-items:center;margin-right:8px">
              <view [style]="'width:8px;height:8px;border-radius:4px;background-color:' + item.color"></view>
              <text class="line-chart-legend-label">{{ item.name }}</text>
            </view>
          }
        </view>
      }
    </view>
  `,
})
export class A2uiLineChart extends A2uiCatalogBase {
  protected readonly labels = computed(() => {
    const labels = this.props()['labels'];
    return Array.isArray(labels) ? (labels as string[]) : [];
  });
  protected readonly series = computed(() => {
    const raw = this.props()['series'];
    return Array.isArray(raw) ? normalizeSeries(raw as ChartSeries[], DEFAULT_CHART_COLORS) : [];
  });
  protected readonly variant = computed(() => (this.props()['variant'] as string | undefined) ?? 'natural');
  protected readonly showGrid = computed(() => this.props()['showGrid'] !== false);
  protected readonly showLegend = computed(() => this.props()['showLegend'] !== false);
  protected readonly height = computed(() => {
    const height = this.props()['height'];
    return typeof height === 'number' ? height : 240;
  });
  protected readonly yLabel = computed(() => String(this.props()['yLabel'] ?? 'Line chart'));
  protected readonly caption = computed(() => {
    const series = this.series();
    return series.length > 0 ? `${series.length} series • ${this.labels().length} points` : 'No data';
  });
  protected readonly svgMarkup = computed(() =>
    buildLineChartSvg(this.labels(), this.series(), this.variant(), this.showGrid(), this.height()),
  );
  protected readonly visibleLabelIndices = computed(() => sampleIndices(this.labels().length, 8));
}

/** Numeric slices rendered as a pie or donut chart via a native `<svg>` element. */
@Component({
  selector: 'a2ui-piechart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="pie-chart">
      <view class="pie-chart-header">
        <text class="pie-chart-title">{{ title() }}</text>
        <text class="pie-chart-caption">{{ subtitle() }}</text>
      </view>
      <svg class="pie-chart-svg" [content]="svgMarkup()" [style]="'width:100%;height:' + height() + 'px'"></svg>
      @if (showLegend()) {
        <view class="pie-chart-legend">
          @for (slice of legendItems(); track slice.name) {
            <view class="pie-chart-legend-item" style="display:flex;flex-direction:row;align-items:center;margin-bottom:4px">
              <view [style]="'width:8px;height:8px;border-radius:4px;background-color:' + slice.color"></view>
              <text>{{ slice.name }}: {{ slice.text }}</text>
            </view>
          }
        </view>
      }
    </view>
  `,
})
export class A2uiPieChart extends A2uiCatalogBase {
  protected readonly slices = computed(() => {
    const data = this.props()['data'];
    return Array.isArray(data) ? (data as PieSlice[]) : [];
  });
  protected readonly variant = computed(() => (this.props()['variant'] as string | undefined) ?? 'pie');
  protected readonly title = computed(() => String(this.props()['title'] ?? 'Pie chart'));
  protected readonly total = computed(() => this.slices().reduce((sum, s) => sum + Math.max(0, Number(s.value) || 0), 0));
  protected readonly subtitle = computed(() => {
    const explicit = this.props()['subtitle'];
    if (typeof explicit === 'string') return explicit;
    const slices = this.slices();
    return slices.length > 0 ? `${slices.length} slices • ${formatValue(this.total())} total` : 'No data';
  });
  protected readonly showLegend = computed(() => this.props()['showLegend'] !== false);
  protected readonly showPercentages = computed(() => this.props()['showPercentages'] !== false);
  protected readonly height = computed(() => {
    const height = this.props()['height'];
    return typeof height === 'number' ? height : 220;
  });
  protected readonly paddingAngle = computed(() => {
    const padding = this.props()['paddingAngle'];
    return typeof padding === 'number' ? padding : 2;
  });
  protected readonly palette = computed(() => {
    const colors = this.props()['colors'];
    return Array.isArray(colors) ? (colors as string[]) : DEFAULT_CHART_COLORS;
  });
  protected readonly svgMarkup = computed(() => buildPieChartSvg(this.slices(), this.variant(), this.paddingAngle(), this.palette()));
  protected readonly legendItems = computed(() => {
    const total = this.total();
    const palette = this.palette();
    return this.slices().map((slice, index) => {
      const value = Math.max(0, Number(slice.value) || 0);
      const percent = total > 0 ? (value / total) * 100 : 0;
      const color = slice.color ?? palette[index % palette.length] ?? DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length] ?? DEFAULT_CHART_COLORS[0];
      const text = this.showPercentages() ? `${formatValue(value)} (${formatPercent(percent)})` : formatValue(value);
      return { name: slice.name, color, text };
    });
  });
}

// ─── the catalog ────────────────────────────────────────────────────────────

/**
 * The Angular basic catalog — spread into `defineA2uiCatalog` alongside
 * `basicFunctions` from `@lynx-js/genui/a2ui/functions`:
 *
 * ```ts
 * import { basicFunctions } from '@lynx-js/genui/a2ui/functions';
 * const catalog = defineA2uiCatalog([...A2UI_BASIC_CATALOG, ...basicFunctions]);
 * ```
 */
export const A2UI_BASIC_CATALOG: readonly A2uiCatalogInput[] = [
  { name: 'Text', component: A2uiText },
  { name: 'Button', component: A2uiButton },
  { name: 'Row', component: A2uiRow },
  { name: 'Column', component: A2uiColumn },
  { name: 'Card', component: A2uiCard },
  { name: 'Divider', component: A2uiDivider },
  { name: 'Image', component: A2uiImage },
  { name: 'List', component: A2uiList },
  { name: 'Loading', component: A2uiLoading },
  { name: 'TextField', component: A2uiTextField },
  { name: 'CheckBox', component: A2uiCheckBox },
  { name: 'Slider', component: A2uiSlider },
  { name: 'Icon', component: A2uiIcon },
  { name: 'RadioGroup', component: A2uiRadioGroup },
  { name: 'ChoicePicker', component: A2uiChoicePicker },
  { name: 'Modal', component: A2uiModal },
  { name: 'Tabs', component: A2uiTabs },
  { name: 'DateTimeInput', component: A2uiDateTimeInput },
  { name: 'LineChart', component: A2uiLineChart },
  { name: 'PieChart', component: A2uiPieChart },
];
