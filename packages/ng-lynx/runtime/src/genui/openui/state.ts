// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * OpenUI renderer state — the Angular counterpart of the form-state, action,
 * and Query/Mutation wiring inside upstream `@lynx-js/genui/openui`'s
 * `useOpenUIState` hook (the "runtime" mode `OpenUiRenderer` uses when given
 * `toolProvider`/`response`, as opposed to its `result`-only "parsed" mode).
 *
 * Faithful port of `getFieldValue` / `setFieldValue` / `triggerAction`, with
 * React `useState`/refs replaced by one Angular signal holding the
 * form-state record (drives zoneless re-evaluation of dynamic props).
 * ActionPlan (v0.5 `steps`) and legacy single-action shapes are both
 * handled. `Run`/`Set`/`Reset` steps — unsupported in the previous
 * "parsed"-only port — now execute for real:
 *
 *  - `run` (query): `queryManager.invalidate([statementId])` forces a
 *    refetch; `run` (mutation): evaluates the mutation's args and awaits
 *    `queryManager.fireMutation(...)`, halting the rest of the plan on
 *    failure (matches upstream's `useOpenUIState`);
 *  - `set`: evaluates the step's `valueAST` and writes it to the named
 *    `$variable` (through the same path `setFieldValue` already uses for
 *    top-level names, so it's visible to both `getState` and query deps).
 *    Steps read state live from the signal, so a `Set` sees an earlier
 *    `Set` or field edit in the same plan; genui 0.7 had to add an
 *    `actionContext` to `useOpenUIState` to get the same from React;
 *  - `reset`: restores each named `$variable` to its parsed default
 *    (`stateDeclarations`, captured by {@link initializeState}).
 *
 * `queryManager` (`@openuidev/lang-core`'s `createQueryManager` — the same
 * framework-agnostic Query/Mutation engine upstream uses) is created once
 * and kept for the state's lifetime; the `toolProvider` it calls through is
 * a stable indirection cell ({@link setToolProvider}) so the *renderer's*
 * `toolProvider` input can change without tearing down in-flight query
 * state — mirrors upstream's `toolProviderInputRef` + `stableToolProvider`
 * pattern (a ref read fresh on every call) rather than a memo keyed on the
 * provider's identity.
 */
import { computed, signal } from '@angular/core';

import {
  ACTION_STEPS,
  type ActionEvent,
  type ActionPlan,
  type ActionStep,
  BuiltinActionType,
  createQueryManager,
  createStore,
  evaluate,
  type EvaluationContext,
  type MutationNode,
  type MutationStatementInfo,
  type QueryManager,
  type QueryNode,
  type QuerySnapshot,
  type QueryStatementInfo,
  type Store,
  ToolNotFoundError,
  type ToolProvider,
} from '@openuidev/lang-core';

import { registerOpenUiBuiltins } from './builtins.js';

interface FieldEntry {
  value: unknown;
  componentType?: string;
}

type FormState = Record<string, unknown>;

function createFieldEntry(value: unknown, componentType?: string): FieldEntry {
  return componentType === undefined ? { value } : { value, componentType };
}

function isFieldEntry(value: unknown): value is FieldEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'value' in value;
}

function isFieldMap(value: unknown): value is Record<string, FieldEntry> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => isFieldEntry(entry))
  );
}

/**
 * Legacy (non-plan) action shape produced by generated `Action(...)` props.
 *
 * @experimental
 */
export interface OpenUiLegacyAction {
  type?: string;
  params?: Record<string, unknown>;
  url?: string;
  context?: unknown;
}

/**
 * Accepts either a plain `{ toolName: (args) => Promise<result> }` map or a `ToolProvider`.
 *
 * @experimental
 */
export type OpenUiToolProviderInput =
  | ToolProvider
  | Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

function normalizeToolProvider(input: OpenUiToolProviderInput | null | undefined): ToolProvider | null {
  if (!input) return null;
  if (typeof (input as ToolProvider).callTool === 'function') return input as ToolProvider;
  const map = input as Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  return {
    async callTool(toolName, args) {
      const fn = map[toolName];
      if (!fn) throw new ToolNotFoundError(toolName, Object.keys(map));
      return await fn(args);
    },
  };
}

/** @experimental */
export class OpenUiState {
  /** Raw form-state record; components read via {@link getFieldValue}. */
  readonly formState = signal<FormState>({});
  /** lang-core reactive store backing `$state` refs in evaluation. */
  readonly store: Store = createStore();

  private readonly toolProviderRef: { current: ToolProvider | null } = { current: null };
  /** Query()/Mutation() engine — created once; see the class doc for why. */
  readonly queryManager: QueryManager = createQueryManager({
    callTool: (toolName, args) => {
      const provider = this.toolProviderRef.current;
      if (!provider) throw new Error(`[openui] toolProvider is not set (tool "${toolName}")`);
      return provider.callTool(toolName, args);
    },
  });
  private readonly querySnapshotSignal = signal<QuerySnapshot>(this.queryManager.getSnapshot());
  /** True while any registered Query is loading — drives a loading affordance. */
  readonly isQueryLoading = computed(() => this.querySnapshotSignal().__openui_loading.length > 0);
  private readonly unsubscribeQueryManager: () => void;

  /** `$variable` → parsed default, captured by {@link initializeState}; the `reset` step restores from here. */
  private stateDeclarations: Record<string, unknown> = {};
  private latestMutationStatements: MutationStatementInfo[] = [];
  private storeInitKey: string | undefined;

  /** AST evaluation context resolving `$state` reads and Query/Mutation-result refs. */
  readonly evaluationContext: EvaluationContext = {
    getState: (name: string) => this.getFieldValue(undefined, name),
    resolveRef: (name: string) => {
      this.querySnapshotSignal();
      return this.queryManager.getMutationResult(name) ?? this.queryManager.getResult(name);
    },
  };

  onAction?: (event: ActionEvent) => void;

  constructor() {
    registerOpenUiBuiltins();
    this.queryManager.activate();
    this.unsubscribeQueryManager = this.queryManager.subscribe(() => {
      this.querySnapshotSignal.set(this.queryManager.getSnapshot());
    });
  }

  /** Set (or clear) the tool backend Query()/Mutation() calls go through — see the class doc. */
  setToolProvider(input: OpenUiToolProviderInput | null | undefined): void {
    this.toolProviderRef.current = normalizeToolProvider(input);
  }

  /**
   * Seed `$variable` state from the parser's `stateDeclarations` plus any
   * caller-supplied `initialState`, deduped by content (≈ upstream's
   * `storeInitKeyRef`) so a re-render with the same inputs is a no-op.
   * `initialState`'s `$`-prefixed keys are raw values (assigned into the
   * store); its other keys are restored as-is, matching {@link formState}'s
   * own wrapped-entry shape (round-tripped from an earlier `formState()`
   * snapshot via `stateUpdate`).
   */
  initializeState(stateDeclarations: Record<string, unknown>, initialState: Record<string, unknown> | undefined): void {
    const key = `${JSON.stringify(stateDeclarations)}::${JSON.stringify(initialState ?? {})}`;
    if (this.storeInitKey === key) return;
    this.storeInitKey = key;
    this.stateDeclarations = stateDeclarations;
    const next: FormState = {};
    if (initialState) {
      for (const [name, value] of Object.entries(initialState)) {
        next[name] = name.startsWith('$') ? createFieldEntry(value) : value;
      }
    }
    for (const [name, value] of Object.entries(stateDeclarations)) {
      if (!(name in next)) next[name] = createFieldEntry(value);
    }
    for (const [name, entry] of Object.entries(next)) {
      if (name.startsWith('$') && isFieldEntry(entry)) this.store.set(name, entry.value);
    }
    this.formState.set(next);
  }

  /** Evaluate every Query() statement and hand the results to {@link queryManager}. */
  evaluateQueries(queryStatements: readonly QueryStatementInfo[]): void {
    const storeSnapshot = this.store.getSnapshot();
    const nodes: QueryNode[] = queryStatements.map((statement) => {
      const relevantDeps: Record<string, unknown> = {};
      if (statement.deps) {
        for (const ref of statement.deps) relevantDeps[ref] = storeSnapshot[ref];
      }
      const node: QueryNode = {
        statementId: statement.statementId,
        toolName: statement.toolAST ? String(evaluate(statement.toolAST, this.evaluationContext) ?? '') : '',
        args: statement.argsAST ? evaluate(statement.argsAST, this.evaluationContext) : null,
        defaults: statement.defaultsAST ? evaluate(statement.defaultsAST, this.evaluationContext) : null,
        deps: Object.keys(relevantDeps).length > 0 ? relevantDeps : undefined,
        complete: statement.complete,
      };
      if (statement.refreshAST) {
        const interval = evaluate(statement.refreshAST, this.evaluationContext);
        if (typeof interval === 'number') node.refreshInterval = interval;
      }
      return node;
    });
    this.queryManager.evaluateQueries(nodes);
  }

  /** Register every Mutation() statement with {@link queryManager} (kept for `run`/mutation steps). */
  registerMutations(mutationStatements: readonly MutationStatementInfo[]): void {
    this.latestMutationStatements = [...mutationStatements];
    const nodes: MutationNode[] = mutationStatements.map((statement) => ({
      statementId: statement.statementId,
      toolName: statement.toolAST ? String(evaluate(statement.toolAST, this.evaluationContext) ?? '') : '',
    }));
    this.queryManager.registerMutations(nodes);
  }

  getFieldValue(formName: string | undefined, name: string): unknown {
    const state = this.formState();
    if (!formName) {
      const value = state[name];
      return isFieldEntry(value) ? value.value : undefined;
    }
    const formValue = state[formName];
    if (!isFieldMap(formValue)) return undefined;
    return formValue[name]?.value;
  }

  setFieldValue(
    formName: string | undefined,
    componentType: string | undefined,
    name: string,
    value: unknown,
  ): void {
    const current = this.formState();
    const next: FormState = { ...current };
    if (formName) {
      const currentFormValue = current[formName];
      next[formName] = {
        ...(isFieldMap(currentFormValue) ? currentFormValue : {}),
        [name]: createFieldEntry(value, componentType),
      };
    } else {
      next[name] = createFieldEntry(value, componentType);
      this.store.set(name, value);
    }
    this.formState.set(next);
  }

  async triggerAction(
    userMessage: string,
    formName: string | undefined,
    action: ActionPlan | OpenUiLegacyAction | undefined,
  ): Promise<void> {
    const currentState = this.formState();
    const handler = this.onAction;
    let relevantState: FormState | undefined;
    const formValue = formName ? currentState[formName] : undefined;
    if (formName && formValue !== undefined) {
      relevantState = { [formName]: formValue };
    } else if (Object.keys(currentState).length > 0) {
      relevantState = currentState;
    }

    // ActionPlan path (v0.5) — sequential steps, halting on mutation failure
    // (matches upstream's `useOpenUIState`).
    if (action && 'steps' in action) {
      for (const step of action.steps) {
        switch (step.type) {
          case ACTION_STEPS.ToAssistant:
            handler?.({
              type: BuiltinActionType.ContinueConversation,
              params: step.context ? { context: step.context } : {},
              humanFriendlyMessage: step.message,
              ...(relevantState ? { formState: relevantState } : {}),
              ...(formName ? { formName } : {}),
            } as ActionEvent);
            break;
          case ACTION_STEPS.OpenUrl:
            handler?.({
              type: BuiltinActionType.OpenUrl,
              params: { url: step.url },
              humanFriendlyMessage: '',
              ...(relevantState ? { formState: relevantState } : {}),
              ...(formName ? { formName } : {}),
            } as ActionEvent);
            break;
          case ACTION_STEPS.Run: {
            const runStep = step as Extract<ActionStep, { type: 'run' }>;
            if (runStep.refType === 'mutation') {
              const mutation = this.latestMutationStatements.find((m) => m.statementId === runStep.statementId);
              const evaluatedArgs = (
                mutation?.argsAST ? evaluate(mutation.argsAST, this.evaluationContext) : {}
              ) as Record<string, unknown>;
              const ok = await this.queryManager.fireMutation(runStep.statementId, evaluatedArgs);
              if (!ok) return; // halt on failure
            } else {
              this.queryManager.invalidate([runStep.statementId]);
            }
            break;
          }
          case ACTION_STEPS.Set: {
            const setStep = step as Extract<ActionStep, { type: 'set' }>;
            const value = evaluate(setStep.valueAST, this.evaluationContext);
            this.setFieldValue(undefined, undefined, setStep.target, value);
            break;
          }
          case ACTION_STEPS.Reset: {
            const resetStep = step as Extract<ActionStep, { type: 'reset' }>;
            for (const target of resetStep.targets) {
              this.setFieldValue(undefined, undefined, target, this.stateDeclarations[target] ?? null);
            }
            break;
          }
          default:
            console.warn('[openui] Unknown ActionPlan step:', step);
            break;
        }
      }
      return;
    }

    const legacyAction = action as OpenUiLegacyAction | undefined;
    const actionType = legacyAction?.type ?? String(BuiltinActionType.ContinueConversation);
    const actionParams: Record<string, unknown> = { ...(legacyAction?.params ?? {}) };
    if (legacyAction?.url) actionParams['url'] = legacyAction.url;
    if (legacyAction?.context) actionParams['context'] = legacyAction.context;
    handler?.({
      type: actionType,
      params: actionParams,
      humanFriendlyMessage: userMessage,
      ...(relevantState ? { formState: relevantState } : {}),
      ...(formName ? { formName } : {}),
    } as ActionEvent);
  }

  dispose(): void {
    this.store.dispose();
    this.unsubscribeQueryManager();
    this.queryManager.dispose();
  }
}
