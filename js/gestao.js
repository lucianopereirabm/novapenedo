// Gestão: monitoramento com mapa, montar rotas, clientes, variável, equipe, configurações e importação
import {
  auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, collection, query, where, onSnapshot, writeBatch, deleteField,
  criarAcessoPromotor, usuarioDeNome, $, h, semAcento, DIAS, DIAS_LONGO, ymd, diaSemana, dataBR, hm, dur, brl, n2, pctf,
  lsGet, lsSet, toast, abreModal, fechaModal, confirma, erroMsg, distancia
} from './fb.js';

const ADMIN_UID = 'LwETkIMFw0b6gVWl6XV450J1Dr12';
const FAIXAS = [[0.75, 500], [1, 375], [1.5, 250], [2, 150]];
const CHECK_PADRAO = ['Produto em ruptura (faltando na gôndola)', 'Produto com validade próxima', 'Preço divergente da tabela', 'Gôndola abastecida e organizada'];
const CORES = ['#E0457B', '#2F80ED', '#27AE60', '#F2994A', '#9B51E0', '#00A3A3', '#B8860B', '#EB5757', '#56CCF2', '#6FCF97', '#BB6BD9', '#333F99'];
const LOGO = 'img/logo.png';

const S = { promotores: [], lojas: [], acessos: {}, checklist: CHECK_PADRAO, raio: 150, regras: { base: 250, meta: 70000, prop: false },
  tab: lsGet('np.g.tab') || 'painel', pronto: { p: false, l: false } };
const secoes = ['painel', 'montar', 'cli', 'var', 'equipe', 'config'];

/* ---------- login ---------- */
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault(); $('#lg-msg').textContent = 'Entrando…';
  try { await signInWithEmailAndPassword(auth, $('#lg-email').value.trim(), $('#lg-senha').value); }
  catch (err) { $('#lg-msg').textContent = erroMsg(err).replace('Usuário ou código', 'E-mail ou senha'); }
});
$('#sair').onclick = async () => { await signOut(auth); location.reload(); };
onAuthStateChanged(auth, async user => {
  $('#v-login').hidden = !!user; $('#sair').hidden = !user;
  if (!user) { $('#shell').hidden = true; return; }
  let admin = user.uid === ADMIN_UID;
  if (!admin) { try { admin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch (e) {} }
  if (!admin) { $('#v-negado').hidden = false; return; }
  $('#quem').innerHTML = `Gestão<b>${h(user.email || '')}</b>`;
  $('#shell').hidden = false; iniciar();
});

function iniciar() {
  onSnapshot(collection(db, 'promotores'), s => { S.promotores = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome)); S.pronto.p = true; render(); }, e => toast(erroMsg(e)));
  onSnapshot(collection(db, 'lojas'), s => { S.lojas = s.docs.map(d => ({ id: d.id, ...d.data() })); S.pronto.l = true; render(); }, e => toast(erroMsg(e)));
  onSnapshot(collection(db, 'acessos'), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.acessos = m; if (S.tab === 'equipe') render(); }, () => {});
  onSnapshot(doc(db, 'config', 'checklist'), s => { const it = s.exists() && s.data().itens; S.checklist = Array.isArray(it) && it.length ? it : CHECK_PADRAO; if (S.tab === 'config') render(); }, () => {});
  onSnapshot(doc(db, 'config', 'app'), s => { if (s.exists() && +s.data().raio) S.raio = +s.data().raio; if (S.tab === 'config') render(); }, () => {});
  onSnapshot(doc(db, 'config', 'variavel'), s => { if (s.exists()) S.regras = Object.assign({ base: 250, meta: 70000, prop: false }, s.data()); if (S.tab === 'var' || S.tab === 'config') render(); }, () => {});
  document.querySelectorAll('.side-item').forEach(b => b.onclick = () => { S.tab = b.dataset.go; lsSet('np.g.tab', S.tab); mostra(); window.scrollTo(0, 0); });
  if (!secoes.includes(S.tab)) S.tab = 'painel';
  mostra(); assinaPainel(); assinaVar();
}
function mostra() {
  secoes.forEach(x => $('#v-' + x).hidden = x !== S.tab);
  document.querySelectorAll('.side-item').forEach(b => b.setAttribute('aria-current', String(b.dataset.go === S.tab)));
  render();
}
function render() {
  if (S.tab === 'painel') renderPainel();
  if (S.tab === 'montar') renderMontar();
  if (S.tab === 'cli') renderClientes();
  if (S.tab === 'var') renderVar();
  if (S.tab === 'equipe') renderEquipe();
  if (S.tab === 'config') renderConfig();
}

/* ---------- utilidades de rota ---------- */
const promNome = id => (S.promotores.find(p => p.id === id) || {}).nome || 'Sem promotor';
const prim = id => promNome(id).split(' ')[0];
const corDe = id => CORES[Math.max(0, S.promotores.findIndex(p => p.id === id)) % CORES.length];
const posDia = (l, wd) => { const o = l.ordemDia && l.ordemDia[wd]; return typeof o === 'number' ? o : 1000 + (l.ordem || 999); };
const lojasDoDiaWd = (pid, wd) => S.lojas.filter(l => l.promotorId === pid && (l.dias || []).map(Number).includes(wd)).sort((a, b) => posDia(a, wd) - posDia(b, wd));
const lojasDoDia = (pid, date) => lojasDoDiaWd(pid, diaSemana(date));
const endCompleto = l => [l.endereco, l.bairro, [l.municipio, l.uf].filter(Boolean).join(' - '), l.cep ? 'CEP ' + l.cep : ''].filter(Boolean).join(', ');
const cod = l => l && l.codigo ? `<span class="num muted">${h(l.codigo)}</span> · ` : '';
const vazioCarregando = () => !(S.pronto.p && S.pronto.l);

/* =========================================================
   MONITORAMENTO
   ========================================================= */
const P = { data: ymd(new Date()), vis: {}, unsub: null, mapa: null, camada: null, sel: '' };
function assinaPainel() {
  if (P.unsub) P.unsub();
  P.vis = {};
  P.unsub = onSnapshot(collection(db, 'dias', P.data, 'visitas'), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); P.vis = m; if (S.tab === 'painel') renderPainel(); }, e => toast(erroMsg(e)));
}
function renderPainel() {
  const c = $('#v-painel');
  if (!c.dataset.ok) {
    c.dataset.ok = 1;
    c.innerHTML = `<div class="spread" style="flex-wrap:wrap"><h2>Monitoramento</h2><div class="row"><select id="p-prom" style="width:auto"></select><input type="date" id="p-data" style="width:auto"></div></div>
      <div id="p-kpis"></div><div id="mapa"></div><div id="p-legenda" class="row" style="font-size:13px"></div><div id="p-corpo" class="grid2"></div>`;
    $('#p-data').value = P.data;
    $('#p-data').onchange = e => { if (!e.target.value) return; P.data = e.target.value; assinaPainel(); renderPainel(); };
    $('#p-prom').onchange = e => { P.sel = e.target.value; renderPainel(); };
  }
  if (vazioCarregando()) { $('#p-corpo').innerHTML = '<div class="empty">Carregando…</div>'; return; }
  const sel = $('#p-prom'); const cur = P.sel;
  sel.innerHTML = '<option value="">Todos os promotores</option>' + S.promotores.filter(p => p.ativo !== false).map(p => `<option value="${h(p.id)}">${h(p.nome)}</option>`).join('');
  sel.value = cur;
  const ids = new Set(S.promotores.filter(p => p.ativo !== false).map(p => p.id));
  Object.values(P.vis).forEach(v => ids.add(v.promotorId));
  let plan = 0, feitas = 0, nao = 0, live = 0;
  const blocos = [...ids].filter(pid => !P.sel || pid === P.sel).map(pid => {
    const lojas = lojasDoDia(pid, P.data);
    const linhas = lojas.map((l, i) => ({ ordem: i + 1, l, nome: l.nome, codigo: l.codigo, id: l.id + '_' + pid, v: P.vis[l.id + '_' + pid] }));
    Object.entries(P.vis).filter(([k, v]) => v.promotorId === pid && !linhas.some(x => x.id === k)).forEach(([k, v]) => linhas.push({ ordem: null, nome: v.lojaNome, codigo: v.codigo, id: k, v, extra: true }));
    if (!linhas.length) return '';
    plan += lojas.length;
    linhas.forEach(x => { if (!x.v) return; if (x.v.status === 'concluida') feitas++; else if (x.v.status === 'nao_visitada') nao++; else live++; });
    const ok = linhas.filter(x => x.v && x.v.status === 'concluida').length;
    const tempo = linhas.reduce((s, x) => s + (x.v && x.v.checkin && x.v.checkout ? x.v.checkout - x.v.checkin : 0), 0);
    return `<div class="card stack"><div class="spread"><h3><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${corDe(pid)};margin-right:6px"></span>${h(promNome(pid))}</h3><span class="muted num" style="font-size:13px">${ok}/${lojas.length}${tempo ? ' · ' + dur(1, 1 + tempo) + ' em loja' : ''}</span></div>
      <div class="table-wrap"><table class="num"><thead><tr><th>#</th><th>Loja</th><th>Status</th><th>Entrada</th><th>Saída</th><th>GPS</th></tr></thead><tbody>
      ${linhas.map(x => {
        const v = x.v; const st = !v ? '<span class="pill pend">Pendente</span>' : v.status === 'concluida' ? '<span class="pill ok">Concluída</span>' : v.status === 'nao_visitada' ? `<span class="pill no">${h(v.motivo)}</span>` : '<span class="pill live">Em loja</span>';
        const gps = !v || v.status === 'nao_visitada' ? '—' : v.semCoord ? '<span class="tag y">sem local</span>' : v.distIn == null ? '—' : `<span class="tag ${v.distIn > S.raio ? 'no' : ''}">${v.distIn} m</span>`;
        return `<tr class="${v ? 'click' : ''}" ${v ? `data-v="${h(x.id)}"` : ''}><td>${x.extra ? '+' : x.ordem}</td><td>${h(x.nome)}<div class="muted" style="font-size:12px">${h(x.codigo || '')}${x.extra ? ' · fora da rota' : ''}</div></td><td>${st}</td><td>${v ? hm(v.checkin) : '—'}</td><td>${v ? hm(v.checkout) : '—'}</td><td>${gps}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
  }).join('');
  $('#p-kpis').innerHTML = `<div class="kpis num"><div class="kpi"><b>${plan}</b><span>Lojas na rota</span></div><div class="kpi"><b style="color:var(--ok)">${feitas}</b><span>Concluídas</span></div><div class="kpi"><b style="color:var(--warn)">${live}</b><span>Em loja agora</span></div><div class="kpi"><b style="color:var(--crit)">${nao}</b><span>Não visitadas</span></div></div>`;
  $('#p-corpo').innerHTML = blocos || `<div class="empty"><b>Nenhuma rota em ${DIAS_LONGO[diaSemana(P.data)]}, ${dataBR(P.data)}</b>As lojas aparecem conforme os dias marcados em Montar rotas.</div>`;
  $('#p-corpo').querySelectorAll('tr[data-v]').forEach(tr => tr.onclick = () => detalheVisita(P.data, tr.dataset.v));
  desenhaMapa();
}
function desenhaMapa() {
  if (!window.L) { setTimeout(desenhaMapa, 400); return; }
  if (!P.mapa) {
    P.mapa = L.map('mapa', { scrollWheelZoom: false }).setView([-22.5, -44.1], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(P.mapa);
  }
  if (P.camada) P.camada.remove();
  P.camada = L.layerGroup().addTo(P.mapa);
  const pts = []; const porProm = {};
  Object.entries(P.vis).forEach(([id, v]) => {
    if (P.sel && v.promotorId !== P.sel) return;
    if (!v.gpsIn) return;
    const p = [v.gpsIn.lat, v.gpsIn.lng]; pts.push(p);
    (porProm[v.promotorId] = porProm[v.promotorId] || []).push({ t: v.checkin || v.registrado || 0, p });
    const cor = corDe(v.promotorId);
    L.circleMarker(p, { radius: 8, color: '#fff', weight: 2, fillColor: v.status === 'nao_visitada' ? '#999' : cor, fillOpacity: 1 })
      .bindPopup(`<b>${h(v.lojaNome)}</b><br>${h(prim(v.promotorId))} · ${v.status === 'nao_visitada' ? 'Não visitada: ' + h(v.motivo) : hm(v.checkin) + '–' + hm(v.checkout)}${v.distIn != null ? '<br>' + v.distIn + ' m da loja' : ''}`)
      .on('click', () => {}).addTo(P.camada);
  });
  // locais cadastrados das lojas da rota do dia
  S.lojas.filter(l => l.lat != null && l.promotorId && (!P.sel || l.promotorId === P.sel) && (l.dias || []).map(Number).includes(diaSemana(P.data))).forEach(l => {
    L.circleMarker([+l.lat, +l.lng], { radius: 5, color: corDe(l.promotorId), weight: 2, fillOpacity: 0 }).bindPopup(`Loja: <b>${h(l.nome)}</b> (${h(l.codigo)})`).addTo(P.camada);
  });
  Object.entries(porProm).forEach(([pid, arr]) => { if (arr.length > 1) L.polyline(arr.sort((a, b) => a.t - b.t).map(x => x.p), { color: corDe(pid), weight: 3, opacity: .7, dashArray: '6 6' }).addTo(P.camada); });
  if (pts.length) P.mapa.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  setTimeout(() => P.mapa.invalidateSize(), 50);
  $('#p-legenda').innerHTML = Object.keys(porProm).map(pid => `<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${corDe(pid)}"></span> ${h(prim(pid))}</span>`).join('') + (pts.length ? '<span class="muted">· círculo vazado = local cadastrado da loja · tracejado = trajeto do dia</span>' : '<span class="muted">Sem check-ins com GPS nesta data.</span>');
}
// Mostra quando o registro feito no celular chegou ao sistema (registros sem sinal chegam depois)
const ms = t => t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null);
function linhaEnvio(v) {
  const rIn = ms(v.recebidoIn), r = ms(v.recebido);
  if (!rIn) return '';
  const atrasoIn = rIn - (v.checkin || v.registrado || rIn), atrasoOut = v.checkout && r ? r - v.checkout : 0;
  const longe = x => x > 10 * 60000;
  if (!longe(atrasoIn) && !longe(atrasoOut)) return '<div class="muted" style="font-size:13px">Registros enviados na hora (com sinal).</div>';
  return `<div class="note warn">Feito sem sinal: ${longe(atrasoIn) ? `check-in feito às ${hm(v.checkin || v.registrado)} e recebido às ${hm(rIn)}` : ''}${longe(atrasoIn) && longe(atrasoOut) ? ' · ' : ''}${longe(atrasoOut) ? `check-out feito às ${hm(v.checkout)} e recebido às ${hm(r)}` : ''}. Os horários e o GPS valem do momento em que foram feitos no celular.</div>`;
}
async function detalheVisita(date, id) {
  const v = P.vis[id]; if (!v) return;
  const loja = S.lojas.find(l => l.id === v.lojaId);
  const resp = v.checklist || {};
  abreModal(`<div class="spread" style="align-items:flex-start"><div><div class="label">${h(v.promotorNome || prim(v.promotorId))} · ${dataBR(date)}</div><h3 style="font-size:20px">${h(v.lojaNome)}</h3></div><button class="btn ghost" id="md-x">Fechar</button></div>
    ${v.status === 'nao_visitada' ? `<div class="note warn"><b>Não visitada:</b> ${h(v.motivo)}${v.obs ? ' — ' + h(v.obs) : ''}</div>` :
    `<div class="times num"><div><span class="label">Entrada</span><b>${hm(v.checkin)}</b></div><div><span class="label">Saída</span><b>${hm(v.checkout)}</b></div><div><span class="label">Tempo</span><b>${dur(v.checkin, v.checkout)}</b></div></div>
     <div class="note ${v.semCoord ? 'warn' : v.distIn > S.raio ? 'crit' : 'ok'}">${v.gpsIn ? `Check-in em ${v.gpsIn.lat.toFixed(5)}, ${v.gpsIn.lng.toFixed(5)} (precisão ${v.gpsIn.prec} m)` : 'Sem GPS no check-in'}${v.distIn != null ? ` · ${v.distIn} m da loja` : ''}${v.distOut != null ? ` · check-out a ${v.distOut} m` : ''}${v.semCoord ? '<br>A loja não tinha localização cadastrada.' : ''}</div>
     ${linhaEnvio(v)}
     ${v.gpsIn && loja ? `<div class="row"><button class="btn sm" id="md-local">Usar este ponto como local da loja</button><a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${v.gpsIn.lat},${v.gpsIn.lng}">Ver no Google Maps</a></div>` : ''}
     <div><div class="label">Checklist</div>${Object.keys(resp).filter(k => resp[k]).map(k => `<div class="spread" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${h(k)}</span><b>${resp[k] === 'sim' ? 'Sim' : 'Não'}</b></div>`).join('') || '<div class="muted">Sem respostas.</div>'}</div>
     ${v.obs ? `<div><div class="label">Observações</div><div style="white-space:pre-wrap">${h(v.obs)}</div></div>` : ''}
     <div><div class="label">Fotos</div><div id="md-fotos" class="stack muted">Carregando fotos…</div></div>`}`);
  $('#md-x').onclick = fechaModal;
  const bl = $('#md-local');
  if (bl) bl.onclick = async () => {
    if (!(await confirma(`Gravar o local do check-in como localização de ${loja.nome}? A partir daí o check-in dessa loja só abre dentro do raio de ${S.raio} m.`, 'Gravar local'))) return;
    updateDoc(doc(db, 'lojas', loja.id), { lat: v.gpsIn.lat, lng: v.gpsIn.lng, coordFonte: 'check-in ' + dataBR(date), atualizado: Date.now() }).then(() => toast('Local da loja gravado'), e => toast(erroMsg(e)));
  };
  if (v.status !== 'nao_visitada') {
    try {
      const s = await getDoc(doc(db, 'dias', date, 'fotos', id)); const box = $('#md-fotos'); if (!box) return;
      const nomes = { chegada: 'Chegada (selfie)', antes: 'Gôndola antes', depois: 'Gôndola depois', extra: 'Foto extra' };
      box.innerHTML = s.exists() && (s.data().imgs || []).length ? s.data().imgs.map(f => `<div class="stack" style="gap:4px"><div class="label" style="color:var(--ink)">${nomes[f.tipo] || 'Foto'} · ${hm(f.ts)}</div><img class="bigfoto" src="${f.d}" alt="${nomes[f.tipo] || 'Foto'}"></div>`).join('') : 'Nenhuma foto.';
    } catch (e) { const box = $('#md-fotos'); if (box) box.textContent = 'Não consegui carregar as fotos.'; }
  }
}

/* =========================================================
   MONTAR ROTAS
   ========================================================= */
const M = { pid: lsGet('np.m.prom') || '', wd: +(lsGet('np.m.dia') || 1), q: '' };
function salvaLoja(l, campos) {
  Object.assign(l, campos);
  return updateDoc(doc(db, 'lojas', l.id), Object.assign({}, campos, { atualizado: Date.now() })).catch(e => toast(erroMsg(e)));
}
function renumera(lista) {
  lista.forEach((l, i) => { if (!(l.ordemDia && l.ordemDia[M.wd] === i + 1)) salvaLoja(l, { ordemDia: Object.assign({}, l.ordemDia, { [M.wd]: i + 1 }) }); });
  renderMontar();
}
function renderMontar() {
  const c = $('#v-montar');
  if (!c.dataset.ok) {
    c.dataset.ok = 1;
    c.innerHTML = `<h2>Montar rotas</h2>
      <div class="card stack"><div class="spread"><h3>Visão da semana</h3><span class="muted" style="font-size:13px">Clientes por dia · clique para editar</span></div><div class="table-wrap" id="m-semana"></div></div>
      <div class="row" style="align-items:end"><label class="field" style="flex:1 1 240px"><span>Promotor</span><select id="m-prom"></select></label>
      <div class="field" style="flex:2 1 320px"><span>Dia da semana</span><div class="chips" id="m-dias"></div></div></div>
      <div class="grid2"><div id="m-rota" class="stack"></div>
      <div class="card stack"><h3>Adicionar clientes</h3><input type="text" id="m-busca" placeholder="Buscar por código, nome, bairro ou cidade" autocomplete="off"><div id="m-res" style="max-height:70vh;overflow-y:auto"></div></div></div>`;
    $('#m-dias').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip" data-d="${d}" aria-pressed="false">${DIAS[d]}</button>`).join('');
    $('#m-dias').querySelectorAll('.chip').forEach(b => b.onclick = () => { M.wd = +b.dataset.d; lsSet('np.m.dia', M.wd); renderMontar(); });
    $('#m-prom').onchange = e => { M.pid = e.target.value; lsSet('np.m.prom', M.pid); renderMontar(); };
    let t = null; $('#m-busca').oninput = () => { clearTimeout(t); t = setTimeout(renderBusca, 150); };
  }
  if (vazioCarregando()) return;
  const ps = S.promotores.filter(p => p.ativo !== false);
  $('#m-semana').innerHTML = `<table class="semana num"><thead><tr><th>Promotor</th>${[1, 2, 3, 4, 5, 6].map(d => `<th>${DIAS[d]}</th>`).join('')}<th>Clientes</th></tr></thead><tbody>${ps.map(p => `<tr><td>${h(p.nome.split(' ').slice(0, 2).join(' '))}</td>${[1, 2, 3, 4, 5, 6].map(d => { const n = lojasDoDiaWd(p.id, d).length; return `<td><button class="${n ? '' : 'zero'} ${p.id === M.pid && d === M.wd ? 'on' : ''}" data-sp="${h(p.id)}" data-sd="${d}">${n || '–'}</button></td>`; }).join('')}<td>${S.lojas.filter(l => l.promotorId === p.id).length}</td></tr>`).join('')}</tbody></table>`;
  $('#m-semana').querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { M.pid = b.dataset.sp; M.wd = +b.dataset.sd; lsSet('np.m.prom', M.pid); lsSet('np.m.dia', M.wd); renderMontar(); });
  $('#m-prom').innerHTML = '<option value="">Escolha o promotor</option>' + ps.map(p => `<option value="${h(p.id)}">${h(p.nome)}</option>`).join('');
  $('#m-prom').value = ps.some(p => p.id === M.pid) ? M.pid : ''; M.pid = $('#m-prom').value;
  $('#m-dias').querySelectorAll('.chip').forEach(b => { const d = +b.dataset.d; const n = M.pid ? lojasDoDiaWd(M.pid, d).length : 0; b.setAttribute('aria-pressed', String(d === M.wd)); b.textContent = DIAS[d] + (n ? ' · ' + n : ''); });
  const box = $('#m-rota');
  if (!M.pid) { box.innerHTML = '<div class="empty"><b>Escolha o promotor</b>Depois escolha o dia e adicione os clientes na ordem de atendimento.</div>'; $('#m-res').innerHTML = ''; return; }
  const lista = lojasDoDiaWd(M.pid, M.wd);
  box.innerHTML = `<div class="spread"><h3>Rota de ${DIAS_LONGO[M.wd]} · ${h(prim(M.pid))}</h3><span class="muted num">${lista.length} cliente${lista.length === 1 ? '' : 's'}</span></div>` +
    (lista.length ? lista.map((l, i) => `<div class="ritem"><span class="n num">${i + 1}</span><span class="t"><b>${h(l.nome)}</b><span>${cod(l)}${h(l.bairro || '')}${l.lat == null ? ' · <span class="tag y">sem local</span>' : ''}</span></span>
      <span class="row" style="gap:2px"><button class="ib" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button class="ib" data-dn="${i}" ${i === lista.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button><button class="ib x" data-rm="${i}" aria-label="Tirar">×</button></span></div>`).join('')
      : `<div class="empty"><b>Nenhum cliente na ${DIAS_LONGO[M.wd]}</b>Busque ao lado e clique em Adicionar, na ordem de atendimento.</div>`);
  box.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; const a = lista.slice();[a[i - 1], a[i]] = [a[i], a[i - 1]]; renumera(a); });
  box.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { const i = +b.dataset.dn; const a = lista.slice();[a[i + 1], a[i]] = [a[i], a[i + 1]]; renumera(a); });
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const l = lista[+b.dataset.rm]; const od = Object.assign({}, l.ordemDia); delete od[M.wd];
    salvaLoja(l, { dias: (l.dias || []).map(Number).filter(d => d !== M.wd), ordemDia: od });
    toast(l.nome + ' saiu da rota de ' + DIAS_LONGO[M.wd]); renumera(lista.filter(x => x !== l));
  });
  renderBusca();
}
function renderBusca() {
  const r = $('#m-res'); if (!r || !M.pid) return;
  const q = semAcento($('#m-busca').value.trim());
  let itens = q ? S.lojas.filter(l => { const t = semAcento([l.codigo, l.nome, l.razao, l.bairro, l.municipio, l.praca, promNome(l.promotorId)].join(' ')); return q.split(/\s+/).every(x => t.includes(x)); })
    : S.lojas.filter(l => l.promotorId === M.pid && !(l.dias || []).map(Number).includes(M.wd));
  itens.sort((a, b) => (a.promotorId === M.pid ? 0 : 1) - (b.promotorId === M.pid ? 0 : 1) || a.nome.localeCompare(b.nome));
  if (!itens.length) { r.innerHTML = `<div class="muted" style="font-size:14px">${q ? 'Nenhum cliente encontrado.' : 'Todos os clientes deste promotor já estão neste dia. Busque para trazer outros.'}</div>`; return; }
  r.innerHTML = itens.slice(0, 60).map(l => {
    const naRota = l.promotorId === M.pid && (l.dias || []).map(Number).includes(M.wd);
    const outro = l.promotorId && l.promotorId !== M.pid;
    const dias = [1, 2, 3, 4, 5, 6, 0].filter(d => (l.dias || []).map(Number).includes(d)).map(d => DIAS[d]).join(' ');
    return `<div class="res"><div class="t"><b>${h(l.nome)}</b><div>${cod(l)}${h(l.bairro || '')}, ${h(l.municipio || '')}</div>
      <div class="row" style="gap:6px;margin-top:3px">${outro ? `<span class="tag">${h(prim(l.promotorId))}</span>` : ''}${dias ? `<span class="tag">${dias}</span>` : '<span class="tag">sem dia</span>'}${l.bloqueado ? '<span class="tag no">bloqueado</span>' : ''}</div></div>
      ${naRota ? '<span class="tag y">Na rota</span>' : `<button class="btn sm ${outro ? '' : 'primary'}" data-add="${h(l.id)}">Adicionar</button>`}</div>`;
  }).join('') + (itens.length > 60 ? `<div class="muted" style="font-size:13px;padding-top:8px">Mostrando 60 de ${itens.length}. Refine a busca.</div>` : '');
  r.querySelectorAll('[data-add]').forEach(b => b.onclick = () => adicionaNaRota(S.lojas.find(l => l.id === b.dataset.add)));
}
async function adicionaNaRota(l) {
  const pos = lojasDoDiaWd(M.pid, M.wd).length + 1;
  if (l.promotorId && l.promotorId !== M.pid) {
    if (!(await confirma(`${l.nome} é atendido por ${promNome(l.promotorId)}. Passar para ${promNome(M.pid)}? Os dias antigos saem e fica só ${DIAS_LONGO[M.wd]}.`, 'Passar cliente'))) return;
    salvaLoja(l, { promotorId: M.pid, dias: [M.wd], ordemDia: { [M.wd]: pos } });
  } else salvaLoja(l, { promotorId: M.pid, dias: [...new Set([...(l.dias || []).map(Number), M.wd])], ordemDia: Object.assign({}, l.ordemDia, { [M.wd]: pos }) });
  toast(`${l.nome} entrou como ${pos}ª parada`); renderMontar();
}

/* =========================================================
   CLIENTES
   ========================================================= */
const CF = { f: 'ativos', n: 80, q: '' };
const CAMPOS = [['codigo', 'Código'], ['nome', 'Nome fantasia'], ['razao', 'Razão social'], ['cnpj', 'CNPJ'], ['endereco', 'Endereço (rua e número)'], ['bairro', 'Bairro'], ['municipio', 'Município'], ['uf', 'UF'], ['cep', 'CEP'], ['telefone', 'Telefone'], ['praca', 'Praça'], ['ref', 'Ponto de referência']];
function renderClientes() {
  const c = $('#v-cli');
  if (!c.dataset.ok) {
    c.dataset.ok = 1;
    c.innerHTML = `<div class="spread"><h2>Clientes</h2><button class="btn primary" id="cli-novo">+ Novo cliente</button></div>
      <input type="text" id="cli-busca" placeholder="Buscar por código, nome, endereço, bairro, cidade ou praça" autocomplete="off">
      <div class="chips" id="cli-f">${[['ativos', 'Ativos'], ['rota', 'Com promotor'], ['sem', 'Sem promotor'], ['semlocal', 'Na rota sem local'], ['bloq', 'Bloqueados'], ['todos', 'Todos']].map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${k === CF.f}">${l}</button>`).join('')}</div>
      <div id="cli-lista" class="card"></div>`;
    $('#cli-f').querySelectorAll('.chip').forEach(b => b.onclick = () => { CF.f = b.dataset.f; CF.n = 80; $('#cli-f').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderClientes(); });
    let t = null; $('#cli-busca').oninput = () => { clearTimeout(t); t = setTimeout(() => { CF.n = 80; renderClientes(); }, 150); };
    $('#cli-novo').onclick = () => fichaEdicao(null);
  }
  const box = $('#cli-lista');
  if (vazioCarregando()) { box.innerHTML = '<div class="muted">Carregando clientes…</div>'; return; }
  const q = semAcento($('#cli-busca').value.trim()); const termos = q ? q.split(/\s+/) : [];
  const it = S.lojas.filter(l => {
    if (CF.f === 'ativos' && l.bloqueado) return false;
    if (CF.f === 'bloq' && !l.bloqueado) return false;
    if (CF.f === 'rota' && !l.promotorId) return false;
    if (CF.f === 'sem' && (l.promotorId || l.bloqueado)) return false;
    if (CF.f === 'semlocal' && !(l.promotorId && l.lat == null)) return false;
    if (!termos.length) return true;
    const t = semAcento([l.codigo, l.nome, l.razao, l.endereco, l.bairro, l.municipio, l.praca, promNome(l.promotorId)].join(' '));
    return termos.every(x => t.includes(x));
  }).sort((a, b) => (+a.codigo || 0) - (+b.codigo || 0));
  if (!it.length) { box.innerHTML = '<div class="muted">Nenhum cliente encontrado.</div>'; return; }
  box.innerHTML = `<div class="label" style="margin-bottom:4px">${it.length} cliente${it.length === 1 ? '' : 's'}</div>` + it.slice(0, CF.n).map(l => `<button class="res" data-cli="${h(l.id)}" style="width:100%;background:none;border:0;border-top:1px solid var(--line);text-align:left;color:inherit">
    <div class="t"><b><span class="num muted">${h(l.codigo || '—')}</span> · ${h(l.nome)}</b><div>${h(endCompleto(l))}</div>
    <div class="row" style="gap:6px;margin-top:3px">${l.promotorId ? `<span class="tag y">${h(prim(l.promotorId))}</span>` : '<span class="tag">Sem promotor</span>'}${l.praca ? `<span class="tag">${h(l.praca)}</span>` : ''}${l.lat != null ? '<span class="tag">📍 local ok</span>' : ''}${l.bloqueado ? '<span class="tag no">Bloqueado</span>' : ''}</div></div><span class="muted">›</span></button>`).join('') +
    (it.length > CF.n ? `<div style="padding-top:10px"><button class="btn" id="cli-mais">Mostrar mais (${it.length - CF.n})</button></div>` : '');
  box.querySelectorAll('[data-cli]').forEach(b => b.onclick = () => fichaEdicao(S.lojas.find(l => l.id === b.dataset.cli)));
  const m = $('#cli-mais'); if (m) m.onclick = () => { CF.n += 150; renderClientes(); };
}
function fichaEdicao(l) {
  const novo = !l; l = l || { uf: 'RJ', dias: [], ordemDia: {} };
  abreModal(`<div class="spread"><h3>${novo ? 'Novo cliente' : 'Cliente ' + h(l.codigo || '')}</h3><button class="btn ghost" id="fe-x">Fechar</button></div>
    ${l.ultCompra ? `<div class="muted" style="font-size:13px">Última compra: ${h(l.ultCompra)}${l.atividade ? ' · ' + h(l.atividade) : ''}</div>` : ''}
    <form id="fe" class="stack">${CAMPOS.map(([k, lab]) => `<label class="field"><span>${lab}</span><input type="text" name="${k}" value="${h(l[k] || '')}"></label>`).join('')}
      <label class="field"><span>Localização da loja (latitude, longitude)</span><input type="text" name="coord" placeholder="cole do Google Maps, ex.: -22.4710, -44.4520" value="${l.lat != null ? l.lat + ', ' + l.lng : ''}"></label>
      <label class="row" style="gap:8px;font-size:14px"><input type="checkbox" name="bloqueado" ${l.bloqueado ? 'checked' : ''}> Cliente bloqueado</label>
      <div class="row end">${novo ? '' : '<button type="button" class="btn ghost danger" id="fe-del">Excluir</button>'}<button class="btn primary" type="submit">Salvar</button></div></form>`);
  $('#fe-x').onclick = fechaModal;
  const del = $('#fe-del');
  if (del) del.onclick = async () => { if (await confirma(`Excluir o cliente ${l.codigo} ${l.nome}? Ele sai das rotas. O histórico de visitas continua.`, 'Excluir')) deleteDoc(doc(db, 'lojas', l.id)).then(() => toast('Cliente excluído'), e => toast(erroMsg(e))); };
  $('#fe').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target); const v = {};
    CAMPOS.forEach(([k]) => v[k] = String(f.get(k) || '').trim());
    v.uf = v.uf.toUpperCase(); v.bloqueado = !!f.get('bloqueado');
    if (!v.nome && !v.razao) return toast('Informe o nome fantasia ou a razão social.');
    if (!v.nome) v.nome = v.razao;
    if (v.codigo && S.lojas.some(x => x.codigo === v.codigo && x.id !== l.id)) return toast('Já existe cliente com o código ' + v.codigo + '.');
    const cs = String(f.get('coord') || '').trim();
    if (cs) { const m = cs.match(/(-?\d+[.,]\d+)\s*[,; ]\s*(-?\d+[.,]\d+)/); if (!m) return toast('Localização inválida. Use o formato: -22.4710, -44.4520'); v.lat = +m[1].replace(',', '.'); v.lng = +m[2].replace(',', '.'); v.coordFonte = 'manual'; }
    else { v.lat = null; v.lng = null; }
    v.atualizado = Date.now();
    try {
      if (novo) { const id = v.codigo && !S.lojas.some(x => x.id === 'c' + v.codigo) ? 'c' + v.codigo : 'n' + Date.now(); await setDoc(doc(db, 'lojas', id), Object.assign(v, { promotorId: '', dias: [], ordemDia: {} })); }
      else await updateDoc(doc(db, 'lojas', l.id), v);
      fechaModal(); toast('Cliente salvo');
    } catch (err) { toast(erroMsg(err)); }
  };
}

/* =========================================================
   VARIÁVEL PROMOTOR
   ========================================================= */
const V = { mes: lsGet('np.var.mes') || (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return ymd(d).slice(0, 7); })(), vendas: undefined, flags: null, aberto: {}, u1: null, u2: null };
function assinaVar() {
  if (V.u1) V.u1(); if (V.u2) V.u2(); V.vendas = undefined; V.flags = null;
  V.u1 = onSnapshot(doc(db, 'vendas', V.mes), s => { V.vendas = s.exists() ? s.data() : null; if (S.tab === 'var') renderVar(); }, e => toast(erroMsg(e)));
  V.u2 = onSnapshot(doc(db, 'variavel', V.mes), s => { V.flags = s.exists() ? s.data() : null; if (S.tab === 'var') renderVar(); }, () => {});
}
const lojaPorChave = k => S.lojas.find(l => l.id === 'c' + k) || S.lojas.find(l => l.codigo === k);
// Cálculo da variável — mesma regra do app anterior (validado em setembro/2026)
export function calcVar(itens, lojas, promotores, regras, flags) {
  const por = {}, fora = [];
  const acha = k => lojas.find(l => l.id === 'c' + k) || lojas.find(l => l.codigo === k);
  Object.entries(itens || {}).forEach(([k, x]) => {
    const l = acha(k); const pid = l && l.promotorId;
    const row = { k, cod: l ? l.codigo : k.replace(/-2$/, ''), nome: l ? l.nome : 'Cliente ' + k, cidade: l ? (l.cidade || [l.bairro, l.municipio].filter(Boolean).join(', ')) : '', v: +x.v || 0, tb: +x.t || 0, td: +x.d || 0, t: (+x.t || 0) + (+x.d || 0) };
    if (pid && promotores.some(p => p.id === pid)) (por[pid] = por[pid] || []).push(row); else fora.push(row);
  });
  const res = promotores.filter(p => p.ativo !== false || por[p.id]).map(p => {
    const ja = new Set((por[p.id] || []).map(x => x.cod));
    lojas.filter(l => l.promotorId === p.id && !ja.has(l.codigo)).forEach(l => (por[p.id] = por[p.id] || []).push({ k: l.id, cod: l.codigo || '', nome: l.nome, cidade: l.cidade || [l.bairro, l.municipio].filter(Boolean).join(', '), v: 0, t: 0, tb: 0, td: 0 }));
    const cl = (por[p.id] || []).sort((a, b) => b.v - a.v);
    const v = cl.reduce((s, x) => s + x.v, 0), t = cl.reduce((s, x) => s + x.t, 0);
    const pct = v ? t / v * 100 : 0; const f = (flags || {})[p.id] || {};
    const cumprida = f.cumprida !== false, zerar = !!f.zerar;
    const fator = regras.meta ? Math.min(1, v / regras.meta) : 1;
    const faixa = v ? ((FAIXAS.find(([l]) => pct < l) || [0, 0])[1]) : 0;
    const variavel = cumprida ? Math.round(regras.base * fator * 100) / 100 : 0;
    const premio = zerar ? 0 : Math.round(faixa * (regras.prop ? fator : 1) * 100) / 100;
    return { pid: p.id, nome: p.nome, cl, v, t, pct, fator, faixa, variavel, premio, total: variavel + premio, cumprida, zerar };
  }).filter(r => r.cl.length);
  return { res, fora };
}
function setFlag(pid, campo, val) {
  const fl = Object.assign({}, (V.flags && V.flags.flags) || {}); fl[pid] = Object.assign({}, fl[pid], { [campo]: val });
  setDoc(doc(db, 'variavel', V.mes), { flags: fl, atualizado: Date.now() }, { merge: true }).catch(e => toast(erroMsg(e)));
}
const dataAtual = () => { const t = V.vendas && V.vendas.importado; return t ? new Date(t).toLocaleDateString('pt-BR') + ' às ' + new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'; };
function renderVar() {
  const c = $('#v-var');
  if (!c.dataset.ok) {
    c.dataset.ok = 1;
    c.innerHTML = `<div class="spread" style="flex-wrap:wrap"><h2>Variável promotor</h2><div class="row"><input type="month" id="var-mes" style="width:auto"><button class="btn primary" id="var-todos">PDF de todos</button></div></div><div id="var-corpo" class="stack"></div>`;
    $('#var-mes').value = V.mes;
    $('#var-mes').onchange = e => { if (!e.target.value) return; V.mes = e.target.value; lsSet('np.var.mes', V.mes); assinaVar(); renderVar(); };
  }
  const box = $('#var-corpo');
  if (V.vendas === undefined || vazioCarregando()) { box.innerHTML = '<div class="empty">Carregando…</div>'; return; }
  const [y, m] = V.mes.split('-'); const nomeMes = new Date(+y, +m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  if (!V.vendas) { box.innerHTML = `<div class="empty"><b>Sem vendas de ${nomeMes}</b>Mande ao Claude os relatórios de vendas e trocas do mês. Ele devolve um arquivo para importar em Configurações > Importar arquivo.</div>`; $('#var-todos').hidden = true; return; }
  $('#var-todos').hidden = false;
  const { res, fora } = calcVar(V.vendas.itens, S.lojas, S.promotores, S.regras, V.flags && V.flags.flags);
  const tv = res.reduce((s, r) => s + r.v, 0), tt = res.reduce((s, r) => s + r.t, 0), tp = res.reduce((s, r) => s + r.total, 0);
  box.innerHTML = `<div class="note">${h(V.vendas.fonte || 'Vendas importadas')} · atualizado em ${dataAtual()}. Regras: variável ${brl(S.regras.base)} com mínimo de ${brl(S.regras.meta)}${S.regras.prop ? ' · premiação proporcional' : ''}.</div>
    <div class="kpis num"><div class="kpi"><b>${brl(tv)}</b><span>Venda das rotas</span></div><div class="kpi"><b>${brl(tt)}</b><span>Trocas</span></div><div class="kpi"><b>${pctf(tv ? tt / tv * 100 : 0)}</b><span>% troca geral</span></div><div class="kpi"><b style="color:var(--ok)">${brl(tp)}</b><span>Total a pagar</span></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="num"><thead><tr><th>Promotor</th><th class="r">Venda</th><th class="r">Troca</th><th class="r">%</th><th class="r">Variável</th><th class="r">Premiação</th><th class="r">Total</th><th>Rota cumprida</th><th>Faltas</th><th></th></tr></thead><tbody>
    ${res.map(r => `<tr class="click" data-vp="${h(r.pid)}"><td><b>${h(r.nome.split(' ').slice(0, 2).join(' '))}</b><div class="muted" style="font-size:12px">${r.cl.length} clientes</div></td>
      <td class="r">${brl(r.v)}${r.fator < 1 ? `<div style="font-size:12px;color:var(--warn)">${Math.round(r.fator * 100)}% do mínimo</div>` : ''}</td><td class="r">${brl(r.t)}</td>
      <td class="r"><span class="pill ${r.faixa >= 375 ? 'ok' : r.faixa ? 'live' : 'no'}">${pctf(r.pct)}</span></td><td class="r">${brl(r.variavel)}</td><td class="r">${brl(r.premio)}</td><td class="r"><b>${brl(r.total)}</b></td>
      <td><input type="checkbox" data-fc="${h(r.pid)}" ${r.cumprida ? 'checked' : ''} aria-label="Rota cumprida"></td><td><input type="checkbox" data-fz="${h(r.pid)}" ${r.zerar ? 'checked' : ''} aria-label="Zerar premiação"></td>
      <td><button class="btn sm" data-rel="${h(r.pid)}">Relatório</button></td></tr>
      ${V.aberto[r.pid] ? `<tr><td colspan="10" style="background:var(--sunk)"><table class="num" style="font-size:13px"><thead><tr><th>Cód.</th><th>Cliente</th><th class="r">Venda</th><th class="r">Bonif.</th><th class="r">Dev. NF</th><th class="r">Troca</th><th class="r">%</th></tr></thead><tbody>${r.cl.map(x => `<tr><td>${h(x.cod)}</td><td>${h(x.nome)}</td><td class="r">${brl(x.v)}</td><td class="r">${brl(x.tb)}</td><td class="r">${brl(x.td)}</td><td class="r">${brl(x.t)}</td><td class="r">${x.v ? pctf(x.t / x.v * 100) : '—'}</td></tr>`).join('')}</tbody></table></td></tr>` : ''}`).join('')}
    </tbody><tfoot><tr><td><b>Total</b></td><td class="r"><b>${brl(tv)}</b></td><td class="r"><b>${brl(tt)}</b></td><td class="r">${pctf(tv ? tt / tv * 100 : 0)}</td><td class="r"><b>${brl(res.reduce((s, r) => s + r.variavel, 0))}</b></td><td class="r"><b>${brl(res.reduce((s, r) => s + r.premio, 0))}</b></td><td class="r"><b>${brl(tp)}</b></td><td></td><td></td><td></td></tr></tfoot></table></div></div>
    ${fora.length ? `<div class="card stack"><div class="spread"><h3>Vendas fora das rotas</h3><span class="muted num">${fora.length} clientes · ${brl(fora.reduce((s, x) => s + x.v, 0))}</span></div><div class="muted" style="font-size:13px">Clientes com venda que não estão na rota de nenhum promotor. Não entram no cálculo.</div></div>` : ''}`;
  box.querySelectorAll('tr[data-vp]').forEach(tr => tr.onclick = e => { if (['INPUT', 'BUTTON'].includes(e.target.tagName)) return; V.aberto[tr.dataset.vp] = !V.aberto[tr.dataset.vp]; renderVar(); });
  box.querySelectorAll('[data-fc]').forEach(i => i.onchange = () => setFlag(i.dataset.fc, 'cumprida', i.checked));
  box.querySelectorAll('[data-fz]').forEach(i => i.onchange = () => setFlag(i.dataset.fz, 'zerar', i.checked));
  box.querySelectorAll('[data-rel]').forEach(b => b.onclick = e => { e.stopPropagation(); relatorio(res.find(r => r.pid === b.dataset.rel), nomeMes); });
  $('#var-todos').onclick = () => baixaPDF(res, nomeMes);
}
function textoWhats(r, nomeMes) {
  let t = `*Variável promotor · ${nomeMes}*\n*${r.nome}*\n\nVenda da rota: ${brl(r.v)}${r.fator < 1 ? ` (${Math.round(r.fator * 100)}% do mínimo de ${brl(S.regras.meta)})` : ''}\nTroca: ${brl(r.t)} (${pctf(r.pct)})\nVariável da rota: ${brl(r.variavel)}${!r.cumprida ? ' (rota não cumprida)' : ''}\nPremiação por trocas: ${brl(r.premio)}${r.zerar ? ' (zerada por falta/atraso)' : ''}\n*Total: ${brl(r.total)}*\n_Dados atualizados em ${dataAtual()}_\n\n*Clientes da rota*\n`;
  t += r.cl.map(x => `${x.cod} ${x.nome}: venda ${brl(x.v)} · troca ${brl(x.t)}${x.v ? ` (${pctf(x.t / x.v * 100)})` : ''}`).join('\n');
  return t + '\n\nNova Penedo Distribuidora';
}
function relatorio(r, nomeMes) {
  abreModal(`<div class="spread" style="align-items:flex-start"><div><div class="label">Variável · ${h(nomeMes)}</div><h3 style="font-size:20px">${h(r.nome)}</h3><div class="muted" style="font-size:12px">Dados atualizados em ${dataAtual()}</div></div><button class="btn ghost" id="rl-x">Fechar</button></div>
    <div class="kpis num" style="grid-template-columns:repeat(2,1fr)"><div class="kpi"><b>${brl(r.v)}</b><span>Venda da rota</span></div><div class="kpi"><b>${brl(r.t)}</b><span>Troca · ${pctf(r.pct)}</span></div><div class="kpi"><b>${brl(r.variavel)}</b><span>Variável</span></div><div class="kpi"><b>${brl(r.premio)}</b><span>Premiação</span></div></div>
    <div class="spread" style="font-size:18px"><b>Total</b><b class="num" style="color:var(--ok)">${brl(r.total)}</b></div>
    <div class="row end"><button class="btn" id="rl-wa">Copiar para WhatsApp</button><button class="btn primary" id="rl-pdf">Baixar PDF</button></div><textarea id="rl-txt" readonly hidden rows="6"></textarea>`);
  $('#rl-x').onclick = fechaModal; $('#rl-pdf').onclick = () => baixaPDF([r], nomeMes);
  $('#rl-wa').onclick = async () => { const t = textoWhats(r, nomeMes); try { await navigator.clipboard.writeText(t); toast('Texto copiado. Cole no WhatsApp do promotor.'); } catch (e) { const ta = $('#rl-txt'); ta.hidden = false; ta.value = t; ta.select(); } };
}
async function carregaImg(src) { const r = await fetch(src); const b = await r.blob(); return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }
async function baixaPDF(lista, nomeMes) {
  const J = window.jspdf && window.jspdf.jsPDF; if (!J) return toast('O gerador de PDF ainda está carregando. Tente de novo em alguns segundos.');
  const logo = await carregaImg(LOGO).catch(() => null);
  const docp = new J({ unit: 'mm', format: 'a4' }); const W = 210; const R = S.regras;
  lista.forEach((r, i) => {
    if (i) docp.addPage();
    docp.setFillColor(23, 25, 37); docp.rect(0, 0, W, 30, 'F'); docp.setFillColor(244, 188, 28); docp.rect(0, 30, W, 1.6, 'F');
    if (logo) try { docp.addImage(logo, 'PNG', 12, 8, 72, 13.8); } catch (e) {}
    docp.setTextColor(255, 255, 255); docp.setFontSize(9); docp.text('VARIÁVEL PROMOTOR', W - 12, 13, { align: 'right' });
    docp.setFontSize(13); docp.setFont(undefined, 'bold'); docp.text(nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1), W - 12, 21, { align: 'right' });
    docp.setTextColor(23, 25, 37); docp.setFontSize(17); docp.text(r.nome, 12, 42); docp.setFont(undefined, 'normal');
    docp.setFontSize(8.5); docp.setTextColor(92, 96, 112); docp.text('Vendas e trocas atualizadas em ' + dataAtual(), 12, 47.5);
    const cx = [['Venda da rota', brl(r.v)], ['Troca', brl(r.t)], ['% troca', pctf(r.pct)], ['Variável', brl(r.variavel)], ['Premiação', brl(r.premio)], ['Total', brl(r.total)]];
    const bw = (W - 24 - 10) / 6;
    cx.forEach(([l, v], j) => { const x = 12 + j * (bw + 2); const tot = j === 5; docp.setFillColor(...(tot ? [244, 188, 28] : [241, 242, 245])); docp.roundedRect(x, 51, bw, 18, 2, 2, 'F'); docp.setFontSize(7); docp.setTextColor(92, 96, 112); docp.text(l.toUpperCase(), x + 3, 57); docp.setFontSize(tot ? 11 : 10); docp.setTextColor(23, 25, 37); docp.setFont(undefined, 'bold'); docp.text(v, x + 3, 65); docp.setFont(undefined, 'normal'); });
    const obs = [];
    if (r.fator < 1) obs.push(`Faturamento da rota abaixo do mínimo de ${brl(R.meta)}: variável proporcional (${Math.round(r.fator * 100)}%).`);
    if (!r.cumprida) obs.push('Rota não cumprida no mês: sem variável da rota.');
    if (r.zerar) obs.push('Faltas ou atrasos sem justificativa: premiação zerada.');
    else if (r.v && !r.faixa) obs.push('Troca acima de 2% da venda: sem premiação por trocas no mês.');
    const tb = r.cl.reduce((s, x) => s + (x.tb || 0), 0), td = r.cl.reduce((s, x) => s + (x.td || 0), 0);
    obs.push(`Troca da rota: bonificado ${brl(tb)} + notas de devolução ${brl(td)} = ${brl(r.t)} (${pctf(r.pct)} da venda).`);
    obs.push('Premiação por trocas: menos de 0,75% R$ 500 · menos de 1% R$ 375 · menos de 1,5% R$ 250 · menos de 2% R$ 150.');
    docp.setFontSize(8.5); docp.setTextColor(92, 96, 112); let y = 76; obs.forEach(o => { docp.text(docp.splitTextToSize(o, W - 24), 12, y); y += 5; });
    docp.autoTable({ startY: y + 2, margin: { left: 12, right: 12 }, head: [['Cód.', 'Cliente', 'Bairro / cidade', 'Venda', 'Bonificado', 'Dev. NF', 'Troca total', '% troca']],
      body: r.cl.map(x => [x.cod, x.nome, x.cidade || '', n2(x.v), n2(x.tb), n2(x.td), n2(x.t), x.v ? pctf(x.t / x.v * 100) : '—']),
      foot: [['', 'Total da rota', '', n2(r.v), n2(tb), n2(td), n2(r.t), pctf(r.pct)]],
      styles: { fontSize: 7.5, cellPadding: 1.6, textColor: [23, 25, 37] }, headStyles: { fillColor: [23, 25, 37], textColor: [255, 255, 255] }, footStyles: { fillColor: [241, 242, 245], textColor: [23, 25, 37], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 251] }, columnStyles: { 0: { cellWidth: 11 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } }, showFoot: 'lastPage' });
    docp.setFontSize(7.5); docp.setTextColor(140, 144, 156); docp.text('Nova Penedo Distribuidora · dados atualizados em ' + dataAtual() + ' · gerado em ' + new Date().toLocaleDateString('pt-BR'), 12, 290);
  });
  docp.save(lista.length === 1 ? `Variavel ${lista[0].nome.split(' ')[0]} ${V.mes}.pdf` : `Variavel promotores ${V.mes}.pdf`);
}

/* =========================================================
   EQUIPE E ACESSOS
   ========================================================= */
function renderEquipe() {
  const c = $('#v-equipe');
  if (vazioCarregando()) { c.innerHTML = '<div class="empty">Carregando…</div>'; return; }
  c.innerHTML = `<div class="spread"><h2>Equipe e acessos</h2><button class="btn primary" id="eq-novo">+ Novo promotor</button></div>
    <div class="note">O promotor entra no app com o <b>usuário</b> e o <b>código</b> abaixo. Endereço do app: <b>${h(location.origin + location.pathname.replace(/gestao\.html$/, ''))}</b></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Promotor</th><th>Contato</th><th>Lojas</th><th>Usuário</th><th>Código</th><th></th></tr></thead><tbody>
    ${S.promotores.map(p => { const a = S.acessos[p.id]; return `<tr><td><b>${h(p.nome)}</b>${p.ativo === false ? ' <span class="tag no">inativo</span>' : ''}<div class="muted" style="font-size:12px">${h(p.base || '')}</div></td>
      <td style="font-size:13px">${h(p.telefone || '')}<div class="muted">${h(p.email || '')}</div></td><td class="num">${S.lojas.filter(l => l.promotorId === p.id).length}</td>
      <td>${a ? `<b>${h(a.usuario)}</b>` : '<span class="tag y">sem acesso</span>'}</td><td class="num">${a ? h(a.codigo) : '—'}</td>
      <td class="r"><div class="row" style="gap:4px;justify-content:flex-end"><button class="btn sm" data-ac="${h(p.id)}">${a ? 'Trocar código' : 'Criar acesso'}</button><button class="btn sm ghost" data-ed="${h(p.id)}">Editar</button></div></td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  $('#eq-novo').onclick = () => editaPromotor(null);
  c.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editaPromotor(S.promotores.find(p => p.id === b.dataset.ed)));
  c.querySelectorAll('[data-ac]').forEach(b => b.onclick = () => acesso(S.promotores.find(p => p.id === b.dataset.ac)));
}
function editaPromotor(p) {
  const novo = !p; p = p || { ativo: true };
  abreModal(`<div class="spread"><h3>${novo ? 'Novo promotor' : h(p.nome)}</h3><button class="btn ghost" id="ep-x">Fechar</button></div>
    <form id="ep" class="stack"><label class="field"><span>Nome completo</span><input type="text" name="nome" value="${h(p.nome || '')}" required></label>
    <label class="field"><span>Base (cidade)</span><input type="text" name="base" value="${h(p.base || '')}"></label>
    <label class="field"><span>Telefone</span><input type="tel" name="telefone" value="${h(p.telefone || '')}"></label>
    <label class="field"><span>E-mail</span><input type="email" name="email" value="${h(p.email || '')}"></label>
    <label class="row" style="gap:8px"><input type="checkbox" name="ativo" ${p.ativo !== false ? 'checked' : ''}> Ativo</label>
    <div class="row end"><button class="btn primary" type="submit">Salvar</button></div></form>`);
  $('#ep-x').onclick = fechaModal;
  $('#ep').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const v = { nome: String(f.get('nome')).trim(), base: String(f.get('base')).trim(), telefone: String(f.get('telefone')).trim(), email: String(f.get('email')).trim(), ativo: !!f.get('ativo'), atualizado: Date.now() };
    const id = novo ? semAcento(v.nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : p.id;
    if (novo && S.promotores.some(x => x.id === id)) return toast('Já existe um promotor com esse nome.');
    try { await setDoc(doc(db, 'promotores', id), v, { merge: true }); fechaModal(); toast('Promotor salvo'); } catch (err) { toast(erroMsg(err)); }
  };
}
function codigoNovo() { const usados = new Set(Object.values(S.acessos).map(a => a.codigo)); let c; do { c = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (usados.has(c) || new Set(c).size < 2 || ['1234', '4321', '0123'].includes(c)); return c; }
function acesso(p) {
  const a = S.acessos[p.id];
  let usuario = a ? a.usuario : usuarioDeNome(p.nome);
  if (!a) { let u = usuario, n = 2; while (Object.values(S.acessos).some(x => x.usuario === u)) u = usuario + n++; usuario = u; }
  abreModal(`<div class="spread"><h3>${a ? 'Trocar código' : 'Criar acesso'} · ${h(p.nome.split(' ')[0])}</h3><button class="btn ghost" id="ac-x">Fechar</button></div>
    <label class="field"><span>Usuário</span><input type="text" value="${h(usuario)}" disabled></label>
    <label class="field"><span>Código (4 números)</span><input type="text" id="ac-c" inputmode="numeric" maxlength="4" value="${codigoNovo()}"></label>
    <div class="row end"><button class="btn primary" id="ac-s">${a ? 'Trocar código' : 'Criar acesso'}</button></div>`);
  $('#ac-x').onclick = fechaModal;
  $('#ac-s').onclick = async () => {
    const c = $('#ac-c').value.trim(); if (!/^\d{4}$/.test(c)) return toast('O código precisa ter 4 números.');
    $('#ac-s').disabled = true; $('#ac-s').textContent = 'Salvando…';
    try { await gravaAcesso(p.id, usuario, c, a && a.codigo); fechaModal(); toast(`Acesso de ${p.nome.split(' ')[0]}: usuário ${usuario}, código ${c}`, 6000); }
    catch (e) { $('#ac-s').disabled = false; $('#ac-s').textContent = 'Tentar de novo'; toast(erroMsg(e), 6000); }
  };
}
async function gravaAcesso(pid, usuario, codigo, codigoAntigo) {
  const uid = await criarAcessoPromotor(usuario, codigo, codigoAntigo);
  await setDoc(doc(db, 'usuarios', uid), { promotorId: pid, usuario });
  await setDoc(doc(db, 'acessos', pid), { usuario, codigo, uid, atualizado: Date.now() });
  return uid;
}

/* =========================================================
   CONFIGURAÇÕES, IMPORTAR E COPIAR
   ========================================================= */
function renderConfig() {
  const c = $('#v-config');
  if (c.dataset.ok) { // só atualiza os valores, sem apagar o resultado da importação
    const put = (id, v) => { const el = $(id); if (el && document.activeElement !== el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };
    put('#cf-check', S.checklist.join('\n')); put('#cf-raio', S.raio); put('#cf-base', S.regras.base); put('#cf-meta', S.regras.meta); put('#cf-prop', S.regras.prop);
    return;
  }
  c.dataset.ok = 1;
  c.innerHTML = `<h2>Configurações</h2><div class="grid2">
    <div class="card stack"><h3>Checklist da visita</h3><p class="muted" style="margin:0;font-size:14px">Uma pergunta por linha.</p><textarea id="cf-check" rows="6">${h(S.checklist.join('\n'))}</textarea><div><button class="btn primary" id="cf-check-s">Salvar checklist</button></div></div>
    <div class="card stack"><h3>Check-in e variável</h3>
      <label class="field"><span>Raio do check-in (metros)</span><input type="number" id="cf-raio" min="30" step="10" value="${S.raio}"></label>
      <label class="field"><span>Variável da rota (R$)</span><input type="number" id="cf-base" step="10" value="${S.regras.base}"></label>
      <label class="field"><span>Faturamento mínimo da rota (R$)</span><input type="number" id="cf-meta" step="1000" value="${S.regras.meta}"></label>
      <label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="cf-prop" ${S.regras.prop ? 'checked' : ''}> Premiação de trocas proporcional ao faturamento</label>
      <div><button class="btn primary" id="cf-salvar">Salvar</button></div></div>
    <div class="card stack"><h3>Importar arquivo</h3><p class="muted" style="margin:0;font-size:14px">Cópia completa (migração ou restauração) ou vendas e trocas do mês que o Claude preparar.</p>
      <input type="file" id="cf-arq" accept=".json,application/json"><div id="cf-imp"></div></div>
    <div class="card stack"><h3>Cópia de segurança</h3><p class="muted" style="margin:0;font-size:14px">Baixa promotores, acessos, clientes, rotas, vendas e configurações num arquivo. Guarde no Google Drive, pasta Artefatos.</p><div><button class="btn" id="cf-bk">Baixar cópia</button></div></div>
  </div>`;
  $('#cf-check-s').onclick = () => { const itens = $('#cf-check').value.split('\n').map(s => s.trim()).filter(Boolean); if (!itens.length) return toast('Escreva pelo menos uma pergunta.'); setDoc(doc(db, 'config', 'checklist'), { itens }).then(() => toast('Checklist salvo'), e => toast(erroMsg(e))); };
  $('#cf-salvar').onclick = async () => {
    try { await setDoc(doc(db, 'config', 'app'), { raio: +$('#cf-raio').value || 150 }, { merge: true }); await setDoc(doc(db, 'config', 'variavel'), { base: +$('#cf-base').value || 0, meta: +$('#cf-meta').value || 0, prop: $('#cf-prop').checked }); toast('Configurações salvas'); }
    catch (e) { toast(erroMsg(e)); }
  };
  $('#cf-arq').onchange = e => { const f = e.target.files[0]; if (f) importar(f); };
  $('#cf-bk').onclick = baixaCopia;
}
async function escreveEmLotes(ops, progresso) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db); ops.slice(i, i + 400).forEach(([ref, data]) => b.set(ref, data)); await b.commit();
    progresso(Math.min(ops.length, i + 400), ops.length);
  }
}
async function importar(arq) {
  const box = $('#cf-imp'); let d;
  try { d = JSON.parse(await arq.text()); } catch (e) { box.innerHTML = '<div class="note crit">Arquivo inválido.</div>'; return; }
  if (d.formato === 'vendas-v1') {
    const tv = Object.values(d.itens || {}).reduce((s, x) => s + (+x.v || 0), 0);
    if (!(await confirma(`Importar vendas de ${d.mes}: ${Object.keys(d.itens || {}).length} clientes, ${brl(tv)} de venda? Substitui as vendas já gravadas desse mês.`, 'Importar'))) return;
    try { await setDoc(doc(db, 'vendas', d.mes), { itens: d.itens, fonte: d.fonte || '', importado: Date.now(), mes: d.mes }); box.innerHTML = `<div class="note ok">Vendas de ${h(d.mes)} importadas: ${Object.keys(d.itens).length} clientes · ${brl(tv)}.</div>`; }
    catch (e) { box.innerHTML = `<div class="note crit">${h(erroMsg(e))}</div>`; }
    return;
  }
  if (d.formato !== 'rota-nova-penedo-v1') { box.innerHTML = '<div class="note crit">Este arquivo não é uma cópia do sistema de rotas.</div>'; return; }
  const k = d.conferencia || {};
  if (!(await confirma(`Importar a cópia de ${d.exportado || '?'}: ${Object.keys(d.promotores).length} promotores, ${Object.keys(d.lojas).length} clientes e vendas de ${Object.keys(d.vendas || {}).join(', ') || 'nenhum mês'}? Registros com o mesmo código serão substituídos.`, 'Importar'))) return;
  const ops = [];
  Object.entries(d.promotores).forEach(([id, v]) => { const x = Object.assign({}, v); delete x.pin; ops.push([doc(db, 'promotores', id), x]); });
  Object.entries(d.lojas).forEach(([id, v]) => ops.push([doc(db, 'lojas', id), v]));
  Object.entries(d.config || {}).forEach(([id, v]) => ops.push([doc(db, 'config', id), v]));
  Object.entries(d.vendas || {}).forEach(([id, v]) => ops.push([doc(db, 'vendas', id), v]));
  Object.entries(d.variavel || {}).forEach(([id, v]) => ops.push([doc(db, 'variavel', id), v]));
  try {
    await escreveEmLotes(ops, (a, t) => box.innerHTML = `<div class="note">Gravando ${a} de ${t} registros…</div>`);
    const acs = Object.entries(d.acessos || {}); const erros = [];
    for (let i = 0; i < acs.length; i++) {
      const [pid, v] = acs[i]; const codigo = typeof v === 'string' ? v : v.codigo; const usuario = (typeof v === 'object' && v.usuario) || usuarioDeNome(d.promotores[pid].nome);
      box.innerHTML = `<div class="note">Criando acesso ${i + 1} de ${acs.length} (${h(usuario)})…</div>`;
      try { await gravaAcesso(pid, usuario, codigo, codigo); } catch (e) { erros.push(usuario + ': ' + erroMsg(e)); }
    }
    // conferência: relê do banco e compara com o arquivo
    box.innerHTML = '<div class="note">Conferindo…</div>';
    const [pp, ll, vv] = await Promise.all([getDocs(collection(db, 'promotores')), getDocs(collection(db, 'lojas')), getDocs(collection(db, 'vendas'))]);
    const linhas = [['Promotores', Object.keys(d.promotores).length, pp.size], ['Clientes', Object.keys(d.lojas).length, ll.size], ['Clientes com promotor', k.lojasComPromotor ?? '—', ll.docs.filter(x => x.data().promotorId).length]];
    vv.docs.forEach(x => { const it = x.data().itens || {}; const ref = (k.vendas || {})[x.id]; if (!ref) return;
      linhas.push(['Venda ' + x.id, brl(ref.venda), brl(Object.values(it).reduce((s, y) => s + (+y.v || 0), 0))]);
      linhas.push(['Bonificado ' + x.id, brl(ref.bonificado), brl(Object.values(it).reduce((s, y) => s + (+y.t || 0), 0))]);
      linhas.push(['Devoluções ' + x.id, brl(ref.devolucao), brl(Object.values(it).reduce((s, y) => s + (+y.d || 0), 0))]); });
    const ok = linhas.every(([, a, b]) => String(a) === String(b) || a === '—');
    box.innerHTML = `<div class="note ${ok && !erros.length ? 'ok' : 'warn'}"><b>${ok ? 'Importação conferida: tudo bateu.' : 'Atenção: alguma contagem não bateu.'}</b></div>
      <table class="num" style="font-size:13px"><thead><tr><th>Item</th><th class="r">No arquivo</th><th class="r">No banco</th></tr></thead><tbody>${linhas.map(([n, a, b]) => `<tr><td>${n}</td><td class="r">${a}</td><td class="r">${b}${String(a) === String(b) || a === '—' ? ' ✓' : ' ✗'}</td></tr>`).join('')}</tbody></table>
      ${erros.length ? `<div class="note crit">Acessos com erro:<br>${erros.map(h).join('<br>')}</div>` : `<div class="note ok">${acs.length} acessos de promotor criados.</div>`}`;
  } catch (e) { box.innerHTML = `<div class="note crit">${h(erroMsg(e))}</div>`; }
}
async function baixaCopia() {
  try {
    const cols = ['promotores', 'lojas', 'config', 'vendas', 'variavel', 'acessos']; const out = { formato: 'rota-nova-penedo-v1', exportado: ymd(new Date()) };
    for (const c of cols) { const s = await getDocs(collection(db, c)); out[c] = {}; s.docs.forEach(d => out[c][d.id] = d.data()); }
    out.acessos = Object.fromEntries(Object.entries(out.acessos).map(([k, v]) => [k, { usuario: v.usuario, codigo: v.codigo }]));
    out.conferencia = { promotores: Object.keys(out.promotores).length, lojas: Object.keys(out.lojas).length, lojasComPromotor: Object.values(out.lojas).filter(l => l.promotorId).length,
      vendas: Object.fromEntries(Object.entries(out.vendas).map(([m, v]) => [m, { venda: +Object.values(v.itens || {}).reduce((s, x) => s + (+x.v || 0), 0).toFixed(2), bonificado: +Object.values(v.itens || {}).reduce((s, x) => s + (+x.t || 0), 0).toFixed(2), devolucao: +Object.values(v.itens || {}).reduce((s, x) => s + (+x.d || 0), 0).toFixed(2) }])) };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    a.download = `Rota Promotores - copia ${out.exportado}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Cópia baixada. Guarde no Google Drive, pasta Artefatos.', 5000);
  } catch (e) { toast(erroMsg(e)); }
}
