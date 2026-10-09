const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const {
  EModelEndpoint,
  PermissionBits,
  ResourceType,
  SystemRoles,
} = require('librechat-data-provider');
const { pushSettingsCatalog } = require('./hubClient');
const db = require('~/models');

const MAX_OPTIONS = 2000;
const MAX_OPTION_TEXT = 200;
const SYSTEM_PROMPT_MAX_LENGTH = 8000;
const NON_CHAT_ENDPOINTS = new Set([
  EModelEndpoint.assistants,
  EModelEndpoint.azureAssistants,
  EModelEndpoint.agents,
]);

const clip = (value) => String(value).slice(0, MAX_OPTION_TEXT);

function toOptions(items) {
  const seen = new Set();
  const options = [];
  for (const item of items) {
    if (!item?.id || !item.label || seen.has(item.id) || String(item.id).length > MAX_OPTION_TEXT) {
      continue;
    }
    seen.add(item.id);
    options.push({ id: String(item.id), label: clip(item.label) });
    if (options.length >= MAX_OPTIONS) {
      break;
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function modelOptions(modelSpecs, models) {
  const specs = (modelSpecs?.list ?? []).map((spec) => ({
    id: `spec:${spec.name}`,
    label: spec.label || spec.name,
  }));
  const plain = [];
  for (const [endpoint, names] of Object.entries(models ?? {})) {
    if (NON_CHAT_ENDPOINTS.has(endpoint) || !Array.isArray(names)) {
      continue;
    }
    for (const name of names) {
      if (typeof name === 'string' && name) {
        plain.push({ id: `${endpoint}::${name}`, label: `${name} (${endpoint})` });
      }
    }
  }
  return [...toOptions(specs), ...toOptions(plain)].slice(0, MAX_OPTIONS);
}

function buildCatalog({ promptGroups = [], agents = [], mcpServers = [], modelSpecs, models }) {
  return {
    fields: [
      {
        key: 'model',
        label: 'Modelo padrão',
        description: 'Modelo com que uma conversa nova começa.',
        kind: 'single',
        options: modelOptions(modelSpecs, models),
      },
      {
        key: 'temperature',
        label: 'Temperatura',
        description: 'Quanto mais alta, mais criativas e variadas as respostas.',
        kind: 'number',
        min: 0,
        max: 2,
      },
      {
        key: 'systemPrompt',
        label: 'Instruções padrão',
        description: 'Texto enviado ao modelo antes de cada conversa nova.',
        kind: 'text',
        maxLength: SYSTEM_PROMPT_MAX_LENGTH,
      },
      {
        key: 'prompts',
        label: 'Prompts',
        description: 'Prompts compartilhados com quem recebe esta configuração.',
        kind: 'multi',
        options: toOptions(
          promptGroups.map((group) => ({ id: String(group._id), label: group.name })),
        ),
      },
      {
        key: 'agents',
        label: 'Agentes',
        description: 'Agentes compartilhados com quem recebe esta configuração.',
        kind: 'multi',
        options: toOptions(
          agents.map((agent) => ({ id: agent.id, label: agent.name || agent.id })),
        ),
      },
      {
        key: 'mcpServers',
        label: 'Servidores MCP',
        description: 'Ferramentas MCP liberadas para quem recebe esta configuração.',
        kind: 'multi',
        options: toOptions(
          mcpServers.map((server) => ({ id: server.name, label: server.title || server.name })),
        ),
      },
    ],
  };
}

async function catalogResourceFilter(resourceType, adminIds) {
  const publicIds = await db.findPublicResourceIds(resourceType, PermissionBits.VIEW);
  return { $or: [{ author: { $in: adminIds } }, { _id: { $in: publicIds } }] };
}

async function collectCatalog({ appConfig, loadModels }) {
  const { User, PromptGroup, Agent, MCPServer } = mongoose.models;
  const admins = await User.find({ role: SystemRoles.ADMIN }, { _id: 1 }).lean();
  const adminIds = admins.map((admin) => admin._id);

  const [promptGroups, agents, dbServers] = await Promise.all([
    PromptGroup.find(await catalogResourceFilter(ResourceType.PROMPTGROUP, adminIds), {
      name: 1,
    }).lean(),
    Agent.find(await catalogResourceFilter(ResourceType.AGENT, adminIds), {
      id: 1,
      name: 1,
    }).lean(),
    MCPServer
      ? MCPServer.find(await catalogResourceFilter(ResourceType.MCPSERVER, adminIds), {
          serverName: 1,
          'config.title': 1,
        }).lean()
      : [],
  ]);

  let models = {};
  try {
    const requester = admins[0]?._id?.toString() ?? '000000000000000000000000';
    models = await loadModels({
      user: { id: requester, _id: requester, role: SystemRoles.ADMIN },
      config: appConfig,
    });
  } catch (error) {
    logger.warn(`[EtusHub] Could not list models for the catalog: ${error?.message ?? error}`);
  }

  const mcpServers = [
    ...Object.entries(appConfig?.mcpConfig ?? {}).map(([name, config]) => ({
      name,
      title: config?.title,
    })),
    ...dbServers.map((server) => ({ name: server.serverName, title: server.config?.title })),
  ];

  return buildCatalog({
    promptGroups,
    agents,
    mcpServers,
    modelSpecs: appConfig?.modelSpecs,
    models,
  });
}

async function pushCatalog({ appConfig, loadModels }) {
  const catalog = await collectCatalog({ appConfig, loadModels });
  const result = await pushSettingsCatalog(catalog);
  if (result) {
    logger.debug('[EtusHub] Settings catalog pushed');
  }
  return result != null;
}

module.exports = {
  buildCatalog,
  collectCatalog,
  pushCatalog,
};
