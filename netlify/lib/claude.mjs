import Anthropic from '@anthropic-ai/sdk';

const cliente = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno

// Pide a Claude una respuesta JSON que cumpla `schema`.
// Si un filtro de seguridad rechaza la petición, la API la reintenta con otro modelo.
export async function pedirJSON({ system, mensaje, schema, maxTokens = 8000 }) {
  const respuesta = await cliente.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: mensaje }],
  });
  if (respuesta.stop_reason === 'refusal') throw new Error('La IA no pudo procesar este texto');
  if (respuesta.stop_reason === 'max_tokens') throw new Error('La respuesta de la IA quedó incompleta');
  const texto = respuesta.content.find((b) => b.type === 'text')?.text;
  if (!texto) throw new Error('La IA no devolvió texto');
  return JSON.parse(texto);
}
