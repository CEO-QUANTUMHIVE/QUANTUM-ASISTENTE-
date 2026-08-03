/** Superficie minima que necesita el hash; no depende de Electron. */
export interface HashImage {
  resize(options: { width: number; height: number; quality: 'good' }): HashImage;
  toBitmap(): Buffer;
  getSize(): { width: number; height: number };
}

/** Hash perceptual dHash de 64 bits. */
export function perceptualHash(image: HashImage): string {
  const small = image.resize({ width: 9, height: 8, quality: 'good' });
  const bitmap = small.toBitmap();
  const { width } = small.getSize();

  const luma = (x: number, y: number): number => {
    const offset = (y * width + x) * 4;
    const b = bitmap[offset] ?? 0;
    const g = bitmap[offset + 1] ?? 0;
    const r = bitmap[offset + 2] ?? 0;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  let bits = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits += luma(x, y) > luma(x + 1, y) ? '1' : '0';
    }
  }

  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}
