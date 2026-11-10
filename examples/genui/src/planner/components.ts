/**
 * Angular renderers for the planner's custom OpenUI components. The model
 * composes the screen; these draw the numbers, from a `calculate_plan` Query
 * result it passes in (`PlanSummary(plan)`) — so a figure on screen is always
 * the calculator's, never the model's.
 *
 * Each reads its evaluated props from `OPENUI_NODE_CONTEXT`. While the Query
 * is still resolving the prop holds the model's defaults (typically
 * `{ ok: false, message: "Calculating…" }`), so every component renders
 * that state too.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  NO_ERRORS_SCHEMA,
  type Type,
} from '@angular/core';

import { defineComponent, OPENUI_NODE_CONTEXT } from 'angular-lynx/genui';

import { formatMoneyShort, type PlanResult, type ScenarioId, type ScenarioResult } from './calc.js';
import { PLANNER_COMPONENTS } from './contract.js';

function asPlan(value: unknown): PlanResult | undefined {
  return value && typeof value === 'object' && (value as { ok?: unknown }).ok === true
    ? (value as PlanResult)
    : undefined;
}

function pendingMessage(value: unknown): string {
  const message = value && typeof value === 'object' ? (value as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message ? message : 'Calculating…';
}

// ─── PlanSummary ────────────────────────────────────────────────────────────

@Component({
  selector: 'planner-plan-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="PlanSummary">
      @if (plan(); as p) {
        <text class="PlanEyebrow">Retire at {{ p.retirementAge }} · base case · today's money</text>
        <view class="PlanStats">
          <view class="PlanStat">
            <text class="PlanStatLabel">Invest each month</text>
            <text class="PlanStatValue">{{ p.base.requiredMonthlyText }}</text>
          </view>
          <view class="PlanStat">
            <text class="PlanStatLabel">Pot needed at {{ p.retirementAge }}</text>
            <text class="PlanStatValue">{{ p.base.requiredPotText }}</text>
          </view>
        </view>
        <view [class]="p.base.onTrack ? 'PlanBadge PlanBadgeGood' : 'PlanBadge PlanBadgeGap'">
          <text class="PlanBadgeText">{{ status() }}</text>
        </view>
        <text class="PlanNote">{{ note() }}</text>
      } @else {
        <text class="PlanPending">{{ pending() }}</text>
      }
    </view>
  `,
})
export class PlanSummaryComponent {
  private readonly props = inject(OPENUI_NODE_CONTEXT).props;
  protected readonly plan = computed(() => asPlan(this.props()['plan']));
  protected readonly pending = computed(() => pendingMessage(this.props()['plan']));

  protected readonly status = computed(() => {
    const plan = this.plan();
    if (!plan) return '';
    return plan.base.onTrack
      ? 'On track with what you save today'
      : `${plan.base.extraMonthlyText} more than you save today`;
  });

  protected readonly note = computed(() => {
    const plan = this.plan();
    if (!plan) return '';
    const { base } = plan;
    const earliest =
      base.earliestRetirementAge === null
        ? 'Your current saving alone would not fund retirement by 80.'
        : `Saving what you do now, you could retire at ${base.earliestRetirementAge}.`;
    const runsOut =
      !base.onTrack && base.depletionAge !== null
        ? ` Retiring at ${plan.retirementAge} on today's saving, the money runs out at ${base.depletionAge}.`
        : '';
    return earliest + runsOut;
  });
}

// ─── ScenarioTable ──────────────────────────────────────────────────────────

const SCENARIOS: readonly ScenarioId[] = ['pessimistic', 'base', 'optimistic'];

@Component({
  selector: 'planner-scenario-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="ScenarioTable">
      @if (rows(); as scenarios) {
        @for (row of scenarios; track row.id) {
          <view [class]="row.id === 'base' ? 'ScenarioRow ScenarioRowBase' : 'ScenarioRow'">
            <view class="ScenarioHead">
              <text class="ScenarioName">{{ row.label }}</text>
              <text class="ScenarioReturn">{{ row.returns }}</text>
            </view>
            <view class="ScenarioCells">
              <view class="ScenarioCell">
                <text class="ScenarioCellLabel">Monthly</text>
                <text class="ScenarioCellValue">{{ row.monthly }}</text>
              </view>
              <view class="ScenarioCell">
                <text class="ScenarioCellLabel">Pot needed</text>
                <text class="ScenarioCellValue">{{ row.pot }}</text>
              </view>
              <view class="ScenarioCell">
                <text class="ScenarioCellLabel">Current plan</text>
                <text [class]="row.onTrack ? 'ScenarioCellValue ScenarioGood' : 'ScenarioCellValue ScenarioGap'">{{ row.outcome }}</text>
              </view>
            </view>
          </view>
        }
      } @else {
        <text class="PlanPending">{{ pending() }}</text>
      }
    </view>
  `,
})
export class ScenarioTableComponent {
  private readonly props = inject(OPENUI_NODE_CONTEXT).props;
  protected readonly pending = computed(() => pendingMessage(this.props()['plan']));

  protected readonly rows = computed(() => {
    const plan = asPlan(this.props()['plan']);
    if (!plan) return undefined;
    return SCENARIOS.map((id) => {
      const scenario: ScenarioResult = plan[id];
      const [before, after] = scenario.nominalReturns;
      return {
        id,
        label: scenario.label,
        returns: `${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}% a year`,
        monthly: scenario.requiredMonthlyText.replace('/month', '/mo'),
        pot: formatMoneyShort(scenario.requiredPot, plan.currency),
        onTrack: scenario.onTrack,
        outcome: scenario.onTrack
          ? 'On track'
          : scenario.depletionAge !== null
            ? `Runs out at ${scenario.depletionAge}`
            : `Short ${formatMoneyShort(scenario.gap, plan.currency)}`,
      };
    });
  });
}

// ─── PlanAssumptions ────────────────────────────────────────────────────────

/**
 * The calculator's own assumption lines. A component rather than a
 * model-written `List(@Each(plan.assumptions, …))`: that pattern asks a model
 * to get a positional List signature and an `@Each` template right over a
 * Query that starts out empty — and a small model (Gemini Flash Lite) did
 * not, leaving a heading over nothing.
 */
@Component({
  selector: 'planner-plan-assumptions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="PlanAssumptions">
      @if (lines(); as items) {
        @for (line of items; track $index) {
          <view class="AssumptionRow">
            <text class="AssumptionBullet">•</text>
            <text class="AssumptionText">{{ line }}</text>
          </view>
        }
      } @else {
        <text class="PlanPending">{{ pending() }}</text>
      }
    </view>
  `,
})
export class PlanAssumptionsComponent {
  private readonly props = inject(OPENUI_NODE_CONTEXT).props;
  protected readonly pending = computed(() => pendingMessage(this.props()['plan']));
  protected readonly lines = computed(() => asPlan(this.props()['plan'])?.assumptions);
}

// ─── ProjectionChart ────────────────────────────────────────────────────────

const CHART_W = 320;
const CHART_H = 160;
const PAD_X = 4;
const PAD_Y = 8;

function polyline(values: number[], max: number, stroke: string, dashed = false): string {
  if (values.length < 2) return '';
  const step = (CHART_W - PAD_X * 2) / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = PAD_X + index * step;
      const y = CHART_H - PAD_Y - (value / max) * (CHART_H - PAD_Y * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const dash = dashed ? ' stroke-dasharray="6 4"' : '';
  return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"${dash}/>`;
}

@Component({
  selector: 'planner-projection-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="ProjectionChart">
      @if (chart(); as c) {
        <view class="ChartHeader">
          <text class="ChartTitle">Your pot by age</text>
          <text class="ChartMax">peak {{ c.maxText }}</text>
        </view>
        <svg class="ChartSvg" [content]="c.svg" style="width:100%;height:160px"></svg>
        <view class="ChartAxis">
          <text class="ChartAxisLabel">{{ c.firstAge }}</text>
          <text class="ChartAxisLabel">retire {{ c.retirementAge }}</text>
          <text class="ChartAxisLabel">{{ c.lastAge }}</text>
        </view>
        <view class="ChartLegend">
          <view class="ChartKey"><view class="ChartSwatch ChartSwatchRecommended"></view><text class="ChartKeyText">Recommended saving</text></view>
          <view class="ChartKey"><view class="ChartSwatch ChartSwatchCurrent"></view><text class="ChartKeyText">Current saving</text></view>
        </view>
      } @else {
        <text class="PlanPending">{{ pending() }}</text>
      }
    </view>
  `,
})
export class ProjectionChartComponent {
  private readonly props = inject(OPENUI_NODE_CONTEXT).props;
  protected readonly pending = computed(() => pendingMessage(this.props()['plan']));

  protected readonly chart = computed(() => {
    const plan = asPlan(this.props()['plan']);
    if (!plan) return undefined;
    const { ages, current, recommended } = plan.projection;
    const max = Math.max(1, ...current, ...recommended);
    const retireIndex = ages.indexOf(plan.retirementAge);
    const x = PAD_X + (retireIndex / (ages.length - 1)) * (CHART_W - PAD_X * 2);
    const marker = `<line x1="${x.toFixed(1)}" y1="${PAD_Y}" x2="${x.toFixed(1)}" y2="${CHART_H - PAD_Y}" stroke="#9aa3ad" stroke-width="1" stroke-dasharray="3 3"/>`;
    const baseline = `<line x1="${PAD_X}" y1="${CHART_H - PAD_Y}" x2="${CHART_W - PAD_X}" y2="${CHART_H - PAD_Y}" stroke="#d5dae0" stroke-width="1"/>`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_W} ${CHART_H}">` +
      baseline +
      marker +
      polyline(current, max, '#e07a5f', true) +
      polyline(recommended, max, '#2a9d8f') +
      '</svg>';
    return {
      svg,
      maxText: formatMoneyShort(max, plan.currency),
      firstAge: ages[0],
      lastAge: ages[ages.length - 1],
      retirementAge: plan.retirementAge,
    };
  });
}

// ─── registration ───────────────────────────────────────────────────────────

const RENDERERS: Record<(typeof PLANNER_COMPONENTS)[number]['name'], Type<unknown>> = {
  PlanSummary: PlanSummaryComponent,
  ScenarioTable: ScenarioTableComponent,
  PlanAssumptions: PlanAssumptionsComponent,
  ProjectionChart: ProjectionChartComponent,
};

/** The planner's components, ready for `createOpenUiLibrary({ components })`. */
export const PLANNER_LIBRARY_COMPONENTS = PLANNER_COMPONENTS.map((spec) =>
  defineComponent({ ...spec, component: RENDERERS[spec.name] }),
);
