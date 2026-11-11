# Evidencia: consultas en lenguaje natural sobre colecciones autorizadas

Fecha: 2026-11-11T19:22:20.964Z. API en `http://127.0.0.1:3001`, Ollama `qwen3.5:9b`, MongoDB con `ddos_db.flujos_limpia` (70 427 637 documentos) y las colecciones resumen_* al día.
El modelo elige la colección (flujos_limpia o una resumen_* de consulta) y el backend valida que esté autorizada antes de ejecutar el pipeline, con `allowDiskUse`, `maxTimeMS` = 120 000 ms (valor por defecto) y tope de 100 resultados.

Ejecución: `node backend/scripts/evidenciaConsultas.js docs/evidencia-consultas.json` (con `API_URL` apuntando a la API). JSON completo en [evidencia-consultas.json](evidencia-consultas.json).

## Resultado

| | Pregunta | HTTP | Colección | MongoDB (ms) | Total con Ollama (ms) | ¿Coincide con resumen_*? |
|---|---|---|---|---|---|---|
| a | ¿Cuáles son los tipos de ataque más frecuentes? | 200 | resumen_label | 42 | 3767 | Sí, exacto |
| b | ¿Cuántos flujos son benignos y cuántos son ataques? | 200 | resumen_label | 7 | 2114 | Sí, exacto |
| c | ¿Qué IP de origen tiene más ataques? | 200 | resumen_top_ips_origen | 3 | 2623 | Sí, exacto |
| d | ¿Cuántos flujos hay por protocolo? | 200 | resumen_protocolo | 3 | 2104 | Sí, exacto |
| e | ¿Cuántos ataques hay en cada hora del día? | 200 | resumen_hora | 7 | 2237 | Sí, exacto |

**Conclusión:** las cinco preguntas responden 200 con el tope por defecto de 120 s y coinciden exactamente con las colecciones resumen.
En los resultados se omiten los campos de control `actualizadoEn` y `generacion` (están en el JSON).

## a) ¿Cuáles son los tipos de ataque más frecuentes?

**Colección elegida:** `resumen_label`

**Pipeline:**

```json
[{"$match":{"$and":[{"_id":{"$ne":"BENIGN"}},{"_id":{"$ne":"BENIGN"}}]}},{"$sort":{"flujos":-1}}]
```

**Tiempo:** HTTP 200, 42 ms en MongoDB, 3767 ms en total (Ollama + MongoDB).

**Resultado:**

```json
[
  {
    "_id": "TFTP",
    "flujos": 20082580,
    "esAtaque": true
  },
  {
    "_id": "Syn",
    "flujos": 6473789,
    "esAtaque": true
  },
  {
    "_id": "MSSQL",
    "flujos": 5787453,
    "esAtaque": true
  },
  {
    "_id": "DrDoS_SNMP",
    "flujos": 5159870,
    "esAtaque": true
  },
  {
    "_id": "DrDoS_DNS",
    "flujos": 5071011,
    "esAtaque": true
  },
  {
    "_id": "DrDoS_MSSQL",
    "flujos": 4522492,
    "esAtaque": true
  },
  {
    "_id": "DrDoS_NetBIOS",
    "flujos": 4093279,
    "esAtaque": true
  },
  {
    "_id": "UDP",
    "flujos": 3867155,
    "esAtaque": true
  },
  {
    "_id": "NetBIOS",
    "flujos": 3657497,
    "esAtaque": true
  },
  {
    "_id": "DrDoS_UDP",
    "flujos": 3134645,
    "esAtaque": true
  },
  {
    "_id": "DrDoS_SSDP",
    "flujos": 2610611,
    "esAtaque": true
  },
  {
    "_id": "DrDoS_LDAP",
    "flujos": 2179930,
    "esAtaque": true
  },
  {
    "_id": "LDAP",
    "flujos": 1915122,
    "esAtaque": true
  },
  {
    "_id": "DrDoS_NTP",
    "flujos": 1202642,
    "esAtaque": true
  },
  {
    "_id": "UDP-lag",
    "flujos": 366461,
    "esAtaque": true
  },
  {
    "_id": "Portmap",
    "flujos": 186960,
    "esAtaque": true
  },
  {
    "_id": "UDPLag",
    "flujos": 1873,
    "esAtaque": true
  },
  {
    "_id": "WebDDoS",
    "flujos": 439,
    "esAtaque": true
  }
]
```

**Comparación:** resumen_label sin BENIGN: TFTP=20082580, Syn=6473789, MSSQL=5787453, DrDoS_SNMP=5159870, DrDoS_DNS=5071011, DrDoS_MSSQL=4522492, DrDoS_NetBIOS=4093279, UDP=3867155, NetBIOS=3657497, DrDoS_UDP=3134645, DrDoS_SSDP=2610611, DrDoS_LDAP=2179930, LDAP=1915122, DrDoS_NTP=1202642, UDP-lag=366461, Portmap=186960, UDPLag=1873, WebDDoS=439. **Coincide exactamente** en las 18 clases y en el orden.

## b) ¿Cuántos flujos son benignos y cuántos son ataques?

**Colección elegida:** `resumen_label`

**Pipeline:**

```json
[{"$group":{"_id":{"$cond":["$esAtaque","Ataque","BENIGN"]},"flujos":{"$sum":"$flujos"}}},{"$sort":{"_id":1}}]
```

**Tiempo:** HTTP 200, 7 ms en MongoDB, 2114 ms en total (Ollama + MongoDB).

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

**Comparación:** resumen_general: totalFlujos=70427637, flujosDeAtaque=70313809 → benignos=113828; resumen_label BENIGN=113828. **Coincide exactamente.**

## c) ¿Qué IP de origen tiene más ataques?

**Colección elegida:** `resumen_top_ips_origen`

**Pipeline:**

```json
[{"$sort":{"ataques":-1}},{"$limit":1}]
```

**Tiempo:** HTTP 200, 3 ms en MongoDB, 2623 ms en total (Ollama + MongoDB).

**Resultado:**

```json
[
  {
    "_id": "172.16.0.5",
    "ataques": 70289460,
    "etiquetas": [
      "DrDoS_DNS",
      "DrDoS_LDAP",
      "DrDoS_MSSQL",
      "DrDoS_NTP",
      "DrDoS_NetBIOS",
      "DrDoS_SNMP",
      "DrDoS_SSDP",
      "DrDoS_UDP",
      "LDAP",
      "MSSQL",
      "NetBIOS",
      "Portmap",
      "Syn",
      "TFTP",
      "UDP",
      "UDP-lag",
      "UDPLag",
      "WebDDoS"
    ]
  }
]
```

**Comparación:** resumen_top_ips_origen: 172.16.0.5=70289460, 192.168.50.1=16270, 192.168.50.4=8079. **Coincide exactamente** (172.16.0.5 con 70 289 460 ataques).

## d) ¿Cuántos flujos hay por protocolo?

**Colección elegida:** `resumen_protocolo`

**Pipeline:**

```json
[{"$sort":{"flujos":-1}}]
```

**Tiempo:** HTTP 200, 3 ms en MongoDB, 2104 ms en total (Ollama + MongoDB).

**Resultado:**

```json
[
  {
    "_id": 17,
    "flujos": 63396525,
    "ataques": 63358914
  },
  {
    "_id": 6,
    "flujos": 7027114,
    "ataques": 6953588
  },
  {
    "_id": 0,
    "flujos": 3998,
    "ataques": 1307
  }
]
```

**Comparación:** resumen_protocolo: 17=63396525, 6=7027114, 0=3998. **Coincide exactamente.**

## e) ¿Cuántos ataques hay en cada hora del día?

**Colección elegida:** `resumen_hora`

**Pipeline:**

```json
[{"$sort":{"ataques":-1}}]
```

**Tiempo:** HTTP 200, 7 ms en MongoDB, 2237 ms en total (Ollama + MongoDB).

**Resultado:**

```json
[
  {
    "_id": "13",
    "flujos": 23566020,
    "ataques": 23549568
  },
  {
    "_id": "11",
    "flujos": 21529822,
    "ataques": 21512010
  },
  {
    "_id": "10",
    "flujos": 15769572,
    "ataques": 15749685
  },
  {
    "_id": "12",
    "flujos": 9373777,
    "ataques": 9363166
  },
  {
    "_id": "14",
    "flujos": 141320,
    "ataques": 129333
  },
  {
    "_id": "09",
    "flujos": 15657,
    "ataques": 3273
  },
  {
    "_id": "16",
    "flujos": 15300,
    "ataques": 2948
  },
  {
    "_id": "15",
    "flujos": 13501,
    "ataques": 2705
  },
  {
    "_id": "17",
    "flujos": 2668,
    "ataques": 1121
  }
]
```

**Comparación:** resumen_hora (ataques): 09=3273, 10=15749685, 11=21512010, 12=9363166, 13=23549568, 14=129333, 15=2705, 16=2948, 17=1121. **Coincide exactamente** en las 9 horas (la API las devuelve ordenadas por ataques).
