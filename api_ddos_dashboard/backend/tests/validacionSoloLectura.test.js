import test from 'node:test';
import assert from 'node:assert/strict';
import { validarPipeline } from '../repositories/llmRepository.js';
import { CAMPOS_FLUJO, NOMBRES_CAMPOS_FLUJO } from '../repositories/esquemaFlujos.js';
import { systemPrompt } from '../services/consultaService.js';

const etapasValidas = [
  { $match: { Label: { $ne: 'BENIGN' } } },
  { $group: { _id: '$Label', cantidad: { $sum: 1 } } },
];

const rechaza = (pipeline, patron) => {
  assert.throws(() => validarPipeline(pipeline), (error) => {
    assert.match(error.message, patron);
    assert.equal(error.statusCode, 422);
    return true;
  });
};

test('rechaza $out sola, al final de un pipeline válido y en su forma de objeto', () => {
  rechaza([{ $out: 'copia' }], /Etapa de agregación no permitida: \$out/);
  rechaza([...etapasValidas, { $out: 'copia' }], /Etapa de agregación no permitida: \$out/);
  rechaza([...etapasValidas, { $out: { db: 'admin', coll: 'copia' } }], /no permitida: \$out/);
});

test('rechaza $merge sola, al final de un pipeline válido y con whenMatched', () => {
  rechaza([{ $merge: 'resumen_label' }], /Etapa de agregación no permitida: \$merge/);
  rechaza([...etapasValidas, { $merge: { into: 'resumen_label', whenMatched: 'replace' } }], /no permitida: \$merge/);
});

test('rechaza una etapa que mezcla un operador permitido con $out o $merge', () => {
  rechaza([{ $match: { Label: 'BENIGN' }, $out: 'copia' }], /no permitida/);
  rechaza([{ $limit: 5, $merge: 'copia' }], /no permitida/);
});

test('rechaza $function en $project, $group, anidada en $cond y dentro de $match.$expr', () => {
  const funcion = { $function: { body: 'function () { return 1; }', args: [], lang: 'js' } };
  rechaza([{ $project: { valor: funcion } }], /Operador de consulta no permitido: \$function/);
  rechaza([{ $group: { _id: '$Label', total: { $sum: funcion } } }], /Operador de consulta no permitido: \$function/);
  rechaza([{ $project: { valor: { $cond: [{ $eq: ['$Protocol', 6] }, funcion, 0] } } }], /\$function/);
  rechaza([{ $match: { $expr: funcion } }], /Operador de filtro no permitido: \$expr/);
});

test('rechaza otras vías de código arbitrario: $accumulator, $where y $expr', () => {
  rechaza([{ $group: { _id: null, x: { $accumulator: { init: 'function(){}' } } } }], /no permitido: \$accumulator/);
  rechaza([{ $match: { $where: 'sleep(1000)' } }], /Operador de filtro no permitido: \$where/);
  rechaza([{ $match: { Label: { $where: 'true' } } }], /Operador de filtro no permitido: \$where/);
});

test('rechaza etapas de lectura entre colecciones', () => {
  for (const etapa of [{ $lookup: { from: 'x' } }, { $unionWith: 'x' }, { $graphLookup: { from: 'x' } }]) {
    rechaza([etapa], /no permitida/);
  }
});

test('el esquema coincide con los campos reales de flujos_limpia', () => {
  assert.equal(NOMBRES_CAMPOS_FLUJO.length, 88);
  assert.equal(new Set(NOMBRES_CAMPOS_FLUJO).size, 88);
  for (const nombre of NOMBRES_CAMPOS_FLUJO) {
    assert.equal(nombre, nombre.trim(), `"${nombre}" tiene espacios sobrantes`);
  }
  for (const nombre of ['Fwd Header Length', 'Fwd Header Length_1', 'Flow Bytes/s', 'Init_Win_bytes_forward', 'SimillarHTTP']) {
    assert.ok(NOMBRES_CAMPOS_FLUJO.includes(nombre), nombre);
  }
  const tasa = CAMPOS_FLUJO.find(({ nombre }) => nombre === 'Flow Bytes/s');
  assert.match(tasa.tipo, /NO existe cuando el valor original era Infinity o NaN/);
  const timestamp = CAMPOS_FLUJO.find(({ nombre }) => nombre === 'Timestamp');
  assert.match(timestamp.tipo, /YYYY-MM-DD HH:MM:SS/);
});

test('el prompt envía todos los campos reales y acepta los nuevos en la validación', () => {
  for (const nombre of NOMBRES_CAMPOS_FLUJO) {
    assert.ok(systemPrompt.includes(`"${nombre}"`), nombre);
  }
  assert.doesNotThrow(() => validarPipeline([
    { $match: { 'Fwd Header Length_1': { $gt: 0 }, 'Flow Bytes/s': { $exists: true } } },
    { $group: { _id: { $substrBytes: ['$Timestamp', 11, 2] }, flujos: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]));
});
