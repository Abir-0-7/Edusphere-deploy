import { PDFDocument } from 'pdf-lib';
import { AcademicCoverDraftSchema, type CoverFontFamily } from '@studyvault/types';
import { COVER_TEMPLATES } from './cover-layout';
import type { CoverDecoration } from './cover-decoration';
import {
  CoverLayoutOverflowError,
  coverPdfFilename,
  InvalidCoverLogoError,
  prepareCoverLayout,
  UnsupportedCoverTextError,
  validateCoverLogo,
  type CoverLogoAsset,
} from './cover-pdf';

export const COVER_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const fonts: Record<CoverFontFamily, string> = {
  helvetica: 'Arial',
  'times-roman': 'Times New Roman',
  courier: 'Courier New',
};

const utf8 = new TextEncoder();
const twips = (points: number) => Math.round(points * 20);
const emu = (points: number) => Math.round(points * 12700);

function textXml(value: string) {
  for (const character of value) {
    const codepoint = character.codePointAt(0)!;
    if (
      codepoint < 32 ||
      (codepoint >= 0xd800 && codepoint <= 0xdfff) ||
      codepoint === 0xfffe ||
      codepoint === 0xffff
    ) {
      throw new Error('Remove unsupported control characters from the cover and try again.');
    }
  }
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc;
});

/** Write the fixed, small OPC package as uncompressed ZIP, including CRC and central-directory offsets. */
function packCover(parts: Record<string, string | Uint8Array>): Uint8Array<ArrayBuffer> {
  const entries = Object.entries(parts).map(([name, body]) => ({
    name: utf8.encode(name),
    body: typeof body === 'string' ? utf8.encode(body) : body,
  }));
  const directory = entries.reduce((size, entry) => size + 30 + entry.name.length + entry.body.length, 0);
  const directorySize = entries.reduce((size, entry) => size + 46 + entry.name.length, 0);
  const result = new Uint8Array(directory + directorySize + 22);
  const headers = new DataView(result.buffer);
  const u16 = (offset: number, value: number) => headers.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => headers.setUint32(offset, value, true);
  let local = 0;
  let central = directory;

  for (const { name, body } of entries) {
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    u32(local, 0x04034b50);
    u16(local + 4, 20);
    u16(local + 12, 33); // 1980-01-01 DOS timestamp, without personal metadata.
    u32(local + 14, crc);
    u32(local + 18, body.length);
    u32(local + 22, body.length);
    u16(local + 26, name.length);
    result.set(name, local + 30);
    result.set(body, local + 30 + name.length);

    u32(central, 0x02014b50);
    u16(central + 4, 20);
    u16(central + 6, 20);
    u16(central + 14, 33);
    u32(central + 16, crc);
    u32(central + 20, body.length);
    u32(central + 24, body.length);
    u16(central + 28, name.length);
    u32(central + 42, local);
    result.set(name, central + 46);
    local += 30 + name.length + body.length;
    central += 46 + name.length;
  }
  u32(central, 0x06054b50);
  u16(central + 8, entries.length);
  u16(central + 10, entries.length);
  u32(central + 12, directorySize);
  u32(central + 16, directory);
  return result;
}

const logoNamespaces = `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;

function logoXml(width: number, height: number, alignment: string) {
  const cx = emu(width);
  const cy = emu(height);
  return `<w:p><w:pPr><w:spacing w:after="240"/><w:jc w:val="${alignment}"/></w:pPr><w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>
    <wp:docPr id="1" name="Institution logo" descr="Institution logo"/>
    <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
    <pic:nvPicPr><pic:cNvPr id="0" name="Institution logo"/><pic:cNvPicPr/></pic:nvPicPr>
    <pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
    <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>`;
}

/** Header shapes sit behind editable body text and use the same page coordinates as PDF/SVG. */
function decorationXml(shapes: CoverDecoration[]): string {
  const drawing = shapes
    .map((shape, index) => {
      const circle = shape.kind === 'circle';
      const x = circle ? shape.x - shape.radius : shape.x;
      const y = circle ? shape.y - shape.radius : shape.y;
      const width = circle ? shape.radius * 2 : shape.width;
      const height = circle ? shape.radius * 2 : shape.height;
      const tag = circle ? 'oval' : 'rect';
      return `<w:r><w:pict><v:${tag} id="cover-decoration-${index}" fillcolor="${shape.fill}" stroked="f"
      style="position:absolute;margin-left:${x}pt;margin-top:${y}pt;width:${width}pt;height:${height}pt;
      z-index:${-251658240 + index};mso-position-horizontal-relative:page;mso-position-vertical-relative:page">
      <v:fill color="${shape.fill}"/><w10:wrap type="none"/></v:${tag}></w:pict></w:r>`;
    })
    .join('');
  return `${xml}<w:hdr xmlns:w="${wordNs}" xmlns:v="urn:schemas-microsoft-com:vml"
    xmlns:w10="urn:schemas-microsoft-com:office:word"><w:p><w:pPr><w:spacing w:after="0" w:line="1" w:lineRule="exact"/></w:pPr>
    ${drawing}</w:p></w:hdr>`;
}

export async function createCoverDocx(input: unknown, options: { logo?: CoverLogoAsset } = {}) {
  const draft = AcademicCoverDraftSchema.parse(input);
  const design = COVER_TEMPLATES[draft.templateId];
  const logo = options.logo ? validateCoverLogo(options.logo.bytes, options.logo.mimeType) : undefined;
  if (logo) {
    const decoder = await PDFDocument.create();
    try {
      if (logo.mimeType === 'image/png') await decoder.embedPng(logo.bytes);
      else await decoder.embedJpg(logo.bytes);
    } catch (cause) {
      throw new InvalidCoverLogoError(
        'The selected logo could not be decoded. Choose another PNG or JPEG.',
        cause,
      );
    }
  }
  const layout = await prepareCoverLayout(draft, logo).catch((cause: unknown) => {
    if (cause instanceof UnsupportedCoverTextError) {
      throw new Error('The editable template cannot export one or more characters in this cover.', {
        cause,
      });
    }
    throw cause;
  });
  if (layout.overflow) throw new CoverLayoutOverflowError();

  const paragraphs: string[] = [];
  if (layout.logo)
    paragraphs.push(logoXml(layout.logo.width, layout.logo.height, design.fields[0]?.alignment ?? 'left'));

  let hasFields = false;
  for (const rule of design.fields) {
    const lines = layout.lines.filter((line) => line.field === rule.field);
    const first = lines[0];
    if (!first) continue;
    const font = fonts[first.fontFamily];
    const runStyle = `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>${first.bold ? '<w:b/>' : ''}
      <w:color w:val="${first.color.slice(1)}"/><w:sz w:val="${first.fontSize * 2}"/></w:rPr>`;
    const runText = lines
      .map(({ text }) => `<w:t xml:space="preserve">${textXml(text)}</w:t>`)
      .join('<w:br/>');
    const paragraphStyle = rule.field === 'title' ? '<w:pStyle w:val="Title"/>' : '';
    paragraphs.push(`<w:p><w:pPr>${paragraphStyle}<w:spacing w:before="${twips(hasFields ? rule.gapBefore : 0)}"
      w:after="0" w:line="${twips(first.fontSize * 1.28)}" w:lineRule="exact"/>
      <w:jc w:val="${rule.alignment}"/></w:pPr><w:r>${runStyle}${runText}</w:r></w:p>`);
    hasFields = true;
  }

  const { top, bottom, left, right } = design.margins;
  const page = `<w:sectPr><w:headerReference w:type="default" r:id="rIdDecorations"/><w:pgSz w:w="${twips(layout.width)}" w:h="${twips(layout.height)}"/>
    <w:pgMar w:top="${twips(top)}" w:bottom="${twips(bottom)}" w:left="${twips(left)}" w:right="${twips(right)}"
      w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  const extension = logo?.mimeType === 'image/png' ? 'png' : 'jpg';
  const logoType = logo ? `<Default Extension="${extension}" ContentType="${logo.mimeType}"/>` : '';
  const logoRelationship = logo
    ? `<Relationship Id="rIdLogo" Type="${relationshipNs}/image" Target="media/logo.${extension}"/>`
    : '';

  return packCover({
    '[Content_Types].xml': `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>${logoType}
      <Override PartName="/word/document.xml" ContentType="${COVER_DOCX_MIME.replace('.document', '.document.main')}+xml"/>
      <Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
      <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
      </Types>`,
    '_rels/.rels': `${xml}<Relationships xmlns="${packageNs}">
      <Relationship Id="rIdDoc" Type="${relationshipNs}/officeDocument" Target="word/document.xml"/>
      </Relationships>`,
    'word/document.xml': `${xml}<w:document xmlns:w="${wordNs}" xmlns:r="${relationshipNs}" ${logoNamespaces}>
      <w:body>${paragraphs.join('')}${page}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `${xml}<Relationships xmlns="${packageNs}">
      <Relationship Id="rIdDecorations" Type="${relationshipNs}/header" Target="header.xml"/>
      <Relationship Id="rIdStyles" Type="${relationshipNs}/styles" Target="styles.xml"/>${logoRelationship}
      </Relationships>`,
    'word/header.xml': decorationXml(layout.decorations),
    'word/styles.xml': `${xml}<w:styles xmlns:w="${wordNs}">
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
      <w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="000000"/></w:rPr></w:style></w:styles>`,
    ...(logo ? { [`word/media/logo.${extension}`]: logo.bytes } : {}),
  });
}

export function coverDocxFilename(title: string) {
  return coverPdfFilename(title).replace(/\.pdf$/u, '.docx');
}
