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
 *  - resolve dynamic props (bindings, function calls) and re-resolve when a
 *    touched data-model signal changes — see resolve-props.ts for how the
 *    subscription set replaces upstream's `@preact/signals` `effect()`;
 *  - hand the catalog component its runtime contract through
 *    `A2UI_NODE_CONTEXT` (Angular's substitute for the
 *    `GenericComponentProps` prop spread);
 *  - warn once per unknown tag and fail soft (render nothing), plus a
 *    fallback notice for unsupported dynamic syntax, like upstream.
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
import { executeFunctionCall, resolveDynamicValue } from '@lynx-js/genui/a2ui/store';

import { A2UI_NODE_CONTEXT, A2UI_SURFACE_CONTEXT, A2uiNodeContext } from './node-context.js';
import { resolveBindingPath, resolveComponentProps } from './resolve-props.js';

const warnedTags = new Set<string>();

/** Rendered when a component tag is missing from the catalog. */
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
  private renderedTag: string | undefined;
  private offResource: (() => void) | undefined;
  private latest: ComponentInstance | undefined;
  private readonly propsSignal = signal<Record<string, unknown>>({});
  private readonly unsupportedSignal = signal<string[]>([]);
  /** path → unsubscribe, for the data-model signals the props touch. */
  private readonly pathSubs = new Map<string, () => void>();
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
    for (const off of this.pathSubs.values()) off();
    this.pathSubs.clear();
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
    const type = this.surfaceCtx.componentsByName.get(tag);
    if (!type) {
      if (!warnedTags.has(tag)) {
        warnedTags.add(tag);
        console.warn(`[a2ui] Component "${tag}" is not in the active catalog.`);
      }
      this.mountNotice('component', component.id ?? '');
      return;
    }
    this.resolveAndTrack(component, surface);
    if (this.unsupportedSignal().length > 0) {
      this.mountNotice('syntax', component.id ?? '');
      return;
    }
    this.mount(type, component, surface, tag);
  }

  private resolveAndTrack(component: ComponentInstance, surface: Surface): void {
    const { props, unsupportedFields, touchedPaths } = resolveComponentProps(
      component as unknown as Record<string, unknown>,
      surface,
      component.dataContextPath,
      this.surfaceCtx.processor,
      this.surfaceCtx.functions,
    );
    this.propsSignal.set(props);
    this.unsupportedSignal.set(unsupportedFields);
    // Diff path subscriptions: drop stale ones, add new ones.
    for (const [path, off] of this.pathSubs) {
      if (!touchedPaths.has(path)) {
        off();
        this.pathSubs.delete(path);
      }
    }
    for (const path of touchedPaths) {
      if (this.pathSubs.has(path)) continue;
      const sig = surface.store.getSignal(path);
      let primed = false;
      const off = sig.subscribe(() => {
        if (!primed) return; // first call replays the current value
        if (!this.destroyed) this.resolveAndTrack(this.effectiveComponent(), this.a2uiNodeSurface);
      });
      primed = true;
      this.pathSubs.set(path, off);
    }
  }

  private mount(
    type: Type<unknown>,
    component: ComponentInstance,
    surface: Surface,
    tag: string,
  ): void {
    if (this.renderedTag === tag && this.componentRef) return; // props flow via signals
    this.componentRef?.destroy();
    this.noticeRef?.destroy();
    this.noticeRef = undefined;
    const ctx = this.buildContext(component, surface);
    const injector = Injector.create({
      providers: [{ provide: A2UI_NODE_CONTEXT, useValue: ctx }],
      parent: this.injector,
    });
    this.componentRef = this.vcr.createComponent(type, { injector });
    this.renderedTag = tag;
  }

  private mountNotice(kind: 'component' | 'syntax', nodeId: string): void {
    this.componentRef?.destroy();
    this.componentRef = undefined;
    this.renderedTag = undefined;
    if (!this.noticeRef) {
      this.noticeRef = this.vcr.createComponent(A2uiUnsupportedNotice);
    }
    this.noticeRef.setInput('kind', kind);
    this.noticeRef.setInput('nodeId', nodeId);
  }

  private buildContext(component: ComponentInstance, surface: Surface): A2uiNodeContext {
    const { processor, functions } = this.surfaceCtx;
    const id = component.id ?? '';
    const dataContextPath = component.dataContextPath;
    return {
      id,
      surface,
      dataContextPath,
      props: this.propsSignal.asReadonly(),
      unsupportedFields: this.unsupportedSignal.asReadonly(),
      setValue: (key, value) => {
        // Write through the *original* (unresolved) prop's binding.
        const raw = (this.effectiveComponent() as unknown as Record<string, unknown>)[key];
        if (raw && typeof raw === 'object' && 'path' in raw && !('componentId' in raw)) {
          const rawPath = (raw as { path?: unknown })['path'];
          const path = resolveBindingPath(typeof rawPath === 'string' ? rawPath : '', dataContextPath);
          surface.store.update(path, value);
        }
      },
      sendAction: (action) => {
        // Port of `useAction`: functionCall actions execute locally; event
        // actions resolve their context then dispatch a UserActionPayload.
        if ('functionCall' in action && action['functionCall']) {
          void executeFunctionCall(
            processor,
            action['functionCall'] as never,
            surface.surfaceId,
            dataContextPath,
            { functions: functions as never },
          );
          return;
        }
        let name = 'unknownAction';
        let context: Record<string, unknown> = {};
        const event = action['event'] as
          | { name?: string; context?: Record<string, unknown> }
          | undefined;
        if (event) {
          name = event.name ?? name;
          if (event.context) {
            const resolved: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(event.context)) {
              resolved[key] = resolveDynamicValue(processor, value, surface.surfaceId, dataContextPath, {
                functions: functions as never,
              });
            }
            context = resolved;
          }
        }
        void processor.dispatch({
          userAction: {
            name,
            surfaceId: surface.surfaceId,
            sourceComponentId: id,
            timestamp: new Date().toISOString(),
            context,
          },
        });
      },
    };
  }
}
