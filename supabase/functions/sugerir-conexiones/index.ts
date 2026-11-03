// POST { ideas: [id, ...] } → { sugerencias: [{ nueva, existente, titulo_existente, tesis_existente, relacion, motivo }] }
// Propone conexiones entre ideas recién publicadas y otras ideas del mapa (de otros textos).
// Para cargar poco, a la IA solo le llegan títulos y la primera oración (la tesis) de cada idea,
// con números cortos en lugar de ids.

import { pedirJSON } from '../_shared/claude.ts';
import { usuarioDeLaPeticion, superaLimite, rest, json } from '../_shared/supabase.ts';

const MAX_USOS_DIA = 30;
const MAX_CANDIDATAS = 200;
const MAX_SUGERENCIAS = 5;

const SYSTEM = `Ayudas a una comunidad a conectar ideas en un mapa compartido.
Recibes ideas NUEVAS (marcadas N1, N2…) y ideas que ya están en el mapa (marcadas E1, E2…), cada una con su título y su idea central.
Propón las conexiones más valiosas entre una idea nueva y una existente: cuando una es causa, consecuencia, ejemplo, matiz, respuesta o contradicción de la otra, o cuando miran el mismo asunto desde otro lugar.
- Propón como máximo ${MAX_SUGERENCIAS}, de la más clara a la menos clara. Es mejor proponer pocas o ninguna que forzar conexiones débiles.
- Nunca conectes dos ideas solo porque comparten una palabra.
- relacion: de 1 a 4 palabras que se lean de la idea nueva hacia la existente («contradice», «es un ejemplo de», «responde a», «complementa», «me recordó a»).
- motivo: una oración breve y simple que explique la conexión.`;

const SCHEMA = {
  type: 'object',
  properties: {
    conexiones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nueva: { type: 'string' },
          existente: { type: 'string' },
          relacion: { type: 'string' },
          motivo: { type: 'string' },
        },
        required: ['nueva', 'existente', 'relacion', 'motivo'],
        additionalProperties: false,
      },
    },
  },
  required: ['conexiones'],
  additionalProperties: false,
};

// Primera oración del texto (la tesis), recortada
const tesis = (texto: string) => (texto.split(/(?<=[.!?])\s|\n/)[0] || texto).slice(0, 220);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok');
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const usuario = await usuarioDeLaPeticion(req);
  if (!usuario) return json({ error: 'Necesitas iniciar sesión' }, 401);

  const { ideas: ids } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.length || ids.some((x) => !/^[0-9a-f-]{36}$/i.test(String(x)))) {
    return json({ error: 'Faltan las ideas' }, 400);
  }

  // Solo ideas propias, que admiten conexiones
  const nuevas = await rest(
    `ideas?id=in.(${ids.slice(0, 10).join(',')})&autor_id=eq.${usuario}&permite_conexiones=is.true&select=id,titulo,texto,texto_bruto_id`,
  );
  if (!nuevas.length) return json({ sugerencias: [] });

  const textosOrigen = [...new Set(nuevas.map((i) => i.texto_bruto_id).filter(Boolean))];
  const filtroOrigen = textosOrigen.length
    ? `&or=(texto_bruto_id.is.null,texto_bruto_id.not.in.(${textosOrigen.join(',')}))`
    : '';
  const [candidatas, existentes] = await Promise.all([
    rest(
      `ideas?permite_conexiones=is.true&id=not.in.(${nuevas.map((i) => i.id).join(',')})${filtroOrigen}` +
        `&select=id,titulo,texto&order=creado_en.desc&limit=${MAX_CANDIDATAS}`,
    ),
    rest(`conexiones?or=(idea_a.in.(${ids.join(',')}),idea_b.in.(${ids.join(',')}))&select=idea_a,idea_b`),
  ]);
  if (!candidatas.length) return json({ sugerencias: [] });

  if (await superaLimite(usuario, 'sugerir-conexiones', MAX_USOS_DIA)) return json({ sugerencias: [] });

  const yaConectadas = new Set(existentes.flatMap((c) => [`${c.idea_a}|${c.idea_b}`, `${c.idea_b}|${c.idea_a}`]));
  const N = new Map(nuevas.map((i, k) => [`N${k + 1}`, i]));
  const E = new Map(candidatas.map((i, k) => [`E${k + 1}`, i]));
  const mensaje =
    'IDEAS NUEVAS\n' + [...N].map(([c, i]) => `${c}. ${i.titulo} — ${tesis(i.texto)}`).join('\n') +
    '\n\nIDEAS DEL MAPA\n' + [...E].map(([c, i]) => `${c}. ${i.titulo} — ${tesis(i.texto)}`).join('\n');

  try {
    const { conexiones } = await pedirJSON({ system: SYSTEM, mensaje, schema: SCHEMA, maxTokens: 4000 });
    const vistas = new Set();
    const sugerencias = conexiones
      .map((c) => ({ n: N.get(c.nueva.trim()), e: E.get(c.existente.trim()), relacion: c.relacion.trim(), motivo: c.motivo.trim() }))
      .filter(({ n, e, relacion }) => {
        if (!n || !e || !relacion || yaConectadas.has(`${n.id}|${e.id}`) || vistas.has(`${n.id}|${e.id}`)) return false;
        return vistas.add(`${n.id}|${e.id}`);
      })
      .slice(0, MAX_SUGERENCIAS)
      .map(({ n, e, relacion, motivo }) => ({
        nueva: n.id,
        titulo_nueva: n.titulo,
        existente: e.id,
        titulo_existente: e.titulo,
        tesis_existente: tesis(e.texto),
        relacion: relacion.slice(0, 120),
        motivo,
      }));
    return json({ sugerencias });
  } catch (e) {
    console.error(e);
    return json({ error: 'No se pudieron buscar conexiones ahora.' }, 502);
  }
});
