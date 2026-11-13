'use client';

import { useT } from '@/components/idioma';
import { LOCALE } from '@/lib/i18n';
import { dinero, type Moneda } from '@/lib/moneda';
import { type Escenario, type proyectar, saltos } from '@/lib/proyeccion';

/**
 * El procedimiento con los números de la persona: el modelo, la transformada de
 * Laplace, los teoremas que se usan y las vueltas de Newton-Raphson. Viene del
 * proyecto de Ecuaciones Diferenciales (UCompensar, 2026).
 */
export function ComoLoCalcula({ e, r, moneda }: { e: Escenario; r: ReturnType<typeof proyectar>; moneda: Moneda }) {
  const t = useT();
  const num = (n: number, d = 0) => n.toLocaleString(LOCALE[t.idioma], { maximumFractionDigits: d });
  const $ = (n: number) => dinero(n, moneda, t.idioma);
  const { saldo: S0, gastoHoy: Gi, gastoBase: G0, k } = e;
  const kk = num(k, 3);
  const flexible = Gi - G0;
  const ev = saltos(e);

  return (
    <details className="pr-card pr-calc">
      <summary>
        <span className="lu-title">{t('Así lo calcula Luks')}</span>
        <span className="lu-small lu-muted">{t('El modelo, la transformada de Laplace y Newton-Raphson, con sus números')}</span>
      </summary>

      <ol className="pr-pasos">
        <li>
          <h3>{t('El modelo')}</h3>
          <p>{t('El saldo baja al ritmo del gasto, y el gasto de más se va recortando hacia el gasto que no se recorta:')}</p>
          <p className="pr-eq">
            S′(t) = −G(t), &nbsp; G′(t) = −k [G(t) − G<sub>0</sub>]
          </p>
          <p>{t('Al derivar la primera y reemplazar la segunda queda una ecuación lineal de segundo orden:')}</p>
          <p className="pr-eq">
            S″ + {kk} S′ = −{num(k * G0, 2)}, &nbsp; S(0) = {num(S0)}, &nbsp; S′(0) = −{num(Gi)}
          </p>
        </li>
        <li>
          <h3>{t('Transformada de Laplace')}</h3>
          <p>{t('Con Y(s) = ℒ{S(t)} y la transformada de las derivadas, las condiciones iniciales entran solas:')}</p>
          <p className="pr-eq">
            s²Y − sS(0) − S′(0) + k[sY − S(0)] = −kG<sub>0</sub>/s
          </p>
          <p>{t('Despejando y separando en fracciones parciales:')}</p>
          <p className="pr-eq">
            Y(s) = {num(S0)}/s − {num(G0)}/s² − {num(flexible)}/[s(s + {kk})]
          </p>
        </li>
        <li>
          <h3>{t('De vuelta al tiempo')}</h3>
          <ul className="pr-teo">
            <li>
              <b>{t('Primer teorema de traslación')}</b>: ℒ<sup>−1</sup>
              {'{'}1/(s + k){'}'} = e<sup>−kt</sup>
            </li>
            <li>
              <b>{t('Derivada de una transformada')}</b>: ℒ{'{'}t{'}'} = −d/ds (1/s) = 1/s²
            </li>
            <li>
              <b>{t('Teorema de convolución')}</b>: ℒ<sup>−1</sup>
              {'{'}1/[s(s + k)]{'}'} = 1 * e<sup>−kt</sup> = (1 − e<sup>−kt</sup>)/k
            </li>
          </ul>
          <p className="pr-eq">
            S(t) = {num(S0)} − {num(G0)} t − {num(k > 0 ? flexible / k : 0)} (1 − e<sup>−{kk}t</sup>)
          </p>
          <p className="pr-eq">
            G(t) = {num(G0)} + {num(flexible)} e<sup>−{kk}t</sup>
          </p>
        </li>
        {ev.length > 0 && (
          <li>
            <h3>{t('Lo que viene: segundo teorema de traslación')}</h3>
            <p>{t('Cada evento que empieza el día a se multiplica por e^(−as) en s y aparece como un escalón u(t − a) en el tiempo:')}</p>
            <ul className="pr-teo">
              {ev.map((x) => (
                <li key={`${x.dia}-${x.monto}`} className="lu-num">
                  {x.monto > 0 ? '+' : '−'} {$(Math.abs(x.monto))} · u(t − {x.dia})
                  {x.J > 0 && (
                    <>
                      {' '}
                      − ({num(x.J)}/{kk})(1 − e
                      <sup>
                        −{kk}(t − {x.dia})
                      </sup>
                      ) u(t − {x.dia}) &nbsp;
                      <span className="lu-muted">{t('(el gasto vuelve a subir)')}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </li>
        )}
        <li>
          <h3>{t('El día de la alerta: Newton-Raphson')}</h3>
          <p>
            {t('Como t queda dentro y fuera de la exponencial, S(t) = umbral no se despeja con logaritmos. Se itera t ← t − f(t)/f′(t) con f′(t) = −G(t):')}
          </p>
          {r.alerta && r.alerta.iteraciones.length > 0 ? (
            <p className="pr-eq">
              {r.alerta.iteraciones
                .slice(0, 6)
                .map((x) => num(x, 4))
                .join(' → ')}
            </p>
          ) : (
            <p className="lu-small lu-muted">
              {r.alerta
                ? t('Aquí el saldo cae por debajo del umbral de golpe, por un gasto grande: no hace falta iterar.')
                : t('El saldo no llega al umbral en el horizonte.')}
            </p>
          )}
        </li>
        <li>
          <h3>{t('Supuestos y límites')}</h3>
          <ul className="pr-teo">
            <li>{t('k y el gasto que no se recorta son supuestos: con k entre 0,01 y 0,06 la alerta se mueve casi seis días.')}</li>
            <li>{t('El tiempo es continuo y el gasto real llega a saltos; por eso Luks redondea al día.')}</li>
            <li>{t('Después de llegar a cero la fórmula ya no es plata disponible: no modela deudas.')}</li>
          </ul>
        </li>
      </ol>

      <p className="lu-small lu-muted pr-fuente">
        {t(
          'Modelo del proyecto de Ecuaciones Diferenciales, Fundación Universitaria Compensar (2026): Christian Rey Mora López, Esthefania Narvaez Poloche, Ana Valentina Agudelo Barrantes y Juan Diego Barrera Castillo. Bases: Zill (2015), Ecuaciones diferenciales con aplicaciones de modelado; Mesa (2012), Ecuaciones diferenciales ordinarias.',
        )}
      </p>
    </details>
  );
}
