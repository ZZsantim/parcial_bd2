import { closeDB, connectDB, getFlowsCollection } from '../config/db.js';

const findStages = (value, stages = []) => {
  if (!value || typeof value !== 'object') return stages;
  if (typeof value.stage === 'string') stages.push(value.stage);
  for (const nested of Object.values(value)) findStages(nested, stages);
  return stages;
};

// Etapa de lectura (IXSCAN/COLLSCAN clásicos o ixseek/scan en SBE): sus nReturned son
// los documentos de la muestra.
const scanStageNames = new Set(['IXSCAN', 'COLLSCAN', 'ixseek', 'ixscan', 'scan']);
const findScanStage = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (scanStageNames.has(value.stage)) return value;
  for (const nested of Object.values(value)) {
    const found = findScanStage(nested);
    if (found) return found;
  }
  return null;
};

const explainFind =async (collection, name, hint) => {
  const explanation = await collection
    .find({ Label: 'BENIGN' })
    .limit(50)
    .maxTimeMS(3_000)
    .hint(hint)
    .explain('executionStats');
  const { executionStats, queryPlanner } = explanation;
  return {
    comparison: name,
    stages: [...new Set(findStages(queryPlanner.winningPlan))],
    executionTimeMillis: executionStats.executionTimeMillis,
    totalDocsExamined: executionStats.totalDocsExamined,
    totalKeysExamined: executionStats.totalKeysExamined,
    nReturned: executionStats.nReturned,
  };
};

try {
  await connectDB();
  const collection = getFlowsCollection();
  const comparison = [
    await explainFind(collection, 'IXSCAN usando idx_label', { Label: 1 }),
    await explainFind(collection, 'COLLSCAN forzado (línea base)', { $natural: 1 }),
  ];
  const recentSample = await collection
    .aggregate(
      [{ $sort: { Timestamp: -1 } }, { $limit: 10_000 }, { $count: 'flujos' }],
      { maxTimeMS: 15_000 },
    )
    .explain('executionStats');
  // Si todo el pipeline se ejecuta en el motor de consultas (optimizedPipeline), el explain
  // trae queryPlanner/executionStats en la raíz en lugar de stages[].$cursor.
  const sampleCursor = recentSample.stages?.find((stage) => stage.$cursor)?.$cursor
    ?? (recentSample.queryPlanner && recentSample.executionStats ? recentSample : null);
  if (!sampleCursor?.queryPlanner || !sampleCursor.executionStats) {
    throw new Error('El explain de la muestra no contiene estadísticas del cursor.');
  }
  const scanStage = findScanStage(sampleCursor.executionStats.executionStages);

  console.log(JSON.stringify({
    comparison,
    recentSampleQuery: {
      stages: [...new Set(findStages(sampleCursor.queryPlanner.winningPlan))],
      executionTimeMillis: sampleCursor.executionStats.executionTimeMillis,
      totalDocsExamined: sampleCursor.executionStats.totalDocsExamined,
      totalKeysExamined: sampleCursor.executionStats.totalKeysExamined,
      nReturned: scanStage?.nReturned ?? sampleCursor.executionStats.nReturned,
    },
    note: 'COLLSCAN se fuerza solo en explain de una consulta limitada a 50 resultados; no se modifican datos ni índices.',
  }, null, 2));
} catch (error) {
  console.error('[DB] No se pudo completar explain(executionStats):', error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
