/**
 * Text queries over the mock native tree, in the spirit of Testing Library:
 * `getByText` and friends return the **element** that shows the text, and
 * `within(el)` scopes every query to one subtree.
 */
import { findAllByClass, findByClass, findByType, type MockEl, printTree } from './mock-papi.js';

/** A text to find: the whole text (trimmed, whitespace collapsed), or a pattern. @public */
export type LynxTextMatch = string | RegExp;

/** Options for the text queries. @public */
export interface LynxTextMatchOptions {
  /**
   * `true` (the default): a string must equal the element's whole text.
   * `false`: a case-insensitive substring is enough.
   */
  exact?: boolean;
}

/** Text queries and element queries, scoped to one subtree. @public */
export interface LynxQueries {
  /** The one element showing `text`. Throws if none, or more than one, does. */
  getByText(text: LynxTextMatch, options?: LynxTextMatchOptions): MockEl;
  /** Like {@link getByText}, but `null` when nothing matches. Still throws on several. */
  queryByText(text: LynxTextMatch, options?: LynxTextMatchOptions): MockEl | null;
  /** Every element showing `text`, in document order. Throws if none does. */
  getAllByText(text: LynxTextMatch, options?: LynxTextMatchOptions): MockEl[];
  /** Every element showing `text`, in document order; empty when none does. */
  queryAllByText(text: LynxTextMatch, options?: LynxTextMatchOptions): MockEl[];
  /** First element carrying the class. */
  findByClass(cls: string): MockEl | undefined;
  /** Every element carrying the class, in document order. */
  findAllByClass(cls: string): MockEl[];
  /** First element of a native type (`'view'`, `'input'`, …). */
  findByType(type: string): MockEl | undefined;
}

const RAW_TEXT = '#raw-text';

/**
 * The text an element shows: its own `text` plus every text node below it,
 * trimmed, with runs of whitespace collapsed to one space.
 *
 * @public
 */
export function textContent(el: MockEl): string {
  const parts: string[] = [];
  const walk = (node: MockEl): void => {
    if (node.text != null) parts.push(node.text);
    for (const child of node.children) walk(child);
  };
  walk(el);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** An element that shows text itself, rather than only through its children's elements. */
function showsText(el: MockEl): boolean {
  if (el.type === RAW_TEXT) return false;
  return el.text != null || el.children.some((child) => child.type === RAW_TEXT);
}

function matches(el: MockEl, text: LynxTextMatch, options: LynxTextMatchOptions): boolean {
  const content = textContent(el);
  if (typeof text !== 'string') return text.test(content);
  if (options.exact === false) return content.toLowerCase().includes(text.toLowerCase());
  return content === text.replace(/\s+/g, ' ').trim();
}

function describe(text: LynxTextMatch, options: LynxTextMatchOptions): string {
  if (typeof text !== 'string') return String(text);
  return options.exact === false ? `"${text}" (substring)` : `"${text}"`;
}

/**
 * Every matching element, innermost only: `<text>Count: <inline-text>2</inline-text></text>`
 * matches "2" at the `<inline-text>`, not again at the `<text>` around it.
 */
function allByText(root: MockEl, text: LynxTextMatch, options: LynxTextMatchOptions): MockEl[] {
  const out: MockEl[] = [];
  const walk = (el: MockEl): boolean => {
    let childMatched = false;
    for (const child of el.children) childMatched = walk(child) || childMatched;
    if (!childMatched && showsText(el) && matches(el, text, options)) {
      out.push(el);
      return true;
    }
    return childMatched;
  };
  walk(root);
  // Collected children-first; put them back in document order.
  const order = new Map<MockEl, number>();
  let index = 0;
  const number = (el: MockEl): void => {
    order.set(el, index++);
    el.children.forEach(number);
  };
  number(root);
  return out.sort((a, b) => order.get(a)! - order.get(b)!);
}

/**
 * The query set for one subtree: `within(fixture.findByClass('card')!).getByText('Buy')`.
 *
 * @public
 */
export function within(root: MockEl): LynxQueries {
  const fail = (message: string): never => {
    throw new Error(`[angular-lynx/testing] ${message}\n\n${printTree(root).join('\n')}`);
  };
  const queryAllByText = (text: LynxTextMatch, options: LynxTextMatchOptions = {}): MockEl[] =>
    allByText(root, text, options);
  const queryByText = (text: LynxTextMatch, options: LynxTextMatchOptions = {}): MockEl | null => {
    const found = queryAllByText(text, options);
    if (found.length > 1) fail(`${found.length} elements show ${describe(text, options)}; use getAllByText.`);
    return found[0] ?? null;
  };
  return {
    queryAllByText,
    queryByText,
    getAllByText: (text, options = {}) => {
      const found = queryAllByText(text, options);
      if (found.length === 0) fail(`no element shows ${describe(text, options)}.`);
      return found;
    },
    getByText: (text, options = {}) =>
      queryByText(text, options) ?? fail(`no element shows ${describe(text, options)}.`),
    findByClass: (cls) => findByClass(root, cls),
    findAllByClass: (cls) => findAllByClass(root, cls),
    findByType: (type) => findByType(root, type),
  };
}
