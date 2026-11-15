// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Per-surface-component A2UI session — the framework-agnostic bookkeeping
 * that `<A2UI>` (the ReactLynx component in `@lynx-js/genui/a2ui/react`)
 * keeps in refs, lifted into a plain class so the Angular renderer can own
 * one per `A2uiSurface` instance. Faithful port of that wiring:
 *
 *  - `beginRendering` events complete a per-`messageId` resource and make it
 *    the active surface;
 *  - `surfaceUpdate` events complete the per-component resources the node
 *    renderers subscribe to;
 *  - `deleteSurface` completes the root's resource with a delete payload;
 *  - `userAction` protocol events are forwarded to the host `onAction`
 *    callback (fire-and-forget; responses come back through the message
 *    buffer, never through a return channel).
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

export class A2uiSession {
  readonly processor = new MessageProcessor();

  private readonly resources = new Map<string, Resource>();
  private activeMessageId: string | null = null;
  private processedCount = 0;
  private readonly disposers: Array<() => void> = [];
  private readonly activeListeners = new Set<() => void>();

  onAction?: (action: UserActionPayload) => void;

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
      this.processor.onEvent(({ message, resolve }) => {
        // No response channel from the renderer back into the protocol —
        // responses arrive via the message buffer.
        resolve([]);
        if (
          typeof message === 'object' && message !== null
          && 'userAction' in message && message['userAction']
        ) {
          try {
            this.onAction?.(message['userAction'] as UserActionPayload);
          } catch (e) {
            console.error('[a2ui] onAction handler threw:', e);
          }
        }
      }),
    );
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
    const slice = messages.slice(this.processedCount) as ServerToClientMessage[];
    this.processedCount = messages.length;
    if (slice.length > 0) this.processor.processMessages(slice);
  }

  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers.length = 0;
    this.activeListeners.clear();
  }

  private notifyActive(): void {
    for (const cb of this.activeListeners) cb();
  }
}
