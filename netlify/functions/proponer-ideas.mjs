// POST { texto } → { ideas: [{ idea, frases: [...] }] }
// Agrupa frases ORIGINALES del texto por tema y propone de 3 a 5 ideas.

import { pedirJSON } from '../lib/claude.mjs';
import { usuarioDeLaPeticion, superaLimite, json } from '../lib/supabase.mjs';

const MAX_USOS_DIA = 20;

const SYSTEM = `Ayudas a una comunidad que escribe reflexiones libres después de eventos y lecturas.
Recibes la reflexión de una persona. Tu trabajo:
1. Encuentra entre 3 y 5 temas o ideas centrales del texto.
2. Para cada idea, copia las frases del texto que la sustentan. Las frases deben ser copias EXACTAS y literales del texto (mismas palabras, misma ortografía, sin corregir nada), aunque estén repartidas en distintas partes. Puedes tomar una oración completa o un fragmento.
3. Redacta cada idea en una sola oración muy simple, usando las palabras de la persona siempre que se pueda. No agregues opiniones, conceptos ni información que no estén en el texto. No embellezcas: solo da coherencia.
Si el texto es muy corto, propone menos ideas (mínimo 1).`;

const SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          idea: { type: 'string' },
          frases: { type: 'array', items: { type: 'string' } },
        },
        required: ['idea', 'frases'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

const normalizar = (s) => s.replace(/\s+/g, ' ').trim();

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const usuario = await usuarioDeLaPeticion(req);
  if (!usuario) return json({ error: 'Necesitas iniciar sesión' }, 401);

  const { texto } = await req.json().catch(() => ({}));
  if (typeof texto !== 'string' || !texto.trim()) return json({ error: 'Falta el texto' }, 400);
  if (texto.length > 50000) return json({ error: 'El texto es demasiado largo' }, 400);

  if (await superaLimite(usuario, 'proponer-ideas', MAX_USOS_DIA)) {
    return json({ error: 'Llegaste al límite de sugerencias de hoy. Puedes escribir tus ideas a mano.' }, 429);
  }

  try {
    const { ideas } = await pedirJSON({ system: SYSTEM, mensaje: texto, schema: SCHEMA });
    const original = normalizar(texto);
    // Solo se aceptan frases que de verdad están en el texto
    const limpias = ideas
      .map(({ idea, frases }) => ({
        idea: idea.trim(),
        frases: [...new Set(frases.map(normalizar))].filter((f) => f && original.includes(f)),
      }))
      .filter((i) => i.idea && i.frases.length)
      .slice(0, 5);
    return json({ ideas: limpias });
  } catch (e) {
    console.error(e);
    return json({ error: 'La IA no está disponible ahora. Puedes escribir tus ideas a mano.' }, 502);
  }
};
