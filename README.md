# Dashboard para análisis de flujos DDoS

Proyecto del parcial 3 de Bases de Datos II sobre el dataset CIC-DDoS2019, conectado a MongoDB y organizado por capas.

## Ejecutar

```bash
cd api_ddos_dashboard
npm install
npm test
OLLAMA_MODEL=qwen2.5:3b npm start
```

Configura MongoDB y Ollama en `api_ddos_dashboard/backend/.env`. El servicio local usa `ddos_db.flujos_limpia` (CSV limpiados y tipados), MongoDB en `127.0.0.1:27017` y el replica set `rs0`. El dashboard se sirve desde la API, normalmente en <http://localhost:3000>.
El comando de inicio selecciona el modelo local `qwen2.5:3b`; si instalas `kimi-k2.5`, puedes omitir `OLLAMA_MODEL` o configurar el modelo en el entorno.

Comandos de base de datos:

```bash
npm run db:indexes
npm run db:explain
```

La implementación, sus informes, la arquitectura, la evidencia de volumen y los pendientes frente a la guía están documentados en [docs/parcial3.md](./api_ddos_dashboard/docs/parcial3.md).