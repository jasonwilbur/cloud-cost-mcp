/**
 * Cloud Cost MCP - AWS Real-Time Pricing Fetcher
 * Uses instances.vantage.sh API (no auth required)
 * Data source: https://instances.vantage.sh/instances.json
 *
 * Coverage: 1,147 EC2 instance types, 353 RDS instance types
 */

import { pricingCache } from '../cache.js';
import type { ComputeInstance, DatabasePricing, ComputeCategory } from '../../types.js';

// Data source endpoints (public, no auth required)
const EC2_INSTANCES_URL = 'https://instances.vantage.sh/instances.json';
const RDS_INSTANCES_URL = 'https://instances.vantage.sh/rds/instances.json';

// AWS Lightsail pricing (manually curated - AWS doesn't expose this via API)
const LIGHTSAIL_BUNDLES = [
  { name: 'nano', vcpus: 1, memoryGB: 0.5, storageGB: 20, transferTB: 1, hourlyPrice: 0.0047, monthlyPrice: 3.50 },
  { name: 'micro', vcpus: 1, memoryGB: 1, storageGB: 40, transferTB: 2, hourlyPrice: 0.0067, monthlyPrice: 5.00 },
  { name: 'small', vcpus: 1, memoryGB: 2, storageGB: 60, transferTB: 3, hourlyPrice: 0.0134, monthlyPrice: 10.00 },
  { name: 'medium', vcpus: 2, memoryGB: 4, storageGB: 80, transferTB: 4, hourlyPrice: 0.0268, monthlyPrice: 20.00 },
  { name: 'large', vcpus: 2, memoryGB: 8, storageGB: 160, transferTB: 5, hourlyPrice: 0.0536, monthlyPrice: 40.00 },
  { name: 'xlarge', vcpus: 4, memoryGB: 16, storageGB: 320, transferTB: 6, hourlyPrice: 0.1072, monthlyPrice: 80.00 },
  { name: '2xlarge', vcpus: 8, memoryGB: 32, storageGB: 640, transferTB: 7, hourlyPrice: 0.2144, monthlyPrice: 160.00 },
];

// Cache keys
const CACHE_KEY_EC2 = 'AWS_EC2_REALTIME';
const CACHE_KEY_RDS = 'AWS_RDS_REALTIME';
const CACHE_TTL_MINUTES = 60; // Cache for 1 hour

/**
 * Raw instance data from vantage.sh
 */
interface VantageInstance {
  instance_type: string;
  family: string;
  vCPU: number;
  memory: number;
  arch: string[];
  physical_processor?: string;
  clock_speed_ghz?: string;
  network_performance?: string;
  GPU?: number;
  generation?: string;
  pricing: {
    [region: string]: {
      linux?: {
        ondemand?: string;
        spot_avg?: string;
        spot_min?: string;
        spot_max?: string;
        reserved?: {
          [term: string]: string;
        };
      };
      windows?: {
        ondemand?: string;
      };
    };
  };
}

interface VantageRDSInstance {
  instance_type: string;
  family: string;
  vCPU: number;
  memory: number;
  pricing: {
    [region: string]: {
      [engine: string]: {
        ondemand?: string;
        reserved?: {
          [term: string]: string;
        };
      };
    };
  };
}

/**
 * Fetch all EC2 instance pricing from instances.vantage.sh
 */
export async function fetchAWSEC2Pricing(options?: {
  region?: string;
  family?: string;
  architecture?: 'x86' | 'arm';
  maxResults?: number;
  includeSpot?: boolean;
  includeReserved?: boolean;
}): Promise<{
  instances: ComputeInstance[];
  totalCount: number;
  timestamp: string;
  source: string;
}> {
  const region = options?.region || 'us-east-1';
  const maxResults = options?.maxResults || 500;

  // Check cache first
  const cacheKey = `${CACHE_KEY_EC2}_${region}`;
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
    const response = await fetch(EC2_INSTANCES_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch EC2 data: ${response.status}`);
    }

    const data = await response.json() as VantageInstance[];
    const instances: ComputeInstance[] = [];

    for (const item of data) {
      const regionPricing = item.pricing[region];
      if (!regionPricing?.linux?.ondemand) continue;

      const hourlyPrice = parseFloat(regionPricing.linux.ondemand);
      if (isNaN(hourlyPrice)) continue;

      const category = mapFamilyToCategory(item.family);
      const architecture = item.arch?.includes('arm64') ? 'arm' : 'x86';

      const instance: ComputeInstance = {
        provider: 'aws',
        name: item.instance_type,
        displayName: `${item.instance_type} (${item.family})`,
        vcpus: item.vCPU,
        memoryGB: item.memory,
        hourlyPrice,
        monthlyPrice: Math.round(hourlyPrice * 730 * 100) / 100,
        region,
        category,
        architecture,
        gpuCount: item.GPU || undefined,
        notes: buildNotes(item, regionPricing, options),
      };

      instances.push(instance);
    }

    // Sort by monthly price
    instances.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

    // Cache the full result
    pricingCache.set(cacheKey, instances, CACHE_TTL_MINUTES);

    return {
      instances: filterAndLimit(instances, options, maxResults),
      totalCount: instances.length,
      timestamp: new Date().toISOString(),
      source: EC2_INSTANCES_URL,
    };
  } catch (error) {
    throw new Error(`Failed to fetch AWS EC2 pricing: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Fetch AWS RDS database pricing
 */
export async function fetchAWSRDSPricing(options?: {
  region?: string;
  engine?: string;
  maxResults?: number;
}): Promise<{
  instances: DatabasePricing[];
  totalCount: number;
  timestamp: string;
  source: string;
}> {
  const region = options?.region || 'us-east-1';
  const engine = options?.engine || 'PostgreSQL';
  const maxResults = options?.maxResults || 100;

  // Check cache first
  const cacheKey = `${CACHE_KEY_RDS}_${region}_${engine}`;
  const cached = pricingCache.get<DatabasePricing[]>(cacheKey);
  if (cached) {
    return {
      instances: cached.slice(0, maxResults),
      totalCount: cached.length,
      timestamp: new Date().toISOString(),
      source: 'cache',
    };
  }

  try {
    const response = await fetch(RDS_INSTANCES_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch RDS data: ${response.status}`);
    }

    const data = await response.json() as VantageRDSInstance[];
    const instances: DatabasePricing[] = [];

    for (const item of data) {
      const regionPricing = item.pricing[region];
      if (!regionPricing) continue;

      // Try to find pricing for the requested engine
      const engineKey = Object.keys(regionPricing).find(
        k => k.toLowerCase().includes(engine.toLowerCase())
      );
      if (!engineKey) continue;

      const enginePricing = regionPricing[engineKey];
      if (!enginePricing?.ondemand) continue;

      const hourlyPrice = parseFloat(enginePricing.ondemand);
      if (isNaN(hourlyPrice)) continue;

      instances.push({
        provider: 'aws',
        name: `RDS ${item.instance_type}`,
        type: 'relational',
        engine,
        vcpus: item.vCPU,
        memoryGB: item.memory,
        hourlyPrice,
        monthlyPrice: Math.round(hourlyPrice * 730 * 100) / 100,
        notes: `Single-AZ, ${engine}`,
      });
    }

    // Sort by monthly price
    instances.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

    // Cache the result
    pricingCache.set(cacheKey, instances, CACHE_TTL_MINUTES);

    return {
      instances: instances.slice(0, maxResults),
      totalCount: instances.length,
      timestamp: new Date().toISOString(),
      source: RDS_INSTANCES_URL,
    };
  } catch (error) {
    throw new Error(`Failed to fetch AWS RDS pricing: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get AWS Lightsail bundle pricing
 */
export function getAWSLightsailPricing(options?: {
  region?: string;
}): {
  bundles: ComputeInstance[];
  notes: string[];
} {
  const region = options?.region || 'us-east-1';

  const bundles: ComputeInstance[] = LIGHTSAIL_BUNDLES.map(bundle => ({
    provider: 'aws',
    name: `Lightsail ${bundle.name}`,
    displayName: `Lightsail ${bundle.name.charAt(0).toUpperCase() + bundle.name.slice(1)} (${bundle.memoryGB}GB RAM)`,
    vcpus: bundle.vcpus,
    memoryGB: bundle.memoryGB,
    hourlyPrice: bundle.hourlyPrice,
    monthlyPrice: bundle.monthlyPrice,
    region,
    category: 'general' as ComputeCategory,
    architecture: 'x86' as const,
    notes: `Includes ${bundle.storageGB}GB SSD, ${bundle.transferTB}TB transfer`,
  }));

  return {
    bundles,
    notes: [
      'Lightsail is a simplified VPS service with fixed monthly pricing',
      'Includes SSD storage, data transfer, and static IP',
      'Prices are consistent across most regions',
      'Windows instances cost approximately 60% more',
    ],
  };
}

/**
 * Get available AWS regions from the data
 */
export async function getAWSRegions(): Promise<string[]> {
  try {
    const response = await fetch(EC2_INSTANCES_URL);
    if (!response.ok) return [];

    const data = await response.json() as VantageInstance[];
    if (data.length === 0) return [];

    // Get regions from first instance
    const regions = Object.keys(data[0].pricing || {});
    return regions.sort();
  } catch {
    return [];
  }
}

/**
 * Check if AWS data source is accessible
 */
export async function checkAWSAPIStatus(): Promise<{ available: boolean; message: string }> {
  try {
    const response = await fetch(EC2_INSTANCES_URL, { method: 'HEAD' });
    if (response.ok) {
      return {
        available: true,
        message: `instances.vantage.sh API is accessible (1,147+ EC2 instances available)`
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

/**
 * Get instance families/categories available
 */
export async function getAWSInstanceFamilies(): Promise<{ family: string; count: number }[]> {
  try {
    const response = await fetch(EC2_INSTANCES_URL);
    if (!response.ok) return [];

    const data = await response.json() as VantageInstance[];
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

// Helper functions

function mapFamilyToCategory(family: string): ComputeCategory {
  const familyLower = family.toLowerCase();
  if (familyLower.includes('compute')) return 'compute';
  if (familyLower.includes('memory')) return 'memory';
  if (familyLower.includes('storage')) return 'storage';
  if (familyLower.includes('accelerated') || familyLower.includes('gpu')) return 'gpu';
  return 'general';
}

function filterAndLimit(
  instances: ComputeInstance[],
  options: {
    family?: string;
    architecture?: 'x86' | 'arm';
  } | undefined,
  maxResults: number
): ComputeInstance[] {
  let filtered = instances;

  if (options?.family) {
    filtered = filtered.filter(i =>
      i.displayName?.toLowerCase().includes(options.family!.toLowerCase())
    );
  }

  if (options?.architecture) {
    filtered = filtered.filter(i => i.architecture === options.architecture);
  }

  return filtered.slice(0, maxResults);
}

function buildNotes(
  item: VantageInstance,
  regionPricing: VantageInstance['pricing'][string],
  options?: { includeSpot?: boolean; includeReserved?: boolean }
): string {
  const notes: string[] = [];

  if (item.physical_processor) {
    notes.push(item.physical_processor);
  }

  if (item.generation === 'previous') {
    notes.push('Previous generation');
  }

  if (options?.includeSpot && regionPricing.linux?.spot_avg) {
    const spotPrice = parseFloat(regionPricing.linux.spot_avg);
    const ondemandPrice = parseFloat(regionPricing.linux.ondemand || '0');
    if (!isNaN(spotPrice) && !isNaN(ondemandPrice) && ondemandPrice > 0) {
      const savings = Math.round((1 - spotPrice / ondemandPrice) * 100);
      notes.push(`Spot: $${spotPrice.toFixed(4)}/hr (${savings}% savings)`);
    }
  }

  if (options?.includeReserved && regionPricing.linux?.reserved) {
    const reserved1yr = regionPricing.linux.reserved['yrTerm1Standard.noUpfront'];
    if (reserved1yr) {
      const reservedPrice = parseFloat(reserved1yr);
      const ondemandPrice = parseFloat(regionPricing.linux.ondemand || '0');
      if (!isNaN(reservedPrice) && !isNaN(ondemandPrice) && ondemandPrice > 0) {
        const savings = Math.round((1 - reservedPrice / ondemandPrice) * 100);
        notes.push(`1yr Reserved: $${reservedPrice.toFixed(4)}/hr (${savings}% savings)`);
      }
    }
  }

  return notes.join('. ') || 'Linux on-demand pricing';
}
