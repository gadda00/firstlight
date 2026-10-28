/* Deterministic seeded PRNG (mulberry32) — reproducible demo data. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  /** uniform [0,1) */
  float(): number {
    return this.next();
  }
  /** uniform [min,max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  /** integer [min,max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  bool(p = 0.5): boolean {
    return this.next() < p;
  }
  /** approximately normal via sum of uniforms */
  gauss(mean = 0, sd = 1): number {
    const u = this.next() + this.next() + this.next() + this.next();
    return mean + (u - 2) * 0.8660254 * sd * 1.4142;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** Simple stable string hash (FNV-1a) for audit trails / tool assertions. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
