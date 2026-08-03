import { describe, expect, it } from 'vitest';
import { hammingDistance, perceptualHash } from '../electron/main/image-hash.js';
import type { NativeImage } from '../test/stubs/electron.js';

/**
 * Doble de NativeImage: devuelve un bitmap BGRA de 9x8 construido a partir de
 * una funcion de luminancia, que es lo unico que mira el hash.
 */
function fakeImage(luma: (x: number, y: number) => number): NativeImage {
  const width = 9;
  const height = 8;
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.max(0, Math.min(255, Math.round(luma(x, y))));
      const offset = (y * width + x) * 4;
      bitmap[offset] = value; // B
      bitmap[offset + 1] = value; // G
      bitmap[offset + 2] = value; // R
      bitmap[offset + 3] = 255;
    }
  }

  const image: NativeImage = {
    resize: () => image,
    toBitmap: () => bitmap,
    getSize: () => ({ width, height }),
    toJPEG: () => Buffer.alloc(0),
    isEmpty: () => false,
    toDataURL: () => '',
  };
  return image;
}

describe('hash perceptual', () => {
  it('devuelve 64 bits en 16 digitos hexadecimales', () => {
    const hash = perceptualHash(fakeImage((x) => x * 20));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('el mismo cuadro produce el mismo hash', () => {
    const image = fakeImage((x, y) => x * 17 + y * 3);
    expect(perceptualHash(image)).toBe(perceptualHash(image));
  });

  it('un gradiente y su espejo dan hashes opuestos', () => {
    const rising = perceptualHash(fakeImage((x) => x * 28));
    const falling = perceptualHash(fakeImage((x) => 255 - x * 28));
    expect(rising).not.toBe(falling);
    expect(hammingDistance(rising, falling)).toBe(64);
  });

  it('un cambio local mueve pocos bits', () => {
    const base = fakeImage((x, y) => (x * 13 + y * 29) % 256);
    const tweaked = fakeImage((x, y) =>
      x === 4 && y === 4 ? 250 : (x * 13 + y * 29) % 256,
    );
    const distance = hammingDistance(perceptualHash(base), perceptualHash(tweaked));
    expect(distance).toBeGreaterThan(0);
    // El umbral del modo pasivo es 8: un pixel cambiado no debe dispararlo.
    expect(distance).toBeLessThanOrEqual(8);
  });
});

describe('distancia de Hamming', () => {
  it('es cero contra si misma', () => {
    expect(hammingDistance('0f1e2d3c4b5a6978', '0f1e2d3c4b5a6978')).toBe(0);
  });

  it('cuenta bits, no digitos', () => {
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('longitudes distintas se tratan como maximamente distintas', () => {
    expect(hammingDistance('00', '0000000000000000')).toBe(64);
  });
});
