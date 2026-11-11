# Dashboard para análisis de flujos DDoS

Proyecto del parcial 3 de Bases de Datos II: una API REST (Node.js + Express) y un dashboard web que analizan los flujos del dataset CIC-DDoS2019 guardados en MongoDB, con consultas en lenguaje natural (Ollama) y actualización en tiempo real (Change Stream + SSE).

## Requisitos

- Node.js con npm.
- MongoDB ejecutándose como replica set `rs0` (por defecto en `127.0.0.1:27017`), con la base `ddos_db` y la colección `flujos_limpia` cargada.
- Ollama activo con el modelo configurado en `OLLAMA_MODEL` (por defecto `qwen3.5:9b`; `ollama pull qwen3.5:9b`).

## Instalación y ejecución

Desde `api_ddos_dashboard/`:

1. Copia `backend/.env.example` a `backend/.env` y ajusta `MONGO_URI`, `DB_NAME`, `DB_COLLECTION`, `PORT` y las variables de Ollama.
2. Instala las dependencias:

   ```bash
   npm install
   ```

3. Crea los índices y activa las pre-images del Change Stream:

   ```bash
   npm run db:indexes
   ```

4. Precalcula las colecciones `resumen_*` (recorre toda la colección; tarda varios minutos):

   ```bash
   npm run db:resumenes
   ```

5. Arranca la API:

   ```bash
   npm start
   ```

6. Ejecuta las pruebas:

   ```bash
   npm test
   ```

El dashboard queda en <http://localhost:3000> (o el `PORT` configurado).

> **Importante:** no ejecutes dos instancias de la API a la vez sobre la misma base. Cada instancia abre su propio Change Stream y suma los cambios a `resumen_*`, así que los resúmenes se contarían dos veces.

## Documentación

- [docs/parcial3.md](api_ddos_dashboard/docs/parcial3.md): caso de estudio, informes, volumen, arquitectura y modelo de datos.
- [docs/optimizacion-indices.md](api_ddos_dashboard/docs/optimizacion-indices.md): índices y comparación antes/después con `explain`.
- [docs/evidencia-lenguaje-natural.md](api_ddos_dashboard/docs/evidencia-lenguaje-natural.md): consultas en lenguaje natural.
- [docs/evidencia-tiempo-real.md](api_ddos_dashboard/docs/evidencia-tiempo-real.md): insertar, modificar y eliminar en tiempo real.
- [backend/README.md](api_ddos_dashboard/backend/README.md): rutas de la API.
