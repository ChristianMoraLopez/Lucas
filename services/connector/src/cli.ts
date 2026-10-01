import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { ConfigError, loadConfig } from './config.js';
import { SupabaseStore } from './store.js';

/*
 * Comandos para quien opera el servidor (con el connector ya corriendo):
 *
 *   docker compose exec connector node dist/cli.js vincular-contador
 *   docker compose exec connector node dist/cli.js vincular-contador 573001234567
 *   docker compose exec connector node dist/cli.js estado
 *   docker compose exec connector node dist/cli.js desvincular-contador
 *
 * vincular-contador pide la sesión del número contador; el connector la
 * arranca en unos segundos y aquí aparece el QR (o el código de 8 letras si se
 * pasa el número) para vincularlo desde WhatsApp → Dispositivos vinculados.
 */

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
  const db = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } });
  const store = new SupabaseStore(config.supabaseUrl, config.supabaseKey);
  const [comando, arg] = process.argv.slice(2);

  if (comando === 'estado') {
    const { data, error } = await db
      .from('whatsapp_connections')
      .select('kind, status, phone_number, last_seen_at, connected_at, disconnect_reason')
      .order('kind');
    if (error) throw error;
    if (!data.length) console.log('No hay sesiones. Vincula el número contador con: node dist/cli.js vincular-contador');
    for (const s of data) {
      console.log(
        `${s.kind.padEnd(9)} ${s.status.padEnd(12)} ${s.phone_number ? `+${s.phone_number}` : 'sin número'} · latido ${s.last_seen_at ?? 'nunca'}${s.disconnect_reason ? ` · ${s.disconnect_reason}` : ''}`,
      );
    }
    return;
  }

  if (comando === 'desvincular-contador') {
    const { error } = await db.from('whatsapp_connections').update({ stop_requested_at: new Date().toISOString() }).eq('kind', 'contador');
    if (error) throw error;
    console.log('Listo: el connector desvincula el número contador en unos segundos.');
    return;
  }

  if (comando === 'vincular-contador') {
    const phone = arg ? arg.replace(/\D/g, '') : null;
    if (phone && !/^\d{8,15}$/.test(phone)) {
      console.error('Escribe el número con indicativo y sin «+», por ejemplo 573001234567');
      process.exit(2);
    }
    const id = await store.requestContador(phone);
    console.log(phone ? `Pidiendo un código de vinculación para +${phone}…` : 'Pidiendo el QR…');
    console.log('En el celular del número contador: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.\n');

    let ultimoQr: string | null = null;
    let ultimoCodigo: string | null = null;
    const limite = Date.now() + 5 * 60_000;
    while (Date.now() < limite) {
      const { data: s, error } = await db
        .from('whatsapp_connections')
        .select('status, pairing_qr, pairing_code, phone_number, disconnect_reason')
        .eq('id', id)
        .single();
      if (error) throw error;
      if (s.status === 'connected') {
        console.log(`\nListo: el número contador quedó vinculado${s.phone_number ? ` (+${s.phone_number})` : ''}. Ya puedes agregarlo a los grupos.`);
        return;
      }
      if (s.status === 'disconnected') {
        console.error(`\nNo se vinculó: ${s.disconnect_reason ?? 'sin motivo'}. Vuelve a correr el comando.`);
        process.exit(1);
      }
      if (phone && s.pairing_code && s.pairing_code !== ultimoCodigo) {
        ultimoCodigo = s.pairing_code;
        const code = String(s.pairing_code);
        console.log(`Código: ${code.slice(0, 4)}-${code.slice(4)}  (toca «Vincular con el número de teléfono» y escríbelo)`);
      } else if (!phone && s.pairing_qr && s.pairing_qr !== ultimoQr) {
        ultimoQr = s.pairing_qr;
        console.log(await QRCode.toString(s.pairing_qr, { type: 'terminal', small: true }));
        console.log('Escanéalo (se renueva cada 20 segundos más o menos)…');
      }
      await espera(2000);
    }
    console.error('Se acabó el tiempo. ¿Está corriendo el connector? (docker compose ps)');
    process.exit(1);
  }

  console.log('Comandos: vincular-contador [número] · estado · desvincular-contador');
  process.exit(comando ? 2 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
