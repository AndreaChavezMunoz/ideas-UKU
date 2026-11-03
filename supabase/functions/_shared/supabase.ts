// Acceso a la base de datos desde el servidor con la clave de servicio (salta RLS).
// Supabase la entrega automáticamente a las Edge Functions; nunca llega al navegador.

const URL_BASE = Deno.env.get('SUPABASE_URL')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(datos: unknown, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function rest(ruta: string, { method = 'GET', body, prefer }: { method?: string; body?: unknown; prefer?: string } = {}) {
  const headers: Record<string, string> = {
    apikey: SERVICIO,
    Authorization: `Bearer ${SERVICIO}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${ruta}: ${res.status} ${await res.text()}`);
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

// Devuelve el id de la persona si el token es válido y tiene perfil; si no, null.
export async function usuarioDeLaPeticion(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: SERVICIO, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const { id } = await res.json();
  if (!id) return null;
  const perfil = await rest(`perfiles?id=eq.${id}&select=id`);
  return perfil.length ? id : null;
}

// Registra un uso de IA y dice si la persona superó el límite de las últimas 24 h.
export async function superaLimite(usuarioId: string, accion: string, maximo: number) {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const usos = await rest(
    `uso_ia?usuario_id=eq.${usuarioId}&accion=eq.${accion}&creado_en=gte.${desde}&select=id`,
  );
  if (usos.length >= maximo) return true;
  await rest('uso_ia', { method: 'POST', body: { usuario_id: usuarioId, accion } });
  return false;
}
