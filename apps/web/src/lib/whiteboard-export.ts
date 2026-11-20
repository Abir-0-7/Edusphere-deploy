import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

type Renderer = typeof import('@excalidraw/excalidraw');
type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElements']>[number];
export type BoardScope = 'selection' | 'full';
export type BoardExportFormat = 'png' | 'svg' | 'pdf';

const padding = 16;
const exportEdgeLimit = 4096;
const maximumSceneSpan = 1_000_000;
const raster = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i;
const safeColor = (color: string, fallback: string) =>
  /^(?:#[a-f0-9]{3,8}|transparent)$/i.test(color) ? color : fallback;

export function boardRegion(
  elements: readonly SceneElement[],
  selected: Readonly<Record<string, boolean>>,
): SceneElement[] {
  const selectedIds = new Set(
    elements.filter((element) => selected[element.id]).map((element) => element.id),
  );
  // Include a selected shape's label and a selected frame's contents.
  const dependents = new Map<string, string[]>();
  for (const element of elements) {
    const containerId = element.type === 'text' ? element.containerId : null;
    for (const parentId of [containerId, element.frameId]) {
      if (parentId) {
        const children = dependents.get(parentId) ?? [];
        children.push(element.id);
        dependents.set(parentId, children);
      }
    }
  }
  for (const id of selectedIds) {
    for (const childId of dependents.get(id) ?? []) selectedIds.add(childId);
  }
  return elements.filter((element) => selectedIds.has(element.id));
}

function filteredFiles(elements: readonly SceneElement[], allFiles: BinaryFiles): BinaryFiles {
  const result: BinaryFiles = {};
  for (const element of elements) {
    if (element.type !== 'image') continue;
    const id = element.fileId;
    const asset = id && Object.hasOwn(allFiles, id) ? allFiles[id] : null;
    if (
      !id ||
      !asset ||
      asset.id !== id ||
      !raster.test(asset.dataURL) ||
      !asset.dataURL.startsWith(`data:${asset.mimeType};base64,`)
    ) {
      throw new Error('An image in this board area is unavailable.');
    }
    result[id] = asset;
  }
  return result;
}

function cleanElement(element: SceneElement, elementIds: Set<ExcalidrawElement['id']>): SceneElement {
  return {
    ...element,
    link: null,
    customData: undefined,
    strokeColor: safeColor(element.strokeColor, '#1b1b1f'),
    backgroundColor: safeColor(element.backgroundColor, 'transparent'),
    frameId: element.frameId && elementIds.has(element.frameId) ? element.frameId : null,
  };
}

function serializableSvg(svg: SVGSVGElement, title: string): Blob {
  if (svg.querySelector('script, foreignObject, a, iframe'))
    throw new Error('The board SVG contains unsupported content.');
  for (const node of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const { name, value } of Array.from(node.attributes)) {
      if (
        name.toLowerCase().startsWith('on') ||
        (name.endsWith('href') && !value.startsWith('#') && !raster.test(value))
      ) {
        throw new Error('The board SVG contains an unsupported link.');
      }
    }
  }
  const label = svg.ownerDocument.createElementNS(svg.namespaceURI, 'title');
  label.textContent = title;
  svg.prepend(label);
  return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
}

export function boardExportName(title: string, scope: BoardScope, format: BoardExportFormat): string {
  const clean = title
    .trim()
    .replace(/[^\p{Letter}\p{Number} _-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 90);
  return `${clean || 'study-board'}-${scope === 'full' ? 'board' : 'selection'}.${format}`;
}

export async function renderBoardExport(
  renderer: Renderer,
  scene: readonly SceneElement[],
  allFiles: BinaryFiles,
  background: string,
  title: string,
  format: BoardExportFormat,
): Promise<Blob> {
  if (!scene.length) throw new Error('Draw or select something to export.');
  const ids = new Set(scene.map((element) => element.id));
  const elements = scene.map((element) => cleanElement(element, ids));
  const [left, top, right, bottom] = renderer.getCommonBounds(elements);
  const width = right - left;
  const height = bottom - top;
  if (
    ![left, top, right, bottom].every(Number.isFinite) ||
    width < 0 ||
    height < 0 ||
    width > maximumSceneSpan ||
    height > maximumSceneSpan
  ) {
    throw new Error('This board area is too large to export. Select a smaller area.');
  }
  const options = {
    elements,
    files: filteredFiles(elements, allFiles),
    appState: {
      viewBackgroundColor: safeColor(background, '#ffffff'),
      exportBackground: true,
      exportWithDarkMode: false,
      exportEmbedScene: false,
    },
    exportPadding: padding,
  };
  if (format === 'svg')
    return serializableSvg(await renderer.exportToSvg({ ...options, renderEmbeddables: false }), title);
  const png = await renderer.exportToBlob({
    ...options,
    mimeType: 'image/png',
    getDimensions: (width: number, height: number) => {
      const scale = Math.min(1, exportEdgeLimit / Math.max(1, width, height));
      return {
        width: Math.max(1, Math.ceil(width * scale)),
        height: Math.max(1, Math.ceil(height * scale)),
        scale,
      };
    },
  });
  if (format === 'png') return png;
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.create();
  document.setTitle(title);
  const image = await document.embedPng(await png.arrayBuffer());
  const pointsPerPixel = 72 / 96;
  const pdfWidth = image.width * pointsPerPixel;
  const pdfHeight = image.height * pointsPerPixel;
  const page = document.addPage([pdfWidth, pdfHeight]);
  page.drawImage(image, { x: 0, y: 0, width: pdfWidth, height: pdfHeight });
  return new Blob([Uint8Array.from(await document.save())], { type: 'application/pdf' });
}
