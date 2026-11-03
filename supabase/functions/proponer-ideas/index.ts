// POST { texto, evitar?: [{ titulo, texto }] } → { ideas: [{ titulo, idea, frases }], conexiones: [{ a, b, relacion }], profundizar, preguntas }
// `a` y `b` son posiciones (desde 0) en la lista `ideas`.
// Destila la reflexión en tres pasos (reconocimiento, matriz de destilación, tesis central)
// y devuelve pocas ideas, cada una con un solo tema mayor, desarrolladas a partir de frases ORIGINALES.
// `evitar` son las ideas ya publicadas desde esta reflexión: las nuevas deben tratar otros temas.

import { pedirJSON } from '../_shared/claude.ts';
import { usuarioDeLaPeticion, superaLimite, json } from '../_shared/supabase.ts';

const MAX_USOS_DIA = 20;
const MAX_IDEAS = 3;

const SYSTEM = `Acompañas a una comunidad que escribe reflexiones libres (un texto continuo, tipo diario o lluvia de ideas) después de eventos, lecturas y otras experiencias. Destilas cada reflexión en pocas ideas coherentes que se publican de forma anónima en un mapa compartido, donde otras personas las leen y las conectan con las suyas.

Trabaja en tres pasos, en el orden de la respuesta.

## Paso 1 · Lectura de reconocimiento (campo "reconocimiento")
Lee el texto completo para captar su estado de ánimo general. Luego busca:
- palabras repetidas: términos o sinónimos que vuelven una y otra vez;
- carga emocional: frases donde se nota alivio, frustración, entusiasmo, miedo o conflicto;
- declaraciones de cierre: oraciones como «Al final…», «Lo que pasa es que…», «En realidad quiero…», que suelen ser las conclusiones de la persona.

## Paso 2 · Matriz de destilación (campo "matriz")
Recorre las frases con contenido y, para cada una, anota:
- la frase, copiada EXACTA y literalmente del texto (mismas palabras, ortografía y puntuación, sin corregir nada; puede ser un fragmento);
- el concepto clave que expresa, en pocas palabras;
- su categoría: EMOCIÓN (miedos, frustraciones, ansiedades, alegrías), ACCIÓN (proyectos, tareas, soluciones, decisiones) o VISIÓN (deseos, valores, lo que de verdad le importa);
- el tema mayor al que pertenece.
Agrupa con decisión: varias frases, aunque estén lejos en el texto, comparten el mismo tema mayor. Usa pocos temas mayores. Una frase que no aporta a ningún tema importante puede quedar fuera.

## Paso 3 · Ideas (campo "ideas")
Cada idea corresponde a UN SOLO tema mayor de la matriz, el que tiene más frases y más peso. No mezcles temas: si para redactar una idea necesitas unir con «y» dos asuntos distintos, son dos temas; quédate con uno o propón dos ideas separadas.
Prefiere pocas ideas bien desarrolladas a muchas superficiales: entre 1 y ${MAX_IDEAS}. Elige solo los temas que el texto desarrolla lo suficiente; un tema mencionado de pasada no merece una idea.
Para cada idea:
- tema_mayor: el nombre del tema en la matriz;
- tesis: una sola oración clara que resume la postura actual de la persona sobre ese tema, en primera persona (por ejemplo: «Necesito poner límites a mis horarios de trabajo para recuperar energía y volver a pintar, porque su ausencia me frustra»);
- desarrollo: un párrafo de 3 a 5 oraciones, en primera persona, que desarrolla esa tesis y solo esa: de dónde parte (premisa), por qué le importa (propósito), cómo llega a lo que piensa (desarrollo lógico) y a dónde llega (conclusión, que puede ser una pregunta abierta). Usa las palabras de la persona y lenguaje simple. No agregues argumentos, ejemplos ni conclusiones que no estén en el texto;
- titulo: de 3 a 8 palabras que digan de qué trata la idea, no solo el tema general (mejor «Recordar en grupo cambia lo que recordamos» que «La memoria»);
- frases: las frases de la matriz de ese tema que sustentan la idea, copiadas igual.

## Ideas ya publicadas
Si el mensaje incluye una sección «Ideas ya publicadas de esta reflexión», la persona vuelve a su texto para sacar ideas nuevas. Esos temas ya están cubiertos: no los repitas ni propongas variantes de ellos. Busca en la matriz los otros temas mayores del texto. Si no queda ningún tema distinto que el texto desarrolle lo suficiente, devuelve cero ideas y marca profundizar = true, con preguntas sobre aspectos del texto que esas ideas no cubren.

## Conexiones entre las ideas (campo "conexiones")
Si propones más de una idea, señala las relaciones claras entre ellas (causa, consecuencia, ejemplo, matiz, contradicción). Indica los números de las dos ideas (empezando en 1, en el orden en que las propones) y una frase de relación de 1 a 4 palabras que se lea de la primera hacia la segunda («lleva a», «es un ejemplo de», «contradice», «complementa»). Si no hay ninguna clara, deja la lista vacía.

## ¿Hace falta profundizar? (campos "profundizar" y "preguntas")
Marca profundizar = true si el texto no alcanza para desarrollar bien al menos una idea con sus cuatro partes, o si a las ideas les falta claramente el propósito o la conclusión. Si el texto tiene algún contenido, propón igual la idea que mejor se sostenga (salvo que todos sus temas ya estén publicados).
Escribe siempre de 3 a 5 preguntas abiertas, en tú, que ayuden a la persona a desarrollar justo lo que falta en sus temas mayores: por qué le importa, a qué la lleva, qué haría, qué duda le queda. Nombra sus temas concretos y no sugieras respuestas ni opiniones dentro de la pregunta.`;

const cadena = { type: 'string' };
const lista = { type: 'array', items: cadena };

const SCHEMA = {
  type: 'object',
  properties: {
    reconocimiento: {
      type: 'object',
      properties: {
        estado_de_animo: cadena,
        palabras_repetidas: lista,
        carga_emocional: lista,
        declaraciones_de_cierre: lista,
      },
      required: ['estado_de_animo', 'palabras_repetidas', 'carga_emocional', 'declaraciones_de_cierre'],
      additionalProperties: false,
    },
    matriz: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          frase: cadena,
          concepto: cadena,
          categoria: { type: 'string', enum: ['EMOCIÓN', 'ACCIÓN', 'VISIÓN'] },
          tema_mayor: cadena,
        },
        required: ['frase', 'concepto', 'categoria', 'tema_mayor'],
        additionalProperties: false,
      },
    },
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tema_mayor: cadena,
          tesis: cadena,
          desarrollo: cadena,
          titulo: cadena,
          frases: lista,
        },
        required: ['tema_mayor', 'tesis', 'desarrollo', 'titulo', 'frases'],
        additionalProperties: false,
      },
    },
    conexiones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          idea_a: { type: 'integer' },
          idea_b: { type: 'integer' },
          relacion: cadena,
        },
        required: ['idea_a', 'idea_b', 'relacion'],
        additionalProperties: false,
      },
    },
    profundizar: { type: 'boolean' },
    preguntas: lista,
  },
  required: ['reconocimiento', 'matriz', 'ideas', 'conexiones', 'profundizar', 'preguntas'],
  additionalProperties: false,
};

const normalizar = (s) => s.replace(/\s+/g, ' ').trim();

function armarMensaje(texto: string, evitar: { titulo?: string; texto?: string }[]) {
  const previas = (Array.isArray(evitar) ? evitar : [])
    .filter((i) => typeof i?.titulo === 'string')
    .slice(0, 30)
    .map((i) => `- ${i.titulo}: ${String(i.texto ?? '').slice(0, 600)}`);
  if (!previas.length) return texto;
  return `${texto}\n\n---\nIdeas ya publicadas de esta reflexión (no repetir estos temas):\n${previas.join('\n')}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok');
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const usuario = await usuarioDeLaPeticion(req);
  if (!usuario) return json({ error: 'Necesitas iniciar sesión' }, 401);

  const { texto, evitar = [] } = await req.json().catch(() => ({}));
  if (typeof texto !== 'string' || !texto.trim()) return json({ error: 'Falta el texto' }, 400);
  if (texto.length > 50000) return json({ error: 'El texto es demasiado largo' }, 400);

  if (await superaLimite(usuario, 'proponer-ideas', MAX_USOS_DIA)) {
    return json({ error: 'Llegaste al límite de sugerencias de hoy. Puedes escribir tus ideas a mano.' }, 429);
  }

  try {
    const { ideas, conexiones, profundizar, preguntas } = await pedirJSON({
      system: SYSTEM, mensaje: armarMensaje(texto, evitar), schema: SCHEMA, esfuerzo: 'medium', maxTokens: 16000,
    });
    const original = normalizar(texto);
    // Solo se aceptan frases que de verdad están en el texto
    const limpias = ideas
      .map(({ titulo, tesis, desarrollo, frases }, i) => ({
        numero: i + 1,
        titulo: titulo.trim().slice(0, 120),
        idea: `${tesis.trim()}\n\n${desarrollo.trim()}`.trim(),
        frases: [...new Set(frases.map(normalizar))].filter((f) => f && original.includes(f)),
      }))
      .filter((i) => i.titulo && i.idea && i.frases.length)
      .slice(0, MAX_IDEAS);
    // Las conexiones usan la numeración de la IA; se pasan a posiciones en `limpias`
    const posicion = new Map(limpias.map((i, k) => [i.numero, k]));
    const vistas = new Set();
    const pares = conexiones
      .map(({ idea_a, idea_b, relacion }) => ({ a: posicion.get(idea_a), b: posicion.get(idea_b), relacion: relacion.trim().slice(0, 120) }))
      .filter(({ a, b, relacion }) => {
        const clave = [a, b].sort().join('-');
        if (a === undefined || b === undefined || a === b || !relacion || vistas.has(clave)) return false;
        return vistas.add(clave);
      });
    return json({
      ideas: limpias.map(({ numero, ...resto }) => resto),
      conexiones: pares,
      profundizar: Boolean(profundizar) || !limpias.length,
      preguntas: preguntas.map((q) => q.trim()).filter(Boolean).slice(0, 5),
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'La IA no está disponible ahora. Puedes escribir tus ideas a mano.' }, 502);
  }
});
