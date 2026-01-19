/**
 * Cloud Cost MCP - In-memory cache for pricing data
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export class PricingCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTTL: number; // milliseconds

  constructor(defaultTTLMinutes: number = 60) {
    this.defaultTTL = defaultTTLMinutes * 60 * 1000;
  }

  /**
   * Get an item from the cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set an item in the cache
   */
  set<T>(key: string, data: T, ttlMinutes?: number): void {
    const ttl = ttlMinutes ? ttlMinutes * 60 * 1000 : this.defaultTTL;
    const now = Date.now();

    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttl,
    });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete an item from the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all items from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    this.cleanExpired();
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Clean expired entries
   */
  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instance for the pricing data cache
export const pricingCache = new PricingCache(60); // 1 hour default TTL

// Cache keys for all providers
export const CACHE_KEYS = {
  // Provider-specific data
  AWS_PRICING: 'aws_pricing_data',
  AZURE_PRICING: 'azure_pricing_data',
  GCP_PRICING: 'gcp_pricing_data',
  OCI_PRICING: 'oci_pricing_data',

  // Combined/computed data
  ALL_COMPUTE: 'all_compute_instances',
  ALL_STORAGE: 'all_storage_options',
  ALL_EGRESS: 'all_egress_pricing',
  ALL_KUBERNETES: 'all_kubernetes_options',

  // Real-time API caches
  AZURE_REALTIME: 'azure_realtime',
  OCI_REALTIME: 'oci_realtime',
} as const;
