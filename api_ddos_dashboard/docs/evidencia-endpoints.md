# Evidencia de endpoints

Fecha y hora: 2026-11-11 17:19:29 -0500. Una sola instancia de la API (`npm start`, PID 27392) en el puerto 3000. Medido con `curl -w "%{http_code} %{time_total}"`, una llamada por endpoint; el tiempo es el total de la petición en ms. No se llamó `POST /api/informes/resumenes/refrescar` porque recalcula y escribe los resúmenes.

| Petición | HTTP | ms | Inicio de la respuesta |
|---|---|---|---|
| `GET /api/health` | 200 | 4 | {"status":"ok","database":"connected","realtime":"connected","ollama":{"status":"unavailable","model":"qwen3.5:9b","estado":"inactivo"},"ser |
| `GET /api/informes` | 200 | 19 | [{"id":"6af257523a86f852958958d3","fecha":"2018-12-01 17:16:38","ip":"192.168.50.1","ipDestino":"172.16.0.5","puertoOrigen":80,"puertoDestin |
| `GET /api/informes/resumen` | 200 | 53 | {"flujosDeAtaque":70313809,"totalFlujosEstimado":70427637,"flujosAnalizados":70427637,"porcentajeDeAtaque":99.83837594891904,"bytesPorSegund |
| `GET /api/informes/top-ips` | 200 | 5 | {"datos":[{"ataques":70289460,"etiquetas":["DrDoS_DNS","DrDoS_LDAP","DrDoS_MSSQL","DrDoS_NTP","DrDoS_NetBIOS","DrDoS_SNMP","DrDoS_SSDP","DrD |
| `GET /api/informes/series` | 200 | 6 | {"flujosAnalizados":70427637,"datos":[{"total":20364525,"ataques":20307560,"fecha":"2018-11-03"},{"total":50063112,"ataques":50006249,"fecha |
| `GET /api/informes/analitica` | 200 | 11 | {"series":[{"total":20364525,"ataques":20307560,"fecha":"2018-11-03"},{"total":50063112,"ataques":50006249,"fecha":"2018-12-01"}],"tiposAtaq |
| `GET /api/informes/comparacion?desdeA=2018-12-01&hastaA=2018-12-01&desdeB=2018-11-03&hastaB=2018-11-03` | 200 | 36 | {"periodoA":{"desde":"2018-12-01 00:00:00","hasta":"2018-12-01 23:59:59","flujos":50063112,"ataques":50006249,"porcentajeAtaques":99.8864173 |
| `GET /api/informes/resumenes/estado` | 200 | 8 | {"disponible":true,"recalculando":false,"generadoEn":"2026-11-11T16:55:09.482Z","duracionMs":1634586,"tiemposMs":{"resumen_base":1633299,"re |
| `GET /api/informes/resumen?protocol=999` | 400 | 2 | {"message":"El parámetro protocol debe ser un entero entre 0 y 255."} |

Arranque de la API:

```

> api-ddos-dashboard@1.0.0 start
> node backend/server.js

[DB] Conexión exitosa a MongoDB (ddos_db.flujos_limpia)
[HTTP] Servidor escuchando en http://localhost:3000
[Ollama] Aviso: no se pudo precargar qwen3.5:9b: fetch failed
```

Ollama no estaba en marcha: `/api/health` lo informa como `unavailable`. No afecta a los informes.
