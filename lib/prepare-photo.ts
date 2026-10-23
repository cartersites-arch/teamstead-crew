'use client';

export const MAX_PHOTO_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 512 * 1024;
export const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Photo preparation cancelled.', 'AbortError');
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      cleanup();
      image.src = '';
      reject(new DOMException('Photo preparation cancelled.', 'AbortError'));
    };
    image.onload = () => {
      cleanup();
      if (!image.naturalWidth || !image.naturalHeight) reject(new Error('This photo has no readable image. Choose another file.'));
      else resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('This photo could not be opened. Choose a valid JPG, PNG, GIF, or WebP file.'));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    else image.src = url;
  });
}

function jpeg(canvas: HTMLCanvasElement, quality: number, signal?: AbortSignal): Promise<Blob> {
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException('Photo preparation cancelled.', 'AbortError'));
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      canvas.toBlob(blob => {
        signal?.removeEventListener('abort', cancel);
        if (signal?.aborted) cancel();
        else if (!blob || !blob.size || blob.type !== 'image/jpeg') reject(new Error('This browser could not prepare the photo. Try another photo or browser.'));
        else resolve(blob);
      }, 'image/jpeg', quality);
    } catch (error) {
      signal?.removeEventListener('abort', cancel);
      reject(error);
    }
  });
}

/** Prepares an upload in memory only. The server still validates every uploaded image. */
export async function preparePhoto(file: File, signal?: AbortSignal): Promise<File> {
  checkCancelled(signal);
  if (!PHOTO_TYPES.has(file.type)) throw new Error('Choose JPG, PNG, GIF, or WebP photos.');
  if (!file.size) throw new Error('This photo is empty. Choose another file.');
  if (file.size > MAX_PHOTO_INPUT_BYTES) throw new Error('Choose original photos of 5 MB or smaller.');
  if (file.type === 'image/gif' && file.size > MAX_PHOTO_BYTES) throw new Error('GIFs must already be 512 KB or smaller. Choose a smaller GIF, or use a JPG, PNG, or WebP photo.');
  if (file.type === 'image/gif') {
    const signature = new TextDecoder().decode(await file.slice(0, 6).arrayBuffer());
    checkCancelled(signal);
    if (signature !== 'GIF87a' && signature !== 'GIF89a') throw new Error('This is not a valid GIF. Choose another photo.');
  }

  const url = URL.createObjectURL(file);
  let canvas: HTMLCanvasElement | undefined;
  try {
    const image = await loadImage(url, signal);
    checkCancelled(signal);
    // Keep small GIFs animated; canvas would silently flatten them to one frame.
    if (file.type === 'image/gif') return file;
    canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the photo. Try another browser.');
    const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (let resize = 0; resize < 9; resize++) {
      checkCancelled(signal);
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.86, 0.74, 0.62, 0.5]) {
        const blob = await jpeg(canvas, quality, signal);
        checkCancelled(signal);
        if (blob.size <= MAX_PHOTO_BYTES) {
          const name = (file.name.replace(/\.[^.]*$/, '') || 'photo') + '.jpg';
          return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
        }
      }
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
    throw new Error('This photo could not fit the 512 KB upload limit. Choose a smaller photo.');
  } finally {
    URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
