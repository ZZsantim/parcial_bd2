# API Backend

La API consulta la colección de MongoDB indicada por `DB_COLLECTION` (por defecto, `flujos`) dentro de la base indicada por `DB_NAME`. Al iniciar, verifica el ping y que la colección exista; si la configuración es incorrecta, no inicia el servidor.

Configura `PORT`, `MONGO_URI`, `DB_NAME` y `DB_COLLECTION` en `backend/.env`, y ejecuta `npm start` desde `api_ddos_dashboard`.

## Rutas

- `GET /api/health` comprueba la conexión con MongoDB; responde `503` si no está disponible.
- `GET /api/informes?limit=20` devuelve los registros de flujo más recientes.
- `GET /api/informes/resumen` devuelve el tamaño estimado de la colección y métricas de la muestra reciente.
- `GET /api/informes/top-ips?limit=5` devuelve las IP de origen principales de la muestra reciente.
- `GET /api/informes/series?days=7` devuelve conteos diarios de la muestra reciente.

El resumen, las IP principales y la serie ejecutan sus agregaciones en MongoDB y analizan hasta los 10 000 flujos más recientes, ordenados por el campo indexado `Timestamp`. Las respuestas muestran `flujosAnalizados`; el tamaño total se llama `totalFlujosEstimado` porque procede de la estimación de metadatos de MongoDB. Los informes se consultan y proyectan en MongoDB, y luego se serializan a JSON en el backend.

Esta estructura aplica la arquitectura por capas solicitada: rutas → controladores → servicios → repositorios, con configuración de conexión y serialización del modelo separadas. Los parámetros `limit` y `days` se validan antes de consultar la base; los errores y rutas no encontradas responden JSON sin filtrar detalles internos.
