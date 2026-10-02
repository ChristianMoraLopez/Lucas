-- ============================================================================
-- Lucas · 00000000000110_categorias_nuevas.sql
-- Más categorías de siempre para que Laya tenga dónde poner cada gasto:
-- Salud, Belleza, Ocio, Mascotas, Educación, Ropa, Hogar, Deporte y Regalos,
-- además de las 8 de antes. Licor queda para el trago que se compra (estanco,
-- licorera) y la rumba (bares, discotecas) pasa a Ocio.
--
--   · default_categories(): la lista única (nombre, letra, tono, descripción)
--   · add_default_categories(cuenta): agrega las que falten; si la cuenta ya
--     tenía una propia con ese nombre («salud», «Educacion»), esa pasa a ser
--     la de siempre, con sus gastos y su descripción
--   · create_account usa la lista y las cuentas que ya existen la reciben
--   · las descripciones de siempre que nadie cambió se actualizan
-- Mismos nombres, letras, tonos y descripciones que el worker
-- (classify/categories.py) y la web (components/lucas-core.ts).
-- ============================================================================

create or replace function public.default_categories()
returns table (name text, letter text, tone public.tone, description text, "position" int)
language sql
immutable
set search_path = ''
as $$
  select d.name, d.letter, d.tone::public.tone, d.description, d.position::int
  from (values
    (1, 'Transporte', 'T', 'azul', 'taxis, Uber, DiDi, InDrive, buses, TransMilenio, SITP, metro, lanchas, peajes, gasolina, parqueaderos, vuelos, SOAT, taller del carro'),
    (2, 'Hospedaje', 'H', 'turquesa', 'hoteles, hostales, cabañas, Airbnb, glamping, fincas de alquiler'),
    (3, 'Restaurante', 'R', 'coral', 'restaurantes, almuerzos, cenas, comidas rápidas, domicilios de comida'),
    (4, 'Café', 'C', 'naranja', 'cafeterías, panaderías, pastelerías, tinto, pandebono, onces'),
    (5, 'Mercado', 'M', 'verde', 'mercado, supermercados, tiendas de barrio, fruver, carnicería, aseo del hogar'),
    (6, 'Licor', 'L', 'morado', 'trago para llevar: estancos, licoreras, cerveza, aguardiente, ron, vino, whisky'),
    (7, 'Ocio', 'O', 'azul', 'rumba y entretenimiento: bares, discotecas, conciertos, cine, Netflix, Spotify, videojuegos, weed, cigarrillos, vape, tejo'),
    (8, 'Salud', 'S', 'verde', 'droguería, medicamentos, EPS, medicina prepagada (Colsanitas, Sura, Compensar), vales de salud, citas médicas, odontólogo, exámenes, óptica'),
    (9, 'Belleza', 'B', 'rosa', 'cuidado personal: cremas, maquillaje, perfumes, peluquería, barbería, manicure, depilación, spa'),
    (10, 'Servicios', 'S', 'amarillo', 'servicios públicos y fijos: luz, agua, gas, internet, plan de celular, administración, arriendo'),
    (11, 'Hogar', 'H', 'amarillo', 'cosas para la casa: muebles, electrodomésticos, ferretería, decoración, arreglos, tecnología'),
    (12, 'Mascotas', 'M', 'naranja', 'veterinaria, concentrado, comida y arena para perro o gato, peluquería canina, juguetes'),
    (13, 'Educación', 'E', 'morado', 'colegio, universidad, matrícula, pensión, cursos, libros, útiles, idiomas'),
    (14, 'Ropa', 'R', 'turquesa', 'ropa, zapatos, tenis, accesorios, bolsos'),
    (15, 'Deporte', 'D', 'coral', 'gimnasio, canchas, clases, implementos deportivos, bicicleta'),
    (16, 'Regalos', 'R', 'rosa', 'regalos, detalles, cumpleaños, amigo secreto, flores, anchetas'),
    (17, 'Otros', 'O', 'rosa', 'todo lo demás que no cabe en otra categoría')
  ) as d (position, name, letter, tone, description)
  order by d.position
$$;

-- Las descripciones de siempre que siguen como venían (090) pasan a las nuevas;
-- las que alguien cambió desde la web se respetan.
update public.categories c
set description = d.description
from public.default_categories() d
where c.is_default and c.name = d.name
  and (c.description is null or c.description = public.default_category_description(c.name));

create or replace function public.default_category_description(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select d.description from public.default_categories() d where d.name = p_name
$$;

-- Agrega a una cuenta las categorías de siempre que le falten. Una propia con
-- el mismo nombre (sin importar mayúsculas ni tildes) se vuelve la de siempre.
create or replace function public.add_default_categories(p_account_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nuevas int;
begin
  update public.categories c
  set name = d.name,
      is_default = true,
      description = coalesce(nullif(btrim(c.description), ''), d.description)
  from public.default_categories() d
  where c.account_id = p_account_id
    and public.normalize_merchant(c.name) = public.normalize_merchant(d.name)
    and (not c.is_default or c.name <> d.name);

  insert into public.categories (account_id, name, letter, tone, description, is_default)
  select p_account_id, d.name, d.letter, d.tone, d.description, true
  from public.default_categories() d
  where not exists (
    select 1 from public.categories c
    where c.account_id = p_account_id and public.normalize_merchant(c.name) = public.normalize_merchant(d.name)
  )
  order by d.position;
  get diagnostics v_nuevas = row_count;
  return v_nuevas;
end;
$$;

create or replace function public.create_account(
  p_name text,
  p_type public.account_type,
  p_starts_on date default null,
  p_ends_on date default null,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_account_id uuid;
  v_person_id uuid;
  v_nombre text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para crear una cuenta';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Ponle un nombre a la cuenta';
  end if;
  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'La fecha de fin no puede ser antes de la de inicio';
  end if;

  insert into public.accounts (name, type, owner_id, starts_on, ends_on)
  values (
    trim(p_name),
    p_type,
    v_uid,
    case when p_type = 'evento' then p_starts_on end,
    case when p_type = 'evento' then p_ends_on end
  )
  returning id into v_account_id;

  select nullif(trim(pf.full_name), '') into v_nombre
  from public.profiles pf
  where pf.id = v_uid;
  v_nombre := coalesce(nullif(trim(p_display_name), ''), v_nombre, 'Yo');
  perform public.fill_my_profile_name(p_display_name);

  insert into public.people (account_id, display_name, claimed_by)
  values (v_account_id, v_nombre, v_uid)
  returning id into v_person_id;

  insert into public.account_members (account_id, user_id, role, person_id)
  values (v_account_id, v_uid, 'owner', v_person_id);

  perform public.add_default_categories(v_account_id);

  return v_account_id;
end;
$$;

-- Las cuentas que ya existen
select public.add_default_categories(a.id) from public.accounts a;

revoke execute on function public.default_categories() from public, anon;
revoke execute on function public.add_default_categories(uuid) from public, anon, authenticated;
grant execute on function public.default_categories() to authenticated, service_role;
grant execute on function public.add_default_categories(uuid) to service_role;
revoke execute on function public.create_account(text, public.account_type, date, date, text) from public, anon;
grant execute on function public.create_account(text, public.account_type, date, date, text) to authenticated;
