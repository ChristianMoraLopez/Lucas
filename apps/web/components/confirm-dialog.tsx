'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { ReactNode } from 'react';
import { Button } from '@/components/lucas-ui';

/**
 * Confirmación para acciones que no se deshacen (sacar a alguien, salir de la
 * cuenta). Radix pone el foco, el Escape y el aria; el estilo sale de tokens.css.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
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
                Cancelar
              </Button>
            </AlertDialog.Cancel>
            <Button
              size="sm"
              variant="secondary"
              className="lu-btn--danger"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {busy ? 'Un momento…' : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
