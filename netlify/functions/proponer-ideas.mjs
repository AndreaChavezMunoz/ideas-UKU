// POST { texto } → { ideas: [{ titulo, idea, frases }], conexiones: [{ a, b, relacion }], preguntas: [...] }
// `a` y `b` son posiciones (desde 0) en la lista `ideas`.
// Construye ideas coherentes a partir de frases ORIGINALES del texto.
// Si el texto da para pocas ideas, la app usa `preguntas` para que la persona profundice.

import { pedirJSON } from '../lib/claude.mjs';
import { usuarioDeLaPeticion, superaLimite, json } from '../lib/supabase.mjs';

const MAX_USOS_DIA = 20;

const SYSTEM = `Acompañas a una comunidad que escribe reflexiones libres después de eventos, lecturas y otras experiencias. Recibes la reflexión de una persona, escrita sin orden, y la ayudas a encontrar las ideas que hay en ella. Esas ideas se publican de forma anónima en un mapa compartido, donde otras personas las leen y las conectan con las suyas.

## Qué es una idea coherente
Cada idea debe sostenerse sola, para alguien que no leyó el texto original. Tiene:
- una premisa clara: el punto de partida, lo que la persona observa o afirma;
- un propósito definido: por qué le importa o qué busca entender;
- un desarrollo lógico: cómo llega de la premisa a lo que piensa, con los pasos que ella misma da;
- una conclusión: a dónde llega, aunque sea una pregunta abierta.
Redáctala en un párrafo breve (de 3 a 5 oraciones), en primera persona, con lenguaje simple y usando las palabras de la persona siempre que se pueda. Tu trabajo es ordenar, no opinar: no agregues argumentos, ejemplos, conceptos ni conclusiones que no estén en el texto. Si a una idea le falta alguna de las cuatro partes en el texto, no la inventes: esa idea no está lista.

## Título
Cada idea lleva un título de 3 a 8 palabras que la resuma, para encontrarla en el mapa. Debe decir de qué trata la idea, no solo el tema general (mejor «Recordar en grupo cambia lo que recordamos» que «La memoria»).

## Frases originales
Para cada idea, copia las frases del texto que la sustentan, aunque estén repartidas en distintas partes. Deben ser copias EXACTAS y literales: mismas palabras, misma ortografía y puntuación, sin corregir nada. Puedes tomar una oración completa o un fragmento.

## Cuántas ideas
Propón todas las ideas coherentes y distintas que el texto sostenga, hasta un máximo de 5. Si el texto tiene contenido, propón al menos una, aunque sea la más sencilla. Devuelve cero ideas solo si el texto está vacío o no dice nada.

## Conexiones entre las ideas
Como todas las ideas salen del mismo texto, señala las conexiones claras entre ellas: cuando una es causa, consecuencia, ejemplo, matiz o contradicción de otra. Para cada conexión indica los números de las dos ideas (empezando en 1, en el orden en que las propones) y una frase corta de relación, de 1 a 4 palabras, que se lea de la primera idea hacia la segunda (por ejemplo: «lleva a», «es un ejemplo de», «contradice», «complementa», «me recordó a»). Propón solo conexiones que el texto justifique; si no hay ninguna, deja la lista vacía.

## Preguntas para profundizar
Escribe además de 3 a 5 preguntas abiertas que ayuden a la persona a desarrollar lo que empezó a pensar: qué le hizo notar eso, por qué le importa, a qué la lleva, qué duda le queda. Deben partir de lo que escribió y nombrar sus temas concretos. No sugieras respuestas ni opiniones dentro de la pregunta. Escríbelas en tú.`;

const SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          idea: { type: 'string' },
          frases: { type: 'array', items: { type: 'string' } },
        },
        required: ['titulo', 'idea', 'frases'],
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
          relacion: { type: 'string' },
        },
        required: ['idea_a', 'idea_b', 'relacion'],
        additionalProperties: false,
      },
    },
    preguntas: { type: 'array', items: { type: 'string' } },
  },
  required: ['ideas', 'conexiones', 'preguntas'],
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
    const { ideas, conexiones, preguntas } = await pedirJSON({ system: SYSTEM, mensaje: texto, schema: SCHEMA, esfuerzo: 'medium' });
    const original = normalizar(texto);
    // Solo se aceptan frases que de verdad están en el texto
    const limpias = ideas
      .map(({ titulo, idea, frases }, i) => ({
        numero: i + 1,
        titulo: titulo.trim().slice(0, 120),
        idea: idea.trim(),
        frases: [...new Set(frases.map(normalizar))].filter((f) => f && original.includes(f)),
      }))
      .filter((i) => i.titulo && i.idea && i.frases.length)
      .slice(0, 5);
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
      preguntas: preguntas.map((q) => q.trim()).filter(Boolean).slice(0, 5),
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'La IA no está disponible ahora. Puedes escribir tus ideas a mano.' }, 502);
  }
};
