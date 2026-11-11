import {
  CAMPOS_POR_COLECCION,
  ejecutarConsultaGenerada,
  validarPipeline,
} from '../repositories/llmRepository.js';
import { describirEsquemaFlujos } from '../repositories/esquemaFlujos.js';
import { COLECCIONES } from '../repositories/resumenPipelines.js';
import { flowsCollectionName } from '../config/db.js';

const ollamaUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
// qwen3.5:9b es el mejor modelo de chat instalado en el Ollama local (kimi-k2.5 no está).
export const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);

const fieldDescription = describirEsquemaFlujos();

// Qué es el _id de cada colección resumen (según su $group en DERIVACIONES).
const significadoId = {
  [COLECCIONES.general]: '"general" (un único documento con los totales del dataset)',
  [COLECCIONES.label]: 'el Label (BENIGN o el tipo de ataque)',
  [COLECCIONES.diario]: 'la fecha "YYYY-MM-DD" (texto)',
  [COLECCIONES.hora]: 'la hora del día "HH" (texto de dos dígitos)',
  [COLECCIONES.protocolo]: 'el Protocol (número: 6 = TCP, 17 = UDP, 0 = otro)',
  [COLECCIONES.ipsOrigen]: 'la Source IP (solo cuenta flujos de ataque)',
  [COLECCIONES.ipsDestino]: 'la Destination IP (solo cuenta flujos de ataque)',
  [COLECCIONES.puerto]: 'el Destination Port, número (solo cuenta flujos de ataque)',
};

const resumenDescription = [...CAMPOS_POR_COLECCION]
  .filter(([coleccion]) => coleccion !== flowsCollectionName)
  .map(([coleccion, campos]) => `- ${coleccion}: _id = ${significadoId[coleccion]}; campos: ${campos.join(', ')}`)
  .join('\n');

export const systemPrompt = `Eres un asistente de analítica para flujos de red CIC-DDoS2019.
Elige UNA colección autorizada, convierte la pregunta en una consulta MongoDB de solo lectura sobre ella y responde ÚNICAMENTE un objeto JSON válido con esta forma:
{"coleccion":"resumen_label","pipeline":[{"$match":{"_id":{"$ne":"BENIGN"}}},{"$sort":{"flujos":-1}}],"explanation":"Explicación breve en español"}

Colecciones autorizadas (no uses ninguna otra):
- ${flowsCollectionName}: un documento por flujo (unos 70 millones). Sus campos se listan más abajo.
${resumenDescription}
En las colecciones resumen las cifras ya están sumadas: flujos = número de flujos, ataques y flujosDeAtaque = flujos cuyo Label no es BENIGN, total = flujos del día, esAtaque = true si el Label no es BENIGN, etiquetas = lista de Label de ataque de esa IP, bpsSuma y bpsN = suma y cantidad de valores válidos de Flow Bytes/s (promedio = bpsSuma / bpsN). Cada documento de una colección resumen ya es un grupo (uno por _id): para una distribución o un ranking por esa clave no uses $group, solo $sort (y $limit si piden los N primeros). Usa $group solo para juntar varios documentos en un total, sumando esos campos; nunca cuentes documentos con {"$sum":1}.

Regla para elegir la colección:
- Preguntas agregadas sobre todo el dataset (rankings, totales, distribuciones por Label, IP, protocolo, puerto, hora o día) van a la colección resumen_* correspondiente.
- Preguntas selectivas (una IP concreta, una etiqueta concreta, un rango de fechas) van a ${flowsCollectionName}, con un $match como primera etapa sobre campos indexados: Label, Source IP, Protocol o Timestamp.
- Si la pregunta necesita fechas, horas o rangos de tiempo de una etiqueta, una IP o un flujo concreto (primera, última, más antigua o más reciente fecha), usa ${flowsCollectionName} con un $match inicial por campo indexado; para "el más antiguo" o "el más reciente" ordena con $sort por Timestamp (1 o -1), agrega $limit 1 y proyecta Label y Timestamp. Las colecciones resumen_* no tienen fecha por etiqueta ni por IP (solo resumen_diario y resumen_hora tienen fecha u hora). Ejemplo: {"coleccion":"${flowsCollectionName}","pipeline":[{"$match":{"Label":"DrDoS_DNS"}},{"$sort":{"Timestamp":1}},{"$limit":1},{"$project":{"_id":0,"Label":1,"Timestamp":1}}],"explanation":"..."}
- Si con la colección elegida no se puede responder la pregunta, devuelve pipeline [] con la explicación, nunca un pipeline que no la responda.
Si preguntan por ataques, tráfico malicioso o tipos DDoS, excluye BENIGN (siempre escrito exactamente como BENIGN). Si comparan explícitamente benigno contra ataque, conserva ambas clases.
Si preguntan por los N primeros o más frecuentes, agrega $limit con N después de ordenar.
Solo puedes usar etapas $match, $group, $project, $sort, $limit y $count.
En ${flowsCollectionName} solo puedes usar estos campos; escribe cada nombre exactamente igual (con sus espacios, mayúsculas y sufijos como "Fwd Header Length_1"):
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

// Campo que guarda el Label en cada colección (las demás ya distinguen ataques).
const campoLabel = { [flowsCollectionName]: 'Label', [COLECCIONES.label]: '_id' };

const excludeBenignForAttackQuestion = (question, coleccion, pipeline) => {
  const normalized = normalizeQuestion(question);
  const asksAboutAttacks = /\bataques?\b|\bddos\b|\bmalicios[oa]s?\b/.test(normalized);
  const comparesWithBenign = /\bbenign[oa]s?\b|\bcompar(ar|acion|a)\b|\bfrente a\b|\bcontra\b/.test(normalized);
  if (!asksAboutAttacks || comparesWithBenign || !campoLabel[coleccion]) return pipeline;

  const attackFilter = { [campoLabel[coleccion]]: { $ne: 'BENIGN' } };
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

export const prepararPipelineParaPregunta = (question, coleccion, pipeline) => {
  if (asksForBenignAttackCounts(question)) {
    return {
      coleccion: COLECCIONES.label,
      pipeline: [
        { $group: { _id: { $cond: ['$esAtaque', 'Ataque', 'BENIGN'] }, flujos: { $sum: '$flujos' } } },
        { $sort: { _id: 1 } },
      ],
    };
  }

  return { coleccion, pipeline: excludeBenignForAttackQuestion(question, coleccion, pipeline) };
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

// /api/tags dice si el modelo está instalado; /api/ps, si está cargado en memoria (estado).
export const getOllamaStatus = async () => {
  const leer = (ruta) => fetch(`${ollamaUrl}${ruta}`, { signal: AbortSignal.timeout(2_000) })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const tieneModelo = (body) => body?.models?.some((model) => (
    model.name === ollamaModel || model.model === ollamaModel
  )) ?? false;

  const [tags, ps] = await Promise.all([leer('/api/tags'), leer('/api/ps')]);
  return {
    status: !tags ? 'unavailable' : tieneModelo(tags) ? 'ready' : 'model_missing',
    model: ollamaModel,
    estado: tieneModelo(ps) ? 'activo' : 'inactivo',
  };
};

// Carga el modelo en memoria sin caducidad (keep_alive -1). No bloquea el arranque.
export const calentarOllama = () => fetch(`${ollamaUrl}/api/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: ollamaModel, keep_alive: -1 }),
  signal: AbortSignal.timeout(ollamaTimeoutMs),
})
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`[Ollama] Modelo ${ollamaModel} cargado en memoria (keep_alive -1)`);
  })
  .catch((error) => console.warn(`[Ollama] Aviso: no se pudo precargar ${ollamaModel}: ${error.message}`));

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
        keep_alive: -1,
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
      coleccion: null,
      tiempoMs: 0,
    };
  }

  const { coleccion, pipeline } = prepararPipelineParaPregunta(question, generated.coleccion, generated.pipeline);
  validarPipeline(pipeline, coleccion);
  const inicio = Date.now();
  const results = await ejecutarConsultaGenerada(pipeline, coleccion).catch((error) => {
    throw Object.assign(error, { pipeline });
  });
  const tiempoMs = Date.now() - inicio;
  return {
    explanation: asksForBenignAttackCounts(question)
      ? 'Suma los flujos benignos y los de ataque de resumen_label.'
      : generated.explanation,
    coleccion,
    pipeline,
    totalResultados: results.length,
    resultados: results,
    tiempoMs,
  };
};

export default { consultarEnLenguajeNatural };
