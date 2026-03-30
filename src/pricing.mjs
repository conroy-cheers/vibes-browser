const RATE_CARDS = [
  {
    prefixes: ['gpt-5.4-mini'],
    label: 'GPT-5.4 mini',
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
  {
    prefixes: ['gpt-5.4-nano'],
    label: 'GPT-5.4 nano',
    inputUsdPerMillion: 0.2,
    cachedInputUsdPerMillion: 0.02,
    outputUsdPerMillion: 1.25,
  },
  {
    prefixes: ['gpt-5.4'],
    label: 'GPT-5.4',
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 0.25,
    outputUsdPerMillion: 15,
  },
  {
    prefixes: ['gpt-5-mini'],
    label: 'GPT-5 mini',
    inputUsdPerMillion: 0.25,
    cachedInputUsdPerMillion: 0.025,
    outputUsdPerMillion: 2,
  },
  {
    prefixes: ['gpt-4.1-nano'],
    label: 'GPT-4.1 nano',
    inputUsdPerMillion: 0.1,
    cachedInputUsdPerMillion: 0.025,
    outputUsdPerMillion: 0.4,
  },
  {
    prefixes: ['gpt-5'],
    label: 'GPT-5',
    inputUsdPerMillion: 1.25,
    cachedInputUsdPerMillion: 0.125,
    outputUsdPerMillion: 10,
  },
];

export function resolveRateCard(model) {
  const normalized = String(model ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  return (
    RATE_CARDS.find((card) =>
      card.prefixes.some((prefix) => normalized.startsWith(prefix)),
    ) ?? null
  );
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = normalizeInteger(usage.input_tokens);
  const outputTokens = normalizeInteger(usage.output_tokens);
  const totalTokens = normalizeInteger(usage.total_tokens);
  const cachedTokens = normalizeInteger(
    usage.input_tokens_details?.cached_tokens,
  );
  const reasoningTokens = normalizeInteger(
    usage.output_tokens_details?.reasoning_tokens,
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens,
  };
}

export function estimateUsageCost(model, usage) {
  const normalizedUsage = normalizeUsage(usage);
  if (!normalizedUsage) {
    return null;
  }

  const rateCard = resolveRateCard(model);
  if (!rateCard) {
    return {
      model: String(model ?? ''),
      rateCard: null,
      usage: normalizedUsage,
      estimatedCostUsd: null,
    };
  }

  const uncachedInputTokens = Math.max(
    0,
    normalizedUsage.inputTokens - normalizedUsage.cachedTokens,
  );
  const estimatedCostUsd =
    (uncachedInputTokens * rateCard.inputUsdPerMillion +
      normalizedUsage.cachedTokens * rateCard.cachedInputUsdPerMillion +
      normalizedUsage.outputTokens * rateCard.outputUsdPerMillion) /
    1_000_000;

  return {
    model: String(model ?? ''),
    rateCard,
    usage: normalizedUsage,
    estimatedCostUsd,
  };
}

export function mergeUsageEstimates(estimates) {
  const validEstimates = estimates.filter(Boolean);
  const models = [
    ...new Set(validEstimates.map((entry) => entry.model).filter(Boolean)),
  ];
  const usage = validEstimates.reduce(
    (totals, entry) => {
      totals.inputTokens += entry.usage?.inputTokens ?? 0;
      totals.outputTokens += entry.usage?.outputTokens ?? 0;
      totals.totalTokens += entry.usage?.totalTokens ?? 0;
      totals.cachedTokens += entry.usage?.cachedTokens ?? 0;
      totals.reasoningTokens += entry.usage?.reasoningTokens ?? 0;
      return totals;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
  );
  const estimatedCostUsd = validEstimates.every(
    (entry) => typeof entry.estimatedCostUsd === 'number',
  )
    ? validEstimates.reduce((total, entry) => total + entry.estimatedCostUsd, 0)
    : null;

  return {
    models,
    usage,
    estimatedCostUsd,
  };
}

export function formatUsageBadge(estimate) {
  if (!estimate?.usage) {
    return '';
  }

  const modelLabel = estimate.rateCard?.label ?? estimate.model ?? '';
  const parts = [];
  if (modelLabel) {
    parts.push(modelLabel);
  }
  if (estimate.usage.totalTokens > 0) {
    parts.push(`${formatTokenCount(estimate.usage.totalTokens)} tok`);
  }
  if (typeof estimate.estimatedCostUsd === 'number') {
    parts.push(formatUsd(estimate.estimatedCostUsd));
  }
  return parts.join(' · ');
}

export function formatTokenCount(value) {
  const number = normalizeInteger(value);
  if (number >= 1_000_000) {
    return `${stripTrailingZeros((number / 1_000_000).toFixed(2))}M`;
  }
  if (number >= 1_000) {
    return `${stripTrailingZeros((number / 1_000).toFixed(1))}k`;
  }
  return String(number);
}

export function formatUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  if (value === 0) {
    return '$0.00';
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  if (value < 1) {
    return `$${value.toFixed(3)}`;
  }
  return `$${value.toFixed(2)}`;
}

function normalizeInteger(value) {
  return Number.isInteger(value) ? value : 0;
}

function stripTrailingZeros(value) {
  return value.replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1');
}
