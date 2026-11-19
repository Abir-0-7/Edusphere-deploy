import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import { AcademicCoverDraftSchema, type CoverFontFamily } from '@studyvault/types';
import { layoutCover, type CoverMeasure } from './cover-layout';

const MAX_LOGO_BYTES = 1024 * 1024;
const MAX_LOGO_EDGE = 2400;

export type CoverLogoMimeType = 'image/png' | 'image/jpeg';
export type CoverLogoAsset = {
  bytes: Uint8Array;
  mimeType: CoverLogoMimeType;
  width: number;
  height: number;
};

export class InvalidCoverLogoError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'InvalidCoverLogoError';
  }
}

export class UnsupportedCoverTextError extends Error {
  constructor(cause?: unknown) {
    super(
      'This PDF font cannot render one or more characters. Replace unsupported characters and try again.',
      { cause },
    );
    this.name = 'UnsupportedCoverTextError';
  }
}

export class CoverLayoutOverflowError extends Error {
  constructor() {
    super('The cover content does not fit on one page. Shorten the title or remove group members.');
    this.name = 'CoverLayoutOverflowError';
  }
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    !signature.every((byte, index) => bytes[index] === byte) ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
  ) {
    return null;
  }
  return { width: readUint32BigEndian(bytes, 16), height: readUint32BigEndian(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined) return null;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    const segmentLength = bytes[offset]! * 0x100 + bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (segmentLength < 7) return null;
      return {
        height: bytes[offset + 3]! * 0x100 + bytes[offset + 4]!,
        width: bytes[offset + 5]! * 0x100 + bytes[offset + 6]!,
      };
    }
    offset += segmentLength;
  }
  return null;
}

/** Validate the image header before asking a decoder to allocate image pixels. */
export function validateCoverLogo(bytes: Uint8Array, mimeType: string): CoverLogoAsset {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) {
    throw new InvalidCoverLogoError('Choose a logo smaller than or equal to 1 MB.');
  }
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
    throw new InvalidCoverLogoError('Choose a PNG or JPEG logo.');
  }
  const dimensions = mimeType === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (!dimensions) throw new InvalidCoverLogoError('The selected logo is not a valid PNG or JPEG image.');
  if (
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > MAX_LOGO_EDGE ||
    dimensions.height > MAX_LOGO_EDGE
  ) {
    throw new InvalidCoverLogoError('Logo dimensions must not exceed 2400 × 2400 pixels.');
  }
  return { bytes, mimeType, ...dimensions };
}

const fontIds = {
  helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
  'times-roman': { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
  courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
} as const satisfies Record<CoverFontFamily, { regular: string; bold: string }>;

type FontSet = Record<CoverFontFamily, { regular: PDFFont; bold: PDFFont }>;

async function embedCoverFonts(document: PDFDocument): Promise<FontSet> {
  const fonts = {} as FontSet;
  for (const family of Object.keys(fontIds) as CoverFontFamily[]) {
    fonts[family] = {
      regular: await document.embedFont(fontIds[family].regular),
      bold: await document.embedFont(fontIds[family].bold),
    };
  }
  return fonts;
}

let metricsPromise: Promise<FontSet> | undefined;

async function getMeasure(): Promise<CoverMeasure> {
  metricsPromise ??= PDFDocument.create().then(embedCoverFonts);
  const fonts = await metricsPromise;
  return (text, family, size, bold) => {
    try {
      return fonts[family][bold ? 'bold' : 'regular'].widthOfTextAtSize(text, size);
    } catch (cause) {
      throw new UnsupportedCoverTextError(cause);
    }
  };
}

export type CoverLayoutResult = ReturnType<typeof layoutCover>;

/** Resolve preview layout with exact StandardFont metrics shared by PDF export. */
export async function prepareCoverLayout(
  input: unknown,
  logo?: Pick<CoverLogoAsset, 'width' | 'height'>,
): Promise<CoverLayoutResult> {
  const measure = await getMeasure();
  return layoutCover(input, measure, { logo });
}

/** Render a validated one-page PDF from the same measured line plan used by the SVG preview. */
export async function createCoverPdf(
  input: unknown,
  options: { logo?: CoverLogoAsset } = {},
): Promise<Uint8Array> {
  const draft = AcademicCoverDraftSchema.parse(input);
  const logo = options.logo ? validateCoverLogo(options.logo.bytes, options.logo.mimeType) : undefined;
  const document = await PDFDocument.create();
  const fonts = await embedCoverFonts(document);
  const measure: CoverMeasure = (text, family, size, bold) => {
    try {
      return fonts[family][bold ? 'bold' : 'regular'].widthOfTextAtSize(text, size);
    } catch (cause) {
      throw new UnsupportedCoverTextError(cause);
    }
  };
  const layout = layoutCover(draft, measure, {
    logo: logo ? { width: logo.width, height: logo.height } : undefined,
  });
  if (layout.overflow) throw new CoverLayoutOverflowError();

  const page = document.addPage([layout.width, layout.height]);
  if (logo && layout.logo) {
    let image: PDFImage;
    try {
      image =
        logo.mimeType === 'image/png'
          ? await document.embedPng(logo.bytes)
          : await document.embedJpg(logo.bytes);
    } catch (cause) {
      throw new InvalidCoverLogoError(
        'The selected logo could not be decoded. Choose another PNG or JPEG.',
        cause,
      );
    }
    page.drawImage(image, {
      x: layout.logo.x,
      y: layout.height - layout.logo.y - layout.logo.height,
      width: layout.logo.width,
      height: layout.logo.height,
    });
  }
  for (const line of layout.lines) {
    const font = fonts[line.fontFamily][line.bold ? 'bold' : 'regular'];
    try {
      page.drawText(line.text, {
        x: line.x,
        y: layout.height - line.y,
        size: line.fontSize,
        font,
        color: rgb(0.08, 0.12, 0.2),
      });
    } catch (cause) {
      throw new UnsupportedCoverTextError(cause);
    }
  }
  return document.save();
}

export function coverPdfFilename(title: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
    .toLowerCase();
  return `${stem || 'cover'}.pdf`;
}
