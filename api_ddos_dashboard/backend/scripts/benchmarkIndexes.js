// Compara cada consulta con su índice y con COLLSCAN forzado (hint {$natural: 1}).
// No crea ni elimina índices y no modifica documentos: solo ejecuta explain("executionStats").
//
// Variables opcionales:
//   BENCH_RUNS=3            ejecuciones por variante (se reporta la mediana)
//   BENCH_MAX_TIME_MS=...   tope por ejecución; si se supera, la corrida se marca como cortada
//   BENCH_ONLY=q1,q3        ejecutar solo algunas consultas
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  closeDB, connectDB, flowsCollectionName, getDB, getFlowsCollection,
} from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '../../docs');
const RUNS = Number(process.env.BENCH_RUNS) || 3;
const MAX_TIME_MS = Number(process.env.BENCH_MAX_TIME_MS) || 900_000;
const ONLY = process.env.BENCH_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);

const queries = [
  {
    id: 'q1',
    titulo: 'Flujos de una IP de origen concreta',
    consulta: 'db.flujos_limpia.find({ "Source IP": "192.168.50.6" })',
    indice: 'idx_source_ip',
    campos: '{ "Source IP": 1 }',
    tipo: 'Simple (un campo, ascendente)',
    justificacion: 'Investigar un host concreto es una búsqueda por igualdad muy selectiva: 192.168.50.6 tiene unos 34 000 flujos de 70 M (0,05 %). Sin índice hay que leer toda la colección.',
    kind: 'find',
    filter: { 'Source IP': '192.168.50.6' },
  },
  {
    id: 'q2',
    titulo: 'Flujos de una etiqueta poco frecuente (Portmap)',
    consulta: 'db.flujos_limpia.find({ Label: "Portmap" })',
    indice: 'idx_label',
    campos: '{ Label: 1 }',
    tipo: 'Simple (un campo, ascendente)',
    justificacion: 'Filtrar por tipo de ataque es la consulta base de clasificación. Portmap tiene unos 187 000 flujos (0,27 %); el índice salta directamente a ese rango de claves.',
    kind: 'find',
    filter: { Label: 'Portmap' },
  },
  {
    id: 'q3',
    titulo: 'Etiqueta + rango de Timestamp, orden por Timestamp descendente',
    consulta: 'db.flujos_limpia.find({ Label: "Syn", Timestamp: { $gte: "2018-12-01 13:34:00", $lt: "2018-12-01 13:35:00" } }).sort({ Timestamp: -1 })',
    indice: 'idx_label_timestamp',
    campos: '{ Label: 1, Timestamp: -1 }',
    tipo: 'Compuesto (igualdad + rango/orden)',
    justificacion: 'Sigue la regla igualdad → orden → rango: Label fija el prefijo y Timestamp, ya ordenado descendente dentro de cada etiqueta, resuelve el rango y el sort sin etapa SORT en memoria.',
    kind: 'find',
    filter: { Label: 'Syn', Timestamp: { $gte: '2018-12-01 13:34:00', $lt: '2018-12-01 13:35:00' } },
    sort: { Timestamp: -1 },
  },
  {
    id: 'q4',
    titulo: 'Flujos de un protocolo poco frecuente (Protocol 0)',
    consulta: 'db.flujos_limpia.find({ Protocol: 0 })',
    indice: 'idx_protocol',
    campos: '{ Protocol: 1 }',
    tipo: 'Simple (un campo, ascendente)',
    justificacion: 'Protocol tiene solo tres valores (0, 6, 17), pero el 0 (HOPOPT) aparece en unos 4 000 flujos: en valores raros un índice de baja cardinalidad sigue siendo muy selectivo.',
    kind: 'find',
    filter: { Protocol: 0 },
  },
  {
    id: 'q5',
    titulo: 'Conteo por Label en una ventana de un minuto',
    consulta: 'db.flujos_limpia.aggregate([{ $match: { Timestamp: { $gte: "2018-12-01 13:30:00", $lt: "2018-12-01 13:31:00" } } }, { $group: { _id: "$Label", flujos: { $sum: 1 } } }])',
    indice: 'idxtimestamp',
    campos: '{ Timestamp: 1 }',
    tipo: 'Simple (un campo, ascendente)',
    justificacion: 'Los informes del dashboard agregan por periodo. El índice temporal limita el $match a la ventana pedida antes del $group, en lugar de agrupar recorriendo toda la colección.',
    kind: 'aggregate',
    pipeline: [
      { $match: { Timestamp: { $gte: '2018-12-01 13:30:00', $lt: '2018-12-01 13:31:00' } } },
      { $group: { _id: '$Label', flujos: { $sum: 1 } } },
    ],
  },
];

const findStages = (value, stages = new Set()) => {
  if (!value || typeof value !== 'object') return stages;
  if (typeof value.stage === 'string') stages.add(value.stage);
  for (const nested of Object.values(value)) findStages(nested, stages);
  return stages;
};

const planType = (stages) => {
  if (stages.has('COLLSCAN')) return 'COLLSCAN';
  if (['IXSCAN', 'COUNT_SCAN', 'DISTINCT_SCAN'].some((s) => stages.has(s))) return 'IXSCAN';
  return [...stages].join('+') || 'desconocido';
};

// En un aggregate el explain puede traer las estadísticas en la raíz (pipeline empujado al
// motor de consultas) o dentro de stages[0].$cursor.
const cursorOf = (explanation) => {
  if (explanation.queryPlanner && explanation.executionStats) return explanation;
  const cursor = explanation.stages?.find((stage) => stage.$cursor)?.$cursor;
  if (cursor?.queryPlanner && cursor.executionStats) return cursor;
  throw new Error('El explain no contiene queryPlanner/executionStats.');
};

const explainOnce = async (collection, query, hint) => {
  const explanation = query.kind === 'aggregate'
    ? await collection
      .aggregate(query.pipeline, { hint, maxTimeMS: MAX_TIME_MS, allowDiskUse: true })
      .explain('executionStats')
    : await (() => {
      let cursor = collection.find(query.filter).hint(hint).maxTimeMS(MAX_TIME_MS);
      if (query.sort) cursor = cursor.sort(query.sort).allowDiskUse(true);
      return cursor.explain('executionStats');
    })();
  const { queryPlanner, executionStats } = cursorOf(explanation);
  const stages = findStages(queryPlanner.winningPlan);
  return {
    cortada: false,
    plan: planType(stages),
    etapas: [...stages],
    executionTimeMillis: executionStats.executionTimeMillis,
    totalDocsExamined: executionStats.totalDocsExamined,
    totalKeysExamined: executionStats.totalKeysExamined,
    nReturned: executionStats.nReturned,
  };
};

const runVariant = async (collection, query, hint) => {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = Date.now();
    try {
      runs.push(await explainOnce(collection, query, hint));
    } catch (error) {
      if (error.code !== 50 && error.codeName !== 'MaxTimeMSExpired') throw error;
      runs.push({ cortada: true, wallMillis: Date.now() - started });
    }
    const last = runs.at(-1);
    console.error(`  ${query.id} ${JSON.stringify(hint)} corrida ${i + 1}/${RUNS}: ${
      last.cortada ? `cortada a ${MAX_TIME_MS} ms` : `${last.executionTimeMillis} ms, ${last.plan}`}`);
  }
  return runs;
};

// Las corridas cortadas cuentan como +∞ para la mediana.
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const summarize = (runs) => {
  const done = runs.filter((r) => !r.cortada);
  const pick = (key) => median(runs.map((r) => (r.cortada ? Infinity : r[key])));
  const time = pick('executionTimeMillis');
  return {
    corridas: runs.length,
    cortadas: runs.length - done.length,
    plan: done[0]?.plan ?? 'cortada',
    executionTimeMillis: Number.isFinite(time) ? time : null,
    // Las métricas de documentos son deterministas; se toman de las corridas completas.
    totalDocsExamined: done.length ? median(done.map((r) => r.totalDocsExamined)) : null,
    totalKeysExamined: done.length ? median(done.map((r) => r.totalKeysExamined)) : null,
    nReturned: done.length ? median(done.map((r) => r.nReturned)) : null,
    tiempos: runs.map((r) => (r.cortada ? null : r.executionTimeMillis)),
  };
};

const fmt = (n) => (n === null || n === undefined ? '—' : n.toLocaleString('es-CO'));
const fmtTime = (s) => (s.executionTimeMillis === null ? `> ${fmt(MAX_TIME_MS)} (cortada)` : fmt(s.executionTimeMillis));

const verdict = (q) => {
  const { conIndice: ix, sinIndice: cs } = q;
  if (ix.plan !== 'IXSCAN') return { concluyente: false, texto: `La variante con índice no usó IXSCAN (${ix.plan}).` };
  if (cs.plan !== 'COLLSCAN' && cs.plan !== 'cortada') return { concluyente: false, texto: `La variante forzada no usó COLLSCAN (${cs.plan}).` };
  if (ix.executionTimeMillis === null) return { concluyente: false, texto: 'La variante con índice se cortó por maxTimeMS.' };
  if (cs.executionTimeMillis === null) {
    return { concluyente: true, texto: `${fmt(ix.executionTimeMillis)} ms con índice frente a más de ${fmt(MAX_TIME_MS)} ms sin él (COLLSCAN cortado por maxTimeMS); al menos ${fmt(Math.floor(MAX_TIME_MS / Math.max(ix.executionTimeMillis, 1)))}× más rápido.` };
  }
  const ratio = cs.executionTimeMillis / Math.max(ix.executionTimeMillis, 1);
  const docs = `${fmt(ix.totalDocsExamined)} documentos examinados frente a ${fmt(cs.totalDocsExamined)}`;
  if (ratio < 2) return { concluyente: false, texto: `${fmt(ix.executionTimeMillis)} ms frente a ${fmt(cs.executionTimeMillis)} ms (${ratio.toFixed(1)}×): diferencia de tiempo pequeña; ${docs}.` };
  return { concluyente: true, texto: `${fmt(ix.executionTimeMillis)} ms frente a ${fmt(cs.executionTimeMillis)} ms (${Math.round(ratio)}× más rápido); ${docs}.` };
};

const toMarkdown = (meta, results) => {
  const header = '| Consulta | Variante | Plan | `executionTimeMillis` (mediana) | `totalDocsExamined` | `totalKeysExamined` | `nReturned` |\n|---|---|---|---:|---:|---:|---:|';
  const rows = results.flatMap((q) => [
    `| ${q.id}. ${q.titulo} | Con \`${q.indice}\` | ${q.conIndice.plan} | ${fmtTime(q.conIndice)} | ${fmt(q.conIndice.totalDocsExamined)} | ${fmt(q.conIndice.totalKeysExamined)} | ${fmt(q.conIndice.nReturned)} |`,
    `| | Sin índice (\`$natural\`) | ${q.sinIndice.plan} | ${fmtTime(q.sinIndice)} | ${fmt(q.sinIndice.totalDocsExamined)} | ${fmt(q.sinIndice.totalKeysExamined)} | ${fmt(q.sinIndice.nReturned)} |`,
  ]);
  const details = results.map((q) => [
    `### ${q.id}. ${q.titulo}`,
    '',
    '```js',
    q.consulta,
    '```',
    '',
    `- **Índice:** \`${q.indice}\``,
    `- **Campos:** \`${q.campos}\``,
    `- **Tipo de índice:** ${q.tipo}`,
    `- **Justificación:** ${q.justificacion}`,
    `- **Tiempos por corrida (ms):** con índice ${q.conIndice.tiempos.map((t) => t ?? 'cortada').join(', ')}; sin índice ${q.sinIndice.tiempos.map((t) => t ?? 'cortada').join(', ')}`,
    `- **Resultado:** ${q.veredicto.concluyente ? '' : '**No concluyente.** '}${q.veredicto.texto}`,
    '',
  ].join('\n'));

  return [
    '# Benchmark de índices en `flujos_limpia`',
    '',
    `Generado por \`npm run db:explain\` (\`backend/scripts/benchmarkIndexes.js\`) el ${meta.fecha}.`,
    '',
    `- Colección: \`${meta.baseDatos}.${meta.coleccion}\`, ${fmt(meta.documentosEstimados)} documentos (estimado), MongoDB ${meta.versionMongo}.`,
    `- Cada variante se ejecutó ${meta.corridas} veces con \`explain("executionStats")\`; se reporta la mediana de \`executionTimeMillis\`.`,
    '- "Con índice" fuerza el índice indicado con `hint`; "sin índice" fuerza `COLLSCAN` con `hint({ $natural: 1 })`. No se eliminó ningún índice ni se modificó ningún documento.',
    `- \`maxTimeMS\` = ${fmt(meta.maxTimeMS)} ms por ejecución; una corrida que lo supera se marca como cortada y cuenta como infinita para la mediana.`,
    '- En q5 (aggregate) las métricas son las del cursor que alimenta el `$group`.',
    '',
    '## Resultados',
    '',
    header,
    ...rows,
    '',
    '## Detalle por consulta',
    '',
    ...details,
  ].join('\n');
};

try {
  await connectDB();
  const collection = getFlowsCollection();
  const buildInfo = await getDB().admin().buildInfo();
  const selected = queries.filter((q) => !ONLY || ONLY.includes(q.id));
  const results = [];

  for (const query of selected) {
    console.error(`[BENCH] ${query.id}: ${query.titulo}`);
    const { kind, filter, sort, pipeline, ...info } = query;
    const conIndice = summarize(await runVariant(collection, query, query.indice));
    const sinIndice = summarize(await runVariant(collection, query, { $natural: 1 }));
    const result = { ...info, conIndice, sinIndice };
    result.veredicto = verdict(result);
    results.push(result);
  }

  const meta = {
    fecha: new Date().toISOString(),
    baseDatos: getDB().databaseName,
    coleccion: flowsCollectionName,
    documentosEstimados: await collection.estimatedDocumentCount(),
    versionMongo: buildInfo.version,
    corridas: RUNS,
    maxTimeMS: MAX_TIME_MS,
  };
  const markdown = toMarkdown(meta, results);

  await fs.mkdir(docsDir, { recursive: true });
  await fs.writeFile(path.join(docsDir, 'benchmark-indices.md'), `${markdown}\n`);
  await fs.writeFile(path.join(docsDir, 'benchmark-indices.json'), `${JSON.stringify({ meta, resultados: results }, null, 2)}\n`);
  console.log(markdown);
  console.error(`[BENCH] Guardado en ${path.join(docsDir, 'benchmark-indices.md')} y .json`);
} catch (error) {
  console.error('[DB] No se pudo completar el benchmark:', error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
