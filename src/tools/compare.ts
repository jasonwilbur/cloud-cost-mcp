/**
 * Cloud Cost MCP - Cross-Cloud Comparison Tools
 * Core comparison logic for compute, storage, egress, and Kubernetes
 */

import type {
  CloudProvider,
  ComputeInstance,
  StoragePricing,
  ComputeComparisonQuery,
  ComputeComparisonResult,
  StorageComparisonQuery,
  StorageComparisonResult,
  EgressComparisonQuery,
  EgressComparisonResult,
  ComputeCategory,
  StorageTier,
} from '../types.js';
import {
  getAllComputeInstances,
  getAllStorageOptions,
  getAllEgressPricing,
  getAllKubernetesPricing,
} from '../data/loader.js';

/**
 * Compare compute instances across all cloud providers
 * Finds instances that match the specified vCPU and memory requirements
 */
export function compareCompute(query: ComputeComparisonQuery): ComputeComparisonResult {
  const allInstances = getAllComputeInstances();

  // Handle missing parameters gracefully
  const vcpus = query.vcpus || 0;
  const memoryGB = query.memoryGB || 0;

  // Find matching instances (within 50% of requested specs)
  const vcpuMin = vcpus * 0.5;
  const vcpuMax = vcpus * 1.5;
  const memMin = memoryGB * 0.5;
  const memMax = memoryGB * 1.5;

  let matches = allInstances.filter(instance => {
    const vcpuMatch = instance.vcpus >= vcpuMin && instance.vcpus <= vcpuMax;
    const memMatch = instance.memoryGB >= memMin && instance.memoryGB <= memMax;
    return vcpuMatch && memMatch;
  });

  // Apply category filter if specified
  // Special case: 'arm' category filters by architecture
  if (query.category) {
    if (query.category === 'arm') {
      matches = matches.filter(i => i.architecture === 'arm');
    } else {
      matches = matches.filter(i => i.category === query.category);
    }
  }

  // Sort by monthly price
  matches.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

  // Find cheapest
  const cheapest = matches.length > 0 ? matches[0] : null;

  // Calculate savings vs AWS baseline
  const awsInstance = matches.find(i => i.provider === 'aws');
  let savingsVsAWS: number | undefined;

  if (cheapest && awsInstance && cheapest.provider !== 'aws') {
    savingsVsAWS = Math.round(
      ((awsInstance.monthlyPrice - cheapest.monthlyPrice) / awsInstance.monthlyPrice) * 100
    );
  }

  // Generate summary
  let summary = `Found ${matches.length} matching instances for ~${vcpus} vCPUs and ~${memoryGB}GB RAM.`;
  if (cheapest) {
    summary += ` Cheapest: ${cheapest.provider.toUpperCase()} ${cheapest.name} at $${cheapest.monthlyPrice.toFixed(2)}/month.`;
    if (savingsVsAWS && savingsVsAWS > 0) {
      summary += ` ${savingsVsAWS}% cheaper than AWS equivalent.`;
    }
  }

  return {
    query,
    matches: matches.slice(0, 20), // Return top 20
    cheapest,
    summary,
    savingsVsAWS,
  };
}

/**
 * Compare storage pricing across all cloud providers
 */
export function compareStorage(query: StorageComparisonQuery): StorageComparisonResult {
  const allStorage = getAllStorageOptions();

  // Filter by tier if specified
  let matches = allStorage;
  if (query.tier) {
    matches = matches.filter(s => s.tier === query.tier);
  }

  // Filter by type if specified
  if (query.type) {
    matches = matches.filter(s => s.type === query.type);
  }

  // Calculate monthly cost for each option
  const monthlyEstimates = matches.map(storage => ({
    provider: storage.provider,
    name: storage.name,
    monthlyCost: storage.pricePerGBMonth * query.sizeGB,
  }));

  // Sort by cost
  monthlyEstimates.sort((a, b) => a.monthlyCost - b.monthlyCost);

  // Find cheapest storage option
  const cheapestEstimate = monthlyEstimates[0];
  const cheapest = cheapestEstimate
    ? matches.find(s => s.provider === cheapestEstimate.provider && s.name === cheapestEstimate.name) || null
    : null;

  // Generate summary
  const tierStr = query.tier ? ` (${query.tier} tier)` : '';
  const typeStr = query.type ? ` ${query.type}` : '';
  let summary = `Storage comparison for ${query.sizeGB}GB${typeStr}${tierStr}.`;
  if (cheapestEstimate) {
    summary += ` Cheapest: ${cheapestEstimate.provider.toUpperCase()} ${cheapestEstimate.name} at $${cheapestEstimate.monthlyCost.toFixed(2)}/month.`;
  }

  return {
    query,
    matches: matches.slice(0, 20),
    cheapest,
    monthlyEstimates: monthlyEstimates.slice(0, 20),
    summary,
  };
}

/**
 * Compare data egress costs across all cloud providers
 * This is where OCI really shines with 10TB free egress
 */
export function compareEgress(query: EgressComparisonQuery): EgressComparisonResult {
  const allEgress = getAllEgressPricing();

  const estimates = allEgress.map(egress => {
    const { provider, freeGBPerMonth, tiers } = egress;

    // Calculate billable GB
    const billableGB = Math.max(0, query.monthlyGB - freeGBPerMonth);

    // Calculate cost based on tiers
    let monthlyCost = 0;
    let remainingGB = billableGB;

    for (const tier of tiers) {
      if (remainingGB <= 0) break;

      const gbInTier = tier.upToGB === -1
        ? remainingGB
        : Math.min(remainingGB, tier.upToGB - freeGBPerMonth);

      if (gbInTier > 0) {
        monthlyCost += gbInTier * tier.pricePerGB;
        remainingGB -= gbInTier;
      }
    }

    // Build breakdown string
    let breakdown = `${freeGBPerMonth.toLocaleString()}GB free`;
    if (billableGB > 0) {
      breakdown += `, ${billableGB.toLocaleString()}GB billed at tiered rates`;
    }

    return {
      provider,
      monthlyCost,
      breakdown,
    };
  });

  // Sort by cost
  estimates.sort((a, b) => a.monthlyCost - b.monthlyCost);

  const cheapest = estimates[0].provider;

  // Generate summary highlighting OCI advantage
  const ociEstimate = estimates.find(e => e.provider === 'oci');
  const awsEstimate = estimates.find(e => e.provider === 'aws');

  let summary = `Egress comparison for ${query.monthlyGB.toLocaleString()}GB/month. `;
  summary += `Cheapest: ${cheapest.toUpperCase()} at $${estimates[0].monthlyCost.toFixed(2)}/month.`;

  if (ociEstimate && awsEstimate && ociEstimate.monthlyCost < awsEstimate.monthlyCost) {
    const savings = awsEstimate.monthlyCost - ociEstimate.monthlyCost;
    summary += ` OCI saves $${savings.toFixed(2)}/month vs AWS (10TB free egress!).`;
  }

  return {
    query,
    estimates,
    cheapest,
    summary,
  };
}

/**
 * Compare Kubernetes pricing across providers
 */
export function compareKubernetes(options: {
  nodeCount: number;
  nodeVcpus: number;
  nodeMemoryGB: number;
}): {
  estimates: Array<{
    provider: CloudProvider;
    controlPlaneCost: number;
    workerNodeCost: number;
    totalMonthlyCost: number;
    notes: string;
  }>;
  cheapest: CloudProvider;
  summary: string;
} {
  const k8sPricing = getAllKubernetesPricing();
  const computeResult = compareCompute({
    vcpus: options.nodeVcpus,
    memoryGB: options.nodeMemoryGB,
  });

  const estimates: Array<{
    provider: CloudProvider;
    controlPlaneCost: number;
    workerNodeCost: number;
    totalMonthlyCost: number;
    notes: string;
  }> = [];

  const providers: CloudProvider[] = ['aws', 'azure', 'gcp', 'oci'];

  for (const provider of providers) {
    const k8s = k8sPricing[provider];
    if (!k8s) continue;

    // Find worker node cost for this provider
    const workerNode = computeResult.matches.find(m => m.provider === provider);
    const workerNodeCost = workerNode
      ? workerNode.monthlyPrice * options.nodeCount
      : 0;

    estimates.push({
      provider,
      controlPlaneCost: k8s.controlPlaneMonthly,
      workerNodeCost,
      totalMonthlyCost: k8s.controlPlaneMonthly + workerNodeCost,
      notes: k8s.notes || '',
    });
  }

  estimates.sort((a, b) => a.totalMonthlyCost - b.totalMonthlyCost);

  const cheapest = estimates[0].provider;

  let summary = `Kubernetes cluster comparison: ${options.nodeCount} nodes × ${options.nodeVcpus} vCPUs × ${options.nodeMemoryGB}GB. `;
  summary += `Cheapest: ${cheapest.toUpperCase()} at $${estimates[0].totalMonthlyCost.toFixed(2)}/month.`;

  // Highlight free control planes
  const freeControlPlane = estimates.filter(e => e.controlPlaneCost === 0);
  if (freeControlPlane.length > 0) {
    summary += ` Free control plane: ${freeControlPlane.map(e => e.provider.toUpperCase()).join(', ')}.`;
  }

  return {
    estimates,
    cheapest,
    summary,
  };
}

/**
 * Find the cheapest provider for given compute specs
 */
export function findCheapestCompute(options: {
  vcpus: number;
  memoryGB: number;
  category?: ComputeCategory;
}): {
  cheapest: ComputeInstance | null;
  allOptions: Array<{
    provider: CloudProvider;
    instance: ComputeInstance | null;
  }>;
  summary: string;
} {
  const result = compareCompute(options);

  const providers: CloudProvider[] = ['aws', 'azure', 'gcp', 'oci'];
  const allOptions = providers.map(provider => ({
    provider,
    instance: result.matches.find(m => m.provider === provider) || null,
  }));

  return {
    cheapest: result.cheapest,
    allOptions,
    summary: result.summary,
  };
}

/**
 * Get storage pricing summary by tier
 */
export function getStoragePricingSummary(sizeGB: number): {
  byTier: Record<StorageTier, Array<{ provider: CloudProvider; name: string; monthlyCost: number }>>;
  recommendation: string;
} {
  const tiers: StorageTier[] = ['hot', 'cool', 'cold', 'archive'];
  const byTier: Record<StorageTier, Array<{ provider: CloudProvider; name: string; monthlyCost: number }>> = {
    hot: [],
    cool: [],
    cold: [],
    archive: [],
  };

  for (const tier of tiers) {
    const result = compareStorage({ sizeGB, tier });
    byTier[tier] = result.monthlyEstimates;
  }

  // Generate recommendation
  const hotCheapest = byTier.hot[0];
  const archiveCheapest = byTier.archive[0];

  let recommendation = `For ${sizeGB}GB frequently accessed data, use ${hotCheapest?.provider.toUpperCase()} ${hotCheapest?.name} ($${hotCheapest?.monthlyCost.toFixed(2)}/mo).`;
  if (archiveCheapest) {
    recommendation += ` For archival, use ${archiveCheapest.provider.toUpperCase()} ${archiveCheapest.name} ($${archiveCheapest.monthlyCost.toFixed(2)}/mo).`;
  }

  return {
    byTier,
    recommendation,
  };
}
