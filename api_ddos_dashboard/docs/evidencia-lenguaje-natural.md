# Evidencia: consultas en lenguaje natural sobre la colección completa

Fecha: 2026-11-11T17:50:37.133Z. API en `http://127.0.0.1:3000`, Ollama `qwen3.5:9b`, MongoDB 9.0.4 con `ddos_db.flujos_limpia` (70 427 637 documentos).
El pipeline generado se ejecuta sobre la colección completa (sin muestra), con `allowDiskUse` y `maxTimeMS` = `CONSULTA_MAX_TIME_MS` (120 000 ms por defecto).

Se hicieron tres ejecuciones; todas las cifras salen de ellas, sin redondear:

1. **API con la configuración por defecto (120 s)**: `node backend/scripts/evidenciaConsultas.js`. JSON completo en [evidencia-consultas.json](evidencia-consultas.json).
2. **API con `CONSULTA_MAX_TIME_MS=900000`** (solo en el entorno de esa ejecución): el script corta cada petición a los 300 s.
3. **Ejecución directa en MongoDB, sin `maxTimeMS`**, de los pipelines exactos que generó la API en la ejecución 1 para (b), (c) y (d).

## Resultado

| | Pregunta | Ejecución 1 (120 s) | Resultado correcto obtenido en | ¿Coincide con resumen_*? |
|---|---|---|---|---|
| a | ¿Cuáles son los tipos de ataque más frecuentes? | 200 · 114710 ms | ejecución 1: 114710 ms | Sí, exacto |
| b | ¿Cuántos flujos son benignos y cuántos son ataques? | 504 (tiempo agotado) | ejecución 3: 134849 ms | Sí, exacto |
| c | ¿Qué IP de origen tiene más ataques? | 504 (tiempo agotado) | ejecución 3: 754819 ms | Sí, exacto |
| d | ¿Cuántos flujos hay por protocolo? | 504 (tiempo agotado) | ejecución 3: 529539 ms | Sí, exacto |
| e | ¿Cuántos ataques hay en cada hora del día? | 504 (tiempo agotado) | ejecución 2: 249381 ms | Sí, exacto |

**Conclusión:** las cinco respuestas coinciden exactamente con las colecciones resumen. Con el tope por defecto de 120 s solo (a) termina a tiempo: en esta máquina, recorrer los 70 M de entradas de un índice ya lleva entre 100 y 135 s.
(b) sí recorre solo `idx_label` (gracias al `$sort` inicial), pero tarda 135 s. (c) necesita `Label` y `Source IP` a la vez, y ningún índice existente tiene los dos: lee los 70 M de documentos (755 s). (d) los lee también, porque el modelo no puso el `$sort` por `Protocol` que pide el prompt (530 s). (e) tarda 249 s.
Cuando se agota el tiempo, la API responde 504 con este JSON: `{"message": "La consulta superó el tiempo máximo de 120000 ms sobre la colección completa. Agrega un filtro …", "pipeline": [...]}`.

## a) ¿Cuáles son los tipos de ataque más frecuentes?

**Pipeline generado (ejecución 1):**

```json
[{"$match":{"$and":[{"Label":{"$ne":"BENIGN"}},{"Label":{"$ne":"BENIGN"}}]}},{"$group":{"_id":"$Label","cantidad":{"$sum":1}}},{"$sort":{"cantidad":-1}}]
```

**Ejecución 1 (API, 120 s):** HTTP 200, 139882 ms en total (Ollama + MongoDB), 114710 ms en MongoDB.

**Resultado:**

```json
[
  {
    "_id": "TFTP",
    "cantidad": 20082580
  },
  {
    "_id": "Syn",
    "cantidad": 6473789
  },
  {
    "_id": "MSSQL",
    "cantidad": 5787453
  },
  {
    "_id": "DrDoS_SNMP",
    "cantidad": 5159870
  },
  {
    "_id": "DrDoS_DNS",
    "cantidad": 5071011
  },
  {
    "_id": "DrDoS_MSSQL",
    "cantidad": 4522492
  },
  {
    "_id": "DrDoS_NetBIOS",
    "cantidad": 4093279
  },
  {
    "_id": "UDP",
    "cantidad": 3867155
  },
  {
    "_id": "NetBIOS",
    "cantidad": 3657497
  },
  {
    "_id": "DrDoS_UDP",
    "cantidad": 3134645
  },
  {
    "_id": "DrDoS_SSDP",
    "cantidad": 2610611
  },
  {
    "_id": "DrDoS_LDAP",
    "cantidad": 2179930
  },
  {
    "_id": "LDAP",
    "cantidad": 1915122
  },
  {
    "_id": "DrDoS_NTP",
    "cantidad": 1202642
  },
  {
    "_id": "UDP-lag",
    "cantidad": 366461
  },
  {
    "_id": "Portmap",
    "cantidad": 186960
  },
  {
    "_id": "UDPLag",
    "cantidad": 1873
  },
  {
    "_id": "WebDDoS",
    "cantidad": 439
  }
]
```

**Comparación:** resumen_label (sin BENIGN): TFTP=20082580, Syn=6473789, MSSQL=5787453, DrDoS_SNMP=5159870, DrDoS_DNS=5071011, DrDoS_MSSQL=4522492, DrDoS_NetBIOS=4093279, UDP=3867155, NetBIOS=3657497, DrDoS_UDP=3134645, DrDoS_SSDP=2610611, DrDoS_LDAP=2179930, LDAP=1915122, DrDoS_NTP=1202642, UDP-lag=366461, Portmap=186960, UDPLag=1873, WebDDoS=439. **Coincide exactamente** en las 18 clases y en el orden.

## b) ¿Cuántos flujos son benignos y cuántos son ataques?

**Pipeline generado (ejecución 1):**

```json
[{"$sort":{"Label":1}},{"$group":{"_id":{"$cond":[{"$eq":["$Label","BENIGN"]},"BENIGN","Ataque"]},"flujos":{"$sum":1}}},{"$sort":{"_id":1}}]
```

**Ejecución 1 (API, 120 s):** HTTP 504, 123994 ms en total (Ollama + MongoDB). Respuesta: `La consulta superó el tiempo máximo de 120000 ms sobre la colección completa. Agrega un filtro (por ejemplo por Label, Source IP, Protocol o Timestamp) y vuelve a intentar.`

**Ejecución 2 (API, 900 s):** The operation was aborted due to timeout a los 300021 ms (corte del script).

**Ejecución 3 (directa, sin maxTimeMS):** 134849 ms.

**Resultado:**

```json
[
  {
    "_id": "Ataque",
    "flujos": 70313809
  },
  {
    "_id": "BENIGN",
    "flujos": 113828
  }
]
```

**Comparación:** resumen_general: totalFlujos=70427637, flujosDeAtaque=70313809 → benignos=113828; resumen_label BENIGN=113828. **Coincide exactamente** (70 313 809 ataques, 113 828 benignos).

## c) ¿Qué IP de origen tiene más ataques?

**Pipeline generado (ejecución 1):**

```json
[{"$match":{"Label":{"$ne":"BENIGN"}}},{"$group":{"_id":"$Source IP","cantidad":{"$sum":1}}},{"$sort":{"cantidad":-1}},{"$limit":1}]
```

**Ejecución 1 (API, 120 s):** HTTP 504, 123854 ms en total (Ollama + MongoDB). Respuesta: `La consulta superó el tiempo máximo de 120000 ms sobre la colección completa. Agrega un filtro (por ejemplo por Label, Source IP, Protocol o Timestamp) y vuelve a intentar.`

**Ejecución 2 (API, 900 s):** The operation was aborted due to timeout a los 300004 ms (corte del script).

**Ejecución 3 (directa, sin maxTimeMS):** 754819 ms.

**Resultado:**

```json
[
  {
    "_id": "172.16.0.5",
    "cantidad": 70289460
  }
]
```

**Comparación:** resumen_top_ips_origen: 172.16.0.5=70289460, 192.168.50.1=16270, 192.168.50.4=8079. **Coincide exactamente** (172.16.0.5 con 70 289 460 ataques).

## d) ¿Cuántos flujos hay por protocolo?

**Pipeline generado (ejecución 1):**

```json
[{"$group":{"_id":"$Protocol","cantidad":{"$sum":1}}},{"$sort":{"cantidad":-1}}]
```

**Ejecución 1 (API, 120 s):** HTTP 504, 123086 ms en total (Ollama + MongoDB). Respuesta: `La consulta superó el tiempo máximo de 120000 ms sobre la colección completa. Agrega un filtro (por ejemplo por Label, Source IP, Protocol o Timestamp) y vuelve a intentar.`

**Ejecución 2 (API, 900 s):** The operation was aborted due to timeout a los 300009 ms (corte del script).

**Ejecución 3 (directa, sin maxTimeMS):** 529539 ms.

**Resultado:**

```json
[
  {
    "_id": 17,
    "cantidad": 63396525
  },
  {
    "_id": 6,
    "cantidad": 7027114
  },
  {
    "_id": 0,
    "cantidad": 3998
  }
]
```

**Comparación:** resumen_protocolo: 17=63396525, 6=7027114, 0=3998. **Coincide exactamente.**

## e) ¿Cuántos ataques hay en cada hora del día?

**Pipeline generado (ejecución 1):**

```json
[{"$match":{"$and":[{"Label":{"$ne":"BENIGN"}},{"Label":{"$ne":"BENIGN"}}]}},{"$project":{"hora":{"$substrBytes":["$Timestamp",11,2]}}},{"$group":{"_id":"$hora","cantidad":{"$sum":1}}},{"$sort":{"cantidad":-1}}]
```

**Ejecución 1 (API, 120 s):** HTTP 504, 123990 ms en total (Ollama + MongoDB). Respuesta: `La consulta superó el tiempo máximo de 120000 ms sobre la colección completa. Agrega un filtro (por ejemplo por Label, Source IP, Protocol o Timestamp) y vuelve a intentar.`

**Ejecución 2 (API, 900 s):** HTTP 200, 249381 ms en MongoDB. El modelo generó un pipeline equivalente:

```json
[{"$match":{"$and":[{"Label":{"$ne":"BENIGN"}},{"Label":{"$ne":"BENIGN"}}]}},{"$group":{"_id":{"hour":{"$substrBytes":["$Timestamp",11,2]}},"cantidad":{"$sum":1}}},{"$sort":{"cantidad":-1}}]
```

**Resultado:**

```json
[
  {
    "_id": {
      "hour": "13"
    },
    "cantidad": 23549568
  },
  {
    "_id": {
      "hour": "11"
    },
    "cantidad": 21512010
  },
  {
    "_id": {
      "hour": "10"
    },
    "cantidad": 15749685
  },
  {
    "_id": {
      "hour": "12"
    },
    "cantidad": 9363166
  },
  {
    "_id": {
      "hour": "14"
    },
    "cantidad": 129333
  },
  {
    "_id": {
      "hour": "09"
    },
    "cantidad": 3273
  },
  {
    "_id": {
      "hour": "16"
    },
    "cantidad": 2948
  },
  {
    "_id": {
      "hour": "15"
    },
    "cantidad": 2705
  },
  {
    "_id": {
      "hour": "17"
    },
    "cantidad": 1121
  }
]
```

**Comparación:** resumen_hora (ataques): 09=3273, 10=15749685, 11=21512010, 12=9363166, 13=23549568, 14=129333, 15=2705, 16=2948, 17=1121. **Coincide exactamente** en las 9 horas.

