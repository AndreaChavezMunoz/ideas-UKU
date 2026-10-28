// Acceso a Supabase desde el servidor con la clave secreta (salta RLS).
// Nunca se usa en el navegador.

const URL_BASE = process.env.SUPABASE_URL;
const SECRETA = process.env.SUPABASE_SECRET_KEY;

function cabeceras(extra = {}) {
  const h = { apikey: SECRETA, 'Content-Type': 'application/json', ...extra };
  // Las claves antiguas (service_role) son JWT y también van en Authorization
  if (SECRETA?.startsWith('eyJ')) h.Authorization = `Bearer ${SECRETA}`;
  return h;
}

export async function rest(ruta, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    method,
    headers: cabeceras(prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${ruta}: ${res.status} ${await res.text()}`);
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

// Devuelve el id de la persona si el token es válido y tiene perfil; si no, null.
export async function usuarioDeLaPeticion(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: SECRETA, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const { id } = await res.json();
  const perfil = await rest(`perfiles?id=eq.${id}&select=id`);
  return perfil.length ? id : null;
}

// Registra un uso de IA y dice si la persona superó el límite de las últimas 24 h.
export async function superaLimite(usuarioId, accion, maximo) {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const usos = await rest(
    `uso_ia?usuario_id=eq.${usuarioId}&accion=eq.${accion}&creado_en=gte.${desde}&select=id`
  );
  if (usos.length >= maximo) return true;
  await rest('uso_ia', { method: 'POST', body: { usuario_id: usuarioId, accion } });
  return false;
}

export function json(datos, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
