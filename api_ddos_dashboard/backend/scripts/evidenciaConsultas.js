// node backend/scripts/evidenciaConsultas.js [salida.json]
// Envía las preguntas de evidencia a POST /api/consultas (la API debe estar en marcha con
// npm start) y lee las colecciones resumen_* para comparar los números. Solo lee MongoDB.
import fs from 'fs/promises';
import { closeDB, connectDB, getDB } from '../config/db.js';
import { COLECCIONES, ID_GENERAL } from '../repositories/resumenPipelines.js';

const salida = process.argv[2] || 'evidencia-consultas.json';
const api = (process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '');

const preguntas = [
  { id: 'a', pregunta: '¿Cuáles son los tipos de ataque más frecuentes?' },
  { id: 'b', pregunta: '¿Cuántos flujos son benignos y cuántos son ataques?' },
  { id: 'c', pregunta: '¿Qué IP de origen tiene más ataques?' },
  { id: 'd', pregunta: '¿Cuántos flujos hay por protocolo?' },
  { id: 'e', pregunta: '¿Cuántos ataques hay en cada hora del día?' },
];

const preguntar = async (pregunta) => {
  const inicio = Date.now();
  try {
    const response = await fetch(`${api}/api/consultas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: pregunta }),
      signal: AbortSignal.timeout(300_000),
    });
    return { http: response.status, ms: Date.now() - inicio, respuesta: await response.json() };
  } catch (error) {
    return { http: null, ms: Date.now() - inicio, error: error.message };
  }
};

const consultas = [];
for (const item of preguntas) {
  console.error(`[Evidencia] ${item.id}) ${item.pregunta}`);
  consultas.push({ ...item, ...(await preguntar(item.pregunta)) });
}

const salud = await fetch(`${api}/api/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));

await connectDB();
const db = getDB();
const existentes = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
const leer = async (nombre, consulta) => (existentes.has(nombre) ? consulta(db.collection(nombre)) : null);

const resumenes = {
  general: await leer(COLECCIONES.general, (c) => c.findOne({ _id: ID_GENERAL })),
  label: await leer(COLECCIONES.label, (c) => c.find().sort({ flujos: -1, _id: 1 }).toArray()),
  ipsOrigen: await leer(COLECCIONES.ipsOrigen, (c) => c.find().sort({ ataques: -1, _id: 1 }).limit(5).toArray()),
  protocolo: await leer(COLECCIONES.protocolo, (c) => c.find().sort({ flujos: -1, _id: 1 }).toArray()),
  hora: await leer(COLECCIONES.hora, (c) => c.find().sort({ _id: 1 }).toArray()),
  estado: await leer(COLECCIONES.estado, (c) => c.findOne({})),
};
await closeDB();

await fs.writeFile(salida, `${JSON.stringify({ fecha: new Date().toISOString(), api, salud, consultas, resumenes }, null, 2)}\n`);
console.error(`[Evidencia] Guardado en ${salida}`);
