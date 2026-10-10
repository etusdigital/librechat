import { createGitHubRepoAdapter } from './github';

const token = process.env.A0_GITHUB_TOKEN;
const run = token ? it : it.skip;

describe('A0 spike: skillSync adapter against the private etusdigital/etus-design', () => {
  run('resolves the commit and lists files with a Bearer token', async () => {
    const adapter = createGitHubRepoAdapter({
      source: {
        id: 'etus-design',
        owner: 'etusdigital',
        repo: 'etus-design',
        ref: 'main',
        paths: ['docs/specs'],
      } as never,
      token: token as string,
      fetchFn: fetch,
    });
    const commit = await adapter.resolveCommit();
    const entries = await adapter.fetchTreeEntries(commit, {
      pathPrefix: 'docs/specs',
      assertNotCancelled: () => undefined,
    } as never);
    const paths = entries.map((entry) => entry.path);
    expect(commit.id).toMatch(/^[0-9a-f]{40}$/);
    expect(paths).toContain('docs/specs/A-conteudo-e-agente.md');
    const blob = entries.find((entry) => entry.path === 'docs/specs/A-conteudo-e-agente.md');
    const content = await adapter.fetchFileContent(commit, blob as never);
    expect(content.toString('utf8')).toContain('# Fase A');
  });
});
