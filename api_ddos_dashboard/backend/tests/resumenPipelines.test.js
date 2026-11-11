import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLECCIONES,
  DERIVACIONES,
  etapaMerge,
  pipelineBase,
  pipelineDerivacion,
  pipelineLecturaAnalitica,
  pipelineLecturaResumen,
} from '../repositories/resumenPipelines.js';

test('the base pipeline scans flows once with $facet and writes resumen_base via $merge', () => {
  const pipeline = pipelineBase({ match: { _id: { $lt: 'corte' } }, generacion: 'g1' });

  assert.deepEqual(pipeline[0], { $match: { _id: { $lt: 'corte' } } });
  const facet = pipeline.find((stage) => stage.$facet).$facet;
  assert.deepEqual(Object.keys(facet), ['tiempo', 'ipOrigen', 'ipDestino', 'puerto']);
  assert.equal(pipeline.filter((stage) => stage.$facet).length, 1);
  assert.deepEqual(pipeline.at(-1), {
    $merge: { into: COLECCIONES.base, on: '_id', whenMatched: 'replace', whenNotMatched: 'insert' },
  });
  assert.equal(pipeline.at(-2).$set.generacion, 'g1');
});

test('there is one derivation per summary collection and every one ends in $merge', () => {
  const destinos = DERIVACIONES.map((derivacion) => derivacion.destino);
  assert.deepEqual(destinos.sort(), [
    'resumen_diario',
    'resumen_general',
    'resumen_hora',
    'resumen_label',
    'resumen_protocolo',
    'resumen_puerto_destino',
    'resumen_top_ips_destino',
    'resumen_top_ips_origen',
  ]);
  for (const derivacion of DERIVACIONES) {
    const pipeline = pipelineDerivacion(derivacion, 'reemplazar', 'g1');
    assert.equal(pipeline.at(-1).$merge.into, derivacion.destino);
  }
});

test('incremental $merge adds counters and unions labels instead of replacing', () => {
  const stage = etapaMerge('resumen_top_ips_origen', 'sumar', { sumar: ['ataques'], unir: ['etiquetas'] });
  const [{ $set: set }] = stage.$merge.whenMatched;

  assert.deepEqual(set.ataques, { $add: [{ $ifNull: ['$ataques', 0] }, { $ifNull: ['$$new.ataques', 0] }] });
  assert.ok(set.etiquetas.$sortArray.input.$setUnion);
  assert.equal(stage.$merge.whenNotMatched, 'insert');
  assert.throws(() => etapaMerge('x', 'otro'), /Modo de \$merge desconocido/);
});

test('read pipelines start from resumen_general and look up the other summaries', () => {
  const analitica = pipelineLecturaAnalitica(7, 8);
  assert.deepEqual(analitica[0], { $match: { _id: 'general' } });
  const lookups = analitica.filter((stage) => stage.$lookup).map((stage) => stage.$lookup.from);
  assert.deepEqual(lookups, [
    'resumen_diario',
    'resumen_label',
    'resumen_top_ips_destino',
    'resumen_protocolo',
    'resumen_puerto_destino',
    'resumen_hora',
  ]);
  const tipos = analitica.find((stage) => stage.$lookup?.as === 'tiposAtaque').$lookup.pipeline;
  assert.ok(!tipos.some((stage) => stage.$limit), 'tiposAtaque must return every attack class');

  const resumen = pipelineLecturaResumen().at(-1).$project;
  assert.equal(resumen.totalFlujosEstimado, '$totalFlujos');
  assert.equal(resumen.flujosAnalizados, '$totalFlujos');
});
