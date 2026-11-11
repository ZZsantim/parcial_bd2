// Campos reales de ddos_db.flujos_limpia (verificados con findOne y $sample de 2 000 docs).
// Es la única fuente para el esquema que se envía a Ollama y para la lista de campos que
// acepta la validación del pipeline generado.

const numericos = (nombres) => nombres.map((nombre) => [nombre, 'number']);

const camposConDescripcion = [
  ['_id', 'ObjectId'],
  ['Flow ID', 'string, "IPorigen-IPdestino-puertoOrigen-puertoDestino-protocolo"'],
  ['Source IP', 'string'],
  ['Source Port', 'number'],
  ['Destination IP', 'string'],
  ['Destination Port', 'number'],
  ['Protocol', 'number: 6 = TCP, 17 = UDP, 0 = otro'],
  ['Timestamp', 'string "YYYY-MM-DD HH:MM:SS" (texto, no Date); la hora son los caracteres 12-13, usa {"$substrBytes":["$Timestamp",11,2]}'],
  ['Flow Duration', 'number, microsegundos'],
];

const camposNumericos = numericos([
  'Total Fwd Packets',
  'Total Backward Packets',
  'Total Length of Fwd Packets',
  'Total Length of Bwd Packets',
  'Fwd Packet Length Max',
  'Fwd Packet Length Min',
  'Fwd Packet Length Mean',
  'Fwd Packet Length Std',
  'Bwd Packet Length Max',
  'Bwd Packet Length Min',
  'Bwd Packet Length Mean',
  'Bwd Packet Length Std',
]);

const camposTasa = [
  ['Flow Bytes/s', 'number; el campo NO existe cuando el valor original era Infinity o NaN'],
  ['Flow Packets/s', 'number; el campo NO existe cuando el valor original era Infinity o NaN'],
];

const camposNumericosRestantes = numericos([
  'Flow IAT Mean',
  'Flow IAT Std',
  'Flow IAT Max',
  'Flow IAT Min',
  'Fwd IAT Total',
  'Fwd IAT Mean',
  'Fwd IAT Std',
  'Fwd IAT Max',
  'Fwd IAT Min',
  'Bwd IAT Total',
  'Bwd IAT Mean',
  'Bwd IAT Std',
  'Bwd IAT Max',
  'Bwd IAT Min',
  'Fwd PSH Flags',
  'Bwd PSH Flags',
  'Fwd URG Flags',
  'Bwd URG Flags',
  'Fwd Header Length',
  'Bwd Header Length',
  'Fwd Packets/s',
  'Bwd Packets/s',
  'Min Packet Length',
  'Max Packet Length',
  'Packet Length Mean',
  'Packet Length Std',
  'Packet Length Variance',
  'FIN Flag Count',
  'SYN Flag Count',
  'RST Flag Count',
  'PSH Flag Count',
  'ACK Flag Count',
  'URG Flag Count',
  'CWE Flag Count',
  'ECE Flag Count',
  'Down/Up Ratio',
  'Average Packet Size',
  'Avg Fwd Segment Size',
  'Avg Bwd Segment Size',
  'Fwd Header Length_1',
  'Fwd Avg Bytes/Bulk',
  'Fwd Avg Packets/Bulk',
  'Fwd Avg Bulk Rate',
  'Bwd Avg Bytes/Bulk',
  'Bwd Avg Packets/Bulk',
  'Bwd Avg Bulk Rate',
  'Subflow Fwd Packets',
  'Subflow Fwd Bytes',
  'Subflow Bwd Packets',
  'Subflow Bwd Bytes',
  'Init_Win_bytes_forward',
  'Init_Win_bytes_backward',
  'act_data_pkt_fwd',
  'min_seg_size_forward',
  'Active Mean',
  'Active Std',
  'Active Max',
  'Active Min',
  'Idle Mean',
  'Idle Std',
  'Idle Max',
  'Idle Min',
  'SimillarHTTP',
  'Inbound',
]);

const campoLabel = [
  ['Label', 'string; "BENIGN" es tráfico benigno, cualquier otro valor es un tipo de ataque (p. ej. TFTP, Syn, MSSQL, DrDoS_SNMP, DrDoS_DNS, Portmap, UDP-lag, UDPLag, WebDDoS)'],
];

export const CAMPOS_FLUJO = Object.freeze([
  ...camposConDescripcion,
  ...camposNumericos,
  ...camposTasa,
  ...camposNumericosRestantes,
  ...campoLabel,
].map(([nombre, tipo]) => Object.freeze({ nombre, tipo })));

export const NOMBRES_CAMPOS_FLUJO = Object.freeze(CAMPOS_FLUJO.map(({ nombre }) => nombre));

export const describirEsquemaFlujos = () => CAMPOS_FLUJO
  .map(({ nombre, tipo }) => `"${nombre}" (${tipo})`)
  .join('\n- ');

export default { CAMPOS_FLUJO, NOMBRES_CAMPOS_FLUJO, describirEsquemaFlujos };
