# Optimización con índices en `flujos_limpia`

Generado por `npm run db:explain` (`backend/scripts/benchmarkIndexes.js`) a partir de `docs/benchmark-indices.json` (2026-11-11T22:04:16.975Z).

- Colección `ddos_db.flujos_limpia`: 70.427.637 documentos, 139,1 GiB de datos sin comprimir (17,3 GiB en disco). MongoDB 9.0.4.
- Equipo: 15,7 GiB de RAM; caché de WiredTiger de 7,4 GiB.
- Cada consulta se ejecutó sin `limit` con `explain("executionStats")`: 1 corridas con el plan del planificador y 1 con COLLSCAN forzado.
- `maxTimeMS`: sin tope.

## Índices

| Índice | Campos | Tipo | Consulta que optimiza | Justificación |
|---|---|---|---|---|
| `idxtimestamp` | `{ Timestamp: 1 }` | Simple | Informes por periodo: `find`/`$match` por rango de `Timestamp` (no medida en este benchmark) | Limita las consultas por ventana de tiempo al rango de claves pedido en lugar de recorrer los 70 M de flujos. |
| `idx_label` | `{ Label: 1 }` | Simple | (b) `{ Label: "WebDDoS" }` | Filtrar por tipo de ataque es la consulta base de clasificación; en etiquetas raras el índice salta directo a pocas claves. |
| `idx_source_ip` | `{ "Source IP": 1 }` | Simple | (a) `{ "Source IP": "104.27.33.64" }` | Investigar un host es una igualdad muy selectiva (1 577 IP distintas); sin índice hay que leer toda la colección. |
| `idx_protocol` | `{ Protocol: 1 }` | Simple | (d) `{ Protocol: 0 }` | Solo hay tres protocolos, pero el 0 aparece en 3 998 flujos: en un valor raro un índice de baja cardinalidad sigue siendo selectivo. |
| `idx_label_timestamp` | `{ Label: 1, Timestamp: -1 }` | Compuesto | (c) `{ Label: "BENIGN", Timestamp: { $gte, $lt } }` | Igualdad en `Label` como prefijo y rango en `Timestamp` dentro de esa etiqueta: solo se leen las claves de la ventana pedida. |

## Comparación antes y después

| Variante | Plan | Corridas | `executionTimeMillis` mín. | mediana | máx. | `totalDocsExamined` | `totalKeysExamined` | `nReturned` | Mejora (mediana) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **a) IP de origen concreta (104.27.33.64)** | | | | | | | | | |
| Con índice (planificador) | IXSCAN (`idx_source_ip`) | 1 | 7 | 7 | 7 | 38 | 38 | 38 | 24.853× |
| Sin índice (`$natural`) | COLLSCAN | 1 | 173.969 | 173.969 | 173.969 | 70.427.637 | 0 | 38 | — |
| **b) Etiqueta rara (WebDDoS)** | | | | | | | | | |
| Con índice (planificador) | IXSCAN (`idx_label`) | 1 | 79 | 79 | 79 | 439 | 439 | 439 | 3.144× |
| Sin índice (`$natural`) | COLLSCAN | 1 | 248.345 | 248.345 | 248.345 | 70.427.637 | 0 | 439 | — |
| **c) Label + rango de Timestamp (BENIGN, 1 minuto)** | | | | | | | | | |
| Con índice (planificador) | IXSCAN (`idx_label_timestamp`) | 1 | 15 | 15 | 15 | 83 | 83 | 83 | 13.032× |
| Sin índice (`$natural`) | COLLSCAN | 1 | 195.478 | 195.478 | 195.478 | 70.427.637 | 0 | 83 | — |
| **d) Protocolo poco frecuente (Protocol 0)** | | | | | | | | | |
| Con índice (planificador) | IXSCAN (`idx_protocol`) | 1 | 1.599 | 1.599 | 1.599 | 3.998 | 3.998 | 3.998 | 131× |
| Sin índice (`$natural`) | COLLSCAN | 1 | 209.915 | 209.915 | 209.915 | 70.427.637 | 0 | 3.998 | — |

Tiempos por corrida, en orden de ejecución:

- **a)** con índice: 7 ms; COLLSCAN: 173969 ms
- **b)** con índice: 79 ms; COLLSCAN: 248345 ms
- **c)** con índice: 15 ms; COLLSCAN: 195478 ms
- **d)** con índice: 1599 ms; COLLSCAN: 209915 ms

## Interpretación

- **a)** `db.flujos_limpia.find({ "Source IP": "104.27.33.64" })` — El planificador usó `idx_source_ip` y examinó 38 claves y 38 documentos para devolver 38, frente a 70.427.637 documentos del COLLSCAN; la mediana bajó de 173.969 ms a 7 ms (24.853×). Cada documento leído con el índice fue devuelto: el índice resuelve el filtro completo.
- **b)** `db.flujos_limpia.find({ Label: "WebDDoS" })` — El planificador usó `idx_label` y examinó 439 claves y 439 documentos para devolver 439, frente a 70.427.637 documentos del COLLSCAN; la mediana bajó de 248.345 ms a 79 ms (3.144×). Cada documento leído con el índice fue devuelto: el índice resuelve el filtro completo.
- **c)** `db.flujos_limpia.find({ Label: "BENIGN", Timestamp: { $gte: "2018-12-01 10:00:00", $lt: "2018-12-01 10:01:00" } })` — El planificador usó `idx_label_timestamp` y examinó 83 claves y 83 documentos para devolver 83, frente a 70.427.637 documentos del COLLSCAN; la mediana bajó de 195.478 ms a 15 ms (13.032×). Cada documento leído con el índice fue devuelto: el índice resuelve el filtro completo.
- **d)** `db.flujos_limpia.find({ Protocol: 0 })` — El planificador usó `idx_protocol` y examinó 3.998 claves y 3.998 documentos para devolver 3.998, frente a 70.427.637 documentos del COLLSCAN; la mediana bajó de 209.915 ms a 1.599 ms (131×). Cada documento leído con el índice fue devuelto: el índice resuelve el filtro completo.

## Notas

- El "antes" no se obtuvo borrando los índices: se forzó el COLLSCAN con `hint({ $natural: 1 })`, que recorre la colección en orden natural igual que si el índice no existiera. Así no se tocaron índices ni datos. El "después" es el plan que elige el planificador sin `hint`.
- Los tiempos dependen de la caché del sistema. La colección (139,1 GiB) no cabe en la caché de WiredTiger (7,4 GiB) ni en la RAM (15,7 GiB), así que cada COLLSCAN lee casi todo desde disco: son corridas en frío aunque se repitan. Las corridas con índice tocan pocas claves y documentos; la primera de cada consulta puede ir en frío y las siguientes en caliente, por eso se reportan mínimo, mediana y máximo.
- Durante la medición estaban en marcha: no anotado.
