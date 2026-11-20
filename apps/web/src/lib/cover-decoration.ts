import type { CoverTemplateId } from '@studyvault/types';

type CoverRect = { kind: 'rect'; x: number; y: number; width: number; height: number; fill: string };
type CoverCircle = { kind: 'circle'; x: number; y: number; radius: number; fill: string };

export type CoverDecoration = CoverRect | CoverCircle;

export const COVER_PALETTES = {
  'university-assignment': {
    paper: '#fffcf3',
    ink: '#253651',
    heading: '#13294b',
    accent: '#ba8a42',
    caption: 'Navy and gold frame',
  },
  'lab-report': {
    paper: '#f6fbfc',
    ink: '#284a53',
    heading: '#0c4451',
    accent: '#0f7784',
    caption: 'Teal blueprint',
  },
  'project-report': {
    paper: '#fbf8ff',
    ink: '#473662',
    heading: '#3d2269',
    accent: '#7542b3',
    caption: 'Violet geometry',
  },
  'minimal-professional': {
    paper: '#ffffff',
    ink: '#3d3431',
    heading: '#2b2422',
    accent: '#a74932',
    caption: 'Terracotta accents',
  },
} as const satisfies Record<
  CoverTemplateId,
  {
    paper: string;
    ink: string;
    heading: string;
    accent: string;
    caption: string;
  }
>;

const rect = (x: number, y: number, width: number, height: number, fill: string): CoverRect => ({
  kind: 'rect',
  x,
  y,
  width,
  height,
  fill,
});

const circle = (x: number, y: number, radius: number, fill: string): CoverCircle => ({
  kind: 'circle',
  x,
  y,
  radius,
  fill,
});

/** Decorative layers use the same top-origin points as the cover content. */
export function coverDecorations(
  templateId: CoverTemplateId,
  width: number,
  height: number,
  titleTop?: number,
): CoverDecoration[] {
  const { paper, heading, accent } = COVER_PALETTES[templateId];
  const background = rect(0, 0, width, height, paper);
  const markerY = titleTop === undefined ? 68 : titleTop - 8;

  switch (templateId) {
    case 'university-assignment':
      return [
        background,
        rect(0, 0, width, 25, heading),
        rect(0, height - 25, width, 25, heading),
        rect(0, 25, width, 3, accent),
        rect(0, height - 28, width, 3, accent),
        rect(40, 46, width - 80, 1, accent),
        rect(40, height - 46, width - 80, 1, accent),
        rect(40, 46, 1, height - 91, accent),
        rect(width - 41, 46, 1, height - 91, accent),
        rect(width / 2 - 29, markerY, 58, 1.5, accent),
        circle(width / 2, markerY + 0.75, 3, accent),
      ];
    case 'lab-report':
      return [
        background,
        rect(0, 0, 26, height, '#d6edf0'),
        rect(0, 0, 10, height, heading),
        rect(10, 0, 4, height, accent),
        rect(54, 32, width - 108, 1, '#b5d1d7'),
        rect(54, markerY, width - 108, 1, '#b5d1d7'),
        rect(54, markerY - 1, 44, 3, accent),
        rect(26, height - 44, width - 26, 44, '#e3f2f4'),
        ...Array.from({ length: 9 }, (_, index) =>
          rect(width - 38 - index * 17, height - 44, 1, 44, '#bddde3'),
        ),
        rect(width - 174, height - 28, 174, 1, '#bddde3'),
        rect(width - 174, height - 12, 174, 1, '#bddde3'),
      ];
    case 'project-report':
      return [
        background,
        rect(0, 0, width, 14, heading),
        rect(0, 14, width * 0.4, 6, accent),
        rect(0, 20, width * 0.2, 4, '#d9c4fa'),
        circle(width - 30, height - 22, 163, '#eee4fa'),
        circle(width - 30, height - 22, 108, '#e4d4f5'),
        circle(width - 30, height - 22, 55, '#d7bef0'),
        rect(76, height - 47, 101, 3, accent),
        rect(width / 2 - 35, markerY, 70, 3, accent),
      ];
    case 'minimal-professional':
      return [
        background,
        rect(width - 38, 0, 38, height, '#f4e7df'),
        rect(width - 39, 0, 1, height, '#dfbcae'),
        rect(width - 38, 0, 38, 116, accent),
        rect(58, 47, 96, 2, accent),
        rect(58, markerY, 32, 1.5, accent),
        rect(58, height - 39, width - 116, 1, '#dfbcae'),
      ];
  }
}
