import { describe, it, expect } from 'vitest';
import {
  compareCompute,
  compareStorage,
  findCheapestCompute,
} from '../src/tools/compare.js';
import { quickEstimate, getAvailablePresets } from '../src/tools/calculator.js';
import { getDataFreshness, getAllComputeInstances } from '../src/data/loader.js';

describe('compareCompute', () => {
  it('returns matches within the 50% spec window and sorts cheapest first', () => {
    const res = compareCompute({ vcpus: 4, memoryGB: 16 });
    expect(res.matches.length).toBeGreaterThan(0);
    // Every match must fall inside the +/-50% window the tool advertises.
    for (const m of res.matches) {
      expect(m.vcpus).toBeGreaterThanOrEqual(4 * 0.5);
      expect(m.vcpus).toBeLessThanOrEqual(4 * 1.5);
      expect(m.memoryGB).toBeGreaterThanOrEqual(16 * 0.5);
      expect(m.memoryGB).toBeLessThanOrEqual(16 * 1.5);
    }
    // Sorted ascending by monthly price.
    const prices = res.matches.map((m) => m.monthlyPrice);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(res.cheapest).toEqual(res.matches[0]);
  });

  it('caps results at 20', () => {
    const res = compareCompute({ vcpus: 2, memoryGB: 8 });
    expect(res.matches.length).toBeLessThanOrEqual(20);
  });

  it('computes savingsVsAWS as a sane percentage when a cheaper non-AWS option wins', () => {
    const res = compareCompute({ vcpus: 4, memoryGB: 16 });
    if (res.savingsVsAWS !== undefined) {
      expect(res.savingsVsAWS).toBeLessThan(100);
      expect(res.savingsVsAWS).toBeGreaterThan(-1000);
    }
  });
});

describe('data freshness + integrity', () => {
  it('reports freshness for all four providers', () => {
    const fresh = getDataFreshness();
    const providers = fresh.map((f) => f.provider).sort();
    expect(providers).toEqual(['aws', 'azure', 'gcp', 'oci']);
  });

  it('every bundled compute instance has sane, well-formed fields', () => {
    const instances = getAllComputeInstances();
    expect(instances.length).toBeGreaterThan(1000);
    for (const i of instances) {
      // Specs can be 0 for flexible/placeholder shapes, but never negative or NaN.
      expect(Number.isFinite(i.vcpus)).toBe(true);
      expect(i.vcpus).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(i.memoryGB)).toBe(true);
      expect(i.memoryGB).toBeGreaterThanOrEqual(0);
      expect(i.monthlyPrice).toBeGreaterThanOrEqual(0);
      expect(['aws', 'azure', 'gcp', 'oci']).toContain(i.provider);
      expect(typeof i.name).toBe('string');
      expect(i.name.length).toBeGreaterThan(0);
    }
  });
});

describe('presets', () => {
  it('quick_estimate resolves a known preset', () => {
    const presets = getAvailablePresets();
    expect(presets.length).toBeGreaterThan(0);
    const res = quickEstimate(presets[0].name);
    expect(res).toBeTruthy();
  });
});

describe('compareStorage / findCheapestCompute smoke', () => {
  it('returns structured results without throwing', () => {
    expect(() => compareStorage({ sizeGB: 100 })).not.toThrow();
    expect(() => findCheapestCompute({ vcpus: 2, memoryGB: 4 })).not.toThrow();
  });
});
