# Evidencia de volumen (§4.2)

Fecha y hora de la medición: 2026-11-11 17:19:06 -0500 (mongosh contra `ddos_db`, réplica `rs0`, solo lectura). Escala: GB (`1024*1024*1024`).

## Datos frente a índices de `flujos_limpia`

| Métrica | Valor (GB) |
|---|---|
| dataSize (datos sin comprimir) | 139.0685489391908 |
| storageSize (datos en disco, comprimidos) | 17.295150756835938 |
| indexSize (todos los índices) | 3.461761474609375 |
| count (documentos) | 70 427 637 |

En `collection.stats()`, `dataSize` es el campo `size` y `indexSize` es `totalIndexSize`.

## Salida de mongosh

Comando:

```js
const G=1024*1024*1024;
print("=== db.stats(1024*1024*1024) ==="); printjson(db.stats(G));
const s=db.flujos_limpia.stats(G);
print("=== db.flujos_limpia.stats(1024*1024*1024): campos pedidos ===");
printjson({count:s.count, dataSize:s.size, storageSize:s.storageSize, indexSize:s.totalIndexSize, indexSizes:s.indexSizes, scaleFactor:s.scaleFactor});
print("=== db.flujos_limpia.getIndexes() ==="); printjson(db.flujos_limpia.getIndexes());
```

Salida:

```
=== db.stats(1024*1024*1024) ===
{
  db: 'ddos_db',
  collections: Long('11'),
  views: Long('0'),
  objects: Long('70558944'),
  avgObjSize: 2116.5193881019536,
  dataSize: 139.08312933519483,
  storageSize: 17.30057144165039,
  indexes: Long('21'),
  indexSize: 3.467571258544922,
  totalSize: 20.768142700195312,
  scaleFactor: Long('1073741824'),
  fsUsedSize: 421.4406204223633,
  fsTotalSize: 474.53026962280273,
  ok: 1,
  '$clusterTime': {
    clusterTime: Timestamp({ t: 1794435539, i: 1 }),
    signature: {
      hash: Binary.createFromBase64('AAAAAAAAAAAAAAAAAAAAAAAAAAA=', 0),
      keyId: Long('0')
    }
  },
  operationTime: Timestamp({ t: 1794435539, i: 1 })
}
=== db.flujos_limpia.stats(1024*1024*1024): campos pedidos ===
{
  count: 70427637,
  dataSize: 139.0685489391908,
  storageSize: 17.295150756835938,
  indexSize: 3.461761474609375,
  indexSizes: {
    _id_: 1.848785400390625,
    idxtimestamp: 0.34575653076171875,
    idx_label: 0.3069267272949219,
    idx_source_ip: 0.30716705322265625,
    idx_protocol: 0.30652618408203125,
    idx_label_timestamp: 0.3465995788574219
  },
  scaleFactor: 1073741824
}
=== db.flujos_limpia.getIndexes() ===
[
  {
    v: 2,
    key: {
      _id: 1
    },
    name: '_id_'
  },
  {
    v: 2,
    key: {
      Timestamp: 1
    },
    name: 'idxtimestamp'
  },
  {
    v: 2,
    key: {
      Label: 1
    },
    name: 'idx_label'
  },
  {
    v: 2,
    key: {
      'Source IP': 1
    },
    name: 'idx_source_ip'
  },
  {
    v: 2,
    key: {
      Protocol: 1
    },
    name: 'idx_protocol'
  },
  {
    v: 2,
    key: {
      Label: 1,
      Timestamp: -1
    },
    name: 'idx_label_timestamp'
  }
]
```
