/**
 * Cloud Cost MCP - OCI Real-Time Pricing Fetcher
 * Uses Oracle's public pricing API (no auth required)
 */

import { pricingCache, CACHE_KEYS } from '../cache.js';

const OCI_PRICING_API = 'https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/';

export interface OCIProduct {
  partNumber: string;
  displayName: string;
  metricName: string;
  serviceCategory: string;
  currencyCodeLocalizations: Array<{
    currencyCode: string;
    prices: Array<{
      model: string;
      value: number;
    }>;
  }>;
}

export interface OCIPricingResponse {
  lastUpdated: string;
  items: OCIProduct[];
}

export interface OCISimplifiedProduct {
  partNumber: string;
  displayName: string;
  metricName: string;
  serviceCategory: string;
  unitPrice: number;
  currency: string;
  isBYOL: boolean;
  licenseModel: 'standard' | 'byol';
}

export interface OCIFetchResult {
  lastUpdated: string;
  totalProducts: number;
  items: OCISimplifiedProduct[];
  summary: {
    totalSKUs: number;
    standardPricing: number;
    byolPricing: number;
    uniqueCategories: number;
  };
  apiNotes: string[];
}

/**
 * Fetch real-time pricing from Oracle's public API
 */
export async function fetchOCIRealTimePricing(options?: {
  currency?: string;
  category?: string;
  search?: string;
}): Promise<OCIFetchResult> {
  const currency = options?.currency || 'USD';
  const cacheKey = `${CACHE_KEYS.OCI_REALTIME}_${currency}`;

  // Check cache (5 minute TTL for real-time data)
  const cached = pricingCache.get<OCIFetchResult>(cacheKey);

  if (cached) {
    return filterOCIData(cached, options);
  }

  try {
    const response = await fetch(OCI_PRICING_API);
    if (!response.ok) {
      throw new Error(`OCI API request failed: ${response.status}`);
    }

    const data = await response.json() as OCIPricingResponse;

    // Transform to simpler format with selected currency
    const items: OCISimplifiedProduct[] = data.items.map(item => {
      let unitPrice = 0;

      for (const curr of item.currencyCodeLocalizations || []) {
        if (curr.currencyCode === currency) {
          for (const p of curr.prices) {
            if (p.model === 'PAY_AS_YOU_GO') {
              unitPrice = p.value;
              break;
            }
          }
          break;
        }
      }

      // Detect BYOL (Bring Your Own License) from display name
      const isBYOL = item.displayName.toUpperCase().includes('BYOL') ||
                     item.displayName.toUpperCase().includes('BRING YOUR OWN LICENSE');

      return {
        partNumber: item.partNumber,
        displayName: item.displayName,
        metricName: item.metricName,
        serviceCategory: item.serviceCategory,
        unitPrice,
        currency,
        isBYOL,
        licenseModel: isBYOL ? 'byol' : 'standard',
      };
    });

    // Generate summary statistics
    const byolCount = items.filter(item => item.isBYOL).length;
    const standardCount = items.length - byolCount;
    const uniqueCategories = new Set(items.map(item => item.serviceCategory)).size;

    const result: OCIFetchResult = {
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      totalProducts: items.length,
      items,
      summary: {
        totalSKUs: items.length,
        standardPricing: standardCount,
        byolPricing: byolCount,
        uniqueCategories,
      },
      apiNotes: [
        'Public API returns PAY_AS_YOU_GO pricing only',
        'BYOL (Bring Your Own License) variants are included as separate SKUs',
        'Reserved/Committed pricing (1-year, 3-year) NOT available via public API',
        'Universal Credits and Monthly Flex pricing NOT included',
        'Government cloud and private region pricing may differ',
        'OCI maintains consistent pricing across all commercial regions',
        'For reserved/committed pricing, contact Oracle sales or use Universal Credits calculator',
      ],
    };

    // Cache for 5 minutes
    pricingCache.set(cacheKey, result, 5);

    return filterOCIData(result, options);
  } catch (error) {
    throw new Error(`Failed to fetch OCI pricing: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Filter OCI pricing data by category or search term
 */
function filterOCIData(
  data: OCIFetchResult,
  options?: { category?: string; search?: string }
): OCIFetchResult {
  let items = data.items;

  if (options?.category) {
    const cat = options.category.toLowerCase();
    items = items.filter(item =>
      item.serviceCategory.toLowerCase().includes(cat)
    );
  }

  if (options?.search) {
    const search = options.search.toLowerCase();
    items = items.filter(item =>
      item.displayName.toLowerCase().includes(search) ||
      item.partNumber.toLowerCase().includes(search) ||
      item.serviceCategory.toLowerCase().includes(search)
    );
  }

  // Recalculate summary for filtered data
  const byolCount = items.filter(item => item.isBYOL).length;
  const standardCount = items.length - byolCount;
  const uniqueCategories = new Set(items.map(item => item.serviceCategory)).size;

  return {
    ...data,
    items,
    totalProducts: items.length,
    summary: {
      totalSKUs: items.length,
      standardPricing: standardCount,
      byolPricing: byolCount,
      uniqueCategories,
    },
  };
}

/**
 * Get all service categories from OCI's real-time API
 */
export async function getOCICategories(): Promise<string[]> {
  const data = await fetchOCIRealTimePricing();
  const categories = new Set<string>();
  for (const item of data.items) {
    categories.add(item.serviceCategory);
  }
  return Array.from(categories).sort();
}

/**
 * Check if OCI API is accessible
 */
export async function checkOCIAPIStatus(): Promise<{ available: boolean; message: string }> {
  try {
    const response = await fetch(OCI_PRICING_API);
    if (response.ok) {
      return { available: true, message: 'OCI Pricing API is accessible' };
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
 * Get OCI compute products from real-time API
 */
export async function fetchOCIComputePricing(options?: {
  currency?: string;
}): Promise<OCISimplifiedProduct[]> {
  const data = await fetchOCIRealTimePricing({
    currency: options?.currency,
    category: 'Compute',
  });
  return data.items;
}

/**
 * Get OCI storage products from real-time API
 */
export async function fetchOCIStoragePricing(options?: {
  currency?: string;
}): Promise<OCISimplifiedProduct[]> {
  const data = await fetchOCIRealTimePricing({
    currency: options?.currency,
    category: 'Storage',
  });
  return data.items;
}
