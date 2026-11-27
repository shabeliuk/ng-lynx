// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * `@checks` evaluation: port of `evaluateChecks` in upstream `useChecks.js`.
 *
 * Each rule's `condition` is a `@call` or a `@path`. A rule passes when it
 * evaluates to `true` or to a ValidationResult with `valid: true`. A failing
 * rule's message is the ValidationResult's `message`, else the rule's own
 * `message`, else "Validation failed". An evaluation error fails the rule and
 * is reported to the agent.
 *
 * The node renderer runs this inside its signals effect, so outcomes update
 * when the data the conditions read changes.
 */
import type { MessageProcessor, Surface } from '@lynx-js/genui/a2ui/store';
import {
  executeFunctionCall,
  isDataBinding,
  isFunctionCall,
  resolveDynamicValue,
} from '@lynx-js/genui/a2ui/store';

import type { A2uiFunctionEntry } from './catalog.js';

/**
 * One failing `@checks` rule.
 *
 * @experimental
 */
export interface A2uiCheckFailure {
  /** The condition's function name, or `"condition"` for a binding. */
  call: string;
  message: string;
  code?: string;
  severity?: string;
}

/**
 * The outcome of a component's `@checks`.
 *
 * @experimental
 */
export interface A2uiChecksOutcome {
  ok: boolean;
  failures: A2uiCheckFailure[];
  /** The first failure's message, for inline error text. */
  firstFailureMessage: string | undefined;
}

/** @experimental */
export const A2UI_CHECKS_OK: A2uiChecksOutcome = Object.freeze({
  ok: true,
  failures: [],
  firstFailureMessage: undefined,
}) as A2uiChecksOutcome;

interface CheckRule {
  condition?: unknown;
  message?: unknown;
}

interface ValidationResult {
  valid?: unknown;
  message?: unknown;
  code?: unknown;
  severity?: unknown;
}

function evaluateCondition(
  processor: MessageProcessor,
  condition: unknown,
  surfaceId: string,
  dataContextPath: string | undefined,
  functions: readonly A2uiFunctionEntry[],
): unknown {
  if (isFunctionCall(condition)) {
    return executeFunctionCall(processor, condition as never, surfaceId, dataContextPath, {
      functions: functions as never,
      throwOnError: true,
    });
  }
  if (isDataBinding(condition)) {
    return resolveDynamicValue(processor, condition, surfaceId, dataContextPath, {
      functions: functions as never,
      resolveFunctionCall: executeFunctionCall,
    });
  }
  return undefined;
}

/**
 * Evaluate a component's `@checks` array.
 *
 * @experimental
 */
export function evaluateA2uiChecks(
  processor: MessageProcessor,
  checks: unknown,
  surface: Surface,
  dataContextPath: string | undefined,
  functions: readonly A2uiFunctionEntry[],
): A2uiChecksOutcome {
  if (!Array.isArray(checks) || checks.length === 0) return A2UI_CHECKS_OK;
  const failures: A2uiCheckFailure[] = [];
  for (const rule of checks as CheckRule[]) {
    let result: unknown;
    try {
      result = evaluateCondition(processor, rule?.condition, surface.surfaceId, dataContextPath, functions);
    } catch (error) {
      processor.reportExpressionError(error, surface.surfaceId);
      result = {
        valid: false,
        message: rule?.message ?? (error instanceof Error ? error.message : String(error)),
        severity: 'error',
      };
    }
    const validation = result && typeof result === 'object' && 'valid' in result
      ? (result as ValidationResult)
      : undefined;
    if (result === true || validation?.valid === true) continue;
    failures.push({
      ...(typeof validation?.code === 'string' ? { code: validation.code } : {}),
      ...(typeof validation?.severity === 'string' ? { severity: validation.severity } : {}),
      call: isFunctionCall(rule?.condition) ? String((rule.condition as unknown as Record<string, unknown>)['@call']) : 'condition',
      message: typeof validation?.message === 'string'
        ? validation.message
        : (typeof rule?.message === 'string' ? rule.message : 'Validation failed'),
    });
  }
  if (failures.length === 0) return A2UI_CHECKS_OK;
  return { ok: false, failures, firstFailureMessage: failures[0]!.message };
}

/** Same outcome, for keeping a signal's value when nothing changed. */
export function sameChecksOutcome(a: A2uiChecksOutcome, b: A2uiChecksOutcome): boolean {
  if (a === b) return true;
  if (a.ok !== b.ok || a.failures.length !== b.failures.length) return false;
  return a.failures.every((failure, i) => {
    const other = b.failures[i]!;
    return failure.call === other.call && failure.message === other.message
      && failure.code === other.code && failure.severity === other.severity;
  });
}
