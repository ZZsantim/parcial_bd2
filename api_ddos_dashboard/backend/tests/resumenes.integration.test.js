// Prueba de integración contra MongoDB real, en una base temporal propia (no ddos_db).
// Se omite si no hay un mongod accesible en MONGO_URI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from 'mongodb';
import '../config/db.js'; // carga backend/.env
import {
  getAnalitica,
  getResumen,
  getSeries,
  getTopIps,
} from '../repositories/informeRepository.js';
import {
  aplicarInserciones,
  obtenerEstado,
  recalcularResumenes,
} from '../services/resumenService.js';

const DB_PRUEBA = 'ddos_resumenes_test';
const FLUJOS = 'flujos_limpia';

// _id de hace un minuto: el recálculo completo cuenta los flujos anteriores al segundo en que
// empieza; los posteriores los suma la cola incremental.
const idAntiguo = () => new ObjectId(Math.floor(Date.now() / 1000) - 60);

const flujo = (Label, Timestamp, extra = {}) => ({
  _id: idAntiguo(),
  Label,
  Timestamp,
  'Source IP': '172.16.0.5',
  'Destination IP': '192.168.50.1',
  'Destination Port': 80,
  Protocol: 6,
  'Flow Bytes/s': 100,
  ...extra,
});

const fixture = [
  flujo('BENIGN', '2018-11-03 09:20:40', { 'Source IP': '192.168.50.8', 'Destination Port': 53, Protocol: 17, 'Flow Bytes/s': 300 }),
  flujo('BENIGN', '2018-11-03 10:00:00', { 'Source IP': '192.168.50.9', 'Flow Bytes/s': Infinity }),
  flujo('Syn', '2018-11-03 10:05:00'),
  flujo('Syn', '2018-11-03 10:06:00', { 'Destination Port': 443 }),
  flujo('UDP', '2018-11-03 11:00:00', { Protocol: 17, 'Destination Port': 0, 'Destination IP': '192.168.50.4' }),
  flujo('DrDoS_DNS', '2018-12-01 10:00:00', { 'Source IP': '172.16.0.6', Protocol: 17, 'Destination Port': 53 }),
];

let client;
let db;
try {
  client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 1_500 });
  await client.connect();
  db = client.db(DB_PRUEBA);
  await db.dropDatabase();
} catch {
  await client?.close().catch(() => {});
  client = null;
}

const omitir = client ? false : 'MongoDB no disponible';

test.after(async () => {
  if (!client) return;
  await db.dropDatabase();
  await client.close();
});

test('builds every summary from the full collection and serves the original JSON shape', { skip: omitir }, async () => {
  await db.collection(FLUJOS).insertMany(fixture);
  const estado = await recalcularResumenes(db, { coleccionFlujos: FLUJOS });
  assert.equal(estado.recalculando, false);

  const resumen = await getResumen(db);
  assert.deepEqual(resumen, {
    totalFlujosEstimado: 6,
    flujosAnalizados: 6,
    flujosDeAtaque: 4,
    porcentajeDeAtaque: (4 / 6) * 100,
    bytesPorSegundoPromedio: (300 + 100 * 4) / 5, // Infinity se excluye, como antes
    tipoAtaqueMasFrecuente: 'Syn',
  });

  assert.deepEqual(await getTopIps(5, db), {
    flujosAnalizados: 6,
    datos: [
      { ip: '172.16.0.5', ataques: 3, etiquetas: ['Syn', 'UDP'] },
      { ip: '172.16.0.6', ataques: 1, etiquetas: ['DrDoS_DNS'] },
    ],
  });

  assert.deepEqual(await getSeries(1, db), {
    flujosAnalizados: 6,
    datos: [{ fecha: '2018-12-01', total: 1, ataques: 1 }],
  });

  const analitica = await getAnalitica(7, 8, db);
  assert.deepEqual(analitica.series, [
    { fecha: '2018-11-03', total: 5, ataques: 3 },
    { fecha: '2018-12-01', total: 1, ataques: 1 },
  ]);
  assert.deepEqual(analitica.tiposAtaque, [
    { tipo: 'Syn', cantidad: 2 },
    { tipo: 'DrDoS_DNS', cantidad: 1 },
    { tipo: 'UDP', cantidad: 1 },
  ]);
  assert.deepEqual(analitica.ipsDestino, [
    { ip: '192.168.50.1', ataques: 3 },
    { ip: '192.168.50.4', ataques: 1 },
  ]);
  assert.deepEqual(analitica.protocolos, [
    { protocolo: 6, flujos: 3, ataques: 2 },
    { protocolo: 17, flujos: 3, ataques: 2 },
  ]);
  assert.deepEqual(analitica.puertosDestino, [
    { puerto: 0, ataques: 1 },
    { puerto: 53, ataques: 1 },
    { puerto: 80, ataques: 1 },
    { puerto: 443, ataques: 1 },
  ]);
  assert.deepEqual(analitica.horas, [
    { hora: '09', flujos: 1, ataques: 0 },
    { hora: '10', flujos: 4, ataques: 3 },
    { hora: '11', flujos: 1, ataques: 1 },
  ]);
  assert.equal(analitica.flujosAnalizados, 6);
});

test('rebuilding is idempotent and removes stale summary documents', { skip: omitir }, async () => {
  await db.collection('resumen_label').insertOne({ _id: 'Obsoleto', flujos: 99, generacion: 'vieja' });
  await recalcularResumenes(db, { coleccionFlujos: FLUJOS });
  await recalcularResumenes(db, { coleccionFlujos: FLUJOS });

  assert.equal(await db.collection('resumen_label').countDocuments({ _id: 'Obsoleto' }), 0);
  assert.equal((await getResumen(db)).totalFlujosEstimado, 6);
  const estado = await obtenerEstado(db, { coleccionFlujos: FLUJOS });
  assert.equal(estado.disponible, true);
  assert.equal(estado.desactualizado, false);
});

test('inserted flows are added incrementally without a full rebuild', { skip: omitir }, async () => {
  const nuevos = [
    { ...flujo('Syn', '2018-12-01 12:00:00', { 'Source IP': '172.16.0.7' }), _id: new ObjectId() },
    { ...flujo('BENIGN', '2018-12-01 12:30:00', { 'Flow Bytes/s': 0 }), _id: new ObjectId() },
  ];
  await db.collection(FLUJOS).insertMany(nuevos);
  assert.equal((await obtenerEstado(db, { coleccionFlujos: FLUJOS })).desactualizado, true);

  const resultado = await aplicarInserciones(db, nuevos.map((doc) => doc._id), { coleccionFlujos: FLUJOS });
  assert.deepEqual(resultado, { aplicados: 2 });

  const resumen = await getResumen(db);
  assert.equal(resumen.totalFlujosEstimado, 8);
  assert.equal(resumen.flujosDeAtaque, 5);
  assert.equal(resumen.tipoAtaqueMasFrecuente, 'Syn');
  assert.equal(resumen.bytesPorSegundoPromedio, (300 + 100 * 5 + 0) / 7);

  const analitica = await getAnalitica(7, 8, db);
  assert.deepEqual(analitica.series.at(-1), { fecha: '2018-12-01', total: 3, ataques: 2 });
  assert.deepEqual(analitica.tiposAtaque[0], { tipo: 'Syn', cantidad: 3 });
  assert.deepEqual(analitica.horas.at(-1), { hora: '12', flujos: 2, ataques: 1 });
  assert.ok((await getTopIps(5, db)).datos.some((item) => item.ip === '172.16.0.7'));

  // Los _id anteriores al corte del último recálculo ya están contados y se ignoran.
  const antiguos = await db.collection(FLUJOS).find({ Label: 'UDP' }).project({ _id: 1 }).toArray();
  await db.collection('resumen_estado').updateOne({ _id: 'resumenes' }, { $set: { corte: nuevos[0]._id } });
  assert.deepEqual(await aplicarInserciones(db, antiguos.map((doc) => doc._id), { coleccionFlujos: FLUJOS }), { aplicados: 0 });

  const estado = await obtenerEstado(db, { coleccionFlujos: FLUJOS });
  assert.equal(estado.insercionesIncrementales, 2);
  assert.equal(estado.totalResumido, 8);
  assert.equal(estado.desactualizado, false);
  const deltas = await db.listCollections({ name: /^resumen_delta_/ }).toArray();
  assert.equal(deltas.length, 0);
});

test('reading reports missing summaries with a dedicated error', { skip: omitir }, async () => {
  await db.collection('resumen_general').drop();
  await assert.rejects(() => getResumen(db), { code: 'RESUMENES_NO_DISPONIBLES' });
});
