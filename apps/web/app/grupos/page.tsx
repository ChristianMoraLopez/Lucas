import { LogoLink } from '@/components/logo-link';
import { MenuPrincipal } from '@/components/menu-principal';
import { getT } from '@/lib/i18n/server';
import type { GrupoDetectado } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { TusGrupos } from './tus-grupos';

/**
 * Tus grupos de WhatsApp: los de Mister Luks donde está tu número verificado y
 * todavía no tienen cuenta, y los de tu WhatsApp vinculado (solo el nombre),
 * para crearles la cuenta o conectarlos a una tuya sin código.
 */
export default async function GruposPage() {
  const { supabase } = await requireUser('/grupos');
  const t = await getT();
  const { data } = await supabase.rpc('my_detected_groups');

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal />
        </span>
      </header>
      <div className="nc gr">
        <div className="ap-intro">
          <h1 className="lu-display">{t('Tus grupos de WhatsApp')}</h1>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {t('Elige un grupo para crearle su cuenta o conectarlo a una tuya. Sin códigos: la gente del grupo queda en la cuenta.')}
          </p>
        </div>
        <TusGrupos detectados={(data ?? []) as GrupoDetectado[]} />
      </div>
    </div>
  );
}
