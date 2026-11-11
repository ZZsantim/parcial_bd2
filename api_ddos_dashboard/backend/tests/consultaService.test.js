import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararPipelineParaPregunta } from '../services/consultaService.js';

test('preserves benign and attack groups when the user asks for both counts', () => {
  const resultado = prepararPipelineParaPregunta(
    '¿Cuántos flujos son benignos y cuántos son ataques?',
    'flujos_limpia',
    [{ $match: { Label: { $ne: 'BENIGN' } } }, { $group: { _id: '$Label', cantidad: { $sum: 1 } } }],
  );

  assert.deepEqual(resultado, {
    coleccion: 'resumen_label',
    pipeline: [
      { $group: { _id: { $cond: ['$esAtaque', 'Ataque', 'BENIGN'] }, flujos: { $sum: '$flujos' } } },
      { $sort: { _id: 1 } },
    ],
  });
});

test('excludes benign flows from attack-only questions', () => {
  const { pipeline } = prepararPipelineParaPregunta(
    '¿Qué ataques aparecen?',
    'flujos_limpia',
    [{ $group: { _id: '$Label', cantidad: { $sum: 1 } } }],
  );

  assert.deepEqual(pipeline[0], {
    $match: {
      Label: { $ne: 'BENIGN' },
    },
  });
});
