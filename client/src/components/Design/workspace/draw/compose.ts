import type { Size } from '../preview-geometry';
import type { DrawShape } from './shapes';
import { paintShapes } from './shapes';

export const MAX_IMAGE_SIDE = 2048;

export interface LoadedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close?: () => void;
}

export interface ComposeDeps {
  loadImage: (blob: Blob) => Promise<LoadedImage>;
  createCanvas: (size: Size) => HTMLCanvasElement;
}

export class ComposeError extends Error {
  readonly code = 'compose_failed';

  constructor() {
    super('compose_failed');
    this.name = 'ComposeError';
  }
}

async function loadImage(blob: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight, source: image };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function createCanvas({ width, height }: Size) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const browserDeps: ComposeDeps = { loadImage, createCanvas };

export function composedSize(image: Size, maxSide = MAX_IMAGE_SIDE) {
  const factor = Math.min(1, maxSide / Math.max(image.width, image.height));
  return {
    factor,
    width: Math.max(1, Math.round(image.width * factor)),
    height: Math.max(1, Math.round(image.height * factor)),
  };
}

function toPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ComposeError())), 'image/png');
  });
}

export async function composeMarkedImage(
  screenshot: Blob,
  shapes: readonly DrawShape[],
  viewport: Size,
  deps: ComposeDeps = browserDeps,
): Promise<Blob> {
  const image = await deps.loadImage(screenshot).catch(() => {
    throw new ComposeError();
  });
  try {
    const { factor, width, height } = composedSize(image);
    const canvas = deps.createCanvas({ width, height });
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new ComposeError();
    }
    ctx.drawImage(image.source, 0, 0, width, height);
    const markScale = (image.width / viewport.width) * factor;
    ctx.setTransform(markScale, 0, 0, markScale, 0, 0);
    paintShapes(ctx, shapes);
    return await toPng(canvas);
  } finally {
    image.close?.();
  }
}
