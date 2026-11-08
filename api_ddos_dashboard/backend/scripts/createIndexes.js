import { closeDB, connectDB, getFlowsCollection } from '../config/db.js';

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
} catch (error) {
  console.error('[DB] No se pudieron verificar los índices:', error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
