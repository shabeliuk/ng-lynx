/**
 * `ng-lynx/genui` — Angular renderer for Lynx GenUI's A2UI protocol.
 *
 * The framework-agnostic layers of `@lynx-js/genui` are consumed directly
 * (and re-exported here for convenience): the protocol store
 * (`@lynx-js/genui/a2ui/store` — `MessageStore`, `MessageProcessor`,
 * signals, resources) and the basic-catalog client functions
 * (`@lynx-js/genui/a2ui/functions`). What this entry adds is the Angular
 * counterpart of the ReactLynx render layer:
 *
 *  - {@link A2uiSurface} — `<a2ui-surface>` all-in-one renderer (≈ `<A2UI>`)
 *  - {@link A2uiNode} — recursive node renderer (≈ `NodeRenderer`)
 *  - {@link defineA2uiCatalog} — Angular catalog composition (≈ `defineCatalog`)
 *  - {@link A2UI_BASIC_CATALOG} — Angular ports of the basic-catalog components
 *  - {@link A2UI_NODE_CONTEXT} — the custom-component contract
 *    (≈ `GenericComponentProps` + `useAction`/`useDataBinding`)
 *
 * `@lynx-js/genui` is an optional peer — only apps importing this entry
 * need it installed. See docs/28-genui.md for the full guide, including
 * which upstream pieces are ported, reused, or intentionally out of scope.
 */
export {
  defineA2uiCatalog,
  resolveA2uiCatalog,
  type A2uiCatalog,
  type A2uiCatalogInput,
  type A2uiComponentEntry,
  type A2uiFunctionEntry,
} from './genui/catalog.js';
export {
  A2UI_NODE_CONTEXT,
  A2UI_SURFACE_CONTEXT,
  type A2uiNodeContext,
  type A2uiSurfaceContext,
} from './genui/node-context.js';
export { A2uiNode, A2uiUnsupportedNotice } from './genui/node.directive.js';
export { A2uiSurface } from './genui/surface.component.js';
export {
  A2UI_BASIC_CATALOG,
  A2uiButton,
  A2uiCard,
  A2uiCheckBox,
  A2uiColumn,
  A2uiDivider,
  A2uiImage,
  A2uiList,
  A2uiLoading,
  A2uiRow,
  A2uiSlider,
  A2uiText,
  A2uiTextField,
} from './genui/basic-catalog.js';
export {
  resolveBindingPath,
  resolveComponentProps,
  UNSUPPORTED_PROP,
  type ResolvedProps,
} from './genui/resolve-props.js';
export { A2uiSession } from './genui/session.js';

// Convenience re-exports of the reused framework-agnostic upstream layers,
// so apps can import everything genui-related from one place.
export {
  createMessageStore,
  MessageProcessor,
  normalizePayloadToMessages,
  type ComponentInstance,
  type MessageStore,
  type ServerToClientMessage,
  type Surface,
  type UserActionPayload,
} from '@lynx-js/genui/a2ui/store';

// ── OpenUI (Angular renderer over @openuidev/lang-core) ──
export {
  OPENUI_NODE_CONTEXT,
  OPENUI_RENDERER_CONTEXT,
  type OpenuiNodeContext,
  type OpenuiRendererContext,
} from './genui/openui/context.js';
export { OpenuiNode, OpenuiTextValue } from './genui/openui/node.directive.js';
export { OpenuiRenderer } from './genui/openui/renderer.component.js';
export { OpenUiState, type OpenUiLegacyAction } from './genui/openui/state.js';
export {
  createOpenUiLibrary,
  OpenuiButtonComponent,
  OpenuiCardComponent,
  OpenuiCardHeaderComponent,
  OpenuiCheckBoxComponent,
  OpenuiColumnComponent,
  OpenuiDividerComponent,
  OpenuiImageComponent,
  OpenuiButtonsComponent,
  OpenuiRowComponent,
  OpenuiSliderComponent,
  OpenuiStackComponent,
  OpenuiTagComponent,
  OpenuiTextComponent,
  OpenuiTextContentComponent,
  OpenuiTextFieldComponent,
  type CreateOpenUiLibraryOptions,
} from './genui/openui/basic-library.js';

// lang-core building blocks apps need alongside the renderer.
export {
  createLibrary,
  createParser,
  createStreamingParser,
  defineComponent,
  type ActionEvent,
  type ComponentGroup,
  type ElementNode,
  type Library,
  type ParseResult,
} from '@openuidev/lang-core';
