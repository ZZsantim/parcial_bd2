import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComparacion, parseFiltros } from '../controllers/informeController.js';
import { matchFiltros } from '../repositories/informeRepository.js';

test('without filters the reports keep reading the summaries', () => {
  assert.deepEqual(parseFiltros({ limit: '5', days: '7' }), { filtros: {} });
  assert.equal(matchFiltros({}), null);
});

test('accepts valid filters and normalizes dates to the Timestamp format', () => {
  const { filtros } = parseFiltros({ label: 'DrDoS_DNS', protocol: '17', desde: '2018-12-01', hasta: '2018-12-01' });
  assert.deepEqual(filtros, {
    label: 'DrDoS_DNS',
    protocol: 17,
    desde: '2018-12-01 00:00:00',
    hasta: '2018-12-01 23:59:59',
  });
  assert.deepEqual(matchFiltros(filtros), {
    Label: 'DrDoS_DNS',
    Protocol: 17,
    Timestamp: { $gte: '2018-12-01 00:00:00', $lte: '2018-12-01 23:59:59' },
  });
  assert.deepEqual(parseFiltros({ desde: '2018-11-03 10:15:00' }).filtros, { desde: '2018-11-03 10:15:00' });
  assert.deepEqual(parseFiltros({ protocol: '0' }).filtros, { protocol: 0 });
});

test('rejects invalid filters with a clear message', () => {
  const invalidos = [
    [{ label: '' }, /label/],
    [{ label: ['Syn', 'UDP'] }, /label/],
    [{ label: 'x'.repeat(61) }, /label/],
    [{ protocol: 'tcp' }, /protocol/],
    [{ protocol: '6.5' }, /protocol/],
    [{ protocol: '-1' }, /protocol/],
    [{ protocol: '256' }, /protocol/],
    [{ desde: '01-12-2018' }, /desde/],
    [{ desde: '2018-02-30' }, /desde/],
    [{ hasta: '2018-12-01 24:00:00' }, /hasta/],
    [{ hasta: '2018-12-01T10:00:00' }, /hasta/],
    [{ desde: { $gt: '' } }, /desde/],
    [{ desde: '2018-12-02', hasta: '2018-12-01' }, /posterior/],
  ];
  for (const [query, mensaje] of invalidos) {
    const { error, filtros } = parseFiltros(query);
    assert.equal(filtros, undefined, JSON.stringify(query));
    assert.match(error, mensaje, JSON.stringify(query));
  }
});

test('the comparison requires both periods with valid dates', () => {
  assert.deepEqual(
    parseComparacion({ desdeA: '2018-12-01', hastaA: '2018-12-01', desdeB: '2018-11-03', hastaB: '2018-11-03 12:59:59' }),
    {
      a: { desde: '2018-12-01 00:00:00', hasta: '2018-12-01 23:59:59' },
      b: { desde: '2018-11-03 00:00:00', hasta: '2018-11-03 12:59:59' },
    },
  );
  assert.match(parseComparacion({ desdeA: '2018-12-01', hastaA: '2018-12-01' }).error, /desdeB y hastaB/);
  assert.match(parseComparacion({ desdeA: '2018-13-01', hastaA: '2018-12-01', desdeB: '2018-11-03', hastaB: '2018-11-03' }).error, /desdeA/);
  assert.match(parseComparacion({ desdeA: '2018-12-02', hastaA: '2018-12-01', desdeB: '2018-11-03', hastaB: '2018-11-03' }).error, /posterior/);
  assert.match(parseComparacion({ desdeA: '2018-12-01 10:30:00', hastaA: '2018-12-01', desdeB: '2018-11-03', hastaB: '2018-11-03' }).error, /horas completas/);
  assert.match(parseComparacion({ desdeA: '2018-12-01', hastaA: '2018-12-01', desdeB: '2018-11-03', hastaB: '2018-11-03 12:00:00' }).error, /horas completas/);
});
