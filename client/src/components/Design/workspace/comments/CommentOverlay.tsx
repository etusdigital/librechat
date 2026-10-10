import { useAtomValue } from 'jotai';
import type { WorkspaceModeContext } from '../modes/types';
import { COMPOSER_SIZE, composerPlacement } from './comment-placement';
import { commentDraftAtom, isDraftFor } from './comment-draft';
import CommentComposer from './CommentComposer';

const MARKER_BORDER_PX = 2;

export default function CommentOverlay({ project, path, device, geometry }: WorkspaceModeContext) {
  const draft = useAtomValue(commentDraftAtom);
  if (!isDraftFor(draft, { projectId: project.projectId, path }) || draft.device !== device) {
    return null;
  }
  const { rect } = draft.target;
  const placement = composerPlacement(rect, geometry);
  return (
    <div data-testid="comment-overlay" className="pointer-events-none absolute inset-0">
      <div
        aria-hidden="true"
        data-testid="comment-target-marker"
        className="absolute rounded-sm border-dashed border-surface-submit"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          borderWidth: MARKER_BORDER_PX / geometry.scale,
        }}
      />
      {placement ? (
        <div
          data-testid="comment-anchored-composer"
          className="pointer-events-auto absolute origin-top-left"
          style={{
            left: placement.left,
            top: placement.top,
            width: COMPOSER_SIZE.width,
            transform:
              placement.inverseScale === 1 ? undefined : `scale(${placement.inverseScale})`,
          }}
        >
          <CommentComposer project={project} draft={draft} />
        </div>
      ) : null}
    </div>
  );
}
