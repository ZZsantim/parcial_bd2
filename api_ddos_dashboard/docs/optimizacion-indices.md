# Optimización con índices en `flujos_limpia`

Generado por `npm run db:explain` (`backend/scripts/benchmarkIndexes.js`) a partir de `docs/benchmark-indices.json` (2026-11-11T22:26:27.813Z).

- Colección `ddos_db.flujos_limpia`: 70.427.637 documentos, 139,1 GiB de datos sin comprimir (17,3 GiB en disco). MongoDB 9.0.4.
- Equipo: 15,7 GiB de RAM; caché de WiredTiger de 7,4 GiB.
- Cada consulta se ejecutó sin `limit` con `explain("executionStats")`: 3 corridas con el plan del planificador y 1 corrida con COLLSCAN forzado. Sin índice se hizo 1 corrida por consulta porque cada COLLSCAN tarda entre 2,2 y 3,5 minutos.
- `maxTimeMS`: sin tope.

## Índices

| Índice | Campos | Tipo | Consulta que optimiza | Justificación |
|---|---|---|---|---|
| `idxtimestamp` | `{ Timestamp: 1 }` | Simple | (e) `{ Timestamp: { $gte, $lt } }` | Limita las consultas por ventana de tiempo al rango de claves pedido en lugar de recorrer los 70 M de flujos. |
| `idx_label` | `{ Label: 1 }` | Simple | (b) `{ Label: "WebDDoS" }` | Filtrar por tipo de ataque es la consulta base de clasificación; en etiquetas raras el índice salta directo a pocas claves. |
| `idx_source_ip` | `{ "Source IP": 1 }` | Simple | (a) `{ "Source IP": "104.27.33.64" }` | Investigar un host es una igualdad muy selectiva (1 577 IP distintas); sin índice hay que leer toda la colección. |
| `idx_protocol` | `{ Protocol: 1 }` | Simple | (d) `{ Protocol: 0 }` | Solo hay tres protocolos, pero el 0 aparece en 3 998 flujos: en un valor raro un índice de baja cardinalidad sigue siendo selectivo. |
| `idx_label_timestamp` | `{ Label: 1, Timestamp: -1 }` | Compuesto | (c) `{ Label: "BENIGN", Timestamp: { $gte, $lt } }` | Igualdad en `Label` como prefijo y rango en `Timestamp` dentro de esa etiqueta: solo se leen las claves de la ventana pedida. |

## Comparación antes y después

| Variante | Plan | Corridas | `executionTimeMillis` mín. | mediana | máx. | `totalDocsExamined` | `totalKeysExamined` | `nReturned` | Mejora (mediana) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **a) IP de origen concreta (104.27.33.64)** | | | | | | | | | |
| Con índice (planificador) | IXSCAN (`idx_source_ip`) | 3 | 0 | 0 | 4 | 38 | 38 | 38 | ≥ 133.288× (índice en 0 ms) |
| Sin índice (`$natural`) | COLLSCAN | 1 | 133.288 | 133.288 | 133.288 | 70.427.637 | 0 | 38 | — |
| **c) Label + rango de Timestamp (BENIGN, 1 minuto)** | | | | | | | | | |
| Con índice (planificador) | IXSCAN (`idx_label_timestamp`) | 3 | 1 | 1 | 11 | 83 | 83 | 83 | 210.057× |
| Sin índice (`$natural`) | COLLSCAN | 1 | 210.057 | 210.057 | 210.057 | 70.427.637 | 0 | 83 | — |
| **e) Rango de Timestamp sin Label (5 minutos)** | | | | | | | | | |
| Con índice (planificador) | IXSCAN (`idxtimestamp`) | 3 | 0 | 0 | 3 | 292 | 292 | 292 | ≥ 157.645× (índice en 0 ms) |
| Sin índice (`$natural`) | COLLSCAN | 1 | 157.645 | 157.645 | 157.645 | 70.427.637 | 0 | 292 | — |

Tiempos por corrida, en orden de ejecución:

- **a)** con índice: 4, 0, 0 ms; COLLSCAN: 133288 ms
- **c)** con índice: 11, 1, 1 ms; COLLSCAN: 210057 ms
- **e)** con índice: 3, 0, 0 ms; COLLSCAN: 157645 ms

## Interpretación

- **a)** `db.flujos_limpia.find({ "Source IP": "104.27.33.64" })` — El planificador usó `idx_source_ip` y examinó 38 claves y 38 documentos para devolver 38, frente a 70.427.637 documentos del COLLSCAN; la mediana bajó de 133.288 ms a 0 ms (≥ 133.288× (índice en 0 ms)). Cada documento leído con el índice fue devuelto: el índice resuelve el filtro completo.
- **c)** `db.flujos_limpia.find({ Label: "BENIGN", Timestamp: { $gte: "2018-12-01 10:00:00", $lt: "2018-12-01 10:01:00" } })` — El planificador usó `idx_label_timestamp` y examinó 83 claves y 83 documentos para devolver 83, frente a 70.427.637 documentos del COLLSCAN; la mediana bajó de 210.057 ms a 1 ms (210.057×). Cada documento leído con el índice fue devuelto: el índice resuelve el filtro completo.
- **e)** `db.flujos_limpia.find({ Timestamp: { $gte: "2018-11-03 17:00:00", $lt: "2018-11-03 17:05:00" } })` — El planificador usó `idxtimestamp` y examinó 292 claves y 292 documentos para devolver 292, frente a 70.427.637 documentos del COLLSCAN; la mediana bajó de 157.645 ms a 0 ms (≥ 157.645× (índice en 0 ms)). Cada documento leído con el índice fue devuelto: el índice resuelve el filtro completo.

## Notas

- El "antes" no se obtuvo borrando los índices: se forzó el COLLSCAN con `hint({ $natural: 1 })`, que recorre la colección en orden natural igual que si el índice no existiera. Así no se tocaron índices ni datos. El "después" es el plan que elige el planificador sin `hint`.
- Los tiempos dependen de la caché del sistema. La colección (139,1 GiB) no cabe en la caché de WiredTiger (7,4 GiB) ni en la RAM (15,7 GiB), así que cada COLLSCAN lee casi todo desde disco: son corridas en frío aunque se repitan. Las corridas con índice tocan pocas claves y documentos; la primera de cada consulta puede ir en frío y las siguientes en caliente, por eso se reportan mínimo, mediana y máximo.
