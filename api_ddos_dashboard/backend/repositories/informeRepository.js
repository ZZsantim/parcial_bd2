import { getFlowsCollection } from '../config/db.js';
import { serializeFlujo } from '../models/informe.js';

const SAMPLE_SIZE = 10_000;
// flujos_limpia normaliza todas las variantes de benigno a exactamente "BENIGN"
const benignLabels = ['BENIGN'];

const isAttack = {
  $not: [{ $in: ['$Label', benignLabels] }],
};

const recentSampleStages = [
  { $sort: { Timestamp: -1 } },
  { $limit: SAMPLE_SIZE },
];

const seriesStages = (days) => [
  { $match: { Timestamp: { $type: 'string' } } },
  {
    $group: {
      _id: { $substrBytes: ['$Timestamp', 0, 10] },
      total: { $sum: 1 },
      ataques: { $sum: { $cond: [isAttack, 1, 0] } },
    },
  },
  { $sort: { _id: -1 } },
  { $limit: days },
  { $sort: { _id: 1 } },
  { $project: { _id: 0, fecha: '$_id', total: 1, ataques: 1 } },
];

export const getResumen = async () => {
  const collection = getFlowsCollection();
  const [totalFlujosEstimado, [result = null] = []] = await Promise.all([
    collection.estimatedDocumentCount(),
    collection
      .aggregate(
        [
          ...recentSampleStages,
          {
            $facet: {
              metricas: [
                {
                  $group: {
                    _id: null,
                    flujosAnalizados: { $sum: 1 },
                    flujosDeAtaque: { $sum: { $cond: [isAttack, 1, 0] } },
                    bytesPorSegundoPromedio: {
                      $avg: {
                        $let: {
                          vars: {
                            tasa: {
                              $convert: {
                                input: '$Flow Bytes/s',
                                to: 'double',
                                onError: null,
                                onNull: null,
                              },
                            },
                          },
                          in: {
                            $cond: [
                              {
                                $and: [
                                  { $gte: ['$$tasa', 0] },
                                  { $lte: ['$$tasa', 1e308] },
                                ],
                              },
                              '$$tasa',
                              null,
                            ],
                          },
                        },
                      },
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    flujosAnalizados: 1,
                    flujosDeAtaque: 1,
                    porcentajeDeAtaque: {
                      $multiply: [
                        { $divide: ['$flujosDeAtaque', '$flujosAnalizados'] },
                        100,
                      ],
                    },
                    bytesPorSegundoPromedio: { $ifNull: ['$bytesPorSegundoPromedio', 0] },
                  },
                },
              ],
              tipoAtaqueMasFrecuente: [
                { $match: { Label: { $exists: true, $nin: benignLabels } } },
                { $group: { _id: '$Label', cantidad: { $sum: 1 } } },
                { $sort: { cantidad: -1, _id: 1 } },
                { $limit: 1 },
                { $project: { _id: 0, tipo: '$_id', cantidad: 1 } },
              ],
            },
          },
        ],
        { maxTimeMS: 15_000 },
      )
      .toArray(),
  ]);

  const metricas = result?.metricas[0] ?? {
    flujosAnalizados: 0,
    flujosDeAtaque: 0,
    porcentajeDeAtaque: 0,
    bytesPorSegundoPromedio: 0,
  };

  return {
    totalFlujosEstimado,
    ...metricas,
    tipoAtaqueMasFrecuente: result?.tipoAtaqueMasFrecuente[0]?.tipo ?? null,
  };
};

export const getTopIps = async (limit = 5) => {
  const [result = {}] = await getFlowsCollection()
    .aggregate(
      [
        ...recentSampleStages,
        {
          $facet: {
            datos: [
              { $match: { Label: { $exists: true, $nin: benignLabels }, 'Source IP': { $exists: true, $ne: null } } },
              {
                $group: {
                  _id: '$Source IP',
                  ataques: { $sum: 1 },
                  etiquetas: { $addToSet: '$Label' },
                },
              },
              { $sort: { ataques: -1, _id: 1 } },
              { $limit: limit },
              { $project: { _id: 0, ip: '$_id', ataques: 1, etiquetas: 1 } },
            ],
            metadata: [{ $count: 'flujosAnalizados' }],
          },
        },
      ],
      { maxTimeMS: 15_000 },
    )
    .toArray();

  return {
    flujosAnalizados: result.metadata[0]?.flujosAnalizados ?? 0,
    datos: result.datos ?? [],
  };
};

export const getSeries = async (days = 7) => {
  const [result = {}] = await getFlowsCollection()
    .aggregate(
      [
        ...recentSampleStages,
        {
          $facet: {
            datos: seriesStages(days),
            metadata: [{ $count: 'flujosAnalizados' }],
          },
        },
      ],
      { maxTimeMS: 15_000 },
    )
    .toArray();

  return {
    flujosAnalizados: result.metadata[0]?.flujosAnalizados ?? 0,
    datos: result.datos ?? [],
  };
};

export const getAnalitica = async (days = 7, limit = 8) => {
  const [result = {}] = await getFlowsCollection()
    .aggregate(
      [
        ...recentSampleStages,
        {
          $facet: {
            metadata: [{ $count: 'flujosAnalizados' }],
            series: seriesStages(days),
            tiposAtaque: [
              { $match: { Label: { $exists: true, $nin: benignLabels } } },
              { $group: { _id: '$Label', cantidad: { $sum: 1 } } },
              { $sort: { cantidad: -1, _id: 1 } },
              { $limit: limit },
              { $project: { _id: 0, tipo: '$_id', cantidad: 1 } },
            ],
            ipsDestino: [
              {
                $match: {
                  Label: { $exists: true, $nin: benignLabels },
                  'Destination IP': { $exists: true, $ne: null },
                },
              },
              { $group: { _id: '$Destination IP', ataques: { $sum: 1 } } },
              { $sort: { ataques: -1, _id: 1 } },
              { $limit: limit },
              { $project: { _id: 0, ip: '$_id', ataques: 1 } },
            ],
            protocolos: [
              { $match: { Protocol: { $exists: true, $ne: null } } },
              {
                $group: {
                  _id: '$Protocol',
                  flujos: { $sum: 1 },
                  ataques: { $sum: { $cond: [isAttack, 1, 0] } },
                },
              },
              { $sort: { flujos: -1, _id: 1 } },
              { $limit: limit },
              { $project: { _id: 0, protocolo: '$_id', flujos: 1, ataques: 1 } },
            ],
            puertosDestino: [
              {
                $match: {
                  Label: { $exists: true, $nin: benignLabels },
                  'Destination Port': { $exists: true, $ne: null },
                },
              },
              { $group: { _id: '$Destination Port', ataques: { $sum: 1 } } },
              { $sort: { ataques: -1, _id: 1 } },
              { $limit: limit },
              { $project: { _id: 0, puerto: '$_id', ataques: 1 } },
            ],
            horas: [
              { $match: { Timestamp: { $type: 'string' } } },
              {
                $group: {
                  _id: { $substrBytes: ['$Timestamp', 11, 2] },
                  flujos: { $sum: 1 },
                  ataques: { $sum: { $cond: [isAttack, 1, 0] } },
                },
              },
              { $sort: { _id: 1 } },
              { $project: { _id: 0, hora: '$_id', flujos: 1, ataques: 1 } },
            ],
          },
        },
      ],
      { maxTimeMS: 15_000, allowDiskUse: false },
    )
    .toArray();

  return {
    flujosAnalizados: result.metadata?.[0]?.flujosAnalizados ?? 0,
    series: result.series ?? [],
    tiposAtaque: result.tiposAtaque ?? [],
    ipsDestino: result.ipsDestino ?? [],
    protocolos: result.protocolos ?? [],
    puertosDestino: result.puertosDestino ?? [],
    horas: result.horas ?? [],
  };
};

export const getInformes = async (limit = 20) => {
  const collection = getFlowsCollection();
  const registros = await collection
    .find(
      {},
      {
        projection: {
          Timestamp: 1,
          'Source IP': 1,
          'Destination IP': 1,
          'Source Port': 1,
          'Destination Port': 1,
          Protocol: 1,
          Label: 1,
          'Flow Duration': 1,
          'Flow Bytes/s': 1,
          'Total Fwd Packets': 1,
          'Total Backward Packets': 1,
        },
      },
    )
    .sort({ Timestamp: -1 })
    .limit(limit)
    .toArray();

  return registros.map(serializeFlujo);
};

export default {
  getResumen,
  getTopIps,
  getSeries,
  getAnalitica,
  getInformes,
};
