import {
  Button,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  Spinner,
} from '@librechat/client';
import { useDesignLocalize } from '../../i18n';

export default function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isLoading = false,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isLoading?: boolean;
  destructive?: boolean;
}) {
  const localize = useDesignLocalize();
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
        <OGDialogHeader>
          <OGDialogTitle>{title}</OGDialogTitle>
          <OGDialogDescription>{description}</OGDialogDescription>
        </OGDialogHeader>
        <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end">
          <OGDialogClose asChild>
            <Button type="button" variant="outline" disabled={isLoading}>
              {localize('actions.cancel')}
            </Button>
          </OGDialogClose>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? <Spinner className="size-4" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
