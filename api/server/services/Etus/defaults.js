const { logger } = require('@librechat/data-schemas');
const { getCachedHubValues } = require('./access');
const { isHubEnabled } = require('./hubClient');
const { getAllowedModels, isModelFilterEnabled } = require('./routerModels');
const { controlledMcpServers } = require('./mcpControl');

const HUB_SPEC_NAME = 'etus-hub-default';
const SPEC_PREFIX = 'spec:';
const MODEL_SEPARATOR = '::';
const ROUTER_ENDPOINT = 'ETUS AI';

const failOpenUsers = new Set();

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
  if (!Array.isArray(values.mcpServers)) {
    return appConfig;
  }
  const allowed = new Set(values.mcpServers);
  const yamlServers = new Set(Object.keys(baseConfig?.mcpConfig ?? {}));
  const entries = Object.entries(appConfig.mcpConfig ?? {});
  const kept = entries.filter(([name]) => allowed.has(name) || yamlServers.has(name));
  const granted = Object.entries(controlledMcpServers(baseConfig)).filter(([name]) =>
    allowed.has(name),
  );
  if (kept.length === entries.length && granted.length === 0) {
    return appConfig;
  }
  return { ...appConfig, mcpConfig: Object.fromEntries([...kept, ...granted]) };
}

const isRouterSpec = (spec) => spec?.preset?.endpoint === ROUTER_ENDPOINT;
const modelIdOf = (item) => (typeof item === 'string' ? item : item?.name);
const specList = (appConfig) =>
  Array.isArray(appConfig?.modelSpecs?.list) ? appConfig.modelSpecs.list : [];

function routerEndpointModels(appConfig) {
  const custom = appConfig?.endpoints?.custom;
  const endpoint = Array.isArray(custom)
    ? custom.find((item) => item?.name === ROUTER_ENDPOINT)
    : null;
  return Array.isArray(endpoint?.models?.default) ? endpoint.models.default : [];
}

function curatedModels(appConfig) {
  return [
    ...specList(appConfig)
      .filter(isRouterSpec)
      .map((spec) => spec.preset.model),
    ...routerEndpointModels(appConfig).map(modelIdOf),
  ];
}

function filterSpecs(modelSpecs, allowed) {
  const list = Array.isArray(modelSpecs?.list) ? modelSpecs.list : [];
  const kept = list.filter((spec) => !isRouterSpec(spec) || allowed.has(spec.preset.model));
  if (kept.length === list.length) {
    return modelSpecs;
  }
  const lostDefault = list.some((spec) => spec.default) && !kept.some((spec) => spec.default);
  const nextList =
    lostDefault && kept.length > 0 ? [{ ...kept[0], default: true }, ...kept.slice(1)] : kept;
  return { ...modelSpecs, list: nextList };
}

function filterEndpoints(endpoints, allowed) {
  const custom = endpoints?.custom;
  if (!Array.isArray(custom)) {
    return endpoints;
  }
  let changed = false;
  const nextCustom = custom.map((endpoint) => {
    const models = endpoint?.models?.default;
    if (endpoint?.name !== ROUTER_ENDPOINT || !Array.isArray(models)) {
      return endpoint;
    }
    const kept = models.filter((item) => allowed.has(modelIdOf(item)));
    if (kept.length === models.length || kept.length === 0) {
      return endpoint;
    }
    changed = true;
    return { ...endpoint, models: { ...endpoint.models, default: kept } };
  });
  return changed ? { ...endpoints, custom: nextCustom } : endpoints;
}

function filterRouterModels(appConfig, allowed) {
  const modelSpecs = filterSpecs(appConfig.modelSpecs, allowed);
  const endpoints = filterEndpoints(appConfig.endpoints, allowed);
  if (modelSpecs === appConfig.modelSpecs && endpoints === appConfig.endpoints) {
    return appConfig;
  }
  return { ...appConfig, modelSpecs, endpoints };
}

function isFilteredOut(option, original, filtered, allowed) {
  const parsed = parseModelOption(option);
  if (!parsed) {
    return false;
  }
  if (parsed.spec) {
    const has = (config) => specList(config).some((spec) => spec.name === parsed.spec);
    return has(original) && !has(filtered);
  }
  return parsed.endpoint === ROUTER_ENDPOINT && !allowed.has(parsed.model);
}

function withAvailableModel(values, original, filtered, allowed) {
  if (!isFilteredOut(values.model, original, filtered, allowed)) {
    return values;
  }
  const list = specList(filtered);
  const fallback = list.find((spec) => spec.default) ?? list[0];
  const { model: _model, ...rest } = values;
  return fallback ? { ...rest, model: `${SPEC_PREFIX}${fallback.name}` } : rest;
}

function applyHubValues(appConfig, baseConfig, values, allowed = null) {
  if (!appConfig) {
    return appConfig;
  }
  const filtered = allowed ? filterRouterModels(appConfig, allowed) : appConfig;
  if (!values || typeof values !== 'object') {
    return filtered;
  }
  const resolved = allowed ? withAvailableModel(values, appConfig, filtered, allowed) : values;
  return applyMcpFilter(applyModelDefaults(filtered, resolved), baseConfig, resolved);
}

async function usableModelsFor(appConfig, userId) {
  if (!isModelFilterEnabled()) {
    return null;
  }
  const curated = curatedModels(appConfig);
  if (curated.length === 0) {
    return null;
  }
  const allowed = await getAllowedModels(userId);
  if (allowed && curated.some((model) => allowed.has(model))) {
    failOpenUsers.delete(userId);
    return allowed;
  }
  if (!failOpenUsers.has(userId)) {
    failOpenUsers.add(userId);
    logger.warn(
      `[EtusRouter] Model list for user ${userId} is ${allowed ? 'without curated models' : 'unknown'}; showing every curated model`,
    );
  }
  return null;
}

async function applyHubDefaults({ appConfig, baseConfig, userId }) {
  try {
    if (!userId || !appConfig) {
      return appConfig;
    }
    const [values, allowed] = await Promise.all([
      isHubEnabled() ? getCachedHubValues(userId) : null,
      usableModelsFor(appConfig, userId),
    ]);
    return applyHubValues(appConfig, baseConfig, values, allowed);
  } catch (error) {
    logger.warn(`[EtusHub] Could not apply hub defaults: ${error?.message ?? error}`);
    return appConfig;
  }
}

module.exports = {
  HUB_SPEC_NAME,
  ROUTER_ENDPOINT,
  parseModelOption,
  applyHubValues,
  applyHubDefaults,
};
