/**
 * Cloud Cost MCP - Data Loader
 * Loads pricing data from bundled JSON files for all cloud providers
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type {
  CloudProvider,
  ProviderPricingData,
  AllCloudPricing,
  ComputeInstance,
  StoragePricing,
  EgressPricing,
  DataFreshnessInfo,
} from '../types.js';
import { pricingCache, CACHE_KEYS } from './cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load bundled pricing data from JSON file for a specific provider
 */
function loadBundledData(provider: CloudProvider): ProviderPricingData {
  const dataPath = join(__dirname, 'bundled', `${provider}-pricing.json`);
  const rawData = readFileSync(dataPath, 'utf-8');
  return JSON.parse(rawData) as ProviderPricingData;
}

/**
 * Get pricing data for a specific provider
 */
export function getProviderData(provider: CloudProvider): ProviderPricingData {
  const cacheKey = `${provider.toUpperCase()}_PRICING`;
  const cached = pricingCache.get<ProviderPricingData>(cacheKey);

  if (cached) {
    return cached;
  }

  const data = loadBundledData(provider);
  pricingCache.set(cacheKey, data, 60 * 24); // Cache for 24 hours
  return data;
}

/**
 * Get all provider pricing data
 */
export function getAllProviderData(): AllCloudPricing {
  return {
    aws: getProviderData('aws'),
    azure: getProviderData('azure'),
    gcp: getProviderData('gcp'),
    oci: getProviderData('oci'),
  };
}

/**
 * Get all compute instances across all providers
 */
export function getAllComputeInstances(): ComputeInstance[] {
  const cached = pricingCache.get<ComputeInstance[]>(CACHE_KEYS.ALL_COMPUTE);
  if (cached) {
    return cached;
  }

  const allData = getAllProviderData();
  const instances: ComputeInstance[] = [
    ...allData.aws.compute,
    ...allData.azure.compute,
    ...allData.gcp.compute,
    ...allData.oci.compute,
  ];

  pricingCache.set(CACHE_KEYS.ALL_COMPUTE, instances, 60);
  return instances;
}

/**
 * Get all storage options across all providers
 */
export function getAllStorageOptions(): StoragePricing[] {
  const cached = pricingCache.get<StoragePricing[]>(CACHE_KEYS.ALL_STORAGE);
  if (cached) {
    return cached;
  }

  const allData = getAllProviderData();
  const storage: StoragePricing[] = [
    ...allData.aws.storage,
    ...allData.azure.storage,
    ...allData.gcp.storage,
    ...allData.oci.storage,
  ];

  pricingCache.set(CACHE_KEYS.ALL_STORAGE, storage, 60);
  return storage;
}

/**
 * Get egress pricing for all providers
 */
export function getAllEgressPricing(): EgressPricing[] {
  const allData = getAllProviderData();
  return [
    allData.aws.egress,
    allData.azure.egress,
    allData.gcp.egress,
    allData.oci.egress,
  ];
}

/**
 * Check data freshness for all providers
 */
export function getDataFreshness(): DataFreshnessInfo[] {
  const allData = getAllProviderData();
  const now = new Date();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  return (['aws', 'azure', 'gcp', 'oci'] as CloudProvider[]).map(provider => {
    const data = allData[provider];
    const lastUpdated = new Date(data.metadata.lastUpdated);
    const ageMs = now.getTime() - lastUpdated.getTime();
    const ageInDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    return {
      provider,
      lastUpdated: data.metadata.lastUpdated,
      ageInDays,
      isStale: ageMs > thirtyDaysMs,
      source: data.metadata.source,
      canRefresh: provider === 'aws' || provider === 'azure' || provider === 'oci', // These have public APIs
    };
  });
}

/**
 * Get provider metadata
 */
export function getProviderMetadata(provider: CloudProvider) {
  return getProviderData(provider).metadata;
}

/**
 * Refresh cache for all providers
 */
export function refreshAllCache(): void {
  pricingCache.clear();
}

/**
 * Get Kubernetes pricing for all providers
 */
export function getAllKubernetesPricing() {
  const allData = getAllProviderData();
  return {
    aws: allData.aws.kubernetes,
    azure: allData.azure.kubernetes,
    gcp: allData.gcp.kubernetes,
    oci: allData.oci.kubernetes,
  };
}

/**
 * Get database pricing for all providers
 */
export function getAllDatabasePricing() {
  const allData = getAllProviderData();
  return {
    aws: allData.aws.database || [],
    azure: allData.azure.database || [],
    gcp: allData.gcp.database || [],
    oci: allData.oci.database || [],
  };
}
