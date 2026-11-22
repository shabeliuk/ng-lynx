/**
 * The gallery's pictures. The tutorial ships photos; these are coloured panels with
 * the same mix of shapes, so the waterfall has columns of different heights.
 */
export interface Picture {
  label: string;
  color: string;
  width: number;
  height: number;
}

const colors = ['#c8553d', '#588b8b', '#f28f3b', '#5d576b', '#3d5a80', '#81b29a', '#e07a5f', '#9a8c98'];
const shapes: [number, number][] = [
  [512, 429],
  [511, 437],
  [1024, 1589],
  [1024, 1024],
  [1024, 1489],
  [1024, 1280],
  [1024, 683],
  [683, 1024],
];

export const pictures: Picture[] = Array.from({ length: 24 }, (_, i) => {
  const [width, height] = shapes[i % shapes.length]!;
  return { label: `Picture ${i + 1}`, color: colors[(i * 3) % colors.length]!, width, height };
});
