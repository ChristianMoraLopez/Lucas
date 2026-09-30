'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Button, ExpenseCard, LottieSlot, Sticker } from '@/components/lucas-ui';
import { compressImage, evidencePath, extensionFor, MAX_PDF_BYTES } from '@/lib/compress';
import { humanError } from '@/lib/errors';
import { useAccountChanges } from '@/lib/realtime';
import { createClient } from '@/utils/supabase/client';

type Local = 'comprimiendo' | 'subiendo' | 'error';
interface Upload {
  key: string;
  label: string;
  local: Local | null;
  messageId: string | null;
  error: string | null;
}

interface MessageState {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'not_expense' | 'failed';
  expenses: { id: string; merchant: string; total_cop: number; status: string; categories: { name: string } | null }[];
}

export function UploadScreen({ accountId, accountName, closed }: { accountId: string; accountName: string; closed: boolean }) {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [text, setText] = useState('');
  const [sendingText, setSendingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  const patch = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const ids = uploads.map((u) => u.messageId).filter(Boolean) as string[];
  const states = useQuery({
    queryKey: ['subidas', accountId, ids.join()],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('messages').select('id, status, expenses(id, merchant, total_cop, status, categories(name))').in('id', ids);
      if (error) throw error;
      return Object.fromEntries((data as unknown as MessageState[]).map((m) => [m.id, m]));
    },
  });
  // El procesador corre en la base: cuando termina, Realtime avisa y se actualiza solo
  useAccountChanges(accountId, () => queryClient.invalidateQueries({ queryKey: ['subidas', accountId] }));

  async function registrar(kind: 'photo' | 'pdf' | 'text', extra: { text?: string; path?: string; fileName?: string; mime?: string }) {
    const { data, error } = await supabase.rpc('submit_upload', {
      p_account_id: accountId,
      p_kind: kind,
      p_text: extra.text ?? null,
      p_media_path: extra.path ?? null,
      p_file_name: extra.fileName ?? null,
      p_mime_type: extra.mime ?? null,
    });
    if (error) throw error;
    return data as string;
  }

  async function subirArchivo(file: File) {
    const key = crypto.randomUUID();
    const esPdf = file.type === 'application/pdf';
    setUploads((u) => [
      { key, label: file.name || (esPdf ? 'documento.pdf' : 'foto'), local: esPdf ? 'subiendo' : 'comprimiendo', messageId: null, error: null },
      ...u,
    ]);
    try {
      if (!esPdf && !file.type.startsWith('image/')) throw new Error('Solo fotos o PDF');
      if (esPdf && file.size > MAX_PDF_BYTES) throw new Error('El PDF pesa más de 6 MB');
      const blob = esPdf ? file : await compressImage(file);
      patch(key, { local: 'subiendo' });
      const path = evidencePath(accountId, extensionFor(blob.type));
      const { error: upError } = await supabase.storage.from('evidencias').upload(path, blob, { contentType: blob.type, upsert: false });
      if (upError) throw upError;
      const messageId = await registrar(esPdf ? 'pdf' : 'photo', { path, fileName: file.name, mime: blob.type });
      patch(key, { local: null, messageId });
    } catch (e) {
      patch(key, { local: 'error', error: humanError(e as { message?: string }) });
    }
  }

  const onFiles = (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) void subirArchivo(f);
  };

  const enviarTexto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setTextError('Escribe el gasto, por ejemplo «taxis al aeropuerto 100 lucas»');
      return;
    }
    setSendingText(true);
    setTextError(null);
    const key = crypto.randomUUID();
    try {
      const messageId = await registrar('text', { text });
      setUploads((u) => [{ key, label: `«${text.trim().slice(0, 48)}»`, local: null, messageId, error: null }, ...u]);
      setText('');
    } catch (err) {
      setTextError(humanError(err as { message?: string }));
    } finally {
      setSendingText(false);
    }
  };

  if (closed) {
    return (
      <div className="up">
        <h1 className="lu-display">Subir un gasto</h1>
        <p className="lu-small lu-muted">«{accountName}» está cerrada: ya no recibe gastos.</p>
      </div>
    );
  }

  return (
    <div className="up">
      <header className="up-head">
        <h1 className="lu-display">Subir un gasto</h1>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          Una foto del recibo, un PDF o escríbelo como en el grupo. Lucas lo lee y lo deja en Revisar.
        </p>
      </header>

      <div className="up-main">
        <div className="up-options">
          <button type="button" className="up-opt up-opt--cam" onClick={() => camera.current?.click()}>
            <b>Tomar foto</b>
            <span>Abre la cámara del celular. Que se vea el total.</span>
          </button>
          <button type="button" className="up-opt" onClick={() => files.current?.click()}>
            <b>Foto o PDF</b>
            <span>De la galería o de tus archivos. Puedes elegir varios.</span>
          </button>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
          <input ref={files} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        </div>

        <form className="up-text" onSubmit={enviarTexto}>
          <label className="lu-label" htmlFor="gasto-texto">
            O escríbelo
          </label>
          <textarea
            id="gasto-texto"
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="taxis al aeropuerto 100 lucas, la pagó Santi"
          />
          {textError && (
            <p className="lu-field-error" role="alert">
              {textError}
            </p>
          )}
          <Button type="submit" variant="secondary" disabled={sendingText}>
            {sendingText ? 'Enviando…' : 'Enviar'}
          </Button>
        </form>
      </div>

      <section className="up-list" aria-label="Lo que subiste" aria-live="polite">
        {uploads.length === 0 ? (
          <div className="up-empty">
            <LottieSlot name="vacio" width={72} height={72} />
            <span className="lu-small lu-muted">Las fotos se comprimen en tu celular antes de subir: pesan poco y se leen igual.</span>
          </div>
        ) : (
          uploads.map((u) => <UploadRow key={u.key} upload={u} state={u.messageId ? states.data?.[u.messageId] : undefined} accountId={accountId} />)
        )}
      </section>
    </div>
  );
}

function UploadRow({ upload, state, accountId }: { upload: Upload; state: MessageState | undefined; accountId: string }) {
  const gasto = state?.expenses?.[0];
  if (gasto && state?.status === 'done') {
    const pendiente = gasto.status === 'pending_review';
    return (
      <ExpenseCard
        appear
        merchant={gasto.merchant}
        category={gasto.categories?.name}
        total={gasto.total_cop}
        meta={pendiente ? 'Lo leímos. Revísalo antes de que cuente.' : 'Lo conocíamos: ya quedó registrado.'}
        sticker={pendiente ? <Sticker tone="revisar" size="sm" rotate={5} animate /> : <Sticker tone="confirmado" size="sm" rotate={-5} animate />}
      >
        {pendiente && (
          <Link href={`/c/${accountId}/revisar?gasto=${gasto.id}`} className="lu-btn lu-btn--sm lu-btn--secondary">
            Revisar ahora
          </Link>
        )}
      </ExpenseCard>
    );
  }

  const estado =
    upload.local === 'comprimiendo'
      ? 'Comprimiendo la foto…'
      : upload.local === 'subiendo'
        ? 'Subiendo…'
        : upload.local === 'error'
          ? upload.error
          : state?.status === 'failed'
            ? 'No pudimos leerlo. Intenta con otra foto.'
            : state?.status === 'processing'
              ? 'Leyendo…'
              : 'En cola: Lucas lo lee en unos segundos';

  return (
    <div className={`up-row${upload.local === 'error' || state?.status === 'failed' ? ' is-error' : ''}`}>
      {upload.local !== 'error' && state?.status !== 'failed' && <LottieSlot name="escaneo" width={40} height={40} label="Procesando" />}
      <span className="up-row__txt">
        <b>{upload.label}</b>
        <span>{estado}</span>
      </span>
    </div>
  );
}
