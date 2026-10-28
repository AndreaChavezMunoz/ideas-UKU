import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  // "implicit" permite abrir el enlace del correo en otro navegador o dispositivo
  auth: { flowType: 'implicit', persistSession: true, detectSessionInUrl: true },
});

export const DIAS_EDICION = 7;

// Para páginas internas: si no hay sesión o perfil, vuelve al inicio.
export async function requerirMiembro() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return location.replace('index.html');
  const { data: perfil } = await sb.from('perfiles').select('id').maybeSingle();
  if (!perfil) return location.replace('index.html');
  return session.user;
}

export async function llamarFuncion(nombre, cuerpo = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`/.netlify/functions/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(cuerpo),
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || 'Algo salió mal');
  return datos;
}

export function editableHasta(creadoEn) {
  return new Date(new Date(creadoEn).getTime() + DIAS_EDICION * 86400000);
}
export const esEditable = (creadoEn) => editableHasta(creadoEn) > new Date();

export const fechaCorta = (f) =>
  f ? new Date(f.length === 10 ? f + 'T12:00:00' : f).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function pintarNav(activa) {
  const enlaces = [
    ['escribir.html', 'Escribir'],
    ['mapa.html', 'Mapa'],
    ['mis-reflexiones.html', 'Mis reflexiones'],
  ];
  document.querySelector('header.nav').innerHTML = `
    <a class="marca" href="mapa.html">Ideas UKU</a>
    <nav>
      ${enlaces.map(([h, t]) => `<a href="${h}"${h === activa ? ' aria-current="page"' : ''}>${t}</a>`).join('')}
      <button type="button" class="enlace" id="salir">Salir</button>
    </nav>`;
  document.getElementById('salir').onclick = async () => {
    await sb.auth.signOut();
    location.replace('index.html');
  };
}

export const TIPOS = { evento: 'Evento', lectura: 'Lectura', otra: 'Otra' };
