import {
  DESIGN_QUERY,
  designApplySystemPath,
  designNewProjectPath,
  designSystemPath,
  designSystemsPath,
} from '../paths';

describe('design paths', () => {
  it('keeps the project a gallery was opened from', () => {
    expect(designSystemsPath()).toBe('/design/systems');
    expect(designSystemsPath({ projectId: 'prj_1' })).toBe('/design/systems?project=prj_1');
    expect(designSystemPath('air bnb')).toBe('/design/systems/air%20bnb');
    expect(designSystemPath('airbnb', { projectId: 'prj_1' })).toBe(
      '/design/systems/airbnb?project=prj_1',
    );
  });

  it('hands the chosen system to the new project dialog and the workspace by query', () => {
    expect(DESIGN_QUERY).toEqual({
      project: 'project',
      newProject: 'newProject',
      designSystem: 'designSystem',
      projectKind: 'projectKind',
      template: 'template',
      applyDesignSystem: 'applyDesignSystem',
    });
    expect(designNewProjectPath('airbnb')).toBe('/design?newProject=1&designSystem=airbnb');
    expect(designNewProjectPath(null, { kind: 'deck', templateId: 'tpl-pitch-deck' })).toBe(
      '/design?newProject=1&projectKind=deck&template=tpl-pitch-deck',
    );
    expect(designApplySystemPath('prj_1', 'airbnb')).toBe('/design/prj_1?applyDesignSystem=airbnb');
  });
});
