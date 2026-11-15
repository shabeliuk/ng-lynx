/**
 * Catalog-facing contracts for `harness-genui-tools.ts`.
 *
 * These interfaces play the role a custom Angular catalog component's public
 * contract plays in a real app: the `@a2uiCatalog` tag makes the extractor
 * turn each one into A2UI catalog JSON, and `@a2uiFunction` exposes a
 * client-side function schema. The extractor consumes TypeDoc reflection
 * data, so it is framework-agnostic — nothing here needs Angular to compile,
 * which is exactly what makes the tool reusable from an ng-lynx repo.
 */

/**
 * Product card rendered by the Angular catalog component `ProductCardComponent`.
 *
 * @a2uiCatalog ProductCard
 */
export interface ProductCardProps {
  /** Product title text or data binding. */
  title: string | { path: string };
  /** Price in the surface's display currency. */
  price: number | { path: string };
  /** Visual emphasis used by the renderer. */
  tone?: 'neutral' | 'accent' | 'warning';
  /**
   * Badge labels shown under the title.
   *
   * @defaultValue `[]`
   */
  badges?: string[];
}

/**
 * Compact rating row with a star count and an optional caption.
 *
 * @a2uiCatalog RatingRow
 */
export interface RatingRowProps {
  /** Star count from 0 to 5. */
  stars: number | { path: string };
  /** Caption rendered after the stars. */
  caption?: string;
}

/**
 * Format a price for display in the user's locale.
 *
 * @a2uiFunction formatPrice
 * @param amount - Raw numeric amount.
 * @param currency - ISO 4217 currency code.
 * @returns The formatted price string.
 */
export function formatPrice(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}
