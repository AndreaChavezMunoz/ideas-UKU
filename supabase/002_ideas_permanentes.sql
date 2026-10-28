-- =====================================================================
-- Ideas UKU · cambio 002: las ideas públicas no se borran
-- Ejecutar DESPUÉS de 001_esquema.sql (SQL Editor → New query → Run).
--
-- - Nadie puede borrar una idea publicada (ni el autor).
-- - Si una persona borra su cuenta, sus ideas se quedan en el mapa sin autor.
-- - Si borra su texto bruto, sus ideas también se quedan (ya era así).
-- =====================================================================

drop policy ideas_borrar on public.ideas;

alter table public.ideas alter column autor_id drop not null;
alter table public.ideas drop constraint ideas_autor_id_fkey;
alter table public.ideas add constraint ideas_autor_id_fkey
  foreign key (autor_id) references public.perfiles(id) on delete set null;

-- El trigger debe dejar que autor_id pase a null al borrarse una cuenta.
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
    if new.texto is distinct from old.texto
       or new.frases_originales is distinct from old.frases_originales
       or new.permite_conexiones is distinct from old.permite_conexiones then
      new.editado_en := now();
    end if;
  end if;
  return new;
end $$;

create or replace view public.ideas_publicas with (security_invoker = false) as
select i.id,
       i.texto,
       i.frases_originales,
       i.fuente_id,
       i.permite_conexiones,
       i.creado_en::date                          as fecha,
       coalesce(i.autor_id = auth.uid(), false)   as es_mia
  from public.ideas i
 where public.es_miembro();
