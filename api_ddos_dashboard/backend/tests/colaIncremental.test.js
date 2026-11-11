import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { crearColaIncremental } from '../services/resumenService.js';

test('groups inserted ids into batches and applies them one at a time', async () => {
  const lotes = [];
  const cola = crearColaIncremental({
    esperaMs: 5,
    maxLote: 3,
    aplicar: async (ids) => {
      lotes.push(ids);
      return { aplicados: ids.length };
    },
  });
  for (let i = 0; i < 7; i += 1) cola.agregar(i);
  await esperar(60);
  await cola.detener();

  assert.deepEqual(lotes, [[0, 1, 2], [3, 4, 5], [6]]);
  assert.equal(cola.pendientes(), 0);
});

test('keeps ids while a full recalculation is running and retries later', async () => {
  let llamadas = 0;
  const aplicados = [];
  const cola = crearColaIncremental({
    esperaMs: 5,
    reintentoMs: 10,
    aplicar: async (ids) => {
      llamadas += 1;
      if (llamadas === 1) return { aplazado: true };
      aplicados.push(...ids);
      return { aplicados: ids.length };
    },
  });
  cola.agregar('a');
  cola.agregar('b');
  await esperar(80);
  await cola.detener();

  assert.equal(llamadas, 2);
  assert.deepEqual(aplicados, ['a', 'b']);
});

test('reports failures and overflow instead of growing without bound', async () => {
  const fallos = [];
  let desbordes = 0;
  const cola = crearColaIncremental({
    esperaMs: 5,
    maxPendientes: 2,
    aplicar: async () => { throw new Error('boom'); },
    alFallar: (error, lote) => fallos.push([error.message, lote]),
    alDesbordar: () => { desbordes += 1; },
  });
  cola.agregar(1);
  cola.agregar(2);
  cola.agregar(3);
  assert.equal(desbordes, 1);
  assert.equal(cola.pendientes(), 0);

  cola.agregar(4);
  await esperar(40);
  await cola.detener();
  assert.deepEqual(fallos, [['boom', [4]]]);
});
