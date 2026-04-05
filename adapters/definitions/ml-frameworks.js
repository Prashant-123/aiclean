/**
 * AI/ML Frameworks & Model Caches
 * Verified cache paths for macOS and Linux.
 */

module.exports = [
  // ── Hugging Face ────────────────────────────────────────────
  {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'ML Frameworks',
    risk: 'high',
    riskReason: 'Model hub can be 5-100+ GB; individual models are 1-15 GB and take hours to download on slow connections',
    processNames: [],
    description: 'Hugging Face model hub, datasets, and transformer caches',
    paths: {
      darwin: [
        { name: 'model hub', path: '~/.cache/huggingface/hub' },
        { name: 'datasets', path: '~/.cache/huggingface/datasets' },
        { name: 'modules', path: '~/.cache/huggingface/modules' },
        { name: 'accelerate', path: '~/.cache/huggingface/accelerate' },
        { name: 'transformers (legacy)', path: '~/.cache/huggingface/transformers' },
      ],
      linux: [
        { name: 'model hub', path: '~/.cache/huggingface/hub' },
        { name: 'datasets', path: '~/.cache/huggingface/datasets' },
        { name: 'modules', path: '~/.cache/huggingface/modules' },
        { name: 'accelerate', path: '~/.cache/huggingface/accelerate' },
        { name: 'transformers (legacy)', path: '~/.cache/huggingface/transformers' },
      ],
    },
  },

  // ── PyTorch ─────────────────────────────────────────────────
  {
    id: 'pytorch',
    name: 'PyTorch',
    category: 'ML Frameworks',
    risk: 'high',
    riskReason: 'Pre-trained models can be 500 MB - 5 GB each; re-downloading depends on network speed',
    processNames: ['python', 'python3'],
    description: 'PyTorch model hub, checkpoints, and kernel caches',
    paths: {
      darwin: [
        { name: 'hub models', path: '~/.cache/torch/hub' },
        { name: 'compiled kernels', path: '~/.cache/torch/kernels' },
      ],
      linux: [
        { name: 'hub models', path: '~/.cache/torch/hub' },
        { name: 'compiled kernels', path: '~/.cache/torch/kernels' },
      ],
    },
  },

  // ── TensorFlow / Keras ──────────────────────────────────────
  {
    id: 'tensorflow',
    name: 'TensorFlow / Keras',
    category: 'ML Frameworks',
    risk: 'high',
    riskReason: 'Pre-trained models and datasets can be several GB; re-downloading is slow',
    processNames: ['python', 'python3'],
    description: 'TensorFlow and Keras model and dataset caches',
    paths: {
      darwin: [
        { name: 'Keras models', path: '~/.keras/models' },
        { name: 'Keras datasets', path: '~/.keras/datasets' },
        { name: 'TF cache', path: '~/.cache/tensorflow' },
        { name: 'TF Hub modules', path: '/tmp/tfhub_modules' },
      ],
      linux: [
        { name: 'Keras models', path: '~/.keras/models' },
        { name: 'Keras datasets', path: '~/.keras/datasets' },
        { name: 'TF cache', path: '~/.cache/tensorflow' },
        { name: 'TF Hub modules', path: '/tmp/tfhub_modules' },
      ],
    },
  },

  // ── Ollama ──────────────────────────────────────────────────
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'ML Frameworks',
    risk: 'high',
    riskReason: 'LLM models are 2-50 GB each and take 10-60+ min to re-download',
    processNames: ['ollama'],
    description: 'Ollama downloaded LLM models and logs',
    paths: {
      darwin: [
        { name: 'models', path: '~/.ollama/models' },
        { name: 'logs', path: '~/.ollama/logs' },
      ],
      linux: [
        { name: 'models', path: '~/.ollama/models' },
        { name: 'logs', path: '~/.ollama/logs' },
      ],
    },
  },

  // ── LM Studio ──────────────────────────────────────────────
  {
    id: 'lm-studio',
    name: 'LM Studio',
    category: 'ML Frameworks',
    risk: 'high',
    riskReason: 'Downloaded GGUF models are 2-30 GB each and very slow to re-download',
    processNames: ['lms', 'LM Studio'],
    description: 'LM Studio downloaded models and runtime cache',
    paths: {
      darwin: [
        { name: 'runtime cache', path: '~/.cache/lm-studio' },
        { name: 'models', path: '~/.lmstudio/models' },
      ],
      linux: [
        { name: 'runtime cache', path: '~/.cache/lm-studio' },
        { name: 'models', path: '~/.lmstudio/models' },
      ],
    },
  },
];
