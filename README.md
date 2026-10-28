# Ideas UKU

Zettelkasten colectivo: reflexiones privadas → ideas públicas y anónimas → mapa de conexiones.

- **Frontend:** HTML + JS sin compilación, en `web/`, publicado por Netlify.
- **Base de datos y login:** Supabase (región São Paulo), enlace mágico y Row Level Security.
- **IA:** Netlify Functions que llaman a la API de Claude; la clave nunca llega al navegador.

## Base de datos

El esquema está en [`supabase/001_esquema.sql`](supabase/001_esquema.sql).
Para instalarlo: Supabase → **SQL Editor** → **New query** → pegar el archivo completo → **Run**.
Se ejecuta una sola vez en un proyecto nuevo. Después, en orden y una sola vez cada uno:

1. `001_esquema.sql` — tablas, seguridad y vistas públicas
2. `002_ideas_permanentes.sql` — las ideas públicas no se borran; si alguien borra su cuenta, quedan sin autor
3. `003_limite_ia.sql` — límite diario de uso de la IA por persona

## Futuro: Airtable

La tabla `fuentes` tiene una columna `airtable_id` para sincronizarla más adelante
con la base de Airtable (desde una Netlify Function con la clave secreta).

## Estructura

```
web/                      páginas (HTML + JS sin compilación)
  index.html              acceso por enlace mágico + aceptar política
  escribir.html           pantalla 1 (fuente + reflexión) y 2 (elegir ideas)
  mapa.html               grafo de ideas y conexiones, filtro por fuente, temas
  mis-reflexiones.html    textos completos propios e ideas publicadas
  js/config.js            URL y clave pública de Supabase
  vendor/                 supabase-js y force-graph (copias locales)
netlify/functions/        proponer-ideas, sugerir-tema (llaman a Claude)
netlify/lib/              utilidades compartidas de las funciones
supabase/                 archivos SQL
```

## Variables de entorno en Netlify

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | clave de console.anthropic.com |
| `SUPABASE_URL` | `https://cikzmmsegzyezkqeuchi.supabase.co` |
| `SUPABASE_SECRET_KEY` | clave secreta de Supabase (Project Settings → API Keys) |
