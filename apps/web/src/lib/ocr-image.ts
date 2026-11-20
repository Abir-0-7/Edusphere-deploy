export type Crop = { left: number; top: number; right: number; bottom: number };
export const fullImage: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
export const maxImagePixels = 16_000_000;

export function validateImage(file: File, width: number, height: number) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPG, or WebP image.');
  }
  if (file.size === 0 || file.size > 15 * 1024 * 1024) {
    throw new Error('Choose a nonempty image that is 15 MB or smaller.');
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > maxImagePixels
  ) {
    throw new Error('Choose an image with at most 16 million pixels.');
  }
}

export function drawOcrImage(canvas: HTMLCanvasElement, bitmap: ImageBitmap, crop: Crop, turns: number) {
  if (
    !Number.isInteger(turns) ||
    turns < 0 ||
    turns > 3 ||
    Object.values(crop).some((edge) => !Number.isFinite(edge) || edge < 0 || edge > 95) ||
    crop.left + crop.right >= 100 ||
    crop.top + crop.bottom >= 100
  ) {
    throw new Error('Choose a crop that leaves part of the image visible and a quarter-turn rotation.');
  }
  const x = Math.floor((bitmap.width * crop.left) / 100);
  const y = Math.floor((bitmap.height * crop.top) / 100);
  const width = Math.max(1, Math.ceil((bitmap.width * (100 - crop.right)) / 100) - x);
  const height = Math.max(1, Math.ceil((bitmap.height * (100 - crop.bottom)) / 100) - y);
  canvas.width = turns % 2 === 0 ? width : height;
  canvas.height = turns % 2 === 0 ? height : width;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image preview is unavailable.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(bitmap, x, y, width, height, -width / 2, -height / 2, width, height);
}
