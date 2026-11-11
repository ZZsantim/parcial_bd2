// npm run db:resumenes [-- --forzar]
// Recalcula las colecciones resumen desde la colección de flujos completa. Solo lee la
// colección de flujos; escribe en resumen_* con $merge. Se puede repetir: cada ejecución
// reemplaza los documentos y elimina los de la generación anterior.
import { closeDB, connectDB, flowsCollectionName, getDB } from '../config/db.js';
import { recalcularResumenes } from '../services/resumenService.js';

const forzar = process.argv.includes('--forzar');

try {
  await connectDB();
  const estado = await recalcularResumenes(getDB(), {
    coleccionFlujos: flowsCollectionName,
    forzar,
    log: (mensaje) => console.log(mensaje),
  });
  console.log(`[Resúmenes] Listo en ${(estado.duracionMs / 1000).toFixed(1)} s (generación ${estado.generacion}).`);
  console.log(JSON.stringify(estado.tiemposMs, null, 2));
} catch (error) {
  if (error.code === 'RECALCULO_EN_CURSO') {
    console.error(`[Resúmenes] ${error.message} Usa "npm run db:resumenes -- --forzar" si el anterior quedó colgado.`);
  } else {
    console.error('[Resúmenes] No se pudieron generar los resúmenes:', error.message);
  }
  process.exitCode = 1;
} finally {
  await closeDB();
}
