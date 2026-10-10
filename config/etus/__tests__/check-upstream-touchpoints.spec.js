const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  DESIGN_TOUCHPOINTS,
  DEFAULT_BASE_REFS,
  isAllowedPath,
  findUnexpectedPaths,
  checkTouchpoints,
  main,
} = require('../check-upstream-touchpoints');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.resolve(__dirname, '..', 'check-upstream-touchpoints.js');

describe('touchpoint rules', () => {
  it('keeps the design touchpoints of spec C 3.1 as a closed list', () => {
    expect([...DESIGN_TOUCHPOINTS].sort()).toEqual(
      [
        'api/server/index.js',
        'client/src/hooks/Nav/useSideNavLinks.ts',
        'client/src/locales/i18n.ts',
        'client/src/routes/index.tsx',
      ].sort(),
    );
  });

  it.each([
    'api/server/services/Etus/design/proxy.js',
    'api/server/routes/etus/design.js',
    'config/etus/check-upstream-touchpoints.js',
    'client/src/components/Design/routes.tsx',
    'client/src/components/Etus/Anything.tsx',
    'client/src/locales/pt-BR/etus-design.json',
    'client/src/locales/en/etus-design.json',
    'api/server/index.js',
    'client/src/routes/index.tsx',
    '.env.example',
    'e2e/specs/etus-design/compose.yml',
    'e2e/specs/etus-design/support/session.ts',
    '.github/workflows/etus-design-e2e.yml',
  ])('allows %s', (filePath) => {
    expect(isAllowedPath(filePath)).toBe(true);
  });

  it.each([
    'api/server/routes/index.js',
    'api/server/services/EtusEvil.js',
    'api/server/services/etus/proxy.js',
    'api/server/routes/etusx/design.js',
    'config/etus',
    'config/etusx/a.js',
    'client/src/components/DesignSystem/x.tsx',
    'client/src/locales/pt-BR/etus-design.json.bak',
    'client/src/locales/pt-BR/nested/etus-design.json',
    'client/src/locales/pt-BR/other.json',
    'packages/api/src/index.ts',
    '.github/workflows/etus-checks.yml',
    '.github/workflows/etus-design-e2e.yml.bak',
    'e2e/specs/etus-designx/a.ts',
    'e2e/specs/mock/design.spec.ts',
  ])('refuses %s', (filePath) => {
    expect(isAllowedPath(filePath)).toBe(false);
  });

  it('lists each unexpected path once, sorted', () => {
    expect(
      findUnexpectedPaths(['b.js', 'api/server/index.js', 'a.js', 'b.js', 'config/etus/x.js']),
    ).toEqual(['a.js', 'b.js']);
  });

  it('registers the /api/etus routes with a single line before the API 404', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'api/server/index.js'), 'utf8');
    const line = "  app.use('/api/etus', require('./routes/etus'));\n";
    expect(source.split(line)).toHaveLength(2);
    expect(source.indexOf(line)).toBeLessThan(source.indexOf("app.use('/api', apiNotFound)"));
  });
});

describe('check-upstream-touchpoints against a git repository', () => {
  let dir;
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.email=ci@etus.test',
        '-c',
        'user.name=CI',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const write = (filePath, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, filePath)), { recursive: true });
    fs.writeFileSync(path.join(dir, filePath), content);
  };
  const commitAll = (message) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
  };
  const run = (...args) => {
    const output = { log: [], error: [] };
    const log = jest.spyOn(console, 'log').mockImplementation((line) => output.log.push(line));
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation((line) => output.error.push(line));
    try {
      return { code: main(['--cwd', dir, ...args], {}), ...output };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etus-touchpoints-'));
    git('init', '-q', '-b', 'main');
    write('api/server/index.js', 'upstream\n');
    write('api/server/routes/index.js', 'upstream\n');
    write('client/src/locales/pt-BR/translation.json', '{}\n');
    commitAll('upstream');
    git('checkout', '-q', '-b', 'etus');
    write('api/server/index.js', 'upstream\netus\n');
    write('api/server/services/Etus/design/proxy.js', 'proxy\n');
    write('client/src/locales/pt-BR/etus-design.json', '{}\n');
    commitAll('etus');
    git('checkout', '-q', 'main');
    write('api/server/routes/index.js', 'upstream moved on\n');
    commitAll('upstream later');
    git('checkout', '-q', 'etus');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes when every change is an Etus folder or a listed touchpoint', () => {
    const result = run('--base', 'main');
    expect(result.code).toBe(0);
    expect(result.log.join('\n')).toContain('3 files differ from main');
  });

  it('compares with the merge-base, so later upstream changes do not count', () => {
    expect(checkTouchpoints({ cwd: dir, base: 'main' }).changed).not.toContain(
      'api/server/routes/index.js',
    );
  });

  it('fails and names the file when an unlisted upstream file changes', () => {
    write('api/server/routes/index.js', 'upstream\npatched\n');
    commitAll('patch upstream route index');
    const result = run('--base', 'main');
    expect(result.code).toBe(1);
    expect(result.error.join('\n')).toContain('api/server/routes/index.js');
  });

  it('counts both sides of a rename', () => {
    git('mv', 'client/src/locales/pt-BR/translation.json', 'client/src/locales/pt-BR/moved.json');
    commitAll('rename');
    const result = checkTouchpoints({ cwd: dir, base: 'main' });
    expect(result.changed).toEqual(
      expect.arrayContaining([
        'client/src/locales/pt-BR/moved.json',
        'client/src/locales/pt-BR/translation.json',
      ]),
    );
    expect(result.unexpected).toEqual(['client/src/locales/pt-BR/moved.json']);
  });

  it('fails on a new file outside the Etus folders', () => {
    write('api/server/services/Design/proxy.js', 'x\n');
    commitAll('new folder');
    expect(run('--base', 'main').code).toBe(1);
  });

  it('exits 2 when the base ref does not exist', () => {
    const result = run('--base', 'nope/main');
    expect(result.code).toBe(2);
    expect(result.error.join('\n')).toContain('nope/main');
  });

  it('exits 2 when no default upstream ref exists', () => {
    const result = run();
    expect(result.code).toBe(2);
    expect(result.error.join('\n')).toContain(DEFAULT_BASE_REFS.join(', '));
  });

  it('runs from the command line', () => {
    const output = execFileSync(process.execPath, [SCRIPT, '--cwd', dir, '--base', 'main'], {
      encoding: 'utf8',
    });
    expect(output).toContain('all within the Etus touchpoints');
  });
});

const upstreamRef = (() => {
  try {
    return DEFAULT_BASE_REFS.find((ref) => {
      try {
        execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
          cwd: REPO_ROOT,
          stdio: 'ignore',
        });
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return undefined;
  }
})();

(upstreamRef ? describe : describe.skip)('this repository', () => {
  it(`touches only the Etus folders and listed files compared with ${upstreamRef}`, () => {
    const result = checkTouchpoints({ cwd: REPO_ROOT, base: upstreamRef });
    expect(result.unexpected).toEqual([]);
  });
});
