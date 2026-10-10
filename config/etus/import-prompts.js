const { z } = require('zod');
const { AccessRoleIds, PrincipalType, ResourceType } = require('librechat-data-provider');
const {
  SeedError,
  parseCliArgs,
  readJsonFile,
  formatZodError,
  findAuthor,
  authorDisplayName,
  runCli,
} = require('./script-utils');

const CATEGORY_PREFIX = 'etus-design-';
const CATEGORY_PATTERN = /^etus-design-[a-z0-9][a-z0-9-]*$/;
const ATTRIBUTION_LICENSES = new Set(['CC-BY-4.0']);

const nonEmpty = z.string().trim().min(1);

const PromptItemSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    surface: z.enum(['image', 'video']),
    name: nonEmpty,
    oneliner: z.string().default(''),
    category: z.string().regex(CATEGORY_PATTERN, `must start with "${CATEGORY_PREFIX}"`),
    suggestedModel: nonEmpty.optional(),
    aspect: nonEmpty.optional(),
    prompt: nonEmpty,
    license: nonEmpty,
    attribution: z
      .object({ author: nonEmpty, url: nonEmpty, repo: nonEmpty.optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (!ATTRIBUTION_LICENSES.has(item.license)) {
      return;
    }
    const { attribution } = item;
    const footer = item.prompt.split('\n---\n').pop() ?? '';
    const credited =
      attribution != null &&
      item.prompt.includes('\n---\n') &&
      footer.includes(attribution.author) &&
      footer.includes(attribution.url) &&
      footer.includes(item.license);
    if (!credited) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prompt'],
        message: `${item.license} prompts must end with a footer crediting author, link and license`,
      });
    }
  });

const PromptsFileSchema = z
  .object({
    version: z.literal(1),
    upstreamCommit: z.string().optional(),
    items: z.array(PromptItemSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = { key: new Set(), name: new Set() };
    file.items.forEach((item, index) => {
      for (const field of ['key', 'name']) {
        if (seen[field].has(item[field])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items', index, field],
            message: `duplicated ${field} "${item[field]}"`,
          });
        }
        seen[field].add(item[field]);
      }
    });
  });

function parsePromptsFile(data) {
  const parsed = PromptsFileSchema.safeParse(data);
  if (!parsed.success) {
    throw formatZodError('prompts.json', parsed.error);
  }
  return parsed.data;
}

function isOurCategory(category) {
  return typeof category === 'string' && category.startsWith(CATEGORY_PREFIX);
}

async function planImport(items, author) {
  const { PromptGroup, Prompt } = require('~/db/models');
  const names = items.map((item) => item.name);
  const groups = await PromptGroup.find({ author: author._id, name: { $in: names } }).lean();
  const groupsByName = new Map();
  for (const group of groups) {
    groupsByName.set(group.name, [...(groupsByName.get(group.name) ?? []), group]);
  }

  const productionIds = groups.map((group) => group.productionId).filter(Boolean);
  const productions = await Prompt.find({ _id: { $in: productionIds } }, { prompt: 1 }).lean();
  const promptById = new Map(productions.map((prompt) => [prompt._id.toString(), prompt.prompt]));

  const conflicts = [];
  const plan = items.map((item) => {
    const matches = groupsByName.get(item.name) ?? [];
    if (matches.length === 0) {
      return { item, action: 'create' };
    }
    const group = matches[0];
    if (matches.length > 1 || !isOurCategory(group.category)) {
      conflicts.push(item.name);
      return { item, action: 'conflict', group };
    }
    const currentPrompt = group.productionId ? promptById.get(group.productionId.toString()) : null;
    const promptChanged = currentPrompt !== item.prompt;
    const groupChanges = {};
    if ((group.oneliner ?? '') !== item.oneliner) {
      groupChanges.oneliner = item.oneliner;
    }
    if (group.category !== item.category) {
      groupChanges.category = item.category;
    }
    const changed = promptChanged || Object.keys(groupChanges).length > 0;
    return { item, group, promptChanged, groupChanges, action: changed ? 'update' : 'unchanged' };
  });

  if (conflicts.length > 0) {
    throw new SeedError(
      `The author already has prompt groups with these names outside "${CATEGORY_PREFIX}*" ` +
        `or duplicated: ${conflicts.join(', ')}. Nothing was imported.`,
    );
  }
  return plan;
}

async function hasOwnerEntry(authorId, groupId) {
  const { AclEntry } = require('~/db/models');
  const entry = await AclEntry.findOne({
    principalType: PrincipalType.USER,
    principalId: authorId,
    resourceType: ResourceType.PROMPTGROUP,
    resourceId: groupId,
  }).lean();
  return entry != null;
}

async function grantOwner(authorId, groupId) {
  const { grantPermission } = require('~/server/services/PermissionService');
  await grantPermission({
    principalType: PrincipalType.USER,
    principalId: authorId,
    resourceType: ResourceType.PROMPTGROUP,
    resourceId: groupId,
    accessRoleId: AccessRoleIds.PROMPTGROUP_OWNER,
    grantedBy: authorId,
  });
}

async function applyStep(step, author) {
  const db = require('~/models');
  const { item } = step;
  if (step.action === 'create') {
    const created = await db.createPromptGroup({
      prompt: { prompt: item.prompt, type: 'text' },
      group: { name: item.name, category: item.category, oneliner: item.oneliner },
      author: author._id,
      authorName: authorDisplayName(author),
    });
    return created.group._id;
  }
  const groupId = step.group._id;
  if (step.action === 'update') {
    if (step.promptChanged) {
      const saved = await db.savePrompt({
        prompt: { prompt: item.prompt, type: 'text', groupId },
        author: author._id,
      });
      if (!saved.prompt) {
        throw new SeedError(`Could not save the new prompt of "${item.name}"`);
      }
      step.groupChanges.productionId = saved.prompt._id;
    }
    if (Object.keys(step.groupChanges).length > 0) {
      const updated = await db.updatePromptGroup({ _id: groupId }, step.groupChanges);
      if (!updated?._id) {
        throw new SeedError(`Could not update prompt group "${item.name}"`);
      }
    }
  }
  return groupId;
}

async function listOurGroups(author) {
  const { PromptGroup } = require('~/db/models');
  return PromptGroup.find(
    { author: author._id, category: { $regex: `^${CATEGORY_PREFIX}` } },
    { _id: 1, name: 1, category: 1 },
  ).lean();
}

async function importPrompts({ file: rawFile, author, dryRun = false }) {
  const file = parsePromptsFile(rawFile);
  const plan = await planImport(file.items, author);
  const importedNames = new Set(file.items.map((item) => item.name));
  const stale = (await listOurGroups(author))
    .filter((group) => !importedNames.has(group.name))
    .map((group) => group.name);

  const counts = { create: 0, update: 0, unchanged: 0, ownerGranted: 0 };
  for (const step of plan) {
    counts[step.action]++;
    if (dryRun) {
      if (!step.group || !(await hasOwnerEntry(author._id, step.group._id))) {
        counts.ownerGranted++;
      }
      continue;
    }
    const groupId = await applyStep(step, author);
    if (!(await hasOwnerEntry(author._id, groupId))) {
      await grantOwner(author._id, groupId);
      counts.ownerGranted++;
    }
  }

  return {
    dryRun,
    counts,
    changed: plan
      .filter((step) => step.action !== 'unchanged')
      .map((step) => ({
        name: step.item.name,
        action: step.action,
      })),
    stale,
  };
}

async function removePrompts({ author, dryRun = false }) {
  const { deletePromptGroup } = require('~/models');
  const groups = await listOurGroups(author);
  if (!dryRun) {
    for (const group of groups) {
      await deletePromptGroup({ _id: group._id.toString() });
    }
  }
  return { dryRun, removed: groups.map((group) => group.name) };
}

const CLI_OPTIONS = {
  file: { type: 'string' },
  'author-email': { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  remove: { type: 'boolean', default: false },
};

async function main(argv) {
  const args = parseCliArgs(argv, CLI_OPTIONS);
  const author = await findAuthor(args['author-email']);
  const prefix = args['dry-run'] ? '[dry-run] ' : '';
  if (args.remove) {
    const result = await removePrompts({ author, dryRun: args['dry-run'] });
    console.log(`${prefix}removed ${result.removed.length} prompt groups`);
    result.removed.forEach((name) => console.log(`  - ${name}`));
    return;
  }
  const result = await importPrompts({
    file: readJsonFile(args.file),
    author,
    dryRun: args['dry-run'],
  });
  const { counts } = result;
  console.log(
    `${prefix}created ${counts.create}, updated ${counts.update}, unchanged ${counts.unchanged}, ` +
      `owner permissions granted ${counts.ownerGranted}`,
  );
  result.changed.forEach((step) => console.log(`  ${step.action}: ${step.name}`));
  if (result.stale.length > 0) {
    console.warn(`  not in the file anymore (kept): ${result.stale.join(', ')}`);
  }
}

if (require.main === module) {
  runCli(main);
}

module.exports = {
  CATEGORY_PREFIX,
  parsePromptsFile,
  importPrompts,
  removePrompts,
  main,
};
