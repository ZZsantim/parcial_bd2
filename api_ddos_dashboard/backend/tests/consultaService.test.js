import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararPipelineParaPregunta } from '../services/consultaService.js';

test('preserves benign and attack groups when the user asks for both counts', () => {
  const pipeline = prepararPipelineParaPregunta(
    '¿Cuántos flujos son benignos y cuántos son ataques?',
    [{ $match: { Label: { $ne: 'BENIGN' } } }, { $group: { _id: '$Label', cantidad: { $sum: 1 } } }],
  );

  assert.deepEqual(pipeline, [
    { $sort: { Label: 1 } },
    {
      $group: {
        _id: {
          $cond: [
            { $eq: ['$Label', 'BENIGN'] },
            'BENIGN',
            'Ataque',
          ],
        },
        flujos: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
});

test('excludes benign flows from attack-only questions', () => {
  const pipeline = prepararPipelineParaPregunta(
    '¿Qué ataques aparecen?',
    [{ $group: { _id: '$Label', cantidad: { $sum: 1 } } }],
  );

  assert.deepEqual(pipeline[0], {
    $match: {
      Label: { $ne: 'BENIGN' },
    },
  });
});
