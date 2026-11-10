// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Pure SVG-markup builders for the A2UI `LineChart` / `PieChart` catalog
 * components — ported near-verbatim from `@lynx-js/genui/a2ui/catalog`'s
 * `LineChart`/`PieChart`/`utils/chart` (framework-agnostic string building,
 * no React/JSX involved upstream either). Rendered via Lynx's native `<svg>`
 * element (`x-svg`), which accepts raw markup through its `content`
 * attribute — the same mechanism upstream uses.
 */

export const DEFAULT_CHART_COLORS = ['#0057d9', '#0a8f8f', '#8a5cf6', '#d92d20', '#2d6a4f', '#b26a00'];

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.abs(value) >= 1000 ? Math.round(value) : Number(value.toFixed(1));
  return String(rounded);
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Number(value.toFixed(1))}%`;
}

// ─── line chart ─────────────────────────────────────────────────────────────

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface NormalizedSeries {
  name: string;
  values: number[];
  color: string;
}

interface Point {
  x: number;
  y: number;
}

const LINE_SVG_WIDTH = 360;
const LINE_DEFAULT_HEIGHT = 240;
const LINE_MARGIN = { top: 16, right: 16, bottom: 24, left: 16 };

export function normalizeSeries(series: ChartSeries[], palette: readonly string[]): NormalizedSeries[] {
  return series.map((item, index) => ({
    name: item.name,
    values: item.values,
    color: item.color ?? palette[index % palette.length] ?? '#0057d9',
  }));
}

function buildLinearPath(points: Point[]): string {
  if (points.length === 0) return '';
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (const point of points.slice(1)) path += ` L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  return path;
}

function buildStepPath(points: Point[]): string {
  if (points.length === 0) return '';
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let prev = points[0];
  for (const point of points.slice(1)) {
    path += ` L ${point.x.toFixed(1)} ${prev.y.toFixed(1)}`;
    path += ` L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    prev = point;
  }
  return path;
}

function buildNaturalPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

function buildPath(points: Point[], variant: string): string {
  switch (variant) {
    case 'step':
      return buildStepPath(points);
    case 'natural':
      return buildNaturalPath(points);
    default:
      return buildLinearPath(points);
  }
}

export function sampleIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil(count / maxLabels);
  const indices: number[] = [];
  for (let index = 0; index < count; index += step) indices.push(index);
  const last = count - 1;
  if (indices[indices.length - 1] !== last) indices.push(last);
  return Array.from(new Set(indices));
}

export function minMax(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = values[0];
  let max = values[0];
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

export function buildLineChartSvg(
  labels: string[],
  series: NormalizedSeries[],
  variant: string,
  showGrid: boolean,
  height: number = LINE_DEFAULT_HEIGHT,
): string {
  const width = LINE_SVG_WIDTH;
  const chartWidth = width - LINE_MARGIN.left - LINE_MARGIN.right;
  const chartHeight = height - LINE_MARGIN.top - LINE_MARGIN.bottom;
  const maxPoints = labels.length;
  const values = series.flatMap((item) => item.values?.slice(0, maxPoints) ?? []);
  if (maxPoints === 0 || series.length === 0 || values.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`;
  }
  const { min: minValue, max: maxValue } = minMax(values);
  const yRange = maxValue - minValue;
  const xStep = maxPoints > 1 ? chartWidth / (maxPoints - 1) : 0;
  const gridLines = 4;
  const lineMarkup = series
    .map((item, seriesIndex) => {
      const points: Point[] = (item.values?.slice(0, maxPoints) ?? []).map((value, index) => ({
        x: LINE_MARGIN.left + xStep * index,
        y: LINE_MARGIN.top + chartHeight - ((value - minValue) / yRange) * chartHeight,
      }));
      const color = escapeXml(item.color ?? DEFAULT_CHART_COLORS[seriesIndex % DEFAULT_CHART_COLORS.length] ?? '#0057d9');
      const d = buildPath(points, variant);
      const circles = points
        .map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5" fill="${color}" stroke="#ffffff" stroke-width="1.5" />`)
        .join('');
      return `
        <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${circles}
      `;
    })
    .join('');
  const gridMarkup = showGrid
    ? Array.from({ length: gridLines + 1 }, (_, index) => {
        const ratio = index / gridLines;
        const y = LINE_MARGIN.top + chartHeight - ratio * chartHeight;
        const dashed = index === gridLines ? '' : ' stroke-dasharray="4 6"';
        return `<line x1="${LINE_MARGIN.left}" y1="${y.toFixed(1)}" x2="${width - LINE_MARGIN.right}" y2="${y.toFixed(1)}" stroke="rgba(0,0,0,0.12)" stroke-width="1"${dashed} />`;
      }).join('')
    : '';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="rgba(255,255,255,0.02)" />
      ${gridMarkup}
      <line x1="${LINE_MARGIN.left}" y1="${height - LINE_MARGIN.bottom}" x2="${width - LINE_MARGIN.right}" y2="${height - LINE_MARGIN.bottom}" stroke="rgba(0,0,0,0.24)" stroke-width="1.5" />
      ${lineMarkup}
    </svg>
  `;
}

// ─── pie chart ──────────────────────────────────────────────────────────────

export interface PieSlice {
  name: string;
  value: number;
  color?: string;
}

const PIE_SVG_WIDTH = 360;
const PIE_SVG_HEIGHT = 220;
const PIE_CENTER_X = PIE_SVG_WIDTH / 2;
const PIE_CENTER_Y = PIE_SVG_HEIGHT / 2;
const PIE_DEFAULT_OUTER_RADIUS = 84;
const PIE_DEFAULT_DONUT_INNER_RADIUS = 52;

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number): Point {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return { x: centerX + radius * Math.cos(angleInRadians), y: centerY + radius * Math.sin(angleInRadians) };
}

function describeSlicePath(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const outerStart = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const outerEnd = polarToCartesian(centerX, centerY, outerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? '1' : '0';
  if (innerRadius <= 0) {
    return [
      `M ${centerX.toFixed(1)} ${centerY.toFixed(1)}`,
      `L ${outerStart.x.toFixed(1)} ${outerStart.y.toFixed(1)}`,
      `A ${outerRadius.toFixed(1)} ${outerRadius.toFixed(1)} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(1)} ${outerEnd.y.toFixed(1)}`,
      'Z',
    ].join(' ');
  }
  const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
  const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
  return [
    `M ${outerStart.x.toFixed(1)} ${outerStart.y.toFixed(1)}`,
    `A ${outerRadius.toFixed(1)} ${outerRadius.toFixed(1)} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(1)} ${outerEnd.y.toFixed(1)}`,
    `L ${innerEnd.x.toFixed(1)} ${innerEnd.y.toFixed(1)}`,
    `A ${innerRadius.toFixed(1)} ${innerRadius.toFixed(1)} 0 ${largeArcFlag} 0 ${innerStart.x.toFixed(1)} ${innerStart.y.toFixed(1)}`,
    'Z',
  ].join(' ');
}

export function buildPieChartSvg(
  slices: PieSlice[],
  variant: string,
  paddingAngle: number,
  palette: readonly string[],
): string {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, Number(slice.value) || 0), 0);
  if (total <= 0) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PIE_SVG_WIDTH} ${PIE_SVG_HEIGHT}"></svg>`;
  const outerRadius = PIE_DEFAULT_OUTER_RADIUS;
  const innerRadius = variant === 'donut' ? PIE_DEFAULT_DONUT_INNER_RADIUS : 0;
  const gap = Math.max(0, paddingAngle);
  let currentAngle = -90;
  const segments = slices
    .map((slice, index) => {
      const value = Math.max(0, Number(slice.value) || 0);
      if (value <= 0) return null;
      const sliceAngle = (value / total) * 360;
      const gapForSlice = Math.min(gap, sliceAngle * 0.45);
      const startAngle = currentAngle + gapForSlice / 2;
      const endAngle = currentAngle + sliceAngle - gapForSlice / 2;
      currentAngle += sliceAngle;
      if (endAngle <= startAngle) return null;
      const color = escapeXml(slice.color ?? palette[index % palette.length] ?? DEFAULT_CHART_COLORS[0]);
      const path = describeSlicePath(PIE_CENTER_X, PIE_CENTER_Y, outerRadius, innerRadius, startAngle, endAngle);
      return `<path d="${path}" fill="${color}" stroke="rgba(255,255,255,0.8)" stroke-width="2" />`;
    })
    .filter((segment): segment is string => segment !== null)
    .join('');
  const backdrop = `<circle cx="${PIE_CENTER_X}" cy="${PIE_CENTER_Y}" r="${outerRadius + 5}" fill="rgba(0,0,0,0.03)" />`;
  const hole = innerRadius > 0 ? `<circle cx="${PIE_CENTER_X}" cy="${PIE_CENTER_Y}" r="${innerRadius - 2}" fill="#ffffff" />` : '';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PIE_SVG_WIDTH} ${PIE_SVG_HEIGHT}">
      ${backdrop}
      ${segments}
      ${hole}
    </svg>
  `;
}
