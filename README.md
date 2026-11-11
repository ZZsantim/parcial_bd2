# Dashboard para análisis de flujos DDoS

Proyecto del parcial 3 de Bases de Datos II sobre el dataset CIC-DDoS2019, conectado a MongoDB y organizado por capas.

## Ejecutar

```bash
cd api_ddos_dashboard
npm install
npm test
npm start
```

Configura MongoDB y Ollama en `api_ddos_dashboard/backend/.env`. El servicio local usa `ddos_db.flujos_limpia` (CSV limpiados y tipados), MongoDB en `127.0.0.1:27017` y el replica set `rs0`. El dashboard se sirve desde la API, normalmente en <http://localhost:3000>.
El modelo por defecto es `qwen3.5:9b` (el instalado en el Ollama local); cópialo de `backend/.env.example` o cambia `OLLAMA_MODEL` para usar otro.

Comandos de base de datos:

```bash
npm run db:indexes
npm run db:explain
npm run db:resumenes
```

`npm run db:resumenes` precalcula las colecciones resumen que alimentan los informes 1 a 8 sobre el dataset completo; ejecútalo antes de `npm start` (ver [backend/README.md](./api_ddos_dashboard/backend/README.md)).

La implementación, sus informes, la arquitectura, la evidencia de volumen y los pendientes frente a la guía están documentados en [docs/parcial3.md](./api_ddos_dashboard/docs/parcial3.md).