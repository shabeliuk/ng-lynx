/**
 * Applies the stylesheet of a bundle `lynx.fetchBundle` downloaded: its `CSS` custom
 * section, which is how a `dynamicComponentFetcher: 'fetch-bundle'` bundle carries
 * the CSS its components import. The engine doesn't apply it by itself (measured on
 * Explorer 4.2, iOS simulator): ReactLynx's loader adopts it with these two calls
 * from the Main Thread, and so does this.
 */

/**
 * Load the bundle's `CSS` section and adopt it into the page. A bundle with no CSS
 * has no such section, which `__LoadStyleSheet` answers with `null`. An engine
 * without the two calls (the web preview) applies a bundle's styles itself.
 */
export function applyAdoptStyleSheet({ bundleName, section }: { bundleName: string; section?: string }): void {
  if (typeof __LoadStyleSheet !== 'function' || typeof __AdoptStyleSheet !== 'function') return;
  const sheet = __LoadStyleSheet(section ?? 'CSS', bundleName);
  if (sheet !== null && sheet !== undefined) __AdoptStyleSheet(sheet);
}
