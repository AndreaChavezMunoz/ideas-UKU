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

// Llama a una Edge Function de Supabase (la IA vive ahí: permite hasta 150 s por llamada)
export async function llamarFuncion(nombre, cuerpo = {}) {
  const { data, error } = await sb.functions.invoke(nombre, { body: cuerpo });
  if (!error) return data;
  let mensaje = '';
  try { mensaje = (await error.context.json()).error; } catch { /* respuesta sin JSON */ }
  const estado = error.context?.status;
  throw new Error(mensaje || `Algo salió mal${estado ? ` (código ${estado})` : ''}. Intenta de nuevo en un momento.`);
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
