// Definición de las colecciones resumen y de las agregaciones que las generan.
//
// Flujo de datos (todo dentro de MongoDB, con $merge):
//
//   flujos_limpia ──(1 recorrido, $facet)──> resumen_base ──(8 agregaciones)──> resumen_*
//
// resumen_base es un cubo pequeño con cuatro dimensiones:
//   - dim "tiempo":     (label, fecha, hora, protocolo) -> flujos, bpsSuma, bpsN
//   - dim "ipOrigen":   (ip, label) de flujos de ataque  -> flujos
//   - dim "ipDestino":  (ip) de flujos de ataque         -> flujos
//   - dim "puerto":     (puerto) de flujos de ataque     -> flujos
// Todas las cifras son sumas, de modo que un lote de flujos nuevos se puede sumar con el
// mismo pipeline (modo "sumar") sin recorrer de nuevo los 70 M de documentos.

// flujos_limpia normaliza todas las variantes de benigno a exactamente "BENIGN"
export const BENIGN_LABELS = ['BENIGN'];

export const COLECCIONES = Object.freeze({
  base: 'resumen_base',
  general: 'resumen_general',
  diario: 'resumen_diario',
  label: 'resumen_label',
  ipsOrigen: 'resumen_top_ips_origen',
  ipsDestino: 'resumen_top_ips_destino',
  protocolo: 'resumen_protocolo',
  puerto: 'resumen_puerto_destino',
  hora: 'resumen_hora',
  estado: 'resumen_estado',
});

export const ID_GENERAL = 'general';

// Igual que el informe original: un flujo sin Label cuenta como ataque.
const esAtaque = (campo) => ({ $not: [{ $in: [campo, BENIGN_LABELS] }] });

const tasaValida = {
  $let: {
    vars: {
      tasa: {
        $convert: { input: '$Flow Bytes/s', to: 'double', onError: null, onNull: null },
      },
    },
    in: {
      $cond: [
        { $and: [{ $gte: ['$$tasa', 0] }, { $lte: ['$$tasa', 1e308] }] },
        '$$tasa',
        null,
      ],
    },
  },
};

const parteTimestamp = (inicio, largo) => ({
  $cond: [
    { $eq: [{ $type: '$Timestamp' }, 'string'] },
    { $substrBytes: ['$Timestamp', inicio, largo] },
    null,
  ],
});

// Reduce cada flujo a los campos que usan los informes antes del $facet.
const proyeccionFlujo = {
  $project: {
    _id: 0,
    label: { $ifNull: ['$Label', null] },
    fecha: parteTimestamp(0, 10),
    hora: parteTimestamp(11, 2),
    protocolo: { $ifNull: ['$Protocol', null] },
    ipOrigen: { $ifNull: ['$Source IP', null] },
    ipDestino: { $ifNull: ['$Destination IP', null] },
    puerto: { $ifNull: ['$Destination Port', null] },
    tasa: tasaValida,
  },
};

const ataqueCon = (campo) => ({
  $match: { label: { $ne: null, $nin: BENIGN_LABELS }, [campo]: { $ne: null } },
});

// Convierte la salida de un $group en un documento de resumen_base con _id {dim, ...clave}.
const aDocumentoBase = (dim) => ({
  $replaceWith: {
    $mergeObjects: [
      { _id: { $mergeObjects: [{ dim }, '$_id'] }, dim },
      '$_id',
      { flujos: '$flujos', bpsSuma: '$bpsSuma', bpsN: '$bpsN' },
    ],
  },
});

const facetBase = {
  $facet: {
    tiempo: [
      {
        $group: {
          _id: { label: '$label', fecha: '$fecha', hora: '$hora', protocolo: '$protocolo' },
          flujos: { $sum: 1 },
          bpsSuma: { $sum: '$tasa' },
          bpsN: { $sum: { $cond: [{ $eq: ['$tasa', null] }, 0, 1] } },
        },
      },
      aDocumentoBase('tiempo'),
    ],
    ipOrigen: [
      ataqueCon('ipOrigen'),
      { $group: { _id: { ip: '$ipOrigen', label: '$label' }, flujos: { $sum: 1 } } },
      aDocumentoBase('ipOrigen'),
    ],
    ipDestino: [
      ataqueCon('ipDestino'),
      { $group: { _id: { ip: '$ipDestino' }, flujos: { $sum: 1 } } },
      aDocumentoBase('ipDestino'),
    ],
    puerto: [
      ataqueCon('puerto'),
      { $group: { _id: { puerto: '$puerto' }, flujos: { $sum: 1 } } },
      aDocumentoBase('puerto'),
    ],
  },
};

/**
 * $merge en modo "reemplazar" (recálculo completo) o "sumar" (incremento con flujos nuevos).
 */
export const etapaMerge = (into, modo, { sumar = [], unir = [] } = {}) => {
  if (modo === 'reemplazar') {
    return { $merge: { into, on: '_id', whenMatched: 'replace', whenNotMatched: 'insert' } };
  }
  if (modo !== 'sumar') throw new Error(`Modo de $merge desconocido: ${modo}`);

  const set = { actualizadoEn: '$$new.actualizadoEn' };
  for (const campo of sumar) {
    set[campo] = { $add: [{ $ifNull: [`$${campo}`, 0] }, { $ifNull: [`$$new.${campo}`, 0] }] };
  }
  for (const campo of unir) {
    set[campo] = {
      $sortArray: {
        input: { $setUnion: [{ $ifNull: [`$${campo}`, []] }, { $ifNull: [`$$new.${campo}`, []] }] },
        sortBy: 1,
      },
    };
  }
  return { $merge: { into, on: '_id', whenMatched: [{ $set: set }], whenNotMatched: 'insert' } };
};

export const CAMPOS_BASE = ['flujos', 'bpsSuma', 'bpsN'];

/**
 * Pipeline sobre flujos_limpia que agrupa los flujos que cumplen `match` y los escribe
 * con $merge en `destino` (resumen_base o una colección delta temporal).
 */
export const pipelineBase = ({ match = {}, destino = COLECCIONES.base, generacion = null } = {}) => [
  { $match: match },
  proyeccionFlujo,
  facetBase,
  { $project: { docs: { $concatArrays: ['$tiempo', '$ipOrigen', '$ipDestino', '$puerto'] } } },
  { $unwind: '$docs' },
  { $replaceWith: '$docs' },
  { $set: { actualizadoEn: '$$NOW', ...(generacion ? { generacion } : {}) } },
  etapaMerge(destino, 'reemplazar'),
];

const sumaSiAtaque = { $sum: { $cond: [esAtaque('$label'), '$flujos', 0] } };
const conFecha = { dim: 'tiempo', fecha: { $ne: null }, hora: { $ne: null } };

/**
 * Agregaciones que leen resumen_base (o un delta con la misma forma) y producen cada
 * colección resumen. `sumar`/`unir` indican cómo combinar documentos en modo incremental.
 */
export const DERIVACIONES = Object.freeze([
  {
    destino: COLECCIONES.general,
    sumar: ['totalFlujos', 'flujosDeAtaque', 'bpsSuma', 'bpsN'],
    etapas: [
      { $match: { dim: 'tiempo' } },
      {
        $group: {
          _id: ID_GENERAL,
          totalFlujos: { $sum: '$flujos' },
          flujosDeAtaque: sumaSiAtaque,
          bpsSuma: { $sum: '$bpsSuma' },
          bpsN: { $sum: '$bpsN' },
        },
      },
    ],
  },
  {
    destino: COLECCIONES.label,
    sumar: ['flujos'],
    etapas: [
      { $match: { dim: 'tiempo' } },
      { $group: { _id: '$label', flujos: { $sum: '$flujos' } } },
      { $set: { esAtaque: esAtaque('$_id') } },
    ],
  },
  {
    destino: COLECCIONES.diario,
    sumar: ['total', 'ataques'],
    etapas: [
      { $match: conFecha },
      { $group: { _id: '$fecha', total: { $sum: '$flujos' }, ataques: sumaSiAtaque } },
    ],
  },
  {
    destino: COLECCIONES.hora,
    sumar: ['flujos', 'ataques'],
    etapas: [
      { $match: conFecha },
      { $group: { _id: '$hora', flujos: { $sum: '$flujos' }, ataques: sumaSiAtaque } },
    ],
  },
  {
    destino: COLECCIONES.protocolo,
    sumar: ['flujos', 'ataques'],
    etapas: [
      { $match: { dim: 'tiempo', protocolo: { $ne: null } } },
      { $group: { _id: '$protocolo', flujos: { $sum: '$flujos' }, ataques: sumaSiAtaque } },
    ],
  },
  {
    destino: COLECCIONES.ipsOrigen,
    sumar: ['ataques'],
    unir: ['etiquetas'],
    etapas: [
      { $match: { dim: 'ipOrigen' } },
      { $group: { _id: '$ip', ataques: { $sum: '$flujos' }, etiquetas: { $addToSet: '$label' } } },
      { $set: { etiquetas: { $sortArray: { input: '$etiquetas', sortBy: 1 } } } },
    ],
  },
  {
    destino: COLECCIONES.ipsDestino,
    sumar: ['ataques'],
    etapas: [
      { $match: { dim: 'ipDestino' } },
      { $group: { _id: '$ip', ataques: { $sum: '$flujos' } } },
    ],
  },
  {
    destino: COLECCIONES.puerto,
    sumar: ['ataques'],
    etapas: [
      { $match: { dim: 'puerto' } },
      { $group: { _id: '$puerto', ataques: { $sum: '$flujos' } } },
    ],
  },
]);

export const pipelineDerivacion = (derivacion, modo, generacion = null) => [
  ...derivacion.etapas,
  { $set: { actualizadoEn: '$$NOW', ...(generacion ? { generacion } : {}) } },
  etapaMerge(derivacion.destino, modo, derivacion),
];

// Índices de las colecciones resumen que se ordenan por cantidad en la API.
export const INDICES_RESUMEN = Object.freeze([
  { coleccion: COLECCIONES.ipsOrigen, key: { ataques: -1, _id: 1 }, name: 'idx_ataques' },
  { coleccion: COLECCIONES.ipsDestino, key: { ataques: -1, _id: 1 }, name: 'idx_ataques' },
  { coleccion: COLECCIONES.puerto, key: { ataques: -1, _id: 1 }, name: 'idx_ataques' },
  { coleccion: COLECCIONES.label, key: { flujos: -1, _id: 1 }, name: 'idx_flujos' },
  { coleccion: COLECCIONES.protocolo, key: { flujos: -1, _id: 1 }, name: 'idx_flujos' },
]);

// ---------------------------------------------------------------------------------------
// Lecturas de la API: una agregación sobre resumen_general con $lookup a cada resumen.
// ---------------------------------------------------------------------------------------

const lookup = (as, from, pipeline) => ({ $lookup: { from, pipeline, as } });

const lookupSeries = (days) => lookup('series', COLECCIONES.diario, [
  { $sort: { _id: -1 } },
  { $limit: days },
  { $sort: { _id: 1 } },
  { $project: { _id: 0, fecha: '$_id', total: 1, ataques: 1 } },
]);

const lookupTiposAtaque = (limit = null) => lookup('tiposAtaque', COLECCIONES.label, [
  { $match: { _id: { $ne: null, $nin: BENIGN_LABELS } } },
  { $sort: { flujos: -1, _id: 1 } },
  ...(limit ? [{ $limit: limit }] : []),
  { $project: { _id: 0, tipo: '$_id', cantidad: '$flujos' } },
]);

const lookupTopAtaques = (as, from, limit, campoClave, extra = {}) => lookup(as, from, [
  { $sort: { ataques: -1, _id: 1 } },
  { $limit: limit },
  { $project: { _id: 0, [campoClave]: '$_id', ataques: 1, ...extra } },
]);

const matchGeneral = { $match: { _id: ID_GENERAL } };

export const pipelineLecturaResumen = () => [
  matchGeneral,
  lookupTiposAtaque(1),
  {
    $project: {
      _id: 0,
      totalFlujosEstimado: '$totalFlujos',
      flujosAnalizados: '$totalFlujos',
      flujosDeAtaque: 1,
      porcentajeDeAtaque: {
        $cond: [
          { $gt: ['$totalFlujos', 0] },
          { $multiply: [{ $divide: ['$flujosDeAtaque', '$totalFlujos'] }, 100] },
          0,
        ],
      },
      bytesPorSegundoPromedio: {
        $cond: [{ $gt: ['$bpsN', 0] }, { $divide: ['$bpsSuma', '$bpsN'] }, 0],
      },
      tipoAtaqueMasFrecuente: { $ifNull: [{ $first: '$tiposAtaque.tipo' }, null] },
    },
  },
];

export const pipelineLecturaTopIps = (limit) => [
  matchGeneral,
  lookupTopAtaques('datos', COLECCIONES.ipsOrigen, limit, 'ip', { etiquetas: 1 }),
  { $project: { _id: 0, flujosAnalizados: '$totalFlujos', datos: 1 } },
];

export const pipelineLecturaSeries = (days) => [
  matchGeneral,
  lookupSeries(days),
  { $project: { _id: 0, flujosAnalizados: '$totalFlujos', datos: '$series' } },
];

// tiposAtaque devuelve la distribución completa de Label (todas las clases de ataque);
// `limit` se aplica a las demás listas, como antes.
export const pipelineLecturaAnalitica = (days, limit) => [
  matchGeneral,
  lookupSeries(days),
  lookupTiposAtaque(),
  lookupTopAtaques('ipsDestino', COLECCIONES.ipsDestino, limit, 'ip'),
  lookup('protocolos', COLECCIONES.protocolo, [
    { $sort: { flujos: -1, _id: 1 } },
    { $limit: limit },
    { $project: { _id: 0, protocolo: '$_id', flujos: 1, ataques: 1 } },
  ]),
  lookupTopAtaques('puertosDestino', COLECCIONES.puerto, limit, 'puerto'),
  lookup('horas', COLECCIONES.hora, [
    { $sort: { _id: 1 } },
    { $project: { _id: 0, hora: '$_id', flujos: 1, ataques: 1 } },
  ]),
  {
    $project: {
      _id: 0,
      flujosAnalizados: '$totalFlujos',
      series: 1,
      tiposAtaque: 1,
      ipsDestino: 1,
      protocolos: 1,
      puertosDestino: 1,
      horas: 1,
    },
  },
];
