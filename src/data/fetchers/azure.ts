/**
 * Cloud Cost MCP - Azure Real-Time Pricing Fetcher
 * Uses Azure Retail Prices API (public, no auth required)
 * https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
 */

import { pricingCache, CACHE_KEYS } from '../cache.js';
import type { ComputeInstance, StoragePricing } from '../../types.js';

const AZURE_RETAIL_API = 'https://prices.azure.com/api/retail/prices';

export interface AzureRetailPrice {
  currencyCode: string;
  tierMinimumUnits: number;
  retailPrice: number;
  unitPrice: number;
  armRegionName: string;
  location: string;
  effectiveStartDate: string;
  meterId: string;
  meterName: string;
  productId: string;
  skuId: string;
  productName: string;
  skuName: string;
  serviceName: string;
  serviceId: string;
  serviceFamily: string;
  unitOfMeasure: string;
  type: string;
  isPrimaryMeterRegion: boolean;
  armSkuName: string;
}

export interface AzureRetailResponse {
  BillingCurrency: string;
  CustomerEntityId: string;
  CustomerEntityType: string;
  Items: AzureRetailPrice[];
  NextPageLink: string | null;
  Count: number;
}

/**
 * Fetch Azure VM pricing from the Retail Prices API
 */
export async function fetchAzureComputePricing(options?: {
  region?: string;
  vmSeries?: string;
  maxResults?: number;
}): Promise<ComputeInstance[]> {
  const region = options?.region || 'eastus';
  const maxResults = options?.maxResults || 100;

  // Build OData filter
  const filters: string[] = [
    `armRegionName eq '${region}'`,
    "serviceName eq 'Virtual Machines'",
    "priceType eq 'Consumption'",
    "currencyCode eq 'USD'",
  ];

  if (options?.vmSeries) {
    filters.push(`contains(armSkuName, '${options.vmSeries}')`);
  }

  const filterQuery = filters.join(' and ');
  const url = `${AZURE_RETAIL_API}?$filter=${encodeURIComponent(filterQuery)}&$top=${maxResults}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Azure API request failed: ${response.status}`);
    }

    const data = await response.json() as AzureRetailResponse;

    // Transform Azure response to unified ComputeInstance format
    const instances: ComputeInstance[] = [];
    const seenSkus = new Set<string>();

    for (const item of data.Items) {
      // Skip non-VM items and duplicates
      if (!item.armSkuName || seenSkus.has(item.armSkuName)) {
        continue;
      }

      // Skip low priority, spot, and Windows (focus on Linux pay-as-you-go)
      if (item.skuName.includes('Low Priority') ||
          item.skuName.includes('Spot') ||
          item.productName.includes('Windows')) {
        continue;
      }

      // Extract vCPU and memory from SKU name (rough estimates)
      const vmSpecs = parseAzureVMSpecs(item.armSkuName);
      if (!vmSpecs) continue;

      seenSkus.add(item.armSkuName);

      instances.push({
        provider: 'azure',
        name: item.armSkuName,
        displayName: `${item.armSkuName} (${item.productName})`,
        vcpus: vmSpecs.vcpus,
        memoryGB: vmSpecs.memoryGB,
        hourlyPrice: item.retailPrice,
        monthlyPrice: item.retailPrice * 730,
        region: item.armRegionName,
        category: vmSpecs.category,
        architecture: vmSpecs.architecture,
        notes: `Real-time from Azure API - ${new Date().toISOString().split('T')[0]}`,
      });
    }

    return instances.sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  } catch (error) {
    throw new Error(`Failed to fetch Azure pricing: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Fetch Azure Storage pricing
 */
export async function fetchAzureStoragePricing(options?: {
  region?: string;
}): Promise<StoragePricing[]> {
  const region = options?.region || 'eastus';

  const filters: string[] = [
    `armRegionName eq '${region}'`,
    "(serviceName eq 'Storage' or serviceName eq 'Azure Blob Storage')",
    "priceType eq 'Consumption'",
    "currencyCode eq 'USD'",
  ];

  const filterQuery = filters.join(' and ');
  const url = `${AZURE_RETAIL_API}?$filter=${encodeURIComponent(filterQuery)}&$top=100`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Azure API request failed: ${response.status}`);
    }

    const data = await response.json() as AzureRetailResponse;

    const storage: StoragePricing[] = [];
    const seenProducts = new Set<string>();

    for (const item of data.Items) {
      const key = `${item.productName}-${item.skuName}`;
      if (seenProducts.has(key)) continue;

      // Only include per-GB storage pricing
      if (!item.unitOfMeasure.includes('GB')) continue;

      seenProducts.add(key);

      const tier = parseAzureStorageTier(item.skuName, item.productName);
      const type = parseAzureStorageType(item.productName);

      storage.push({
        provider: 'azure',
        name: `${item.productName} - ${item.skuName}`,
        type,
        tier,
        pricePerGBMonth: item.retailPrice,
        region: item.armRegionName,
        redundancy: parseAzureRedundancy(item.skuName),
        notes: `Real-time from Azure API`,
      });
    }

    return storage;
  } catch (error) {
    throw new Error(`Failed to fetch Azure storage pricing: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parse Azure VM specs from SKU name
 */
function parseAzureVMSpecs(skuName: string): {
  vcpus: number;
  memoryGB: number;
  category: 'general' | 'compute' | 'memory' | 'storage' | 'gpu' | 'arm';
  architecture: 'x86' | 'arm';
} | null {
  // Common Azure VM naming patterns
  // Standard_D2s_v5 -> D series, 2 vCPUs
  // Standard_E4s_v5 -> E series (memory), 4 vCPUs
  // Standard_F8s_v2 -> F series (compute), 8 vCPUs

  const match = skuName.match(/Standard_([A-Z]+)(\d+)/i);
  if (!match) return null;

  const series = match[1].toUpperCase();
  const size = parseInt(match[2], 10);

  // Estimate vCPUs (usually matches the number in the name)
  const vcpus = size;

  // Estimate memory based on series
  let memoryGB: number;
  let category: 'general' | 'compute' | 'memory' | 'storage' | 'gpu' | 'arm';
  let architecture: 'x86' | 'arm' = 'x86';

  switch (series.charAt(0)) {
    case 'D': // General purpose
      memoryGB = vcpus * 4;
      category = 'general';
      break;
    case 'E': // Memory optimized
      memoryGB = vcpus * 8;
      category = 'memory';
      break;
    case 'F': // Compute optimized
      memoryGB = vcpus * 2;
      category = 'compute';
      break;
    case 'B': // Burstable
      memoryGB = vcpus * 4;
      category = 'general';
      break;
    case 'N': // GPU
      memoryGB = vcpus * 4;
      category = 'gpu';
      break;
    default:
      memoryGB = vcpus * 4;
      category = 'general';
  }

  // Check for ARM (ps suffix)
  if (skuName.toLowerCase().includes('ps')) {
    architecture = 'arm';
    category = 'arm';
  }

  return { vcpus, memoryGB, category, architecture };
}

/**
 * Parse Azure storage tier from SKU name
 */
function parseAzureStorageTier(skuName: string, productName: string): 'hot' | 'cool' | 'cold' | 'archive' {
  const combined = `${skuName} ${productName}`.toLowerCase();
  if (combined.includes('archive')) return 'archive';
  if (combined.includes('cold')) return 'cold';
  if (combined.includes('cool')) return 'cool';
  return 'hot';
}

/**
 * Parse Azure storage type
 */
function parseAzureStorageType(productName: string): 'object' | 'block' | 'file' | 'archive' {
  const name = productName.toLowerCase();
  if (name.includes('blob')) return 'object';
  if (name.includes('disk') || name.includes('managed')) return 'block';
  if (name.includes('file')) return 'file';
  if (name.includes('archive')) return 'archive';
  return 'object';
}

/**
 * Parse Azure storage redundancy
 */
function parseAzureRedundancy(skuName: string): string {
  const sku = skuName.toUpperCase();
  if (sku.includes('GZRS')) return 'GZRS';
  if (sku.includes('GRS')) return 'GRS';
  if (sku.includes('ZRS')) return 'ZRS';
  if (sku.includes('LRS')) return 'LRS';
  return 'LRS';
}

/**
 * Check if Azure API is accessible
 */
export async function checkAzureAPIStatus(): Promise<{ available: boolean; message: string }> {
  try {
    const response = await fetch(`${AZURE_RETAIL_API}?$top=1`);
    if (response.ok) {
      return { available: true, message: 'Azure Retail Prices API + instances.vantage.sh accessible (1,199 instance types)' };
    }
    return { available: false, message: `API returned status ${response.status}` };
  } catch (error) {
    return {
      available: false,
      message: `API check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// =============================================================================
// VANTAGE.SH DATA SOURCE (1,199 Azure Instance Types)
// =============================================================================

const AZURE_VANTAGE_URL = 'https://instances.vantage.sh/azure/instances.json';
const CACHE_KEY_AZURE_VANTAGE = 'AZURE_VANTAGE_REALTIME';
const CACHE_TTL_MINUTES = 60;

/**
 * Raw Azure instance data from vantage.sh
 */
interface VantageAzureInstance {
  pretty_name: string;
  family: string;
  category: string;
  vcpu: number;
  memory: number;
  size: number;
  GPU: string;
  pricing: {
    [region: string]: {
      linux?: {
        ondemand?: number;
        spot_min?: number;
        basic?: number;
      };
      windows?: {
        ondemand?: number;
        spot_min?: number;
        hybridbenefit?: number;
      };
    };
  };
}

/**
 * Fetch comprehensive Azure VM pricing from vantage.sh (1,199 instance types)
 */
export async function fetchAzureVantagePricing(options?: {
  region?: string;
  category?: string;
  includeSpot?: boolean;
  maxResults?: number;
}): Promise<{
  instances: ComputeInstance[];
  totalCount: number;
  timestamp: string;
  source: string;
}> {
  const region = options?.region || 'us-east';
  const maxResults = options?.maxResults || 500;

  // Check cache first
  const cacheKey = `${CACHE_KEY_AZURE_VANTAGE}_${region}`;
  const cached = pricingCache.get<ComputeInstance[]>(cacheKey);
  if (cached) {
    return {
      instances: filterAzureInstances(cached, options, maxResults),
      totalCount: cached.length,
      timestamp: new Date().toISOString(),
      source: 'cache',
    };
  }

  try {
    const response = await fetch(AZURE_VANTAGE_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch Azure data: ${response.status}`);
    }

    const data = await response.json() as VantageAzureInstance[];
    const instances: ComputeInstance[] = [];

    for (const item of data) {
      const regionPricing = item.pricing[region];
      if (!regionPricing?.linux?.ondemand) continue;

      const hourlyPrice = regionPricing.linux.ondemand;
      if (isNaN(hourlyPrice) || hourlyPrice === 0) continue;

      const category = mapAzureCategoryToComputeCategory(item.category);
      const gpuCount = parseInt(item.GPU) || 0;

      let notes = item.pretty_name;
      if (gpuCount > 0) {
        notes += ` (${gpuCount}x GPU)`;
      }
      if (options?.includeSpot && regionPricing.linux?.spot_min) {
        const spotPrice = regionPricing.linux.spot_min;
        const savings = Math.round((1 - spotPrice / hourlyPrice) * 100);
        notes += ` | Spot: $${spotPrice.toFixed(4)}/hr (${savings}% off)`;
      }

      instances.push({
        provider: 'azure',
        name: item.pretty_name,
        displayName: `${item.pretty_name} (${item.category})`,
        vcpus: item.vcpu,
        memoryGB: item.memory,
        hourlyPrice,
        monthlyPrice: Math.round(hourlyPrice * 730 * 100) / 100,
        region,
        category,
        architecture: 'x86', // Default, would need to check for ARM
        gpuCount: gpuCount > 0 ? gpuCount : undefined,
        notes,
      });
    }

    // Sort by monthly price
    instances.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

    // Cache the full result
    pricingCache.set(cacheKey, instances, CACHE_TTL_MINUTES);

    return {
      instances: filterAzureInstances(instances, options, maxResults),
      totalCount: instances.length,
      timestamp: new Date().toISOString(),
      source: AZURE_VANTAGE_URL,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Azure pricing: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get available Azure regions from vantage.sh data
 */
export async function getAzureVantageRegions(): Promise<string[]> {
  try {
    const response = await fetch(AZURE_VANTAGE_URL);
    if (!response.ok) return [];

    const data = await response.json() as VantageAzureInstance[];
    if (data.length === 0) return [];

    const regions = Object.keys(data[0].pricing || {});
    return regions.sort();
  } catch {
    return [];
  }
}

/**
 * Get Azure instance categories from vantage.sh
 */
export async function getAzureCategories(): Promise<{ category: string; count: number }[]> {
  try {
    const response = await fetch(AZURE_VANTAGE_URL);
    if (!response.ok) return [];

    const data = await response.json() as VantageAzureInstance[];
    const categoryCounts = new Map<string, number>();

    for (const item of data) {
      const count = categoryCounts.get(item.category) || 0;
      categoryCounts.set(item.category, count + 1);
    }

    return Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

// Helper functions for vantage.sh data

function mapAzureCategoryToComputeCategory(category: string): 'general' | 'compute' | 'memory' | 'storage' | 'gpu' | 'arm' {
  const cat = category.toLowerCase();
  if (cat.includes('compute')) return 'compute';
  if (cat.includes('memory')) return 'memory';
  if (cat.includes('storage')) return 'storage';
  if (cat.includes('gpu') || cat.includes('accelerated')) return 'gpu';
  return 'general';
}

function filterAzureInstances(
  instances: ComputeInstance[],
  options: { category?: string } | undefined,
  maxResults: number
): ComputeInstance[] {
  let filtered = instances;

  if (options?.category) {
    filtered = filtered.filter(i =>
      i.displayName?.toLowerCase().includes(options.category!.toLowerCase())
    );
  }

  return filtered.slice(0, maxResults);
}
