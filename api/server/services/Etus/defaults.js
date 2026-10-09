const { logger } = require('@librechat/data-schemas');
const { getCachedHubValues } = require('./access');
const { isHubEnabled } = require('./hubClient');

const HUB_SPEC_NAME = 'etus-hub-default';
const SPEC_PREFIX = 'spec:';
const MODEL_SEPARATOR = '::';

function parseModelOption(option) {
  if (typeof option !== 'string' || !option) {
    return null;
  }
  if (option.startsWith(SPEC_PREFIX)) {
    const name = option.slice(SPEC_PREFIX.length);
    return name ? { spec: name } : null;
  }
  const separator = option.indexOf(MODEL_SEPARATOR);
  if (separator <= 0) {
    return null;
  }
  const endpoint = option.slice(0, separator);
  const model = option.slice(separator + MODEL_SEPARATOR.length);
  return model ? { endpoint, model } : null;
}

function baseSpecFor(list, values) {
  if (values.model === undefined) {
    return list.find((spec) => spec.default === true) ?? null;
  }
  const parsed = parseModelOption(values.model);
  if (!parsed) {
    return null;
  }
  if (parsed.spec) {
    return list.find((spec) => spec.name === parsed.spec) ?? null;
  }
  return {
    name: HUB_SPEC_NAME,
    label: parsed.model,
    preset: { endpoint: parsed.endpoint, model: parsed.model },
  };
}

function buildDefaultSpec(list, values) {
  const base = baseSpecFor(list, values);
  if (!base) {
    return null;
  }
  const preset = { ...base.preset };
  if (typeof values.temperature === 'number') {
    preset.temperature = values.temperature;
  }
  if (typeof values.systemPrompt === 'string' && values.systemPrompt.trim()) {
    preset.promptPrefix = values.systemPrompt;
  }
  return { ...base, preset, default: true };
}

function applyModelDefaults(appConfig, values) {
  const touchesModel =
    values.model !== undefined ||
    values.temperature !== undefined ||
    values.systemPrompt !== undefined;
  if (!touchesModel) {
    return appConfig;
  }
  const modelSpecs = appConfig.modelSpecs;
  const list = Array.isArray(modelSpecs?.list) ? modelSpecs.list : [];
  const spec = buildDefaultSpec(list, values);
  if (!spec) {
    return appConfig;
  }
  const others = list
    .filter((item) => item.name !== spec.name)
    .map((item) => (item.default ? { ...item, default: false } : item));
  const position = list.findIndex((item) => item.name === spec.name);
  const nextList = [...others];
  nextList.splice(position < 0 ? 0 : position, 0, spec);
  return {
    ...appConfig,
    modelSpecs: modelSpecs
      ? { ...modelSpecs, list: nextList }
      : { enforce: false, prioritize: true, list: nextList },
  };
}

function applyMcpFilter(appConfig, baseConfig, values) {
  if (!Array.isArray(values.mcpServers) || !appConfig.mcpConfig) {
    return appConfig;
  }
  const allowed = new Set(values.mcpServers);
  const yamlServers = new Set(Object.keys(baseConfig?.mcpConfig ?? {}));
  const entries = Object.entries(appConfig.mcpConfig);
  const kept = entries.filter(([name]) => allowed.has(name) || yamlServers.has(name));
  if (kept.length === entries.length) {
    return appConfig;
  }
  return { ...appConfig, mcpConfig: Object.fromEntries(kept) };
}

function applyHubValues(appConfig, baseConfig, values) {
  if (!appConfig || !values || typeof values !== 'object') {
    return appConfig;
  }
  return applyMcpFilter(applyModelDefaults(appConfig, values), baseConfig, values);
}

async function applyHubDefaults({ appConfig, baseConfig, userId }) {
  try {
    if (!userId || !isHubEnabled()) {
      return appConfig;
    }
    const values = await getCachedHubValues(userId);
    return values ? applyHubValues(appConfig, baseConfig, values) : appConfig;
  } catch (error) {
    logger.warn(`[EtusHub] Could not apply hub defaults: ${error?.message ?? error}`);
    return appConfig;
  }
}

module.exports = {
  HUB_SPEC_NAME,
  parseModelOption,
  applyHubValues,
  applyHubDefaults,
};
