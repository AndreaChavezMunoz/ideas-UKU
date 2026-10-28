// POST → busca grupos de 5 o más ideas conectadas y les sugiere un nombre de tema.
// Solo lee ideas públicas (nunca textos brutos).

import { pedirJSON } from '../lib/claude.mjs';
import { usuarioDeLaPeticion, superaLimite, rest, json } from '../lib/supabase.mjs';

const MINIMO = 5;
const MAX_USOS_DIA = 30;

const SYSTEM = `Recibes un grupo de ideas conectadas entre sí, escritas por una comunidad.
Sugiere un nombre corto (de 2 a 5 palabras, en español) para el tema que comparten.
Usa un lenguaje simple y cercano, sin tecnicismos.`;

const SCHEMA = {
  type: 'object',
  properties: { nombre: { type: 'string' } },
  required: ['nombre'],
  additionalProperties: false,
};

// Grupos de ideas conectadas (componentes conexos del grafo)
function grupos(ideas, conexiones) {
  const padre = new Map(ideas.map((i) => [i.id, i.id]));
  const raiz = (x) => (padre.get(x) === x ? x : (padre.set(x, raiz(padre.get(x))), padre.get(x)));
  for (const c of conexiones) {
    if (padre.has(c.idea_a) && padre.has(c.idea_b)) padre.set(raiz(c.idea_a), raiz(c.idea_b));
  }
  const porRaiz = new Map();
  for (const i of ideas) {
    const r = raiz(i.id);
    if (!porRaiz.has(r)) porRaiz.set(r, []);
    porRaiz.get(r).push(i);
  }
  return [...porRaiz.values()];
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const usuario = await usuarioDeLaPeticion(req);
  if (!usuario) return json({ error: 'Necesitas iniciar sesión' }, 401);

  const [ideas, conexiones, temasIdeas] = await Promise.all([
    rest('ideas?select=id,texto'),
    rest('conexiones?select=idea_a,idea_b'),
    rest('temas_ideas?select=tema_id,idea_id'),
  ]);

  const ideasPorTema = new Map();
  for (const t of temasIdeas) {
    if (!ideasPorTema.has(t.tema_id)) ideasPorTema.set(t.tema_id, new Set());
    ideasPorTema.get(t.tema_id).add(t.idea_id);
  }

  const creados = [];
  for (const grupo of grupos(ideas, conexiones)) {
    if (grupo.length < MINIMO) continue;
    const ids = new Set(grupo.map((i) => i.id));

    // Temas que ya cubren parte de este grupo
    const solapados = [...ideasPorTema].filter(([, s]) => [...s].some((id) => ids.has(id)));
    const mayor = Math.max(0, ...solapados.map(([, s]) => s.size));
    // Se renombra solo si el grupo es nuevo o creció al menos un 50 %
    if (solapados.length && grupo.length < mayor * 1.5) continue;

    if (await superaLimite(usuario, 'sugerir-tema', MAX_USOS_DIA)) break;

    try {
      const lista = grupo.map((i) => `- ${i.texto}`).join('\n');
      const { nombre } = await pedirJSON({ system: SYSTEM, mensaje: lista, schema: SCHEMA, maxTokens: 2000 });
      for (const [temaId] of solapados) {
        await rest(`temas?id=eq.${temaId}`, { method: 'DELETE' });
      }
      const [tema] = await rest('temas', {
        method: 'POST',
        body: { nombre: nombre.trim().slice(0, 80) },
        prefer: 'return=representation',
      });
      await rest('temas_ideas', {
        method: 'POST',
        body: grupo.map((i) => ({ tema_id: tema.id, idea_id: i.id })),
      });
      creados.push(tema.nombre);
    } catch (e) {
      console.error(e);
    }
  }
  return json({ temas: creados });
};
