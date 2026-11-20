/** The tutorial's `calculateEstimatedSize`: a picture's height in a two-column waterfall. */
export const galleryPadding = 20;
export const galleryMainAxisGap = 10;
export const gallerySpanCount = 2;

export function calculateEstimatedSize(screenWidth: number, pictureWidth: number, pictureHeight: number): number {
  const itemWidth = (screenWidth - galleryPadding * 2 - galleryMainAxisGap) / gallerySpanCount;
  return (itemWidth / pictureWidth) * pictureHeight;
}
