// Compara cada consulta con el plan que elige el planificador (IXSCAN) y con COLLSCAN forzado
// (hint {$natural: 1}). No crea ni elimina índices y no modifica documentos: solo ejecuta
// explain("executionStats"). Guarda la salida cruda en docs/benchmark-indices.json y genera
// docs/optimizacion-indices.md a partir de ese JSON.
//
// Variables opcionales:
//   BENCH_RUNS=3            corridas con índice por consulta
//   BENCH_RUNS_COLLSCAN=1   corridas con COLLSCAN forzado por consulta (cada una tarda minutos)
//   BENCH_MAX_TIME_MS=...   tope por ejecución (por defecto sin tope); si se supera, la corrida se marca como cortada
//   BENCH_ONLY=a,c          ejecutar solo algunas consultas
//
// Con --solo-md no se conecta a MongoDB ni mide: regenera el .md desde el JSON existente.
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  closeDB, connectDB, flowsCollectionName, getDB, getFlowsCollection,
} from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '../../docs');
const jsonPath = path.join(docsDir, 'benchmark-indices.json');
const mdPath = path.join(docsDir, 'optimizacion-indices.md');
const RUNS = Number(process.env.BENCH_RUNS) || 3;
const RUNS_COLLSCAN = Number(process.env.BENCH_RUNS_COLLSCAN) || 1;
const MAX_TIME_MS = Number(process.env.BENCH_MAX_TIME_MS) || 0;
const ONLY = process.env.BENCH_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);

// Los cinco índices de flujos_limpia y la consulta que optimiza cada uno.
const indices = [
  {
    nombre: 'idxtimestamp',
    campos: '{ Timestamp: 1 }',
    tipo: 'Simple',
    consulta: '(e) `{ Timestamp: { $gte, $lt } }`',
    justificacion: 'Limita las consultas por ventana de tiempo al rango de claves pedido en lugar de recorrer los 70 M de flujos.',
  },
  {
    nombre: 'idx_label',
    campos: '{ Label: 1 }',
    tipo: 'Simple',
    consulta: 'Filtros por `Label` sin rango de tiempo (no medida en este benchmark)',
    justificacion: 'Filtrar por tipo de ataque es la consulta base de clasificación. Queda cubierto por el prefijo `Label` de `idx_label_timestamp` (ver Notas).',
  },
  {
    nombre: 'idx_source_ip',
    campos: '{ "Source IP": 1 }',
    tipo: 'Simple',
    consulta: '(a) `{ "Source IP": "104.27.33.64" }`',
    justificacion: 'Investigar un host es una igualdad muy selectiva (1 577 IP distintas); sin índice hay que leer toda la colección.',
  },
  {
    nombre: 'idx_protocol',
    campos: '{ Protocol: 1 }',
    tipo: 'Simple',
    consulta: 'Filtros por `Protocol` (no medida en este benchmark)',
    justificacion: 'Baja cardinalidad: solo hay tres protocolos, así que solo es selectivo en el valor raro (0, con 3 998 flujos). Ver Notas.',
  },
  {
    nombre: 'idx_label_timestamp',
    campos: '{ Label: 1, Timestamp: -1 }',
    tipo: 'Compuesto',
    consulta: '(c) `{ Label: "BENIGN", Timestamp: { $gte, $lt } }`',
    justificacion: 'Igualdad en `Label` como prefijo y rango en `Timestamp` dentro de esa etiqueta: solo se leen las claves de la ventana pedida.',
  },
];

const queries = [
  {
    id: 'a',
    titulo: 'IP de origen concreta (104.27.33.64)',
    consulta: 'db.flujos_limpia.find({ "Source IP": "104.27.33.64" })',
    indiceEsperado: 'idx_source_ip',
    filter: { 'Source IP': '104.27.33.64' },
  },
  {
    id: 'b',
    titulo: 'Etiqueta rara (WebDDoS)',
    consulta: 'db.flujos_limpia.find({ Label: "WebDDoS" })',
    indiceEsperado: 'idx_label',
    filter: { Label: 'WebDDoS' },
  },
  {
    id: 'c',
    titulo: 'Label + rango de Timestamp (BENIGN, 1 minuto)',
    consulta: 'db.flujos_limpia.find({ Label: "BENIGN", Timestamp: { $gte: "2018-12-01 10:00:00", $lt: "2018-12-01 10:01:00" } })',
    indiceEsperado: 'idx_label_timestamp',
    filter: { Label: 'BENIGN', Timestamp: { $gte: '2018-12-01 10:00:00', $lt: '2018-12-01 10:01:00' } },
  },
  {
    id: 'd',
    titulo: 'Protocolo poco frecuente (Protocol 0)',
    consulta: 'db.flujos_limpia.find({ Protocol: 0 })',
    indiceEsperado: 'idx_protocol',
    filter: { Protocol: 0 },
  },
  {
    id: 'e',
    titulo: 'Rango de Timestamp sin Label (5 minutos)',
    consulta: 'db.flujos_limpia.find({ Timestamp: { $gte: "2018-11-03 17:00:00", $lt: "2018-11-03 17:05:00" } })',
    indiceEsperado: 'idxtimestamp',
    filter: { Timestamp: { $gte: '2018-11-03 17:00:00', $lt: '2018-11-03 17:05:00' } },
  },
];

const walkPlan = (value, found = { stages: new Set(), indexes: new Set() }) => {
  if (!value || typeof value !== 'object') return found;
  if (typeof value.stage === 'string') found.stages.add(value.stage);
  if (value.stage === 'IXSCAN' && value.indexName) found.indexes.add(value.indexName);
  for (const nested of Object.values(value)) walkPlan(nested, found);
  return found;
};

const planType = (stages) => {
  if (stages.has('COLLSCAN')) return 'COLLSCAN';
  if (stages.has('IXSCAN')) return 'IXSCAN';
  return [...stages].join('+') || 'desconocido';
};

const explainOnce = async (collection, query, hint) => {
  let cursor = collection.find(query.filter);
  if (hint) cursor = cursor.hint(hint);
  if (MAX_TIME_MS) cursor = cursor.maxTimeMS(MAX_TIME_MS);
  const { queryPlanner, executionStats } = await cursor.explain('executionStats');
  // Con maxTimeMS, explain no lanza error: devuelve executionSuccess false con estadísticas parciales.
  if (executionStats.executionSuccess === false) return { cortada: true, error: executionStats.errorMessage };
  const { stages, indexes } = walkPlan(queryPlanner.winningPlan);
  return {
    cortada: false,
    plan: planType(stages),
    indice: [...indexes].join(', ') || null,
    etapas: [...stages],
    executionTimeMillis: executionStats.executionTimeMillis,
    totalDocsExamined: executionStats.totalDocsExamined,
    totalKeysExamined: executionStats.totalKeysExamined,
    nReturned: executionStats.nReturned,
  };
};

const runVariant = async (collection, query, hint, runs) => {
  const results = [];
  for (let i = 0; i < runs; i += 1) {
    const inicio = new Date();
    try {
      results.push({ inicio: inicio.toISOString(), ...(await explainOnce(collection, query, hint)) });
    } catch (error) {
      if (error.code !== 50 && error.codeName !== 'MaxTimeMSExpired') throw error;
      results.push({ inicio: inicio.toISOString(), cortada: true });
    }
    const last = results.at(-1);
    last.wallMillis = Date.now() - inicio.getTime();
    console.error(`  ${query.id} ${hint ? JSON.stringify(hint) : 'planificador'} corrida ${i + 1}/${runs}: ${
      last.cortada ? `cortada a ${MAX_TIME_MS} ms` : `${last.executionTimeMillis} ms, ${last.plan} ${last.indice ?? ''}`}`);
  }
  return results;
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// ---- Markdown a partir del JSON ----

const corridas = (n) => `${n} ${n === 1 ? 'corrida' : 'corridas'}`;
const fmt = (n) => (n === null || n === undefined ? '—' : n.toLocaleString('es-CO'));

const stats = (runs) => {
  const done = runs.filter((r) => !r.cortada);
  const times = done.map((r) => r.executionTimeMillis);
  const first = done[0] ?? {};
  return {
    corridas: runs.length,
    cortadas: runs.length - done.length,
    plan: first.plan ?? 'cortada',
    indice: first.indice ?? null,
    min: times.length ? Math.min(...times) : null,
    mediana: times.length ? median(times) : null,
    max: times.length ? Math.max(...times) : null,
    totalDocsExamined: first.totalDocsExamined ?? null,
    totalKeysExamined: first.totalKeysExamined ?? null,
    nReturned: first.nReturned ?? null,
    tiempos: runs.map((r) => (r.cortada ? null : r.executionTimeMillis)),
  };
};

const factor = (ix, cs) => {
  if (ix.mediana === null || cs.mediana === null) return null;
  return ix.mediana === 0 ? `≥ ${fmt(cs.mediana)}× (índice en 0 ms)` : `${fmt(Math.round(cs.mediana / ix.mediana))}×`;
};

const interpret = (q, ix, cs) => {
  if (ix.plan !== 'IXSCAN') return `El planificador no eligió IXSCAN (${ix.plan}); la comparación no es válida.`;
  if (cs.plan !== 'COLLSCAN') return `La variante forzada no usó COLLSCAN (${cs.plan}); la comparación no es válida.`;
  const esperado = ix.indice === q.indiceEsperado ? '' : ` (se esperaba \`${q.indiceEsperado}\`)`;
  const extra = ix.totalDocsExamined > ix.nReturned
    ? ` El IXSCAN leyó ${fmt(ix.totalDocsExamined - ix.nReturned)} documentos que luego descartó.`
    : ' Cada documento leído con el índice fue devuelto: el índice resuelve el filtro completo.';
  return `El planificador usó \`${ix.indice}\`${esperado} y examinó ${fmt(ix.totalKeysExamined)} claves y ${fmt(ix.totalDocsExamined)} documentos para devolver ${fmt(ix.nReturned)}, frente a ${fmt(cs.totalDocsExamined)} documentos del COLLSCAN; la mediana bajó de ${fmt(cs.mediana)} ms a ${fmt(ix.mediana)} ms (${factor(ix, cs)}).${extra}`;
};

const toMarkdown = ({ meta, resultados }) => {
  const gib = (b) => (b / 1024 ** 3).toFixed(1).replace('.', ',');
  const rows = resultados.flatMap((q) => {
    const ix = stats(q.conIndice);
    const cs = stats(q.sinIndice);
    const row = (variante, s, f) => `| ${variante} | ${s.plan}${s.indice ? ` (\`${s.indice}\`)` : ''} | ${s.corridas - s.cortadas}${s.cortadas ? ` (+${s.cortadas} cortadas)` : ''} | ${fmt(s.min)} | ${fmt(s.mediana)} | ${fmt(s.max)} | ${fmt(s.totalDocsExamined)} | ${fmt(s.totalKeysExamined)} | ${fmt(s.nReturned)} | ${f} |`;
    return [
      `| **${q.id}) ${q.titulo}** | | | | | | | | | |`,
      row('Con índice (planificador)', ix, factor(ix, cs) ?? '—'),
      row('Sin índice (`$natural`)', cs, '—'),
    ];
  });
  const interpretations = resultados.map((q) => `- **${q.id})** \`${q.consulta}\` — ${interpret(q, stats(q.conIndice), stats(q.sinIndice))}`);
  const timesPerRun = resultados.map((q) => `- **${q.id})** con índice: ${stats(q.conIndice).tiempos.map((t) => t ?? 'cortada').join(', ')} ms; COLLSCAN: ${stats(q.sinIndice).tiempos.map((t) => t ?? 'cortada').join(', ')} ms`);
  const minutos = (ms) => (ms / 60000).toFixed(1).replace('.', ',');
  const collscan = resultados.flatMap((q) => stats(q.sinIndice).tiempos.filter((t) => t !== null));
  const reducido = meta.corridasCollscan < meta.corridasIndice && collscan.length
    ? ` Sin índice se hizo ${corridas(meta.corridasCollscan)} por consulta porque cada COLLSCAN tarda entre ${minutos(Math.min(...collscan))} y ${minutos(Math.max(...collscan))} minutos.`
    : '';

  return [
    '# Optimización con índices en `flujos_limpia`',
    '',
    `Generado por \`npm run db:explain\` (\`backend/scripts/benchmarkIndexes.js\`) a partir de \`docs/benchmark-indices.json\` (${meta.fecha}).`,
    '',
    `- Colección \`${meta.baseDatos}.${meta.coleccion}\`: ${fmt(meta.documentos)} documentos, ${gib(meta.tamanoDatosBytes)} GiB de datos sin comprimir (${gib(meta.tamanoAlmacenamientoBytes)} GiB en disco). MongoDB ${meta.versionMongo}.`,
    `- Equipo: ${gib(meta.ramBytes)} GiB de RAM; caché de WiredTiger de ${gib(meta.cacheWiredTigerBytes)} GiB.`,
    `- Cada consulta se ejecutó sin \`limit\` con \`explain("executionStats")\`: ${corridas(meta.corridasIndice)} con el plan del planificador y ${corridas(meta.corridasCollscan)} con COLLSCAN forzado.${reducido}`,
    `- \`maxTimeMS\`: ${meta.maxTimeMS ? `${fmt(meta.maxTimeMS)} ms` : 'sin tope'}.`,
    '',
    '## Índices',
    '',
    '| Índice | Campos | Tipo | Consulta que optimiza | Justificación |',
    '|---|---|---|---|---|',
    ...meta.indices.map((i) => `| \`${i.nombre}\` | \`${i.campos}\` | ${i.tipo} | ${i.consulta} | ${i.justificacion} |`),
    '',
    '## Comparación antes y después',
    '',
    '| Variante | Plan | Corridas | `executionTimeMillis` mín. | mediana | máx. | `totalDocsExamined` | `totalKeysExamined` | `nReturned` | Mejora (mediana) |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
    '',
    'Tiempos por corrida, en orden de ejecución:',
    '',
    ...timesPerRun,
    '',
    '## Interpretación',
    '',
    ...interpretations,
    '',
    '## Notas',
    '',
    '- `idx_label` e `idx_protocol` no se miden en este benchmark. `idx_label` queda cubierto por el prefijo del índice compuesto `idx_label_timestamp` (`{ Label: 1, Timestamp: -1 }`), que también resuelve una igualdad sobre `Label` sola; `idx_protocol` tiene baja cardinalidad (3 valores) y solo ayuda con el protocolo poco frecuente. Las mediciones de las consultas b y d están en el commit `73c8e8f`.',
    '- El "antes" no se obtuvo borrando los índices: se forzó el COLLSCAN con `hint({ $natural: 1 })`, que recorre la colección en orden natural igual que si el índice no existiera. Así no se tocaron índices ni datos. El "después" es el plan que elige el planificador sin `hint`.',
    `- Los tiempos dependen de la caché del sistema. La colección (${gib(meta.tamanoDatosBytes)} GiB) no cabe en la caché de WiredTiger (${gib(meta.cacheWiredTigerBytes)} GiB) ni en la RAM (${gib(meta.ramBytes)} GiB), así que cada COLLSCAN lee casi todo desde disco: son corridas en frío aunque se repitan. Las corridas con índice tocan pocas claves y documentos; la primera de cada consulta puede ir en frío y las siguientes en caliente, por eso se reportan mínimo, mediana y máximo.`,
    '',
  ].join('\n');
};

if (process.argv.includes('--solo-md')) {
  // Resultados del JSON y descripción de índices de este script; no se mide nada.
  const { meta, resultados } = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  await fs.writeFile(mdPath, toMarkdown({ meta: { ...meta, indices }, resultados }));
  console.error(`[BENCH] ${mdPath} regenerado desde ${jsonPath} (sin medir)`);
  process.exit(0);
}

try {
  await connectDB();
  const db = getDB();
  const collection = getFlowsCollection();
  const buildInfo = await db.admin().buildInfo();
  const serverStatus = await db.admin().command({ serverStatus: 1 });
  const collStats = await db.command({ collStats: flowsCollectionName });
  const selected = queries.filter((q) => !ONLY || ONLY.includes(q.id));
  const resultados = [];

  for (const query of selected) {
    console.error(`[BENCH] ${query.id}: ${query.titulo}`);
    const { filter, ...info } = query;
    const conIndice = await runVariant(collection, query, null, RUNS);
    const sinIndice = await runVariant(collection, query, { $natural: 1 }, RUNS_COLLSCAN);
    resultados.push({ ...info, filtro: filter, conIndice, sinIndice });
  }

  const meta = {
    fecha: new Date().toISOString(),
    baseDatos: db.databaseName,
    coleccion: flowsCollectionName,
    documentos: await collection.estimatedDocumentCount(),
    tamanoDatosBytes: collStats.size,
    tamanoAlmacenamientoBytes: collStats.storageSize,
    versionMongo: buildInfo.version,
    ramBytes: os.totalmem(),
    cacheWiredTigerBytes: serverStatus.wiredTiger?.cache?.['maximum bytes configured'] ?? null,
    corridasIndice: RUNS,
    corridasCollscan: RUNS_COLLSCAN,
    maxTimeMS: MAX_TIME_MS,
    indices,
  };

  await fs.mkdir(docsDir, { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify({ meta, resultados }, null, 2)}\n`);
  const markdown = toMarkdown(JSON.parse(await fs.readFile(jsonPath, 'utf8')));
  await fs.writeFile(mdPath, markdown);
  console.log(markdown);
  console.error(`[BENCH] Guardado en ${jsonPath} y ${mdPath}`);
} catch (error) {
  console.error('[DB] No se pudo completar el benchmark:', error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
