# API Backend

La API consulta la colección de MongoDB indicada por `DB_COLLECTION` (por defecto, `flujos_limpia`) dentro de la base indicada por `DB_NAME`. Al iniciar, verifica el ping y que la colección exista; si la configuración es incorrecta, no inicia el servidor.

Configura `PORT`, `MONGO_URI`, `DB_NAME` y `DB_COLLECTION` en `backend/.env`, y ejecuta `npm start` desde `api_ddos_dashboard`. Parte de `backend/.env.example`. Si `OLLAMA_MODEL` no está instalado, establece uno disponible (`ollama list`).

## Rutas

- `GET /api/health` comprueba la conexión con MongoDB; responde `503` si no está disponible.
- `GET /api/informes?limit=20` devuelve los registros de flujo más recientes.
- `GET /api/informes/resumen` (informe 1) devuelve el total exacto de flujos, los flujos de ataque, el porcentaje, el promedio de `Flow Bytes/s` y el tipo de ataque más frecuente del dataset completo.
- `GET /api/informes/top-ips?limit=5` (informe 3) devuelve las IP de origen con más flujos de ataque.
- `GET /api/informes/series?days=7` (informe 2) devuelve los conteos de los últimos días con datos.
- `GET /api/informes/analitica?days=7&limit=8` (informes 2 y 4 a 8) devuelve series, todas las clases de ataque, IP de destino, protocolos, puertos destino y horas.
- `GET /api/informes/resumenes/estado` indica cuándo se generaron los resúmenes, si están desactualizados y cuántas inserciones se sumaron después.
- `POST /api/informes/resumenes/refrescar` lanza en segundo plano el recálculo completo (`202`; `409` si ya hay uno en curso).
- `POST /api/consultas` recibe `{"question":"¿Qué tipos de ataques aparecen?"}`, pide a Ollama un pipeline limitado y ejecuta la agregación de solo lectura en MongoDB.
- `GET /api/events/flows` transmite cambios de MongoDB mediante Server-Sent Events; el dashboard vuelve a consultar los agregados al recibir un evento.

## Colecciones resumen (informes 1 a 8)

Los informes 1 a 8 se calculan sobre los 70 M de flujos, no sobre una muestra. Recorrer la colección en cada petición tarda minutos, así que `npm run db:resumenes` (desde `api_ddos_dashboard/`) precalcula colecciones resumen con agregaciones `$merge` y la API solo lee esos resultados:

1. Un único recorrido de `flujos_limpia` con `$facet` escribe `resumen_base`, un cubo pequeño con cuatro dimensiones: `tiempo` (Label, fecha, hora, protocolo), `ipOrigen` (IP y Label de ataques), `ipDestino` y `puerto` (destinos de ataques).
2. Ocho agregaciones sobre `resumen_base` generan `resumen_general`, `resumen_label`, `resumen_diario`, `resumen_hora`, `resumen_protocolo`, `resumen_puerto_destino`, `resumen_top_ips_origen` y `resumen_top_ips_destino`.
3. Cada endpoint ejecuta una sola agregación sobre `resumen_general` con `$lookup` a los demás resúmenes, por lo que ordenar y limitar ocurre en MongoDB.

El script es idempotente: cada ejecución marca los documentos con una nueva `generacion` y borra los anteriores. Solo lee `flujos_limpia`. El estado se guarda en `resumen_estado`; si un recálculo quedó a medias, `npm run db:resumenes -- --forzar` lo retoma.

Actualización con el Change Stream: cada inserción se suma por lotes (un segundo o 5 000 `_id`) con las mismas agregaciones, filtradas por `_id` (índice), sobre una colección delta temporal que se combina con `$merge` en modo suma; nunca se recorren los 70 M por evento. El recálculo completo cuenta los `_id` anteriores al segundo en que empieza y la cola suma los posteriores (con `_id` ObjectId generados al insertar). `flujos_limpia` tiene habilitadas las pre-images del Change Stream (caducan a los 3600 s; las activa `npm run db:indexes`), así que las actualizaciones y reemplazos restan la pre-image y suman la post-image, y los borrados restan la pre-image. Si falta alguna imagen (por ejemplo, porque caducó), los resúmenes se marcan como desactualizados y se corrigen con `POST /api/informes/resumenes/refrescar` o `npm run db:resumenes`. El SSE emite `resumenes-actualizados` y el dashboard recarga al recibirlo.

`totalFlujosEstimado` conserva su nombre para no romper el frontend, pero ahora es el conteo exacto de la agregación. `flujosAnalizados` también es el total del dataset.

Esta estructura aplica la arquitectura por capas solicitada: rutas → controladores → servicios → repositorios, con configuración de conexión y serialización del modelo separadas. Los parámetros `limit` y `days` se validan antes de consultar la base; los errores y rutas no encontradas responden JSON sin filtrar detalles internos.

El frontend servido por Express mantiene un flujo conversacional inspirado en el proyecto de referencia, pero no usa Firebase: consultas y actualizaciones se conectan a esta API y a MongoDB. Ollama recibe solamente la pregunta y el esquema de campos, nunca documentos del dataset. El modelo por defecto es `qwen3.5:9b`; configura `OLLAMA_URL`, `OLLAMA_MODEL` y `OLLAMA_TIMEOUT_MS` en `backend/.env`. Ollama debe estar activo y el modelo instalado (`ollama pull qwen3.5:9b`). El esquema enviado a Ollama sale de `backend/repositories/esquemaFlujos.js`, con los 88 campos reales de `flujos_limpia`. La generación se restringe a etapas y campos permitidos y a una colección autorizada (`flujos_limpia` completa o una `resumen_*`), con 100 resultados como máximo y tiempo máximo de ejecución MongoDB (`CONSULTA_MAX_TIME_MS`).

El endpoint de eventos usa MongoDB Change Streams y requiere un replica set o clúster compatible. El servidor mantiene una suscripción para distribuir eventos a los clientes conectados; si se interrumpe, intenta reconectarla con espera incremental.

El dashboard presenta más de diez informes, incluyendo tres preguntas sugeridas de lenguaje natural y una vista de cambios en vivo. Los eventos refrescan las métricas y visualizaciones sin recargar la página. La matriz de cumplimiento del parcial, la arquitectura, el modelo de datos, el volumen medido y los pendientes están en `docs/parcial3.md`.

Desde la raíz `api_ddos_dashboard/`, `npm run db:indexes` verifica/crea los índices recomendados y `npm run db:explain` ejecuta comparaciones limitadas con `explain("executionStats")`. El segundo comando no elimina índices ni modifica documentos.
