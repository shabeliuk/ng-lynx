// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Per-surface-component A2UI session — the framework-agnostic bookkeeping
 * that `<A2UI>` (the ReactLynx component in `@lynx-js/genui/a2ui/react`)
 * keeps in refs, lifted into a plain class so the Angular renderer can own
 * one per `A2uiSurface` instance. Faithful port of that wiring:
 *
 *  - `beginRendering` events (the processor emits one when a surface's
 *    `root` component first arrives) complete a per-`messageId` resource and
 *    make it the active surface;
 *  - `surfaceUpdate` events complete the per-component resources the node
 *    renderers subscribe to;
 *  - `deleteSurface` completes the root's resource with a delete payload;
 *  - every renderer → agent message (`action`, `error`, `callAgentFunction`,
 *    `rendererFunctionResponse`) goes to the host's `onMessage` transport,
 *    with the data-model metadata of surfaces that asked for it; the
 *    returned promise settles the processor's send. `action` messages also
 *    go to `onAction`. Responses come back through the message buffer.
 */
import type {
  MessageStore,
  Resource,
  ResourceInfo,
  ServerToClientMessage,
  Surface,
  UserActionPayload,
} from '@lynx-js/genui/a2ui/store';
import { createResource, MessageProcessor } from '@lynx-js/genui/a2ui/store';

import type { A2uiCatalog } from './catalog.js';

/**
 * A renderer → agent message, as the transport receives it.
 *
 * @experimental
 */
export interface A2uiOutgoingMessage {
  /** The v1.0 message: `{ version: '1.0', action | error | callAgentFunction | rendererFunctionResponse }`. */
  message: Record<string, unknown>;
  /** `{ a2uiRendererDataModel }` for surfaces created with `sendDataModel: true`. */
  metadata: Record<string, unknown>;
}

/** @experimental */
export class A2uiSession {
  readonly processor = new MessageProcessor();

  private readonly resources = new Map<string, Resource>();
  private activeMessageId: string | null = null;
  private processedCount = 0;
  private readonly disposers: Array<() => void> = [];
  private readonly activeListeners = new Set<() => void>();

  /** Called with each user action (the `action` of an outgoing message). */
  onAction?: (action: UserActionPayload) => void;
  /**
   * The transport: called with every outgoing message. A returned promise
   * settles the send (a rejection fails pending agent function calls).
   */
  onMessage?: (outgoing: A2uiOutgoingMessage) => unknown;

  constructor() {
    this.disposers.push(
      this.processor.onUpdate((data) => {
        const type = data['type'] as string;
        const surfaceId = data['surfaceId'] as string;
        const surface = this.processor.getOrCreateSurface(surfaceId);
        if (type === 'beginRendering') {
          const messageId = data['messageId'] as string;
          let resource = this.resources.get(messageId);
          if (!resource) {
            resource = createResource(messageId) as Resource;
            this.resources.set(messageId, resource);
          }
          resource.complete({ type: 'beginRendering', surfaceId, surface });
          this.activeMessageId = messageId;
          this.notifyActive();
        } else if (type === 'surfaceUpdate') {
          const updates = (data['updates'] ?? []) as Array<{ id?: string }>;
          for (const update of updates) {
            if (!update.id) continue;
            surface.resources.get(update.id)?.complete({
              type: 'surfaceUpdate',
              surfaceId,
              surface,
              component: update as ResourceInfo['component'],
            });
          }
        } else if (type === 'deleteSurface') {
          const targetId = (data['targetId'] as string | undefined) ?? surface.rootComponentId;
          if (targetId && surface.resources.has(targetId)) {
            surface.resources.get(targetId)!.complete({ type: 'deleteSurface', surfaceId, surface });
          }
          this.activeMessageId = null;
          this.notifyActive();
        }
      }),
      this.processor.onEvent(({ message, resolve, reject }) => {
        const outgoing = message as unknown as Record<string, unknown>;
        try {
          const pending = this.onMessage?.({
            message: outgoing,
            metadata: this.processor.getDataModelMetadata(),
          });
          void Promise.resolve(pending).then(
            () => resolve([]),
            (error: unknown) => {
              console.error('[a2ui] onMessage handler rejected:', error);
              reject(error);
            },
          );
        } catch (e) {
          console.error('[a2ui] onMessage handler threw:', e);
          reject(e);
        }
        if (outgoing['action']) {
          try {
            this.onAction?.(outgoing['action'] as UserActionPayload);
          } catch (e) {
            console.error('[a2ui] onAction handler threw:', e);
          }
        }
      }),
    );
  }

  /**
   * Register the catalog surfaces name in `createSurface.catalogId`.
   * Re-registering an id replaces it.
   */
  registerCatalog(catalogId: string, catalog: A2uiCatalog): void {
    this.processor.registerCatalog(catalogId, catalog as never);
  }

  /** The surface currently designated by the latest `beginRendering`. */
  get activeSurface(): Surface | null {
    if (!this.activeMessageId) return null;
    const snapshot = this.resources.get(this.activeMessageId)?.getSnapshot();
    const info = snapshot?.value as ResourceInfo | undefined;
    return info?.surface ?? null;
  }

  /** Subscribe to active-surface changes (begin/delete). */
  onActiveChange(cb: () => void): () => void {
    this.activeListeners.add(cb);
    return () => this.activeListeners.delete(cb);
  }

  /** Feed any new tail messages from the buffer into the processor. */
  consume(store: MessageStore): void {
    const messages = store.getSnapshot();
    if (messages.length === this.processedCount) return;
    if (messages.length < this.processedCount) {
      // The buffer was cleared: what's left is new.
      this.processedCount = 0;
    }
    const slice = messages.slice(this.processedCount) as ServerToClientMessage[];
    this.processedCount = messages.length;
    if (slice.length > 0) this.processor.processMessages(slice);
  }

  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers.length = 0;
    this.activeListeners.clear();
    this.processor.clearSurfaces();
  }

  private notifyActive(): void {
    for (const cb of this.activeListeners) cb();
  }
}
