const { logger } = require('@librechat/data-schemas');

const CONTROLLED_MCP_KEY = 'etusControlledMcpServers';

function controlledMcpNames(env = process.env) {
  return new Set(
    (env.ETUS_HUB_MCP_SERVERS ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

function warnAboutControlledServers(names, controlled) {
  const found = new Set(controlled.map(([name]) => name));
  for (const name of names) {
    if (!found.has(name)) {
      logger.warn(
        `[EtusHub] ETUS_HUB_MCP_SERVERS lists "${name}", but librechat.yaml has no such MCP server`,
      );
    }
  }
  for (const [name, config] of controlled) {
    if (config?.requiresOAuth !== false) {
      logger.warn(`[EtusHub] Hub-controlled MCP server "${name}" should set requiresOAuth: false`);
    }
  }
}

/**
 * Moves the YAML servers named in ETUS_HUB_MCP_SERVERS out of the shared YAML tier,
 * so they reach a person only when the hub grants them (see `applyMcpFilter`).
 */
function withdrawControlledMcpServers(appConfig, env = process.env) {
  const names = controlledMcpNames(env);
  if (names.size === 0 || !appConfig) {
    return appConfig;
  }
  const entries = Object.entries(appConfig.mcpConfig ?? {});
  const controlled = entries.filter(([name]) => names.has(name));
  warnAboutControlledServers(names, controlled);
  if (controlled.length === 0) {
    return appConfig;
  }
  logger.info(
    `[EtusHub] MCP servers granted only by the hub: ${controlled.map(([name]) => name).join(', ')}`,
  );
  return {
    ...appConfig,
    mcpConfig: Object.fromEntries(entries.filter(([name]) => !names.has(name))),
    [CONTROLLED_MCP_KEY]: Object.fromEntries(controlled),
  };
}

const controlledMcpServers = (config) => config?.[CONTROLLED_MCP_KEY] ?? {};

module.exports = { controlledMcpNames, controlledMcpServers, withdrawControlledMcpServers };
