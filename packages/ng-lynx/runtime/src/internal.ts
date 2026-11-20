/**
 * `ng-lynx/internal/runtime`: the runtime's own hooks, for `ng-lynx/testing` and the
 * package's harnesses. Not part of the public API and not covered by semver: anything
 * here can change in any release.
 *
 * @internal
 */
export { flushOps } from './flush.js';
export { resetGestureState } from './gesture.js';
export { installHostData, resetHostDataState } from './host-data.js';
export { installLifecycle, resetAppEventsState } from './app-events.js';
export { installIntersectionObserver } from './visibility.js';
export { resetOpLogger } from './op-logger.js';
export { getPageRoot, resetShadowTreeState } from './shadow-element.js';
export { resetRegistry as resetEventRegistry, publishEvent, registeredSignCount } from './event-registry.js';
export { elementListenerCount } from './element-events.js';
export { threadCallSizes } from './thread-calls.js';
export { resetPendingStyleClass } from './pending-style.js';
