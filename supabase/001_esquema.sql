-- =====================================================================
-- Ideas UKU · esquema v1
-- Pegar completo en Supabase → SQL Editor → Run (una sola vez).
-- =====================================================================

-- ---------- Tipos ----------
create type public.tipo_fuente as enum ('evento', 'lectura', 'otra');

-- ---------- Tablas ----------
create table public.perfiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  correo              text not null,
  nombre              text check (length(nombre) <= 80),
  cumpleanos          date,
  acepto_politica_en  timestamptz not null default now(),
  version_politica    text not null,
  creado_en           timestamptz not null default now()
);

create table public.fuentes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(trim(nombre)) between 1 and 200),
  tipo       public.tipo_fuente not null,
  fecha      date,
  -- Para sincronizar en el futuro con Airtable (id del registro, p. ej. "recXXXX")
  airtable_id text unique,
  creado_en  timestamptz not null default now()
);
create unique index fuentes_sin_duplicados
  on public.fuentes (lower(trim(nombre)), tipo, fecha);

create table public.textos_brutos (
  id          uuid primary key default gen_random_uuid(),
  autor_id    uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  fuente_id   uuid not null references public.fuentes(id),
  texto       text not null check (length(texto) between 1 and 50000),
  creado_en   timestamptz not null default now(),
  editado_en  timestamptz
);

create table public.ideas (
  id                  uuid primary key default gen_random_uuid(),
  autor_id            uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  fuente_id           uuid not null references public.fuentes(id),
  texto_bruto_id      uuid references public.textos_brutos(id) on delete set null,
  texto               text not null check (length(trim(texto)) between 1 and 1000),
  frases_originales   text[] not null default '{}',
  permite_conexiones  boolean not null default true,
  creado_en           timestamptz not null default now(),
  editado_en          timestamptz
);

create table public.conexiones (
  id          uuid primary key default gen_random_uuid(),
  idea_a      uuid not null references public.ideas(id) on delete cascade,
  idea_b      uuid not null references public.ideas(id) on delete cascade,
  relacion    text not null check (length(trim(relacion)) between 1 and 120),
  creado_por  uuid default auth.uid() references public.perfiles(id) on delete set null,
  creado_en   timestamptz not null default now(),
  check (idea_a <> idea_b)
);
create unique index conexiones_sin_duplicados
  on public.conexiones (least(idea_a, idea_b), greatest(idea_a, idea_b), lower(trim(relacion)));

-- Los temas solo los escribe la Netlify Function (clave secreta, salta RLS).
create table public.temas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  creado_en  timestamptz not null default now()
);

create table public.temas_ideas (
  tema_id  uuid not null references public.temas(id) on delete cascade,
  idea_id  uuid not null references public.ideas(id) on delete cascade,
  primary key (tema_id, idea_id)
);

create index on public.textos_brutos (autor_id);
create index on public.ideas (autor_id);
create index on public.ideas (fuente_id);
create index on public.conexiones (idea_a);
create index on public.conexiones (idea_b);

-- ---------- Funciones auxiliares ----------
-- ¿La persona actual tiene perfil (y por tanto aceptó la política)?
create function public.es_miembro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles where id = auth.uid());
$$;

-- ¿Esta idea admite conexiones? (security definer: la tabla ideas solo deja ver las propias)
create function public.puede_conectar(p_idea uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ideas where id = p_idea and permite_conexiones);
$$;

-- Activar o desactivar conexiones en una idea propia, en cualquier momento
-- (la política de datos lo promete; el resto de la idea se fija a los 7 días).
create function public.cambiar_permite_conexiones(p_idea uuid, p_valor boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.ideas set permite_conexiones = p_valor
   where id = p_idea and autor_id = auth.uid();
  if not found then
    raise exception 'Idea no encontrada o no es tuya';
  end if;
end $$;
revoke execute on function public.cambiar_permite_conexiones(uuid, boolean) from public, anon;
grant execute on function public.cambiar_permite_conexiones(uuid, boolean) to authenticated;

-- ---------- Triggers: nadie puede falsear autor, fechas ni origen ----------
create function public.perfiles_antes_de_guardar() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.correo := coalesce(auth.jwt() ->> 'email', new.correo);
  if tg_op = 'INSERT' then
    new.id := auth.uid();
    new.acepto_politica_en := now();
    new.creado_en := now();
  else
    new.id := old.id;
    new.acepto_politica_en := old.acepto_politica_en;
    new.version_politica := old.version_politica;
    new.creado_en := old.creado_en;
  end if;
  return new;
end $$;

create function public.textos_antes_de_guardar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.autor_id := auth.uid();
    new.creado_en := now();
    new.editado_en := null;
  else
    new.autor_id := old.autor_id;
    new.fuente_id := old.fuente_id;
    new.creado_en := old.creado_en;
    new.editado_en := now();
  end if;
  return new;
end $$;

create function public.ideas_antes_de_guardar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.autor_id := auth.uid();
    new.creado_en := now();
    new.editado_en := null;
    if new.texto_bruto_id is not null then
      select tb.fuente_id into new.fuente_id
        from public.textos_brutos tb
       where tb.id = new.texto_bruto_id and tb.autor_id = auth.uid();
      if not found then
        raise exception 'El texto de origen no existe o no es tuyo';
      end if;
    end if;
  else
    new.autor_id := old.autor_id;
    new.fuente_id := old.fuente_id;
    new.creado_en := old.creado_en;
    -- solo se permite pasar a null (cuando el autor borra su texto bruto)
    if new.texto_bruto_id is not null then
      new.texto_bruto_id := old.texto_bruto_id;
    end if;
    if new.texto is distinct from old.texto
       or new.frases_originales is distinct from old.frases_originales
       or new.permite_conexiones is distinct from old.permite_conexiones then
      new.editado_en := now();
    end if;
  end if;
  return new;
end $$;

create function public.conexiones_antes_de_guardar() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.creado_por := auth.uid();
  new.creado_en := now();
  return new;
end $$;

create trigger perfiles_bi before insert or update on public.perfiles
  for each row execute function public.perfiles_antes_de_guardar();
create trigger textos_bi before insert or update on public.textos_brutos
  for each row execute function public.textos_antes_de_guardar();
create trigger ideas_bi before insert or update on public.ideas
  for each row execute function public.ideas_antes_de_guardar();
create trigger conexiones_bi before insert on public.conexiones
  for each row execute function public.conexiones_antes_de_guardar();

-- ---------- Row Level Security ----------
alter table public.perfiles      enable row level security;
alter table public.fuentes       enable row level security;
alter table public.textos_brutos enable row level security;
alter table public.ideas         enable row level security;
alter table public.conexiones    enable row level security;
alter table public.temas         enable row level security;
alter table public.temas_ideas   enable row level security;

-- perfiles: cada quien solo ve y edita el suyo
create policy perfiles_ver    on public.perfiles for select to authenticated using (id = auth.uid());
create policy perfiles_crear  on public.perfiles for insert to authenticated with check (id = auth.uid());
create policy perfiles_editar on public.perfiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- fuentes: visibles para todos los miembros; cualquiera puede crear
create policy fuentes_ver   on public.fuentes for select to authenticated using (public.es_miembro());
create policy fuentes_crear on public.fuentes for insert to authenticated with check (public.es_miembro());

-- textos_brutos: solo el autor. Editar: 7 días. Borrar: siempre (es su dato privado).
create policy textos_ver    on public.textos_brutos for select to authenticated using (autor_id = auth.uid());
create policy textos_crear  on public.textos_brutos for insert to authenticated
  with check (autor_id = auth.uid() and public.es_miembro());
create policy textos_editar on public.textos_brutos for update to authenticated
  using (autor_id = auth.uid() and creado_en > now() - interval '7 days')
  with check (autor_id = auth.uid());
create policy textos_borrar on public.textos_brutos for delete to authenticated
  using (autor_id = auth.uid());

-- ideas (tabla base): el autor ve las suyas; el público usa la vista ideas_publicas
create policy ideas_ver    on public.ideas for select to authenticated using (autor_id = auth.uid());
create policy ideas_crear  on public.ideas for insert to authenticated
  with check (autor_id = auth.uid() and public.es_miembro());
create policy ideas_editar on public.ideas for update to authenticated
  using (autor_id = auth.uid() and creado_en > now() - interval '7 days')
  with check (autor_id = auth.uid());
create policy ideas_borrar on public.ideas for delete to authenticated
  using (autor_id = auth.uid() and creado_en > now() - interval '7 days');

-- conexiones: en cualquier momento, si ambas ideas lo permiten; cada quien borra las suyas
create policy conexiones_ver   on public.conexiones for select to authenticated using (creado_por = auth.uid());
create policy conexiones_crear on public.conexiones for insert to authenticated
  with check (creado_por = auth.uid() and public.es_miembro()
              and public.puede_conectar(idea_a) and public.puede_conectar(idea_b));
create policy conexiones_borrar on public.conexiones for delete to authenticated
  using (creado_por = auth.uid());

-- temas: lectura para miembros; escritura solo desde el servidor
create policy temas_ver       on public.temas       for select to authenticated using (public.es_miembro());
create policy temas_ideas_ver on public.temas_ideas for select to authenticated using (public.es_miembro());

-- ---------- Vistas públicas (sin autor, sin texto de origen) ----------
-- Se ejecutan con permisos del dueño (saltan RLS) a propósito, y solo exponen
-- columnas seguras. es_mia solo dice "true" a la propia persona.
create view public.ideas_publicas with (security_invoker = false) as
select i.id,
       i.texto,
       i.frases_originales,
       i.fuente_id,
       i.permite_conexiones,
       i.creado_en::date        as fecha,
       (i.autor_id = auth.uid()) as es_mia
  from public.ideas i
 where public.es_miembro();

create view public.conexiones_publicas with (security_invoker = false) as
select c.id,
       c.idea_a,
       c.idea_b,
       c.relacion,
       c.creado_en::date           as fecha,
       (c.creado_por = auth.uid()) as es_mia
  from public.conexiones c
 where public.es_miembro();

-- Las vistas simples son "actualizables": hay que quitar todo excepto SELECT,
-- o alguien podría editar ideas ajenas a través de la vista.
revoke all on public.ideas_publicas      from anon, authenticated;
revoke all on public.conexiones_publicas from anon, authenticated;
grant select on public.ideas_publicas      to authenticated;
grant select on public.conexiones_publicas to authenticated;
