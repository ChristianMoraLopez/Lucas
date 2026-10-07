'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { ReactNode } from 'react';
import { useT } from '@/components/idioma';
import { Button } from '@/components/lucas-ui';

/**
 * Confirmación para acciones importantes (sacar a alguien, salir de la cuenta,
 * liquidar). Radix pone el foco, el Escape y el aria; el estilo sale de tokens.css.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  busy = false,
  danger = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  /** false: la acción no destruye nada (liquidar), el botón va en el color principal */
  danger?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="lu-dialog__overlay" />
        <AlertDialog.Content className="lu-dialog">
          <AlertDialog.Title className="lu-title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="lu-dialog__text">{children}</AlertDialog.Description>
          <div className="lu-dialog__btns">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" size="sm">
                {t('Cancelar')}
              </Button>
            </AlertDialog.Cancel>
            <Button
              size="sm"
              variant={danger ? 'secondary' : 'primary'}
              className={danger ? 'lu-btn--danger' : undefined}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {busy ? t('Un momento…') : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
