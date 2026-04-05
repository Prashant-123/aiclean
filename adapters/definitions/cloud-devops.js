/**
 * Cloud & DevOps Tools
 * Verified cache paths for macOS and Linux.
 */

module.exports = [
  // ── AWS CLI ─────────────────────────────────────────────────
  {
    id: 'aws',
    name: 'AWS CLI',
    category: 'Cloud & DevOps',
    risk: 'low',
    riskReason: 'API response cache — refreshed on next CLI call',
    processNames: ['aws'],
    description: 'AWS CLI API response caches',
    paths: {
      darwin: [
        { name: 'CLI cache', path: '~/.aws/cli/cache' },
      ],
      linux: [
        { name: 'CLI cache', path: '~/.aws/cli/cache' },
      ],
    },
  },

  // ── Google Cloud SDK ────────────────────────────────────────
  {
    id: 'gcloud',
    name: 'Google Cloud CLI',
    category: 'Cloud & DevOps',
    risk: 'low',
    riskReason: 'Command logs only — no impact on functionality',
    processNames: ['gcloud'],
    description: 'Google Cloud SDK command logs',
    paths: {
      darwin: [
        { name: 'logs', path: '~/.config/gcloud/logs' },
      ],
      linux: [
        { name: 'logs', path: '~/.config/gcloud/logs' },
      ],
    },
  },

  // ── Kubernetes ──────────────────────────────────────────────
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    category: 'Cloud & DevOps',
    risk: 'low',
    riskReason: 'API discovery cache — kubectl refreshes automatically',
    processNames: ['kubectl'],
    description: 'kubectl API discovery and HTTP caches',
    paths: {
      darwin: [
        { name: 'discovery cache', path: '~/.kube/cache/discovery' },
        { name: 'HTTP cache', path: '~/.kube/cache/http' },
      ],
      linux: [
        { name: 'discovery cache', path: '~/.kube/cache/discovery' },
        { name: 'HTTP cache', path: '~/.kube/cache/http' },
      ],
    },
  },

  // ── Helm ────────────────────────────────────────────────────
  {
    id: 'helm',
    name: 'Helm',
    category: 'Cloud & DevOps',
    risk: 'low',
    riskReason: 'Chart index cache — helm re-downloads on next repo update',
    processNames: ['helm'],
    description: 'Helm chart download and repository caches',
    paths: {
      darwin: [
        { name: 'repository cache', path: '~/Library/Caches/helm/repository' },
        { name: 'cache', path: '~/Library/Caches/helm' },
      ],
      linux: [
        { name: 'repository cache', path: '~/.cache/helm/repository' },
        { name: 'cache', path: '~/.cache/helm' },
      ],
    },
  },

  // ── Terraform ───────────────────────────────────────────────
  {
    id: 'terraform',
    name: 'Terraform',
    category: 'Cloud & DevOps',
    risk: 'medium',
    riskReason: 'Provider plugin cache — re-downloaded on terraform init, but can be 500 MB+',
    processNames: ['terraform'],
    description: 'Terraform global plugin cache',
    paths: {
      darwin: [
        { name: 'plugin cache', path: '~/.terraform.d/plugin-cache' },
      ],
      linux: [
        { name: 'plugin cache', path: '~/.terraform.d/plugin-cache' },
      ],
    },
  },

  // ── Vagrant ─────────────────────────────────────────────────
  {
    id: 'vagrant',
    name: 'Vagrant',
    category: 'Cloud & DevOps',
    risk: 'high',
    riskReason: 'VM box images are 1-5 GB each and take 10-30 min to download; may contain custom base images',
    processNames: ['vagrant', 'VBoxHeadless'],
    description: 'Vagrant downloaded VM boxes and temp files',
    paths: {
      darwin: [
        { name: 'temp', path: '~/.vagrant.d/tmp' },
        { name: 'boxes', path: '~/.vagrant.d/boxes' },
      ],
      linux: [
        { name: 'temp', path: '~/.vagrant.d/tmp' },
        { name: 'boxes', path: '~/.vagrant.d/boxes' },
      ],
    },
  },
];
