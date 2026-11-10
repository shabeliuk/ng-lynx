// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * `<openui-renderer>` — the Angular counterpart of upstream `OpenUiRenderer`:
 * give it raw OpenUI-language output (complete or still streaming) and a
 * library, and it parses + renders the component tree, manages form state,
 * and emits structured actions.
 *
 * ```html
 * <openui-renderer [response]="llmText" [library]="library" (action)="onAction($event)" />
 * ```
 *
 * Passing `toolProvider` opts into upstream's *runtime* mode: `Query()` /
 * `Mutation()` statements evaluate for real against it, `@Run`/`@Set`/
 * `@Reset` ActionPlan steps execute (see `OpenUiState`'s doc for exactly
 * how), and `initialState`/`stateUpdate` round-trip `$variable` + form state
 * across sessions. Without it, behavior is unchanged from before: parsing,
 * `$state` evaluation, form state, and both action shapes (ActionPlan steps
 * + legacy) all work; `Query`/`Mutation`/`@Run`/`@Set`/`@Reset` simply have
 * nothing to call and act as documented no-ops (query/mutation results
 * never resolve; `@Run` on a query is a harmless invalidate-nothing).
 *
 * ```html
 * <openui-renderer
 *   [response]="llmText"
 *   [library]="library"
 *   [toolProvider]="{ list_items: (args) => fetch(...).then(r => r.json()) }"
 *   [initialState]="{ '$title': 'Draft' }"
 *   (stateUpdate)="persist($event)"
 *   (action)="onAction($event)"
 * />
 * ```
 *
 * See docs/28-genui.md.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  EventEmitter,
  forwardRef,
  Input,
  NO_ERRORS_SCHEMA,
  OnDestroy,
  Output,
  signal,
  Type,
} from '@angular/core';

import type { ActionEvent, Library, ParseResult, Parser } from '@openuidev/lang-core';
import { createParser } from '@openuidev/lang-core';

import { OPENUI_RENDERER_CONTEXT, OpenuiRendererContext } from './context.js';
import { OpenuiNode } from './node.directive.js';
import { OpenUiState, type OpenUiToolProviderInput } from './state.js';

@Component({
  selector: 'openui-renderer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OpenuiNode],
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    { provide: OPENUI_RENDERER_CONTEXT, useExisting: forwardRef(() => OpenuiRenderer) },
  ],
  template: `
    @if (root(); as node) {
      <view class="OpenUIRenderer">
        <ng-container [openuiNode]="node" />
      </view>
    }
  `,
})
export class OpenuiRenderer implements OpenuiRendererContext, OnDestroy {
  /** Raw OpenUI-language text (may be partial while streaming). */
  @Input({ required: true })
  set response(text: string) {
    this.responseSignal.set(text);
  }
  /** Component library the generated UI may use. */
  @Input({ required: true })
  set library(library: Library<Type<unknown>>) {
    this.librarySignal.set(library);
  }
  /** Whether the LLM is still streaming (disables action taps upstream). */
  @Input()
  set streaming(value: boolean) {
    this.streamingSignal.set(value);
  }
  /** Tool backend for `Query()`/`Mutation()` — a function map or a `ToolProvider`. Opts into runtime mode. */
  @Input()
  set toolProvider(value: OpenUiToolProviderInput | null | undefined) {
    this.state.setToolProvider(value);
  }
  /** Restore `$variable` + form state from an earlier `stateUpdate` snapshot. */
  @Input()
  set initialState(value: Record<string, unknown> | undefined) {
    this.initialStateSignal.set(value);
  }
  /** Structured actions from generated UI — forward to your agent. */
  @Output() readonly action = new EventEmitter<ActionEvent>();
  /** Latest parse result (validation errors, unresolved refs, …). */
  @Output() readonly parseResult = new EventEmitter<ParseResult>();
  /** Fires with the full form-state snapshot whenever it changes — persist for `initialState` on reload. */
  @Output() readonly stateUpdate = new EventEmitter<Record<string, unknown>>();

  readonly state = new OpenUiState();
  readonly formName: undefined;

  private readonly responseSignal = signal('');
  private readonly librarySignal = signal<Library<Type<unknown>> | undefined>(undefined);
  private readonly streamingSignal = signal(false);
  private readonly initialStateSignal = signal<Record<string, unknown> | undefined>(undefined);
  private parser: Parser | undefined;
  private parserLibrary: Library<Type<unknown>> | undefined;

  readonly isStreaming = this.streamingSignal.asReadonly();
  /** True while any `Query()` registered by the current response is loading. */
  readonly isQueryLoading = this.state.isQueryLoading;

  private readonly result = computed<ParseResult | null>(() => {
    const library = this.librarySignal();
    if (!library) return null;
    if (!this.parser || this.parserLibrary !== library) {
      this.parser = createParser(library.toJSONSchema(), library.root);
      this.parserLibrary = library;
    }
    const parsed = this.parser.parse(this.responseSignal());
    this.parseResult.emit(parsed);
    return parsed;
  });

  readonly root = computed(() => this.result()?.root ?? null);

  // OpenuiRendererContext requires a concrete (non-undefined) library; the
  // template only renders once a parse result exists, which implies one.
  get library(): Library<Type<unknown>> {
    const library = this.librarySignal();
    if (!library) throw new Error('[openui] library input not set');
    return library;
  }

  constructor() {
    this.state.onAction = (event) => this.action.emit(event);

    let firedInitialStateUpdate = false;
    effect(() => {
      const formState = this.state.formState();
      if (firedInitialStateUpdate) this.stateUpdate.emit(formState);
      firedInitialStateUpdate = true;
    });

    // Seed $variable state from the parsed defaults (+ initialState), then
    // (re-)evaluate every Query()/Mutation() statement — re-runs whenever
    // the parse result changes OR form state changes (so a Query depending
    // on a $variable refetches when that variable is updated). Skipped
    // entirely while streaming, matching upstream.
    effect(() => {
      const result = this.result();
      const streaming = this.streamingSignal();
      this.state.formState();
      if (!result) return;
      this.state.initializeState(result.stateDeclarations, this.initialStateSignal());
      if (streaming) return;
      this.state.evaluateQueries(result.queryStatements);
      this.state.registerMutations(result.mutationStatements);
    });
  }

  ngOnDestroy(): void {
    this.state.dispose();
  }
}
