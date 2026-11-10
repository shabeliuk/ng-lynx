/**
 * State-preserving component hot-swap — the runtime half of full HMR
 * (docs/31-hot-swap.md).
 *
 * Since Angular 19, `@angular/core` ships
 * `ɵɵreplaceMetadata` — the exact runtime primitive Angular CLI's own
 * dev-server HMR uses for template/style edits. Given a live component class
 * and a function that installs a *new* compiled definition on it, it:
 *
 *   1. swaps the definition **in place** (keeping the original `type`,
 *      `setInput`, and resolved `directiveDefs`/`pipeDefs`);
 *   2. walks every tracked root view, finds each `LView` rendered with the
 *      old definition, and rebuilds it — **reusing the existing component
 *      instance** (`lView[CONTEXT]` is passed straight into the replacement
 *      `createLView`), so signals, fields, and injected services all survive;
 *   3. renders the replacement through the environment's `RendererFactory2` —
 *      which for us is the Lynx renderer, so the teardown + rebuild flows to
 *      the Main Thread as ordinary REMOVE/DESTROY + CREATE/INSERT ops in one
 *      batch (every mutation schedules the microtask flush; see flush.ts).
 *
 * Nothing in that path needs a DOM (the one `document`-touching branch is
 * ShadowDom-encapsulation-only, which Lynx never uses), and root-view
 * tracking is unconditional — it works with the `ngDevMode: false` define our
 * Lynx bundles require. Verified headlessly (`npm run verify:hmr`) and in the
 * real dual-thread web preview.
 *
 * What this module deliberately does NOT do: the *transport* — watching
 * source files, compiling an updated definition, and delivering it to the
 * Background Thread. That lives in the dev client (dev-reload-client.ts),
 * which consumes rspack's hot-update assets on each rebuild and drives this
 * primitive for exactly the components whose compiled templates changed —
 * the full save-to-swap dev loop on the `web` preview. (Angular CLI's own
 * flow is Vite-coupled — an `import.meta.hot` listener that
 * dynamic-`import()`s `/@ng/component?c=…` — and unusable in the BG worker;
 * docs/31-hot-swap.md has the full story.)
 */
import { Type, ɵgetComponentDef, ɵNG_COMP_DEF, ɵɵreplaceMetadata } from '@angular/core';

/**
 * Replace the compiled definition of the live component class `type` with the
 * definition of `next`, rebuilding every rendered view of `type` in place
 * while **preserving the existing component instances** (state, signals,
 * injected services). `next` is a donor: a class with the same shape (same
 * fields the template binds to) carrying the new template metadata — compiled
 * by AOT like any other component, or by JIT in JIT builds.
 *
 * Semantics (inherited from Angular's own HMR): template/style-level changes
 * only. The instance is not re-constructed, inputs keep their values, and the
 * definition keeps the original resolved `directiveDefs`/`pipeDefs` — a new
 * template may only use dependencies the original already imported. Logic
 * changes (constructor, methods, providers) still need a full reload.
 *
 * @public
 */
export function hotSwapComponent(type: Type<unknown>, next: Type<unknown>): void {
  const nextDef = ɵgetComponentDef(next);
  if (nextDef === null) {
    throw new Error(
      `[angular-lynx] hotSwapComponent: ${next.name} has no component definition — `
        + 'is it a @Component (and, in JIT builds, already compiled)?',
    );
  }
  const applyMetadata = (target: Type<unknown>): void => {
    // A fresh shallow copy with `tView: null`: `ɵɵreplaceMetadata` merges this
    // object's fields into the live definition, and a null tView forces the
    // first render after the swap to build a fresh template view rather than
    // reusing one cached from `next` having been rendered somewhere itself.
    //
    // Plain assignment, deliberately: an AOT def is a writable static field,
    // and a JIT def is an accessor **with a setter** — both accept assignment,
    // while `Object.defineProperty` throws on the JIT accessor whenever
    // ngDevMode is false (it's defined `configurable: !!ngDevMode`).
    (target as unknown as Record<string, unknown>)[ɵNG_COMP_DEF as string] = { ...nextDef, tView: null };
  };
  ɵɵreplaceMetadata(type, applyMetadata, [], []);
}
