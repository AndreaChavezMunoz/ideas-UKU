-- =====================================================================
-- Ideas UKU · cambio 003: límite diario de uso de la IA por persona
-- Ejecutar DESPUÉS de 002 (SQL Editor → New query → Run).
-- Solo la Netlify Function (clave secreta) lee y escribe esta tabla.
-- =====================================================================

create table public.uso_ia (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  accion      text not null,
  creado_en   timestamptz not null default now()
);
create index on public.uso_ia (usuario_id, creado_en);

-- RLS activado y sin políticas: nadie desde el navegador puede verla.
alter table public.uso_ia enable row level security;
