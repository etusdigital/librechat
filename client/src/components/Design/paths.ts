export const DESIGN_HOME_PATH = '/design';
export const DESIGN_SYSTEMS_PATH = '/design/systems';

export const designProjectPath = (projectId: string) =>
  `${DESIGN_HOME_PATH}/${encodeURIComponent(projectId)}`;

export const designSystemPath = (systemId: string) =>
  `${DESIGN_SYSTEMS_PATH}/${encodeURIComponent(systemId)}`;
