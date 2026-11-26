// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * `<a2ui-surface>` — the Angular counterpart of the all-in-one ReactLynx
 * `<A2UI>` component, for A2UI v1.0.
 *
 * Owns one {@link A2uiSession} (a `MessageProcessor` plus resource
 * bookkeeping) per message store, consumes raw protocol messages from a
 * developer-supplied `MessageStore`, renders the most recent surface, and
 * emits user actions through the `action` output.
 *
 *  - The catalog is registered on the processor under `catalogId` (default
 *    {@link A2UI_DEFAULT_CATALOG_ID}); a surface renders only when its
 *    `createSurface.catalogId` names it, as in upstream.
 *  - `messageHandler` is the transport for everything the renderer sends the
 *    agent: actions, protocol errors, agent function calls and renderer
 *    function responses (upstream's `onMessage`). Its promise settles the
 *    send. `action` is a convenience output with just the user actions.
 *  - `[messageStore]="null"` renders nothing. Passing a different store
 *    starts a fresh session (a new processor); responses to actions come
 *    back through the same store.
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
  type Type,
} from '@angular/core';

import type { MessageStore, Surface, UserActionPayload } from '@lynx-js/genui/a2ui/store';

import type { A2uiCatalog } from './catalog.js';
import { A2UI_DEFAULT_CATALOG_ID, resolveA2uiCatalog } from './catalog.js';
import { A2UI_SURFACE_CONTEXT, A2uiSurfaceContext } from './node-context.js';
import { A2uiNode } from './node.directive.js';
import { type A2uiOutgoingMessage, A2uiSession } from './session.js';

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
  /**
   * Raw protocol message buffer the transport pushes into. `null` renders
   * nothing; a different store starts a fresh session.
   */
  @Input({ required: true })
  set messageStore(store: MessageStore | null) {
    if (store === this.store) return;
    this.store = store;
    // The first store waits for ngOnInit, so every input is set before any
    // message is processed.
    if (this.initialized) this.startSession(store);
  }
  get messageStore(): MessageStore | null {
    return this.store;
  }

  /** Components and functions generated UI is allowed to use. */
  @Input({ required: true })
  set catalog(catalog: A2uiCatalog) {
    this.catalogSignal.set(catalog);
    this.session?.registerCatalog(this.catalogIdValue, catalog);
  }

  /** The id surfaces name in `createSurface.catalogId` to use {@link catalog}. */
  @Input()
  set catalogId(id: string | null | undefined) {
    this.catalogIdValue = id ?? A2UI_DEFAULT_CATALOG_ID;
    this.session?.registerCatalog(this.catalogIdValue, this.catalogSignal());
  }
  get catalogId(): string {
    return this.catalogIdValue;
  }

  /**
   * Transport for every renderer → agent message (upstream `onMessage`). A
   * returned promise settles the send; a rejection fails pending agent
   * function calls.
   */
  @Input() messageHandler: ((outgoing: A2uiOutgoingMessage) => unknown) | null = null;

  /** Class applied to the surface root view. */
  @Input() surfaceClass = 'surface-root';

  /** User actions from rendered components — forward to your agent. */
  @Output() readonly action = new EventEmitter<UserActionPayload>();

  private store: MessageStore | null = null;
  private initialized = false;
  private catalogIdValue = A2UI_DEFAULT_CATALOG_ID;
  private readonly catalogSignal = signal<A2uiCatalog>({ components: [], functions: [] });
  private session: A2uiSession | null = null;
  private offSession: (() => void) | undefined;

  /** Bumped when the session or its active surface changes. */
  private readonly activeVersion = signal(0);
  readonly activeSurface = computed<Surface | null>(() => {
    this.activeVersion();
    return this.session?.activeSurface ?? null;
  });
  readonly rootComponent = computed(() => {
    const surface = this.activeSurface();
    const rootId = surface?.rootComponentId;
    return rootId ? (surface!.components.get(rootId) ?? null) : null;
  });

  // ── A2uiSurfaceContext (injected by A2uiNode via A2UI_SURFACE_CONTEXT) ──
  get componentsByName(): ReadonlyMap<string, Type<unknown>> {
    return this.resolvedCatalog();
  }
  get functions(): A2uiCatalog['functions'] {
    return this.catalogSignal().functions;
  }
  get processor(): A2uiSession['processor'] {
    if (!this.session) throw new Error('[a2ui] No message store, so no processor.');
    return this.session.processor;
  }

  private readonly resolvedCatalog = computed(() => resolveA2uiCatalog(this.catalogSignal()));

  ngOnInit(): void {
    this.initialized = true;
    this.startSession(this.store);
  }

  ngOnDestroy(): void {
    this.stopSession();
  }

  private startSession(store: MessageStore | null): void {
    this.stopSession();
    if (store) {
      const session = new A2uiSession();
      session.registerCatalog(this.catalogIdValue, this.catalogSignal());
      session.onAction = (action) => this.action.emit(action);
      session.onMessage = (outgoing) => this.messageHandler?.(outgoing);
      const offActive = session.onActiveChange(() => this.activeVersion.update((n) => n + 1));
      const offStore = store.subscribe(() => session.consume(store));
      this.session = session;
      this.offSession = () => {
        offStore();
        offActive();
        session.dispose();
      };
      session.consume(store);
    }
    this.activeVersion.update((n) => n + 1);
  }

  private stopSession(): void {
    this.offSession?.();
    this.offSession = undefined;
    this.session = null;
  }
}
