import test from 'node:test';
import assert from 'node:assert/strict';
import { validarPipeline } from '../repositories/llmRepository.js';

test('accepts a read-only aggregation over known CIC-DDoS fields', () => {
  const pipeline = [
    { $match: { Label: { $ne: 'BENIGN' } } },
    { $group: { _id: '$Label', cantidad: { $sum: 1 } } },
    { $sort: { cantidad: -1 } },
  ];

  assert.equal(validarPipeline(pipeline), pipeline);
});

test('rejects write stages and cross-collection stages', () => {
  for (const stage of [{ $out: 'backup' }, { $merge: 'backup' }, { $lookup: { from: 'users' } }]) {
    assert.throws(() => validarPipeline([stage]), /no permitida/);
  }
});

test('rejects JavaScript expressions and unknown fields', () => {
  assert.throws(
    () => validarPipeline([{ $project: { value: { $function: { body: 'return 1' } } } }]),
    /Operador de consulta no permitido/,
  );
  assert.throws(
    () => validarPipeline([{ $match: { password: 'secret' } }]),
    /Campo no permitido/,
  );
});

test('caps generated limits and the number of stages', () => {
  assert.throws(() => validarPipeline([{ $limit: 101 }]), /entre 1 y 100/);
  assert.throws(() => validarPipeline(Array.from({ length: 9 }, () => ({ $limit: 1 }))), /entre 1 y 8/);
});

test('rechaza una colección no autorizada (resumen_base)', () => {
  assert.throws(
    () => validarPipeline([{ $limit: 1 }], 'resumen_base'),
    (error) => error.statusCode === 400 && /Colección no autorizada: resumen_base/.test(error.message),
  );
});

test('rejects filters that contain unsupported query operators', () => {
  assert.throws(
    () => validarPipeline([{ $match: { Label: { $regex: '.*' } } }]),
    /Operador de filtro no permitido/,
  );
});
