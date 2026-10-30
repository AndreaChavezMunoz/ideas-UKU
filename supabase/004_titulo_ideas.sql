-- =====================================================================
-- Ideas UKU · cambio 004: cada idea tiene un título (su "mega resumen")
-- Ejecutar DESPUÉS de 003 (SQL Editor → New query → Run).
-- =====================================================================

alter table public.ideas add column titulo text;
-- Ideas que ya existían: el título empieza siendo el inicio de su texto
update public.ideas set titulo = left(texto, 80) where titulo is null;
alter table public.ideas alter column titulo set not null;
alter table public.ideas add constraint ideas_titulo_largo
  check (length(trim(titulo)) between 1 and 120);

-- Las ideas coherentes (premisa, propósito, desarrollo, conclusión) son más largas
alter table public.ideas drop constraint ideas_texto_check;
alter table public.ideas add constraint ideas_texto_check
  check (length(trim(texto)) between 1 and 2000);

-- Editar el título también cuenta como edición
create or replace function public.ideas_antes_de_guardar() returns trigger
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
    -- autor y texto de origen solo pueden pasar a null (cuenta o texto borrados)
    if new.autor_id is not null then
      new.autor_id := old.autor_id;
    end if;
    if new.texto_bruto_id is not null then
      new.texto_bruto_id := old.texto_bruto_id;
    end if;
    new.fuente_id := old.fuente_id;
    new.creado_en := old.creado_en;
    if new.titulo is distinct from old.titulo
       or new.texto is distinct from old.texto
       or new.frases_originales is distinct from old.frases_originales
       or new.permite_conexiones is distinct from old.permite_conexiones then
      new.editado_en := now();
    end if;
  end if;
  return new;
end $$;

-- La vista pública ahora incluye el título (al final, para no romper la vista)
create or replace view public.ideas_publicas with (security_invoker = false) as
select i.id,
       i.texto,
       i.frases_originales,
       i.fuente_id,
       i.permite_conexiones,
       i.creado_en::date                          as fecha,
       coalesce(i.autor_id = auth.uid(), false)   as es_mia,
       i.titulo
  from public.ideas i
 where public.es_miembro();
