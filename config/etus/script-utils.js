const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

require('module-alias')({ base: path.resolve(__dirname, '..', '..', 'api') });
require('~/db/models');

class SeedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedError';
  }
}

function parseCliArgs(argv, options) {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new SeedError(error.message);
  }
}

function readJsonFile(filePath) {
  if (!filePath) {
    throw new SeedError('Missing --file');
  }
  const resolved = path.resolve(filePath);
  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new SeedError(`Cannot read ${resolved}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new SeedError(`${resolved} is not valid JSON: ${error.message}`);
  }
}

function formatZodError(label, error) {
  const issues = error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
  return new SeedError(`${label} is invalid: ${issues}`);
}

async function findAuthor(email) {
  if (!email) {
    throw new SeedError('Missing --author-email');
  }
  const { findUser } = require('~/models');
  const user = await findUser({ email: email.trim().toLowerCase() });
  if (!user) {
    throw new SeedError(`No user with email ${email}`);
  }
  return user;
}

function authorDisplayName(user) {
  return user.name || user.username || user.email;
}

async function runCli(main, argv = process.argv.slice(2)) {
  const connect = require('../connect');
  const mongoose = require('mongoose');
  let exitCode = 0;
  try {
    await connect();
    await main(argv);
  } catch (error) {
    exitCode = 1;
    if (error instanceof SeedError) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(error);
    }
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

module.exports = {
  SeedError,
  parseCliArgs,
  readJsonFile,
  formatZodError,
  findAuthor,
  authorDisplayName,
  runCli,
};
