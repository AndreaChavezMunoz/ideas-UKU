# Ideas UKU

Zettelkasten colectivo: reflexiones privadas → ideas públicas y anónimas → mapa de conexiones.

- **Frontend:** HTML + JS sin compilación, en `web/`, publicado por Netlify.
- **Base de datos y login:** Supabase (región São Paulo), enlace mágico y Row Level Security.
- **IA:** Netlify Functions que llaman a la API de Claude; la clave nunca llega al navegador.

## Base de datos

El esquema está en [`supabase/001_esquema.sql`](supabase/001_esquema.sql).
Para instalarlo: Supabase → **SQL Editor** → **New query** → pegar el archivo completo → **Run**.
Se ejecuta una sola vez en un proyecto nuevo.

## Futuro: Airtable

La tabla `fuentes` tiene una columna `airtable_id` para sincronizarla más adelante
con la base de Airtable (desde una Netlify Function con la clave secreta).
