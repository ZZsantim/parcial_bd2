const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
let refreshTimer;

const setConnection = (lightId, titleId, detailId, state, title, detail) => {
  const light = $(lightId);
  light.classList.toggle('ok', state === 'ok');
  light.classList.toggle('bad', state === 'bad');
  $(titleId).textContent = title;
  $(detailId).textContent = detail;
};

const requestJson = async (url, options) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `La solicitud falló (HTTP ${response.status}).`);
  }
  return data;
};

const setText = (id, value) => {
  $(id).textContent = value;
};

const showDashboardError = (error) => {
  setText('pageError', `No se pudieron actualizar los datos desde MongoDB: ${error.message}`);
  setConnection('databaseLight', 'databaseStatus', 'databaseDetail', 'bad', 'MongoDB no disponible', 'Falló la consulta de datos');
};

// Barras agrupadas: cada grupo es { etiqueta, total, ataques } (barra azul y naranja).
const drawGroupedBars = (chart, groups, names = ['Flujos', 'Ataques']) => {
  const maxTotal = Math.max(...groups.flatMap((item) => [item.total, item.ataques]), 1);
  for (const item of groups) {
    const column = document.createElement('div');
    column.className = 'chart-column';
    const bars = document.createElement('div');
    bars.className = 'bars';

    for (const [kind, value, name] of [['total', item.total, names[0]], ['attacks', item.ataques, names[1]]]) {
      const bar = document.createElement('i');
      bar.className = `bar ${kind}`;
      bar.style.height = `${Math.max((value / maxTotal) * 100, 2)}%`;
      bar.title = `${name}: ${numberFormat.format(value)}`;
      bars.append(bar);
    }

    const date = document.createElement('span');
    date.className = 'chart-date';
    date.textContent = item.etiqueta;
    date.title = item.etiqueta;
    column.append(bars, date);
    chart.append(column);
  }
};

const drawSeries = ({ datos, flujosAnalizados }) => {
  const chart = $('seriesChart');
  chart.replaceChildren();
  setText('seriesSample', `${numberFormat.format(flujosAnalizados)} flujos analizados`);

  if (!datos.length) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'MongoDB no devolvió flujos con fecha válida en el dataset.';
    chart.append(empty);
    return;
  }

  drawGroupedBars(chart, datos.map((item) => ({ ...item, etiqueta: item.fecha.slice(5) })));
};

// Informe 13: grupos "Flujos", "Ataques" y el top 5 de Label de cada día; azul 01-12, naranja 03-11.
const drawComparison = ({ periodoA, periodoB }) => {
  const chart = $('comparisonChart');
  chart.replaceChildren();
  const cantidad = (periodo, label) => periodo.topLabels.find((item) => item.label === label)?.flujos ?? 0;
  const labels = [...new Set([...periodoA.topLabels, ...periodoB.topLabels].map((item) => item.label))];
  const groups = [
    { etiqueta: 'Flujos', total: periodoA.flujos, ataques: periodoB.flujos },
    { etiqueta: 'Ataques', total: periodoA.ataques, ataques: periodoB.ataques },
    ...labels.map((label) => ({ etiqueta: label ?? 'Sin Label', total: cantidad(periodoA, label), ataques: cantidad(periodoB, label) })),
  ];
  chart.style.gridTemplateColumns = `repeat(${groups.length}, minmax(20px, 1fr))`;
  drawGroupedBars(chart, groups, ['01-12', '03-11']);
  const percent = (periodo) => `${numberFormat.format(periodo.porcentajeAtaques)}% de ataques`;
  setText('comparisonSummary', `01-12: ${percent(periodoA)} · 03-11: ${percent(periodoB)} · Top 5 de Label de cada día (un Label fuera del top 5 de un día se muestra en 0).`);
};

const loadComparison = async () => {
  try {
    const params = 'desdeA=2018-12-01&hastaA=2018-12-01&desdeB=2018-11-03&hastaB=2018-11-03';
    drawComparison(await requestJson(`/api/informes/comparacion?${params}`));
  } catch (error) {
    setText('comparisonSummary', `No se pudo comparar los periodos: ${error.message}`);
  }
};

const drawTopIps = ({ datos, flujosAnalizados }) => {
  const list = $('topIps');
  list.replaceChildren();
  setText('ipsSample', `Ataques en ${numberFormat.format(flujosAnalizados)} flujos analizados`);

  if (!datos.length) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'No hay IPs clasificadas como ataque en el dataset.';
    list.append(empty);
    return;
  }

  const maxAttacks = Math.max(...datos.map((item) => item.ataques), 1);
  for (const item of datos) {
    const row = document.createElement('div');
    row.className = 'ip-row';
    const ip = document.createElement('span');
    ip.className = 'ip-name';
    ip.textContent = item.ip;
    const track = document.createElement('span');
    track.className = 'ip-track';
    const fill = document.createElement('i');
    fill.style.width = `${(item.ataques / maxAttacks) * 100}%`;
    track.append(fill);
    const count = document.createElement('span');
    count.className = 'ip-count';
    count.textContent = numberFormat.format(item.ataques);
    row.append(ip, track, count);
    list.append(row);
  }
};

const drawRankedList = (elementId, entries, labelFor, valueFor, valueLabel) => {
  const list = $(elementId);
  list.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Sin resultados en el dataset.';
    list.append(empty);
    return;
  }

  const maxValue = Math.max(...entries.map(valueFor), 1);
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'ranked-row';
    const label = document.createElement('span');
    label.className = 'ranked-label';
    label.textContent = labelFor(entry);
    const track = document.createElement('span');
    track.className = 'ip-track';
    const fill = document.createElement('i');
    fill.style.width = `${(valueFor(entry) / maxValue) * 100}%`;
    track.append(fill);
    const count = document.createElement('span');
    count.className = 'ip-count';
    count.textContent = numberFormat.format(valueFor(entry));
    count.title = valueLabel;
    row.append(label, track, count);
    list.append(row);
  }
};

const drawAnalitica = (analytics) => {
  drawSeries({
    datos: analytics.series,
    flujosAnalizados: analytics.flujosAnalizados,
  });
  drawRankedList(
    'attackTypes',
    analytics.tiposAtaque,
    (item) => item.tipo,
    (item) => item.cantidad,
    'Flujos maliciosos',
  );
  drawRankedList(
    'topDestinations',
    analytics.ipsDestino,
    (item) => item.ip,
    (item) => item.ataques,
    'Flujos de ataque',
  );
  drawRankedList(
    'protocols',
    analytics.protocolos,
    (item) => ({
      6: '6 · TCP',
      17: '17 · UDP',
      0: '0 · Sin protocolo identificado',
    }[item.protocolo] || `Protocolo ${item.protocolo}`),
    (item) => item.flujos,
    'Flujos totales',
  );
  drawRankedList(
    'destinationPorts',
    analytics.puertosDestino,
    (item) => ({
      21: '21 · FTP',
      22: '22 · SSH',
      53: '53 · DNS',
      67: '67 · DHCP',
      80: '80 · HTTP',
      443: '443 · HTTPS',
      445: '445 · SMB',
    }[item.puerto] || `Puerto ${item.puerto}`),
    (item) => item.ataques,
    'Flujos de ataque',
  );
  drawRankedList(
    'hourlyActivity',
    analytics.horas,
    (item) => `${item.hora}:00 h`,
    (item) => item.ataques,
    'Flujos de ataque',
  );
};

const drawFlows = (flows) => {
  const tbody = $('flowRows');
  tbody.replaceChildren();
  if (!flows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'empty-cell';
    cell.colSpan = 6;
    cell.textContent = 'La colección no contiene registros.';
    row.append(cell);
    tbody.append(row);
    return;
  }

  for (const flow of flows) {
    const row = document.createElement('tr');
    const values = [
      flow.fecha,
      flow.ip || '—',
      flow.ipDestino || '—',
      flow.protocolo == null ? '—' : String(flow.protocolo),
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const label = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = `tag${String(flow.tipo).toUpperCase() === 'BENIGN' ? ' benign' : ''}`;
    tag.textContent = flow.tipo || 'Sin clasificación';
    label.append(tag);
    row.append(label);
    const duration = document.createElement('td');
    duration.textContent = flow.duracionFlujo == null ? '—' : `${numberFormat.format(flow.duracionFlujo)} µs`;
    row.append(duration);
    tbody.append(row);
  }
};

const loadDashboard = async () => {
  try {
    const [summary, analytics, topIps, flows] = await Promise.all([
      requestJson('/api/informes/resumen'),
      requestJson('/api/informes/analitica?days=7&limit=8'),
      requestJson('/api/informes/top-ips?limit=5'),
      requestJson('/api/informes?limit=10'),
    ]);

    setText('metricReportTitle', 'INFORME 1 · INDICADORES GENERALES');
    setText('metricTotal', numberFormat.format(summary.totalFlujosEstimado));
    setText('metricAttacks', numberFormat.format(summary.flujosDeAtaque));
    setText('metricSample', `${numberFormat.format(summary.flujosAnalizados)} flujos (dataset completo)`);
    setText('metricRate', `${numberFormat.format(summary.porcentajeDeAtaque)}%`);
    setText('metricType', summary.tipoAtaqueMasFrecuente || 'Sin datos');
    drawAnalitica(analytics);
    drawTopIps(topIps);
    drawFlows(flows);
    setText('updatedAt', `Actualizado ${new Date().toLocaleTimeString('es-CO')}`);
    setText('pageError', '');
    setConnection('databaseLight', 'databaseStatus', 'databaseDetail', 'ok', 'MongoDB conectado', 'Datos consultados en vivo');
  } catch (error) {
    showDashboardError(error);
  }
};

const checkHealth = async () => {
  try {
    const health = await requestJson('/api/health');
    setConnection('databaseLight', 'databaseStatus', 'databaseDetail', 'ok', 'MongoDB conectado', 'Base y colección disponibles');
    const streamConnected = health.realtime === 'connected';
    setConnection(
      'streamLight',
      'streamStatus',
      'streamDetail',
      streamConnected ? 'ok' : 'bad',
      streamConnected ? 'Tiempo real conectado' : 'Tiempo real no disponible',
      'Change stream de MongoDB',
    );
    setConnection(
      'aiLight',
      'aiStatus',
      'aiDetail',
      health.ollama?.status === 'ready' ? 'ok' : 'bad',
      health.ollama?.status === 'ready' ? 'Ollama listo' : 'Ollama no listo',
      health.ollama?.status === 'model_missing'
        ? `Falta el modelo ${health.ollama.model}`
        : health.ollama?.status === 'ready'
          ? `Modelo ${health.ollama.model}`
          : 'Verifica Ollama en esta máquina',
    );
  } catch (error) {
    setConnection('databaseLight', 'databaseStatus', 'databaseDetail', 'bad', 'MongoDB no disponible', error.message);
    setConnection('streamLight', 'streamStatus', 'streamDetail', 'bad', 'Tiempo real desconectado', 'Comprueba la conexión');
    setConnection('aiLight', 'aiStatus', 'aiDetail', 'bad', 'Ollama no verificado', 'Comprueba la conexión');
  }
};

const appendMessage = (className, text) => {
  const article = document.createElement('article');
  article.className = `message ${className}`;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  article.append(paragraph);
  $('conversation').append(article);
  article.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return article;
};

const askQuestion = async (question) => {
  appendMessage('user-message', question);
  const pending = appendMessage('assistant-message', 'Consultando el modelo local y ejecutando la agregación en MongoDB…');
  $('askButton').disabled = true;
  $('questionInput').disabled = true;
  try {
    const result = await requestJson('/api/consultas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    pending.replaceChildren();
    const explanation = document.createElement('p');
    explanation.textContent = result.explanation;
    pending.append(explanation);

    if (result.pipeline.length) {
      const pipelineDetails = document.createElement('details');
      pipelineDetails.className = 'answer-results';
      const pipelineSummary = document.createElement('summary');
      pipelineSummary.textContent = `Pipeline de solo lectura ejecutado en ${result.coleccion} · ${result.pipeline.length} etapa(s)`;
      const pipelineOutput = document.createElement('pre');
      pipelineOutput.textContent = JSON.stringify(result.pipeline, null, 2);
      pipelineDetails.append(pipelineSummary, pipelineOutput);
      pending.append(pipelineDetails);
    }

    if (result.resultados.length) {
      const details = document.createElement('details');
      details.className = 'answer-results';
      const summary = document.createElement('summary');
      summary.textContent = `${result.totalResultados} resultado(s) · ${result.coleccion} · ${numberFormat.format(result.tiempoMs)} ms`;
      const output = document.createElement('pre');
      output.textContent = JSON.stringify(result.resultados, null, 2);
      details.append(summary, output);
      pending.append(details);
    } else if (result.pipeline.length === 0) {
      pending.dataset.noPipeline = 'true';
    } else {
      const empty = document.createElement('p');
      empty.className = 'privacy-note';
      empty.textContent = 'La consulta no encontró resultados en la colección.';
      pending.append(empty);
    }
  } catch (error) {
    pending.replaceChildren();
    const explanation = document.createElement('p');
    explanation.textContent = error.message;
    pending.append(explanation);
  } finally {
    $('askButton').disabled = false;
    $('questionInput').disabled = false;
    $('questionInput').focus();
    $('conversation').scrollTop = $('conversation').scrollHeight;
  }
};

$('questionForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const question = $('questionInput').value.trim();
  if (!question) return;
  $('questionInput').value = '';
  askQuestion(question);
});

for (const button of document.querySelectorAll('[data-prompt]')) {
  button.addEventListener('click', () => {
    $('questionInput').value = button.dataset.prompt;
    $('questionInput').focus();
  });
}

$('refreshButton').addEventListener('click', () => {
  loadDashboard();
  loadComparison();
  checkHealth();
});

const events = new EventSource('/api/events/flows');
let liveEventCount = 0;
const recentLiveEvents = [];

const renderLiveEvents = () => {
  setText('liveEventCount', numberFormat.format(liveEventCount));
  const list = $('liveEventList');
  list.replaceChildren();
  for (const item of recentLiveEvents) {
    const row = document.createElement('li');
    row.textContent = item;
    list.append(row);
  }
};

events.addEventListener('stream-status', (event) => {
  const { status } = JSON.parse(event.data);
  const connected = status === 'connected';
  setText('liveReportStatus', connected ? 'Stream conectado' : 'Reconectando…');
  $('liveReportStatus').classList.toggle('connected', connected);
  setConnection(
    'streamLight',
    'streamStatus',
    'streamDetail',
    connected ? 'ok' : 'bad',
    connected ? 'Tiempo real conectado' : 'Tiempo real reconectando',
    'Change stream de MongoDB',
  );
});
events.addEventListener('mongo-change', (event) => {
  const change = JSON.parse(event.data);
  const operations = {
    insert: 'Inserción',
    update: 'Actualización',
    replace: 'Reemplazo',
    delete: 'Eliminación',
  };
  const receivedAt = new Date(change.at);
  const message = `${operations[change.operation] || 'Cambio'} · documento ${change.documentId || 'sin ID'} · ${receivedAt.toLocaleTimeString('es-CO')}`;
  liveEventCount += 1;
  recentLiveEvents.unshift(message);
  recentLiveEvents.splice(8);
  renderLiveEvents();
  setText('liveLastChange', `Último cambio: ${receivedAt.toLocaleString('es-CO')}`);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadDashboard, 400);
});
// El backend suma las inserciones a las colecciones resumen por lotes y avisa al terminar.
events.addEventListener('resumenes-actualizados', () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadDashboard, 200);
});
events.onerror = () => {
  setText('liveReportStatus', 'Reconectando…');
  $('liveReportStatus').classList.remove('connected');
  setConnection('streamLight', 'streamStatus', 'streamDetail', 'bad', 'Tiempo real reconectando', 'Reintento automático');
};

loadDashboard();
loadComparison();
checkHealth();
