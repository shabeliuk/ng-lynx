// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * `<a2ui-surface>` — the Angular counterpart of the all-in-one ReactLynx
 * `<A2UI>` component.
 *
 * Owns one {@link A2uiSession} (a `MessageProcessor` plus resource
 * bookkeeping) per component instance, consumes raw protocol messages from a
 * developer-supplied `MessageStore`, renders the most recent
 * `beginRendering` surface, and emits user actions through the `action`
 * output. As upstream documents for `<A2UI>`: the processor lives for the
 * component's whole life — to start a fresh session, destroy and recreate
 * the component (e.g. keyed `@if`), and treat `action` as fire-and-forget:
 * agent responses come back through the same `MessageStore`.
 *
 * ```html
 * <a2ui-surface [messageStore]="store" [catalog]="catalog" (action)="onAction($event)" />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  forwardRef,
  Input,
  NO_ERRORS_SCHEMA,
  OnDestroy,
  OnInit,
  Output,
  signal,
} from '@angular/core';

import type { MessageStore, Surface, UserActionPayload } from '@lynx-js/genui/a2ui/store';

import type { A2uiCatalog } from './catalog.js';
import { resolveA2uiCatalog } from './catalog.js';
import { A2UI_SURFACE_CONTEXT, A2uiSurfaceContext } from './node-context.js';
import { A2uiNode } from './node.directive.js';
import { A2uiSession } from './session.js';

/** @experimental */
@Component({
  selector: 'a2ui-surface',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A2uiNode],
  schemas: [NO_ERRORS_SCHEMA],
  providers: [{ provide: A2UI_SURFACE_CONTEXT, useExisting: forwardRef(() => A2uiSurface) }],
  template: `
    @if (activeSurface(); as surface) {
      @if (rootComponent(); as root) {
        <view [id]="'surface-' + surface.surfaceId" [class]="surfaceClass">
          <ng-container [a2uiNode]="root" [a2uiNodeSurface]="surface" />
        </view>
      }
    }
  `,
})
export class A2uiSurface implements A2uiSurfaceContext, OnInit, OnDestroy {
  /** Raw protocol message buffer the transport pushes into. */
  @Input({ required: true }) messageStore!: MessageStore;
  /** Components and functions generated UI is allowed to use. */
  @Input({ required: true })
  set catalog(catalog: A2uiCatalog) {
    this.catalogSignal.set(catalog);
  }
  /** Class applied to the surface root view. */
  @Input() surfaceClass = 'surface-root';
  /** User actions from rendered components — forward to your agent. */
  @Output() readonly action = new EventEmitter<UserActionPayload>();

  private readonly catalogSignal = signal<A2uiCatalog>({ components: [], functions: [] });

  private readonly session = new A2uiSession();
  private offStore: (() => void) | undefined;
  private offActive: (() => void) | undefined;

  /** Bumped when the session's active surface changes. */
  private readonly activeVersion = signal(0);
  readonly activeSurface = computed<Surface | null>(() => {
    this.activeVersion();
    return this.session.activeSurface;
  });
  readonly rootComponent = computed(() => {
    const surface = this.activeSurface();
    const rootId = surface?.rootComponentId;
    return rootId ? (surface!.components.get(rootId) ?? null) : null;
  });

  // ── A2uiSurfaceContext (injected by A2uiNode via A2UI_SURFACE_CONTEXT) ──
  get componentsByName(): ReadonlyMap<string, import('@angular/core').Type<unknown>> {
    return this.resolvedCatalog();
  }
  get functions(): A2uiCatalog['functions'] {
    return this.catalogSignal().functions;
  }
  get processor(): A2uiSession['processor'] {
    return this.session.processor;
  }

  private readonly resolvedCatalog = computed(() => resolveA2uiCatalog(this.catalogSignal()));

  constructor() {
    this.session.onAction = (action) => this.action.emit(action);
    this.offActive = this.session.onActiveChange(() => {
      this.activeVersion.update((n) => n + 1);
    });
  }

  ngOnInit(): void {
    // Wired once for the component's life. The upstream caveat applies even
    // harder here: swapping `messageStore` mid-life does NOT reset the
    // processor upstream, so this port doesn't support swapping at all —
    // destroy and recreate the component for a fresh session.
    const store = this.messageStore;
    this.offStore = store.subscribe(() => this.session.consume(store));
    this.session.consume(store);
  }

  ngOnDestroy(): void {
    this.offStore?.();
    this.offActive?.();
    this.session.dispose();
  }
}
