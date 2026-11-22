// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * `[openuiNode]` — the Angular counterpart of upstream's `RenderNode` /
 * `renderDeep`: renders one parsed OpenUI value with no extra host element.
 *
 *  - `ElementNode` → the library component registered under its `typeName`
 *    (unknown names render nothing, matching upstream's `RenderNode`);
 *  - string / number / boolean → a bare `<text>` (upstream `renderDeep`);
 *  - anything else → nothing.
 *
 * Props are evaluated through lang-core's `evaluateElementProps` (resolving
 * `$state` refs against the renderer's `OpenUiState`) and re-evaluated
 * whenever form state changes, skipped entirely when the parser marked the
 * node `hasDynamicProps: false`.
 *
 * A new node for the same element updates the component in place instead of
 * rebuilding it, so its local state (focus, the selected tab) survives a
 * re-parse or a state change. That is what upstream's React keys give it
 * (genui 0.7 `keyFrom`); see {@link sameElement}.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  computed,
  Directive,
  inject,
  Injector,
  Input,
  NO_ERRORS_SCHEMA,
  OnChanges,
  OnDestroy,
  Signal,
  signal,
  SimpleChanges,
  Type,
  untracked,
  ViewContainerRef,
  WritableSignal,
} from '@angular/core';

import type { ElementNode } from '@openuidev/lang-core';
import { evaluateElementProps, isASTNode } from '@openuidev/lang-core';

import { OPENUI_NODE_CONTEXT, OPENUI_RENDERER_CONTEXT, OpenuiNodeContext } from './context.js';

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isElementNode(value: unknown): value is ElementNode {
  return (
    typeof value === 'object' && value !== null
    && (value as Record<string, unknown>)['type'] === 'element'
    && 'typeName' in value
  );
}

/**
 * Upstream's element identity (genui 0.7 `keyFrom`): the statement name, else
 * an `id` or `name` prop. Elements with neither are told apart by type and
 * position, and the `@for … track $index` around every `[openuiNode]`
 * supplies the position.
 */
function identityOf(node: ElementNode): string | undefined {
  if (typeof node.statementId === 'string') return node.statementId;
  const identity = node.props?.['id'] ?? node.props?.['name'];
  return typeof identity === 'string' && identity ? identity : undefined;
}

/** Whether `next` is the same element as `current`, so its component can be kept. */
function sameElement(current: ElementNode, next: ElementNode): boolean {
  return current.typeName === next.typeName && identityOf(current) === identityOf(next);
}

/**
 * Children written as an expression (`Stack(@Each($items, "item", …))`)
 * exist only once evaluated, and the loop variable they read is in scope only
 * during that evaluation.
 */
function isExpression(value: unknown): boolean {
  return isASTNode(value) || (Array.isArray(value) && value.some((item) => isASTNode(item)));
}

/**
 * Bare text node for primitive children (≈ upstream `renderDeep`).
 *
 * @experimental
 */
@Component({
  selector: 'openui-text-value',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text>{{ value }}</text>`,
})
export class OpenuiTextValue {
  @Input() value = '';
}

/** @experimental */
@Directive({
  selector: '[openuiNode]',
  standalone: true,
})
export class OpenuiNode implements OnChanges, OnDestroy {
  /** The parsed value to render: `ElementNode`, primitive, or null. */
  @Input({ required: true }) openuiNode: unknown;

  private readonly vcr = inject(ViewContainerRef);
  private readonly injector = inject(Injector);
  private readonly rendererCtx = inject(OPENUI_RENDERER_CONTEXT);

  private componentRef: ComponentRef<unknown> | undefined;
  /** The node the current element component renders, and the class it was built from. */
  private current: { node: WritableSignal<ElementNode>; type: unknown } | undefined;
  private text: ComponentRef<OpenuiTextValue> | undefined;

  // Each re-parse of streamed text, and each re-evaluation of state-driven
  // children, hands over new node objects. A node for the same element
  // updates the component in place; anything else rebuilds it.
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['openuiNode']) return;
    const next = this.openuiNode;
    if (this.text && isPrimitive(next)) {
      this.text.setInput('value', String(next));
      return;
    }
    if (this.current && isElementNode(next) && sameElement(this.current.node(), next)
      && this.rendererCtx.library.components[next.typeName]?.component === this.current.type) {
      this.current.node.set(next);
      return;
    }
    this.componentRef?.destroy();
    this.componentRef = undefined;
    this.current = undefined;
    this.text = undefined;
    this.build();
  }

  ngOnDestroy(): void {
    this.componentRef?.destroy();
  }

  private build(): void {
    const value = this.openuiNode;
    if (value === null || value === undefined) return;
    if (isPrimitive(value)) {
      const ref = this.vcr.createComponent(OpenuiTextValue);
      ref.setInput('value', String(value));
      this.componentRef = ref;
      this.text = ref;
      return;
    }
    if (!isElementNode(value)) return;
    const type = this.rendererCtx.library.components[value.typeName]?.component;
    if (!type) return; // unknown component name — render nothing, like upstream
    const node = signal(value);
    this.current = { node, type };
    const ctx: OpenuiNodeContext = {
      get node() {
        return node();
      },
      props: this.buildProps(node),
    };
    this.componentRef = this.vcr.createComponent(type as Type<unknown>, {
      injector: Injector.create({
        providers: [{ provide: OPENUI_NODE_CONTEXT, useValue: ctx }],
        parent: this.injector,
      }),
    });
  }

  private buildProps(node: Signal<ElementNode>): Signal<Record<string, unknown>> {
    const { state } = this.rendererCtx;
    return computed(() => {
      const current = node();
      // Static props (the parser flagged nothing dynamic) evaluate once per node.
      if (current.hasDynamicProps === false) return untracked(() => this.evaluate(current));
      // Dynamic props: re-evaluate whenever form state changes.
      state.formState();
      return this.evaluate(current);
    });
  }

  private evaluate(node: ElementNode): Record<string, unknown> {
    const { library, state } = this.rendererCtx;
    try {
      const evaluated = evaluateElementProps(node, {
        ctx: state.evaluationContext,
        library: library as never,
        store: state.store,
      }).props;
      // Children evaluate themselves when their own node renders. Passing
      // the ORIGINAL child nodes through keeps their identity stable across
      // re-evaluations (e.g. a form-state change on the parent), so child
      // subtrees — and their event listeners — survive instead of being
      // torn down and rebuilt by ngOnChanges. Children written as an
      // expression can't be passed through (see isExpression); their new
      // nodes on each evaluation update the existing components in place.
      if ('children' in node.props && !isExpression(node.props['children'])) {
        evaluated['children'] = node.props['children'];
      }
      return evaluated;
    } catch (e) {
      console.warn(`[openui] Prop evaluation failed for "${node.typeName}":`, e);
      return node.props;
    }
  }
}
