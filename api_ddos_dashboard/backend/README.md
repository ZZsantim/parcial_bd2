# API Backend

La API consulta la colección de MongoDB indicada por `DB_COLLECTION` (por defecto, `flujos`) dentro de la base indicada por `DB_NAME`. Al iniciar, verifica el ping y que la colección exista; si la configuración es incorrecta, no inicia el servidor.

Configura `PORT`, `MONGO_URI`, `DB_NAME` y `DB_COLLECTION` en `backend/.env`, y ejecuta `npm start` desde `api_ddos_dashboard`. Si `OLLAMA_MODEL` no está instalado, establece uno disponible (por ejemplo, `OLLAMA_MODEL=qwen2.5:3b npm start`).

## Rutas

- `GET /api/health` comprueba la conexión con MongoDB; responde `503` si no está disponible.
- `GET /api/informes?limit=20` devuelve los registros de flujo más recientes.
- `GET /api/informes/resumen` devuelve el tamaño estimado de la colección y métricas de la muestra reciente.
- `GET /api/informes/top-ips?limit=5` devuelve las IP de origen principales de la muestra reciente.
- `GET /api/informes/series?days=7` devuelve conteos diarios de la muestra reciente.
- `GET /api/informes/analitica?days=7&limit=8` calcula en una sola agregación las series, tipos de ataque, IP de destino, protocolos, puertos destino y horas de mayor actividad.
- `POST /api/consultas` recibe `{"question":"¿Qué tipos de ataques aparecen?"}`, pide a Ollama un pipeline limitado y ejecuta la agregación de solo lectura en MongoDB.
- `GET /api/events/flows` transmite cambios de MongoDB mediante Server-Sent Events; el dashboard vuelve a consultar los agregados al recibir un evento.

El resumen, las IP principales y la serie ejecutan sus agregaciones en MongoDB y analizan hasta los 10 000 flujos más recientes, ordenados por el campo indexado `Timestamp`. Las respuestas muestran `flujosAnalizados`; el tamaño total se llama `totalFlujosEstimado` porque procede de la estimación de metadatos de MongoDB. Los informes se consultan y proyectan en MongoDB, y luego se serializan a JSON en el backend.

Esta estructura aplica la arquitectura por capas solicitada: rutas → controladores → servicios → repositorios, con configuración de conexión y serialización del modelo separadas. Los parámetros `limit` y `days` se validan antes de consultar la base; los errores y rutas no encontradas responden JSON sin filtrar detalles internos.

El frontend servido por Express mantiene un flujo conversacional inspirado en el proyecto de referencia, pero no usa Firebase: consultas y actualizaciones se conectan a esta API y a MongoDB. Ollama recibe solamente la pregunta y el esquema de campos, nunca documentos del dataset. El modelo por defecto es `kimi-k2.5`; configura `OLLAMA_URL`, `OLLAMA_MODEL` y `OLLAMA_TIMEOUT_MS` en `backend/.env`. Ollama debe estar activo y el modelo instalado (`ollama pull kimi-k2.5`). La generación se restringe a etapas y campos permitidos, una muestra máxima de 10 000 flujos, 100 resultados y tiempo máximo de ejecución MongoDB.

El endpoint de eventos usa MongoDB Change Streams y requiere un replica set o clúster compatible. El servidor mantiene una suscripción para distribuir eventos a los clientes conectados; si se interrumpe, intenta reconectarla con espera incremental.

El dashboard presenta más de diez informes, incluyendo tres preguntas sugeridas de lenguaje natural y una vista de cambios en vivo. Los eventos refrescan las métricas y visualizaciones sin recargar la página. La matriz de cumplimiento del parcial, la arquitectura, el modelo de datos, el volumen medido y los pendientes están en `docs/parcial3.md`.

Desde la raíz `api_ddos_dashboard/`, `npm run db:indexes` verifica/crea los índices recomendados y `npm run db:explain` ejecuta comparaciones limitadas con `explain("executionStats")`. El segundo comando no elimina índices ni modifica documentos.
