// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Angular ports of the OpenUI built-in component library.
 *
 * Component *definitions* reuse lang-core's `defineComponent`/`createLibrary`
 * directly — they are generic over the renderer type, so an Angular
 * component class rides in the `component` slot where upstream puts a
 * ReactLynx function. Prop schemas mirror the upstream catalog
 * (`@lynx-js/genui/openui`'s built-ins) so prompts and parsing behave the
 * same; renderers output angular-lynx elements with the upstream class
 * names (`OpenUIText`, `OpenUIButton`, …) for restyling.
 *
 * Full catalog (27 of 27 renderable components, genui 0.7.2), in upstream's
 * order: Stack, Row, Column, List, Card, CardHeader, Text, TextContent,
 * Separator, Divider, Button, Buttons, Tag, Image, Canvas, Icon, Video,
 * AudioPlayer, Loading, Tabs, Modal, CheckBox, RadioGroup, ChoicePicker,
 * Slider, TextField, DateTimeInput. `verify:genui-openui-parity` checks the
 * library's whole generated prompt against upstream's prompt library — a
 * model prompted by `buildOpenUiSystemPrompt` maps its positional arguments
 * onto *these* schemas, so any drift is a silent mis-render. `Canvas`
 * renders upstream's non-Web fallback on every host (see
 * `OpenuiCanvasComponent`). `Video`/
 * `AudioPlayer` are placeholder attachment cards, matching upstream exactly
 * (upstream's own OpenUI catalog never wires these to a real player either —
 * see `OpenuiVideoComponent`'s doc). `Action` isn't a catalog component
 * upstream either — it's the `actionPropSchema` shape already covered by
 * this file's own `actionSchema`. Extend via
 * `createOpenUiLibrary({ components: [...] })`. See docs/28-genui.md.
 *
 * Upstream's OpenUI `ChoicePicker` and `DateTimeInput` are display/local-only
 * (no external write-back, no calendar dialog) — this port matches that
 * exactly rather than adding the richer interaction the *a2ui* versions of
 * these components have (see `basic-catalog.ts`); the two protocols made
 * different design choices here upstream, not this port.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  NO_ERRORS_SCHEMA,
  signal,
  Type,
  untracked,
  ViewChild,
} from '@angular/core';

import type { ActionPlan, ComponentGroup, DefinedComponent, Library } from '@openuidev/lang-core';
import { createLibrary, defineComponent, tagSchemaId } from '@openuidev/lang-core';
import { z } from 'zod/v4';

import { writeInputValue } from '../../input-value.js';
import type { ShadowElement } from '../../shadow-element.js';
import { registerOpenUiBuiltins } from './builtins.js';
import { OPENUI_NODE_CONTEXT, OPENUI_RENDERER_CONTEXT } from './context.js';
import { OpenuiNode } from './node.directive.js';
import type { OpenUiLegacyAction } from './state.js';

// ─── shared schemas ─────────────────────────────────────────────────────────
//
// These mirror `@lynx-js/genui/openui/prompt`'s headless library — the one
// `buildOpenUiSystemPrompt` teaches the model from — down to the schema-id
// tags, because the tags are what the prompt prints (`StringLike`,
// `BooleanLike`, …). `verify:genui-openui-parity` fails if any component's
// generated signature stops matching upstream's.

const pathBindingSchema = z.object({ path: z.string() });
tagSchemaId(pathBindingSchema, 'PathBinding');

const stringLike = z.union([z.string(), z.number(), z.boolean(), pathBindingSchema]);
tagSchemaId(stringLike, 'StringLike');

const booleanLike = z.union([z.boolean(), pathBindingSchema]);
tagSchemaId(booleanLike, 'BooleanLike');

const templateChildrenSchema = z.object({ componentId: z.string(), path: z.string() });
tagSchemaId(templateChildrenSchema, 'TemplateChildren');

const listChildrenSchema = z.union([z.array(z.any()), templateChildrenSchema]);

const GAP_VALUES = ['none', 'xxs', 'xs', 's', 'm', 'l', 'xl', '2xl'] as const;
const ALIGN_VALUES = ['start', 'center', 'end', 'stretch'] as const;
const STACK_JUSTIFY_VALUES = ['start', 'center', 'end', 'between'] as const;
const EXTENDED_JUSTIFY_VALUES = [
  'start', 'center', 'end', 'between', 'around', 'evenly',
  'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch',
] as const;
const TEXT_VARIANTS = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'] as const;
const ICON_NAMES = [
  'account_circle', 'add', 'arrow_back', 'arrow_forward', 'camera', 'check', 'close', 'delete',
  'edit', 'error', 'favorite', 'help', 'home', 'info', 'location_on', 'lock', 'mail', 'menu',
  'more_vert', 'pause', 'person', 'play_arrow', 'refresh', 'search', 'send', 'settings', 'share',
  'star', 'warning',
] as const;

/**
 * Display text for a `StringLike` prop. A `{ path }` binding only means
 * something to a host that supplies template data (upstream's renderers
 * don't resolve it either), so it renders as empty rather than
 * `[object Object]`.
 */
function toText(value: unknown): string {
  if (value === undefined || value === null || typeof value === 'object') return '';
  return String(value);
}

// Same tagged schema as the upstream catalog's `actionPropSchema`: the
// 'ActionExpression' tag is what makes the parser turn `Action([@ToAssistant
// ("…")])` expressions into ActionPlan values for this prop.
const actionSchema = z.union([
  z.object({ steps: z.array(z.looseObject({ type: z.string() })) }),
  z.object({
    type: z.string().optional(),
    params: z.record(z.string(), z.any()).optional(),
    url: z.string().optional(),
    context: z.string().optional(),
  }),
]);
tagSchemaId(actionSchema, 'ActionExpression');

/** Shared base: node + renderer context, children as a reactive list. */
@Directive()
abstract class OpenuiBase {
  protected readonly ctx = inject(OPENUI_NODE_CONTEXT);
  protected readonly renderer = inject(OPENUI_RENDERER_CONTEXT);
  protected readonly props = this.ctx.props;

  protected readonly children = computed<unknown[]>(() => {
    const children = this.props()['children'];
    if (Array.isArray(children)) return children;
    return children === undefined || children === null ? [] : [children];
  });

  protected trigger(label: string, action: unknown): void {
    this.renderer.state.triggerAction(
      label,
      this.renderer.formName,
      action as ActionPlan | OpenUiLegacyAction | undefined,
    );
  }

  /**
   * Port of upstream's `useSetDefaultValue`: once streaming has finished, a
   * named input whose field is still empty gets its `value` prop written into
   * form state — so a pre-filled input the user never touches still submits
   * its value with the next action. Call from a subclass constructor.
   *
   * "Empty" deliberately includes `null`, not just `undefined` as upstream's
   * hook has it: a `$variable` the model never declared is auto-created as
   * `null`, and without this a pre-filled `TextField(…, "45", …, "$age")`
   * would *show* 45 but submit `null`. Upstream papers over that with a second
   * effect in TextField/Slider that writes the prop into the field on every
   * change while the control is untouched — but that effect also clobbers a
   * value restored through `initialState`, which `verify:genui-openui-runtime`
   * guards and the planner example relies on (it pre-fills forms with answers
   * the user already gave). One rule instead: fill empty fields, never
   * overwrite a set one, so what a control displays is what it submits.
   */
  protected persistDefaultValue(componentType: string, name: () => string, value: () => unknown): void {
    effect(() => {
      const field = name();
      const defaultValue = value();
      if (this.renderer.isStreaming() || !field || defaultValue === undefined || defaultValue === null) return;
      untracked(() => {
        const existing = this.renderer.state.getFieldValue(this.renderer.formName, field);
        if (existing === undefined || existing === null) {
          this.renderer.state.setFieldValue(this.renderer.formName, componentType, field, defaultValue);
        }
      });
    });
  }
}

// ─── layout ─────────────────────────────────────────────────────────────────

// NOTE: property order matters — the parser maps *positional* arguments in
// generated code (`Stack([a, b], "column", ...)`) to props in schema order,
// so these mirror the upstream catalog's field order exactly. Row and Column
// do NOT share this tail: upstream orders theirs `justify, align, gap(, wrap)`.
const stackLayoutTail = {
  wrap: z.boolean().optional(),
  gap: z.enum(GAP_VALUES).optional(),
  align: z.enum(ALIGN_VALUES).optional(),
  justify: z.enum(STACK_JUSTIFY_VALUES).optional(),
};

const GAPS: Record<string, string> = {
  none: '0px', xxs: '1px', xs: '2px', s: '4px', m: '8px', l: '16px', xl: '24px', '2xl': '32px',
};

const JUSTIFY_CSS: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  spaceBetween: 'space-between',
  around: 'space-around',
  spaceAround: 'space-around',
  evenly: 'space-evenly',
  spaceEvenly: 'space-evenly',
  // `justify-content: stretch` behaves as flex-start in a flex container.
  stretch: 'flex-start',
};

const ALIGN_CSS: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

@Component({
  selector: 'openui-stack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiNode],
  template: `
    <view class="OpenUIStack" [style]="style()">
      @for (child of children(); track $index) {
        <ng-container [openuiNode]="child" />
      }
    </view>
  `,
})
export class OpenuiStackComponent extends OpenuiBase {
  /** Default flex direction; Row/Column subclasses pin it. */
  protected defaultDirection: 'row' | 'column' = 'column';
  /** Default cross-axis alignment — upstream's Row centers, everything else stretches. */
  protected defaultAlign = 'stretch';

  protected readonly style = computed(() => {
    const props = this.props();
    const direction = (props['direction'] as string | undefined) ?? this.defaultDirection;
    const gap = GAPS[(props['gap'] as string | undefined) ?? 'm'] ?? '8px';
    const align = ALIGN_CSS[(props['align'] as string | undefined) ?? this.defaultAlign] ?? 'stretch';
    const justify = JUSTIFY_CSS[(props['justify'] as string | undefined) ?? 'start'] ?? 'flex-start';
    const wrap = props['wrap'] === true ? 'flex-wrap:wrap;' : '';
    return `display:flex;flex-direction:${direction};gap:${gap};align-items:${align};justify-content:${justify};${wrap}`;
  });
}

@Component({
  selector: 'openui-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiNode],
  template: `
    <view class="OpenUIRow" [style]="style()">
      @for (child of children(); track $index) {
        <ng-container [openuiNode]="child" />
      }
    </view>
  `,
})
export class OpenuiRowComponent extends OpenuiStackComponent {
  protected override defaultDirection: 'row' | 'column' = 'row';
  protected override defaultAlign = 'center';
}

/** Button group — upstream names the prop `buttons`, not `children`. */
@Component({
  selector: 'openui-buttons',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiNode],
  template: `
    <view class="OpenUIButtonGroup" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;align-items:center">
      @for (child of children(); track $index) {
        <ng-container [openuiNode]="child" />
      }
    </view>
  `,
})
export class OpenuiButtonsComponent extends OpenuiBase {
  protected override readonly children = computed<unknown[]>(() => {
    const buttons = this.props()['buttons'];
    if (Array.isArray(buttons)) return buttons;
    return buttons === undefined || buttons === null ? [] : [buttons];
  });
}

@Component({
  selector: 'openui-column',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiNode],
  template: `
    <view class="OpenUIColumn" [style]="style()">
      @for (child of children(); track $index) {
        <ng-container [openuiNode]="child" />
      }
    </view>
  `,
})
export class OpenuiColumnComponent extends OpenuiStackComponent {}

@Component({
  selector: 'openui-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiNode],
  template: `
    <view [class]="className()" [style]="style()">
      @for (child of children(); track $index) {
        <ng-container [openuiNode]="child" />
      }
    </view>
  `,
})
export class OpenuiCardComponent extends OpenuiStackComponent {
  protected readonly className = computed(() => {
    const variant = (this.props()['variant'] as string | undefined) ?? 'card';
    return `OpenUICard OpenUICard-${variant}`;
  });
  protected readonly cardStyle = 'border-radius:12px;border:1px solid #e2e2e2;padding:12px;';
  protected override readonly style = computed(
    () =>
      `${this.cardStyle}display:flex;flex-direction:${(this.props()['direction'] as string | undefined) ?? 'column'};gap:${GAPS[(this.props()['gap'] as string | undefined) ?? 'm'] ?? '8px'}`,
  );
}

// ─── content ────────────────────────────────────────────────────────────────

@Component({
  selector: 'openui-card-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="OpenUICardHeader">
      <text class="OpenUICardHeaderTitle" style="font-weight:bold">{{ title() }}</text>
      @if (subtitle(); as sub) {
        <text class="OpenUICardHeaderSubtitle">{{ sub }}</text>
      }
    </view>
  `,
})
export class OpenuiCardHeaderComponent extends OpenuiBase {
  protected readonly title = computed(() => String(this.props()['title'] ?? ''));
  protected readonly subtitle = computed(() => {
    const value = this.props()['subtitle'];
    return value === undefined || value === null ? undefined : String(value);
  });
}

@Component({
  selector: 'openui-text',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text [class]="'OpenUIText OpenUIText-' + variant()">{{ text() }}</text>`,
})
export class OpenuiTextComponent extends OpenuiBase {
  protected readonly text = computed(() => toText(this.props()['text']));
  protected readonly variant = computed(() => (this.props()['variant'] as string | undefined) ?? 'body');
}

const TEXT_CONTENT_SIZE_CLASS: Record<string, string> = {
  default: 'OpenUITextContentDefault',
  small: 'OpenUITextContentSmall',
  large: 'OpenUITextContentLarge',
  'small-heavy': 'OpenUITextContentSmallHeavy',
  'large-heavy': 'OpenUITextContentLargeHeavy',
};

@Component({
  selector: 'openui-text-content',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text [class]="className()">{{ text() }}</text>`,
})
export class OpenuiTextContentComponent extends OpenuiBase {
  protected readonly text = computed(() => toText(this.props()['text']));
  protected readonly className = computed(() => {
    const size = (this.props()['size'] as string | undefined) ?? 'default';
    return `OpenUITextContent ${TEXT_CONTENT_SIZE_CLASS[size] ?? TEXT_CONTENT_SIZE_CLASS['default']}`;
  });
}

@Component({
  selector: 'openui-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="OpenUITag" style="border-radius:10px;background-color:#eee;padding:2px 8px;align-self:flex-start">
      <text class="OpenUITagText" style="font-size:12px">{{ text() }}</text>
    </view>
  `,
})
export class OpenuiTagComponent extends OpenuiBase {
  protected readonly text = computed(() => String(this.props()['text'] ?? ''));
}

@Component({
  selector: 'openui-divider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view [class]="'OpenUIDivider OpenUIDivider' + axis()" [style]="style()"></view>`,
})
export class OpenuiDividerComponent extends OpenuiBase {
  protected readonly axis = computed(() =>
    this.props()['axis'] === 'vertical' ? 'Vertical' : 'Horizontal',
  );
  protected readonly style = computed(() =>
    this.axis() === 'Vertical'
      ? 'width:1px;align-self:stretch;background-color:#e2e2e2'
      : 'height:1px;width:100%;background-color:#e2e2e2',
  );
}

@Component({
  selector: 'openui-image',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<image [class]="className()" [src]="url()" [mode]="mode()" style="width:100%;min-height:100px"></image>`,
})
export class OpenuiImageComponent extends OpenuiBase {
  protected readonly url = computed(() => toText(this.props()['url']));
  protected readonly className = computed(() => {
    const variant = (this.props()['variant'] as string | undefined) ?? 'mediumFeature';
    return `OpenUIImage OpenUIImageVariant${variant.charAt(0).toUpperCase()}${variant.slice(1)}`;
  });
  protected readonly mode = computed(() => {
    const fit = (this.props()['fit'] as string | undefined) ?? 'contain';
    return fit === 'fill' ? 'scaleToFill' : fit === 'cover' ? 'aspectFill' : 'aspectFit';
  });
}

/**
 * Canvas (genui 0.7) — upstream's non-Web fallback, on every host. Upstream
 * draws only on Web: its ReactLynx component `eval`s the model's `code`
 * chunks on the main thread against a DOM `<canvas>`. On iOS and Android it
 * renders this same message, and the schema's description tells the model
 * so. This port doesn't draw on Web either, because running model-written
 * JavaScript is something an app should opt into, not something a component
 * library turns on. To draw, pass your own `Canvas` definition through
 * `createOpenUiLibrary({ components })` (a same-named component replaces the
 * built-in). To keep the model from choosing it, build the prompt with
 * `componentNames`.
 */
@Component({
  selector: 'openui-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="OpenUICanvas" style="flex-direction:column;width:100%;overflow:hidden;border-radius:12px">
      <text>Canvas is not supported on this platform.</text>
    </view>
  `,
})
export class OpenuiCanvasComponent extends OpenuiBase {}

// ─── interactive ────────────────────────────────────────────────────────────

@Component({
  selector: 'openui-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view
      [class]="className()"
      style="padding:10px 16px;border-radius:8px;align-items:center;align-self:flex-start"
      (tap)="onTap()"
    >
      <text class="OpenUIButtonText">{{ label() }}</text>
    </view>
  `,
})
export class OpenuiButtonComponent extends OpenuiBase {
  protected readonly label = computed(() => String(this.props()['label'] ?? ''));
  protected readonly className = computed(() => {
    const props = this.props();
    const variant = (props['variant'] as string | undefined) ?? 'primary';
    const map: Record<string, string> = {
      primary: 'OpenUIButtonPrimary',
      secondary: 'OpenUIButtonSecondary',
      tertiary: 'OpenUIButtonGhost',
    };
    // `type`/`size` are theme hooks only (upstream hands them to lynx-ui's
    // Button); the class names follow the port's `OpenUI<Component><Modifier>`
    // convention so an app can style them.
    const destructive = props['type'] === 'destructive' ? ' OpenUIButtonDestructive' : '';
    const size = typeof props['size'] === 'string' ? ` OpenUIButtonSize-${props['size']}` : '';
    return `OpenUIButton ${map[variant] ?? 'OpenUIButtonPrimary'}${destructive}${size}`;
  });

  protected onTap(): void {
    // Upstream omits the tap binding entirely while streaming; gating the
    // handler has the same effect without re-creating the element.
    if (this.renderer.isStreaming()) return;
    this.trigger(this.label(), this.props()['action']);
  }
}

@Component({
  selector: 'openui-textfield',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view [class]="rootClassName()" style="display:flex;flex-direction:column">
      @if (label(); as labelText) {
        <text class="OpenUITextFieldLabel">{{ labelText }}</text>
      }
      @if (variant() === 'longText') {
        <textarea
          #control
          class="OpenUITextFieldControl OpenUITextFieldTextarea"
          [value]="value()"
          maxlines="6"
          (input)="onInput($event)"
        ></textarea>
      } @else {
        <input
          #control
          class="OpenUITextFieldControl"
          [value]="value()"
          [type]="inputType()"
          confirm-type="done"
          (input)="onInput($event)"
        />
      }
      @if (showInvalid()) {
        <text class="OpenUITextFieldError">Invalid value</text>
      }
    </view>
  `,
})
export class OpenuiTextFieldComponent extends OpenuiBase {
  // `@ViewChild` (decorator), not `viewChild()`: the JIT harnesses don't wire
  // the signal-query initializers (docs/10-element-queries.md).
  @ViewChild('control', { read: ElementRef }) private controlRef?: ElementRef<ShadowElement>;
  /** The last text the user typed — the element already shows it. */
  private lastTyped: string | undefined;
  protected readonly label = computed(() => toText(this.props()['label']));
  private readonly fieldName = computed(() => String(this.props()['name'] ?? ''));
  protected readonly variant = computed(() => {
    const variant = this.props()['variant'];
    return variant === 'longText' || variant === 'number' || variant === 'obscured' ? variant : 'shortText';
  });
  protected readonly inputType = computed(() =>
    this.variant() === 'number' ? 'number' : this.variant() === 'obscured' ? 'password' : 'text',
  );
  /** The prop as a string — upstream's `normalizeValue` (numbers/booleans stringify, objects blank). */
  private readonly propValue = computed(() => {
    const value = this.props()['value'];
    return value === undefined ? undefined : toText(value);
  });
  protected readonly value = computed(() => {
    const name = this.fieldName();
    const fromState = name
      ? this.renderer.state.getFieldValue(this.renderer.formName, name)
      : undefined;
    const value = fromState ?? this.propValue();
    return value === undefined || value === null ? '' : String(value);
  });
  protected readonly showInvalid = computed(() => {
    const value = this.value();
    const pattern = this.props()['validationRegexp'];
    if (!value || typeof pattern !== 'string' || !pattern) return false;
    try {
      return !new RegExp(pattern).test(value);
    } catch {
      return false; // an unparseable pattern never blocks input (matches upstream)
    }
  });
  protected readonly rootClassName = computed(() =>
    `OpenUITextField OpenUITextField-${this.variant()}${this.showInvalid() ? ' OpenUITextField-invalid' : ''}`,
  );

  constructor() {
    super();
    this.persistDefaultValue('TextField', this.fieldName, this.propValue);
    // Native inputs have no `value` attribute (see input-value.ts): push
    // pre-filled and programmatic values (@Set, @Reset, a restored state)
    // through `setValue`, but not the echo of the user's own typing.
    effect(() => {
      const value = this.value();
      untracked(() => {
        if (value === this.lastTyped) return;
        this.lastTyped = undefined;
        writeInputValue(() => this.controlRef?.nativeElement, value);
      });
    });
  }

  protected onInput(event: unknown): void {
    const next = String((event as { detail?: { value?: unknown } } | undefined)?.detail?.value ?? '');
    this.lastTyped = next;
    const name = this.fieldName();
    if (name) {
      this.renderer.state.setFieldValue(this.renderer.formName, 'TextField', name, next);
    }
    // Upstream fires the field's action on every edit, with the new text as
    // the user message.
    const action = this.props()['action'];
    if (action) this.trigger(next, action);
  }
}

@Component({
  selector: 'openui-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="OpenUICheckBox" style="display:flex;flex-direction:row;align-items:center" (tap)="toggle()">
      <view
        class="OpenUICheckBoxBox"
        style="width:18px;height:18px;border:1px solid #999;border-radius:4px;margin-right:8px;align-items:center;justify-content:center"
      >
        @if (checked()) {
          <text class="OpenUICheckBoxMark">✓</text>
        }
      </view>
      <text class="OpenUICheckBoxLabel">{{ label() }}</text>
    </view>
  `,
})
export class OpenuiCheckBoxComponent extends OpenuiBase {
  protected readonly label = computed(() => String(this.props()['label'] ?? ''));
  private readonly fieldName = computed(() => String(this.props()['name'] ?? ''));
  protected readonly checked = computed(() => {
    const name = this.fieldName();
    const fromState = name
      ? this.renderer.state.getFieldValue(this.renderer.formName, name)
      : undefined;
    return Boolean(fromState ?? this.props()['value']);
  });

  constructor() {
    super();
    this.persistDefaultValue('CheckBox', this.fieldName, () => {
      const value = this.props()['value'];
      return typeof value === 'boolean' ? value : undefined;
    });
  }

  protected toggle(): void {
    if (this.renderer.isStreaming()) return;
    const next = !this.checked();
    const name = this.fieldName();
    if (name) {
      this.renderer.state.setFieldValue(this.renderer.formName, 'CheckBox', name, next);
    }
    const action = this.props()['action'];
    if (action) this.trigger(this.label(), action);
  }
}

// ─── content (continued) ───────────────────────────────────────────────────

function toMaterialName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`) : '';
}

@Component({
  selector: 'openui-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text [class]="className()">{{ iconName() }}</text>`,
})
export class OpenuiIconComponent extends OpenuiBase {
  protected readonly iconName = computed(() => toMaterialName(this.props()['name']));
  protected readonly className = computed(() => {
    const size = (this.props()['size'] as string | undefined) ?? 'md';
    const color = (this.props()['color'] as string | undefined) ?? 'inherit';
    const sizeClass = size === 'sm' ? 'OpenUIIconSm' : size === 'lg' ? 'OpenUIIconLg' : 'OpenUIIconMd';
    const colorClass =
      color === 'primary' ? 'OpenUIIconColorPrimary' : color === 'muted' ? 'OpenUIIconColorMuted' : 'OpenUIIconColorInherit';
    return `OpenUIIcon ${sizeClass} ${colorClass}`;
  });
}

@Component({
  selector: 'openui-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiNode],
  template: `
    <view class="OpenUIList" [style]="style()">
      @for (child of items(); track $index) {
        @if (divider() && $index > 0) {
          <view [class]="dividerClassName()"></view>
        }
        <ng-container [openuiNode]="child" />
      }
    </view>
  `,
})
export class OpenuiListComponent extends OpenuiBase {
  protected readonly items = computed(() => {
    const value = this.props()['children'] ?? this.props()['items'];
    return Array.isArray(value) ? value : [];
  });
  protected readonly direction = computed(() => (this.props()['direction'] as string | undefined) ?? 'vertical');
  protected readonly divider = computed(() => this.props()['divider'] === true);
  protected readonly dividerClassName = computed(() =>
    this.direction() === 'horizontal'
      ? 'OpenUIListDivider OpenUIListDividerVertical'
      : 'OpenUIListDivider OpenUIListDividerHorizontal',
  );
  protected readonly style = computed(() => {
    const gap = GAPS[(this.props()['gap'] as string | undefined) ?? 'm'] ?? '8px';
    const align = (this.props()['align'] as string | undefined) ?? 'stretch';
    return `display:flex;flex-direction:${this.direction()};gap:${gap};align-items:${align}`;
  });
}

@Component({
  selector: 'openui-loading',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view [class]="'OpenUILoading ' + variantClass()">
      <view class="OpenUILoadingSkeleton OpenUILoadingSkeletonPrimary"></view>
      @if (variant() === 'block') {
        <view class="OpenUILoadingSkeleton OpenUILoadingSkeletonSecondary"></view>
      }
    </view>
  `,
})
export class OpenuiLoadingComponent extends OpenuiBase {
  protected readonly variant = computed(() => (this.props()['variant'] as string | undefined) ?? 'inline');
  protected readonly variantClass = computed(() => (this.variant() === 'block' ? 'OpenUILoadingBlock' : 'OpenUILoadingInline'));
}

@Component({
  selector: 'openui-separator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view class="OpenUISeparator"></view>`,
})
export class OpenuiSeparatorComponent extends OpenuiBase {}

/**
 * Video attachment placeholder — matches upstream exactly: a static
 * play-icon + title/URL card, not a real player. Upstream's own OpenUI
 * catalog never wires this to Lynx's native `<video>` element either (a
 * deliberate upstream choice, not a limitation of this port) — for real
 * playback in your own app, use the typed `<video>` element directly
 * (`angular-lynx/elements`' `LynxVideo`; see its doc for the on-device-only
 * caveat).
 */
@Component({
  selector: 'openui-video',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="OpenUIVideo">
      <view class="OpenUIVideoPoster">
        <text class="OpenUIVideoPlay">play_arrow</text>
      </view>
      <view class="OpenUIVideoMeta">
        <text class="OpenUIVideoTitle">{{ title() }}</text>
        @if (url(); as displayUrl) {
          <text class="OpenUIVideoUrl">{{ displayUrl }}</text>
        }
      </view>
    </view>
  `,
})
export class OpenuiVideoComponent extends OpenuiBase {
  protected readonly title = computed(() => {
    const value = this.props()['title'];
    return (value === undefined || value === null ? '' : String(value)) || 'Video';
  });
  protected readonly url = computed(() => {
    const value = this.props()['url'];
    return value === undefined || value === null || value === '' ? undefined : String(value);
  });
}

/** Audio attachment placeholder — matches upstream exactly (see `OpenuiVideoComponent`'s doc). */
@Component({
  selector: 'openui-audioplayer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="OpenUIAudio">
      <view class="OpenUIAudioIcon"><text class="OpenUIAudioIconText">music_note</text></view>
      <view class="OpenUIAudioContent">
        <text class="OpenUIAudioTitle">{{ title() }}</text>
        @if (url(); as displayUrl) {
          <text class="OpenUIAudioUrl">{{ displayUrl }}</text>
        }
      </view>
    </view>
  `,
})
export class OpenuiAudioPlayerComponent extends OpenuiBase {
  protected readonly title = computed(() => {
    const value = this.props()['description'];
    return (value === undefined || value === null ? '' : String(value)) || 'Audio';
  });
  protected readonly url = computed(() => {
    const value = this.props()['url'];
    return value === undefined || value === null || value === '' ? undefined : String(value);
  });
}

// ─── interactive (continued) ───────────────────────────────────────────────

/** Single-choice radio group; writes back through form state by `name` and can fire an action. */
@Component({
  selector: 'openui-radiogroup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view [class]="'OpenUIRadioGroup OpenUIRadioGroup-' + usageHint()">
      <view class="OpenUIRadioGroupContainer">
        @for (item of items(); track item) {
          <view class="OpenUIRadioOption" (tap)="select(item)">
            <view class="OpenUIRadioIndicator">
              @if (item === selected()) {
                <view class="OpenUIRadioIndicatorDot"></view>
              }
            </view>
            <text class="OpenUIRadioLabel">{{ item }}</text>
          </view>
        }
      </view>
    </view>
  `,
})
export class OpenuiRadioGroupComponent extends OpenuiBase {
  // Local visual selection always wins once touched (matches upstream's
  // `useState` — it updates on every tap regardless of whether `name`/
  // `action` are bound); `name`/`action` only gate the side effects.
  private readonly selectedOverride = signal<string | undefined>(undefined);

  protected readonly items = computed(() => {
    const items = this.props()['items'];
    return Array.isArray(items) ? (items as string[]) : [];
  });
  protected readonly usageHint = computed(() => (this.props()['usageHint'] as string | undefined) ?? 'default');
  private readonly fieldName = computed(() => String(this.props()['name'] ?? ''));
  protected readonly selected = computed(() => {
    const override = this.selectedOverride();
    if (override !== undefined) return override;
    const name = this.fieldName();
    const fromState = name ? this.renderer.state.getFieldValue(this.renderer.formName, name) : undefined;
    return String(fromState ?? this.props()['value'] ?? '');
  });

  constructor() {
    super();
    this.persistDefaultValue('RadioGroup', this.fieldName, () => {
      const value = this.props()['value'];
      return typeof value === 'string' ? value : undefined;
    });
  }

  protected select(value: string): void {
    if (this.renderer.isStreaming()) return;
    this.selectedOverride.set(value);
    const name = this.fieldName();
    if (name) this.renderer.state.setFieldValue(this.renderer.formName, 'RadioGroup', name, value);
    const action = this.props()['action'];
    if (action) this.trigger(value, action);
  }
}

/** Most tap targets a Slider track is split into (see {@link OpenuiSliderComponent}). */
const SLIDER_MAX_SEGMENTS = 24;

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Numeric slider — same props, form-state binding and action semantics as
 * upstream's OpenUI `Slider` (added to the catalog in genui 0.4.0), different
 * mechanics.
 *
 * Upstream drags a lynx-ui `SliderRoot`, which converts touch positions into
 * a ratio by measuring the track. This port deliberately **measures
 * nothing**: the track is a row of equal-width tap targets (one per step, up
 * to {@link SLIDER_MAX_SEGMENTS}), flanked by −/+ steppers for exact values.
 * Measured geometry is exactly what angular-lynx's own forms `LynxSlider`
 * can't get from the web preview (a layout-sized track reports `width: 0`
 * there — see slider.ts), and a GenUI surface is sized by layout by
 * definition, so a measuring slider would work on device and silently do
 * nothing in the browser. Tap-a-segment + steppers behaves identically on
 * both. Values snap to `step` exactly like upstream's `fromRatio`.
 */
@Component({
  selector: 'openui-slider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="OpenUISlider" style="display:flex;flex-direction:column;gap:4px">
      @if (label(); as text) {
        <view class="OpenUISliderHeader" style="display:flex;flex-direction:row;justify-content:space-between;align-items:center">
          <text class="OpenUISliderLabel">{{ text }}</text>
          <text class="OpenUISliderValue">{{ valueText() }}</text>
        </view>
      }
      <view class="OpenUISliderControl" style="display:flex;flex-direction:row;align-items:center;gap:8px">
        <view class="OpenUISliderStep OpenUISliderStepDown" (tap)="stepBy(-1)">
          <text class="OpenUISliderStepText">−</text>
        </view>
        <view class="OpenUISliderRoot" style="flex:1;height:32px;position:relative;display:flex;flex-direction:column;justify-content:center">
          <view class="OpenUISliderTrack" style="height:6px;border-radius:3px;overflow:hidden">
            <view class="OpenUISliderIndicator" [style]="indicatorStyle()"></view>
          </view>
          <view
            class="OpenUISliderHitArea"
            style="position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:row"
          >
            @for (segment of segments(); track $index) {
              <view class="OpenUISliderSegment" style="flex:1;height:100%" (tap)="setRatio(segment)"></view>
            }
          </view>
        </view>
        <view class="OpenUISliderStep OpenUISliderStepUp" (tap)="stepBy(1)">
          <text class="OpenUISliderStepText">+</text>
        </view>
      </view>
    </view>
  `,
})
export class OpenuiSliderComponent extends OpenuiBase {
  /** Where an unbound slider (no `name`) keeps its value — upstream's local `useState`. */
  private readonly localValue = signal<number | undefined>(undefined);

  protected readonly label = computed(() => toText(this.props()['label']));
  private readonly fieldName = computed(() => String(this.props()['name'] ?? ''));
  private readonly range = computed(() => {
    const min = toFiniteNumber(this.props()['min'], 0);
    const max = toFiniteNumber(this.props()['max'], 100);
    return max > min ? { min, max } : { min: 0, max: 100 };
  });
  private readonly step = computed(() => {
    const step = toFiniteNumber(this.props()['step'], 0);
    return step > 0 ? step : undefined;
  });
  private readonly propValue = computed(() => {
    const value = this.props()['value'];
    return value === undefined || value === null ? undefined : toFiniteNumber(value, this.range().min);
  });
  protected readonly value = computed(() => {
    const name = this.fieldName();
    const current = name ? this.renderer.state.getFieldValue(this.renderer.formName, name) : this.localValue();
    const { min, max } = this.range();
    const raw = toFiniteNumber(current, this.propValue() ?? min);
    return Math.min(Math.max(raw, min), max);
  });
  protected readonly valueText = computed(() => {
    const step = this.step();
    const decimals = step && !Number.isInteger(step) ? (String(step).split('.')[1]?.length ?? 0) : 0;
    return this.value().toFixed(decimals);
  });
  protected readonly indicatorStyle = computed(() => {
    const { min, max } = this.range();
    const percent = ((this.value() - min) / (max - min)) * 100;
    return `height:100%;width:${percent}%`;
  });
  /** One tap target per step (capped); each holds the ratio it sets. */
  protected readonly segments = computed(() => {
    const { min, max } = this.range();
    const step = this.step();
    const stepsInRange = step ? Math.round((max - min) / step) + 1 : SLIDER_MAX_SEGMENTS;
    const count = Math.max(2, Math.min(stepsInRange, SLIDER_MAX_SEGMENTS));
    return Array.from({ length: count }, (_, index) => index / (count - 1));
  });

  constructor() {
    super();
    this.persistDefaultValue('Slider', this.fieldName, this.propValue);
  }

  protected setRatio(ratio: number): void {
    const { min, max } = this.range();
    this.commit(min + ratio * (max - min));
  }

  protected stepBy(direction: 1 | -1): void {
    const { min, max } = this.range();
    this.commit(this.value() + direction * (this.step() ?? (max - min) / 100));
  }

  /** Clamp + snap like upstream's `fromRatio`, then write back and fire the action. */
  private commit(raw: number): void {
    if (this.renderer.isStreaming()) return;
    const { min, max } = this.range();
    const step = this.step();
    let next = Math.min(Math.max(raw, min), max);
    if (step) next = Math.min(Math.max(Number((min + Math.round((next - min) / step) * step).toFixed(12)), min), max);
    const name = this.fieldName();
    if (name) this.renderer.state.setFieldValue(this.renderer.formName, 'Slider', name, next);
    else this.localValue.set(next);
    const action = this.props()['action'];
    if (action) this.trigger(String(next), action);
  }
}

/**
 * Choice picker as selectable chips. Matches upstream's OpenUI behavior:
 * purely local visual selection, no external write-back (unlike the a2ui
 * ChoicePicker, which is data-model-bound).
 */
@Component({
  selector: 'openui-choicepicker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view [class]="rootClassName()">
      @if (labelText(); as text) {
        <text class="OpenUIChoicePickerLabel">{{ text }}</text>
      }
      <view class="OpenUIChoicePickerOptions">
        @for (option of options(); track $index) {
          <view [class]="itemClassName(option)" (tap)="select(option)">
            <text class="OpenUIChoiceItemText">{{ option }}</text>
          </view>
        }
      </view>
    </view>
  `,
})
export class OpenuiChoicePickerComponent extends OpenuiBase {
  private readonly selectedOverride = signal<string | undefined>(undefined);

  protected readonly options = computed(() => {
    const raw = this.props()['options'];
    return (Array.isArray(raw) ? raw : [raw]).map((value) => toText(value));
  });
  protected readonly displayStyle = computed(() => (this.props()['displayStyle'] as string | undefined) ?? 'chips');
  protected readonly variant = computed(() => (this.props()['variant'] as string | undefined) ?? 'default');
  protected readonly labelText = computed(() => {
    const value = this.props()['label'];
    return value === undefined || value === null ? undefined : String(value);
  });
  protected readonly rootClassName = computed(
    () => `OpenUIChoicePicker OpenUIChoicePicker-${this.displayStyle()} OpenUIChoicePicker-${this.variant()}`,
  );
  protected readonly currentValue = computed(() => this.selectedOverride() ?? String(this.props()['value'] ?? ''));

  protected itemClassName(option: string): string {
    return option === this.currentValue() ? 'OpenUIChoiceItem OpenUIChoiceItemSelected' : 'OpenUIChoiceItem';
  }

  protected select(option: string): void {
    if (this.renderer.isStreaming() || !option) return;
    this.selectedOverride.set(option);
  }
}

/** Date/time value display with optional label and min/max hints (matches upstream: display-only, no picker dialog). */
@Component({
  selector: 'openui-datetimeinput',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="OpenUIDateTimeInput">
      @if (labelText(); as text) {
        <text class="OpenUIDateTimeLabel">{{ text }}</text>
      }
      <text class="OpenUIDateTimeValue">{{ valueText() }}</text>
      <text class="OpenUIDateTimeHint">{{ modeHint() }}</text>
      @if (rangeHint(); as hint) {
        <text class="OpenUIDateTimeHint">{{ hint }}</text>
      }
    </view>
  `,
})
export class OpenuiDateTimeInputComponent extends OpenuiBase {
  protected readonly labelText = computed(() => {
    const value = this.props()['label'];
    return value === undefined || value === null ? undefined : String(value);
  });
  protected readonly valueText = computed(() => String(this.props()['value'] ?? ''));
  protected readonly modeHint = computed(() => {
    const fmt = (value: unknown) => (value === undefined ? '-' : value ? 'true' : 'false');
    return `enableDate=${fmt(this.props()['enableDate'])}, enableTime=${fmt(this.props()['enableTime'])}`;
  });
  protected readonly rangeHint = computed(() => {
    const min = this.props()['min'];
    const max = this.props()['max'];
    if (!min && !max) return undefined;
    return `min=${min ? String(min) : '-'}, max=${max ? String(max) : '-'}`;
  });
}

/** Tap-triggered modal with a header (optional title + close button) and nested trigger/content nodes. */
@Component({
  selector: 'openui-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiNode],
  template: `
    <view class="OpenUIModal">
      <view class="OpenUIModalTrigger" (tap)="open()">
        <ng-container [openuiNode]="triggerNode()" />
      </view>
      @if (isOpen()) {
        <view class="OpenUIModalMask">
          <view class="OpenUIModalContent">
            <view class="OpenUIModalHeader">
              @if (titleText(); as text) {
                <text class="OpenUIModalTitle">{{ text }}</text>
              }
              <view class="OpenUIModalClose" (tap)="close()"><text class="OpenUIModalCloseText">x</text></view>
            </view>
            <view class="OpenUIModalBody">
              <ng-container [openuiNode]="contentNode()" />
            </view>
          </view>
        </view>
      }
    </view>
  `,
})
export class OpenuiModalComponent extends OpenuiBase {
  protected readonly isOpen = signal(false);
  protected readonly triggerNode = computed(() => this.props()['trigger']);
  protected readonly contentNode = computed(() => this.props()['content']);
  protected readonly titleText = computed(() => {
    const value = this.props()['title'];
    return value === undefined || value === null ? undefined : String(value);
  });

  protected open(): void {
    this.isOpen.set(true);
  }

  protected close(): void {
    this.isOpen.set(false);
  }
}

interface OpenuiTabItem {
  value: string;
  title: unknown;
  child: unknown;
}

/** Tabbed content switcher — each tab carries its own nested child node. */
@Component({
  selector: 'openui-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiNode],
  template: `
    <view class="OpenUITabs">
      <view class="OpenUITabList">
        @for (tab of tabs(); track tab.value) {
          <view [class]="tabClassName(tab)" (tap)="select(tab.value)">
            <text class="OpenUITabTriggerText">{{ tabTitle(tab) }}</text>
          </view>
        }
      </view>
      <view class="OpenUITabBody">
        @if (activeChild(); as child) {
          <ng-container [openuiNode]="child" />
        }
      </view>
    </view>
  `,
})
export class OpenuiTabsComponent extends OpenuiBase {
  private readonly activeOverride = signal<string | undefined>(undefined);

  protected readonly tabs = computed(() => {
    const tabs = this.props()['tabs'];
    return Array.isArray(tabs) ? (tabs as OpenuiTabItem[]) : [];
  });
  protected readonly activeTab = computed(() => {
    const tabs = this.tabs();
    if (tabs.length === 0) return undefined;
    const wanted = this.activeOverride() ?? (this.props()['value'] as string | undefined) ?? tabs[0]!.value;
    return tabs.find((tab) => tab.value === wanted) ?? tabs[0];
  });
  protected readonly activeChild = computed(() => this.activeTab()?.child);

  protected tabTitle(tab: OpenuiTabItem): string {
    const title = tab.title === undefined || tab.title === null ? '' : String(tab.title);
    return title || tab.value;
  }

  protected tabClassName(tab: OpenuiTabItem): string {
    return this.activeTab() === tab ? 'OpenUITabTrigger OpenUITabTriggerActive' : 'OpenUITabTrigger OpenUITabTriggerInactive';
  }

  protected select(value: string): void {
    if (this.renderer.isStreaming()) return;
    this.activeOverride.set(value);
  }
}

// ─── the library ────────────────────────────────────────────────────────────

// `Buttons` references `Button.ref`, so Button is hoisted out of the list.
const BUTTON = defineComponent({
  name: 'Button',
  props: z.object({
    label: z.string(),
    action: actionSchema.optional(),
    variant: z.enum(['primary', 'secondary', 'tertiary']).optional(),
    type: z.enum(['normal', 'destructive']).optional(),
    size: z.enum(['extra-small', 'small', 'medium', 'large']).optional(),
  }),
  description: 'Clickable button.',
  component: OpenuiButtonComponent as Type<unknown>,
});

// Same descriptions as `@lynx-js/genui/openui/prompt`'s library. The order
// and groups come from DEFAULT_COMPONENT_NAMES/GROUPS below, so
// `library.prompt()` reads exactly like upstream's prompt.
const DEFINITIONS: DefinedComponent<any, Type<unknown>>[] = [
  defineComponent({
    name: 'Stack',
    props: z.object({
      children: z.array(z.any()),
      direction: z.enum(['row', 'column']).optional(),
      ...stackLayoutTail,
    }),
    description: 'Flex layout container.',
    component: OpenuiStackComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Row',
    props: z.object({
      children: z.array(z.any()),
      justify: z.enum(EXTENDED_JUSTIFY_VALUES).optional(),
      align: z.enum(ALIGN_VALUES).optional(),
      gap: z.enum(GAP_VALUES).optional(),
      wrap: z.boolean().optional(),
    }),
    description: 'Horizontal flex layout container.',
    component: OpenuiRowComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Column',
    props: z.object({
      children: z.array(z.any()),
      justify: z.enum(EXTENDED_JUSTIFY_VALUES).optional(),
      align: z.enum(ALIGN_VALUES).optional(),
      gap: z.enum(GAP_VALUES).optional(),
    }),
    description: 'Vertical flex layout container.',
    component: OpenuiColumnComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'List',
    props: z.object({
      children: listChildrenSchema.optional(),
      items: listChildrenSchema.optional(),
      direction: z.enum(['vertical', 'horizontal']).optional(),
      align: z.enum(ALIGN_VALUES).optional(),
      gap: z.enum(GAP_VALUES).optional(),
      divider: z.boolean().optional(),
    }),
    description:
      'List container for repeated children. Pass child components first. The second argument is the optional items alias; pass null there before direction, align, gap, or divider: List(children, null, "vertical", "stretch", "s", false).',
    component: OpenuiListComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Card',
    props: z.object({
      children: z.array(z.any()),
      variant: z.enum(['card', 'sunk', 'clear']).optional(),
      direction: z.enum(['row', 'column']).optional(),
      ...stackLayoutTail,
    }),
    description: 'Styled container (card/sunk/clear). Accepts Stack layout parameters.',
    component: OpenuiCardComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'CardHeader',
    props: z.object({ title: z.string(), subtitle: z.string().optional() }),
    description: 'Card header with title and optional subtitle.',
    component: OpenuiCardHeaderComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Text',
    props: z.object({
      text: stringLike,
      variant: z.enum(TEXT_VARIANTS).optional(),
    }),
    description: 'Plain text with semantic variants h1, h2, h3, h4, h5, caption, and body.',
    component: OpenuiTextComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'TextContent',
    props: z.object({
      text: z.union([z.string(), z.number(), z.boolean()]),
      size: z.enum(['small', 'default', 'large', 'small-heavy', 'large-heavy']).optional(),
    }),
    description: 'Text content with optional size.',
    component: OpenuiTextContentComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Separator',
    props: z.object({}),
    description: 'Visual separator.',
    component: OpenuiSeparatorComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Divider',
    props: z.object({ axis: z.enum(['horizontal', 'vertical']).optional() }),
    description: 'Horizontal or vertical divider.',
    component: OpenuiDividerComponent as Type<unknown>,
  }),
  BUTTON,
  defineComponent({
    name: 'Buttons',
    props: z.object({ buttons: z.array(BUTTON.ref) }),
    description: 'Button group.',
    component: OpenuiButtonsComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Tag',
    props: z.object({ text: z.string() }),
    description: 'Compact label or status tag.',
    component: OpenuiTagComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Image',
    props: z.object({
      url: stringLike,
      fit: z.enum(['contain', 'cover', 'fill', 'none', 'scale-down']).optional(),
      variant: z.enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header']).optional(),
    }),
    description: 'Image with optional fit and variant sizing.',
    component: OpenuiImageComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Canvas',
    // Upstream's schema and descriptions verbatim (genui 0.7 `Canvas/definition.js`):
    // the model reads them, and they describe upstream's Web behaviour.
    props: z.object({
      code: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'Drawing code using ctx (CanvasRenderingContext2D), width and height. A string runs after streaming ends. For progressive drawing, emit an array of independently executable strings in drawing order. While streaming, the last array item is buffered until another item arrives or streaming ends. Append-only updates execute only new chunks; changing an earlier chunk resets and replays the drawing. Each chunk has its own JavaScript scope; only the canvas and ctx state persist. Use standard ctx drawing commands only; do not access canvas, acquire a context or register events.',
        ),
      width: z.number().int().min(1).max(2048).optional().describe('Logical drawing width in pixels. Defaults to 360.'),
      height: z.number().int().min(1).max(2048).optional().describe('Logical drawing height in pixels. Defaults to 360.'),
      name: z
        .string()
        .optional()
        .describe(
          'Canvas element name. With action, receives the clicked logical { x, y } coordinates before the action runs; use a $state name for reactive binding.',
        ),
      action: actionSchema
        .optional()
        .describe('Action to execute on click, after updating name with logical coordinates. Disabled while streaming.'),
    }),
    description:
      'Web Canvas 2D surface rendered with standard ctx drawing commands. Update code to redraw; the component manages canvas initialization. Non-Web hosts display an unsupported message unless they override this component.',
    component: OpenuiCanvasComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Icon',
    props: z.object({
      name: z.enum(ICON_NAMES),
      size: z.enum(['sm', 'md', 'lg']).optional(),
      color: z.enum(['primary', 'muted', 'inherit']).optional(),
    }),
    description: 'Material icon.',
    component: OpenuiIconComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Loading',
    props: z.object({ variant: z.enum(['inline', 'block']).optional() }),
    description: 'Skeleton placeholder while content loads.',
    component: OpenuiLoadingComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'AudioPlayer',
    props: z.object({ url: stringLike, description: stringLike.optional() }),
    description: 'Audio attachment placeholder with URL and description.',
    component: OpenuiAudioPlayerComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Video',
    props: z.object({ url: stringLike, title: stringLike.optional() }),
    description: 'Video attachment placeholder with URL and optional title.',
    component: OpenuiVideoComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'CheckBox',
    props: z.object({
      label: z.string(),
      value: z.boolean().optional(),
      action: actionSchema.optional(),
      name: z.string().optional(),
    }),
    description: 'Toggleable checkbox. Use name when it participates in a form or stateful flow.',
    component: OpenuiCheckBoxComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'RadioGroup',
    props: z.object({
      items: z.array(z.string()),
      value: z.string().optional(),
      usageHint: z.enum(['default', 'card', 'row']).optional(),
      action: actionSchema.optional(),
      name: z.string().optional(),
    }),
    description: 'Single-choice radio group.',
    component: OpenuiRadioGroupComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'ChoicePicker',
    props: z.object({
      label: stringLike.optional(),
      options: z.union([z.array(stringLike), stringLike]),
      value: stringLike.optional(),
      variant: z.enum(['default', 'card']).optional(),
      displayStyle: z.enum(['list', 'chips', 'dropdown']).optional(),
      filterable: booleanLike.optional(),
    }),
    description: 'Choice picker rendered as selectable chips, list items, or a dropdown-like field.',
    component: OpenuiChoicePickerComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Slider',
    props: z.object({
      label: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      value: z.number().optional(),
      step: z.number().optional(),
      action: actionSchema.optional(),
      name: z.string().optional(),
    }),
    description: 'Continuous-value slider.',
    component: OpenuiSliderComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'DateTimeInput',
    props: z.object({
      value: stringLike,
      enableDate: booleanLike.optional(),
      enableTime: booleanLike.optional(),
      min: stringLike.optional(),
      max: stringLike.optional(),
      label: stringLike.optional(),
    }),
    description: 'Date/time value display with optional label, min/max, and enabled date/time hints.',
    component: OpenuiDateTimeInputComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'TextField',
    props: z.object({
      label: z.string(),
      value: z.string().optional(),
      variant: z.enum(['longText', 'number', 'shortText', 'obscured']).optional(),
      validationRegexp: z.string().optional(),
      action: actionSchema.optional(),
      name: z.string().optional(),
    }),
    description: 'Single-line or multi-line text input with optional regex validation.',
    component: OpenuiTextFieldComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Modal',
    props: z.object({
      trigger: z.any(),
      content: z.any(),
      title: stringLike.optional(),
      closeOnAction: z.boolean().optional(),
    }),
    description: 'Tap-triggered modal container. Pass the trigger component first and content second.',
    component: OpenuiModalComponent as Type<unknown>,
  }),
  defineComponent({
    name: 'Tabs',
    props: z.object({
      tabs: z.array(z.object({ value: z.string(), title: stringLike, child: z.any() })),
      value: z.string().optional(),
    }),
    description: 'Tabbed content switcher. Each tab item is an object with value, title, and child.',
    component: OpenuiTabsComponent as Type<unknown>,
  }),
];

// Upstream's `shared/defaultCatalog.js` (genui 0.7): the order the prompt
// lists components in, and the groups it lists them under.
const DEFAULT_COMPONENT_NAMES = [
  'Stack', 'Row', 'Column', 'List', 'Card', 'CardHeader', 'Text', 'TextContent', 'Separator',
  'Divider', 'Button', 'Buttons', 'Tag', 'Image', 'Canvas', 'Icon', 'Video', 'AudioPlayer',
  'Loading', 'Tabs', 'Modal', 'CheckBox', 'RadioGroup', 'ChoicePicker', 'Slider', 'TextField',
  'DateTimeInput',
] as const;

const DEFAULT_COMPONENT_GROUPS: ComponentGroup[] = [
  { name: 'Layout', components: ['Stack', 'Row', 'Column', 'List'] },
  { name: 'Content', components: ['Card', 'CardHeader', 'Text', 'TextContent', 'Separator', 'Divider'] },
  { name: 'Buttons', components: ['Button', 'Buttons'] },
  { name: 'Data Display', components: ['Tag', 'Image', 'Canvas', 'Icon', 'Video', 'AudioPlayer', 'Loading'] },
  { name: 'Overlays', components: ['Tabs', 'Modal'] },
  { name: 'Inputs', components: ['CheckBox', 'RadioGroup', 'ChoicePicker', 'Slider', 'TextField', 'DateTimeInput'] },
];

const DEFAULT_COMPONENTS: DefinedComponent<any, Type<unknown>>[] = DEFAULT_COMPONENT_NAMES.map((name) => {
  const component = DEFINITIONS.find((definition) => definition.name === name);
  if (!component) throw new Error(`[openui] built-in "${name}" has no definition`);
  return component;
});

/**
 * Options for {@link createOpenUiLibrary}. The same options as upstream's
 * `createOpenUiPromptLibrary`, so a prompt built with
 * `buildOpenUiSystemPrompt(options)` describes exactly the library
 * `createOpenUiLibrary(options)` renders.
 */
export interface CreateOpenUiLibraryOptions {
  /**
   * Root component name; supply its definition when defaults are disabled.
   * @defaultValue `'Stack'`
   */
  root?: string;
  /**
   * Whether to include the built-in components and component groups.
   * @defaultValue `true`
   */
  includeDefaultComponents?: boolean;
  /**
   * Limit built-ins to these names, keeping the root. Custom components are
   * always appended. Ignored when defaults are disabled.
   * @example `componentNames: ['Stack', 'Text']`
   */
  componentNames?: readonly string[];
  /**
   * Extra Angular component definitions, merged after the built-ins (a
   * same-named one replaces the built-in), or the complete set when defaults
   * are disabled.
   */
  components?: DefinedComponent<any, Type<unknown>>[];
  /** Additional groups, or the complete set when defaults are disabled. */
  componentGroups?: ComponentGroup[];
}

/**
 * Create an Angular OpenUI library: the built-ins plus any caller-provided
 * extensions (≈ upstream `createOpenUiLibrary`). Assembled like upstream's
 * `resolveLibraryOptions`.
 */
export function createOpenUiLibrary(options?: CreateOpenUiLibraryOptions): Library<Type<unknown>> {
  registerOpenUiBuiltins();
  const root = options?.root ?? 'Stack';
  const includeDefaults = options?.includeDefaultComponents ?? true;
  const names = options?.componentNames ? new Set([...options.componentNames, root]) : undefined;
  const components = includeDefaults
    ? DEFAULT_COMPONENTS.filter((component) => !names || names.has(component.name))
    : [];
  const groups = includeDefaults
    ? DEFAULT_COMPONENT_GROUPS.map((group) => ({
      ...group,
      components: group.components.filter((name) => !names || names.has(name)),
    })).filter((group) => !names || group.components.length > 0)
    : undefined;
  const componentGroups = groups ? [...groups, ...(options?.componentGroups ?? [])] : options?.componentGroups;
  return createLibrary<Type<unknown>>({
    root,
    components: [...components, ...(options?.components ?? [])],
    ...(componentGroups ? { componentGroups } : {}),
  });
}
