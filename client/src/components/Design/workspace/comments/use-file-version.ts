import type { FileEntry } from '../../api/types';
import { useDesignFilesQuery } from '../../api/queries';

export function useFileVersion(projectId: string, path: string, fallback: FileEntry[] = []) {
  const { data } = useDesignFilesQuery(projectId);
  const files = data ?? fallback;
  return files.find((file) => file.path === path)?.version ?? null;
}
