# Evidencia: tiempo real con insertar, modificar y eliminar

Prueba contra la instancia local (MongoDB 9.0.4, replica set rs0, `ddos_db.flujos_limpia`) con la API en marcha (`npm start`).
Se inserta un flujo temporal con `_id` nuevo, se le cambian `Label` y `Source IP` con `updateOne` y se elimina con `deleteOne`.
En cada paso se leen `resumen_general`, `resumen_label` y `resumen_top_ips_origen`; al final se escucha lo mismo que recibe el dashboard por SSE.

Salida tal cual del script de verificación ("Tiempo total" incluye el `countDocuments` final sobre los 70 M de documentos):

Fecha: 2026-11-11T16:59:29.076Z
flujos_limpia antes: 70427637 documentos (countDocuments)
resumen_estado: generacion 6af4978a7688ba40fab05f91, desactualizado=false, recalculando=false
Documento temporal: copia del flujo BENIGN 6af248a526acfad8e92f27f2 con _id nuevo 6af49ef1480f5b8be292d757 (Source IP 192.168.50.8, Timestamp 2018-11-03 09:20:40).
Label de ataque usado en el update: TFTP (el más frecuente); Source IP nueva: 172.16.0.5 (la de más ataques).

### 0. Antes
```json
{
  "resumen_general": {
    "totalFlujos": 70427637,
    "flujosDeAtaque": 70313809,
    "bpsSuma": 52017445170782040,
    "bpsN": 68256887
  },
  "resumen_label": {
    "BENIGN": 113828,
    "TFTP": 20082580
  },
  "resumen_top_ips_origen": {
    "172.16.0.5": {
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
    },
    "192.168.50.8": "sin documento",
    "top3": [
      "172.16.0.5=70289460",
      "192.168.50.1=16270",
      "192.168.50.4=8079"
    ]
  }
}
```
### 1. Después de insertOne (BENIGN, 192.168.50.8) — resúmenes actualizados en 1246 ms
```json
{
  "resumen_general": {
    "totalFlujos": 70427638,
    "flujosDeAtaque": 70313809,
    "bpsSuma": 52017445170792504,
    "bpsN": 68256888
  },
  "resumen_label": {
    "BENIGN": 113829,
    "TFTP": 20082580
  },
  "resumen_top_ips_origen": {
    "172.16.0.5": {
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
    },
    "192.168.50.8": "sin documento",
    "top3": [
      "172.16.0.5=70289460",
      "192.168.50.1=16270",
      "192.168.50.4=8079"
    ]
  }
}
```
### 2. Después de updateOne (Label → TFTP, Source IP → 172.16.0.5) — resúmenes actualizados en 1252 ms
```json
{
  "resumen_general": {
    "totalFlujos": 70427638,
    "flujosDeAtaque": 70313810,
    "bpsSuma": 52017445170792504,
    "bpsN": 68256888
  },
  "resumen_label": {
    "BENIGN": 113828,
    "TFTP": 20082581
  },
  "resumen_top_ips_origen": {
    "172.16.0.5": {
      "ataques": 70289461,
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
    },
    "192.168.50.8": "sin documento",
    "top3": [
      "172.16.0.5=70289461",
      "192.168.50.1=16270",
      "192.168.50.4=8079"
    ]
  }
}
```
### 3. Después de deleteOne — resúmenes actualizados en 1244 ms
```json
{
  "resumen_general": {
    "totalFlujos": 70427637,
    "flujosDeAtaque": 70313809,
    "bpsSuma": 52017445170782040,
    "bpsN": 68256887
  },
  "resumen_label": {
    "BENIGN": 113828,
    "TFTP": 20082580
  },
  "resumen_top_ips_origen": {
    "172.16.0.5": {
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
    },
    "192.168.50.8": "sin documento",
    "top3": [
      "172.16.0.5=70289460",
      "192.168.50.1=16270",
      "192.168.50.4=8079"
    ]
  }
}
```
### Comprobación
- Estado final idéntico al inicial (todos los valores mostrados): true
- Documento temporal presente en flujos_limpia: 0
- flujos_limpia después: 70427637 documentos (countDocuments); igual al inicial: true
- resumen_estado: desactualizado=false, motivo=null
- Tiempo total de la prueba: 238118 ms

### Eventos SSE recibidos en /api/events/flows (lo que escucha el dashboard)
```
2026-11-11T16:59:30.723Z  mongo-change  {"operation":"insert","documentId":"6af49ef1480f5b8be292d757","at":"2026-11-11T16:59:30.731Z"}
2026-11-11T16:59:32.001Z  resumenes-actualizados  {"tipo":"incremental","flujos":1,"cambios":1,"at":"2026-11-11T16:59:32.009Z"}
2026-11-11T16:59:33.488Z  mongo-change  {"operation":"update","documentId":"6af49ef1480f5b8be292d757","at":"2026-11-11T16:59:33.496Z"}
2026-11-11T16:59:35.129Z  resumenes-actualizados  {"tipo":"incremental","flujos":0,"cambios":2,"at":"2026-11-11T16:59:35.137Z"}
2026-11-11T16:59:36.308Z  mongo-change  {"operation":"delete","documentId":"6af49ef1480f5b8be292d757","at":"2026-11-11T16:59:36.316Z"}
2026-11-11T16:59:37.654Z  resumenes-actualizados  {"tipo":"incremental","flujos":-1,"cambios":1,"at":"2026-11-11T16:59:37.662Z"}
```
