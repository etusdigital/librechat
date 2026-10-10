const CONTROLLED_MCP_KEY = 'etusControlledMcpServers';

function controlledMcpNames() {
  return new Set(
    (process.env.ETUS_HUB_MCP_SERVERS ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

/** Moves hub-controlled YAML servers out of the shared tier so only the hub can grant them. */
function withdrawControlledMcpServers(appConfig) {
  const names = controlledMcpNames();
  const mcpConfig = appConfig?.mcpConfig;
  if (names.size === 0 || !mcpConfig) {
    return appConfig;
  }
  const entries = Object.entries(mcpConfig);
  const controlled = entries.filter(([name]) => names.has(name));
  if (controlled.length === 0) {
    return appConfig;
  }
  return {
    ...appConfig,
    mcpConfig: Object.fromEntries(entries.filter(([name]) => !names.has(name))),
    [CONTROLLED_MCP_KEY]: Object.fromEntries(controlled),
  };
}

const controlledMcpServers = (config) => config?.[CONTROLLED_MCP_KEY] ?? {};

module.exports = { controlledMcpServers, withdrawControlledMcpServers };
