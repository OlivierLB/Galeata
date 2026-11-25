import { animations, type AnimationName } from './animations.ts';

export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 224;
const cache = new Map<string, Promise<HTMLCanvasElement>>();

/** The source PNGs remain untouched; cyan is keyed only in the display cache. */
export function keyCyan(data: Uint8ClampedArray) {
  for (let offset = 0; offset < data.length; offset += 4) {
    const cyan = Math.min(data[offset + 1], data[offset + 2]);
    const difference = cyan - data[offset];
    if (cyan > 140 && difference > 65) {
      data[offset + 3] = Math.round(data[offset + 3] * Math.max(0, 1 - (difference - 65) / 55));
    }
  }
}

type Component = { area: number; left: number; top: number; right: number; bottom: number };

/**
 * Finds the character silhouettes instead of assuming exact grid cells: the
 * supplied five-pose sheets have arms crossing nominal column boundaries.
 * Small disconnected stars/shadows follow their nearest character.
 */
function prepare(image: HTMLImageElement, columns: number): HTMLCanvasElement {
  const source = document.createElement('canvas');
  source.width = columns * 160;
  source.height = Math.round(image.height * source.width / image.width);
  const context = source.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas indisponible');
  context.drawImage(image, 0, 0, source.width, source.height);
  const pixels = context.getImageData(0, 0, source.width, source.height);
  keyCyan(pixels.data);
  const width = source.width;
  const height = source.height;
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(labels.length);
  const components: Component[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || pixels.data[start * 4 + 3] < 24) continue;
    const label = components.length + 1;
    const component: Component = { area: 0, left: width, top: height, right: 0, bottom: 0 };
    let head = 0;
    let tail = 1;
    queue[0] = start;
    labels[start] = label;
    const visit = (neighbor: number) => {
      if (neighbor < 0 || neighbor >= labels.length || labels[neighbor] || pixels.data[neighbor * 4 + 3] < 24) return;
      labels[neighbor] = label;
      queue[tail++] = neighbor;
    };
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      component.area++;
      component.left = Math.min(component.left, x);
      component.right = Math.max(component.right, x);
      component.top = Math.min(component.top, y);
      component.bottom = Math.max(component.bottom, y);
      visit(x ? index - 1 : -1);
      visit(x + 1 < width ? index + 1 : -1);
      visit(index - width);
      visit(index + width);
    }
    components.push(component);
  }
  const main = components.map((component, index) => ({ ...component, label: index + 1 }))
    .sort((a, b) => b.area - a.area).slice(0, columns).sort((a, b) => a.left - b.left);
  if (main.length !== columns) throw new Error('Planches de la mascotte incomplètes');
  const groups = new Int16Array(components.length + 1);
  const boxes = main.map((component) => ({ ...component }));
  components.forEach((component, index) => {
    const center = (component.left + component.right) / 2;
    const own = main.findIndex((body) => body.label === index + 1);
    const group = own >= 0 ? own : main.reduce((nearest, body, i) =>
      Math.abs(center - (body.left + body.right) / 2)
        < Math.abs(center - (main[nearest].left + main[nearest].right) / 2) ? i : nearest, 0);
    groups[index + 1] = group;
    if (component.area < 3) return;
    const box = boxes[group];
    box.left = Math.min(box.left, component.left);
    box.right = Math.max(box.right, component.right);
    box.top = Math.min(box.top, component.top);
    box.bottom = Math.max(box.bottom, component.bottom);
  });
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  const frameHeight = bottom - top + 1;
  const scale = Math.min((FRAME_WIDTH - 10) / Math.max(...boxes.map((box) => box.right - box.left + 1)), (FRAME_HEIGHT - 10) / frameHeight);
  const atlas = document.createElement('canvas');
  atlas.width = columns * FRAME_WIDTH;
  atlas.height = FRAME_HEIGHT;
  const output = atlas.getContext('2d');
  if (!output) throw new Error('Canvas indisponible');
  for (let frame = 0; frame < columns; frame++) {
    const box = boxes[frame];
    const frameWidth = box.right - box.left + 1;
    const scratch = document.createElement('canvas');
    scratch.width = frameWidth;
    scratch.height = frameHeight;
    const scratchContext = scratch.getContext('2d');
    if (!scratchContext) throw new Error('Canvas indisponible');
    const cropped = scratchContext.createImageData(frameWidth, frameHeight);
    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const from = (y + top) * width + x + box.left;
        if (!labels[from] || groups[labels[from]] !== frame) continue;
        const to = (y * frameWidth + x) * 4;
        cropped.data[to] = pixels.data[from * 4];
        cropped.data[to + 1] = pixels.data[from * 4 + 1];
        cropped.data[to + 2] = pixels.data[from * 4 + 2];
        cropped.data[to + 3] = pixels.data[from * 4 + 3];
      }
    }
    scratchContext.putImageData(cropped, 0, 0);
    output.drawImage(scratch, frame * FRAME_WIDTH + (FRAME_WIDTH - frameWidth * scale) / 2,
      FRAME_HEIGHT - frameHeight * scale - 4, frameWidth * scale, frameHeight * scale);
  }
  return atlas;
}

/** Each sheet is decoded and prepared once, then shared by all conversations. */
export function spriteAtlas(animation: AnimationName): Promise<HTMLCanvasElement> {
  const definition = animations[animation];
  let pending = cache.get(definition.file);
  if (!pending) {
    pending = new Promise<HTMLCanvasElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try { resolve(prepare(image, definition.columns)); }
        catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error('Image de la mascotte indisponible'));
      image.src = `/mascot/turtle/${definition.file}`;
    });
    cache.set(definition.file, pending);
    void pending.catch(() => cache.delete(definition.file));
  }
  return pending;
}
