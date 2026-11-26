export type MediaArtworkLayout = "landscape" | "poster" | "square";

export const MEDIA_ROW_HEIGHT = "max(76px, 4.75rem)";

export const DEFAULT_CARD_SIZE = 40;
export const MAX_CARD_SIZE = 200;
const titleMaxRem = 1.25;
const subtitleMaxRem = 1;

/** Resolve against the card's inline-size container, independently of screen width. */
export const mediaCardTypography = {
  title: {
    fontSize: `clamp(1rem, 4.8cqi, ${titleMaxRem}rem)`,
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: `clamp(0.8125rem, 3.6cqi, ${subtitleMaxRem}rem)`,
    lineHeight: 1.4,
  },
  badge: {
    fontSize: "clamp(0.6875rem, 2.7cqi, 0.8125rem)",
    lineHeight: 1.2,
  },
};

// Two text lines at their maximum sizes, plus padding, gap and border.
// Virtual rows and placeholders resolve the same CSS length as the card's text.
const textHeightRem =
  titleMaxRem * mediaCardTypography.title.lineHeight +
  subtitleMaxRem * mediaCardTypography.subtitle.lineHeight;
export const MEDIA_CARD_FOOTER_HEIGHT = `max(80px, calc(${textHeightRem}rem + 24px))`;

export function normalizeCardSize(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(MAX_CARD_SIZE, Math.max(0, parsed))
    : DEFAULT_CARD_SIZE;
}

export const mediaCardWidth = (
  layout: MediaArtworkLayout,
  size = DEFAULT_CARD_SIZE,
) => Math.round(layout === "landscape" ? 190 + size * 2.2 : 140 + size * 1.6);

export function mediaCardAspectRatio(layout: MediaArtworkLayout) {
  return layout === "poster" ? 2 / 3 : layout === "square" ? 1 : 16 / 9;
}

function firstPath(...paths: Array<string | null | undefined>) {
  return paths.find((path) => typeof path === "string" && path.trim()) || null;
}

export function mediaArtworkPath(
  item: {
    type: string;
    thumb?: string;
    art?: string;
    parentThumb?: string;
    grandparentThumb?: string;
    composite?: string;
  },
  layout: MediaArtworkLayout,
) {
  if (
    ["artist", "album", "track", "photo", "photoalbum", "clip"].includes(
      item.type,
    )
  )
    return firstPath(
      item.thumb,
      item.parentThumb,
      item.grandparentThumb,
      item.composite,
      item.art,
    );
  if (layout === "poster") return firstPath(item.thumb, item.art);
  return item.type === "episode" ? firstPath(item.thumb) : firstPath(item.art);
}
