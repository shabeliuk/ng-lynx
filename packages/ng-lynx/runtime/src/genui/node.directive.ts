// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * `A2uiNode` — the Angular counterpart of the ReactLynx `NodeRenderer`.
 *
 * A structural-style directive rather than a component so it adds **no host
 * element**: the catalog component it instantiates is the only thing that
 * lands in the Lynx element tree (the upstream `NodeRenderer` likewise
 * renders a fragment). Used on an `<ng-container>`:
 *
 * ```html
 * <ng-container [a2uiNode]="child" [a2uiNodeSurface]="surface" />
 * ```
 *
 * Responsibilities, mirroring `NodeRendererImpl`:
 *  - subscribe to the node's per-component `Resource` so later
 *    `updateComponents` messages re-render it in place;
 *  - preserve an explicitly-passed `dataContextPath` over the stored one
 *    (containers pass per-item contexts for templated children);
 *  - look the component up in the catalog its `@catalogId` (or the
 *    surface's `catalogId`) names, as registered on the processor;
 *  - resolve dynamic props and evaluate `@checks` inside a signals effect on
 *    the store's runtime (reactivity.ts), so any signal read along the way
 *    (a binding, a value a function reads, an agent function's result)
 *    re-resolves them;
 *  - hand the catalog component its runtime contract through
 *    `A2UI_NODE_CONTEXT` (Angular's substitute for the
 *    `GenericComponentProps` prop spread), including upstream's `useAction`;
 *  - warn once per unknown tag and fail soft (render a notice), like upstream.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  Directive,
  inject,
  Injector,
  Input,
  NO_ERRORS_SCHEMA,
  OnDestroy,
  OnInit,
  signal,
  Type,
  ViewContainerRef,
} from '@angular/core';

import type { ComponentInstance, Surface } from '@lynx-js/genui/a2ui/store';
import { executeFunctionCall, isDataBinding, resolveDynamicValue } from '@lynx-js/genui/a2ui/store';

import type { A2uiCatalog } from './catalog.js';
import { A2UI_CHECKS_OK, type A2uiChecksOutcome, evaluateA2uiChecks, sameChecksOutcome } from './checks.js';
import { A2UI_NODE_CONTEXT, A2UI_SURFACE_CONTEXT, A2uiNodeContext } from './node-context.js';
import { trackA2uiSignals } from './reactivity.js';
import { componentCatalog, resolveBindingPath, resolveComponentProps } from './resolve-props.js';

const warnedTags = new Set<string>();

/**
 * Rendered when a component tag is missing from the catalog.
 *
 * @experimental
 */
@Component({
  selector: 'a2ui-unsupported-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view style="width:100%;min-height:20px;margin-bottom:8px;padding:6px;border-radius:6px;border:1px dashed #999">
      <text style="font-size:10px;line-height:12px;color:#666">Unsupported {{ kind }} in {{ nodeId }}</text>
    </view>
  `,
})
export class A2uiUnsupportedNotice {
  @Input() kind: 'component' | 'syntax' = 'component';
  @Input() nodeId = '';
}

/** Port of upstream `awaitResolvedValues`: settle nested promises. */
async function awaitResolvedValues(value: unknown): Promise<unknown> {
  const settled = await value;
  if (Array.isArray(settled)) return Promise.all(settled.map((item) => awaitResolvedValues(item)));
  if (settled !== null && typeof settled === 'object') {
    const entries = await Promise.all(
      Object.entries(settled).map(async ([key, item]) => [key, await awaitResolvedValues(item)] as const),
    );
    return Object.fromEntries(entries);
  }
  return settled;
}

const componentMaps = new WeakMap<A2uiCatalog, Map<string, Type<unknown>>>();

/** Name → Angular component for a registered catalog. */
function componentsOf(catalog: A2uiCatalog): Map<string, Type<unknown>> {
  let map = componentMaps.get(catalog);
  if (!map) {
    map = new Map(catalog.components.map((entry) => [entry.name, entry.component]));
    componentMaps.set(catalog, map);
  }
  return map;
}

/** @experimental */
@Directive({
  selector: '[a2uiNode]',
  standalone: true,
})
export class A2uiNode implements OnInit, OnDestroy {
  /** The component instance to render (as stored on the surface). */
  @Input({ required: true }) a2uiNode!: ComponentInstance;
  @Input({ required: true }) a2uiNodeSurface!: Surface;

  private readonly vcr = inject(ViewContainerRef);
  private readonly injector = inject(Injector);
  private readonly surfaceCtx = inject(A2UI_SURFACE_CONTEXT);

  private componentRef: ComponentRef<unknown> | undefined;
  private noticeRef: ComponentRef<A2uiUnsupportedNotice> | undefined;
  private renderedType: Type<unknown> | undefined;
  private offResource: (() => void) | undefined;
  private latest: ComponentInstance | undefined;
  private readonly propsSignal = signal<Record<string, unknown>>({});
  private readonly unsupportedSignal = signal<string[]>([]);
  private readonly checksSignal = signal<A2uiChecksOutcome>(A2UI_CHECKS_OK);
  /** Disposes the signals effect resolving the current component. */
  private offTracking: (() => void) | undefined;
  private trackedComponent: ComponentInstance | undefined;
  private destroyed = false;

  ngOnInit(): void {
    const initial = this.a2uiNode;
    const surface = this.a2uiNodeSurface;
    const resource = initial.id ? surface.resources.get(initial.id) : undefined;
    if (resource) {
      // Unlike preact signals, Resource.subscribe does NOT replay the current
      // snapshot — it only fires on transitions. Read the snapshot once, then
      // listen for later `updateComponents` deliveries.
      this.offResource = resource.subscribe(() => {
        const snapshot = resource.getSnapshot();
        const next = (snapshot.value as { component?: ComponentInstance } | undefined)?.component;
        if (next) {
          this.latest = next;
          this.render();
        }
      });
      const current = (resource.getSnapshot().value as { component?: ComponentInstance } | undefined)
        ?.component;
      if (current) this.latest = current;
    }
    this.render();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.offResource?.();
    this.stopTracking();
    this.componentRef?.destroy();
    this.noticeRef?.destroy();
  }

  /** Effective component: latest update, with the passed-in data context winning. */
  private effectiveComponent(): ComponentInstance {
    const initial = this.a2uiNode;
    const component = this.latest ?? initial;
    if (
      initial.dataContextPath !== undefined
      && component.dataContextPath !== initial.dataContextPath
    ) {
      return { ...component, dataContextPath: initial.dataContextPath };
    }
    return component;
  }

  private render(): void {
    if (this.destroyed) return;
    const component = this.effectiveComponent();
    const surface = this.a2uiNodeSurface;
    const tag = component.component;
    const catalog = componentCatalog(
      component as unknown as Record<string, unknown>,
      surface,
      this.surfaceCtx.processor,
    );
    const type = catalog ? componentsOf(catalog).get(tag) : undefined;
    if (!type) {
      if (!warnedTags.has(tag)) {
        warnedTags.add(tag);
        console.warn(`[a2ui] Component "${tag}" is not in the active catalog.`);
      }
      this.stopTracking();
      this.mountNotice('component', component.id ?? '');
      return;
    }
    this.track(component, surface);
    if (this.unsupportedSignal().length > 0) {
      this.mountNotice('syntax', component.id ?? '');
      return;
    }
    this.mount(type, surface);
  }

  private stopTracking(): void {
    this.offTracking?.();
    this.offTracking = undefined;
    this.trackedComponent = undefined;
  }

  /**
   * Resolve props and evaluate `@checks` in a signals effect; it re-runs
   * whenever a store signal it read changes, until the component changes.
   */
  private track(component: ComponentInstance, surface: Surface): void {
    if (this.trackedComponent === component && this.offTracking) return;
    this.offTracking?.();
    this.trackedComponent = component;
    const { processor, functions } = this.surfaceCtx;
    const raw = component as unknown as Record<string, unknown>;
    let previous: Record<string, unknown> | undefined;
    // Last values set, kept here so the effect never reads Angular signals.
    let checks = this.checksSignal();
    let unsupported = this.unsupportedSignal();
    this.offTracking = trackA2uiSignals(surface, () => {
      if (this.destroyed) return;
      const resolved = resolveComponentProps(
        raw,
        surface,
        component.dataContextPath,
        processor,
        functions,
        previous,
      );
      previous = resolved.props;
      this.propsSignal.set(resolved.props);
      if (
        unsupported.length !== resolved.unsupportedFields.length
        || unsupported.some((field, i) => field !== resolved.unsupportedFields[i])
      ) {
        unsupported = resolved.unsupportedFields;
        this.unsupportedSignal.set(unsupported);
      }
      const next = evaluateA2uiChecks(processor, raw['@checks'], surface, component.dataContextPath, functions);
      if (!sameChecksOutcome(next, checks)) {
        checks = next;
        this.checksSignal.set(next);
      }
    });
  }

  private mount(type: Type<unknown>, surface: Surface): void {
    if (this.renderedType === type && this.componentRef) return; // props flow via signals
    this.componentRef?.destroy();
    this.noticeRef?.destroy();
    this.noticeRef = undefined;
    const ctx = this.buildContext(surface);
    const injector = Injector.create({
      providers: [{ provide: A2UI_NODE_CONTEXT, useValue: ctx }],
      parent: this.injector,
    });
    this.componentRef = this.vcr.createComponent(type, { injector });
    this.renderedType = type;
  }

  private mountNotice(kind: 'component' | 'syntax', nodeId: string): void {
    this.componentRef?.destroy();
    this.componentRef = undefined;
    this.renderedType = undefined;
    if (!this.noticeRef) {
      this.noticeRef = this.vcr.createComponent(A2uiUnsupportedNotice);
    }
    this.noticeRef.setInput('kind', kind);
    this.noticeRef.setInput('nodeId', nodeId);
  }

  private buildContext(surface: Surface): A2uiNodeContext {
    const initial = this.effectiveComponent();
    return {
      id: initial.id ?? '',
      surface,
      dataContextPath: initial.dataContextPath,
      props: this.propsSignal.asReadonly(),
      unsupportedFields: this.unsupportedSignal.asReadonly(),
      checks: this.checksSignal.asReadonly(),
      setValue: (key, value) => {
        // Write through the *original* (unresolved) prop's binding.
        const component = this.effectiveComponent();
        const raw = (component as unknown as Record<string, unknown>)[key];
        if (isDataBinding(raw) && !('componentId' in (raw as object))) {
          const rawPath = (raw as { '@path': string })['@path'];
          if (!rawPath) return;
          surface.store.update(resolveBindingPath(rawPath, component.dataContextPath), value);
        }
      },
      sendAction: (action) =>
        this.runAction(action, surface).catch((error: unknown) => {
          console.warn('[a2ui] Action failed:', error);
          return undefined;
        }),
    };
  }

  /** Port of upstream `useAction`'s `sendAction`. */
  private async runAction(action: Record<string, unknown>, surface: Surface): Promise<unknown> {
    const { processor, functions } = this.surfaceCtx;
    const component = this.effectiveComponent();
    const id = component.id ?? '';
    const dataContextPath = component.dataContextPath;
    const surfaceId = surface.surfaceId;
    try {
      if (action['functionCall']) {
        return await executeFunctionCall(processor, action['functionCall'] as never, surfaceId, dataContextPath, {
          functions: functions as never,
          awaitResult: true,
          userActivated: true,
        });
      }
      const options = {
        functions: functions as never,
        resolveFunctionCall: executeFunctionCall,
        awaitResult: true,
        userActivated: true,
        throwOnError: true,
      };
      const event = action['event'] as
        | { name?: string; context?: Record<string, unknown>; userMessage?: unknown }
        | undefined;
      let name = 'unknownAction';
      let context: Record<string, unknown> = {};
      if (event) {
        name = event.name ?? name;
        if (event.context) {
          const resolved: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(event.context)) {
            resolved[key] = await awaitResolvedValues(
              resolveDynamicValue(processor, value, surfaceId, dataContextPath, options),
            );
          }
          context = resolved;
        }
      }
      const userMessage = event?.userMessage === undefined
        ? undefined
        : await awaitResolvedValues(
          resolveDynamicValue(processor, event.userMessage, surfaceId, dataContextPath, options),
        );
      return await processor.sendMessage({
        version: '1.0',
        action: {
          name,
          surfaceId,
          sourceComponentId: id,
          timestamp: new Date().toISOString(),
          context,
          ...(typeof userMessage === 'string' ? { userMessage } : {}),
        },
      } as never);
    } catch (error) {
      processor.reportExpressionError(error, surfaceId, 'EXECUTION_ERROR');
      throw error;
    }
  }
}
