export const DESIGN_HOME_PATH = '/design';
export const DESIGN_SYSTEMS_PATH = '/design/systems';

export const DESIGN_QUERY = {
  project: 'project',
  newProject: 'newProject',
  designSystem: 'designSystem',
  projectKind: 'projectKind',
  template: 'template',
  applyDesignSystem: 'applyDesignSystem',
} as const;

function withQuery(path: string, params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const encoded = search.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export const designProjectPath = (projectId: string) =>
  `${DESIGN_HOME_PATH}/${encodeURIComponent(projectId)}`;

export const designSystemsPath = (options: { projectId?: string | null } = {}) =>
  withQuery(DESIGN_SYSTEMS_PATH, { [DESIGN_QUERY.project]: options.projectId });

export const designSystemPath = (systemId: string, options: { projectId?: string | null } = {}) =>
  withQuery(`${DESIGN_SYSTEMS_PATH}/${encodeURIComponent(systemId)}`, {
    [DESIGN_QUERY.project]: options.projectId,
  });

export const designNewProjectPath = (
  systemId?: string | null,
  options: { kind?: string | null; templateId?: string | null } = {},
) =>
  withQuery(DESIGN_HOME_PATH, {
    [DESIGN_QUERY.newProject]: '1',
    [DESIGN_QUERY.designSystem]: systemId,
    [DESIGN_QUERY.projectKind]: options.kind,
    [DESIGN_QUERY.template]: options.templateId,
  });

export const designApplySystemPath = (projectId: string, systemId: string) =>
  withQuery(designProjectPath(projectId), { [DESIGN_QUERY.applyDesignSystem]: systemId });
