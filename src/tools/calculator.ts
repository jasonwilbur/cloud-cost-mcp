/**
 * Cloud Cost MCP - Cost Calculator Tools
 * Estimate workload costs across all cloud providers
 */

import type {
  CloudProvider,
  WorkloadSpec,
  WorkloadCostEstimate,
  WorkloadComparisonResult,
} from '../types.js';
import { compareCompute, compareStorage, compareEgress, compareKubernetes } from './compare.js';

/**
 * Calculate workload cost for a specific provider
 */
function calculateProviderCost(
  spec: WorkloadSpec,
  provider: CloudProvider
): WorkloadCostEstimate {
  const breakdown: Array<{
    category: string;
    item: string;
    quantity: number;
    unitPrice: number;
    monthlyTotal: number;
  }> = [];
  const notes: string[] = [];

  // Compute costs
  if (spec.compute) {
    const computeResult = compareCompute({
      vcpus: spec.compute.vcpus,
      memoryGB: spec.compute.memoryGB,
    });

    const instance = computeResult.matches.find(m => m.provider === provider);
    if (instance) {
      const count = spec.compute.count || 1;
      breakdown.push({
        category: 'Compute',
        item: instance.name,
        quantity: count,
        unitPrice: instance.monthlyPrice,
        monthlyTotal: instance.monthlyPrice * count,
      });
    } else {
      notes.push(`No matching compute instance found for ${spec.compute.vcpus} vCPUs / ${spec.compute.memoryGB}GB`);
    }
  }

  // Storage costs
  if (spec.storage) {
    if (spec.storage.objectGB) {
      const storageResult = compareStorage({
        sizeGB: spec.storage.objectGB,
        type: 'object',
        tier: 'hot',
      });
      const option = storageResult.monthlyEstimates.find(s => s.provider === provider);
      if (option) {
        breakdown.push({
          category: 'Storage',
          item: `Object Storage (${option.name})`,
          quantity: spec.storage.objectGB,
          unitPrice: option.monthlyCost / spec.storage.objectGB,
          monthlyTotal: option.monthlyCost,
        });
      }
    }

    if (spec.storage.blockGB) {
      const storageResult = compareStorage({
        sizeGB: spec.storage.blockGB,
        type: 'block',
        tier: 'hot',
      });
      const option = storageResult.monthlyEstimates.find(s => s.provider === provider);
      if (option) {
        breakdown.push({
          category: 'Storage',
          item: `Block Storage (${option.name})`,
          quantity: spec.storage.blockGB,
          unitPrice: option.monthlyCost / spec.storage.blockGB,
          monthlyTotal: option.monthlyCost,
        });
      }
    }
  }

  // Egress costs
  if (spec.egress) {
    const egressResult = compareEgress({ monthlyGB: spec.egress.monthlyGB });
    const estimate = egressResult.estimates.find(e => e.provider === provider);
    if (estimate) {
      breakdown.push({
        category: 'Networking',
        item: `Data Egress (${estimate.breakdown})`,
        quantity: spec.egress.monthlyGB,
        unitPrice: spec.egress.monthlyGB > 0 ? estimate.monthlyCost / spec.egress.monthlyGB : 0,
        monthlyTotal: estimate.monthlyCost,
      });

      // Add note about free egress for OCI
      if (provider === 'oci' && estimate.monthlyCost === 0) {
        notes.push('OCI: 10TB/month free egress included');
      }
    }
  }

  // Kubernetes costs
  if (spec.kubernetes) {
    const k8sResult = compareKubernetes({
      nodeCount: spec.kubernetes.nodeCount,
      nodeVcpus: spec.kubernetes.nodeVcpus,
      nodeMemoryGB: spec.kubernetes.nodeMemoryGB,
    });

    const estimate = k8sResult.estimates.find(e => e.provider === provider);
    if (estimate) {
      // Control plane
      if (estimate.controlPlaneCost > 0) {
        breakdown.push({
          category: 'Kubernetes',
          item: 'Control Plane',
          quantity: 1,
          unitPrice: estimate.controlPlaneCost,
          monthlyTotal: estimate.controlPlaneCost,
        });
      } else {
        notes.push(`${provider.toUpperCase()}: Free Kubernetes control plane`);
      }

      // Worker nodes
      breakdown.push({
        category: 'Kubernetes',
        item: `Worker Nodes (${spec.kubernetes.nodeCount}x)`,
        quantity: spec.kubernetes.nodeCount,
        unitPrice: estimate.workerNodeCost / spec.kubernetes.nodeCount,
        monthlyTotal: estimate.workerNodeCost,
      });
    }
  }

  // Calculate total
  const totalMonthly = breakdown.reduce((sum, item) => sum + item.monthlyTotal, 0);

  return {
    provider,
    breakdown,
    totalMonthly,
    notes,
  };
}

/**
 * Calculate workload cost across all cloud providers
 */
export function calculateWorkloadCost(spec: WorkloadSpec): WorkloadComparisonResult {
  const providers: CloudProvider[] = ['aws', 'azure', 'gcp', 'oci'];

  const estimates = providers.map(provider => calculateProviderCost(spec, provider));

  // Sort by total cost
  estimates.sort((a, b) => a.totalMonthly - b.totalMonthly);

  // Find cheapest
  const cheapest = estimates[0].provider;

  // Calculate savings summary
  const awsEstimate = estimates.find(e => e.provider === 'aws');
  const cheapestEstimate = estimates[0];

  let savingsSummary = `Cheapest option: ${cheapest.toUpperCase()} at $${cheapestEstimate.totalMonthly.toFixed(2)}/month.`;

  if (awsEstimate && cheapest !== 'aws' && awsEstimate.totalMonthly > 0) {
    const savingsAmount = awsEstimate.totalMonthly - cheapestEstimate.totalMonthly;
    const savingsPercent = Math.round((savingsAmount / awsEstimate.totalMonthly) * 100);
    savingsSummary += ` Saves $${savingsAmount.toFixed(2)}/month (${savingsPercent}%) vs AWS.`;
  }

  // Add provider-specific highlights
  const ociEstimate = estimates.find(e => e.provider === 'oci');
  if (ociEstimate) {
    const egressNote = ociEstimate.notes.find(n => n.includes('free egress'));
    const k8sNote = ociEstimate.notes.find(n => n.includes('Free Kubernetes'));
    if (egressNote || k8sNote) {
      savingsSummary += ' OCI advantages: ';
      if (egressNote) savingsSummary += '10TB free egress';
      if (egressNote && k8sNote) savingsSummary += ', ';
      if (k8sNote) savingsSummary += 'free K8s control plane';
      savingsSummary += '.';
    }
  }

  return {
    spec,
    estimates,
    cheapest,
    savingsSummary,
  };
}

/**
 * Quick estimate for common deployment presets
 */
export function quickEstimate(preset: string): WorkloadComparisonResult {
  const presets: Record<string, WorkloadSpec> = {
    'small-web-app': {
      compute: { vcpus: 2, memoryGB: 4, count: 1 },
      storage: { blockGB: 50 },
      egress: { monthlyGB: 100 },
    },
    'medium-api-server': {
      compute: { vcpus: 4, memoryGB: 16, count: 2 },
      storage: { blockGB: 200, objectGB: 100 },
      egress: { monthlyGB: 500 },
    },
    'large-database': {
      compute: { vcpus: 8, memoryGB: 64, count: 1 },
      storage: { blockGB: 1000 },
      egress: { monthlyGB: 200 },
    },
    'ml-training': {
      compute: { vcpus: 8, memoryGB: 32, count: 2 },
      storage: { objectGB: 500 },
      egress: { monthlyGB: 1000 },
    },
    'kubernetes-cluster': {
      kubernetes: { nodeCount: 3, nodeVcpus: 4, nodeMemoryGB: 16 },
      storage: { blockGB: 300 },
      egress: { monthlyGB: 500 },
    },
    'data-lake': {
      compute: { vcpus: 4, memoryGB: 16, count: 2 },
      storage: { objectGB: 5000 },
      egress: { monthlyGB: 2000 },
    },
    'high-egress-cdn': {
      compute: { vcpus: 2, memoryGB: 4, count: 2 },
      storage: { objectGB: 200 },
      egress: { monthlyGB: 10000 },
    },
  };

  const spec = presets[preset];
  if (!spec) {
    throw new Error(
      `Unknown preset: ${preset}. Available presets: ${Object.keys(presets).join(', ')}`
    );
  }

  return calculateWorkloadCost(spec);
}

/**
 * Get available presets
 */
export function getAvailablePresets(): Array<{ name: string; description: string }> {
  return [
    { name: 'small-web-app', description: '2 vCPU, 4GB RAM, 50GB storage, 100GB egress' },
    { name: 'medium-api-server', description: '2x 4 vCPU, 16GB RAM, 200GB block + 100GB object, 500GB egress' },
    { name: 'large-database', description: '8 vCPU, 64GB RAM, 1TB storage, 200GB egress' },
    { name: 'ml-training', description: '2x 8 vCPU, 32GB RAM, 500GB object storage, 1TB egress' },
    { name: 'kubernetes-cluster', description: '3 nodes × 4 vCPU × 16GB, 300GB storage, 500GB egress' },
    { name: 'data-lake', description: '2x 4 vCPU, 16GB RAM, 5TB object storage, 2TB egress' },
    { name: 'high-egress-cdn', description: '2x 2 vCPU, 4GB RAM, 200GB object, 10TB egress (shows OCI advantage)' },
  ];
}

/**
 * Estimate migration savings from one cloud to another
 */
export function estimateMigrationSavings(options: {
  spec: WorkloadSpec;
  currentProvider: CloudProvider;
  targetProvider?: CloudProvider;
}): {
  currentCost: number;
  targetCost: number;
  monthlySavings: number;
  annualSavings: number;
  percentSavings: number;
  recommendation: string;
} {
  const result = calculateWorkloadCost(options.spec);

  const currentEstimate = result.estimates.find(e => e.provider === options.currentProvider);
  if (!currentEstimate) {
    throw new Error(`Could not calculate cost for ${options.currentProvider}`);
  }

  // Use specified target or find cheapest
  const targetProvider = options.targetProvider || result.cheapest;
  const targetEstimate = result.estimates.find(e => e.provider === targetProvider);
  if (!targetEstimate) {
    throw new Error(`Could not calculate cost for ${targetProvider}`);
  }

  const monthlySavings = currentEstimate.totalMonthly - targetEstimate.totalMonthly;
  const annualSavings = monthlySavings * 12;
  const percentSavings = currentEstimate.totalMonthly > 0
    ? Math.round((monthlySavings / currentEstimate.totalMonthly) * 100)
    : 0;

  let recommendation: string;
  if (monthlySavings > 0) {
    recommendation = `Migrating from ${options.currentProvider.toUpperCase()} to ${targetProvider.toUpperCase()} could save $${annualSavings.toFixed(2)}/year (${percentSavings}%).`;
  } else if (monthlySavings < 0) {
    recommendation = `${options.currentProvider.toUpperCase()} is already ${Math.abs(percentSavings)}% cheaper than ${targetProvider.toUpperCase()} for this workload.`;
  } else {
    recommendation = `Costs are similar between ${options.currentProvider.toUpperCase()} and ${targetProvider.toUpperCase()}.`;
  }

  return {
    currentCost: currentEstimate.totalMonthly,
    targetCost: targetEstimate.totalMonthly,
    monthlySavings,
    annualSavings,
    percentSavings,
    recommendation,
  };
}
