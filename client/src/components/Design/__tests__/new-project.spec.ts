import type { DesignMe, DesignTemplate } from '../api/types';
import {
  createProjectInput,
  initialDraft,
  initialStep,
  isDraftReady,
  newProjectHref,
  preferredDesignSystemId,
  readNewProjectPreset,
  templateKindOf,
  templateKindsWithItems,
  templatesOfKind,
  withoutNewProjectParams,
} from '../home/new-project';

const me: DesignMe = {
  sub: 's',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: '',
};

const template = (id: string, kind: DesignTemplate['kind']): DesignTemplate => ({
  id,
  name: id,
  kind,
  category: null,
  description: '',
  license: null,
  previewUrl: null,
});

describe('new project helpers', () => {
  it('prefers the person default, then the company default, then Etus', () => {
    expect(preferredDesignSystemId(undefined)).toBe('etus');
    expect(preferredDesignSystemId(me)).toBe('etus');
    expect(preferredDesignSystemId({ ...me, companyDefaultDesignSystem: 'airbnb' })).toBe('airbnb');
    expect(
      preferredDesignSystemId({
        ...me,
        defaultDesignSystem: 'linear',
        companyDefaultDesignSystem: 'airbnb',
      }),
    ).toBe('linear');
  });

  it('maps project kinds to template kinds and hides kinds without templates', () => {
    expect(templateKindOf('prototype')).toBe('prototype');
    expect(templateKindOf('deck')).toBe('deck');
    expect(templateKindOf('doc')).toBeNull();
    expect(templateKindOf('video')).toBeNull();
    const list = [template('tpl-b', 'deck'), template('tpl-a', 'prototype')];
    expect(templateKindsWithItems(list)).toEqual(['prototype', 'deck']);
    expect(templatesOfKind(list, 'deck').map((item) => item.id)).toEqual(['tpl-b']);
    expect(templatesOfKind(list, null)).toHaveLength(2);
  });

  it('reads and writes the preset in the URL, ignoring invalid values', () => {
    const href = newProjectHref({
      kind: 'deck',
      templateId: 'tpl-pitch-deck',
      designSystemId: 'airbnb',
    });
    expect(href).toBe(
      '/design?newProject=1&designSystem=airbnb&projectKind=deck&template=tpl-pitch-deck',
    );
    const search = new URLSearchParams(href.split('?')[1]);
    expect(readNewProjectPreset(search)).toEqual({
      kind: 'deck',
      templateId: 'tpl-pitch-deck',
      designSystemId: 'airbnb',
    });
    expect(
      readNewProjectPreset(
        new URLSearchParams('newProject=1&projectKind=poster&template=../x&designSystem=Bad Id'),
      ),
    ).toEqual({});
    expect(readNewProjectPreset(new URLSearchParams('projectKind=deck'))).toBeNull();
    expect(
      withoutNewProjectParams(
        new URLSearchParams('tab=shared&newProject=1&projectKind=deck&designSystem=x'),
      ).toString(),
    ).toBe('tab=shared');
  });

  it('starts at the design system step when a template is already chosen', () => {
    expect(initialStep({})).toBe('kind');
    expect(initialStep({ designSystemId: 'airbnb' })).toBe('kind');
    expect(initialStep({ templateId: 'tpl-x' })).toBe('system');
    expect(initialDraft({ designSystemId: 'airbnb' }, me)).toEqual({
      kind: 'prototype',
      templateId: null,
      designSystemId: 'airbnb',
      name: '',
      brief: '',
    });
  });

  it('builds the create input with a trimmed name and no blank template', () => {
    const draft = { ...initialDraft({}, me), name: '  Landing  ', brief: 'x' };
    expect(isDraftReady(draft)).toBe(true);
    expect(isDraftReady({ ...draft, name: '   ' })).toBe(false);
    expect(isDraftReady({ ...draft, name: 'a'.repeat(121) })).toBe(false);
    expect(createProjectInput(draft)).toEqual({
      name: 'Landing',
      kind: 'prototype',
      designSystemId: 'etus',
    });
    expect(createProjectInput({ ...draft, templateId: 'tpl-x' })).toEqual(
      expect.objectContaining({ templateId: 'tpl-x' }),
    );
  });
});
