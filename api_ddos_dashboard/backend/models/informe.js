export const serializeFlujo = (document) => ({
  id: document._id.toString(),
  fecha: document.Timestamp,
  ip: document['Source IP'],
  ipDestino: document['Destination IP'],
  puertoOrigen: document['Source Port'],
  puertoDestino: document['Destination Port'],
  protocolo: document.Protocol,
  tipo: document.Label,
  duracionFlujo: document['Flow Duration'],
  bytesPorSegundo: document['Flow Bytes/s'] ?? null,
  paquetesOrigen: document['Total Fwd Packets'],
  paquetesDestino: document['Total Backward Packets'],
});

export default serializeFlujo;
