import {
  closeDB,
  connectDB,
  flowsCollectionName,
  getDB,
  getFlowsCollection,
} from '../config/db.js';

// Las pre/post-images solo hacen falta hasta que el Change Stream consume el evento.
const PRE_IMAGES_TTL_S = 3_600;

const indexes = [
  { key: { Timestamp: 1 }, name: 'idxtimestamp' },
  { key: { Label: 1 }, name: 'idx_label' },
  { key: { 'Source IP': 1 }, name: 'idx_source_ip' },
  { key: { Protocol: 1 }, name: 'idx_protocol' },
  { key: { Label: 1, Timestamp: -1 }, name: 'idx_label_timestamp' },
];

try {
  await connectDB();
  const collection = getFlowsCollection();
  for (const index of indexes) {
    const name = await collection.createIndex(index.key, { name: index.name });
    console.log(`[DB] Índice verificado: ${name}`);
  }
  // El Change Stream necesita el documento anterior (pre-image) para restar updates y
  // deletes de los resúmenes. Ambos comandos son idempotentes.
  await getDB().command({ collMod: flowsCollectionName, changeStreamPreAndPostImages: { enabled: true } });
  await getDB().admin().command({
    setClusterParameter: { changeStreamOptions: { preAndPostImages: { expireAfterSeconds: PRE_IMAGES_TTL_S } } },
  });
  console.log(`[DB] Pre/post-images del Change Stream habilitadas (caducan a los ${PRE_IMAGES_TTL_S} s).`);
} catch (error) {
  console.error('[DB] No se pudieron verificar los índices:', error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
