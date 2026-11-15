/**
 * Main-Thread element registry.
 *
 * Maps Background-Thread {@link ShadowElement} ids to the real Lynx element
 * handles created via the element PAPI. The page root is seeded at id=1 by
 * `renderPage` in entry-main.ts.
 */

/** Map from BG-thread ShadowElement id → Lynx Main-Thread element handle. */
export const elements = new Map<number, LynxElement>();

/**
 * PAPI unique id of the root PageElement. Passed as `parentComponentUniqueId`
 * to element-creation PAPI calls. `__SetCSSId` sets the style-sheet manager on
 * each element directly, so CSS works without a ComponentElement ancestor.
 */
export let pageUniqueId = 1;

export function setPageUniqueId(id: number): void {
  pageUniqueId = id;
}
