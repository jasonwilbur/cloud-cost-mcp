/**
 * Cloud Cost MCP - GCP Real-Time Pricing Fetcher
 * Uses instances.vantage.sh API (no auth required)
 * Data source: https://instances.vantage.sh/gcp/instances.json
 *
 * Coverage: 287 GCP instance types across 40+ regions
 */

import { pricingCache } from '../cache.js';
import type { ComputeInstance, ComputeCategory } from '../../types.js';

// Data source endpoint (public, no auth required)
const GCP_INSTANCES_URL = 'https://instances.vantage.sh/gcp/instances.json';

// Cache settings
const CACHE_KEY_GCP = 'GCP_COMPUTE_REALTIME';
const CACHE_TTL_MINUTES = 60;

/**
 * Raw instance data from vantage.sh for GCP
 */
interface VantageGCPInstance {
  instance_type: string;
  family: string;
  vCPU: number;
  memory: number;
  pretty_name: string;
  network_performance?: string;
  generation?: string;
  GPU?: number;
  GPU_model?: string;
  local_ssd?: boolean;
  shared_cpu?: boolean;
  pricing: {
    [region: string]: {
      linux?: {
        ondemand?: string;
        spot?: string;
      };
      windows?: {
        ondemand?: string;
        spot?: string;
      };
    };
  };
  regions?: {
    [region: string]: string; // region code -> display name
  };
}

/**
 * Fetch all GCP compute instance pricing
 */
export async function fetchGCPComputePricing(options?: {
  region?: string;
  family?: string;
  includeSpot?: boolean;
  maxResults?: number;
}): Promise<{
  instances: ComputeInstance[];
  totalCount: number;
  timestamp: string;
  source: string;
}> {
  const region = options?.region || 'us-central1';
  const maxResults = options?.maxResults || 300;

  // Check cache first
  const cacheKey = `${CACHE_KEY_GCP}_${region}`;
  const cached = pricingCache.get<ComputeInstance[]>(cacheKey);
  if (cached) {
    return {
      instances: filterAndLimit(cached, options, maxResults),
      totalCount: cached.length,
      timestamp: new Date().toISOString(),
      source: 'cache',
    };
  }

  try {
    const response = await fetch(GCP_INSTANCES_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch GCP data: ${response.status}`);
    }

    const data = await response.json() as VantageGCPInstance[];
    const instances: ComputeInstance[] = [];

    for (const item of data) {
      const regionPricing = item.pricing[region];
      if (!regionPricing?.linux?.ondemand) continue;

      const hourlyPrice = parseFloat(regionPricing.linux.ondemand);
      if (isNaN(hourlyPrice) || hourlyPrice === 0) continue;

      const category = mapGCPFamilyToCategory(item.family);

      let notes = item.pretty_name || item.instance_type;
      if (item.GPU && item.GPU > 0) {
        notes += ` (${item.GPU}x ${item.GPU_model || 'GPU'})`;
      }
      if (item.shared_cpu) {
        notes += ' - Shared CPU';
      }
      if (options?.includeSpot && regionPricing.linux?.spot) {
        const spotPrice = parseFloat(regionPricing.linux.spot);
        if (!isNaN(spotPrice)) {
          const savings = Math.round((1 - spotPrice / hourlyPrice) * 100);
          notes += ` | Spot: $${spotPrice.toFixed(4)}/hr (${savings}% off)`;
        }
      }

      instances.push({
        provider: 'gcp',
        name: item.instance_type,
        displayName: `${item.instance_type} (${item.family})`,
        vcpus: item.vCPU,
        memoryGB: item.memory,
        hourlyPrice,
        monthlyPrice: Math.round(hourlyPrice * 730 * 100) / 100,
        region,
        category,
        architecture: 'x86', // GCP doesn't have ARM yet in this dataset
        gpuCount: item.GPU || undefined,
        gpuType: item.GPU_model || undefined,
        notes,
      });
    }

    // Sort by monthly price
    instances.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

    // Cache the full result
    pricingCache.set(cacheKey, instances, CACHE_TTL_MINUTES);

    return {
      instances: filterAndLimit(instances, options, maxResults),
      totalCount: instances.length,
      timestamp: new Date().toISOString(),
      source: GCP_INSTANCES_URL,
    };
  } catch (error) {
    throw new Error(`Failed to fetch GCP pricing: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get available GCP regions from the data
 */
export async function getGCPRegions(): Promise<{ code: string; name: string }[]> {
  try {
    const response = await fetch(GCP_INSTANCES_URL);
    if (!response.ok) return [];

    const data = await response.json() as VantageGCPInstance[];
    if (data.length === 0) return [];

    // Get regions from first instance that has the regions map
    const firstWithRegions = data.find(d => d.regions);
    if (!firstWithRegions?.regions) {
      // Fallback: get region codes from pricing keys
      const regions = Object.keys(data[0].pricing || {});
      return regions.map(code => ({ code, name: code })).sort((a, b) => a.code.localeCompare(b.code));
    }

    return Object.entries(firstWithRegions.regions)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  } catch {
    return [];
  }
}

/**
 * Get GCP instance families with counts
 */
export async function getGCPInstanceFamilies(): Promise<{ family: string; count: number }[]> {
  try {
    const response = await fetch(GCP_INSTANCES_URL);
    if (!response.ok) return [];

    const data = await response.json() as VantageGCPInstance[];
    const familyCounts = new Map<string, number>();

    for (const item of data) {
      const count = familyCounts.get(item.family) || 0;
      familyCounts.set(item.family, count + 1);
    }

    return Array.from(familyCounts.entries())
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

/**
 * Check if GCP data source is accessible
 */
export async function checkGCPAPIStatus(): Promise<{ available: boolean; message: string }> {
  try {
    const response = await fetch(GCP_INSTANCES_URL, { method: 'HEAD' });
    if (response.ok) {
      return {
        available: true,
        message: 'instances.vantage.sh GCP API is accessible (287 instance types, 40+ regions)',
      };
    }
    return { available: false, message: `API returned status ${response.status}` };
  } catch (error) {
    return {
      available: false,
      message: `API check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// Helper functions

function mapGCPFamilyToCategory(family: string): ComputeCategory {
  const familyLower = family.toLowerCase();
  if (familyLower.includes('compute')) return 'compute';
  if (familyLower.includes('memory')) return 'memory';
  if (familyLower.includes('storage')) return 'storage';
  if (familyLower.includes('accelerator') || familyLower.includes('gpu')) return 'gpu';
  if (familyLower.includes('machine learning') || familyLower.includes('asic')) return 'gpu';
  return 'general';
}

function filterAndLimit(
  instances: ComputeInstance[],
  options: { family?: string } | undefined,
  maxResults: number
): ComputeInstance[] {
  let filtered = instances;

  if (options?.family) {
    filtered = filtered.filter(i =>
      i.displayName?.toLowerCase().includes(options.family!.toLowerCase())
    );
  }

  return filtered.slice(0, maxResults);
}
