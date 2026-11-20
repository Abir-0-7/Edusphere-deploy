import { describe, expect, it, vi } from 'vitest';
import { drawOcrImage, fullImage, validateImage } from '../src/lib/ocr-image';

describe('bounded OCR image preparation', () => {
  it('rejects unsupported, empty, oversized and excessive decoded images', () => {
    expect(() => validateImage(new File(['image'], 'source.svg', { type: 'image/svg+xml' }), 1, 1)).toThrow(
      'PNG',
    );
    expect(() => validateImage(new File([], 'empty.png', { type: 'image/png' }), 1, 1)).toThrow('nonempty');
    const file = new File(['image'], 'source.png', { type: 'image/png' });
    expect(() => validateImage(file, 5000, 5000)).toThrow('16 million');
    expect(() => validateImage(file, Number.NaN, 1)).toThrow('16 million');
    expect(() => validateImage(file, 4000, 4000)).not.toThrow();
  });

  it('crops original edges before rotating and swaps the output dimensions', () => {
    const context = {
      fillStyle: '',
      fillRect: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    const image = { width: 1000, height: 600 } as ImageBitmap;
    drawOcrImage(canvas, image, { left: 10, right: 20, top: 25, bottom: 25 }, 1);
    expect([canvas.width, canvas.height]).toEqual([300, 700]);
    expect(context.drawImage).toHaveBeenCalledWith(image, 100, 150, 700, 300, -350, -150, 700, 300);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
  });

  it('rejects invalid crops instead of sampling outside the source', () => {
    const canvas = {} as HTMLCanvasElement;
    const image = { width: 1000, height: 600 } as ImageBitmap;
    expect(() => drawOcrImage(canvas, image, { ...fullImage, left: 80, right: 30 }, 0)).toThrow('crop');
    expect(() => drawOcrImage(canvas, image, fullImage, 0.5)).toThrow('rotation');
  });
});
