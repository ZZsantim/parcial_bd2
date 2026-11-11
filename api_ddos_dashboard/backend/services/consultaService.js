import {
  ejecutarConsultaGenerada,
  validarPipeline,
} from '../repositories/llmRepository.js';
import { describirEsquemaFlujos } from '../repositories/esquemaFlujos.js';

const ollamaUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
// qwen3.5:9b es el mejor modelo de chat instalado en el Ollama local (kimi-k2.5 no está).
export const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);

const fieldDescription = describirEsquemaFlujos();

export const systemPrompt = `Eres un asistente de analítica para flujos de red CIC-DDoS2019.
Convierte la pregunta en una consulta MongoDB de solo lectura y responde ÚNICAMENTE un objeto JSON válido con esta forma:
{"pipeline":[{"$match":{...}},{"$group":{"_id":"$Label","cantidad":{"$sum":1}}},{"$sort":{"cantidad":-1}}],"explanation":"Explicación breve en español"}

La consulta se ejecutará sobre la colección completa (unos 70 millones de flujos).
Cuando la pregunta filtre por Label, Source IP, Protocol o Timestamp, pon ese $match como primera etapa: esos campos tienen índice.
Si agrupas por Label, Source IP o Protocol sin filtrar, empieza con {"$sort":{"<ese campo>":1}}: así MongoDB recorre solo el índice.
Si preguntan por ataques, tráfico malicioso o tipos DDoS, excluye Label BENIGN (siempre escrito exactamente como BENIGN). Si comparan explícitamente benigno contra ataque, conserva ambas clases.
Si preguntan por los N primeros o más frecuentes, agrega $limit con N después de ordenar.
Solo puedes usar etapas $match, $group, $project, $sort, $limit y $count.
Solo puedes usar estos campos; escribe cada nombre exactamente igual (con sus espacios, mayúsculas y sufijos como "Fwd Header Length_1"):
- ${fieldDescription}
Los operadores de filtro permitidos son $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin y $exists; $and/$or se permiten para combinar filtros.
Timestamp es texto: filtra por fecha con comparaciones de texto ("2018-12-01 00:00:00") y agrupa por hora con {"$substrBytes":["$Timestamp",11,2]}.
En expresiones solo puedes usar agregadores ($sum, $avg, $min, $max, $first, $last, $push, $addToSet), operadores aritméticos/lógicos básicos, $cond, $ifNull, $concat, $substrBytes, $toInt, $toString y $round. Nunca uses acceso a otras colecciones, $where, JavaScript, $function, $out, $merge, $lookup, $unionWith, ni etapas de escritura.
No inventes campos. No devuelvas Markdown, bloques de código ni texto fuera del JSON.
Si no puedes interpretar la pregunta, usa pipeline [] y explica qué aclaración hace falta.`;

const normalizeQuestion = (question) => question
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const excludeBenignForAttackQuestion = (question, pipeline) => {
  const normalized = normalizeQuestion(question);
  const asksAboutAttacks = /\bataques?\b|\bddos\b|\bmalicios[oa]s?\b/.test(normalized);
  const comparesWithBenign = /\bbenign[oa]s?\b|\bcompar(ar|acion|a)\b|\bfrente a\b|\bcontra\b/.test(normalized);
  if (!asksAboutAttacks || comparesWithBenign) return pipeline;

  const attackFilter = { Label: { $ne: 'BENIGN' } };
  if (pipeline[0]?.$match) {
    pipeline[0] = { $match: { $and: [attackFilter, pipeline[0].$match] } };
  } else {
    pipeline.unshift({ $match: attackFilter });
  }
  return pipeline;
};

const asksForBenignAttackCounts = (question) => {
  const normalized = normalizeQuestion(question);
  const asksForCounts = /\bcuant[oa]s?\b|\bconteo\b|\bcantidad(?:es)?\b|\bporcentaje\b|\bproporcion\b/.test(normalized);
  const asksAboutBenignAndAttacks = /\bbenign[oa]s?\b/.test(normalized) && /\bataques?\b/.test(normalized);
  return asksForCounts && asksAboutBenignAndAttacks;
};

export const prepararPipelineParaPregunta = (question, pipeline) => {
  if (asksForBenignAttackCounts(question)) {
    // El $sort por Label hace que MongoDB recorra solo idx_label (sin leer los documentos).
    return [
      { $sort: { Label: 1 } },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$Label', 'BENIGN'] },
              'BENIGN',
              'Ataque',
            ],
          },
          flujos: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];
  }

  return excludeBenignForAttackQuestion(question, pipeline);
};

const parseModelResponse = (content) => {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw Object.assign(new Error('Ollama no devolvió una respuesta JSON válida.'), { statusCode: 502 });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('Ollama devolvió una respuesta con formato inválido.'), { statusCode: 502 });
  }

  if (!Array.isArray(parsed.pipeline) || typeof parsed.explanation !== 'string') {
    throw Object.assign(new Error('La respuesta de Ollama no contiene pipeline y explicación.'), { statusCode: 502 });
  }

  return parsed;
};

export const getOllamaStatus = async () => {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { status: 'unavailable', model: ollamaModel };

    const body = await response.json();
    const found = body.models?.some((model) => (
      model.name === ollamaModel || model.model === ollamaModel
    ));
    return {
      status: found ? 'ready' : 'model_missing',
      model: ollamaModel,
    };
  } catch {
    return { status: 'unavailable', model: ollamaModel };
  }
};

export const consultarEnLenguajeNatural = async (question) => {
  let response;
  try {
    response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        think: false,
        format: 'json',
        options: { temperature: 0, num_predict: 1024 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
      }),
      signal: AbortSignal.timeout(ollamaTimeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw Object.assign(new Error('Ollama tardó demasiado en responder. Verifica el modelo local y vuelve a intentar.'), { statusCode: 504 });
    }
    throw Object.assign(new Error('No se pudo conectar con Ollama local. Inícialo y confirma OLLAMA_URL.'), { statusCode: 503 });
  }

  if (!response.ok) {
    const responseText = await response.text();
    console.error(`[Ollama] HTTP ${response.status}: ${responseText.slice(0, 300)}`);
    if (response.status === 404) {
      throw Object.assign(new Error(`Ollama no encuentra el modelo "${ollamaModel}". Descárgalo con ollama pull o configura OLLAMA_MODEL.`), { statusCode: 503 });
    }
    throw Object.assign(new Error(`Ollama respondió con HTTP ${response.status}.`), { statusCode: 502 });
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(new Error('Ollama respondió con un cuerpo inválido.'), { statusCode: 502 });
  }

  const generated = parseModelResponse(result.message?.content ?? '');
  if (generated.pipeline.length === 0) {
    return {
      explanation: generated.explanation,
      pipeline: [],
      totalResultados: 0,
      resultados: [],
      alcance: 'colección completa',
      tiempoMs: 0,
    };
  }

  const pipeline = prepararPipelineParaPregunta(question, generated.pipeline);
  validarPipeline(pipeline);
  const inicio = Date.now();
  const results = await ejecutarConsultaGenerada(pipeline).catch((error) => {
    throw Object.assign(error, { pipeline });
  });
  const tiempoMs = Date.now() - inicio;
  return {
    explanation: asksForBenignAttackCounts(question)
      ? 'Compara el conteo de flujos benignos y ataques en la colección completa.'
      : generated.explanation,
    pipeline,
    totalResultados: results.length,
    resultados: results,
    alcance: 'colección completa',
    tiempoMs,
  };
};

export default { consultarEnLenguajeNatural };
