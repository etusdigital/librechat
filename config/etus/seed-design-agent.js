const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { z } = require('zod');
const { agentCreateSchema } = require('@librechat/api');
const {
  Constants,
  AccessRoleIds,
  PrincipalType,
  ResourceType,
} = require('librechat-data-provider');
const {
  SeedError,
  parseCliArgs,
  readJsonFile,
  formatZodError,
  findAuthor,
  runCli,
} = require('./script-utils');

const SKILL_SOURCE_PROVIDER = 'github';
const SKILL_SOURCE_ID = 'etus-design';
const AGENT_PROVIDER = 'ETUS AI';
const RECOMMENDED_MODEL = 'cc/claude-sonnet-5';
const NATIVE_TOOLS = [
  'execute_code',
  'web_search',
  'file_search',
  'image_gen_oai',
  'ask_user_question',
];
const DESIGN_MCP_SERVER = 'etus';
const DESIGN_TOOL_PATTERN = /^design__[a-z][a-z0-9_]{1,47}_mcp_etus$/;
const DESIGN_TOOL_SUFFIX = `${Constants.mcp_delimiter}${DESIGN_MCP_SERVER}`;
const MAX_TOOL_NAME_LENGTH = 64;
const ACTION_DELIMITER = '_action_';
const MAX_SKILLS = 60;
const MAX_INSTRUCTIONS_CHARS = 60000;

const SEEDED_FIELDS = [
  'name',
  'description',
  'instructions',
  'provider',
  'model',
  'model_parameters',
  'artifacts',
  'tools',
  'mcpServerNames',
  'skills',
  'skills_enabled',
  'skills_scope',
  'skill_authoring_enabled',
  'conversation_starters',
  'category',
];

const AGENT_SCHEMA_EXCLUDED_FIELDS = new Set(['mcpServerNames']);

const nonEmpty = z.string().trim().min(1);

function isDesignTool(name) {
  return (
    DESIGN_TOOL_PATTERN.test(name) &&
    name.length <= MAX_TOOL_NAME_LENGTH &&
    name.indexOf(Constants.mcp_delimiter) === name.length - DESIGN_TOOL_SUFFIX.length &&
    !name.includes(ACTION_DELIMITER)
  );
}

function isManagedTool(name) {
  return NATIVE_TOOLS.includes(name) || isDesignTool(name);
}

function isDesignServerTool(name) {
  return name.endsWith(DESIGN_TOOL_SUFFIX);
}

const toolName = z.string().refine(isManagedTool, {
  message: `must be one of ${NATIVE_TOOLS.join(', ')} or design__<name>_mcp_${DESIGN_MCP_SERVER}`,
});

const AgentDefinitionSchema = z
  .object({
    key: nonEmpty,
    id: z.string().regex(/^agent_[a-z0-9_]+$/, 'must look like agent_<lowercase_snake_case>'),
    name: nonEmpty,
    description: nonEmpty,
    instructions: nonEmpty.max(MAX_INSTRUCTIONS_CHARS),
    provider: z.literal(AGENT_PROVIDER, {
      errorMap: () => ({
        message: `must be "${AGENT_PROVIDER}", the name of the custom endpoint in librechat.yaml`,
      }),
    }),
    model: nonEmpty,
    model_parameters: z.record(z.unknown()).optional(),
    artifacts: z.enum(['default', 'shadcnui', 'custom']).default('default'),
    tools: z
      .array(toolName)
      .refine((names) => new Set(names).size === names.length, 'must not repeat a tool')
      .default([]),
    skillNames: z
      .array(nonEmpty)
      .max(MAX_SKILLS)
      .refine((names) => new Set(names).size === names.length, 'must not repeat a skill'),
    skills_enabled: z.literal(true).default(true),
    skills_scope: z.literal('selected').default('selected'),
    skill_authoring_enabled: z.literal(false).default(false),
    conversation_starters: z.array(nonEmpty).default([]),
    category: nonEmpty.default('general'),
    sourceCommit: z.string().optional(),
  })
  .strict();

function parseAgentDefinition(data) {
  const parsed = AgentDefinitionSchema.safeParse(data);
  if (!parsed.success) {
    throw formatZodError('Agent definition', parsed.error);
  }
  return parsed.data;
}

async function resolveSkillIds(skillNames, { allowMissing = false } = {}) {
  const { Skill } = require('~/db/models');
  const found = await Skill.find(
    {
      source: SKILL_SOURCE_PROVIDER,
      'sourceMetadata.sourceId': SKILL_SOURCE_ID,
      name: { $in: skillNames },
    },
    { _id: 1, name: 1 },
  ).lean();

  const idsByName = new Map();
  for (const skill of found) {
    const ids = idsByName.get(skill.name) ?? [];
    ids.push(skill._id.toString());
    idsByName.set(skill.name, ids);
  }

  const ambiguous = [...idsByName].filter(([, ids]) => ids.length > 1).map(([name]) => name);
  if (ambiguous.length > 0) {
    throw new SeedError(
      `More than one synced skill named ${ambiguous.join(', ')} in source "${SKILL_SOURCE_ID}"`,
    );
  }

  const missing = skillNames.filter((name) => !idsByName.has(name));
  if (missing.length > 0 && !allowMissing) {
    throw new SeedError(
      `Skills not synced from source "${SKILL_SOURCE_ID}": ${missing.join(', ')}. ` +
        'Run the skill sync first or pass --allow-missing.',
    );
  }

  const ids = skillNames
    .filter((name) => idsByName.has(name))
    .map((name) => idsByName.get(name)[0]);
  return { ids, missing };
}

function mergeTools(existing, definitionTools, { pruneTools = false } = {}) {
  const wanted = new Set(definitionTools);
  const current = existing?.tools ?? [];
  const kept = pruneTools
    ? current.filter((tool) => !isManagedTool(tool) || wanted.has(tool))
    : [...current];
  const keptSet = new Set(kept);
  const tools = [...kept, ...definitionTools.filter((tool) => !keptSet.has(tool))];
  const pruned = current.filter((tool) => !tools.includes(tool));
  const unlisted = tools.filter((tool) => !wanted.has(tool));

  const serverNames = new Set(existing?.mcpServerNames ?? []);
  if (tools.some(isDesignTool)) {
    serverNames.add(DESIGN_MCP_SERVER);
  } else if (pruneTools && !tools.some(isDesignServerTool)) {
    serverNames.delete(DESIGN_MCP_SERVER);
  }
  return { tools, mcpServerNames: [...serverNames], pruned, unlisted };
}

function buildAgentPayload(definition, skillIds, merged = mergeTools(null, definition.tools)) {
  const payload = {
    name: definition.name,
    description: definition.description,
    instructions: definition.instructions,
    provider: definition.provider,
    model: definition.model,
    model_parameters: definition.model_parameters ?? {},
    artifacts: definition.artifacts,
    tools: merged.tools,
    mcpServerNames: merged.mcpServerNames,
    skills: skillIds,
    skills_enabled: definition.skills_enabled,
    skills_scope: definition.skills_scope,
    skill_authoring_enabled: definition.skill_authoring_enabled,
    conversation_starters: definition.conversation_starters,
    category: definition.category,
  };

  const validated = agentCreateSchema.safeParse(payload);
  if (!validated.success) {
    throw formatZodError('Agent payload', validated.error);
  }
  const dropped = SEEDED_FIELDS.filter(
    (field) => !AGENT_SCHEMA_EXCLUDED_FIELDS.has(field) && !(field in validated.data),
  );
  if (dropped.length > 0) {
    throw new SeedError(`LibreChat agent schema does not accept: ${dropped.join(', ')}`);
  }
  return payload;
}

function comparable(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.parse(JSON.stringify(value));
}

function summarize(value) {
  if (typeof value === 'string' && value.length > 120) {
    const hash = crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
    return `<${value.length} chars, sha256 ${hash}>`;
  }
  return value;
}

function diffAgent(existing, payload) {
  return SEEDED_FIELDS.filter(
    (field) => !isDeepStrictEqual(comparable(existing?.[field]), comparable(payload[field])),
  ).map((field) => ({
    field,
    before: summarize(comparable(existing?.[field])),
    after: summarize(comparable(payload[field])),
  }));
}

async function hasOwnerEntry(authorId, agentObjectId) {
  const { AclEntry } = require('~/db/models');
  const entry = await AclEntry.findOne({
    principalType: PrincipalType.USER,
    principalId: authorId,
    resourceType: ResourceType.AGENT,
    resourceId: agentObjectId,
  }).lean();
  return entry != null;
}

async function grantOwner(authorId, agentObjectId) {
  const { grantPermission } = require('~/server/services/PermissionService');
  await grantPermission({
    principalType: PrincipalType.USER,
    principalId: authorId,
    resourceType: ResourceType.AGENT,
    resourceId: agentObjectId,
    accessRoleId: AccessRoleIds.AGENT_OWNER,
    grantedBy: authorId,
  });
}

function assertSameAuthor(existing, author) {
  if (existing.author?.toString() !== author._id.toString()) {
    throw new SeedError(
      `Agent ${existing.id} belongs to another author (${existing.author}); refusing to change it`,
    );
  }
}

async function seedDesignAgent({
  definition: rawDefinition,
  author,
  dryRun = false,
  allowMissing = false,
  pruneTools = false,
}) {
  const { getAgent, createAgent, updateAgent } = require('~/models');
  const definition = parseAgentDefinition(rawDefinition);
  const warnings = [];
  if (definition.model !== RECOMMENDED_MODEL) {
    warnings.push(
      `Model "${definition.model}" differs from the recommended "${RECOMMENDED_MODEL}"`,
    );
  }

  const { ids, missing } = await resolveSkillIds(definition.skillNames, { allowMissing });
  if (missing.length > 0) {
    warnings.push(`Seeding without skills that are not synced: ${missing.join(', ')}`);
  }

  const existing = await getAgent({ id: definition.id });
  if (existing) {
    assertSameAuthor(existing, author);
  }
  const merged = mergeTools(existing, definition.tools, { pruneTools });
  if (merged.unlisted.length > 0) {
    warnings.push(
      `Keeping tools that are not in the definition: ${merged.unlisted.join(', ')}` +
        (pruneTools ? '' : ' (pass --prune-tools to remove the ones this seed manages)'),
    );
  }
  const payload = buildAgentPayload(definition, ids, merged);

  const changes = diffAgent(existing, payload);
  let action = 'unchanged';
  if (!existing) {
    action = 'create';
  } else if (changes.length > 0) {
    action = 'update';
  }

  const ownerMissing = existing ? !(await hasOwnerEntry(author._id, existing._id)) : true;
  const result = {
    action,
    agentId: definition.id,
    changes,
    skillIds: ids,
    missingSkills: missing,
    prunedTools: merged.pruned,
    ownerGranted: false,
    dryRun,
    warnings,
  };
  if (dryRun) {
    result.ownerGranted = ownerMissing;
    return result;
  }

  let agent = existing;
  if (action === 'create') {
    agent = await createAgent({ ...payload, id: definition.id, author: author._id });
  } else if (action === 'update') {
    agent = await updateAgent(
      { id: definition.id },
      { ...payload },
      {
        updatingUserId: author._id.toString(),
      },
    );
  }

  if (ownerMissing) {
    await grantOwner(author._id, agent._id);
    result.ownerGranted = true;
  }
  return result;
}

async function removeDesignAgent({ agentId, author, dryRun = false }) {
  const { getAgent, deleteAgent } = require('~/models');
  const existing = await getAgent({ id: agentId });
  if (!existing) {
    return { action: 'absent', agentId, dryRun };
  }
  if (author) {
    assertSameAuthor(existing, author);
  }
  if (!dryRun) {
    await deleteAgent({ id: agentId });
  }
  return { action: 'remove', agentId, dryRun };
}

const CLI_OPTIONS = {
  file: { type: 'string' },
  'author-email': { type: 'string' },
  'agent-id': { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  'allow-missing': { type: 'boolean', default: false },
  'prune-tools': { type: 'boolean', default: false },
  remove: { type: 'boolean', default: false },
};

function printResult(result) {
  const prefix = result.dryRun ? '[dry-run] ' : '';
  console.log(`${prefix}${result.action}: ${result.agentId}`);
  for (const change of result.changes ?? []) {
    console.log(
      `  ${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`,
    );
  }
  if (result.prunedTools?.length > 0) {
    console.log(`  ${prefix}pruned tools: ${result.prunedTools.join(', ')}`);
  }
  if (result.ownerGranted) {
    console.log(`  ${prefix}owner permission granted`);
  }
  for (const warning of result.warnings ?? []) {
    console.warn(`  warning: ${warning}`);
  }
}

async function main(argv) {
  const args = parseCliArgs(argv, CLI_OPTIONS);
  if (args.remove) {
    const agentId =
      args['agent-id'] ?? (args.file ? parseAgentDefinition(readJsonFile(args.file)).id : null);
    if (!agentId) {
      throw new SeedError('--remove needs --file or --agent-id');
    }
    const author = args['author-email'] ? await findAuthor(args['author-email']) : null;
    printResult(await removeDesignAgent({ agentId, author, dryRun: args['dry-run'] }));
    return;
  }
  const definition = readJsonFile(args.file);
  const author = await findAuthor(args['author-email']);
  printResult(
    await seedDesignAgent({
      definition,
      author,
      dryRun: args['dry-run'],
      allowMissing: args['allow-missing'],
      pruneTools: args['prune-tools'],
    }),
  );
}

if (require.main === module) {
  runCli(main);
}

module.exports = {
  SKILL_SOURCE_ID,
  AGENT_PROVIDER,
  NATIVE_TOOLS,
  SEEDED_FIELDS,
  DESIGN_MCP_SERVER,
  isDesignTool,
  isManagedTool,
  mergeTools,
  parseAgentDefinition,
  resolveSkillIds,
  buildAgentPayload,
  diffAgent,
  seedDesignAgent,
  removeDesignAgent,
  main,
};
