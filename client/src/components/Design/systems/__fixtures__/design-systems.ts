import type {
  DesignMe,
  DesignProject,
  DesignSystemDetail,
  DesignSystemPage,
  DesignSystemSummary,
} from '../../api/types';

export const me: DesignMe = {
  sub: 's',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: 'etus',
  canSetCompanyDefault: false,
  companyDefaultDesignSystem: 'etus',
};

export const summary = (
  id: string,
  overrides: Partial<DesignSystemSummary> = {},
): DesignSystemSummary => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  category: 'Productivity & SaaS',
  summary: `${id} summary`,
  license: 'MIT',
  hasComponents: true,
  thumbnailUrl: `/preview/ds/${id}/thumbnail.png`,
  swatches: ['#ff385c', '#ffffff', '#222222', '#f7f7f7', '#6a6a6a'],
  headingFont: 'Inter, sans-serif',
  ...overrides,
});

export const etus = summary('etus', {
  category: 'Etus',
  hasComponents: false,
  thumbnailUrl: null,
  license: 'LicenseRef-Etus-Internal',
  swatches: ['#3be476', '#fbfaf9', '#151514', '#ffffff', '#6e6d68'],
  headingFont: '"Space Grotesk", sans-serif',
});
export const airbnb = summary('airbnb', { inspiredBy: 'Airbnb', category: 'Travel' });
export const minimal = summary('minimal', { thumbnailUrl: null, hasComponents: false });

export const page = (
  items: DesignSystemSummary[],
  overrides: Partial<DesignSystemPage> = {},
): DesignSystemPage => ({
  items,
  nextCursor: null,
  total: items.length,
  categories: ['Etus', 'Productivity & SaaS', 'Travel'],
  ...overrides,
});

export const detail = (
  base: DesignSystemSummary,
  overrides: Partial<DesignSystemDetail> = {},
): DesignSystemDetail => ({
  ...base,
  attribution: {
    origin: 'open-design',
    sourcePath: `design-systems/${base.id}`,
    originalUpstream: 'https://github.com/example/design-systems',
    upstreamCommit: 'abc123',
  },
  designMd: `# ${base.name}\n\nUse the accent for primary actions only.`,
  tokensCss: null,
  usageMd: null,
  componentsUrl: base.hasComponents ? `/preview/ds/${base.id}/components.html` : null,
  previewUrl: base.hasComponents ? `/preview/ds/${base.id}/components.html` : null,
  previews: [],
  colors: [
    { name: 'bg', cssVar: '--bg', value: '#ffffff' },
    { name: 'fg', cssVar: '--fg', value: '#222222' },
    { name: 'meta', cssVar: '--meta', value: '#929292' },
    { name: 'accent', cssVar: '--accent', value: '#ff385c' },
    { name: 'accent-on', cssVar: '--accent-on', value: '#ffffff' },
    {
      name: 'accent-hover',
      cssVar: '--accent-hover',
      value: 'color-mix(in oklab, #ff385c, black 8%)',
    },
  ],
  typography: {
    families: [
      {
        name: 'font-display',
        cssVar: '--font-display',
        value: 'Cereal, Inter, sans-serif',
        primary: 'Cereal',
      },
    ],
    weights: [400, 600, 700],
    scale: [
      { name: 'text-sm', cssVar: '--text-sm', value: '14px' },
      { name: 'text-4xl', cssVar: '--text-4xl', value: '56px' },
    ],
    leading: [{ name: 'leading-body', cssVar: '--leading-body', value: '1.43' }],
    tracking: [],
  },
  ...overrides,
});

export const project: DesignProject = {
  projectId: 'prj_abc',
  name: 'Landing Produto X',
  kind: 'prototype',
  designSystemId: 'etus',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 's', name: 'Ana' },
  access: 'owner',
  canWrite: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};
