import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, count, createDb, GASTO_ASADERO, GASTO_CASA, GASTO_HOSTAL, impersonate, one, P, PASEO, U } from './harness';

// Qué puede y qué no puede hacer cada rol. Roles en la semilla:
//   Casa:  Valeria owner · Andrés admin
//   Paseo: Valeria owner · Laura admin · Mafe, Juan Camilo, Andrés, Santi member
//          Caro y Felipe: personas sin cuenta (solo WhatsApp)
// Cada prueba corre en una transacción que se deshace (ver harness.ts).

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const DENIED = /permission denied|row-level security/;

describe('visibilidad', () => {
  it('anon no puede leer ninguna tabla', async () => {
    await expect(as(db, null, (tx) => tx.query('select * from public.accounts'))).rejects.toThrow(DENIED);
    await expect(as(db, null, (tx) => tx.query('select * from public.expenses'))).rejects.toThrow(DENIED);
  });

  it('anon no puede llamar RPC', async () => {
    await expect(as(db, null, (tx) => tx.query(`select public.join_with_code('PASEO-7K2Q')`))).rejects.toThrow(DENIED);
  });

  it('member ve los gastos de su cuenta, pero no los de otra', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await count(tx, 'select 1 from public.expenses where account_id = $1', [PASEO])).toBe(16);
      expect(await count(tx, 'select 1 from public.expenses where account_id = $1', [CASA])).toBe(0);
      expect(await count(tx, 'select 1 from public.accounts where id = $1', [CASA])).toBe(0);
      expect(await count(tx, 'select 1 from public.people where account_id = $1', [CASA])).toBe(0);
    });
  });

  it('alguien sin cuentas no ve nada', async () => {
    await as(db, U.nuevo, async (tx) => {
      for (const t of ['accounts', 'people', 'expenses', 'expense_splits', 'categories', 'budgets', 'messages', 'whatsapp_groups']) {
        expect(await count(tx, `select 1 from public.${t}`), t).toBe(0);
      }
    });
  });

  it('solo owner y admin ven las invitaciones', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await count(tx, 'select 1 from public.invitations')).toBe(0);
    });
    await as(db, U.laura, async (tx) => {
      expect(await count(tx, 'select 1 from public.invitations where account_id = $1', [PASEO])).toBe(2);
    });
  });

  it('las tablas del connector y del worker son solo para el service role', async () => {
    await as(db, U.valeria, async (tx) => {
      expect(await count(tx, 'select 1 from public.whatsapp_connections')).toBe(0);
      expect(await count(tx, 'select 1 from public.jobs')).toBe(0);
    });
    await expect(as(db, U.valeria, (tx) => tx.query(`insert into public.jobs (type) values ('hack')`))).rejects.toThrow(DENIED);
    await expect(as(db, U.valeria, (tx) => tx.query(`insert into public.whatsapp_connections (label) values ('hack')`))).rejects.toThrow(DENIED);
  });

  it('member ve el grupo y los mensajes de su cuenta, no los de otra', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await count(tx, 'select 1 from public.whatsapp_groups')).toBe(1);
      expect(await count(tx, 'select 1 from public.messages')).toBe(13);
    });
  });

  it('cada quien ve su perfil y los de quienes comparten cuenta', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await count(tx, 'select 1 from public.profiles')).toBe(6);
    });
    await as(db, U.nuevo, async (tx) => {
      expect(await count(tx, 'select 1 from public.profiles')).toBe(1);
    });
  });
});

describe('gastos', () => {
  const nuevoGasto = (cuenta: string, estado = 'pending_review', creador = '(select auth.uid())') =>
    `insert into public.expenses (account_id, merchant, total_cop, status, created_by)
     values ('${cuenta}', 'Tienda Don Beto', 25000, '${estado}', ${creador}) returning id`;

  it('member reporta un gasto en su cuenta (queda pendiente)', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await count(tx, nuevoGasto(PASEO))).toBe(1);
    });
  });

  it('member no puede reportar un gasto ya confirmado', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(nuevoGasto(PASEO, 'confirmed')))).rejects.toThrow(DENIED);
  });

  it('nadie reporta a nombre de otro', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(nuevoGasto(PASEO, 'pending_review', `'${U.mafe}'`)))).rejects.toThrow(DENIED);
  });

  it('nadie reporta en una cuenta ajena', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(nuevoGasto(CASA)))).rejects.toThrow(DENIED);
  });

  it('member no edita, no confirma ni borra gastos', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await count(tx, `update public.expenses set merchant = 'Cambio' where id = $1 returning 1`, [GASTO_HOSTAL])).toBe(0);
      expect(await count(tx, `update public.expenses set status = 'confirmed' where id = $1 returning 1`, [GASTO_ASADERO])).toBe(0);
      expect(await count(tx, 'delete from public.expenses where id = $1 returning 1', [GASTO_HOSTAL])).toBe(0);
    });
  });

  it('member detalla su propio gasto pendiente, pero no el de otros', async () => {
    await as(db, U.santi, async (tx) => {
      const { id } = await one<{ id: string }>(tx, nuevoGasto(PASEO));
      expect(await count(tx, `insert into public.expense_items (expense_id, name, total_cop) values ($1, 'Gaseosa', 25000) returning 1`, [id])).toBe(1);
      expect(
        await count(tx, 'insert into public.expense_splits (expense_id, person_id, amount_cop) values ($1, $2, 25000) returning 1', [id, P.paseoSanti]),
      ).toBe(1);
    });
    await expect(
      as(db, U.santi, (tx) => tx.query(`insert into public.expense_items (expense_id, name, total_cop) values ($1, 'Colado', 1000)`, [GASTO_ASADERO])),
    ).rejects.toThrow(DENIED);
  });

  it('admin confirma, corrige y borra gastos', async () => {
    await as(db, U.laura, async (tx) => {
      expect(await count(tx, `update public.expenses set status = 'confirmed' where id = $1 returning 1`, [GASTO_ASADERO])).toBe(1);
      expect(await count(tx, `update public.expenses set merchant = 'Hostal Brisas' where id = $1 returning 1`, [GASTO_HOSTAL])).toBe(1);
      expect(await count(tx, 'delete from public.expenses where id = $1 returning 1', [GASTO_ASADERO])).toBe(1);
    });
  });

  it('owner edita gastos; el admin de otra cuenta no', async () => {
    await as(db, U.valeria, async (tx) => {
      expect(await count(tx, `update public.expenses set merchant = 'La Economía' where id = $1 returning 1`, [GASTO_CASA])).toBe(1);
    });
    await as(db, U.laura, async (tx) => {
      expect(await count(tx, `update public.expenses set merchant = 'Otro' where id = $1 returning 1`, [GASTO_CASA])).toBe(0);
    });
  });
});

describe('cuentas', () => {
  it('nadie crea cuentas con INSERT directo: solo por create_account', async () => {
    await expect(
      as(db, U.nuevo, (tx) => tx.query(`insert into public.accounts (name, type, owner_id) values ('Ilegal', 'hogar', $1)`, [U.nuevo])),
    ).rejects.toThrow(DENIED);
  });

  it('admin renombra la cuenta; member no', async () => {
    await as(db, U.laura, async (tx) => {
      expect(await count(tx, `update public.accounts set name = 'Paseo Santa Marta 2026' where id = $1 returning 1`, [PASEO])).toBe(1);
    });
    await as(db, U.santi, async (tx) => {
      expect(await count(tx, `update public.accounts set name = 'Mío' where id = $1 returning 1`, [PASEO])).toBe(0);
    });
  });

  it('admin no puede ponerse de dueño ni cerrar la cuenta por fuera del RPC', async () => {
    await expect(as(db, U.laura, (tx) => tx.query('update public.accounts set owner_id = $1 where id = $2', [U.laura, PASEO]))).rejects.toThrow(DENIED);
    await expect(as(db, U.laura, (tx) => tx.query(`update public.accounts set status = 'closed' where id = $1`, [PASEO]))).rejects.toThrow(DENIED);
  });

  it('solo el owner borra la cuenta', async () => {
    await as(db, U.laura, async (tx) => {
      expect(await count(tx, 'delete from public.accounts where id = $1 returning 1', [PASEO])).toBe(0);
    });
    await as(db, U.valeria, async (tx) => {
      expect(await count(tx, 'delete from public.accounts where id = $1 returning 1', [PASEO])).toBe(1);
    });
  });

  it('create_account deja al creador de owner, con su persona y 8 categorías', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { id } = await one<{ id: string }>(tx, `select public.create_account('Viaje a Medellín', 'evento', '2026-11-01', '2026-11-05', 'Pipe') as id`);
      expect(await one(tx, 'select role from public.account_members where account_id = $1 and user_id = auth.uid()', [id])).toEqual({ role: 'owner' });
      expect(await one(tx, 'select display_name, tone from public.people where account_id = $1 and claimed_by = auth.uid()', [id])).toEqual({
        display_name: 'Pipe',
        tone: 'morado',
      });
      const cats = await tx.query<{ name: string; tone: string }>('select name, tone from public.categories where account_id = $1 order by letter', [id]);
      expect(cats.rows).toHaveLength(8);
      expect(cats.rows).toContainEqual({ name: 'Hospedaje', tone: 'turquesa' });
      // El perfil sin nombre (entró con enlace mágico) toma el que escribió
      expect(await one(tx, 'select full_name from public.profiles where id = auth.uid()')).toEqual({ full_name: 'Pipe' });
    });
  });

  it('close_account: member no; admin sí, y revoca las invitaciones', async () => {
    await expect(as(db, U.santi, (tx) => tx.query('select public.close_account($1)', [PASEO]))).rejects.toThrow('No tienes permisos de administrador');
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.close_account($1)', [PASEO]);
      expect(await count(tx, 'select 1 from public.invitations where account_id = $1 and revoked_at is null', [PASEO])).toBe(0);
    });
  });
});

describe('personas', () => {
  it('admin agrega a alguien que solo está en WhatsApp; el tono se asigna solo', async () => {
    await as(db, U.laura, async (tx) => {
      const p = await one<{ tone: string }>(tx, `insert into public.people (account_id, display_name) values ($1, 'Pipe Ramírez') returning tone`, [PASEO]);
      expect(['morado', 'naranja', 'azul', 'coral', 'verde', 'amarillo', 'turquesa', 'rosa']).toContain(p.tone);
    });
  });

  it('los tonos no se repiten hasta agotar los 8', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { id } = await one<{ id: string }>(tx, `select public.create_account('Casa nueva', 'hogar', null, null, 'Yo') as id`);
      for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
        await tx.query('insert into public.people (account_id, display_name) values ($1, $2)', [id, n]);
      }
      const { rows } = await tx.query<{ tone: string }>('select distinct tone from public.people where account_id = $1', [id]);
      expect(rows).toHaveLength(8);
    });
  });

  it('member no agrega personas', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(`insert into public.people (account_id, display_name) values ($1, 'Colado')`, [PASEO]))).rejects.toThrow(
      DENIED,
    );
  });

  it('nadie reclama personas por fuera del RPC', async () => {
    await expect(as(db, U.laura, (tx) => tx.query('update public.people set claimed_by = $1 where id = $2', [U.laura, P.caro]))).rejects.toThrow(DENIED);
  });

  it('no se borra a una persona que ya tiene gastos (sus lucas no se pierden)', async () => {
    await expect(
      as(db, U.laura, async (tx) => {
        await tx.exec('set constraints all immediate'); // el FK es diferido: se revisa al confirmar
        await tx.query('delete from public.people where id = $1', [P.caro]);
      }),
    ).rejects.toThrow('foreign key');
  });

  it('a una persona con cuenta no se la borra (se la saca con remove_member)', async () => {
    await as(db, U.laura, async (tx) => {
      expect(await count(tx, 'delete from public.people where id = $1 returning 1', [P.paseoSanti])).toBe(0);
    });
  });
});

describe('roles', () => {
  const rol = (cuenta: string, usuario: string, r: string) => `select public.set_member_role('${cuenta}', '${usuario}', '${r}')`;
  const rolDe = async (usuario: string) =>
    as(db, U.valeria, (tx) => one<{ role: string }>(tx, 'select role from public.account_members where account_id = $1 and user_id = $2', [PASEO, usuario]));

  it('nadie le cambia el rol al owner', async () => {
    await expect(as(db, U.laura, (tx) => tx.query(rol(PASEO, U.valeria, 'member')))).rejects.toThrow('No se puede cambiar el rol del titular');
  });

  it('nadie se promueve a sí mismo', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(rol(PASEO, U.santi, 'admin')))).rejects.toThrow('No puedes cambiar tu propio rol');
  });

  it('nadie asigna el rol de owner', async () => {
    await expect(as(db, U.valeria, (tx) => tx.query(rol(PASEO, U.laura, 'owner')))).rejects.toThrow('No se puede asignar el rol de titular');
  });

  it('member no cambia roles', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(rol(PASEO, U.mafe, 'admin')))).rejects.toThrow('No tienes permisos de administrador');
  });

  it('nadie cambia roles con UPDATE directo (no hay política de UPDATE)', async () => {
    await as(db, U.valeria, async (tx) => {
      expect(await count(tx, `update public.account_members set role = 'admin' where user_id = $1 returning 1`, [U.santi])).toBe(0);
    });
  });

  it('admin nombra admins', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query(rol(PASEO, U.santi, 'admin'));
      expect(await one(tx, 'select role from public.account_members where account_id = $1 and user_id = $2', [PASEO, U.santi])).toEqual({ role: 'admin' });
    });
  });

  it('admin no le quita el rol a otro admin; el owner sí', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.query(rol(PASEO, U.mafe, 'admin'));
      await impersonate(tx, U.laura);
      await expect(tx.query(rol(PASEO, U.mafe, 'member'))).rejects.toThrow('Solo el titular de la cuenta puede quitarle el rol');
    });
    await as(db, U.valeria, async (tx) => {
      await tx.query(rol(PASEO, U.laura, 'member'));
      expect(await one(tx, 'select role from public.account_members where account_id = $1 and user_id = $2', [PASEO, U.laura])).toEqual({ role: 'member' });
    });
    expect(await rolDe(U.laura)).toEqual({ role: 'admin' }); // todo se deshizo
  });
});

describe('sacar y salir', () => {
  it('nadie saca al owner', async () => {
    await expect(as(db, U.laura, (tx) => tx.query('select public.remove_member($1, $2)', [PASEO, U.valeria]))).rejects.toThrow('No se puede sacar al titular');
  });

  it('admin saca a un member y su persona queda sin reclamar (sus gastos siguen)', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.remove_member($1, $2)', [PASEO, U.santi]);
      expect(await count(tx, 'select 1 from public.account_members where account_id = $1 and user_id = $2', [PASEO, U.santi])).toBe(0);
      expect(await one(tx, 'select claimed_by from public.people where id = $1', [P.paseoSanti])).toEqual({ claimed_by: null });
      expect(await count(tx, 'select 1 from public.expenses where payer_person_id = $1', [P.paseoSanti])).toBe(2);
    });
  });

  it('admin no saca a otro admin', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.query(`select public.set_member_role($1, $2, 'admin')`, [PASEO, U.mafe]);
      await impersonate(tx, U.laura);
      await expect(tx.query('select public.remove_member($1, $2)', [PASEO, U.mafe])).rejects.toThrow('Un administrador no puede sacar a otro');
    });
  });

  it('member no saca a nadie', async () => {
    await expect(as(db, U.santi, (tx) => tx.query('select public.remove_member($1, $2)', [PASEO, U.mafe]))).rejects.toThrow(
      'No tienes permisos de administrador',
    );
  });

  it('member se sale; el owner no puede', async () => {
    await as(db, U.santi, async (tx) => {
      await tx.query('select public.leave_account($1)', [PASEO]);
      expect(await count(tx, 'select 1 from public.accounts where id = $1', [PASEO])).toBe(0);
    });
    await expect(as(db, U.valeria, (tx) => tx.query('select public.leave_account($1)', [PASEO]))).rejects.toThrow('El titular no puede salirse');
  });
});

describe('invitaciones', () => {
  it('el prefijo sale de la primera palabra del nombre', async () => {
    const { rows } = await db.query<{ p: string }>(
      `select public.invitation_prefix(n) as p from unnest(array['Paseo Santa Marta', 'Mi casa', 'Apto 402 · arriendo', 'Ñoño', 'Yo', 'Cumpleañero extraordinario']) n`,
    );
    expect(rows.map((r) => r.p)).toEqual(['PASEO', 'CASA', 'APTO', 'NONO', 'LUCAS', 'CUMPLEAN']);
  });

  it('admin crea códigos tipo PASEO-7K2Q; member no', async () => {
    await as(db, U.laura, async (tx) => {
      const { code } = await one<{ code: string }>(tx, `select public.create_invitation($1, 'member', now() + interval '7 days', 10) as code`, [PASEO]);
      expect(code).toMatch(/^PASEO-[A-HJKMNP-Z2-9]{4}$/);
    });
    await expect(as(db, U.santi, (tx) => tx.query('select public.create_invitation($1)', [PASEO]))).rejects.toThrow('No tienes permisos de administrador');
  });

  it('no se crean invitaciones vencidas ni para ser owner', async () => {
    await expect(as(db, U.laura, (tx) => tx.query(`select public.create_invitation($1, 'member', now() - interval '1 day')`, [PASEO]))).rejects.toThrow(
      'ya pasó',
    );
    await expect(as(db, U.laura, (tx) => tx.query(`select public.create_invitation($1, 'owner')`, [PASEO]))).rejects.toThrow('rol de titular');
  });

  it('member no revoca invitaciones; admin sí', async () => {
    const id = 'a0000000-0000-4000-8000-000000000001';
    await expect(as(db, U.santi, (tx) => tx.query('select public.revoke_invitation($1)', [id]))).rejects.toThrow('No tienes permisos de administrador');
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.revoke_invitation($1)', [id]);
      await impersonate(tx, U.nuevo);
      await expect(tx.query(`select public.preview_invitation('PASEO-7K2Q')`)).rejects.toThrow('ya no sirve');
    });
  });
});

describe('unirse con código', () => {
  it('la vista previa muestra la cuenta y quiénes faltan por reclamar', async () => {
    const vista = await as(
      db,
      U.nuevo,
      async (tx) => (await one<{ v: Record<string, unknown> }>(tx, `select public.preview_invitation(' paseo-7k2q ') as v`)).v,
    );
    expect(vista).toMatchObject({
      account_name: 'Paseo Santa Marta',
      account_type: 'evento',
      owner_name: 'Valeria',
      role: 'member',
      already_member: false,
      people_count: 8,
    });
    expect((vista.unclaimed_people as { display_name: string; wa_last4: string }[]).map((p) => [p.display_name, p.wa_last4])).toEqual([
      ['Caro', '4471'],
      ['Felipe', '0918'],
    ]);
  });

  it('un código que no existe falla', async () => {
    await expect(as(db, U.nuevo, (tx) => tx.query(`select public.preview_invitation('PASEO-XXXX')`))).rejects.toThrow('no existe');
    await expect(as(db, U.nuevo, (tx) => tx.query(`select public.join_with_code('PASEO-XXXX', null, 'Yo')`))).rejects.toThrow('no válido');
  });

  it('entrar como Caro: queda reclamada, con membresía member, y suma un uso', async () => {
    await as(db, U.nuevo, async (tx) => {
      expect(await one(tx, `select public.join_with_code('PASEO-7K2Q', $1) as id`, [P.caro])).toEqual({ id: PASEO });
      expect(await one(tx, 'select role, person_id from public.account_members where account_id = $1 and user_id = auth.uid()', [PASEO])).toEqual({
        role: 'member',
        person_id: P.caro,
      });
      expect(await one(tx, 'select full_name from public.profiles where id = auth.uid()')).toEqual({ full_name: 'Caro' });
      expect(await one(tx, `select (public.preview_invitation('PASEO-7K2Q') ->> 'already_member')::boolean as ya`)).toEqual({ ya: true });
      await impersonate(tx, U.valeria);
      expect(await one(tx, `select uses from public.invitations where code = 'PASEO-7K2Q'`)).toEqual({ uses: 7 });
    });
  });

  it('entrar como persona nueva exige un nombre', async () => {
    await expect(as(db, U.nuevo, (tx) => tx.query(`select public.join_with_code('PASEO-7K2Q')`))).rejects.toThrow('Escribe tu nombre');
    await as(db, U.nuevo, async (tx) => {
      await tx.query(`select public.join_with_code('PASEO-7K2Q', null, 'Pipe Ramírez')`);
      expect(await count(tx, `select 1 from public.people where account_id = $1 and display_name = 'Pipe Ramírez' and claimed_by = auth.uid()`, [PASEO])).toBe(
        1,
      );
    });
  });

  it('no se reclama a alguien que ya tiene cuenta ni a alguien de otra cuenta', async () => {
    await expect(as(db, U.nuevo, (tx) => tx.query(`select public.join_with_code('PASEO-7K2Q', $1)`, [P.paseoValeria]))).rejects.toThrow('ya fue reclamada');
    await expect(as(db, U.nuevo, (tx) => tx.query(`select public.join_with_code('PASEO-7K2Q', $1)`, [P.casaValeria]))).rejects.toThrow(
      'no pertenece a esta cuenta',
    );
  });

  it('nadie se une dos veces', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(`select public.join_with_code('PASEO-7K2Q', null, 'Santi')`))).rejects.toThrow('Ya eres miembro');
  });

  it('códigos vencidos, agotados o revocados fallan', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into public.invitations (account_id, code, expires_at, created_by) values ($1, 'PASEO-VENC', now() - interval '1 day', $2)`, [
        PASEO,
        U.valeria,
      ]);
      await impersonate(tx, U.nuevo);
      await expect(tx.query(`select public.join_with_code('PASEO-VENC', null, 'Yo')`)).rejects.toThrow('vencida');
    });
    await as(db, U.valeria, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into public.invitations (account_id, code, max_uses, uses, created_by) values ($1, 'PASEO-LLNO', 3, 3, $2)`, [PASEO, U.valeria]);
      await impersonate(tx, U.nuevo);
      await expect(tx.query(`select public.join_with_code('PASEO-LLNO', null, 'Yo')`)).rejects.toThrow('máximo de usos');
    });
    await expect(as(db, U.nuevo, (tx) => tx.query(`select public.join_with_code('PASEO-3HWD', null, 'Yo')`))).rejects.toThrow('revocada');
  });

  it('la invitación de admin deja entrar como admin', async () => {
    await as(db, U.valeria, async (tx) => {
      const { code } = await one<{ code: string }>(tx, `select public.create_invitation($1, 'admin') as code`, [PASEO]);
      await impersonate(tx, U.otro);
      await tx.query('select public.join_with_code($1, null, $2)', [code, 'Pipe']);
      expect(await one(tx, 'select role from public.account_members where account_id = $1 and user_id = auth.uid()', [PASEO])).toEqual({ role: 'admin' });
    });
  });
});

describe('reclamar persona después de entrar', () => {
  it('quien entró como persona nueva (sin gastos) pasa a ser Felipe', async () => {
    await as(db, U.nuevo, async (tx) => {
      await tx.query(`select public.join_with_code('PASEO-7K2Q', null, 'Pipe')`);
      await tx.query('select public.claim_person($1)', [P.felipe]);
      expect(await one(tx, 'select person_id from public.account_members where account_id = $1 and user_id = auth.uid()', [PASEO])).toEqual({
        person_id: P.felipe,
      });
      expect(await count(tx, `select 1 from public.people where account_id = $1 and display_name = 'Pipe'`, [PASEO])).toBe(0);
    });
  });

  it('no se reclama a alguien ya reclamado, ni desde fuera de la cuenta', async () => {
    await expect(as(db, U.santi, (tx) => tx.query('select public.claim_person($1)', [P.paseoValeria]))).rejects.toThrow('ya fue reclamada');
    await expect(as(db, U.nuevo, (tx) => tx.query('select public.claim_person($1)', [P.felipe]))).rejects.toThrow('No eres miembro');
  });

  it('si tu persona ya tiene gastos, toca unirlas a mano', async () => {
    await expect(as(db, U.santi, (tx) => tx.query('select public.claim_person($1)', [P.felipe]))).rejects.toThrow('ya tiene gastos');
  });
});

describe('perfil', () => {
  it('cada quien edita su perfil y no el de otros', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await count(tx, `update public.profiles set full_name = 'Santiago Herrera' where id = auth.uid() returning 1`)).toBe(1);
      expect(await count(tx, `update public.profiles set full_name = 'Hackeada' where id = $1 returning 1`, [U.valeria])).toBe(0);
    });
  });
});

describe('lecturas para las pantallas', () => {
  it('account_people: 8 personas del paseo con rol, gastos pagados y correcciones', async () => {
    const { rows } = await as(db, U.santi, (tx) =>
      tx.query<{ display_name: string; role: string | null; paid_count: number; corrections_count: number; is_me: boolean }>(
        'select display_name, role, paid_count, corrections_count, is_me from public.account_people($1) order by display_name',
        [PASEO],
      ),
    );
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.display_name === 'Mafe')).toMatchObject({ role: 'member', corrections_count: 4 });
    expect(rows.find((r) => r.display_name === 'Caro')).toMatchObject({ role: null, paid_count: 3 });
    expect(rows.find((r) => r.display_name === 'Santi')).toMatchObject({ is_me: true });
  });

  it('account_people de una cuenta ajena sale vacío', async () => {
    const { rows } = await as(db, U.santi, (tx) => tx.query('select * from public.account_people($1)', [CASA]));
    expect(rows).toEqual([]);
  });
});
