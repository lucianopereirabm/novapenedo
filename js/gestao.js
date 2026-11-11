// Gestão: monitoramento com mapa, montar rotas, clientes, variável, equipe, configurações e importação
import {
  auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, collection, query, where, onSnapshot, writeBatch, deleteField,
  criarAcessoPromotor, apagarContaPromotor, criarContaMonitor, trocarSenhaConta, usuarioDeNome, $, h, semAcento, DIAS, DIAS_LONGO, ymd, diaSemana, dataBR, hm, dur, brl, n2, pctf,
  lsGet, lsSet, toast, abreModal, fechaModal, confirma, erroMsg, distancia
} from './fb.js';
import { leRosto, leRostoFoto, recorteRosto, distRosto, LIMITE } from './rosto.js';
import { VERSAO } from './termos.js';
import { regrasJornada, calcJornada, hmin, saldoTxt, CARGA_PADRAO } from './jornada.js';

const VERSAO_GESTAO = '2026-11-11.11';
const ADMIN_UID = 'LwETkIMFw0b6gVWl6XV450J1Dr12';
const FAIXAS = [[0.75, 500], [1, 375], [1.5, 250], [2, 150]];
const PESQ_PADRAO = ['Pão de forma Seven Boys', 'Pão de forma Plus Vita', 'Pão de forma Panco'];
const CHECK_PADRAO = ['Produto em ruptura (faltando na gôndola)', 'Produto com validade próxima', 'Preço divergente da tabela', 'Gôndola abastecida e organizada'];
const CORES = ['#E0457B', '#2F80ED', '#27AE60', '#F2994A', '#9B51E0', '#00A3A3', '#B8860B', '#EB5757', '#56CCF2', '#6FCF97', '#BB6BD9', '#333F99'];
const LOGO = 'img/logo.png';

const S = { pesquisa: PESQ_PADRAO, termos: {}, empresa: {}, rostos: {}, promotores: [], lojas: [], acessos: {}, checklist: CHECK_PADRAO, raio: 150, regras: { base: 250, meta: 70000, prop: false },
  tab: lsGet('np.g.tab') || 'painel', pronto: { p: false, l: false } };
const secoes = ['painel', 'montar', 'cli', 'val', 'var', 'equipe', 'config'];
const DOMINIO_GESTOR = 'gestor.novapenedo.app';

/* ---------- login ---------- */
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault(); $('#lg-msg').textContent = 'Entrando…';
  const u = $('#lg-email').value.trim(); const email = u.includes('@') ? u : `${semAcento(u).replace(/[^a-z0-9._-]/g, '')}@${DOMINIO_GESTOR}`;
  try { await signInWithEmailAndPassword(auth, email, $('#lg-senha').value); }
  catch (err) { $('#lg-msg').textContent = erroMsg(err).replace('Login ou senha incorretos', 'E-mail ou senha incorretos'); }
});
$('#sair').onclick = async () => { await signOut(auth); location.reload(); };
onAuthStateChanged(auth, async user => {
  $('#v-login').hidden = !!user; $('#sair').hidden = !user;
  if (!user) { $('#shell').hidden = true; return; }
  let admin = user.uid === ADMIN_UID;
  if (!admin) { try { admin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch (e) {} }
  if (!admin) { try { S.leitura = (await getDoc(doc(db, 'leitores', user.uid))).exists(); } catch (e) {} }
  if (!admin && !S.leitura) { $('#v-negado').hidden = false; return; }
  if (S.leitura) { // gestor só de monitoramento: só a Torre, sem alterar nada
    document.body.classList.add('so-leitura'); S.tab = 'painel';
    document.querySelectorAll('.side-item').forEach(b => { if (!['painel', 'val', 'var'].includes(b.dataset.go)) b.hidden = true; });
  }
  $('#quem').innerHTML = `${S.leitura ? 'Monitoramento' : 'Gestão'}<b>${h(S.leitura ? (user.email || '').replace('@' + DOMINIO_GESTOR, '') : (user.email || ''))}</b>`;
  $('#shell').hidden = false; $('#versao-g').textContent = 'Versão ' + VERSAO_GESTAO; iniciar();
});

// escuta o banco; se der erro (sem permissão, sem internet), tenta de novo em 30 s em vez de parar de atualizar
function escuta(ref, ok, erro) {
  onSnapshot(ref, ok, e => { if (erro) erro(e); setTimeout(() => escuta(ref, ok), 30000); });
}
function iniciar() {
  escuta(collection(db, 'promotores'), s => { S.promotores = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome)); S.pronto.p = true; render(); }, e => toast(erroMsg(e)));
  escuta(collection(db, 'lojas'), s => { S.lojas = s.docs.map(d => ({ id: d.id, ...d.data() })); S.pronto.l = true; render(); }, e => toast(erroMsg(e)));
  escuta(collection(db, 'rostos'), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.rostos = m; S.erroRostos = ''; S.qtdRostos = s.size; if (['equipe', 'painel'].includes(S.tab)) render(); }, e => { S.erroRostos = (e && (e.code || e.message)) || 'erro'; if (S.tab === 'equipe') render(); });
  if (!S.leitura) escuta(collection(db, 'termos'), s => { const m = {}; s.docs.forEach(d => { const x = d.data(); if (!m[x.promotorId] || x.assinadoEm > m[x.promotorId].assinadoEm) m[x.promotorId] = Object.assign({ id: d.id }, x); }); S.termos = m; if (S.tab === 'equipe') render(); }, () => {});
  escuta(collection(db, 'aparelhos'), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.aparelhos = m; S.erroAparelhos = ''; if (S.tab === 'equipe') render(); }, e => { S.erroAparelhos = (e && e.code) || 'erro'; if (S.tab === 'equipe') render(); });
  if (!S.leitura) escuta(collection(db, 'leitores'), s => { S.leitores = s.docs.map(d => ({ id: d.id, ...d.data() })); if (S.tab === 'equipe') render(); }, () => {});
  if (!S.leitura) escuta(collection(db, 'acessos'), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.acessos = m; if (S.tab === 'equipe') render(); }, () => {});
  escuta(doc(db, 'config', 'pesquisa'), s => { const it = s.exists() && s.data().itens; S.pesquisa = Array.isArray(it) && it.length ? it : PESQ_PADRAO; if (S.tab === 'config') render(); }, () => {});
  if (!S.leitura) escuta(doc(db, 'config', 'rotasBackup'), s => { S.bkRotas = s.exists() ? s.data() : null; if (S.tab === 'montar') render(); }, () => {});
  escuta(doc(db, 'config', 'checklist'), s => { const it = s.exists() && s.data().itens; S.checklist = Array.isArray(it) && it.length ? it : CHECK_PADRAO; if (S.tab === 'config') render(); }, () => {});
  escuta(doc(db, 'config', 'app'), s => { if (s.exists()) S.empresa = s.data(); if (s.exists() && +s.data().raio) S.raio = +s.data().raio; if (S.tab === 'config') render(); }, () => {});
  escuta(doc(db, 'config', 'variavel'), s => { if (s.exists()) S.regras = Object.assign({ base: 250, meta: 70000, prop: false }, s.data()); if (S.tab === 'var' || S.tab === 'config') render(); }, () => {});
  document.querySelectorAll('.side-item').forEach(b => b.onclick = () => { S.tab = b.dataset.go; lsSet('np.g.tab', S.tab); mostra(); window.scrollTo(0, 0); });
  if (!secoes.includes(S.tab)) S.tab = 'painel';
  mostra(); assinaPainel(); assinaVar(); iniciaAlertas();
  // a cada minuto: atualiza horários na tela e, se estiver vendo "hoje", vira o dia sozinho à meia-noite
  let hojeAntes = ymd(new Date());
  setInterval(() => {
    const hoje = ymd(new Date());
    if (hoje !== hojeAntes) { if (P.data === hojeAntes) { P.data = hoje; const i = $('#p-data'); if (i) i.value = hoje; assinaPainel(); } hojeAntes = hoje; }
    if (S.tab === 'painel') renderPainel();
    iniciaAlertas(); verificaInicio();
  }, 60000);
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
  if (S.tab === 'val') renderVal();
  if (S.tab === 'var') renderVar();
  if (S.tab === 'equipe') renderEquipe();
  if (S.tab === 'config') renderConfig();
}

/* ---------- utilidades de rota ---------- */
const promNome = id => (S.promotores.find(p => p.id === id) || {}).nome || 'Sem promotor';
const prim = id => promNome(id).split(' ')[0];
const corDe = id => CORES[Math.max(0, S.promotores.findIndex(p => p.id === id)) % CORES.length];
const posDia = (l, wd) => { const o = l.ordemDia && l.ordemDia[wd]; return typeof o === 'number' ? o : 1000 + (l.ordem || 999); };
const rotaDoPromotor = pid => (S.promotores.find(p => p.id === pid) || {}).espelhoDe || pid; // usuário de teste simula a rota de outro
const lojasDoDiaWd = (pid, wd) => S.lojas.filter(l => l.promotorId === rotaDoPromotor(pid) && (l.dias || []).map(Number).includes(wd)).sort((a, b) => posDia(a, wd) - posDia(b, wd));
const lojasDoDia = (pid, date) => lojasDoDiaWd(pid, diaSemana(date));
const endCompleto = l => [l.endereco, l.bairro, [l.municipio, l.uf].filter(Boolean).join(' - '), l.cep ? 'CEP ' + l.cep : ''].filter(Boolean).join(', ');
const cod = l => l && l.codigo ? `<span class="num muted">${h(l.codigo)}</span> · ` : '';
const vazioCarregando = () => !(S.pronto.p && S.pronto.l);

/* =========================================================
   MONITORAMENTO
   ========================================================= */
const P = { modo: lsGet('np.p.modo') === 'mes' ? 'mes' : 'dia', mes: ymd(new Date()).slice(0, 7), dadosMes: {}, selMes: '', data: ymd(new Date()), vis: {}, unsub: null, mapa: null, camada: null, sel: '' };
/* ---------- alertas no aparelho do gestor (com a Gestão aberta ou minimizada) ---------- */
const AL = { on: lsGet('np.alertas') === '1', dia: null, unsub: null, vis: {}, pronto: false };
const alVisto = k => { try { const x = JSON.parse(localStorage.getItem('np.al.' + AL.dia) || '{}'); return !!x[k]; } catch (e) { return false; } };
const alMarca = k => { try { const key = 'np.al.' + AL.dia; const x = JSON.parse(localStorage.getItem(key) || '{}'); x[k] = 1; localStorage.setItem(key, JSON.stringify(x)); } catch (e) {} };
async function notifica(chave, titulo, corpo) {
  if (!AL.on || alVisto(chave)) return; alMarca(chave);
  toast(titulo + ' · ' + corpo, 6000);
  if (!window.Notification || Notification.permission !== 'granted') return;
  const op = { body: corpo, icon: 'img/icon-192.png', badge: 'img/icon-192.png', tag: chave, vibrate: [200, 100, 200], data: { url: location.href } };
  try { const r = await navigator.serviceWorker.getRegistration(); if (r) return r.showNotification(titulo, op); } catch (e) {}
  try { new Notification(titulo, op); } catch (e) {}
}
async function ligaAlertas(ligar) {
  if (!ligar) { AL.on = false; lsSet('np.alertas', ''); toast('Alertas desligados neste aparelho'); return; }
  if (!window.Notification) return toast('Este navegador não mostra notificações. No celular, use o Chrome.', 6000);
  const p = await Notification.requestPermission();
  if (p !== 'granted') return toast('As notificações foram bloqueadas. Libere nas configurações do navegador para este site.', 7000);
  AL.on = true; lsSet('np.alertas', '1'); iniciaAlertas();
  Object.entries(AL.vis).forEach(([k, v]) => { if (v.checkin) alMarca('in-' + k); if (v.status === 'nao_visitada') alMarca('nv-' + k); }); // o que já aconteceu não avisa de novo
  setTimeout(verificaInicio, 1500);
  notifica('teste-' + Date.now(), '🔔 Alertas ligados', 'Você vai receber a chegada dos promotores nas lojas e quem não começou a rota. Deixe a Gestão aberta (pode minimizar).');
}
function iniciaAlertas() {
  const hoje = ymd(new Date()); if (AL.dia === hoje && AL.unsub) return;
  if (AL.unsub) AL.unsub(); AL.dia = hoje; AL.vis = {}; AL.pronto = false;
  AL.unsub = onSnapshot(collection(db, 'dias', hoje, 'visitas'), s => {
    const m = {}; s.docs.forEach(d => m[d.id] = d.data());
    if (!AL.pronto) { Object.entries(m).forEach(([k, v]) => { if (v.checkin) alMarca('in-' + k); if (v.status === 'nao_visitada') alMarca('nv-' + k); }); AL.pronto = true; } // o que já estava feito ao abrir não avisa
    else Object.entries(m).forEach(([k, v]) => {
      const nome = prim(v.promotorId);
      if (v.checkin) notifica('in-' + k, `📍 ${nome} chegou na loja`, `${v.lojaNome || 'Loja'} às ${hm(v.checkin)}${foraLoja(v) ? ` · ⚠️ fora da loja (${v.distIn} m)` : ''}${v.rostoOk === false ? ' · ⚠️ rosto não confere' : ''}`);
      if (v.status === 'nao_visitada') notifica('nv-' + k, `🚫 ${nome} não visitou`, `${v.lojaNome || 'Loja'}: ${v.motivo || ''}`);
    });
    AL.vis = m; verificaInicio();
  }, () => { AL.unsub = null; setTimeout(iniciaAlertas, 30000); });
}
// quem tem rota hoje e ainda não fez nenhum registro depois do início previsto + tolerância
function verificaInicio() {
  if (!AL.pronto || !S.promotores.length) return;
  const R = regrasJornada(S.empresa); const [hh, mm] = String(R.inicioPrevisto).split(':').map(Number);
  const limite = new Date(); limite.setHours(Number.isFinite(hh) ? hh : 8, (mm || 0) + R.tolerancia, 0, 0); if (Date.now() < limite.getTime()) return;
  const wd = new Date().getDay();
  S.promotores.filter(p => p.ativo !== false && !emTeste(p.id, ymd(new Date())) && lojasDoDiaWd(p.id, wd).length).forEach(p => {
    if (Object.values(AL.vis).some(v => v.promotorId === p.id)) return;
    notifica('ini-' + p.id, `⏰ ${p.nome.split(' ')[0]} ainda não começou a rota`, `Sem check-in até ${hm(Date.now())} (início previsto ${R.inicioPrevisto}). ${(n => n + (n === 1 ? ' loja' : ' lojas'))(lojasDoDiaWd(p.id, wd).length)} na rota de hoje.`);
  });
}

function assinaPainel() {
  if (P.unsub) P.unsub(); if (P.unsubJ) P.unsubJ();
  P.vis = {}; P.jor = {};
  P.unsubJ = onSnapshot(collection(db, 'dias', P.data, 'jornadas'), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); P.jor = m; if (S.tab === 'painel') renderPainel(); }, () => {});
  P.unsub = onSnapshot(collection(db, 'dias', P.data, 'visitas'), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); P.vis = m; if (S.tab === 'painel') renderPainel(); }, e => toast(erroMsg(e)));
}
// Resumo do dia de um promotor: paradas na ordem da rota + visitas fora da rota
function diaDoPromotor(pid) {
  const lojas = lojasDoDia(pid, P.data);
  const paradas = lojas.map((l, i) => ({ ordem: i + 1, lojaId: l.id, nome: l.nome, codigo: l.codigo, bairro: l.bairro || l.municipio || '', id: l.id + '_' + pid, v: P.vis[l.id + '_' + pid] }));
  Object.entries(P.vis).filter(([k, v]) => v.promotorId === pid && !paradas.some(x => x.id === k))
    .forEach(([k, v]) => paradas.push({ ordem: null, lojaId: v.lojaId, nome: v.lojaNome + (v.visitaN > 1 ? ` · ${v.visitaN}ª visita` : ''), codigo: v.codigo, bairro: v.cidade || '', id: k, v, extra: true }));
  const vs = paradas.filter(x => x.v);
  const feitas = paradas.filter(x => !x.extra && x.v && x.v.status === 'concluida').length;
  const extras = paradas.filter(x => x.extra && x.v && x.v.status !== 'nao_visitada').length;
  const nao = vs.filter(x => x.v.status === 'nao_visitada').length;
  const agora = vs.find(x => x.v.status === 'em_loja');
  const ents = vs.map(x => x.v.checkin).filter(Boolean), sais = vs.map(x => x.v.checkout).filter(Boolean);
  const tempo = vs.reduce((a, x) => a + (x.v.checkin && x.v.checkout ? x.v.checkout - x.v.checkin : 0), 0);
  const alertas = vs.filter(x => alertaAberto(x.v)).length;
  const ultima = vs.filter(x => x.v.checkout).sort((a, b) => b.v.checkout - a.v.checkout)[0];
  const J = calcJornada({ j: (P.jor || {})[pid], vs: vs.map(x => x.v), date: P.data, regras: regrasJornada(S.empresa), hoje: ymd(new Date()) });
  if (P.data === ymd(new Date()) && paradas.some(x => !x.extra && !x.v)) J.hojeAberto = true; // ainda tem loja na rota: saldo só no fim
  // atenção (amarelo): hoje, ainda não começou depois do horário, ou parado há mais que a tolerância sem check-in na próxima loja
  let atencao = '';
  if (P.data === ymd(new Date()) && lojas.length) {
    const R = regrasJornada(S.empresa); const agoraMs = Date.now();
    const [hh, mm] = String(R.inicioPrevisto).split(':').map(Number); const limite = new Date(); limite.setHours(hh || 8, (mm || 0) + R.tolerancia, 0, 0);
    const pend = paradas.some(x => !x.extra && !x.v); const sai = vs.map(x => x.v.checkout || (x.v.status === 'nao_visitada' ? x.v.registrado : 0)).filter(Boolean);
    const ultimaAcao = sai.length ? Math.max(...sai) : 0;
    if (!J.tem && !vs.length && agoraMs > limite.getTime()) atencao = `Sem check-in até agora (início previsto ${R.inicioPrevisto})`;
    else if (pend && !agora && !J.almocoAberto && ultimaAcao && agoraMs - ultimaAcao > R.tolerancia * 60000) atencao = `Sem check-in há ${hmin((agoraMs - ultimaAcao) / 60000)} desde a última loja`;
  }
  if (emTeste(pid, P.data)) atencao = ''; // em teste: sem alerta amarelo
  J.atencao = atencao; J.teste = emTeste(pid, P.data);
  return { J, pid, paradas, programadas: lojas.length, feitas, extras, nao, agora, primeira: ents.length ? Math.min(...ents) : null, ultimaSaida: sais.length ? Math.max(...sais) : null, ultima, tempo, alertas };
}
const nomeCurto = id => { const w = promNome(id).split(' ').filter(x => x && !['da', 'de', 'do', 'das', 'dos', 'e'].includes(x.toLowerCase())); return w.length > 1 ? w[0] + ' ' + w[w.length - 1] : w[0] || ''; };
const iniciais = n => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const avatar = (pid, tam = 44) => { const r = S.rostos[pid]; return r && r.foto ? `<img class="av" src="${r.foto}" alt="" style="width:${tam}px;height:${tam}px">` : `<span class="av" style="width:${tam}px;height:${tam}px;background:${corDe(pid)}">${h(iniciais(promNome(pid)))}</span>`; };
// A "estradinha": a rota do dia em ordem, verde até onde já foi feito
function estrada(d) {
  const ps = d.paradas.filter(x => !x.extra); if (!ps.length) return '<div class="muted" style="font-size:12px">Sem rota neste dia</div>';
  let ult = -1; ps.forEach((x, i) => { if (x.v) ult = i; });
  const pct = ps.length > 1 ? ult / (ps.length - 1) * 100 : (ult >= 0 ? 100 : 0);
  return `<div class="estrada"><div class="trilho"></div><div class="feito" style="width:${Math.max(0, pct)}%"></div>
    ${ps.map((x, i) => { const v = x.v; const c = !v ? '' : v.status === 'concluida' ? (alertaAberto(v) ? 'ok al' : 'ok') : v.status === 'em_loja' ? 'live' : 'no';
      const tip = `${i + 1}. ${x.nome}${v ? (v.status === 'nao_visitada' ? ' · não visitada: ' + v.motivo : ' · ' + hm(v.checkin) + (v.checkout ? '–' + hm(v.checkout) : ' (em loja)')) : ' · pendente'}`;
      return `<span class="pt ${c}" style="left:${ps.length > 1 ? i / (ps.length - 1) * 100 : 50}%" title="${h(tip)}"></span>`; }).join('')}</div>`;
}
function renderPainel() {
  const c = $('#v-painel');
  if (!c.dataset.ok) {
    c.dataset.ok = 1;
    c.innerHTML = `<div class="spread" style="flex-wrap:wrap;gap:10px"><div><h2 style="margin:0">Torre de controle</h2><div class="muted" id="p-sub" style="font-size:13px"></div></div>
      <div class="row"><button class="btn sm" id="p-alertas" title="Notificações no aparelho: chegada em loja, não visitou e promotor que não começou a rota"></button><div class="seg" id="p-modo"><button data-m="dia">Dia</button><button data-m="mes">Mês</button></div>
      <span class="row" id="p-ctl-dia"><button class="btn sm" id="p-ant" aria-label="Dia anterior">‹</button><input type="date" id="p-data" style="width:auto"><button class="btn sm" id="p-prox" aria-label="Próximo dia">›</button><button class="btn sm" id="p-hoje">Hoje</button></span>
      <span class="row" id="p-ctl-mes"><button class="btn sm" id="m-ant" aria-label="Mês anterior">‹</button><input type="month" id="p-mes" style="width:auto"><button class="btn sm" id="m-prox" aria-label="Próximo mês">›</button><button class="btn sm" id="m-atu">Atualizar</button></span></div></div>
      <div id="p-kpis"></div><div id="p-corpo"></div>`;
    $('#p-mes').value = P.mes;
    const ba = $('#p-alertas'); const pintaAl = () => { ba.textContent = AL.on && window.Notification && Notification.permission === 'granted' ? '🔔 Alertas ligados' : '🔕 Ligar alertas'; ba.classList.toggle('primary', !!(AL.on && window.Notification && Notification.permission === 'granted')); };
    pintaAl(); ba.onclick = async () => { await ligaAlertas(!(AL.on && Notification.permission === 'granted')); pintaAl(); };
    const mudaMes = m => { P.mes = m; $('#p-mes').value = m; P.selMes = ''; renderPainel(); };
    $('#p-mes').onchange = e => { if (e.target.value) mudaMes(e.target.value); };
    const somaMes = n => { const [y, mm] = P.mes.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); mudaMes(ymd(d).slice(0, 7)); };
    $('#m-ant').onclick = () => somaMes(-1); $('#m-prox').onclick = () => somaMes(1); $('#m-atu').onclick = () => { delete P.dadosMes[P.mes]; renderPainel(); };
    $('#p-modo').querySelectorAll('button').forEach(b => b.onclick = () => { P.modo = b.dataset.m; lsSet('np.p.modo', P.modo); $('#p-corpo').dataset.modo = ''; tiraMapa(); renderPainel(); });
    $('#p-data').value = P.data;
    const muda = dt => { P.data = dt; $('#p-data').value = dt; assinaPainel(); renderPainel(); };
    $('#p-data').onchange = e => { if (e.target.value) muda(e.target.value); };
    const soma = n => { const d = new Date(P.data + 'T12:00:00'); d.setDate(d.getDate() + n); muda(ymd(d)); };
    $('#p-ant').onclick = () => soma(-1); $('#p-prox').onclick = () => soma(1); $('#p-hoje').onclick = () => muda(ymd(new Date()));
  }
  $('#p-modo').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === P.modo)));
  $('#p-ctl-dia').hidden = P.modo !== 'dia'; $('#p-ctl-mes').hidden = P.modo !== 'mes';
  if (vazioCarregando()) { $('#p-corpo').innerHTML = '<div class="empty">Carregando…</div>'; return; }
  if (P.modo === 'mes') return renderMes();
  $('#p-sub').textContent = `${DIAS_LONGO[diaSemana(P.data)].replace(/^./, x => x.toUpperCase())}, ${dataBR(P.data)}${P.data === ymd(new Date()) ? ' · ao vivo' : ''}`;
  const ids = new Set(S.promotores.filter(p => p.ativo !== false).map(p => p.id)); Object.values(P.vis).forEach(v => ids.add(v.promotorId));
  const dias = [...ids].map(diaDoPromotor).filter(d => d.programadas || d.paradas.length || d.J.tem)
    .sort((a, b) => promNome(a.pid).localeCompare(promNome(b.pid)));
  const T = dias.reduce((t, d) => ({ prog: t.prog + d.programadas, feitas: t.feitas + d.feitas, live: t.live + (d.agora ? 1 : 0), nao: t.nao + d.nao, al: t.al + d.alertas, extras: t.extras + d.extras, at: t.at + (d.J.atencao ? 1 : 0) }), { prog: 0, feitas: 0, live: 0, nao: 0, al: 0, extras: 0, at: 0 });
  $('#p-kpis').innerHTML = `<div class="kpis num k5"><button class="kpi kbtn" data-k="feitas"><b>${T.feitas}<small> / ${T.prog}</small></b><span>Visitas realizadas ›</span></button><button class="kpi kbtn" data-k="live"><b style="color:var(--warn)">${T.live}</b><span>Promotores em loja agora ›</span></button><button class="kpi kbtn" data-k="nao"><b style="color:var(--crit)">${T.nao}</b><span>Não visitadas ›</span></button><button class="kpi kbtn" data-k="al"><b style="color:${T.al ? 'var(--crit)' : 'inherit'}">${T.al}</b><span>Alertas para validar ›</span></button><button class="kpi kbtn" data-k="at"><b style="color:${T.at ? '#B88600' : 'inherit'}">${T.at}</b><span>Atenção agora (parado ou sem início) ›</span></button><button class="kpi kbtn" data-k="pv" id="k-pv">${kpiValidade()}</button></div>`;
  if (!VAL.todos) carregaValidades().then(() => { const k = $('#k-pv'); if (k) k.innerHTML = kpiValidade(); });
  $('#p-kpis').querySelectorAll('[data-k]').forEach(b => b.onclick = () => b.dataset.k === 'pv' ? irPara('val') : kpiLista(b.dataset.k, dias));
  const box = $('#p-corpo');
  // dentro de um promotor os quadros da equipe somem (os dados dele já aparecem no cabeçalho)
  $('#p-kpis').hidden = !!(P.sel && dias.some(d => d.pid === P.sel));
  if (P.sel && dias.some(d => d.pid === P.sel)) return renderDetalhe(dias.find(d => d.pid === P.sel));
  P.sel = '';
  if (!dias.length) { box.dataset.modo = ''; tiraMapa(); box.innerHTML = `<div class="empty"><b>Nenhuma rota neste dia</b>As lojas aparecem conforme os dias marcados em Montar rotas.</div>`; return; }
  if (box.dataset.modo !== 'grade') {
    box.dataset.modo = 'grade'; tiraMapa();
    box.innerHTML = `<div class="torre-wrap"><div class="stack" style="gap:10px"><div class="torre" id="p-cards"></div>
      <div class="muted" style="font-size:12px;display:flex;gap:14px;flex-wrap:wrap"><span><span class="pt ok lg"></span> concluída</span><span><span class="pt live lg"></span> em loja</span><span><span class="pt lg"></span> pendente</span><span><span class="pt no lg"></span> não visitada</span><span><span class="pt ok al lg"></span> com alerta</span><span>Clique no promotor para ver o detalhe.</span></div></div>
      <div class="card mapa-geral stack" style="gap:8px"><div class="spread" style="flex-wrap:wrap;gap:6px"><h3 style="margin:0">Onde está cada promotor</h3><span class="row" style="gap:10px"><label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="p-rotas"> Rotas do dia</label><span class="muted num" id="p-atual" style="font-size:12px"></span></span></div><div id="mapa"></div>
      <div class="row" style="gap:8px;font-size:12px" id="p-geo"></div><div id="p-semgps" class="muted" style="font-size:12px"></div></div></div>`;
  }
  $('#p-cards').innerHTML = dias.map(d => {
    const pct = d.programadas ? Math.round(d.feitas / d.programadas * 100) : 0;
    return `<button class="tcard ${d.J.atencao ? 'atencao' : ''}" data-p="${h(d.pid)}">${d.J.atencao ? `<div class="aviso-at">⚠ ${h(d.J.atencao)}</div>` : ''}
      <div class="row" style="gap:10px;flex-wrap:nowrap">${avatar(d.pid)}<div style="min-width:0;flex:1"><b class="nm">${h(nomeCurto(d.pid))}</b>${d.J.teste ? ' <span class="tag y" title="Antes da data de início do app na ficha: não conta banco de horas, faltas nem rota">em teste</span>' : ''}<div class="st">${statusTexto(d)}</div></div>
        <div class="num cont"><b>${d.feitas}</b><span>/${d.programadas}</span></div></div>
      ${estrada(d)}
      <div class="ultimo">${ultimoEvento(d)}</div>
      ${deslCard(d)}
      <div class="spread muted num" style="font-size:12px"><span>${jornadaTxt(d.J)}</span><span>${pct}%${d.extras ? ` · +${d.extras} fora` : ''}${d.nao ? ` · <span style="color:var(--crit)">${d.nao} não visit.</span>` : ''}${d.alertas ? ` · <span style="color:var(--crit)">⚠ ${d.alertas}</span>` : ''}</span></div></button>`;
  }).join('');
  $('#p-cards').querySelectorAll('[data-p]').forEach(b => b.onclick = () => abreDetalhe(b.dataset.p));
  const rt = $('#p-rotas'); rt.checked = lsGet('np.p.rotas') !== '0'; rt.onchange = () => { lsSet('np.p.rotas', rt.checked ? '1' : '0'); renderPainel(); };
  const semPonto = [...new Set(dias.flatMap(d => d.paradas.filter(x => !x.extra).map(x => x.lojaId)))].map(id => S.lojas.find(l => l.id === id)).filter(l => l && !pontoLoja(l));
  if (!G.rodando) $('#p-geo').innerHTML = semPonto.length ? `<span class="muted">${semPonto.length} lojas da rota de hoje sem ponto no mapa.</span><button class="btn sm" id="p-geo-b">Localizar pelo endereço</button>` : '';
  const gb = $('#p-geo-b'); if (gb) gb.onclick = () => localizaLojas(semPonto, t => { const e = $('#p-geo'); if (e) e.innerHTML = t ? `<span class="muted">${t}</span>` : ''; });
  // na primeira abertura, já localiza sozinho as lojas da rota que ainda não têm ponto
  let tentou = false; try { tentou = sessionStorage.getItem('np.geo.' + P.data) === '1'; sessionStorage.setItem('np.geo.' + P.data, '1'); } catch (e) {}
  if (gb && !tentou) setTimeout(() => { const b = $('#p-geo-b'); if (b) b.click(); }, 1500);
  $('#p-atual').textContent = 'atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  mapaGeral(dias);
}
// Último acontecimento do promotor no dia (aparece embaixo da estradinha)
function ultimoEvento(d) {
  const ev = [];
  d.paradas.forEach(x => { const v = x.v; if (!v) return; const n = `${x.extra ? '' : x.ordem + 'ª · '}${h(x.nome)}`;
    if (v.status === 'nao_visitada') ev.push({ t: v.registrado || 0, html: `<span class="ic-ev no">✕</span> Não visitou <b>${n}</b> · ${h(v.motivo || '')} · ${hm(v.registrado)}` });
    else { if (v.checkin) ev.push({ t: v.checkin, html: `<span class="ic-ev live">➜</span> Check-in em <b>${n}</b> às ${hm(v.checkin)}${v.rostoOk === false ? ' · <span style="color:var(--crit)">rosto ≠</span>' : ''}${foraLoja(v) ? ` · <span style="color:var(--crit)">⚠️ fora da loja (${v.distIn} m)</span>` : ''}` });
      if (v.checkout) ev.push({ t: v.checkout, html: `<span class="ic-ev ok">✓</span> Check-out em <b>${n}</b> às ${hm(v.checkout)} · ${dur(v.checkin, v.checkout)}` }); } });
  const jr = (P.jor || {})[d.pid];
  if (jr && jr.almocoInicio) ev.push({ t: jr.almocoInicio, html: `<span class="ic-ev" style="background:#2F80ED">🍽</span> Saiu para o almoço às ${hm(jr.almocoInicio)}` });
  if (jr && jr.almocoFim) ev.push({ t: jr.almocoFim, html: `<span class="ic-ev" style="background:#2F80ED">🍽</span> Voltou do almoço às ${hm(jr.almocoFim)} · ${hmin((jr.almocoFim - jr.almocoInicio) / 60000)}` });
  if (!ev.length) return '<span class="muted">Aguardando o primeiro check-in</span>';
  return ev.sort((a, b) => b.t - a.t)[0].html;
}
// Resumo do deslocamento entre lojas no cartão da visão geral
function deslCard(d) {
  const vs = d.paradas.filter(x => x.v && x.v.checkin && x.v.status !== 'nao_visitada').sort((a, b) => a.v.checkin - b.v.checkin);
  const tr = [];
  for (let i = 1; i < vs.length; i++) { const a = vs[i - 1], b = vs[i]; if (a.v.checkout && a.v.checkout <= b.v.checkin) tr.push({ de: a, para: b, min: Math.round((b.v.checkin - a.v.checkout) / 60000) }); }
  const ult = vs[vs.length - 1];
  const emTransito = ult && ult.v.checkout && d.J.andamento && vs.length < d.paradas.filter(x => x.v ? x.v.status !== 'nao_visitada' : true).length;
  if (!tr.length && !emTransito) return '';
  const tot = tr.reduce((s, t) => s + t.min, 0);
  const partes = [];
  if (tr.length) partes.push(`<b>${hmin(tot)}</b> entre lojas (${tr.length} trecho${tr.length > 1 ? 's' : ''})`);
  if (emTransito) partes.push(`<span style="color:var(--warn,#C77700)">a caminho desde ${hm(ult.v.checkout)} · ${hmin(Math.round((Date.now() - ult.v.checkout) / 60000))}</span>`);
  else if (tr.length) { const t = tr[tr.length - 1]; partes.push(`último: ${h(t.de.nome)} → ${h(t.para.nome)} <b>${hmin(t.min)}</b>`); }
  return `<div class="desl-card muted num">🚌 ${partes.join(' · ')}</div>`;
}
function jornadaTxt(J) {
  if (!J.tem) return 'Jornada não iniciada';
  const ini = hm(J.inicio);
  if (J.andamento || J.hojeAberto) return `Jornada desde ${ini} · <b style="color:var(--ink)">${hmin(J.trabalhado)}</b>${J.andamento ? '' : ' até a última saída'}`;
  return `Jornada ${ini}–${hm(J.fim)}${J.fimEst ? '*' : ''} · <b style="color:var(--ink)">${hmin(J.trabalhado)}</b> <span style="color:${J.saldo < 0 ? 'var(--crit)' : 'var(--ok)'}">(${saldoTxt(J.saldo)})</span>`;
}
/* ---------- visão do mês: visitas e banco de horas ---------- */
const inicioControle = () => S.empresa.inicioControle || '2026-10-30'; // antes disso não havia app: não conta falta
// início do controle de cada promotor: a data dele (ficha) ou, sem data, a geral. Antes disso é teste.
const inicioDe = pid => { const p = S.promotores.find(x => x.id === pid); const g = inicioControle(); return p && p.inicioApp && p.inicioApp > g ? p.inicioApp : g; };
const emTeste = (pid, d) => !!(S.promotores.find(p => p.id === pid) || {}).espelhoDe || d < inicioDe(pid);
function diasDoMes(mes) { const [y, m] = mes.split('-').map(Number); const n = new Date(y, m, 0).getDate(); const hoje = ymd(new Date()); const ini = inicioControle(); return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`).filter(d => d <= hoje && d >= ini); }
async function carregaMes(mes) {
  if (P.dadosMes[mes] && P.dadosMes[mes].ok) return P.dadosMes[mes];
  if (P.dadosMes[mes] && P.dadosMes[mes].carregando) return null;
  const D = P.dadosMes[mes] = { carregando: true, vis: {}, jor: {} };
  const ds = diasDoMes(mes);
  await Promise.all(ds.map(async d => {
    const [v, j] = await Promise.all([getDocs(collection(db, 'dias', d, 'visitas')).catch(() => null), getDocs(collection(db, 'dias', d, 'jornadas')).catch(() => null)]);
    D.vis[d] = {}; if (v) v.docs.forEach(x => D.vis[d][x.id] = x.data());
    D.jor[d] = {}; if (j) j.docs.forEach(x => D.jor[d][x.id] = x.data());
  }));
  D.carregando = false; D.ok = true; D.em = Date.now(); return D;
}
// Divide as horas trabalhadas do dia: em loja (check-in → check-out, sem o almoço) e deslocamento (o resto da jornada)
function divideJornada(J, vs, j) {
  if (!J.tem) return { loja: 0, desl: 0 };
  const ag = Date.now();
  let iv = vs.filter(v => v.checkin && v.status !== 'nao_visitada').map(v => [Math.max(v.checkin, J.inicio), Math.min(v.checkout || (J.andamento && v.status === 'em_loja' ? ag : v.checkin), J.fim)]).filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const m = []; iv.forEach(x => { const u = m[m.length - 1]; if (u && x[0] <= u[1]) u[1] = Math.max(u[1], x[1]); else m.push(x.slice()); });
  let loja = m.reduce((t, x) => t + (x[1] - x[0]), 0);
  if (J.almoco && J.almocoIni) { const a0 = J.almocoIni, a1 = J.almocoFim || ag; m.forEach(x => { loja -= Math.max(0, Math.min(x[1], a1) - Math.max(x[0], a0)); }); }
  loja = Math.min(J.trabalhado, Math.max(0, Math.round(loja / 60000)));
  return { loja, desl: J.trabalhado - loja };
}
function resumoMes(D, mes) {
  const hoje = ymd(new Date()); const regras = regrasJornada(S.empresa);
  const ids = new Set(S.promotores.filter(p => p.ativo !== false).map(p => p.id));
  Object.values(D.vis).forEach(m => Object.values(m).forEach(v => ids.add(v.promotorId)));
  return [...ids].map(pid => {
    const R = { pid, dias: [], loja: 0, desl: 0, trab: 0, prev: 0, saldo: 0, diasTrab: 0, faltas: 0, prog: 0, feitas: 0, nao: 0, semVisita: 0, fora: 0, alertas: 0, andamento: null };
    diasDoMes(mes).forEach(d => {
      if (emTeste(pid, d)) return; // período de teste: não entra no banco de horas, faltas e rotas
      const lojas = lojasDoDia(pid, d); const m = D.vis[d] || {};
      const vs = Object.entries(m).filter(([, v]) => v.promotorId === pid);
      const naRota = new Set(lojas.map(l => l.id + '_' + pid));
      const feitas = vs.filter(([k, v]) => naRota.has(k) && v.status === 'concluida').length;
      const nao = vs.filter(([, v]) => v.status === 'nao_visitada').length;
      const fora = vs.filter(([k, v]) => !naRota.has(k) && v.status !== 'nao_visitada').length;
      const sem = d < hoje ? lojas.filter(l => !m[l.id + '_' + pid]) : [];
      const al = vs.filter(([, v]) => alertaAberto(v)).length;
      const J = calcJornada({ j: (D.jor[d] || {})[pid], vs: vs.map(([, v]) => v), date: d, regras, hoje });
      const DV = divideJornada(J, vs.map(([, v]) => v), (D.jor[d] || {})[pid]); J.loja = DV.loja; J.desl = DV.desl;
      const falta = !J.tem && d < hoje && lojas.length > 0 && J.esperado > 0 && !vs.some(([, v]) => v.status === 'nao_visitada');
      if (!lojas.length && !vs.length && !J.tem) return;
      R.dias.push({ d, lojas: lojas.length, feitas, nao, fora, sem, al, J, falta });
      R.prog += lojas.length; R.feitas += feitas; R.nao += nao; R.fora += fora; R.semVisita += sem.length; R.alertas += al;
      if (J.tem) { R.diasTrab++; if (J.andamento || d === hoje) R.andamento = J; else { R.trab += J.trabalhado; R.loja += J.loja; R.desl += J.desl; R.prev += J.esperado; R.saldo += J.saldo; } }
      if (falta) R.faltas++;
    });
    return R;
  }).filter(R => R.dias.length).sort((a, b) => promNome(a.pid).localeCompare(promNome(b.pid)));
}
const partes = (v, tot, hoje, desl) => `${hmin(v)} <span class="muted">${tot ? Math.round(v / tot * 100) : 0}%</span>${hoje != null && hoje !== false ? `<div class="muted" style="font-size:11px">+ hoje ${hmin(hoje)}</div>` : ''}`;
async function renderMes() {
  const box = $('#p-corpo'); box.dataset.modo = 'mes'; tiraMapa();
  const [y, m] = P.mes.split('-').map(Number); const nomeMes = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  $('#p-sub').textContent = nomeMes.replace(/^./, x => x.toUpperCase()) + ' · dias até hoje' + (P.mes === inicioControle().slice(0, 7) ? ' · controle pelo app desde ' + dataBR(inicioControle()) : '');
  let D = P.dadosMes[P.mes];
  if (!D || !D.ok) {
    $('#p-kpis').innerHTML = ''; box.innerHTML = '<div class="empty">Carregando o mês… (lê dia por dia)</div>';
    D = await carregaMes(P.mes); if (!D || P.modo !== 'mes') return;
  }
  const RS = resumoMes(D, P.mes);
  if (!diasDoMes(P.mes).length) { $('#p-kpis').innerHTML = ''; box.innerHTML = `<div class="empty"><b>Sem dias controlados neste mês</b>O controle pelo app começou em ${dataBR(inicioControle())}.</div>`; return; }
  const T = RS.reduce((t, r) => ({ prog: t.prog + r.prog, feitas: t.feitas + r.feitas, nao: t.nao + r.nao, sem: t.sem + r.semVisita, saldo: t.saldo + r.saldo, faltas: t.faltas + r.faltas, al: t.al + r.alertas }), { prog: 0, feitas: 0, nao: 0, sem: 0, saldo: 0, faltas: 0, al: 0 });
  $("#p-kpis").hidden = false; $("#p-kpis").innerHTML = `<div class="kpis num"><div class="kpi"><b>${T.feitas}<small> / ${T.prog}</small></b><span>Visitas realizadas (${T.prog ? Math.round(T.feitas / T.prog * 100) : 0}%)</span></div><div class="kpi"><b style="color:var(--crit)">${T.sem + T.nao}</b><span>Lojas sem visita (${T.nao} com motivo)</span></div><div class="kpi"><b style="color:${T.faltas ? 'var(--crit)' : 'inherit'}">${T.faltas}</b><span>Dias com rota sem jornada</span></div><div class="kpi"><b style="color:${T.saldo < 0 ? 'var(--crit)' : 'var(--ok)'}">${saldoTxt(T.saldo)}</b><span>Banco de horas da equipe</span></div></div>`;
  if (P.selMes && RS.some(r => r.pid === P.selMes)) return renderMesPromotor(RS.find(r => r.pid === P.selMes), nomeMes);
  box.innerHTML = `<div class="card" style="padding:0"><div class="table-wrap"><table class="num mes"><thead><tr><th>Promotor</th><th class="r">Dias trab.</th><th class="r">Faltas</th><th class="r">Horas trab.</th><th class="r">Em loja</th><th class="r">Deslocamento</th><th class="r">Previstas</th><th class="r">Banco de horas</th><th class="r">Visitas</th><th class="r">Não visitadas</th><th class="r">Sem registro</th><th class="r">Fora da rota</th><th class="r">Alertas</th></tr></thead><tbody>
    ${RS.map(r => `<tr class="click" data-pm="${h(r.pid)}"><td><div class="row" style="gap:8px;flex-wrap:nowrap">${avatar(r.pid, 30)}<b>${h(nomeCurto(r.pid))}</b></div></td><td class="r">${r.diasTrab}</td><td class="r" style="color:${r.faltas ? 'var(--crit)' : 'inherit'}">${r.faltas || '—'}</td><td class="r"><b>${hmin(r.trab)}</b></td><td class="r">${partes(r.loja, r.trab, r.andamento && r.andamento.loja)}</td><td class="r">${partes(r.desl, r.trab, r.andamento && r.andamento.desl, true)}</td><td class="r">${hmin(r.prev)}</td>
      <td class="r"><b style="color:${r.saldo < 0 ? 'var(--crit)' : 'var(--ok)'}">${saldoTxt(r.saldo)}</b>${r.andamento ? `<div class="muted" style="font-size:11px">+ hoje ${hmin(r.andamento.trabalhado)} em andamento</div>` : ''}</td>
      <td class="r">${r.feitas}/${r.prog} <span class="muted">${r.prog ? Math.round(r.feitas / r.prog * 100) : 0}%</span></td><td class="r">${r.nao || '—'}</td><td class="r" style="color:${r.semVisita ? 'var(--crit)' : 'inherit'}">${r.semVisita || '—'}</td><td class="r">${r.fora || '—'}</td><td class="r" style="color:${r.alertas ? 'var(--crit)' : 'inherit'}">${r.alertas || '—'}</td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="muted" style="font-size:12px">Banco de horas: horas trabalhadas (do início ao fim da jornada, menos o almoço automático das ${(regrasJornada(S.empresa).almocoFixo || {}).ini || '12:00'} às ${(regrasJornada(S.empresa).almocoFixo || {}).fim || '13:00'}; antes de 10/11, 1h nos dias acima de 6h) menos a carga prevista do dia (${hmin(regrasJornada(S.empresa).carga[1])} seg–sex, ${hmin(regrasJornada(S.empresa).carga[6])} sáb). Em loja = do check-in ao check-out de cada loja (sem o almoço marcado); Deslocamento = o restante da jornada, entre uma loja e outra. Jornada = do check-in da primeira loja ao check-out da última. O dia de hoje entra no saldo quando o promotor sai da última loja. "Sem registro" = loja da rota de um dia que já passou sem check-in nem motivo. Dados lidos às ${new Date(D.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</div>
    <button class="btn sm" id="m-csv">Baixar planilha do mês</button></div>`;
  box.querySelectorAll('[data-pm]').forEach(tr => tr.onclick = () => { P.selMes = tr.dataset.pm; renderPainel(); });
  $('#m-csv').onclick = () => csvMes(RS, nomeMes);
}
function renderMesPromotor(r, nomeMes) {
  const box = $('#p-corpo');
  box.innerHTML = `<div class="stack"><div class="row" style="gap:12px;flex-wrap:wrap"><button class="btn sm" id="pm-volta">‹ Todos</button>${avatar(r.pid, 48)}<div><h3 style="margin:0;font-size:20px">${h(promNome(r.pid))}</h3>
      <div class="muted num" style="font-size:13px">${nomeMes} · ${r.diasTrab} dias trabalhados · ${hmin(r.trab)} trabalhadas (${hmin(r.loja)} em loja · ${hmin(r.desl)} de deslocamento) de ${hmin(r.prev)} previstas · banco de horas <b style="color:${r.saldo < 0 ? 'var(--crit)' : 'var(--ok)'}">${saldoTxt(r.saldo)}</b> · visitas ${r.feitas}/${r.prog}${r.faltas ? ` · <span style="color:var(--crit)">${r.faltas} falta(s)</span>` : ''}</div></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="num"><thead><tr><th>Data</th><th>Jornada</th><th class="r">Trabalhado</th><th class="r">Em loja</th><th class="r">Deslocamento</th><th class="r">Previsto</th><th class="r">Saldo</th><th class="r">Visitas</th><th>Sem visita</th><th class="r">Alertas</th></tr></thead><tbody>
    ${r.dias.map(x => { const J = x.J; return `<tr class="click" data-dd="${x.d}"><td><b>${x.d.slice(8)}/${x.d.slice(5, 7)}</b> <span class="muted">${DIAS[J.wd]}</span></td>
      <td>${x.falta ? '<span class="tag no">sem jornada</span>' : J.tem ? `${hm(J.inicio)}–${J.andamento ? 'agora' : hm(J.fim) + (J.fimEst ? '*' : '')}` : '—'}</td>
      <td class="r">${J.tem ? hmin(J.trabalhado) : '—'}${J.tem && J.almoco ? `<div class="muted" style="font-size:11px">almoço ${J.almocoMarcado || J.almocoFixo ? hm(J.almocoIni) + '–' + (J.almocoFim ? hm(J.almocoFim) : '?') : '1h (padrão)'}</div>` : ''}</td><td class="r">${J.tem ? hmin(J.loja) : '—'}</td><td class="r">${J.tem ? hmin(J.desl) : '—'}</td><td class="r">${hmin(J.esperado)}</td><td class="r" style="color:${J.tem && !J.andamento && x.d !== ymd(new Date()) ? (J.saldo < 0 ? 'var(--crit)' : 'var(--ok)') : 'inherit'}">${J.tem && !J.andamento && x.d !== ymd(new Date()) ? saldoTxt(J.saldo) : J.tem ? 'hoje, em andamento' : '—'}</td>
      <td class="r">${x.feitas}/${x.lojas}${x.fora ? ` <span class="muted">+${x.fora}</span>` : ''}</td>
      <td style="font-size:12.5px">${x.nao ? `<span class="tag">${x.nao} com motivo</span> ` : ''}${x.sem.length ? `<span style="color:var(--crit)">${x.sem.map(l => h(l.nome)).join(', ')}</span>` : (x.nao ? '' : '—')}</td>
      <td class="r" style="color:${x.al ? 'var(--crit)' : 'inherit'}">${x.al || '—'}</td></tr>`; }).join('')}
    </tbody></table></div></div>
    <div class="muted" style="font-size:12px">Jornada = do check-in da primeira loja ao check-out da última. * ficou sem check-out na última loja: contado até a última entrada. Clique num dia para abrir a Torre naquele dia.</div></div>`;
  $('#pm-volta').onclick = () => { P.selMes = ''; renderPainel(); };
  box.querySelectorAll('[data-dd]').forEach(tr => tr.onclick = () => { P.modo = 'dia'; lsSet('np.p.modo', 'dia'); P.data = tr.dataset.dd; $('#p-data').value = P.data; P.sel = r.pid; box.dataset.modo = ''; assinaPainel(); renderPainel(); window.scrollTo(0, 0); });
}

/* ---------- Pesquisa de preço e validades (última informação de cada loja × produto) ---------- */
const VAL = { dias: 21, cache: null, todos: null, em: 0, carregando: null, aba: lsGet('np.pv.aba') || 'val', f: { loja: '', prom: '', prod: '', so: '' } };
const dataHoje = () => ymd(new Date());
const diasAteV = d => Math.round((new Date(d + 'T12:00:00') - new Date(dataHoje() + 'T12:00:00')) / 864e5);
async function carregaValidades(forca) {
  if (VAL.carregando) return VAL.carregando;
  if (!forca && VAL.todos && Date.now() - VAL.em < 120000) return;
  VAL.carregando = (async () => {
    try {
      const hoje = new Date(); const datas = [];
      for (let i = VAL.dias - 1; i >= 0; i--) { const d = new Date(hoje); d.setDate(d.getDate() - i); datas.push(ymd(d)); }
      const snaps = await Promise.all(datas.map(d => getDocs(collection(db, 'dias', d, 'visitas')).then(s => [d, s]).catch(() => [d, null])));
      const ult = new Map(); const ck = q => q.replace(/[.~*/\[\]]/g, '_'); const nomes = new Map(S.pesquisa.map(q => [ck(q), q]));
      snaps.forEach(([d, s]) => { if (!s) return; s.docs.map(x => x.data()).sort((a, b) => (a.checkin || 0) - (b.checkin || 0)).forEach(v => {
        if (emTeste(v.promotorId, d) && (S.promotores.find(p => p.id === v.promotorId) || {}).espelhoDe) return; // usuário de teste fora dos relatórios
        Object.entries(v.precos || {}).forEach(([k, x]) => { if (!x) return; ult.set(v.lojaId + '|' + k, { d, k, x, v, produto: nomes.get(k) || k }); });
      }); });
      VAL.todos = [...ult.values()].filter(r => nomes.has(r.k)).map(r => Object.assign(r, { faltam: r.x.val ? diasAteV(r.x.val) : null }));
      VAL.cache = VAL.todos.filter(r => r.x.val && !r.x.falta && r.faltam < 10).sort((a, b) => alfaProd(a.produto, b.produto) || alfaLoja(a, b));
      VAL.verdes = VAL.todos.filter(r => r.x.val && !r.x.falta && r.faltam >= 10).sort((a, b) => alfaProd(a.produto, b.produto) || alfaLoja(a, b));
      VAL.em = Date.now();
    } catch (e) { toast(erroMsg(e)); } finally { VAL.carregando = null; }
  })();
  return VAL.carregando;
}
const lojaDe = r => { const l = S.lojas.find(y => y.id === r.v.lojaId) || {}; return { cod: String(r.v.codigo || l.codigo || ''), nome: r.v.lojaNome || l.nome || '', cid: l.municipio || r.v.cidade || '' }; };
const faltamTxt = n => n < 0 ? `vencido há ${-n} dia${n < -1 ? 's' : ''}` : n === 0 ? 'vence hoje' : `faltam ${n} dia${n > 1 ? 's' : ''}`;
function filtraPV(L, semTexto) {
  const f = VAL.f; const t = semTexto ? '' : semAcento(f.prod.trim());
  return L.filter(r => (!f.loja || r.v.lojaId === f.loja) && (!f.prom || r.v.promotorId === f.prom) && (!t || semAcento(r.produto).includes(t)));
}
async function renderVal(forca) {
  const c = $('#v-val');
  if (!c.dataset.ok) {
    c.dataset.ok = '1';
    c.innerHTML = `<div class="spread" style="flex-wrap:wrap"><div><h2>Pesquisa e validades</h2><div class="muted" style="font-size:13px">Última informação de cada loja e produto nos últimos ${VAL.dias} dias.</div></div>
      <div class="row"><button class="btn sm" id="vl-csv">Baixar planilha</button><button class="btn sm" id="vl-at">Atualizar</button></div></div>
      <div class="seg" id="vl-aba"><button data-a="val">⏳ Validades</button><button data-a="pq">💲 Pesquisa de preço</button><button data-a="rup">🚫 Rupturas</button></div>
      <div class="card row" style="gap:8px;flex-wrap:wrap;padding:10px" id="vl-f">
        <select id="vf-loja" style="flex:2;min-width:180px"></select><select id="vf-prom" style="flex:1;min-width:150px"></select>
        <input type="search" id="vf-prod" placeholder="Produto (nome ou código)" style="flex:2;min-width:170px">
        <select id="vf-so" style="flex:1;min-width:140px"></select><button class="btn sm ghost" id="vf-lim">Limpar</button></div>
      <div id="vl-c" class="muted">Carregando…</div>`;
    $('#vl-at').onclick = () => renderVal(true);
    $('#vl-aba').querySelectorAll('[data-a]').forEach(b => b.onclick = () => { VAL.aba = b.dataset.a; VAL.f.so = ''; lsSet('np.pv.aba', VAL.aba); desenhaPV(); });
    $('#vf-loja').onchange = e => { VAL.f.loja = e.target.value; desenhaPV(); };
    $('#vf-prom').onchange = e => { VAL.f.prom = e.target.value; desenhaPV(); };
    $('#vf-prod').oninput = e => { VAL.f.prod = e.target.value; desenhaPV(); };
    $('#vf-so').onchange = e => { VAL.f.so = e.target.value; desenhaPV(); };
    $('#vf-lim').onclick = () => { VAL.f = { loja: '', prom: '', prod: '', so: '' }; $('#vf-prod').value = ''; desenhaPV(); };
  }
  if (forca || !VAL.todos) { const bx = $('#vl-c'); if (bx && !VAL.todos) bx.textContent = 'Carregando…'; }
  await carregaValidades(forca);
  if (S.tab === 'val') desenhaPV();
}
// celular: listas em vez de tabelas (sem rolar para os lados); informações embaixo do nome, em letra menor
const celPV = () => window.innerWidth < 760;
// ordem alfabética: produto pelo nome (sem o código), loja pelo nome
const nomeProd = p => p.replace(/^\d+\s*-\s*/, '');
const alfaProd = (a, b) => nomeProd(a).localeCompare(nomeProd(b), 'pt-BR');
const alfaLoja = (a, b) => lojaDe(a).nome.localeCompare(lojaDe(b).nome, 'pt-BR') || lojaDe(a).cod.localeCompare(lojaDe(b).cod);
const corFaixa = r => r.x.falta ? 'var(--crit)' : r.faltam == null ? 'var(--line)' : r.faltam < 7 ? 'var(--crit)' : r.faltam < 10 ? '#E0A800' : '#2E9D5B';
const valTxt = r => { if (!r.x.val || r.x.falta) return ''; const n = r.faltam; const cor = n < 7 ? 'var(--crit)' : n < 10 ? '#9A6B00' : '#1E7A44'; return `<b style="color:${cor}">val. ${dataBR(r.x.val).slice(0, 5)} · ${faltamTxt(n)}</b>`; };
const precoTxt = r => r.x.falta ? '<b style="color:var(--crit)">RUPTURA</b>' : typeof r.x.preco === 'number' ? `<b>${brl(r.x.preco)}</b>` : '';
// produto que abre (acordeão) e mostra as lojas logo abaixo, sem tela por cima
const produtoPV = (titulo, linhas, cor, produto, modo, faixa) => `<details class="pv-li pv-prodbox" style="border-left-color:${cor || 'var(--line)'}" data-p="${h(produto)}" data-modo="${modo}" data-fx="${faixa || ''}"><summary><div class="pv-t">${titulo}</div>${linhas.filter(Boolean).map(l => `<div class="pv-s">${l}</div>`).join('')}</summary><div class="pv-corpo"></div></details>`;
const liPV = (titulo, linhas, cor, attrs) => `<div class="pv-li${attrs ? ' pv-clic' : ''}" style="border-left-color:${cor || 'var(--line)'}" ${attrs || ''}><div class="pv-t">${titulo}</div>${linhas.filter(Boolean).map(l => `<div class="pv-s">${l}</div>`).join('')}</div>`;
let rzPV = null; window.addEventListener('resize', () => { clearTimeout(rzPV); rzPV = setTimeout(() => { if (S.tab === 'val' && $('#vl-c')) desenhaPV(); }, 300); });
// tabela das lojas de um produto (usada na busca e ao clicar num produto em qualquer módulo)
function tabelaLojasProduto(rs) {
  if (celPV()) return `<div class="pv-lista">${rs.slice().sort(alfaLoja).map(r => { const lj = lojaDe(r);
    return liPV(`${h(lj.cod)} · ${h(lj.nome)} <span class="muted" style="font-weight:500">· ${h(lj.cid)}</span>`, [[precoTxt(r), valTxt(r), r.x.qtd != null && !r.x.falta ? `${r.x.qtd} un a vender` : ''].filter(Boolean).join(' · '), `${h(promNome(r.v.promotorId))} · ${dataBR(r.d).slice(0, 5)}${r.v.checkin ? ' ' + hm(r.v.checkin) : ''}`], corFaixa(r)); }).join('')}</div>`;
  return `<div style="overflow-x:auto"><table class="num pv-tab"><thead><tr><th>Loja (cliente)</th><th class="r">Preço de ponta</th><th>Validade</th><th class="r">Qtd a vender</th><th>Promotor</th><th>Data da pesquisa</th></tr></thead><tbody>${rs.slice().sort(alfaLoja).map(r => { const lj = lojaDe(r); const n = r.faltam; const cor = r.x.falta || n == null ? '' : n < 7 ? 'var(--crit)' : n < 10 ? '#9A6B00' : '#1E7A44'; const fundo = r.x.falta || n == null ? '' : n < 7 ? '#FDECEC' : n < 10 ? '#FFF6D6' : '#E9F7EF';
    return `<tr><td><b>${h(lj.cod)}</b> · ${h(lj.nome)}<div class="muted" style="font-size:.85em">${h(lj.cid)}</div></td><td class="r"><b>${r.x.falta ? '<span style="color:var(--crit)">ruptura</span>' : typeof r.x.preco === 'number' ? brl(r.x.preco) : '—'}</b></td>
      <td style="white-space:nowrap;background:${fundo};color:${cor}">${r.x.val && !r.x.falta ? `<b>${dataBR(r.x.val)}</b><div style="font-size:.85em">${faltamTxt(n)}</div>` : '—'}</td><td class="r">${r.x.qtd != null && !r.x.falta ? r.x.qtd + ' un' : '—'}</td><td>${h(promNome(r.v.promotorId))}</td><td style="white-space:nowrap">${dataBR(r.d)}${r.v.checkin ? ' ' + hm(r.v.checkin) : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
}
// clique no produto: lojas daquele produto, só com o que interessa em cada módulo
function dadosLoja(r) { // endereço e dados do cliente (abre ao tocar no nome)
  const l = S.lojas.find(y => y.id === r.v.lojaId) || {}; const end = [l.endereco, l.numero].filter(Boolean).join(', ');
  const linha = [end, l.bairro, [l.municipio, l.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  const q = encodeURIComponent([end, l.bairro, l.municipio, l.uf].filter(Boolean).join(', '));
  return `<div class="pv-end">${l.razao ? `<div><b>${h(l.razao)}</b></div>` : ''}<div>📍 ${h(linha || 'Endereço não cadastrado')}${l.cep ? ' · CEP ' + h(l.cep) : ''}</div>${l.telefone ? `<div>📞 ${h(l.telefone)}</div>` : ''}<div>Pesquisa feita em ${dataBR(r.d)}${r.v.checkin ? ' às ' + hm(r.v.checkin) : ''} por ${h(promNome(r.v.promotorId))}</div>${q ? `<a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Abrir no mapa ›</a>` : ''}</div>`;
}
function linhasModo(r, modo) {
  const lj = lojaDe(r); const tit = `${h(lj.cod)} · ${h(lj.nome)} <span class="muted" style="font-weight:500">· ${h(lj.cid)}</span>`; const quando = `pesquisa ${dataBR(r.d).slice(0, 5)}${r.v.checkin ? ' ' + hm(r.v.checkin) : ''}`;
  let info, cor;
  if (modo === 'val') { const n = r.faltam; const c = n < 7 ? 'var(--crit)' : n < 10 ? '#9A6B00' : '#1E7A44'; cor = corFaixa(r);
    info = `<span class="pv-dest" style="color:${c}">val. ${dataBR(r.x.val).slice(0, 5)} · ${faltamTxt(n)}</span>${r.x.qtd != null ? ` <span class="pv-dest2">${r.x.qtd} un a vender</span>` : ''}`; }
  else if (modo === 'pq') { cor = r._cor || 'var(--line)'; info = `<span class="pv-dest" style="color:${r._cor || 'var(--ink)'}">${brl(r.x.preco)}</span>${r._tag ? ` <span class="pv-tag" style="background:${r._cor}">${r._tag}</span>` : ''}`; }
  else { cor = 'var(--crit)'; info = '<span class="pv-dest" style="color:var(--crit)">ruptura</span>'; }
  return `<details class="pv-loja" style="border-left-color:${cor}"><summary><div class="pv-t">${tit}</div><div class="pv-s">${info}</div><div class="pv-s">${quando} · <u>ver endereço</u></div></summary>${dadosLoja(r)}</details>`;
}
// lojas de um produto, conforme o módulo (validade: só a faixa; preço: só preços; ruptura: só lojas em ruptura)
function lojasProdutoHTML(produto, modo, faixa) {
  let rs = filtraPV((VAL.todos || []).filter(r => r.produto === produto), true);
  let cab = '';
  if (modo === 'val') {
    rs = rs.filter(r => r.x.val && !r.x.falta && (faixa === 'r' ? r.faltam < 7 : faixa === 'a' ? r.faltam >= 7 && r.faltam < 10 : faixa === 'v' ? r.faltam >= 10 : true)).sort((a, b) => a.faltam - b.faltam || alfaLoja(a, b));
    const q = rs.reduce((s, r) => s + (+r.x.qtd || 0), 0);
    cab = `${rs.length} loja${rs.length === 1 ? '' : 's'} ${faixa === 'r' ? 'com menos de 7 dias' : faixa === 'a' ? 'com 7 a 9 dias' : 'com 10 dias ou mais'}${q ? ` · <b>${q} un a vender</b>` : ''}`;
  } else if (modo === 'pq') {
    rs = rs.filter(r => !r.x.falta && typeof r.x.preco === 'number').sort(alfaLoja);
    const pr = rs.map(r => r.x.preco); const mn = Math.min(...pr), mx = Math.max(...pr), md = pr.reduce((s, x) => s + x, 0) / (pr.length || 1);
    rs.forEach(r => { r._cor = pr.length > 1 && r.x.preco === mn ? '#1E7A44' : pr.length > 1 && r.x.preco === mx ? 'var(--crit)' : ''; r._tag = pr.length > 1 && r.x.preco === mn ? 'menor preço' : pr.length > 1 && r.x.preco === mx ? 'maior preço' : ''; });
    cab = pr.length ? `${rs.length} loja${rs.length === 1 ? '' : 's'} · menor <b style="color:#1E7A44">${brl(mn)}</b> · maior <b style="color:var(--crit)">${brl(mx)}</b> · média <b>${brl(md)}</b>` : 'Nenhum preço lançado.';
  } else {
    rs = rs.filter(r => r.x.falta).sort(alfaLoja);
    cab = `<b style="color:var(--crit)">${rs.length} loja${rs.length === 1 ? '' : 's'} em ruptura</b> (visitadas e sem o produto na gôndola)`;
  }
  return `<div class="muted num pv-cab">${cab}</div><div class="pv-lista">${rs.length ? rs.map(r => linhasModo(r, modo)).join('') : '<div class="muted">Nenhuma loja.</div>'}</div>`;
}
function desenhaPV() {
  const box = $('#vl-c'); if (!box) return;
  const T = VAL.todos || [];
  $('#vl-aba').querySelectorAll('[data-a]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.a === VAL.aba)));
  // filtros (lojas e promotores que têm informação)
  const lojas = [...new Map(T.map(r => [r.v.lojaId, lojaDe(r)])).entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome));
  const proms = [...new Set(T.map(r => r.v.promotorId))].sort((a, b) => promNome(a).localeCompare(promNome(b)));
  $('#vf-loja').innerHTML = `<option value="">Todas as lojas (${lojas.length})</option>` + lojas.map(([id, l]) => `<option value="${h(id)}" ${VAL.f.loja === id ? 'selected' : ''}>${h(l.cod)} · ${h(l.nome)} · ${h(l.cid)}</option>`).join('');
  $('#vf-prom').innerHTML = `<option value="">Todos os promotores</option>` + proms.map(p => `<option value="${h(p)}" ${VAL.f.prom === p ? 'selected' : ''}>${h(promNome(p))}</option>`).join('');
  const opSo = VAL.aba === 'val' ? [['', 'Todas as faixas'], ['r', 'Só vermelho (< 7 dias)'], ['a', 'Só amarelo (7 a 9 dias)'], ['ra', 'Vermelho e amarelo'], ['v', 'Só verde (10 dias ou mais)']] : null;
  $('#vf-so').hidden = !opSo; if (!opSo) VAL.f.so = '';
  if (opSo) $('#vf-so').innerHTML = opSo.map(([k, t]) => `<option value="${k}" ${VAL.f.so === k ? 'selected' : ''}>${t}</option>`).join('');
  box.className = 'stack';
  const so = VAL.f.so;
  const lista = (itens, vazio) => itens.length ? `<div class="pv-lista">${itens.join('')}</div>` : `<div class="muted" style="font-size:14px">${vazio}</div>`;
  const grupo = L => { const g = new Map(); L.forEach(r => { if (!g.has(r.produto)) g.set(r.produto, []); g.get(r.produto).push(r); }); return [...g.entries()].sort((a, b) => alfaProd(a[0], b[0])); };
  if (VAL.aba === 'val') {
    // só o produto; clicando, as lojas daquela faixa
    const L = filtraPV((VAL.todos || []).filter(r => r.x.val && !r.x.falta));
    const fx = [['r', '🔴 Menos de 7 dias · data apertada', 'var(--crit)', r => r.faltam < 7], ['a', '🟡 De 7 a 9 dias', '#9A6B00', r => r.faltam >= 7 && r.faltam < 10], ['v', '🟢 10 dias ou mais · validade boa', '#1E7A44', r => r.faltam >= 10]];
    const mostra = k => !so || so === k || (so === 'ra' && k !== 'v');
    const conta = fx.map(([k, , , f]) => L.filter(f));
    box.innerHTML = `<div class="kpis num">${fx.map(([k, t, cor], i) => `<div class="kpi"><b style="color:${cor}">${grupo(conta[i]).length}</b><span>${k === 'r' ? 'Produtos com menos de 7 dias' : k === 'a' ? 'Produtos com 7 a 9 dias' : 'Produtos com 10 dias ou mais'}</span></div>`).join('')}</div>
      ${fx.map(([k, t, cor], i) => mostra(k) ? `<div class="card stack" style="border-left:5px solid ${cor}"><h3 style="color:${cor}">${t}</h3>${lista(grupo(conta[i]).map(([p, rs]) => { const q = rs.reduce((s, r) => s + (+r.x.qtd || 0), 0); return produtoPV(`${h(p)} <span class="muted pv-seta">›</span>`, [`${rs.length} loja${rs.length > 1 ? 's' : ''}${k !== 'v' && q ? ` · <b style="color:${cor}">${q} un a vender</b>` : ''} · mais próxima ${dataBR(rs.map(r => r.x.val).sort()[0]).slice(0, 5)}`], cor, p, 'val', k); }), 'Nenhum produto nesta faixa.')}</div>` : '').join('')}
      <div class="muted" style="font-size:12.5px">Toque no produto para abrir as lojas daquela faixa logo abaixo; toque no cliente para ver o endereço, com a validade e a quantidade a vender.</div>`;
  } else if (VAL.aba === 'pq') {
    // só preço: produto → lojas com o preço
    const L = filtraPV((VAL.todos || []).filter(r => !r.x.falta && typeof r.x.preco === 'number'));
    const G = grupo(L);
    box.innerHTML = `<div class="kpis num"><div class="kpi"><b>${G.length}</b><span>Produtos com preço</span></div><div class="kpi"><b>${L.length}</b><span>Preços lançados</span></div><div class="kpi"><b>${new Set(L.map(r => r.v.lojaId)).size}</b><span>Lojas pesquisadas</span></div></div>
      <div class="card stack"><h3>💲 Preço de ponta por produto</h3>${lista(G.map(([p, rs]) => { const pr = rs.map(r => r.x.preco); const mn = Math.min(...pr), mx = Math.max(...pr);
        return produtoPV(`${h(p)} <span class="muted pv-seta">›</span>`, [`<span class="pv-dest2">${pr.length > 1 && mn !== mx ? `<b style="color:#1E7A44">${brl(mn)}</b> a <b style="color:var(--crit)">${brl(mx)}</b>` : `<b>${brl(mn)}</b>`}</span> · média <b>${brl(pr.reduce((s, x) => s + x, 0) / pr.length)}</b> · ${rs.length} loja${rs.length > 1 ? 's' : ''}`], '#F4BC1C', p, 'pq'); }), 'Nenhum preço lançado com esses filtros.')}</div>
      <div class="muted" style="font-size:12.5px">Toque no produto para abrir o preço em cada loja (menor preço em verde, maior em vermelho).</div>`;
  } else {
    // ruptura: produto → lojas visitadas sem o produto
    const L = filtraPV((VAL.todos || []).filter(r => r.x.falta)); const G = grupo(L);
    const nLojas = new Set(filtraPV(VAL.todos || []).map(r => r.v.lojaId)).size;
    box.innerHTML = `<div class="kpis num"><div class="kpi"><b style="color:var(--crit)">${G.length}</b><span>Produtos com ruptura</span></div><div class="kpi"><b style="color:var(--crit)">${L.length}</b><span>Rupturas (loja × produto)</span></div><div class="kpi"><b>${new Set(L.map(r => r.v.lojaId)).size}</b><span>Lojas com alguma ruptura</span></div></div>
      <div class="card stack" style="border-left:5px solid var(--crit)"><h3 style="color:var(--crit)">🚫 Produtos em ruptura</h3>${lista(G.map(([p, rs]) => produtoPV(`${h(p)} <span class="muted pv-seta">›</span>`, [`<b style="color:var(--crit)">${rs.length} loja${rs.length > 1 ? 's' : ''} em ruptura</b>${nLojas ? ` · ${Math.round(rs.length / nLojas * 100)}% das lojas pesquisadas` : ''} · última ${dataBR(rs.map(r => r.d).sort().pop()).slice(0, 5)}`], 'var(--crit)', p, 'rup')), 'Nenhuma ruptura com esses filtros.')}</div>
      <div class="muted" style="font-size:12.5px">Toque no produto para abrir as lojas visitadas que estão sem ele na gôndola; toque no cliente para ver o endereço.</div>`;
  }
  ligaPV(box); ligaCsv();
}
function ligaPV(box) { box.classList.add('pv-big'); box.querySelectorAll('details.pv-prodbox').forEach(d => d.addEventListener('toggle', () => { if (d.open && !d.dataset.ok) { d.dataset.ok = '1'; d.querySelector('.pv-corpo').innerHTML = lojasProdutoHTML(d.dataset.p, d.dataset.modo, d.dataset.fx); } })); }
function ligaCsv() {
  const T = VAL.todos || [];
  $('#vl-csv').onclick = () => {
    const pv = VAL.aba === 'val';
    let L = pv ? filtraPV((VAL.cache || []).concat(VAL.verdes || [])) : filtraPV(T.filter(r => r.x.falta || typeof r.x.preco === 'number'));
    const linhas = [pv ? ['Faixa', 'Validade', 'Dias', 'Qtd a vender', 'Produto', 'Cód. loja', 'Loja', 'Cidade', 'Promotor', 'Visto em'] : ['Cód. loja', 'Loja', 'Cidade', 'Produto', 'Preço', 'Ruptura', 'Validade', 'Qtd', 'Promotor', 'Data']]
      .concat(L.map(r => { const lj = lojaDe(r); return pv ? [r.faltam < 7 ? 'VERMELHO' : r.faltam < 10 ? 'AMARELO' : 'VERDE', dataBR(r.x.val), r.faltam, r.x.qtd || '', r.produto, lj.cod, lj.nome, lj.cid, promNome(r.v.promotorId), dataBR(r.d)]
        : [lj.cod, lj.nome, lj.cid, r.produto, r.x.falta ? '' : String(r.x.preco).replace('.', ','), r.x.falta ? 'SIM' : '', r.x.val ? dataBR(r.x.val) : '', r.x.qtd || '', promNome(r.v.promotorId), dataBR(r.d)]; }));
    const txt = '﻿' + linhas.map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = `${pv ? 'Validades' : 'Pesquisa de preco'} ${dataHoje()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
}
function csvMes(RS, nomeMes) {
  const L = [['Promotor', 'Data', 'Dia', 'Início', 'Fim', 'Trabalhado (h)', 'Em loja (h)', 'Deslocamento (h)', 'Previsto (h)', 'Saldo (h)', 'Visitas feitas', 'Programadas', 'Não visitadas', 'Sem registro', 'Fora da rota', 'Alertas', 'Observação']];
  const hh = m => (m / 60).toFixed(2).replace('.', ',');
  RS.forEach(r => r.dias.forEach(x => { const J = x.J; L.push([promNome(r.pid), x.d.split('-').reverse().join('/'), DIAS[J.wd], J.tem ? hm(J.inicio) : '', J.tem && !J.andamento ? hm(J.fim) : '', J.tem ? hh(J.trabalhado) : '', J.tem ? hh(J.loja) : '', J.tem ? hh(J.desl) : '', hh(J.esperado), J.tem && !J.andamento ? hh(J.saldo) : '', x.feitas, x.lojas, x.nao, x.sem.length, x.fora, x.al, (x.falta ? 'Sem jornada com rota. ' : '') + (J.fimEst ? 'Sem check-out na última loja.' : '') + (J.andamento ? 'Em andamento.' : '')]); }));
  const txt = '﻿' + L.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = `Jornada e visitas ${P.mes}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const abreDetalhe = pid => { P.sel = pid; window.scrollTo(0, 0); renderPainel(); };
function statusTexto(d) {
  if (d.J.almocoAberto) return `<span class="pill" style="background:#E8F1FD;color:#1d4f91">Almoço desde ${hm(d.J.almocoIni)}</span>`;
  return d.agora ? `<span class="pill live">Em loja: ${h(d.agora.nome)} desde ${hm(d.agora.v.checkin)}</span>`
    : d.ultima ? `<span class="muted">Saiu de ${h(d.ultima.nome)} às ${hm(d.ultima.v.checkout)}</span>`
    : d.paradas.some(x => x.v) ? '<span class="muted">Iniciou o dia</span>' : `<span class="muted">${P.data === ymd(new Date()) ? 'Ainda não começou' : 'Sem visitas registradas'}</span>`;
}
// Última posição conhecida do promotor no dia (check-in, check-out ou registro de não visita)
function ultimaPosicao(d) {
  let best = null;
  d.paradas.forEach(x => { const v = x.v; if (!v) return;
    if (v.gpsIn && (v.checkin || v.registrado)) { const t = v.checkin || v.registrado; if (!best || t > best.t) best = { t, p: [v.gpsIn.lat, v.gpsIn.lng], x, tipo: v.status === 'nao_visitada' ? 'nao' : v.status === 'em_loja' ? 'em' : 'in' }; }
    if (v.gpsOut && v.checkout && (!best || v.checkout > best.t)) best = { t: v.checkout, p: [v.gpsOut.lat, v.gpsOut.lng], x, tipo: 'out' }; });
  return best;
}
// mapa (fica montado; a cada atualização só troca as marcações)
function tiraMapa() { if (P.mapa) { P.mapa.remove(); P.mapa = null; P.mapaChave = ''; } }
function garanteMapa(chave) {
  const el = $('#mapa'); if (!el || !window.L) return null;
  if (P.mapa && P.mapaChave === chave && P.mapa.getContainer() === el) { P.camada.clearLayers(); P.mapa.invalidateSize(); return P.mapa; }
  tiraMapa();
  P.mapa = L.map(el, { scrollWheelZoom: false }).setView([-22.5, -44.1], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(P.mapa);
  P.camada = L.layerGroup().addTo(P.mapa); P.mapaChave = chave; P.ajustar = true;
  setTimeout(() => P.mapa && P.mapa.invalidateSize(), 60);
  return P.mapa;
}
function enquadra(pts) { if (P.ajustar && pts.length) { P.mapa.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); P.ajustar = false; } }
// Ponto da loja no mapa: exato (check-in/manual) ou aproximado (pelo endereço). O raio do check-in usa só o exato.
// check-in fora da loja: passou do limite gravado na visita (150 m com local exato; folga maior com local aproximado)
// alerta ainda não tratado pela gestão (rosto diferente ou check-in fora da loja)
const temAlerta = v => !!v && (v.rostoOk === false || v.rostoOutOk === false || foraLoja(v) || foraSaida(v));
const alertaAberto = v => temAlerta(v) && !v.alertaTratado;
const foraLoja = v => !!v && v.distIn != null && v.distIn > (v.limite || S.raio);
const foraSaida = v => !!v && v.distOut != null && (v.foraRaioOut != null ? v.foraRaioOut : v.distOut > (v.limiteOut || v.limite || S.raio));
const pontoLoja = l => l && l.lat != null ? [+l.lat, +l.lng] : l && l.latAprox != null ? [+l.latAprox, +l.lngAprox] : null;
const G = { rodando: false };
async function geocodifica(l) {
  const base = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=';
  const tentativas = [[l.endereco, l.bairro, l.municipio, l.uf], [l.bairro, l.municipio, l.uf], [l.cidade, l.uf || 'RJ']].map(x => x.filter(Boolean).join(', ')).filter((x, i, a) => x && a.indexOf(x) === i);
  for (let i = 0; i < tentativas.length; i++) {
    const r = await fetch(base + encodeURIComponent(tentativas[i] + ', Brasil') + '&accept-language=pt-BR').then(r => r.ok ? r.json() : []).catch(() => []);
    if (r && r[0]) return { latAprox: +(+r[0].lat).toFixed(6), lngAprox: +(+r[0].lon).toFixed(6), aproxNivel: ['rua', 'bairro', 'cidade'][Math.min(i, 2)] };
    await new Promise(res => setTimeout(res, 1100));
  }
  return null;
}
// Lojas: primeiro procura a própria loja no mapa (nome + bairro + cidade); depois a rua; depois o bairro. Só aceita resultado na cidade certa.
async function geocodificaLoja(l) {
  const sa = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mun = l.municipio || l.cidade || ''; if (!mun) return geocodifica(l);
  const q = async params => { const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&limit=8&addressdetails=1&accept-language=pt-BR&' + new URLSearchParams(params)).then(r => r.ok ? r.json() : []).catch(() => []); await new Promise(x => setTimeout(x, 1150)); return r || []; };
  const naCidade = x => { const ad = x.address || {}; return [ad.city, ad.town, ad.municipality, ad.village].some(c => sa(c) === sa(mun)); };
  const marca = String(l.nome || '').replace(/SUPERMERCADOS?|ATACADISTA|LTDA|S\/A|COMERCIO E INDUSTRIA/gi, '').trim();
  const tok = sa(marca).split(/\s+/).filter(t => t.length > 2);
  const ok = (x, nivel) => ({ latAprox: +(+x.lat).toFixed(6), lngAprox: +(+x.lon).toFixed(6), aproxNivel: nivel, aproxRef: 'OpenStreetMap: ' + String(x.display_name).slice(0, 80) });
  if (tok.length) {
    const c = (await q({ q: `${marca}, ${l.bairro || ''}, ${mun}, RJ` })).filter(x => ['shop', 'amenity'].includes(x.category) && !['parking', 'fuel', 'bank', 'atm'].includes(x.type) && naCidade(x) && tok.some(t => sa(x.name || x.display_name).includes(t)));
    if (c.length === 1) return ok(c[0], 'loja');
  }
  if (l.endereco) { const x = (await q({ street: String(l.endereco).replace(/\s*-\s*(DE|ATE|ATÉ).*$/i, ''), city: mun, state: 'Rio de Janeiro' })).find(naCidade); if (x) return ok(x, 'rua'); }
  if (l.bairro) { const x = (await q({ q: `${l.bairro}, ${mun}, RJ` })).find(naCidade); if (x) return ok(x, 'bairro'); }
  return null;
}
// Localiza a residência do promotor (para o deslocamento casa → primeira loja)
async function localizaCasa(p) {
  if (!p.endereco && !p.cidadeRes) { await updateDoc(doc(db, 'promotores', p.id), { casa: deleteField() }).catch(() => {}); return null; }
  const partes = String(p.endereco || '').split(',').map(x => x.trim()).filter(Boolean);
  const rua = partes[0] || '', num = /^\d+/.test(partes[1] || '') ? partes[1].match(/^\d+/)[0] : '';
  const bairro = partes.length > 1 && !/^\d/.test(partes[partes.length - 1]) ? partes[partes.length - 1].replace(/\(.*\)/, '').trim() : '';
  const g = await geocodifica({ endereco: [rua, num].filter(Boolean).join(', '), bairro, municipio: p.cidadeRes, uf: p.ufRes || 'RJ', cidade: [p.cepRes, p.cidadeRes].filter(Boolean).join(' ') });
  const casa = g ? { lat: g.latAprox, lng: g.lngAprox, nivel: g.aproxNivel, em: Date.now() } : null;
  await updateDoc(doc(db, 'promotores', p.id), { casa: casa || deleteField() }).catch(() => {});
  return casa;
}
// Localiza as lojas sem ponto (1 por segundo, regra do serviço gratuito de mapas)
async function localizaLojas(lista, aviso, silencioso) {
  if (G.rodando) return silencioso ? null : toast('Já estou localizando as lojas. Aguarde.');
  const falta = lista.filter(l => !pontoLoja(l) && (((l.endereco || l.bairro) && l.municipio) || l.cidade));
  if (!falta.length) return silencioso ? null : toast('Todas essas lojas já estão no mapa.');
  G.rodando = true; let ok = 0;
  try {
    for (let i = 0; i < falta.length; i++) {
      if (aviso) aviso(`Localizando loja ${i + 1} de ${falta.length}…`);
      const g = await geocodificaLoja(falta[i]);
      if (g) { ok++; await updateDoc(doc(db, 'lojas', falta[i].id), Object.assign(g, { aproxEm: Date.now() })).catch(() => {}); }
    }
  } finally { G.rodando = false; P.ajustar = true; if (S.tab === 'painel') renderPainel(); }
  if (aviso) aviso(''); if (!silencioso || ok) toast(`${ok} de ${falta.length} ${silencioso ? 'cliente(s) novo(s) da rota localizado(s) no mapa' : 'lojas localizadas pelo endereço'}.${ok < falta.length ? ' As demais ganham o ponto no primeiro check-in.' : ''}`, 6000);
}
function mapaGeral(dias) {
  if (!window.L) { setTimeout(() => { if (!P.sel && S.tab === 'painel') mapaGeral(dias); }, 400); return; }
  const m = garanteMapa('geral|' + P.data); if (!m) return;
  const pts = [], sem = [], planejados = [];
  const verRotas = lsGet('np.p.rotas') !== '0';
  dias.forEach(d => {
    const cor = corDe(d.pid);
    if (verRotas) {
      const rota = d.paradas.filter(x => !x.extra).map(x => ({ x, p: pontoLoja(S.lojas.find(l => l.id === x.lojaId)) })).filter(y => y.p);
      if (rota.length > 1) L.polyline(rota.map(y => y.p), { color: cor, weight: 2, opacity: .45, dashArray: '5 7' }).addTo(P.camada);
      rota.forEach(y => { planejados.push(y.p); const v = y.x.v; L.circleMarker(y.p, { radius: 5, color: cor, weight: 2, fillColor: v && v.status === 'concluida' ? '#27AE60' : '#fff', fillOpacity: 1 }).bindTooltip(`${h(nomeCurto(d.pid))} · ${y.x.ordem}ª ${h(y.x.nome)}${v ? (v.status === 'concluida' ? ' · ' + hm(v.checkin) + '–' + hm(v.checkout) : v.status === 'em_loja' ? ' · em loja' : ' · não visitada') : ' · pendente'}`).addTo(P.camada); });
    }
    const trilha = d.paradas.filter(x => x.v && x.v.gpsIn && x.v.status !== 'nao_visitada').sort((a, b) => a.v.checkin - b.v.checkin).map(x => [x.v.gpsIn.lat, x.v.gpsIn.lng]);
    if (trilha.length > 1) L.polyline(trilha, { color: cor, weight: 3, opacity: .55 }).addTo(P.camada);
    const u = ultimaPosicao(d); if (!u) { sem.push(nomeCurto(d.pid)); return; }
    pts.push(u.p);
    const r = S.rostos[d.pid]; const anel = u.tipo === 'em' ? '#F2994A' : u.tipo === 'nao' ? '#999' : '#27AE60';
    const dentro = r && r.foto ? `<img src="${r.foto}" alt="">` : `<span style="background:${cor}">${h(iniciais(promNome(d.pid)))}</span>`;
    const quando = u.tipo === 'em' ? `Em loja: <b>${h(u.x.nome)}</b><br>check-in às ${hm(u.t)}` : u.tipo === 'out' ? `Saiu de <b>${h(u.x.nome)}</b> às ${hm(u.t)}` : u.tipo === 'nao' ? `Registrou não visita em <b>${h(u.x.nome)}</b> às ${hm(u.t)}` : `Check-in em <b>${h(u.x.nome)}</b> às ${hm(u.t)}`;
    L.marker(u.p, { icon: L.divIcon({ className: '', html: `<div class="pin-p ${u.tipo === 'em' ? 'vivo' : ''}" style="--anel:${anel}">${dentro}<b>${h(nomeCurto(d.pid).split(' ')[0])}</b></div>`, iconSize: [44, 58], iconAnchor: [22, 22] }) })
      .bindTooltip(`<b>${h(nomeCurto(d.pid))}</b><br>${quando}<br>${d.feitas} de ${d.programadas} visitas`, { direction: 'top', offset: [0, -20] })
      .on('click', () => abreDetalhe(d.pid)).addTo(P.camada);
  });
  enquadra(pts.length ? pts.concat(planejados) : planejados);
  $('#p-semgps').textContent = sem.length ? 'Sem posição no dia: ' + sem.join(', ') + '.' : 'Foto do promotor na última posição registrada (anel laranja = em loja agora). Passe o mouse para ver os detalhes e clique para abrir o promotor.';
}
function renderDetalhe(d) {
  const box = $('#p-corpo');
  const conectores = conexoesDia(d);
  const linhas = d.paradas.map((x, ix) => (conectores[ix] || '') + (() => {
    const v = x.v; const st = !v ? '<span class="pill pend">Pendente</span>' : v.status === 'concluida' ? '<span class="pill ok">Concluída</span>' : v.status === 'nao_visitada' ? `<span class="pill no">Não visitada</span>` : '<span class="pill live">Em loja</span>';
    const al = !v || v.status === 'nao_visitada' ? (v ? `<span class="muted" style="font-size:12px">${h(v.motivo)}</span>` : '') :
      [v.rostoOk === false ? '<span class="tag no">rosto ≠ cadastro</span>' : '', v.semCoord ? '<span class="tag y" title="loja sem local exato cadastrado">sem local</span>' : v.distIn != null ? `<span class="tag ${foraLoja(v) ? 'no' : ''}">${foraLoja(v) ? '⚠️ fora da loja · ' : ''}${v.distIn} m${v.localAprox ? ' (aprox.)' : ''}</span>` : ''].join(' ');
    const cls = !v ? 'pend' : v.status === 'concluida' ? 'ok' : v.status === 'nao_visitada' ? 'no' : 'live';
    return `<button class="parada ${cls}" data-v="${h(x.id)}"><span class="pa-n">${x.extra ? '+' : x.ordem}</span>
      <span class="pa-t"><b>${h(x.nome)}</b><span class="muted">${h(x.codigo || '')}${x.bairro ? ' · ' + h(x.bairro) : ''}${x.extra ? ' · fora da rota' : ''}</span>${al.trim() ? `<span class="pa-c">${al}</span>` : ''}</span>
      <span class="pa-s">${st}<span class="num muted">${v && v.checkin ? hm(v.checkin) + '–' + (v.checkout ? hm(v.checkout) : '…') + (v.checkout ? ' · ' + dur(v.checkin, v.checkout) : '') : ''}</span>${v && v.status !== 'nao_visitada' ? '<span class="pa-f">📷 fotos e preços ›</span>' : ''}</span></button>`;
  })()).join('');
  if (box.dataset.modo !== 'det') {
    box.dataset.modo = 'det'; tiraMapa();
    box.innerHTML = `<div class="stack"><div id="p-dhead"></div><div id="p-daviso"></div><div id="p-dest"></div>
      <div class="card stack" style="padding:10px;gap:0"><div class="spread" style="padding:2px 4px 8px"><h3 style="margin:0">Lojas do dia</h3><span class="muted" style="font-size:12px">toque na loja para ver fotos e preços</span></div><div id="p-dtab" class="paradas"></div></div>
      <div id="p-ddesl" class="desl"></div>
      <div class="stack" style="gap:6px"><h3 style="margin:4px 0 0">Mapa da rota</h3><div id="mapa" class="mapa-det"></div><div class="row" style="gap:8px;font-size:12px" id="p-dgeo"></div></div>
      <div class="muted" style="font-size:12px">Mapa: números = ordem da rota do dia (verde concluída, laranja em loja, branco pendente, vermelho não visitada ou com alerta); tracejado = rota planejada; linha verde = caminho feito pelos check-ins (pontinhos). Lojas com ponto aproximado (pelo endereço) aparecem com borda tracejada. Clique numa loja da lista para ver fotos e GPS.</div></div>`;
  }
  $('#p-dhead').innerHTML = `<div class="spread" style="flex-wrap:wrap;gap:10px"><div class="row" style="gap:12px;flex-wrap:nowrap;min-width:0;max-width:100%"><button class="btn sm" id="p-volta">‹ Todos</button>${avatar(d.pid, 52)}<div style="min-width:0"><h3 style="font-size:20px;margin:0">${h(promNome(d.pid))}</h3>
      <div class="muted num" style="font-size:13px">${d.feitas} de ${d.programadas} visitas${d.extras ? ` · +${d.extras} fora da rota` : ''} · início ${hm(d.primeira)} · última saída ${hm(d.ultimaSaida)} · ${d.tempo ? dur(1, 1 + d.tempo) : '0 min'} em loja</div><div style="font-size:13px;margin-top:2px">${statusTexto(d)}</div><div class="muted num" style="font-size:13px;margin-top:2px">${jornadaTxt(d.J)}${d.J.tem && d.J.almocoMarcado ? ` · almoço ${hm(d.J.almocoIni)}–${d.J.almocoFim ? hm(d.J.almocoFim) : 'agora'} (${hmin(((d.J.almocoFim || Date.now()) - d.J.almocoIni) / 60000)})${d.J.almocoFim && (d.J.almocoFim - d.J.almocoIni) < 3600000 && d.J.bruto > 360 ? ' <span style="color:var(--crit)">menos de 1h</span>' : ''}` : d.J.tem && d.J.almoco ? ' · almoço não marcado: 1h descontada' : ''}${d.J.fimEst ? ' · * ficou sem check-out na última loja; contado até a última entrada' : ''}</div></div></div>
      <select id="p-outro" style="width:auto">${S.promotores.filter(p => p.ativo !== false).map(p => `<option value="${h(p.id)}" ${p.id === d.pid ? 'selected' : ''}>${h(p.nome)}</option>`).join('')}</select></div>`;
  $('#p-dest').innerHTML = estrada(d);
  { const hoje = P.data === ymd(new Date()); const a = $('#p-daviso');
    a.innerHTML = hoje && d.programadas && !d.primeira && !(d.nao) ? `<div class="note warn"><b>⏰ Ainda não iniciou a rota</b> · nenhum check-in até ${hm(Date.now())}${d.J.atencao ? '' : ` (início previsto ${regrasJornada(S.empresa).inicioPrevisto})`}.</div>`
      : d.J.atencao ? `<div class="note warn"><b>⚠ ${h(d.J.atencao)}</b></div>` : ''; }
  $('#p-dtab').innerHTML = linhas; preencheConexoes();
  $('#p-volta').onclick = () => { P.sel = ''; renderPainel(); };
  $('#p-outro').onchange = e => { P.sel = e.target.value; renderPainel(); };
  $('#p-dtab').querySelectorAll('[data-v]').forEach(b => b.onclick = () => abreParada(d, b.dataset.v));
  desenhaMapa(d);
}
// Deslocamento casa → primeira loja e última loja → casa (rota de carro pelo OSRM; se falhar, estimativa em linha reta)
const ROTAS = {};
async function trajeto(a, b) {
  const k = a.map(x => x.toFixed(4)).join(',') + ';' + b.map(x => x.toFixed(4)).join(',');
  if (ROTAS[k]) return ROTAS[k];
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false`).then(r => r.json());
    if (r.routes && r.routes[0]) return ROTAS[k] = { km: r.routes[0].distance / 1000, min: r.routes[0].duration / 60, est: false };
  } catch (e) {}
  const km = distancia({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) / 1000 * 1.3;
  return ROTAS[k] = { km, min: km / 40 * 60, est: true };
}
const kmTxt = t => `${t.km.toFixed(1).replace('.', ',')} km · ~${Math.round(t.min)} min${t.est ? ' (estimado)' : ''}`;
// Deslocamento entre as lojas do dia (na lista do detalhe): tempo real (saída → chegada) e distância
function conexoesDia(d) {
  const out = {}; const ps = d.paradas;
  const visit = ps.filter(x => x.v && x.v.checkin && x.v.status !== 'nao_visitada');
  ps.forEach((x, ix) => {
    if (ix === 0 && !x.v) return;
    let de = null, real = null;
    if (x.v && x.v.checkin && x.v.status !== 'nao_visitada') { // veio da visita anterior no tempo
      de = visit.filter(y => y !== x && y.v.checkout && y.v.checkout <= x.v.checkin).sort((a, b) => b.v.checkout - a.v.checkout)[0];
      if (de) real = Math.round((x.v.checkin - de.v.checkout) / 60000);
      else return; // primeira loja do dia: o trajeto de casa aparece no quadro de deslocamento
    } else de = ps[ix - 1];
    if (!de) return;
    const pa = de.v && de.v.gpsOut ? [de.v.gpsOut.lat, de.v.gpsOut.lng] : de.v && de.v.gpsIn ? [de.v.gpsIn.lat, de.v.gpsIn.lng] : pontoLoja(S.lojas.find(l => l.id === de.lojaId) || {});
    const pb = x.v && x.v.gpsIn ? [x.v.gpsIn.lat, x.v.gpsIn.lng] : pontoLoja(S.lojas.find(l => l.id === x.lojaId) || {});
    const alvo = pa && pb ? `data-cx="${pa.join(',')};${pb.join(',')}"` : '';
    const lento = real != null && real > 60;
    out[ix] = `<div class="conx${lento ? ' lento' : ''}" ${alvo}><span class="cx-l">🚌</span><span>${real != null ? `<b>${hmin(real)}</b> de deslocamento · saiu da ${h(de.nome)} às ${hm(de.v.checkout)}, chegou às ${hm(x.v.checkin)}` : `próxima loja · vindo da ${h(de.nome)}`}<span class="cx-km muted">${alvo ? ' · calculando distância…' : ''}</span></span></div>`;
  });
  return out;
}
async function preencheConexoes() {
  for (const el of document.querySelectorAll('#p-dtab .conx[data-cx]')) {
    const [a, b] = el.dataset.cx.split(';').map(t => t.split(',').map(Number));
    const t = await trajeto(a, b); const k = el.querySelector('.cx-km'); if (!k) continue;
    k.textContent = ` · ${t.km.toFixed(1).replace('.', ',')} km${t.est ? ' (estimado)' : ''} · ~${Math.round(t.min)} min de carro`;
  }
}
async function deslocamento(d) {
  const el = $('#p-ddesl'); if (!el) return;
  const p = S.promotores.find(x => x.id === d.pid) || {};
  if (!p.casa) { el.innerHTML = `<span class="muted">🏠 ${p.endereco ? 'Casa ainda não localizada no mapa: abra a ficha em Equipe e salve.' : 'Sem endereço residencial na ficha (Equipe e acessos).'}</span>`; return; }
  const casa = [p.casa.lat, p.casa.lng];
  const ponto = x => x.v && x.v.gpsIn ? [x.v.gpsIn.lat, x.v.gpsIn.lng] : pontoLoja(S.lojas.find(l => l.id === x.lojaId));
  const feitos = d.paradas.filter(x => x.v && x.v.checkin).sort((a, b) => a.v.checkin - b.v.checkin);
  const plano = d.paradas.filter(x => !x.extra);
  const prim = feitos[0] || plano[0];
  const fechou = d.J.tem && !d.J.andamento && !d.J.hojeAberto && feitos.some(x => x.v.checkout);
  const ult = fechou ? feitos.filter(x => x.v.checkout).sort((a, b) => b.v.checkout - a.v.checkout)[0] : plano[plano.length - 1];
  const pa = prim && ponto(prim), pu = ult && ponto(ult);
  el.innerHTML = '<span class="muted">🏠 Calculando deslocamento…</span>';
  const ida = pa ? await trajeto(casa, pa) : null, volta = pu ? await trajeto(pu, casa) : null;
  if (!$('#p-ddesl') || P.sel !== d.pid) return;
  const saida = ida && feitos[0] ? feitos[0].v.checkin - ida.min * 60000 : null;
  el.innerHTML = `🏠 <b>Casa → ${feitos[0] ? '1ª loja visitada' : '1ª loja da rota'}</b>${prim ? ' (' + h(prim.nome) + ')' : ''}: ${ida ? kmTxt(ida) : 'sem ponto da loja'}${saida ? ` · chegou ${hm(feitos[0].v.checkin)}, saída de casa estimada ${hm(saida)}` : ''}
    &nbsp;|&nbsp; <b>${fechou ? 'Última loja' : 'Última loja da rota'} → casa</b>${ult ? ' (' + h(ult.nome) + ')' : ''}: ${volta ? kmTxt(volta) : 'sem ponto da loja'}${fechou && volta ? ` · saiu ${hm(ult.v.checkout)}, chegada em casa estimada ${hm(ult.v.checkout + volta.min * 60000)}` : ''}`;
  if (P.mapa && P.mapaChave === 'det|' + d.pid + '|' + P.data) {
    L.marker(casa, { zIndexOffset: 800, icon: L.divIcon({ className: '', html: '<div class="mk casa">🏠</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindPopup(`<b>Casa de ${h(nomeCurto(d.pid))}</b><br>${h(p.endereco || '')}, ${h(p.cidadeRes || '')}`).addTo(P.camada);
    if (pa) L.polyline([casa, pa], { color: '#2F80ED', weight: 3, opacity: .7, dashArray: '2 8' }).addTo(P.camada);
    if (pu) L.polyline([pu, casa], { color: '#9B51E0', weight: 3, opacity: .6, dashArray: '2 8' }).addTo(P.camada);
  }
}
function desenhaMapa(d) {
  if (!window.L) { setTimeout(() => { if (P.sel === d.pid) desenhaMapa(d); }, 400); return; }
  const m = garanteMapa('det|' + d.pid + '|' + P.data); if (!m) return;
  const pts = [];
  // rota planejada: lojas na ordem do dia
  const rota = d.paradas.map(x => { const l = S.lojas.find(y => y.id === x.lojaId); return { x, l, p: pontoLoja(l), aprox: l && l.lat == null }; }).filter(y => y.p);
  const plan = rota.filter(y => !y.x.extra);
  if (plan.length > 1) L.polyline(plan.map(y => y.p), { color: '#5C6070', weight: 3, opacity: .7, dashArray: '8 8' }).addTo(P.camada);
  // caminho feito: GPS dos check-ins em ordem de horário
  const feitos = d.paradas.filter(x => x.v && x.v.gpsIn).sort((a, b) => (a.v.checkin || a.v.registrado || 0) - (b.v.checkin || b.v.registrado || 0));
  if (feitos.length > 1) L.polyline(feitos.map(x => [x.v.gpsIn.lat, x.v.gpsIn.lng]), { color: '#27AE60', weight: 5, opacity: .85 }).addTo(P.camada);
  feitos.forEach(x => { const v = x.v; const p = [v.gpsIn.lat, v.gpsIn.lng]; pts.push(p);
    L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#27AE60', fillOpacity: 1 }).bindTooltip(`GPS do check-in · ${h(x.nome)} · ${hm(v.checkin || v.registrado)}${v.distIn != null ? ' · ' + v.distIn + ' m da loja' : ''}`).addTo(P.camada); });
  rota.forEach(y => {
    const v = y.x.v; pts.push(y.p);
    const cor = !v ? '#fff' : v.status === 'nao_visitada' ? '#EB5757' : v.status === 'em_loja' ? '#F2994A' : alertaAberto(v) ? '#EB5757' : '#27AE60';
    const txt = !v ? '#171925' : '#fff';
    L.marker(y.p, { zIndexOffset: 500, icon: L.divIcon({ className: '', html: `<div class="mk${y.aprox ? ' aprox' : ''}" style="background:${cor};color:${txt}">${y.x.extra ? '+' : y.x.ordem}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
      .bindTooltip(`<b>${y.x.extra ? 'Fora da rota' : y.x.ordem + 'ª parada'} · ${h(y.x.nome)}</b><br>${!v ? 'Pendente' : v.status === 'nao_visitada' ? 'Não visitada: ' + h(v.motivo) : 'Chegou ' + hm(v.checkin) + (v.checkout ? ' · saiu ' + hm(v.checkout) : ' · em loja')}${y.aprox ? '<br><i>ponto aproximado pelo endereço</i>' : ''}<br><i>toque para ver fotos e preços</i>`, { direction: 'top', offset: [0, -12] })
      .on('click', () => abreParada(d, y.x.id)).addTo(P.camada);
  });
  const pc = (S.promotores.find(x => x.id === d.pid) || {}).casa; if (pc) pts.push([pc.lat, pc.lng]);
  enquadra(pts); deslocamento(d);
  const sem = d.paradas.filter(x => !x.extra).map(x => S.lojas.find(l => l.id === x.lojaId)).filter(l => l && !pontoLoja(l));
  const el = $('#p-dgeo');
  if (el && !G.rodando) el.innerHTML = sem.length ? `<span class="muted">${sem.length} de ${d.programadas} lojas sem ponto no mapa.</span><button class="btn sm" id="p-dgeo-b">Localizar pelo endereço</button>` : '';
  const gb = $('#p-dgeo-b'); if (gb) gb.onclick = () => localizaLojas(sem, t => { const e = $('#p-dgeo'); if (e) e.innerHTML = t ? `<span class="muted">${t}</span>` : ''; });
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
// Grava o GPS do check-in como local exato da loja e encerra o alerta de "fora da loja" da visita como conferido
async function gravaLocalLoja(loja, v, date, id) {
  await updateDoc(doc(db, 'lojas', loja.id), { lat: v.gpsIn.lat, lng: v.gpsIn.lng, coordFonte: 'check-in ' + dataBR(date), atualizado: Date.now() });
  if (foraLoja(v) && !v.alertaTratado) {
    const t = { status: 'ok', obs: 'Local da loja corrigido com o GPS deste check-in', por: (auth.currentUser && auth.currentUser.email || '').split('@')[0], em: Date.now() };
    await updateDoc(doc(db, 'dias', date, 'visitas', id), { alertaTratado: t }); v.alertaTratado = t;
  }
}
// Quadros do alto da Torre: abrem a lista do que está por trás do número
function kpiValidade() {
  if (!VAL.todos) return '<b>…</b><span>Validades e pesquisa de preço ›</span>';
  const v = VAL.cache || []; const r = v.filter(x => x.faltam < 7).length, a = v.length - r, g = (VAL.verdes || []).length;
  return `<b><span style="color:var(--crit)">${r}</span><small> 🔴</small> <span style="color:#9A6B00">${a}</span><small> 🟡</small> <span style="color:#1E7A44">${g}</span><small> 🟢</small></b><span>Validades · ${VAL.todos.filter(x => typeof x.x.preco === 'number').length} preços pesquisados ›</span>`;
}
function irPara(tab) { const b = document.querySelector(`.side-item[data-go="${tab}"]`); if (b) b.click(); }
function kpiLista(k, dias) {
  const tit = { feitas: 'Visitas do dia', live: 'Promotores em loja agora', nao: 'Lojas não visitadas', al: 'Alertas (rosto ou GPS)', at: 'Atenção agora' }[k];
  const linha = (d, x, extra) => `<button class="parada ${!x.v ? 'pend' : x.v.status === 'concluida' ? 'ok' : x.v.status === 'nao_visitada' ? 'no' : 'live'}" data-kp="${h(d.pid)}" data-kv="${h(x.id)}"><span class="pa-n">${x.extra ? '+' : x.ordem}</span><span class="pa-t"><b>${h(x.nome)}</b><span class="muted">${h(nomeCurto(d.pid))}${x.bairro ? ' · ' + h(x.bairro) : ''}</span>${extra ? `<span class="pa-c">${extra}</span>` : ''}</span><span class="pa-s">${x.v && x.v.checkin ? `<span class="num muted">${hm(x.v.checkin)}–${x.v.checkout ? hm(x.v.checkout) : '…'}</span>` : ''}${x.v && x.v.status !== 'nao_visitada' ? '<span class="pa-f">📷 ver ›</span>' : ''}</span></button>`;
  let corpo = '';
  if (k === 'feitas') {
    const feitas = dias.flatMap(d => d.paradas.filter(x => x.v && x.v.status === 'concluida').map(x => [d, x]));
    const pend = dias.flatMap(d => d.paradas.filter(x => !x.extra && (!x.v || x.v.status === 'em_loja')).map(x => [d, x]));
    corpo = `<div class="label">Realizadas (${feitas.length})</div><div class="paradas">${feitas.map(([d, x]) => linha(d, x)).join('') || '<div class="muted">Nenhuma ainda.</div>'}</div>
      <div class="label" style="margin-top:10px">Pendentes (${pend.length})</div><div class="paradas">${pend.map(([d, x]) => linha(d, x, x.v ? '<span class="tag">em loja agora</span>' : '')).join('') || '<div class="muted">Nenhuma.</div>'}</div>`;
  } else if (k === 'live') {
    corpo = `<div class="paradas">${dias.filter(d => d.agora).map(d => linha(d, d.agora, `<span class="tag">desde ${hm(d.agora.v.checkin)} · ${dur(d.agora.v.checkin, Date.now())}</span>`)).join('') || '<div class="muted">Ninguém em loja agora.</div>'}</div>`;
  } else if (k === 'nao') {
    corpo = `<div class="paradas">${dias.flatMap(d => d.paradas.filter(x => x.v && x.v.status === 'nao_visitada').map(x => linha(d, x, `<span class="tag no">${h(x.v.motivo || 'sem motivo')}</span>${x.v.obs ? ' <span class="muted" style="font-size:12px">' + h(x.v.obs) + '</span>' : ''}`))).join('') || '<div class="muted">Nenhuma loja não visitada.</div>'}</div>`;
  } else if (k === 'al') {
    const tags = v => [v.rostoOk === false ? '<span class="tag no">rosto ≠ cadastro</span>' : '', foraSaida(v) ? `<span class="tag no">⚠️ saída fora da loja (${v.distOut} m)</span>` : '', v.rostoOutOk === false ? '<span class="tag no">rosto ≠ na saída</span>' : '', foraLoja(v) ? `<span class="tag no">⚠️ fora da loja · ${v.distIn} m</span>` : ''].join(' ');
    const todos = dias.flatMap(d => d.paradas.filter(x => temAlerta(x.v)).map(x => [d, x]));
    const ab = todos.filter(([, x]) => !x.v.alertaTratado), tr = todos.filter(([, x]) => x.v.alertaTratado);
    const acoes = (d, x) => S.leitura ? '' : `<div class="row" style="gap:6px;padding:0 4px 10px 44px;flex-wrap:wrap"><input type="text" placeholder="Observação (opcional): ex. falou com o gerente, GPS falhou…" data-ao="${h(x.id)}" style="flex:1 1 220px;font-size:13px;padding:6px 8px">${x.v.gpsIn ? `<a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${x.v.gpsIn.lat},${x.v.gpsIn.lng}">🗺 Ver GPS no mapa</a>` : ''}${foraLoja(x.v) && x.v.gpsIn ? `<button class="btn sm" data-at-loc="${h(x.id)}" title="O promotor estava na loja: o ponto cadastrado é que estava errado">📍 Corrigir local da loja</button>` : ''}<button class="btn sm" data-at-ok="${h(x.id)}">✓ Justificado</button><button class="btn sm danger" data-at-ir="${h(x.id)}">✗ Irregular</button></div>`;
    const res = x => { const t = x.v.alertaTratado; return `<span class="tag ${t.status === 'ok' ? 'ok' : 'no'}">${t.status === 'ok' ? '✓ justificado' : '✗ irregular'}</span>${t.obs ? ' <span class="muted" style="font-size:12px">' + h(t.obs) + '</span>' : ''} <span class="muted" style="font-size:11px">· ${h(t.por || '')} ${hm(t.em)}</span>`; };
    corpo = `<div class="label">Para validar (${ab.length})</div><div class="paradas">${ab.map(([d, x]) => linha(d, x, tags(x.v)) + acoes(d, x)).join('') || '<div class="muted" style="padding:6px 0">Nenhum alerta aberto. ✓</div>'}</div>
      ${tr.length ? `<div class="label" style="margin-top:10px">Encerrados (${tr.length})</div><div class="paradas">${tr.map(([d, x]) => linha(d, x, tags(x.v) + ' ' + res(x)) + (S.leitura ? '' : `<div style="padding:0 4px 8px 44px"><button class="btn sm ghost" data-at-re="${h(x.id)}">Reabrir</button></div>`)).join('')}</div>` : ''}`;
  } else {
    corpo = `<div class="paradas">${dias.filter(d => d.J.atencao).map(d => `<button class="parada pend" data-kprom="${h(d.pid)}"><span class="pa-n">!</span><span class="pa-t"><b>${h(promNome(d.pid))}</b><span class="muted">${h(d.J.atencao)}</span></span><span class="pa-s"><span class="pa-f">ver rota ›</span></span></button>`).join('') || '<div class="muted">Ninguém precisando de atenção agora.</div>'}</div>`;
  }
  abreModal(`<div class="spread"><h3>${tit} · ${dataBR(P.data)}</h3><button class="btn ghost" id="kl-x">Fechar</button></div><div style="max-height:70vh;overflow:auto">${corpo}</div>`);
  $('#kl-x').onclick = fechaModal;
  document.querySelectorAll('[data-kv]').forEach(b => b.onclick = () => { const d = dias.find(y => y.pid === b.dataset.kp); fechaModal(); setTimeout(() => abreParada(d, b.dataset.kv), 50); });
  const trata = async (id, valor) => {
    const x = dias.flatMap(d => d.paradas).find(y => y.id === id); if (!x || !x.v) return;
    const obs = (document.querySelector(`[data-ao="${id}"]`) || {}).value || '';
    const v = valor ? { status: valor, obs: obs.trim(), por: (auth.currentUser && auth.currentUser.email || '').split('@')[0], em: Date.now() } : deleteField();
    try { await updateDoc(doc(db, 'dias', P.data, 'visitas', id), { alertaTratado: v }); if (valor) x.v.alertaTratado = v; else delete x.v.alertaTratado; kpiLista('al', dias); toast(valor ? 'Ocorrência encerrada' : 'Ocorrência reaberta'); }
    catch (e) { toast(erroMsg(e)); }
  };
  document.querySelectorAll('[data-at-ok]').forEach(b => b.onclick = () => trata(b.dataset.atOk, 'ok'));
  document.querySelectorAll('[data-at-ir]').forEach(b => b.onclick = () => trata(b.dataset.atIr, 'irregular'));
  document.querySelectorAll('[data-at-loc]').forEach(b => b.onclick = async () => {
    const x = dias.flatMap(d => d.paradas).find(y => y.id === b.dataset.atLoc); const loja = x && S.lojas.find(l => l.id === x.lojaId); if (!loja) return;
    if (!(await confirma(`Gravar o GPS deste check-in (precisão ${x.v.gpsIn.prec || '?'} m) como local exato de ${loja.nome} e encerrar o alerta como conferido? Confira antes no mapa se o ponto está na loja.`, 'Corrigir e encerrar'))) return;
    try { await gravaLocalLoja(loja, x.v, P.data, x.id); toast('Local da loja corrigido e alerta encerrado'); kpiLista('al', dias); } catch (e) { toast(erroMsg(e)); }
  });
  document.querySelectorAll('[data-at-re]').forEach(b => b.onclick = () => trata(b.dataset.atRe, null));
  document.querySelectorAll('[data-kprom]').forEach(b => b.onclick = () => { fechaModal(); P.sel = b.dataset.kprom; renderPainel(); window.scrollTo(0, 0); });
}
// Toque numa loja do dia: com visita abre fotos/preços; sem visita mostra a loja e a última visita (até 30 dias)
function abreParada(d, id) {
  const x = d.paradas.find(y => y.id === id); if (!x) return;
  if (x.v) return detalheVisita(P.data, id);
  const l = S.lojas.find(y => y.id === x.lojaId) || {}; const pt = pontoLoja(l);
  abreModal(`<div class="spread" style="align-items:flex-start"><div><div class="label">${h(prim(d.pid))} · ${dataBR(P.data)} · ${x.extra ? 'fora da rota' : x.ordem + 'ª parada'}</div><h3 style="font-size:20px">${h(x.nome)}</h3></div><button class="btn ghost" id="pa-x">Fechar</button></div>
    <div class="muted">${h([l.codigo ? 'Cód. ' + l.codigo : '', endCompleto(l)].filter(Boolean).join(' · '))}</div>
    <div class="note">Ainda sem visita neste dia.</div>
    ${pt ? `<div><a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${pt[0]},${pt[1]}">Ver no Google Maps</a></div>` : ''}
    <div id="pa-ult" class="muted" style="font-size:14px">Procurando a última visita…</div>`);
  $('#pa-x').onclick = fechaModal;
  (async () => {
    for (let i = 1; i <= 30; i++) {
      const dt = new Date(P.data + 'T12:00:00'); dt.setDate(dt.getDate() - i); const ds = ymd(dt);
      if (ds < inicioControle()) break;
      try { const s2 = await getDoc(doc(db, 'dias', ds, 'visitas', id)); if (s2.exists()) { const v = s2.data(); const el = $('#pa-ult'); if (!el) return;
        el.innerHTML = `<b>Última visita:</b> ${dataBR(ds)} · ${v.status === 'nao_visitada' ? 'não visitada (' + h(v.motivo || '') + ')' : hm(v.checkin) + '–' + hm(v.checkout)} <button class="btn sm" id="pa-ver">Ver fotos e preços</button>`;
        $('#pa-ver').onclick = () => detalheVisita(ds, id, v); return; } } catch (e) {}
    }
    const el = $('#pa-ult'); if (el) el.textContent = 'Nenhuma visita nos últimos 30 dias.';
  })();
}
async function detalheVisita(date, id, vInfo) {
  const v = vInfo || P.vis[id]; if (!v) return;
  const loja = S.lojas.find(l => l.id === v.lojaId);
  const resp = v.checklist || {};
  abreModal(`<div class="spread" style="align-items:flex-start"><div><div class="label">${h(v.promotorNome || prim(v.promotorId))} · ${dataBR(date)}</div><h3 style="font-size:20px">${h(v.lojaNome)}</h3></div><button class="btn ghost" id="md-x">Fechar</button></div>
    ${v.status === 'nao_visitada' ? `<div class="note warn"><b>Não visitada:</b> ${h(v.motivo)}${v.obs ? ' — ' + h(v.obs) : ''}</div>` :
    `<div class="times num"><div><span class="label">Entrada</span><b>${hm(v.checkin)}</b></div><div><span class="label">Saída</span><b>${hm(v.checkout)}</b></div><div><span class="label">Tempo</span><b>${dur(v.checkin, v.checkout)}</b></div></div>
     <div class="note ${v.semCoord ? 'warn' : foraLoja(v) ? 'crit' : 'ok'}">${v.gpsIn ? `Check-in em ${v.gpsIn.lat.toFixed(5)}, ${v.gpsIn.lng.toFixed(5)} (precisão ${v.gpsIn.prec} m)` : 'Sem GPS no check-in'}${v.distIn != null ? ` · ${v.distIn} m ${v.localAprox ? 'do endereço (local aproximado, tolerância ' + (v.limite || 500) + ' m)' : 'da loja'}` : ''}${foraLoja(v) ? ' · <b>⚠️ fora da loja</b>' : ''}${v.semCoord ? '<br>A loja não tinha localização cadastrada.' : ''}</div>
     ${v.checkout ? `<div class="note ${foraSaida(v) ? 'crit' : v.distOut != null ? 'ok' : 'warn'}">${v.gpsOut ? `Check-out em ${v.gpsOut.lat.toFixed(5)}, ${v.gpsOut.lng.toFixed(5)} (precisão ${v.gpsOut.prec} m)` : 'Sem GPS no check-out'}${v.distOut != null ? ` · ${v.distOut} m ${v.localAprox ? 'do endereço' : 'da loja'}` : ''}${foraSaida(v) ? ' · <b>⚠️ saída fora da loja</b>' : ''}${v.rostoOutOk === false ? ' · <b>⚠️ rosto da selfie de saída não confere</b>' : v.rostoOutOk ? ' · rosto da saída confere' : ''}${v.gpsOut ? ` · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${v.gpsOut.lat},${v.gpsOut.lng}">ver no mapa</a>` : ''}</div>` : ''}
     ${linhaEnvio(v)}
     ${v.rostoDist !== undefined || S.rostos[v.promotorId] ? `<div class="row" style="gap:10px;align-items:center;flex-wrap:nowrap">${avatar(v.promotorId, 56)}<div class="note ${v.rostoOk === false ? 'crit' : v.rostoOk ? 'ok' : ''}" style="flex:1">${v.rostoOk === false ? `<b>Rosto da selfie não confere com o cadastro</b>${v.rostoDist != null ? ` (diferença ${n2(v.rostoDist)}; até ${n2(LIMITE)} é a mesma pessoa)` : ' (rosto não encontrado na selfie)'}. Compare as fotos.` : v.rostoOk ? `Rosto da selfie confere com o cadastro (diferença ${n2(v.rostoDist)}).` : 'Selfie sem conferência automática de rosto (promotor sem foto no cadastro na hora do check-in).'}</div></div>` : ''}
     ${v.gpsIn && loja ? `<div class="row">${S.leitura ? '' : '<button class="btn sm" id="md-local">Usar este ponto como local da loja</button>'}<a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${v.gpsIn.lat},${v.gpsIn.lng}">Ver no Google Maps</a></div>` : ''}
     ${Object.keys(resp).some(k => resp[k]) ? `<div><div class="label">Checklist</div>${Object.keys(resp).filter(k => resp[k]).map(k => `<div class="spread" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${h(k)}</span><b>${resp[k] === 'sim' ? 'Sim' : 'Não'}</b></div>`).join('') || '<div class="muted">Sem respostas.</div>'}</div>` : ''}
     ${(() => { // pesquisa de preço: mostra o que foi respondido (itens atuais e de listas anteriores)
       const ck = q => q.replace(/[.~*/\[\]]/g, '_'); const P = v.precos || {}; const atuais = new Map(S.pesquisa.map(q => [ck(q), q]));
       const resp = Object.keys(P).filter(k => P[k]).map(k => [atuais.get(k) || k, P[k]]);
       const rup = resp.filter(([, x]) => x.falta).length, npr = resp.filter(([, x]) => !x.falta && typeof x.preco === 'number').length; const nInf = S.pesquisa.filter(q => !P[ck(q)]).length;
       const vtag = x => { if (!x.val || x.falta) return ''; const n = Math.round((new Date(x.val + 'T12:00:00') - new Date(date + 'T12:00:00')) / 864e5); const cor = n < 7 ? 'var(--crit)' : n < 10 ? '#9A6B00' : '#1E7A44'; return `<div style="font-size:12px;font-weight:600;color:${cor}">validade ${x.val.split('-').reverse().join('/')} (${n < 0 ? 'vencido' : n + ' dia' + (n === 1 ? '' : 's')})</div>`; };
       return `<div><div class="label">Pesquisa de preço · ${npr} preço(s) · ${rup} ruptura(s)${nInf ? ` · ${nInf} não informado(s)` : ''}</div>${resp.length ? resp.map(([q, x]) => `<div class="spread" style="padding:6px 0;border-bottom:1px solid var(--line);gap:8px"><span style="min-width:0">${h(q)}</span><span style="text-align:right"><b class="num" style="white-space:nowrap">${x.falta ? '<span style="color:var(--crit)">ruptura</span>' : typeof x.preco === 'number' ? brl(x.preco) : '<span class="muted">sem preço</span>'}</b>${vtag(x)}</span></div>`).join('') : '<div class="muted" style="font-size:13px">Nenhum item lançado nesta visita.</div>'}</div>`;
     })()}
     ${v.obs ? `<div><div class="label">Observações</div><div style="white-space:pre-wrap">${h(v.obs)}</div></div>` : ''}
     <div><div class="label">Fotos</div><div id="md-fotos" class="stack muted">Carregando fotos…</div></div>`}`);
  $('#md-x').onclick = fechaModal;
  const bl = $('#md-local');
  if (bl) bl.onclick = async () => {
    const ab = foraLoja(v) && !v.alertaTratado;
    if (!(await confirma(`Gravar o local do check-in como localização de ${loja.nome}? A partir daí o check-in dessa loja é conferido no raio de ${S.raio} m.${ab ? ' O alerta de "fora da loja" desta visita será encerrado como conferido.' : ''}`, 'Gravar local'))) return;
    gravaLocalLoja(loja, v, date, id).then(() => { toast(ab ? 'Local da loja gravado e alerta encerrado' : 'Local da loja gravado'); fechaModal(); }, e => toast(erroMsg(e)));
  };
  if (v.status !== 'nao_visitada') {
    try {
      const s = await getDoc(doc(db, 'dias', date, 'fotos', id)); const box = $('#md-fotos'); if (!box) return;
      const nomes = { chegada: 'Chegada (selfie)', antes: 'Gôndola antes', depois: 'Gôndola depois', extra: 'Foto extra', saida: 'Saída (selfie)' };
      const imgs = s.exists() ? (s.data().imgs || []) : [];
      box.innerHTML = imgs.length ? imgs.map((f, i) => `<div class="stack" style="gap:4px"><div class="label" style="color:var(--ink)">${nomes[f.tipo] || 'Foto'} · ${hm(f.ts)}</div><img class="bigfoto" src="${f.d}" alt="${nomes[f.tipo] || 'Foto'}">${!S.leitura && (f.tipo === 'chegada' || f.tipo === 'saida') ? `<div><button class="btn sm" data-usarosto="${i}">Usar esta selfie como foto do cadastro</button> <span class="muted" data-usamsg="${i}" style="font-size:12px"></span></div>` : ''}</div>`).join('') : 'Nenhuma foto.';
      box.querySelectorAll('[data-usarosto]').forEach(bt => bt.onclick = async () => {
        const i = +bt.dataset.usarosto; const f = imgs[i]; const msg = box.querySelector(`[data-usamsg="${i}"]`); const nome = promNome(v.promotorId);
        if (!(await confirma(`Trocar a foto do cadastro de ${nome} por esta selfie? A partir daí o reconhecimento do rosto no app compara com ela.`, 'Trocar foto'))) return;
        bt.disabled = true; msg.textContent = 'Lendo o rosto… (pode demorar alguns segundos)';
        try {
          const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = f.d; });
          const lf = await leRostoFoto(img); const r = lf && lf.r;
          if (!r) { msg.innerHTML = '<span style="color:var(--crit)">Não encontrei um rosto nítido nesta selfie. Use outra.</span>'; bt.disabled = false; return; }
          const ant = S.rostos[v.promotorId];
          await setDoc(doc(db, 'rostos', v.promotorId), { foto: recorteRosto(lf.fonte, r.box), desc: r.desc, atualizado: Date.now(), origem: 'selfie ' + date + ' ' + (v.lojaNome || ''),
            anterior: ant ? { foto: ant.foto || null, desc: ant.desc || null, atualizado: ant.atualizado || null } : null }); // guarda a foto anterior (cópia de segurança)
          msg.innerHTML = '<span style="color:var(--ok)">Foto do cadastro trocada.</span>'; toast('Foto do cadastro de ' + nome.split(' ')[0] + ' trocada');
        } catch (err) { msg.textContent = 'Não consegui gravar: ' + erroMsg(err); bt.disabled = false; }
      });
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
// Cliente que entra numa rota e ainda não tem ponto no mapa: localiza sozinho (uma tentativa por sessão)
const G_TENTOU = new Set();
function autoLocalizaRotas() {
  if (G.rodando) return;
  const falta = S.lojas.filter(l => l.promotorId && (l.dias || []).length && !pontoLoja(l) && !G_TENTOU.has(l.id));
  if (!falta.length) return; falta.forEach(l => G_TENTOU.add(l.id));
  setTimeout(() => localizaLojas(falta, null, true), 1500);
}
function renderMontar() {
  const c = $('#v-montar');
  if (!c.dataset.ok) {
    c.dataset.ok = 1;
    c.innerHTML = `<div class="spread" style="flex-wrap:wrap;gap:8px"><h2 style="margin:0">Montar rotas</h2><div class="row" style="gap:6px"><button class="btn sm" id="m-restaura" hidden>Desfazer última alteração</button><button class="btn sm" id="m-pdf">PDF da rota…</button><button class="btn sm" id="m-copia">Copiar rota…</button><button class="btn sm danger" id="m-limpa">Excluir rota…</button></div></div>
      <div class="card stack"><div class="spread"><h3>Visão da semana</h3><span class="muted" style="font-size:13px">Clientes por dia · clique para editar</span></div><div class="table-wrap" id="m-semana"></div></div>
      <div class="row" style="align-items:end"><label class="field" style="flex:1 1 240px"><span>Promotor</span><select id="m-prom"></select></label>
      <div class="field" style="flex:2 1 320px"><span>Dia da semana</span><div class="chips" id="m-dias"></div></div></div>
      <div class="grid2"><div id="m-rota" class="stack"></div>
      <div class="card stack"><h3>Adicionar clientes</h3><input type="text" id="m-busca" placeholder="Buscar por código, nome, bairro ou cidade" autocomplete="off"><div id="m-res" style="max-height:70vh;overflow-y:auto"></div></div></div>`;
    $('#m-dias').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip" data-d="${d}" aria-pressed="false">${DIAS[d]}</button>`).join('');
    $('#m-dias').querySelectorAll('.chip').forEach(b => b.onclick = () => { M.wd = +b.dataset.d; lsSet('np.m.dia', M.wd); renderMontar(); });
    $('#m-limpa').onclick = limparRota; $('#m-copia').onclick = copiarRota; $('#m-pdf').onclick = pdfRotaEscolha;
    $('#m-restaura').onclick = restauraRota;
    $('#m-prom').onchange = e => { M.pid = e.target.value; lsSet('np.m.prom', M.pid); renderMontar(); };
    let t = null; $('#m-busca').oninput = () => { clearTimeout(t); t = setTimeout(renderBusca, 150); };
  }
  if (vazioCarregando()) return;
  autoLocalizaRotas();
  const bk = S.bkRotas; const br = $('#m-restaura'); br.hidden = !bk; if (bk) br.title = `Volta como estava antes de: ${bk.desc} (${new Date(bk.em).toLocaleString('pt-BR')})`;
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
    (lista.length ? lista.map((l, i) => `<div class="ritem"><span class="n num">${i + 1}</span><span class="t"><b>${h(l.nome)}</b><span>${cod(l)}${l.endereco ? h(l.endereco) + ' · ' : ''}${h(l.bairro || '')}${l.lat == null ? ' · <span class="tag y">sem local</span>' : ''}</span></span>
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
  let itens = q ? S.lojas.filter(l => { const t = semAcento([l.codigo, l.nome, l.razao, l.endereco, l.bairro, l.municipio, l.praca, promNome(l.promotorId)].join(' ')); return q.split(/\s+/).every(x => t.includes(x)); })
    : S.lojas.filter(l => l.promotorId === M.pid && !(l.dias || []).map(Number).includes(M.wd));
  itens.sort((a, b) => (a.promotorId === M.pid ? 0 : 1) - (b.promotorId === M.pid ? 0 : 1) || a.nome.localeCompare(b.nome));
  if (!itens.length) { r.innerHTML = `<div class="muted" style="font-size:14px">${q ? 'Nenhum cliente encontrado.' : 'Todos os clientes deste promotor já estão neste dia. Busque para trazer outros.'}</div>`; return; }
  r.innerHTML = itens.slice(0, 60).map(l => {
    const naRota = l.promotorId === M.pid && (l.dias || []).map(Number).includes(M.wd);
    const outro = l.promotorId && l.promotorId !== M.pid;
    const dias = [1, 2, 3, 4, 5, 6, 0].filter(d => (l.dias || []).map(Number).includes(d)).map(d => DIAS[d]).join(' ');
    return `<div class="res"><div class="t"><b>${h(l.nome)}</b><div>${cod(l)}${l.endereco ? h(l.endereco) + ' · ' : ''}${h(l.bairro || '')}, ${h(l.municipio || '')}</div>
      <div class="row" style="gap:6px;margin-top:3px">${outro ? `<span class="tag">${h(prim(l.promotorId))}</span>` : ''}${dias ? `<span class="tag">${dias}</span>` : '<span class="tag">sem dia</span>'}${l.bloqueado ? '<span class="tag no">bloqueado</span>' : ''}</div></div>
      ${naRota ? '<span class="tag y">Na rota</span>' : `<button class="btn sm ${outro ? '' : 'primary'}" data-add="${h(l.id)}">Adicionar</button>`}</div>`;
  }).join('') + (itens.length > 60 ? `<div class="muted" style="font-size:13px;padding-top:8px">Mostrando 60 de ${itens.length}. Refine a busca.</div>` : '');
  r.querySelectorAll('[data-add]').forEach(b => b.onclick = () => adicionaNaRota(S.lojas.find(l => l.id === b.dataset.add)));
}
// Excluir rota: tira os dias (e, se marcado, o promotor) dos clientes. Antes, guarda uma cópia para poder desfazer.
function limparRota() {
  const nome = M.pid ? promNome(M.pid) : '';
  abreModal(`<div class="spread"><h3>Excluir rota</h3><button class="btn ghost" id="lr-x">Fechar</button></div>
    <label class="field"><span>De quem</span><select id="lr-quem">${M.pid ? `<option value="um">Só de ${h(nome)}</option>` : ''}<option value="todos">De todos os promotores</option></select></label>
    <label class="field"><span>Quais dias</span><select id="lr-dia"><option value="todos">A semana toda</option><option value="um">Só ${DIAS_LONGO[M.wd]}</option></select></label>
    <label class="ck"><input type="checkbox" id="lr-cart"> <span>Tirar também os clientes da carteira do promotor <span class="muted">(eles deixam de contar na variável dele até serem colocados de novo)</span></span></label>
    <div class="note" id="lr-res"></div>
    <div class="note warn" style="font-size:13px">Antes de excluir, o sistema guarda uma cópia: o botão <b>Desfazer última alteração</b> volta tudo como estava. As visitas já feitas não são apagadas.</div>
    <div class="row end"><button class="btn" id="lr-c">Cancelar</button><button class="btn primary danger" id="lr-s">Excluir</button></div>`);
  const alvo = () => {
    const quem = $('#lr-quem').value, dia = $('#lr-dia').value, cart = $('#lr-cart').checked;
    const ls = S.lojas.filter(l => (quem === 'todos' ? !!l.promotorId : l.promotorId === M.pid) && (dia === 'todos' ? ((l.dias || []).length || cart) : (l.dias || []).map(Number).includes(M.wd)));
    return { quem, dia, cart, ls };
  };
  const mostra = () => { const a = alvo(); $('#lr-res').innerHTML = `<b>${a.ls.length}</b> cliente(s) serão tirados da rota${a.dia === 'um' ? ' de ' + DIAS_LONGO[M.wd] : ''}${a.quem === 'todos' ? ' de todos os promotores' : ' de ' + h(nome)}${a.cart ? ' e da carteira do promotor' : ''}.`; };
  ['#lr-quem', '#lr-dia', '#lr-cart'].forEach(id => $(id).onchange = mostra); mostra();
  $('#lr-x').onclick = $('#lr-c').onclick = fechaModal;
  $('#lr-s').onclick = async () => {
    const a = alvo(); if (!a.ls.length) return toast('Nada para excluir.');
    const b = $('#lr-s'); b.disabled = true; b.textContent = 'Guardando cópia…';
    try {
      const desc = `excluir rota ${a.quem === 'todos' ? 'de todos' : 'de ' + nome}${a.dia === 'um' ? ' (' + DIAS_LONGO[M.wd] + ')' : ''}${a.cart ? ' + carteira' : ''}`;
      const copia = {}; a.ls.forEach(l => copia[l.id] = { promotorId: l.promotorId || '', dias: l.dias || [], ordemDia: l.ordemDia || {} });
      await setDoc(doc(db, 'config', 'rotasBackup'), { em: Date.now(), desc, lojas: copia });
      b.textContent = 'Excluindo…';
      const ops = a.ls.map(l => {
        let v;
        if (a.dia === 'um') { const od = Object.assign({}, l.ordemDia); delete od[M.wd]; v = { dias: (l.dias || []).map(Number).filter(d => d !== M.wd), ordemDia: od }; }
        else v = { dias: [], ordemDia: {} };
        if (a.cart && (a.dia === 'todos' || !v.dias.length)) v.promotorId = '';
        v.atualizado = Date.now(); return [l.id, v];
      });
      for (let i = 0; i < ops.length; i += 400) { const wb = writeBatch(db); ops.slice(i, i + 400).forEach(([id, v]) => wb.update(doc(db, 'lojas', id), v)); await wb.commit(); }
      fechaModal(); toast(`${ops.length} cliente(s) tirados da rota. Agora é só montar a nova.`, 6000);
    } catch (e) { b.disabled = false; b.textContent = 'Excluir'; toast(erroMsg(e), 6000); }
  };
}
// PDF das rotas: um promotor, vários ou todos, num arquivo só (dias da semana e clientes na ordem)
function pdfRotaEscolha() {
  const ps = S.promotores.filter(p => p.ativo !== false && [1, 2, 3, 4, 5, 6, 0].some(d => lojasDoDiaWd(p.id, d).length));
  if (!ps.length) return toast('Nenhum promotor com rota montada.');
  abreModal(`<div class="spread"><h3>PDF da rota</h3><button class="btn ghost" id="pr-x">Fechar</button></div>
    <label class="row" style="gap:8px;font-weight:700"><input type="checkbox" id="pr-todos"> Marcar todos</label>
    <div class="stack" style="gap:6px;max-height:50vh;overflow:auto" id="pr-lista">${ps.map(p => `<label class="row" style="gap:8px"><input type="checkbox" data-pr="${h(p.id)}" ${p.id === M.pid ? 'checked' : ''}> ${h(p.nome)} <span class="muted" style="font-size:12px">· ${new Set([1, 2, 3, 4, 5, 6, 0].flatMap(d => lojasDoDiaWd(p.id, d).map(l => l.id))).size} clientes</span></label>`).join('')}</div>
    <label class="row" style="gap:8px;border-top:1px solid var(--line);padding-top:10px"><input type="checkbox" id="pr-transp" ${lsGet('np.pdf.transp') === '0' ? '' : 'checked'}> Mostrar transporte (km e valor das passagens)</label>
    <div class="row end"><button class="btn" id="pr-c">Cancelar</button><button class="btn primary" id="pr-s">Gerar PDF</button></div>`);
  const cks = () => [...document.querySelectorAll('[data-pr]')];
  $('#pr-todos').onchange = e => cks().forEach(c => c.checked = e.target.checked);
  $('#pr-x').onclick = $('#pr-c').onclick = fechaModal;
  $('#pr-s').onclick = () => { const ids = cks().filter(c => c.checked).map(c => c.dataset.pr); if (!ids.length) return toast('Marque pelo menos um promotor.'); const tr = $('#pr-transp').checked; lsSet('np.pdf.transp', tr ? '1' : '0'); fechaModal(); pdfRotas(ids, { transporte: tr }); };
}
// ----- passagens: tarifas por cidade e entre cidades (Configurações) -----
const semAc = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const PASS_PADRAO = { tarifas: { 'VOLTA REDONDA': 5.90, 'BARRA MANSA': 5.45, 'ANGRA DOS REIS': 5.80, 'RESENDE': 4.00 }, inter: { 'BARRA MANSA|VOLTA REDONDA': 4.45 }, aPe: 1 };
const regrasPass = () => { const c = (S.empresa && S.empresa.passagens) || {}; return { tarifas: Object.assign({}, PASS_PADRAO.tarifas, c.tarifas || {}), inter: Object.assign({}, PASS_PADRAO.inter, c.inter || {}), aPe: c.aPe ?? PASS_PADRAO.aPe }; };
function tarifaTrecho(R, a, b) {
  const A = semAc(a), B = semAc(b);
  if (A && A === B) return R.tarifas[A];
  return R.inter[[A, B].sort().join('|')];
}
// Custo de um dia: casa → lojas na ordem → casa. 1 passagem por trecho acima da distância a pé.
async function custoDia(pid, wd) {
  const p = S.promotores.find(x => x.id === pid) || {}; const R = regrasPass();
  const lojas = lojasDoDiaWd(pid, wd);
  const pts = []; const avisos = new Set();
  if (p.casa && p.casa.lat != null) pts.push({ ll: [+p.casa.lat, +p.casa.lng], cid: p.cidadeRes, nome: 'casa' }); else avisos.add('casa sem localização');
  lojas.forEach(l => { const pt = pontoLoja(l); if (pt) pts.push({ ll: pt, cid: l.municipio || l.cidade, nome: l.nome }); else avisos.add(`${l.nome} sem localização`); });
  if (p.casa && p.casa.lat != null && lojas.length) pts.push(pts[0]);
  let km = 0, pass = 0, valor = 0;
  for (let i = 1; i < pts.length; i++) {
    const t = await trajeto(pts[i - 1].ll, pts[i].ll); km += t.km;
    if (t.km > R.aPe) { pass++; const v = tarifaTrecho(R, pts[i - 1].cid, pts[i].cid); if (v == null) avisos.add(`sem tarifa ${semAc(pts[i - 1].cid)}${semAc(pts[i - 1].cid) !== semAc(pts[i].cid) ? ' ↔ ' + semAc(pts[i].cid) : ''}`); else valor += +v; }
  }
  return { lojas, km, pass, valor, avisos: [...avisos] };
}
async function pdfRotas(ids, op = {}) {
  const transp = op.transporte !== false;
  const J = window.jspdf && window.jspdf.jsPDF; if (!J) return toast('O gerador de PDF ainda está carregando. Tente de novo em alguns segundos.');
  if (transp) toast('Calculando distâncias e passagens… pode levar alguns segundos.', 8000);
  const logo = await carregaImg(LOGO).catch(() => null);
  const d = new J({ unit: 'mm', format: 'a4', orientation: 'landscape' }); const W = 297, H = 210, M = 10;
  const brl = v => 'R$ ' + v.toFixed(2).replace('.', ',');
  const kmf = v => v.toFixed(1).replace('.', ',') + ' km';
  const agora = new Date(); const mesNome = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const diasNoMes = wd => { const y = agora.getFullYear(), m = agora.getMonth(); let n = 0; for (let x = 1; x <= new Date(y, m + 1, 0).getDate(); x++) if (new Date(y, m, x).getDay() === wd) n++; return n; };
  const R = regrasPass(); const tit = c => c.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Dos|Das|Do|Da|De)\b/g, x => x.toLowerCase());
  for (let k = 0; k < ids.length; k++) {
    const pid = ids[k]; if (k) d.addPage();
    const p = S.promotores.find(x => x.id === pid) || {};
    const dias = [1, 2, 3, 4, 5, 6].concat(lojasDoDiaWd(pid, 0).length ? [0] : []);
    const C = {}; for (const wd of dias) C[wd] = transp ? await custoDia(pid, wd) : { lojas: lojasDoDiaWd(pid, wd), km: 0, pass: 0, valor: 0, avisos: [] };
    // cabeçalho
    d.setFillColor(23, 25, 37); d.rect(0, 0, W, 22, 'F'); d.setFillColor(244, 188, 28); d.rect(0, 22, W, 1.3, 'F');
    if (logo) try { d.addImage(logo, 'PNG', M, 5.5, 58, 11.1); } catch (e) {}
    const foto = S.rostos[pid] && S.rostos[pid].foto; const xr = foto ? W - M - 19 : W - M;
    if (foto) { try { d.setFillColor(244, 188, 28); d.roundedRect(W - M - 17.2, 2.3, 17.4, 17.4, 2.5, 2.5, 'F'); d.addImage(foto, 'JPEG', W - M - 16.5, 3, 16, 16); } catch (e) {} }
    d.setTextColor(255, 255, 255); d.setFont(undefined, 'bold'); d.setFontSize(15); d.text(p.nome || promNome(pid), xr, 11, { align: 'right' });
    d.setFont(undefined, 'normal'); d.setFontSize(8); d.setTextColor(210, 212, 220);
    d.text(`ROTA DA SEMANA${transp ? ' · casa: ' + ([p.endereco ? String(p.endereco).split(',').slice(0, 1)[0] : '', p.cidadeRes].filter(Boolean).join(' · ') || 'sem endereço') : ''}`, xr, 17, { align: 'right' });
    // colunas
    const top = 28, n = dias.length, gap = 2.5, cw = (W - 2 * M - gap * (n - 1)) / n, rodape = 37, area = H - top - rodape - 19;
    const maxL = Math.max(1, ...dias.map(wd => C[wd].lojas.length)); const ch = Math.min(15, (area - 10) / maxL);
    dias.forEach((wd, j) => {
      const x = M + j * (cw + gap), c = C[wd];
      d.setFillColor(244, 188, 28); d.roundedRect(x, top, cw, 8, 1.5, 1.5, 'F');
      d.setTextColor(23, 25, 37); d.setFont(undefined, 'bold'); d.setFontSize(9.5); d.text(DIAS_LONGO[wd].toUpperCase(), x + cw / 2, top + 5.4, { align: 'center' });
      d.setDrawColor(225, 227, 233); d.setLineWidth(0.25); d.roundedRect(x, top + 9, cw, area - 9, 1.5, 1.5, 'S');
      if (!c.lojas.length) { d.setTextColor(150, 152, 165); d.setFont(undefined, 'normal'); d.setFontSize(8.5); d.text('Sem rota', x + cw / 2, top + 20, { align: 'center' }); }
      c.lojas.forEach((l, i) => {
        const y = top + 10 + i * ch;
        if (i % 2) { d.setFillColor(247, 248, 250); d.rect(x + 0.4, y - 0.6, cw - 0.8, ch, 'F'); }
        d.setFillColor(23, 25, 37); d.circle(x + 4, y + 3.4, 2.4, 'F'); d.setTextColor(255, 255, 255); d.setFont(undefined, 'bold'); d.setFontSize(7.5); d.text(String(i + 1), x + 4, y + 4.4, { align: 'center' });
        d.setTextColor(23, 25, 37); d.setFontSize(8); const nm = d.splitTextToSize(`${l.nome}${l.codigo ? ' · ' + l.codigo : ''}`, cw - 9).slice(0, 2); d.text(nm, x + 8, y + 3);
        d.setFont(undefined, 'normal'); d.setFontSize(6.6); d.setTextColor(100, 104, 120);
        const lug = d.splitTextToSize([l.bairro, l.municipio].filter(Boolean).join(' · '), cw - 9).slice(0, ch >= 12.5 ? 2 : 1); d.text(lug, x + 8, y + 3 + nm.length * 3.3);
      });
      // totais do dia
      const yb = top + area + 2;
      d.setFillColor(241, 242, 245); d.roundedRect(x, yb, cw, 13, 1.5, 1.5, 'F');
      d.setTextColor(23, 25, 37); d.setFont(undefined, 'bold'); d.setFontSize(8.5);
      if (transp) {
        d.text(c.lojas.length ? kmf(c.km) : '—', x + cw / 2, yb + 4.8, { align: 'center' });
        d.setFont(undefined, 'normal'); d.setFontSize(7.4); d.setTextColor(70, 74, 90);
        d.text(c.lojas.length ? `${c.pass} ${c.pass === 1 ? 'passagem' : 'passagens'} · ${brl(c.valor)}` : '', x + cw / 2, yb + 9.6, { align: 'center' });
      } else d.text(c.lojas.length ? `${c.lojas.length} ${c.lojas.length === 1 ? 'cliente' : 'clientes'}` : '—', x + cw / 2, yb + 7.6, { align: 'center' });
    });
    // resumo
    const sem = dias.reduce((t, wd) => ({ km: t.km + C[wd].km, pass: t.pass + C[wd].pass, valor: t.valor + C[wd].valor, lojas: t.lojas + C[wd].lojas.length }), { km: 0, pass: 0, valor: 0, lojas: 0 });
    const mes = dias.reduce((t, wd) => ({ dias: t.dias + (C[wd].lojas.length ? diasNoMes(wd) : 0), km: t.km + C[wd].km * diasNoMes(wd), pass: t.pass + C[wd].pass * diasNoMes(wd), valor: t.valor + C[wd].valor * diasNoMes(wd) }), { dias: 0, km: 0, pass: 0, valor: 0 });
    const ys = H - rodape + 4; const bw = (W - 2 * M - 3 * 4) / 4;
    const clientes = new Set(dias.flatMap(wd => C[wd].lojas.map(l => l.id))).size;
    (transp ? [['VISITAS NA SEMANA', String(sem.lojas)], ['DISTÂNCIA NA SEMANA', kmf(sem.km)], ['PASSAGENS NA SEMANA', `${sem.pass} · ${brl(sem.valor)}`], [`ESTIMATIVA ${mesNome.toUpperCase()}`, `${mes.pass} pass. · ${brl(mes.valor)}`]]
      : [['CLIENTES NA ROTA', String(clientes)], ['VISITAS NA SEMANA', String(sem.lojas)], ['DIAS DE ROTA NA SEMANA', String(dias.filter(wd => C[wd].lojas.length).length)], [`DIAS DE ROTA EM ${mesNome.toUpperCase()}`, String(mes.dias)]]).forEach(([t, v], j) => {
      const x = M + j * (bw + 4); const dest = j === 3;
      d.setFillColor(...(dest ? [244, 188, 28] : [23, 25, 37])); d.roundedRect(x, ys, bw, 15, 2, 2, 'F');
      d.setTextColor(...(dest ? [23, 25, 37] : [200, 203, 212])); d.setFont(undefined, 'normal'); d.setFontSize(7); d.text(t, x + 4, ys + 5);
      d.setTextColor(...(dest ? [23, 25, 37] : [255, 255, 255])); d.setFont(undefined, 'bold'); d.setFontSize(12); d.text(v, x + 4, ys + 11.8);
    });
    const avisos = [...new Set(dias.flatMap(wd => C[wd].avisos))];
    const tarifasUsadas = [...new Set(dias.flatMap(wd => [p.cidadeRes, ...C[wd].lojas.map(l => l.municipio)]).map(semAc).filter(Boolean))].map(c => `${tit(c)} ${R.tarifas[c] != null ? brl(+R.tarifas[c]) : '(sem tarifa)'}`);
    d.setFont(undefined, 'normal'); d.setFontSize(6.6); d.setTextColor(110, 114, 128);
    const nota = `Distância de carro pelas ruas (OpenStreetMap), saindo de casa, passando pelas lojas na ordem e voltando para casa. 1 passagem por trecho acima de ${String(R.aPe).replace('.', ',')} km (mais perto: a pé). Tarifas: ${tarifasUsadas.join(' · ')}${Object.keys(R.inter).length ? ' · entre cidades: ' + Object.entries(R.inter).map(([k, v]) => k.split('|').map(tit).join(' x ') + ' ' + brl(+v)).join(' · ') : ''}. Estimativa do mês: dias de rota de ${mesNome}.${avisos.length ? ' Atenção: ' + avisos.join('; ') + '.' : ''}`;
    if (transp) d.text(d.splitTextToSize(nota, W - 2 * M - 40), M, H - 8.5);
    d.text(`Gerado em ${agora.toLocaleDateString('pt-BR')} ${hm(Date.now())}`, W - M, H - 4, { align: 'right' });
  }
  d.save(`Rota${ids.length === 1 ? ' ' + promNome(ids[0]).split(' ')[0] : 's ' + ids.length + ' promotores'} ${ymd(new Date())}.pdf`);
}
// Copia a rota de um dia (na mesma ordem) para outros dias do mesmo promotor
function copiarRota() {
  if (!M.pid) return toast('Escolha o promotor primeiro.');
  const nome = promNome(M.pid);
  abreModal(`<div class="spread"><h3>Copiar rota · ${h(nome.split(' ')[0])}</h3><button class="btn ghost" id="cr-x">Fechar</button></div>
    <label class="field"><span>Copiar a rota de</span><select id="cr-de">${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}" ${d === M.wd ? 'selected' : ''}>${DIAS_LONGO[d]} (${lojasDoDiaWd(M.pid, d).length} clientes)</option>`).join('')}</select></label>
    <div class="field"><span>Para os dias</span><div class="chips" id="cr-para"></div></div>
    <label class="field"><span>O que fazer com a rota que já existe nesses dias</span><select id="cr-modo"><option value="subst">Substituir: o dia fica igual ao de origem</option><option value="juntar">Juntar: mantém os clientes e acrescenta os da origem no fim</option></select></label>
    <div class="note" id="cr-res"></div>
    <div class="note warn" style="font-size:13px">Antes de copiar, o sistema guarda uma cópia: o botão <b>Desfazer última alteração</b> volta tudo como estava.</div>
    <div class="row end"><button class="btn" id="cr-c">Cancelar</button><button class="btn primary" id="cr-s">Copiar</button></div>`);
  const para = new Set();
  const pinta = () => {
    const de = +$('#cr-de').value; [...para].forEach(d => { if (d === de) para.delete(d); });
    $('#cr-para').innerHTML = [1, 2, 3, 4, 5, 6, 0].filter(d => d !== de).map(d => `<button class="chip" data-d="${d}" aria-pressed="${para.has(d)}">${DIAS[d]} · ${lojasDoDiaWd(M.pid, d).length}</button>`).join('');
    $('#cr-para').querySelectorAll('.chip').forEach(b => b.onclick = () => { const d = +b.dataset.d; para.has(d) ? para.delete(d) : para.add(d); pinta(); });
    const n = lojasDoDiaWd(M.pid, de).length, modo = $('#cr-modo').value;
    $('#cr-res').innerHTML = !para.size ? 'Escolha um ou mais dias de destino.' : !n ? `A rota de ${DIAS_LONGO[de]} está vazia.` :
      `Os <b>${n}</b> clientes de ${DIAS_LONGO[de]} vão para ${[...para].map(d => DIAS_LONGO[d]).join(', ')}${modo === 'subst' ? `, <b>substituindo</b> o que já estava lá (${[...para].map(d => DIAS[d] + ': ' + lojasDoDiaWd(M.pid, d).length).join(' · ')} hoje)` : ', depois dos clientes que já estão lá'}.`;
  };
  $('#cr-de').onchange = pinta; $('#cr-modo').onchange = pinta; pinta();
  $('#cr-x').onclick = $('#cr-c').onclick = fechaModal;
  $('#cr-s').onclick = async () => {
    const de = +$('#cr-de').value, modo = $('#cr-modo').value, src = lojasDoDiaWd(M.pid, de);
    if (!para.size || !src.length) return toast(!para.size ? 'Escolha os dias de destino.' : 'A rota de origem está vazia.');
    const b = $('#cr-s'); b.disabled = true; b.textContent = 'Guardando cópia…';
    try {
      const afetadas = new Map(); const pega = l => { if (!afetadas.has(l.id)) afetadas.set(l.id, { l, dias: new Set((l.dias || []).map(Number)), od: Object.assign({}, l.ordemDia) }); return afetadas.get(l.id); };
      [...para].forEach(t => {
        const atuais = lojasDoDiaWd(M.pid, t); let pos;
        if (modo === 'subst') { atuais.forEach(l => { if (!src.includes(l)) { const x = pega(l); x.dias.delete(t); delete x.od[t]; } }); pos = 0; }
        else pos = atuais.length;
        src.forEach((l, i) => { const x = pega(l); if (modo === 'juntar' && x.dias.has(t)) return; x.dias.add(t); x.od[t] = modo === 'subst' ? i + 1 : ++pos; });
      });
      const desc = `copiar rota de ${DIAS_LONGO[de]} de ${nome} para ${[...para].map(d => DIAS_LONGO[d]).join(', ')}`;
      const copia = {}; afetadas.forEach(({ l }) => copia[l.id] = { promotorId: l.promotorId || '', dias: l.dias || [], ordemDia: l.ordemDia || {} });
      await setDoc(doc(db, 'config', 'rotasBackup'), { em: Date.now(), desc, lojas: copia });
      b.textContent = 'Copiando…';
      const ops = [...afetadas.values()].map(({ l, dias, od }) => [l.id, { dias: [...dias].sort((a, c) => a - c), ordemDia: od, atualizado: Date.now() }]);
      for (let i = 0; i < ops.length; i += 400) { const wb = writeBatch(db); ops.slice(i, i + 400).forEach(([id, v]) => wb.update(doc(db, 'lojas', id), v)); await wb.commit(); }
      fechaModal(); toast(`Rota de ${DIAS_LONGO[de]} copiada para ${[...para].map(d => DIAS_LONGO[d]).join(', ')}.`, 6000);
    } catch (e) { b.disabled = false; b.textContent = 'Copiar'; toast(erroMsg(e), 6000); }
  };
}
async function restauraRota() {
  const bk = S.bkRotas; if (!bk) return;
  if (!(await confirma(`Voltar as rotas como estavam antes de "${bk.desc}" (${new Date(bk.em).toLocaleString('pt-BR')})? Mudanças feitas depois nesses clientes serão substituídas.`, 'Desfazer'))) return;
  try {
    const ops = Object.entries(bk.lojas || {}).filter(([id]) => S.lojas.some(l => l.id === id));
    for (let i = 0; i < ops.length; i += 400) { const wb = writeBatch(db); ops.slice(i, i + 400).forEach(([id, v]) => wb.update(doc(db, 'lojas', id), Object.assign({}, v, { atualizado: Date.now() }))); await wb.commit(); }
    await deleteDoc(doc(db, 'config', 'rotasBackup'));
    toast(`Rotas restauradas (${ops.length} clientes).`, 5000);
  } catch (e) { toast(erroMsg(e), 6000); }
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
// Libera a variável do mês no app: um documento por promotor, só com os clientes dele
const assinaturaVar = res => JSON.stringify(res.map(r => [r.pid, r.v, r.t, r.total, r.cumprida, r.zerar, r.cl.length])) + JSON.stringify(S.regras);
let publicando = false;
async function publicaVar(res, nomeMes, silencioso) {
  if (publicando || S.leitura) return; publicando = true;
  try {
    const R = S.regras; const em = Date.now(); const ops = [];
    res.forEach(r => ops.push([doc(db, 'minhaVariavel', V.mes + '_' + r.pid), { promotorId: r.pid, mes: V.mes, nomeMes, publicado: em, nome: r.nome,
      v: r.v, t: r.t, pct: r.pct, fator: r.fator, faixa: r.faixa, variavel: r.variavel, premio: r.premio, total: r.total, cumprida: r.cumprida, zerar: r.zerar,
      regras: { base: R.base, meta: R.meta, prop: !!R.prop }, faixas: FAIXAS.map(([l, v]) => ({ ate: l, valor: v })), dados: dataAtual(),
      clientes: r.cl.map(x => ({ cod: x.cod, nome: x.nome, cidade: x.cidade || '', v: x.v, t: x.t })) }]));
    await escreveEmLotes(ops, () => {});
    await setDoc(doc(db, 'variavel', V.mes), { publicado: em, assinatura: assinaturaVar(res) }, { merge: true });
    V.flags = Object.assign({}, V.flags, { publicado: em, assinatura: assinaturaVar(res) }); if (S.tab === 'var') setTimeout(renderVar, 0);
    if (!silencioso) toast(`Variável de ${nomeMes} liberada no app de ${res.length} promotores`);
  } catch (e) { toast(erroMsg(e)); } finally { publicando = false; }
}
async function retiraVar(nomeMes) {
  try {
    const s = await getDocs(query(collection(db, 'minhaVariavel'), where('mes', '==', V.mes)));
    for (const d of s.docs) await deleteDoc(d.ref);
    await setDoc(doc(db, 'variavel', V.mes), { publicado: deleteField(), assinatura: deleteField() }, { merge: true });
    if (V.flags) { delete V.flags.publicado; delete V.flags.assinatura; } if (S.tab === 'var') renderVar();
    toast(`Variável de ${nomeMes} retirada do app`);
  } catch (e) { toast(erroMsg(e)); }
}
// quadro das regras de premiação (Configurações e Variável)
function quadroPremiacao() {
  const R = S.regras; const pc = n => String(n).replace('.', ',') + '%';
  const linhas = FAIXAS.map(([l, v], i) => `<tr><td>${i ? 'de ' + pc(FAIXAS[i - 1][0]) + ' até menos de ' + pc(l) : 'menos de ' + pc(l)}</td><td class="r"><b>${brl(v)}</b></td></tr>`).join('') + `<tr><td>${pc(FAIXAS[FAIXAS.length - 1][0])} ou mais</td><td class="r"><b style="color:var(--crit)">${brl(0)}</b></td></tr>`;
  return `<div class="premio-box"><div class="label">Premiação sobre troca (% da troca sobre a venda da rota)</div>
    <table class="num" style="font-size:13px"><thead><tr><th>% de troca no mês</th><th class="r">Premiação</th></tr></thead><tbody>${linhas}</tbody></table>
    <div class="muted" style="font-size:12px;line-height:1.45">Troca = troca do cliente + troca ERP. Variável da rota: ${brl(R.base)} quando a rota é cumprida${R.meta ? `, proporcional à venda até o mínimo de ${brl(R.meta)} (ex.: vendeu metade do mínimo, recebe metade)` : ''}. ${R.prop ? 'A premiação também é proporcional à venda até o mínimo.' : 'A premiação é paga cheia, sem proporção.'} Faltas/atraso marcados zeram a premiação.</div></div>`;
}
function renderVar() {
  const c = $('#v-var');
  if (!c.dataset.ok) {
    c.dataset.ok = 1;
    c.innerHTML = `<div class="spread" style="flex-wrap:wrap"><h2>Variável promotor</h2><div class="row"><input type="month" id="var-mes" style="width:auto"><button class="btn primary" id="var-todos">Gerar PDF</button></div></div><div id="var-corpo" class="stack"></div>`;
    $('#var-mes').value = V.mes;
    $('#var-mes').onchange = e => { if (!e.target.value) return; V.mes = e.target.value; lsSet('np.var.mes', V.mes); assinaVar(); renderVar(); };
  }
  const box = $('#var-corpo');
  if (V.vendas === undefined || vazioCarregando()) { box.innerHTML = '<div class="empty">Carregando…</div>'; return; }
  const [y, m] = V.mes.split('-'); const nomeMes = new Date(+y, +m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  if (!V.vendas) { box.innerHTML = S.leitura ? `<div class="empty"><b>Sem vendas de ${nomeMes}</b>A variável deste mês ainda não foi lançada.</div>` : `<div class="empty"><b>Sem vendas de ${nomeMes}</b>Mande ao Claude os relatórios de vendas e trocas do mês. Ele devolve um arquivo para importar em Configurações > Importar arquivo.</div>`; $('#var-todos').hidden = true; return; }
  $('#var-todos').hidden = false;
  const { res, fora } = calcVar(V.vendas.itens, S.lojas, S.promotores, S.regras, V.flags && V.flags.flags);
  const pub = V.flags && V.flags.publicado;
  // já liberada e algo mudou (faltas, rota cumprida, regras, vendas): atualiza o app sozinho
  if (pub && !S.leitura && V.flags.assinatura !== assinaturaVar(res)) publicaVar(res, nomeMes, true);
  const barraPub = S.leitura ? '' : `<div class="card row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><div style="font-size:14px">${pub ? `<b style="color:var(--ok)">✓ Liberada no app dos promotores</b> desde ${new Date(pub).toLocaleDateString('pt-BR')} às ${hm(pub)}. Cada promotor vê só a dele; mudanças aqui atualizam o app sozinhas.` : '<b>Ainda não liberada no app.</b> Confira os valores e libere: cada promotor vê só a variável dele, com venda e troca de cada cliente.'}</div>
    <div class="row" style="gap:6px">${pub ? '<button class="btn sm" id="var-ret">Retirar do app</button>' : '<button class="btn primary sm" id="var-pub">Liberar no app dos promotores</button>'}</div></div>`;
  const tv = res.reduce((s, r) => s + r.v, 0), tt = res.reduce((s, r) => s + r.t, 0), tp = res.reduce((s, r) => s + r.total, 0);
  box.innerHTML = `<div class="note">${h(V.vendas.fonte || 'Vendas importadas')} · atualizado em ${dataAtual()}. Regras: variável ${brl(S.regras.base)} com mínimo de ${brl(S.regras.meta)}${S.regras.prop ? ' · premiação proporcional' : ''}.</div>
    ${barraPub}
    <details class="card"><summary style="cursor:pointer;font-weight:700">Como é calculada a premiação sobre troca</summary><div style="margin-top:10px">${quadroPremiacao()}</div></details>
    <div class="kpis num"><div class="kpi"><b>${brl(tv)}</b><span>Venda das rotas</span></div><div class="kpi"><b>${brl(tt)}</b><span>Trocas</span></div><div class="kpi"><b>${pctf(tv ? tt / tv * 100 : 0)}</b><span>% troca geral</span></div><div class="kpi"><b style="color:var(--ok)">${brl(tp)}</b><span>Total a pagar</span></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="num"><thead><tr><th>Promotor</th><th class="r">Venda</th><th class="r">Troca</th><th class="r">%</th><th class="r">Variável</th><th class="r">Premiação</th><th class="r">Total</th><th>Rota cumprida</th><th>Faltas</th><th></th></tr></thead><tbody>
    ${res.map(r => `<tr class="click" data-vp="${h(r.pid)}"><td><b>${h(r.nome.split(' ').slice(0, 2).join(' '))}</b><div class="muted" style="font-size:12px">${r.cl.length} clientes</div></td>
      <td class="r">${brl(r.v)}${r.fator < 1 ? `<div style="font-size:12px;color:var(--warn)">${Math.round(r.fator * 100)}% do mínimo</div>` : ''}</td><td class="r">${brl(r.t)}</td>
      <td class="r"><span class="pill ${r.faixa >= 375 ? 'ok' : r.faixa ? 'live' : 'no'}">${pctf(r.pct)}</span></td><td class="r">${brl(r.variavel)}</td><td class="r">${brl(r.premio)}</td><td class="r"><b>${brl(r.total)}</b></td>
      <td><input type="checkbox" data-fc="${h(r.pid)}" ${r.cumprida ? 'checked' : ''} ${S.leitura ? 'disabled' : ''} aria-label="Rota cumprida"></td><td><input type="checkbox" data-fz="${h(r.pid)}" ${r.zerar ? 'checked' : ''} ${S.leitura ? 'disabled' : ''} aria-label="Zerar premiação"></td>
      <td><button class="btn sm" data-rel="${h(r.pid)}">Relatório</button></td></tr>
      ${V.aberto[r.pid] ? `<tr><td colspan="10" style="background:var(--sunk)"><table class="num" style="font-size:13px"><thead><tr><th>Cód.</th><th>Cliente</th><th class="r">Venda</th><th class="r">Bonif.</th><th class="r">Dev. NF</th><th class="r">Troca</th><th class="r">%</th></tr></thead><tbody>${r.cl.map(x => `<tr><td>${h(x.cod)}</td><td>${h(x.nome)}</td><td class="r">${brl(x.v)}</td><td class="r">${brl(x.tb)}</td><td class="r">${brl(x.td)}</td><td class="r">${brl(x.t)}</td><td class="r">${x.v ? pctf(x.t / x.v * 100) : '—'}</td></tr>`).join('')}</tbody></table></td></tr>` : ''}`).join('')}
    </tbody><tfoot><tr><td><b>Total</b></td><td class="r"><b>${brl(tv)}</b></td><td class="r"><b>${brl(tt)}</b></td><td class="r">${pctf(tv ? tt / tv * 100 : 0)}</td><td class="r"><b>${brl(res.reduce((s, r) => s + r.variavel, 0))}</b></td><td class="r"><b>${brl(res.reduce((s, r) => s + r.premio, 0))}</b></td><td class="r"><b>${brl(tp)}</b></td><td></td><td></td><td></td></tr></tfoot></table></div></div>
    ${fora.length ? `<div class="card stack"><div class="spread"><h3>Vendas fora das rotas</h3><span class="muted num">${fora.length} clientes · ${brl(fora.reduce((s, x) => s + x.v, 0))}</span></div><div class="muted" style="font-size:13px">Clientes com venda que não estão na rota de nenhum promotor. Não entram no cálculo.</div></div>` : ''}`;
  box.querySelectorAll('tr[data-vp]').forEach(tr => tr.onclick = e => { if (['INPUT', 'BUTTON'].includes(e.target.tagName)) return; V.aberto[tr.dataset.vp] = !V.aberto[tr.dataset.vp]; renderVar(); });
  box.querySelectorAll('[data-fc]').forEach(i => i.onchange = () => setFlag(i.dataset.fc, 'cumprida', i.checked));
  box.querySelectorAll('[data-fz]').forEach(i => i.onchange = () => setFlag(i.dataset.fz, 'zerar', i.checked));
  box.querySelectorAll('[data-rel]').forEach(b => b.onclick = e => { e.stopPropagation(); relatorio(res.find(r => r.pid === b.dataset.rel), nomeMes); });
  $('#var-todos').onclick = () => { // escolher quais promotores saem no PDF (ou todos)
    abreModal(`<div class="spread"><h3>PDF da variável · ${h(nomeMes)}</h3><button class="btn ghost" id="pv-x">Fechar</button></div>
      <label class="row" style="gap:8px;font-weight:700"><input type="checkbox" id="pv-todos" checked> Marcar todos</label>
      <div class="stack" style="gap:6px;max-height:50vh;overflow:auto">${res.map(r => `<label class="row" style="gap:8px"><input type="checkbox" data-pv="${h(r.pid)}" checked> ${h(r.nome)} <span class="muted num" style="font-size:12px;margin-left:auto">${brl(r.total)}</span></label>`).join('')}</div>
      <div class="row end"><button class="btn" id="pv-c">Cancelar</button><button class="btn primary" id="pv-s">Gerar PDF</button></div>`);
    const cks = () => [...document.querySelectorAll('[data-pv]')];
    $('#pv-todos').onchange = e => cks().forEach(c => c.checked = e.target.checked);
    cks().forEach(c => c.onchange = () => { $('#pv-todos').checked = cks().every(x => x.checked); });
    $('#pv-x').onclick = $('#pv-c').onclick = fechaModal;
    $('#pv-s').onclick = () => { const ids = cks().filter(c => c.checked).map(c => c.dataset.pv); if (!ids.length) return toast('Marque pelo menos um promotor.'); fechaModal(); baixaPDF(res.filter(r => ids.includes(r.pid)), nomeMes); };
  };
  const bp = $('#var-pub'); if (bp) bp.onclick = async () => { if (await confirma(`Liberar a variável de ${nomeMes} no app? Cada um dos ${res.length} promotores passa a ver a dele (venda, troca por cliente, premiação e total).`, 'Liberar')) publicaVar(res, nomeMes); };
  const br = $('#var-ret'); if (br) br.onclick = async () => { if (await confirma(`Retirar a variável de ${nomeMes} do app dos promotores?`, 'Retirar')) retiraVar(nomeMes); };
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
    const foto = S.rostos[r.pid] && S.rostos[r.pid].foto; const nx = foto ? 31 : 12; // foto do promotor, como no PDF da rota
    if (foto) try { docp.setFillColor(244, 188, 28); docp.roundedRect(11.3, 33.3, 17.4, 17.4, 2.5, 2.5, 'F'); docp.addImage(foto, 'JPEG', 12, 34, 16, 16); } catch (e) {}
    docp.setTextColor(23, 25, 37); docp.setFontSize(17); docp.text(r.nome, nx, 41.5); docp.setFont(undefined, 'normal');
    docp.setFontSize(8.5); docp.setTextColor(92, 96, 112); docp.text('Vendas e trocas atualizadas em ' + dataAtual(), nx, 47);
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
  const filtro = lsGet('np.eq.filtro') || 'ativos';
  const nAt = S.promotores.filter(p => p.ativo !== false).length, nIn = S.promotores.length - nAt;
  const lista = S.promotores.filter(p => filtro === 'todos' || (filtro === 'inativos' ? p.ativo === false : p.ativo !== false));
  c.innerHTML = `<div class="spread"><h2>Equipe e acessos</h2><div class="row"><div class="seg" id="eq-filtro">${[['ativos', `Ativos (${nAt})`], ['inativos', `Inativos (${nIn})`], ['todos', `Todos (${S.promotores.length})`]].map(([k, t]) => `<button data-f="${k}" aria-pressed="${k === filtro}">${t}</button>`).join('')}</div><button class="btn primary" id="eq-novo">+ Novo promotor</button></div></div>
    ${S.erroRostos ? `<div class="note crit">Não consegui ler as fotos do rosto no banco (${h(S.erroRostos)}). Confira se as regras do Firebase têm o bloco <b>rostos</b> e publique de novo.</div>` : `<div class="muted" style="font-size:12px">Fotos de rosto cadastradas no banco: ${S.qtdRostos ?? '…'}</div>`}
    <div class="note">O promotor entra no app <b>pelo rosto</b>. Para colocar o app num celular, clique em <b>Ativar celular</b> e aponte a câmera do celular para o QR. Login e senha ficam só com a gestão. Endereço do app: <b>${h(location.origin + location.pathname.replace(/gestao\.html$/, ''))}</b></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Promotor</th><th>Contato</th><th>Lojas</th><th>Login</th><th>Senha</th><th>Termos</th><th></th></tr></thead><tbody>
    ${lista.length ? '' : `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Nenhum promotor ${filtro === 'inativos' ? 'inativo' : 'ativo'}.</td></tr>`}
    ${lista.map(p => { const a = S.acessos[p.id]; return `<tr><td><div class="row" style="gap:10px;flex-wrap:nowrap">${avatar(p.id, 52)}<div><b>${h(p.nome)}</b>${p.ativo === false ? ' <span class="tag no">inativo</span>' : ''}${S.rostos[p.id] ? '' : ' <span class="tag y">sem foto</span>'}</div></div><div class="muted" style="font-size:12px">${h(p.base || '')}${p.inicioApp ? ` · ${p.inicioApp > ymd(new Date()) ? '<span class="tag y">em teste</span> app a partir de' : 'app desde'} ${dataBR(p.inicioApp)}` : ''}</div></td>
      <td style="font-size:13px;white-space:normal;min-width:240px">${p.telefone ? `📞 ${h(p.telefone)}` : '<span class="muted">sem telefone</span>'}${p.email ? `<div class="muted">✉ ${h(p.email)}</div>` : ''}${p.endereco || p.cidadeRes ? `<div class="muted">🏠 ${h([p.endereco, [p.cidadeRes, p.ufRes].filter(Boolean).join('/'), p.cepRes].filter(Boolean).join(' · '))}</div>` : '<div class="muted">sem endereço</div>'}</td><td class="num">${S.lojas.filter(l => l.promotorId === p.id).length}</td>
      <td>${a ? `<b>${h(a.usuario)}</b>` : '<span class="tag y">sem acesso</span>'}</td><td class="num">${a ? h(a.codigo) : '—'}</td><td>${S.termos[p.id] && S.termos[p.id].versao === VERSAO ? `<button class="btn sm ghost" data-tm="${h(p.id)}" title="Baixar PDF dos termos">✓ ${new Date(S.termos[p.id].assinadoEm).toLocaleDateString('pt-BR')}</button>` : '<span class="tag y">pendente</span>'}</td>
      <td class="r"><div class="row" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap">${a ? celularCel(p) : ''}<button class="btn sm" data-ed="${h(p.id)}">${a ? 'Editar' : 'Editar e criar acesso'}</button></div></td></tr>`; }).join('')}
    </tbody></table></div></div>
    <div class="card stack"><div class="spread"><h3>Gestores só de monitoramento</h3><span class="muted" style="font-size:12px">Veem só a Torre de controle. Não alteram nada.</span></div>
      <div class="row" style="gap:8px;align-items:end;flex-wrap:wrap"><label class="field" style="flex:1 1 140px"><span>Usuário</span><input type="text" id="gl-u" autocapitalize="none" autocomplete="off" placeholder="ex.: gestao"></label>
      <label class="field" style="flex:1 1 180px"><span>Nome (opcional)</span><input type="text" id="gl-n" autocomplete="off" placeholder="ex.: Supervisor Volta Redonda"></label>
      <label class="field" style="flex:1 1 140px"><span>Senha (mín. 6 caracteres)</span><input type="text" id="gl-s" autocomplete="off"></label><button class="btn primary" id="gl-c">Criar acesso</button></div>
      <div class="muted" style="font-size:12px">Para entrar: mesmo endereço da Gestão, campo "E-mail ou usuário" com o usuário criado aqui.</div>
      <div class="label" style="margin-top:6px">Cadastrados (${(S.leitores || []).length})</div>
      ${(S.leitores || []).length ? `<div class="table-wrap"><table><thead><tr><th>Usuário</th><th>Nome</th><th>Criado em</th><th></th></tr></thead><tbody>${S.leitores.slice().sort((a, b) => a.usuario.localeCompare(b.usuario)).map(x => `<tr><td><b>${h(x.usuario)}</b></td><td>${h(x.nome || '—')}</td><td class="num">${new Date(x.criado).toLocaleDateString('pt-BR')}${x.senhaTrocada ? `<div class="muted" style="font-size:11px">senha trocada em ${new Date(x.senhaTrocada).toLocaleDateString('pt-BR')}</div>` : ''}</td>
        <td class="r"><div class="row" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm" data-el="${h(x.id)}">Editar</button><button class="btn sm danger" data-rl="${h(x.id)}">Excluir</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="muted" style="font-size:14px">Nenhum gestor de monitoramento cadastrado.</div>'}</div>`;
  $('#eq-novo').onclick = () => editaPromotor(null);
  $('#gl-c').onclick = async () => {
    const u = semAcento($('#gl-u').value.trim()).replace(/[^a-z0-9._-]/g, ''), sn = $('#gl-s').value;
    if (!u) return toast('Digite o usuário.'); if (sn.length < 6) return toast('A senha precisa ter pelo menos 6 caracteres.');
    const b = $('#gl-c'); b.disabled = true; b.textContent = 'Criando…';
    try { const uid = await criarContaMonitor(`${u}@${DOMINIO_GESTOR}`, sn); await setDoc(doc(db, 'leitores', uid), { usuario: u, nome: $('#gl-n').value.trim(), criado: Date.now() }); $('#gl-s').value = ''; $('#gl-u').value = ''; $('#gl-n').value = ''; toast(`Acesso "${u}" criado. Ele entra na Gestão com esse usuário e a senha.`, 6000); }
    catch (e) { toast(String(e.code).includes('email-already-in-use') ? 'Esse usuário já existe.' : String(e.code).includes('permission') ? 'O banco recusou: publique as regras novas do Firebase (bloco "leitores").' : erroMsg(e), 7000); }
    finally { b.disabled = false; b.textContent = 'Criar acesso'; }
  };
  c.querySelectorAll('[data-el]').forEach(b => b.onclick = () => editaLeitor(S.leitores.find(y => y.id === b.dataset.el)));
  c.querySelectorAll('[data-rl]').forEach(b => b.onclick = async () => { const x = S.leitores.find(y => y.id === b.dataset.rl); if (await confirma(`Excluir o acesso de monitoramento "${x.usuario}"? Ele não consegue mais entrar na Gestão.`, 'Excluir')) deleteDoc(doc(db, 'leitores', x.id)).then(() => toast('Acesso excluído'), e => toast(erroMsg(e))); });
  $('#eq-filtro').querySelectorAll('button').forEach(b => b.onclick = () => { lsSet('np.eq.filtro', b.dataset.f); renderEquipe(); });
  c.querySelectorAll('[data-at]').forEach(b => b.onclick = () => ativarCelular(S.promotores.find(p => p.id === b.dataset.at)));
  c.querySelectorAll('[data-dv]').forEach(b => b.onclick = () => desvincularCelular(S.promotores.find(p => p.id === b.dataset.dv)));
  c.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => pdfTermos(S.termos[b.dataset.tm]));
  c.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editaPromotor(S.promotores.find(p => p.id === b.dataset.ed)));
}
function sugereUsuario(nome, pid) { const base = usuarioDeNome(nome) || 'promotor'; let u = base, n = 2; while (Object.entries(S.acessos).some(([k, x]) => x.usuario === u && k !== pid)) u = base + n++; return u; }
function codigoNovo() { const usados = new Set(Object.values(S.acessos).map(a => a.codigo)); let c; do { c = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (usados.has(c) || new Set(c).size < 2 || ['1234', '4321', '0123'].includes(c)); return c; }
// Cadastro do promotor + login e senha do app, tudo na mesma ficha
function editaPromotor(p) {
  const novo = !p; p = p || { ativo: true };
  const a = novo ? null : S.acessos[p.id];
  abreModal(`<div class="spread"><h3>${novo ? 'Novo promotor' : h(p.nome)}</h3><button class="btn ghost" id="ep-x">Fechar</button></div>
    <form id="ep" class="stack">
    <div class="row" style="gap:14px;align-items:center;flex-wrap:nowrap"><div id="ep-foto">${fotoFicha(novo ? null : S.rostos[p.id])}</div>
      <div class="stack" style="gap:6px;flex:1"><div class="label">Foto do rosto (para entrar no app)</div>
      <label class="btn sm" style="cursor:pointer;width:fit-content">${!novo && S.rostos[p.id] ? 'Trocar foto' : 'Anexar foto'}<input type="file" id="ep-arq" accept="image/*" hidden></label>
      <div class="muted" style="font-size:12px" id="ep-fmsg">Foto de frente, rosto inteiro, boa luz, sem óculos escuros ou boné.</div></div></div>
    <label class="field"><span>Nome completo</span><input type="text" name="nome" value="${h(p.nome || '')}" required></label>
    <div class="grid2" style="gap:10px"><label class="field"><span>Login do app</span><input type="text" name="usuario" autocapitalize="none" autocomplete="off" value="${h(a ? a.usuario : '')}" placeholder="${h(sugereUsuario(p.nome || '', p.id))}"></label>
    <label class="field"><span>Senha do app (4 números)</span><input type="text" name="codigo" inputmode="numeric" maxlength="4" autocomplete="off" value="${h(a ? a.codigo : '')}" placeholder="ex.: ${codigoNovo()}"></label></div>
    <div class="muted" style="font-size:12.5px;margin-top:-6px">${a ? 'Ao mudar o login ou a senha, o promotor passa a entrar com os novos na hora. Quem estiver com o app aberto precisará entrar de novo.' : 'Deixe em branco para criar o acesso depois. O login usa só letras minúsculas e números, sem espaço nem acento.'}</div>
    <label class="field"><span>Base (cidade)</span><input type="text" name="base" value="${h(p.base || '')}"></label>
    <div class="label" style="margin-top:4px">Residência (para o deslocamento casa → loja)</div>
    <label class="field"><span>Endereço (rua, número, complemento, bairro)</span><input type="text" name="endereco" value="${h(p.endereco || '')}"></label>
    <div class="row" style="gap:10px"><label class="field" style="flex:2"><span>Cidade</span><input type="text" name="cidadeRes" value="${h(p.cidadeRes || '')}"></label><label class="field" style="flex:1"><span>UF</span><input type="text" name="ufRes" maxlength="2" value="${h(p.ufRes || 'RJ')}"></label><label class="field" style="flex:1.4"><span>CEP</span><input type="text" name="cepRes" value="${h(p.cepRes || '')}"></label></div>
    <div class="muted" style="font-size:12px">${p.casa ? `📍 Casa localizada no mapa (${p.casa.nivel === 'rua' ? 'pela rua' : 'aproximada pelo bairro/cidade'}).` : 'A casa é localizada no mapa automaticamente ao salvar.'}</div>
    <label class="field"><span>Telefone</span><input type="tel" name="telefone" value="${h(p.telefone || '')}"></label>
    <label class="field"><span>E-mail</span><input type="email" name="email" value="${h(p.email || '')}"></label>
    <label class="field"><span>Início do uso do app (antes desta data é só teste: não conta banco de horas, faltas nem rota)</span><input type="date" name="inicioApp" value="${h(p.inicioApp || '')}"></label>
    <label class="field"><span>Usuário de teste: usa a rota de (só simulação; não mexe no promotor escolhido, não conta banco de horas nem variável)</span><select name="espelhoDe"><option value="">— Não é usuário de teste —</option>${S.promotores.filter(x => x.id !== p.id && !x.espelhoDe && x.ativo !== false).map(x => `<option value="${h(x.id)}" ${p.espelhoDe === x.id ? 'selected' : ''}>${h(x.nome)}</option>`).join('')}</select></label>
    <label class="field"><span>Situação</span><select name="ativo"><option value="1" ${p.ativo !== false ? 'selected' : ''}>Ativo</option><option value="" ${p.ativo === false ? 'selected' : ''}>Inativo (não aparece nas rotas e não entra no app)</option></select></label>
    ${!novo ? `<div class="note ${S.termos[p.id] && S.termos[p.id].versao === VERSAO ? 'ok' : 'warn'}" style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap">${S.termos[p.id] && S.termos[p.id].versao === VERSAO ? `<span>Termos LGPD e do aparelho assinados em ${new Date(S.termos[p.id].assinadoEm).toLocaleString('pt-BR')}</span><span class="row" style="gap:6px"><button type="button" class="btn sm" id="ep-tpdf">Baixar PDF</button><button type="button" class="btn sm ghost danger" id="ep-tre">Pedir nova assinatura</button></span>` : '<span>Termos ainda não assinados. O app pede a assinatura no primeiro acesso do promotor.</span>'}</div>` : ''}
    <div id="ep-msg"></div>
    <div class="row end"><button class="btn primary" type="submit" id="ep-s">Salvar</button></div></form>`);
  $('#ep-x').onclick = fechaModal;
  const tp = $('#ep-tpdf'); if (tp) tp.onclick = () => pdfTermos(S.termos[p.id]);
  const tr = $('#ep-tre'); if (tr) tr.onclick = async () => { const t = S.termos[p.id]; if (await confirma(`Apagar a assinatura atual de ${p.nome.split(' ')[0]}? Antes, baixe o PDF para arquivo. No próximo acesso o app pede para assinar de novo.`, 'Apagar e pedir de novo')) deleteDoc(doc(db, 'termos', t.id)).then(() => toast('Assinatura apagada. O app vai pedir de novo.'), e => toast(erroMsg(e))); };
  let novaFoto = null;
  $('#ep-arq').onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return; const fm = $('#ep-fmsg');
    fm.textContent = 'Lendo o rosto da foto… (na primeira vez demora alguns segundos)';
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); });
      const lf = await leRostoFoto(img); const r = lf && lf.r;
      if (!r) { novaFoto = null; fm.innerHTML = '<span style="color:var(--crit)">Não encontrei um rosto nessa foto. Use uma foto de frente, mais de perto.</span>'; return; }
      novaFoto = { foto: recorteRosto(lf.fonte, r.box), desc: r.desc };
      $('#ep-foto').innerHTML = fotoFicha(novaFoto); fm.innerHTML = '<span style="color:var(--ok)">Rosto encontrado. Clique em Salvar para gravar.</span>';
    } catch (err) { fm.textContent = 'Não consegui ler a foto: ' + (err.message || err); }
  };
  $('#ep').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const v = { nome: String(f.get('nome')).trim(), base: String(f.get('base')).trim(), telefone: String(f.get('telefone')).trim(), email: String(f.get('email')).trim(), ativo: !!f.get('ativo'), inicioApp: String(f.get('inicioApp') || ''), espelhoDe: String(f.get('espelhoDe') || ''), atualizado: Date.now(),
      endereco: String(f.get('endereco') || '').trim(), cidadeRes: String(f.get('cidadeRes') || '').trim(), ufRes: String(f.get('ufRes') || '').trim().toUpperCase(), cepRes: String(f.get('cepRes') || '').trim() };
    const mudouCasa = novo || v.endereco !== (p.endereco || '') || v.cidadeRes !== (p.cidadeRes || '') || v.cepRes !== (p.cepRes || '');
    const usuario = semAcento(String(f.get('usuario') || '').trim()).replace(/\s+/g, '');
    const codigo = String(f.get('codigo') || '').trim();
    const id = novo ? semAcento(v.nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : p.id;
    const msg = t => { $('#ep-msg').innerHTML = t ? `<div class="note crit">${h(t)}</div>` : ''; };
    if (!v.nome) return msg('Informe o nome.');
    if (novo && S.promotores.some(x => x.id === id)) return msg('Já existe um promotor com esse nome.');
    const mexeuAcesso = a ? (usuario !== a.usuario || codigo !== a.codigo) : !!(usuario || codigo);
    if (mexeuAcesso) {
      if (!usuario || !codigo) return msg('Para o acesso ao app, preencha o login e a senha.');
      if (!/^[a-z0-9]{3,20}$/.test(usuario)) return msg('O login deve ter de 3 a 20 letras minúsculas ou números, sem espaço nem acento.');
      if (!/^\d{4}$/.test(codigo)) return msg('A senha precisa ter exatamente 4 números.');
      const dono = Object.entries(S.acessos).find(([k, x]) => x.usuario === usuario && k !== id);
      if (dono) return msg(`O login "${usuario}" já é de ${promNome(dono[0])}.`);
    }
    const b = $('#ep-s'); b.disabled = true; b.textContent = 'Salvando…';
    try {
      await setDoc(doc(db, 'promotores', id), v, { merge: true });
      if (mudouCasa) localizaCasa(Object.assign({ id }, v));
      if (novaFoto) await setDoc(doc(db, 'rostos', id), { foto: novaFoto.foto, desc: novaFoto.desc, atualizado: Date.now() });
      if (mexeuAcesso) await salvaAcesso(id, a, usuario, codigo);
      fechaModal(); toast(mexeuAcesso ? `Salvo. ${v.nome.split(' ')[0]} entra com login ${usuario} e senha ${codigo}.` : 'Promotor salvo', 6000);
    } catch (err) { b.disabled = false; b.textContent = 'Salvar'; msg(erroAcesso(err)); }
  };
}
const fotoFicha = r => r && r.foto ? `<img src="${r.foto}" alt="Foto do rosto" style="width:84px;height:84px;border-radius:50%;object-fit:cover">` : '<div class="av" style="width:84px;height:84px;background:var(--sunk);color:var(--muted);font-size:12px">sem foto</div>';
// Editar gestor de monitoramento: nome e troca de senha (a troca pede a senha atual dele)
function editaLeitor(x) {
  if (!x) return;
  abreModal(`<div class="spread"><h3>Editar gestor · ${h(x.usuario)}</h3><button class="btn ghost" id="el-x">Fechar</button></div>
    <label class="field"><span>Usuário (não muda)</span><input type="text" value="${h(x.usuario)}" disabled></label>
    <label class="field"><span>Nome</span><input type="text" id="el-n" value="${h(x.nome || '')}" placeholder="ex.: Supervisor Volta Redonda"></label>
    <details><summary style="cursor:pointer;font-weight:600">Trocar a senha</summary>
      <label class="field" style="margin-top:8px"><span>Senha atual</span><input type="text" id="el-a" autocomplete="off"></label>
      <label class="field"><span>Senha nova (mín. 6 caracteres)</span><input type="text" id="el-s" autocomplete="off"></label>
      <div class="muted" style="font-size:12px">Esqueceu a senha atual? Exclua o acesso e crie de novo com outro usuário.</div></details>
    <div id="el-m" class="muted" style="font-size:13px;min-height:18px"></div>
    <div class="row end"><button class="btn" id="el-c">Cancelar</button><button class="btn primary" id="el-ok">Salvar</button></div>`);
  $('#el-x').onclick = $('#el-c').onclick = fechaModal;
  $('#el-ok').onclick = async () => {
    const a = $('#el-a').value, sn = $('#el-s').value, b = $('#el-ok'); const msg = t => $('#el-m').textContent = t;
    if (sn && sn.length < 6) return msg('A senha nova precisa ter pelo menos 6 caracteres.');
    if (sn && !a) return msg('Para trocar a senha, digite a senha atual.');
    b.disabled = true; b.textContent = 'Salvando…';
    try {
      const upd = { nome: $('#el-n').value.trim() };
      if (sn) { await trocarSenhaConta(`${x.usuario}@${DOMINIO_GESTOR}`, a, sn); upd.senhaTrocada = Date.now(); }
      await updateDoc(doc(db, 'leitores', x.id), upd); fechaModal(); toast(sn ? 'Senha trocada e dados salvos.' : 'Dados salvos.');
    } catch (e) { b.disabled = false; b.textContent = 'Salvar'; msg(/invalid-credential|wrong-password/.test(String(e.code)) ? 'A senha atual não confere.' : erroMsg(e)); }
  };
}
// Coluna do celular: ativado (com aparelho e último acesso) ou botão para ativar
function celularCel(p) {
  const ap = (S.aparelhos || {})[p.id];
  if (!ap) return `<button class="btn sm primary" data-at="${h(p.id)}" title="Gera o QR para ativar o celular do promotor">Ativar celular</button>`;
  const quando = t => !t ? '—' : ymd(new Date(t)) === ymd(new Date()) ? 'hoje ' + hm(t) : new Date(t).toLocaleDateString('pt-BR') + ' ' + hm(t);
  return `<div style="text-align:right;line-height:1.35"><span class="tag ok">📱 Celular ativado</span><div class="muted" style="font-size:11px">${h([ap.modelo, ap.sistema].filter(Boolean).join(' · ') || 'aparelho')}</div><div class="muted" style="font-size:11px">desde ${h(new Date(ap.ativadoEm).toLocaleDateString('pt-BR'))} · visto ${h(quando(ap.visto))}</div></div><button class="btn sm" data-at="${h(p.id)}" title="Mostra o código fixo / QR do promotor">Código</button><button class="btn sm" data-dv="${h(p.id)}" title="Tira o app deste celular e cancela o código">Desvincular</button>`;
}
// Desvincula o celular atual: apaga o registro do aparelho e troca a senha interna (o celular perde o acesso)
async function desvincularCelular(p) {
  const a = S.acessos[p.id]; const ap = (S.aparelhos || {})[p.id];
  if (!(await confirma(`Desvincular o celular de ${p.nome.split(' ')[0]}${ap && ap.modelo ? ' (' + ap.modelo + ')' : ''}? O app sai desse celular e o código atual deixa de valer. Para usar de novo (nele ou em outro), clique em "Ativar celular": sai um código novo.`, 'Desvincular'))) return;
  try {
    await deleteDoc(doc(db, 'aparelhos', p.id));
    if (a && a.ultAtiv) await deleteDoc(doc(db, 'ativacoes', a.ultAtiv)).catch(() => {});
    if (a) { let novo; do { novo = String(1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 9000); } while (novo === a.codigo); await gravaAcesso(p.id, a.usuario, novo, a.codigo); }
    toast(`Celular de ${p.nome.split(' ')[0]} desvinculado.`, 5000);
  } catch (e) { toast(String(e && e.code).includes('permission') ? 'O banco recusou: publique as regras novas do Firebase (bloco "aparelhos").' : erroAcesso(e), 7000); }
}
// Ativação do celular: código FIXO do promotor (vale até desvincular o celular aqui); o promotor não precisa saber login nem senha
async function ativarCelular(p) {
  const a = S.acessos[p.id]; if (!a) return toast('Crie o acesso do promotor primeiro (Editar).');
  if (!S.rostos[p.id] && !(await confirma(`${p.nome.split(' ')[0]} ainda não tem foto do rosto cadastrada. Sem a foto, o app abre sem reconhecimento facial. Gerar o QR mesmo assim?`, 'Gerar QR'))) return;
  const expira = Date.now() + 5 * 365 * 864e5; // fixo: só deixa de valer ao desvincular
  let cod = null;
  if (a.ultAtiv) { try { const x = await getDoc(doc(db, 'ativacoes', a.ultAtiv)); if (x.exists() && x.data().usuario === a.usuario && x.data().codigo === a.codigo) cod = a.ultAtiv; } catch (e) {} }
  if (!cod) { const ALF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; cod = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => ALF[x % ALF.length]).join(''); }
  try { await setDoc(doc(db, 'ativacoes', cod), { usuario: a.usuario, codigo: a.codigo, promotorId: p.id, expira, criado: Date.now() }, { merge: true }); if (a.ultAtiv !== cod) await setDoc(doc(db, 'acessos', p.id), { ultAtiv: cod }, { merge: true }).catch(() => {}); }
  catch (e) { return toast(String(e && e.code).includes('permission') ? 'O banco recusou: publique as regras novas do Firebase (bloco "ativacoes").' : erroMsg(e), 7000); }
  const url = location.origin + location.pathname.replace(/gestao\.html$/, '') + 'index.html#ativar=' + cod;
  const cf = cod.slice(0, 4) + '-' + cod.slice(4);
  abreModal(`<div class="spread"><h3>Ativar celular · ${h(p.nome.split(' ')[0])}</h3><button class="btn ghost" id="qa-x">Fechar</button></div>
    <p class="muted" style="margin:0;font-size:14px">No celular do promotor, abra a câmera e aponte para o QR (ou abra o app e digite o código). <b>O código é fixo do promotor</b>: se ele sair do app ou apagar o app, usa o mesmo código de novo. Só deixa de valer quando você <b>desvincula</b> o celular aqui.</p>
    <div id="qa-qr" style="display:grid;place-items:center;background:#fff;padding:16px;border-radius:12px"></div>
    <div style="text-align:center;font:800 28px var(--f-body);letter-spacing:.14em" class="num">${cf}</div>
    <div class="row end"><a class="btn" target="_blank" rel="noopener" href="https://wa.me/${(p.telefone || '').replace(/\D/g, '') ? '55' + (p.telefone || '').replace(/\D/g, '') : ''}?text=${encodeURIComponent('Ative o app de rotas da Nova Penedo neste celular: ' + url)}">Enviar pelo WhatsApp</a><button class="btn primary" id="qa-cp">Copiar link</button></div>`);
  $('#qa-x').onclick = fechaModal;
  $('#qa-cp').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch (e) { prompt('Copie o link:', url); } };
  const desenha = () => { if (!window.QRCode) return setTimeout(desenha, 300); const el = $('#qa-qr'); if (el) new QRCode(el, { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M }); };
  desenha();
}
function erroAcesso(e) {
  const c = (e && e.code) || '';
  if (c.includes('email-already-in-use')) return 'Esse login já existe no sistema de acesso (pode ser de um cadastro antigo). Escolha outro login.';
  if (c.includes('invalid-credential') || c.includes('wrong-password')) return 'Não consegui trocar a senha porque a senha antiga gravada não confere. Troque também o login para criar um acesso novo.';
  return erroMsg(e);
}
// Cria, troca a senha ou troca o login do promotor
async function salvaAcesso(pid, a, usuario, codigo) {
  if (a && a.usuario === usuario) return gravaAcesso(pid, usuario, codigo, a.codigo); // só a senha mudou
  const uid = await criarAcessoPromotor(usuario, codigo, null); // login novo: cria a conta nova
  await setDoc(doc(db, 'usuarios', uid), { promotorId: pid, usuario });
  await setDoc(doc(db, 'acessos', pid), { usuario, codigo, uid, atualizado: Date.now() });
  if (a) { // desliga o login antigo
    if (a.uid && a.uid !== uid) await deleteDoc(doc(db, 'usuarios', a.uid)).catch(() => {});
    await apagarContaPromotor(a.usuario, a.codigo);
  }
}
async function gravaAcesso(pid, usuario, codigo, codigoAntigo) {
  const uid = await criarAcessoPromotor(usuario, codigo, codigoAntigo);
  await setDoc(doc(db, 'usuarios', uid), { promotorId: pid, usuario });
  await setDoc(doc(db, 'acessos', pid), { usuario, codigo, uid, atualizado: Date.now() });
  return uid;
}

// PDF dos termos assinados, com a foto da assinatura e os dados do registro
async function pdfTermos(t) {
  if (!t) return; const J = window.jspdf && window.jspdf.jsPDF; if (!J) return toast('O gerador de PDF ainda está carregando. Tente de novo em alguns segundos.');
  const logo = await carregaImg(LOGO).catch(() => null);
  const d = new J({ unit: 'mm', format: 'a4' }); const W = 210, M = 16; let y = 0;
  const topo = () => { d.setFillColor(23, 25, 37); d.rect(0, 0, W, 22, 'F'); d.setFillColor(244, 188, 28); d.rect(0, 22, W, 1.4, 'F'); if (logo) try { d.addImage(logo, 'PNG', M, 5, 62, 11.9); } catch (e) {} d.setTextColor(255, 255, 255); d.setFontSize(8.5); d.text('TERMOS ASSINADOS · versão ' + t.versao, W - M, 13.5, { align: 'right' }); d.setTextColor(23, 25, 37); y = 32; };
  const texto = (tx, tam = 9.2) => { d.setFontSize(tam); d.setFont(undefined, 'normal'); tx.split('\n').forEach((par, i) => { const negrito = i === 0 || /^\d+\. [^a-z]+$/.test(par.trim()); d.setFont(undefined, negrito ? 'bold' : 'normal'); d.splitTextToSize(par || ' ', W - 2 * M).forEach(l => { if (y > 280) { d.addPage(); topo(); } d.text(l, M, y); y += tam * 0.47; }); }); };
  topo(); texto(t.textoLgpd); y += 4;
  d.setFontSize(9.2); d.setFont(undefined, 'bold'); d.text('[X] Li e concordo com o tratamento dos meus dados descritos acima.', M, y); y += 5; d.text('[X] Autorizo, de forma específica, o uso da imagem do meu rosto e da biometria facial.', M, y);
  d.addPage(); topo(); texto(t.textoAparelho); y += 4; d.setFont(undefined, 'bold'); d.text('[X] Li e concordo com o termo de uso do aparelho.', M, y); y += 10;
  if (y > 200) { d.addPage(); topo(); }
  d.setFillColor(241, 242, 245); d.roundedRect(M, y, W - 2 * M, 74, 2, 2, 'F'); const y0 = y + 7;
  d.setFont(undefined, 'bold'); d.setFontSize(11); d.text('REGISTRO DA ASSINATURA ELETRÔNICA', M + 4, y0);
  if (t.selfie) try { const ip = d.getImageProperties(t.selfie); let w = 46, hh = w * ip.height / ip.width; if (hh > 62) { hh = 62; w = hh * ip.width / ip.height; } d.addImage(t.selfie, 'JPEG', W - M - 4 - w, y0 - 3, w, hh); } catch (e) {}
  const ref = S.rostos[t.promotorId]; if (ref && ref.foto) try { d.addImage(ref.foto, 'JPEG', W - M - 74, y0 - 3, 22, 22); d.setFontSize(6.5); d.setFont(undefined, 'normal'); d.text('foto do cadastro', W - M - 74, y0 + 22); } catch (e) {}
  const A = t.aparelho || {}; const rec = t.recebido && t.recebido.toMillis ? new Date(t.recebido.toMillis()).toLocaleString('pt-BR') : '—';
  const L = [['Assinado por', `${t.nome} · CPF ${t.cpf}`], ['Data e hora no celular', new Date(t.assinadoEm).toLocaleString('pt-BR')], ['Recebido no sistema', rec],
    ['Localização', t.gps ? `${t.gps.lat.toFixed(6)}, ${t.gps.lng.toFixed(6)} (precisão ${t.gps.prec} m)` : 'não disponível'],
    ['Aparelho', `${A.modelo || 'modelo não informado'} · ${A.sistema || ''} · ${A.navegador || ''}`], ['Código do aparelho', `${A.id || '—'} · tela ${A.tela || '—'}`],
    ['Linha / propriedade', `${t.numero} · ${t.propriedade === 'empresa' ? 'aparelho da empresa' : 'aparelho particular'}`],
    ['Conferência do rosto', t.rostoConferido ? `confere com o cadastro (diferença ${n2(t.rostoDist)}; limite ${n2(LIMITE)})` : 'sem foto de cadastro na data; selfie registrada'],
    ['Login no app', (Object.values(S.acessos).find(a => a.uid === t.uid) || {}).usuario || t.uid],
    ['Código de integridade (SHA-256)', 'LGPD ' + (t.hashLgpd || '').slice(0, 24) + '…  Aparelho ' + (t.hashAparelho || '').slice(0, 24) + '…']];
  let yy = y0 + 7; L.forEach(([k, v]) => { d.setFontSize(7.2); d.setFont(undefined, 'normal'); d.setTextColor(92, 96, 112); d.text(k.toUpperCase(), M + 4, yy); d.setFontSize(8.6); d.setTextColor(23, 25, 37); d.text(d.splitTextToSize(String(v), W - 2 * M - 64)[0], M + 4, yy + 3.6); yy += 6.4; });
  d.setFontSize(7.5); d.setTextColor(140, 144, 156); d.text('Documento gerado em ' + new Date().toLocaleString('pt-BR') + ' a partir do registro eletrônico do aplicativo Rota Nova Penedo.', M, 290);
  d.save(`Termos ${t.nome.split(' ')[0]} ${new Date(t.assinadoEm).toISOString().slice(0, 10)}.pdf`);
}

/* =========================================================
   CONFIGURAÇÕES, IMPORTAR E COPIAR
   ========================================================= */
// Canal ntfy (parte da configuração que se redesenha quando o canal muda)
function renderNtfyCanal() {
  const box = $('#nt-canal'); if (!box) return; box.dataset.t = JSON.stringify(S.empresa.ntfy || {});
  box.innerHTML = S.empresa.ntfy && S.empresa.ntfy.topico ? `<div class="row" style="gap:14px;align-items:center;flex-wrap:wrap"><div id="nt-qr" style="background:#fff;padding:8px;border-radius:8px"></div><div class="stack" style="gap:6px"><div class="label">Canal</div><div class="num" style="font:700 18px var(--f-body);word-break:break-all">${h(S.empresa.ntfy.topico)}</div><div class="muted" style="font-size:12px">Servidor: ntfy.sh (o padrão do app)</div></div></div>
      <div class="row" style="gap:14px;flex-wrap:wrap">${[['chegada', 'Chegada na loja'], ['fora', 'Check-in fora da loja'], ['saida', 'Saída da loja'], ['naoVisitou', 'Não visitou'], ['inicio', 'Não começou a rota (08:35 e 09:35)']].map(([k, t]) => `<label class="row" style="gap:6px;font-size:14px"><input type="checkbox" data-nt="${k}" ${S.empresa.ntfy[k] === false ? '' : 'checked'}> ${t}</label>`).join('')}</div>
      <div class="row"><button class="btn primary" id="nt-s">Salvar alertas</button><button class="btn" id="nt-t">Enviar teste</button><button class="btn ghost" id="nt-novo" title="Gera um canal novo: quem assinou o antigo para de receber">Trocar canal</button></div>`
      : '<div><button class="btn primary" id="nt-novo">Criar canal de alertas</button></div>';
  const ntQr = $('#nt-qr'); if (ntQr) { const desenha = () => { if (!window.QRCode) return setTimeout(desenha, 300); if ($('#nt-qr')) new QRCode($('#nt-qr'), { text: 'https://ntfy.sh/' + S.empresa.ntfy.topico, width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M }); }; desenha(); }
  $('#nt-novo').onclick = async () => {
    if (S.empresa.ntfy && S.empresa.ntfy.topico && !(await confirma('Trocar o canal? Quem assinou o canal atual para de receber e precisa assinar o novo.', 'Trocar'))) return;
    const ALF = 'abcdefghijkmnpqrstuvwxyz23456789'; const topico = 'np-alerta-' + Array.from(crypto.getRandomValues(new Uint8Array(14)), x => ALF[x % ALF.length]).join('');
    S.empresa.ntfy = Object.assign({}, S.empresa.ntfy || {}, { topico });
    setDoc(doc(db, 'config', 'app'), { ntfy: S.empresa.ntfy }, { merge: true }).then(() => { toast('Canal criado'); renderNtfyCanal(); }, e => toast(erroMsg(e)));
  };
  const ntS = $('#nt-s'); if (ntS) ntS.onclick = () => { const o = { topico: S.empresa.ntfy.topico }; document.querySelectorAll('[data-nt]').forEach(i => o[i.dataset.nt] = i.checked); setDoc(doc(db, 'config', 'app'), { ntfy: o }, { merge: true }).then(() => toast('Alertas salvos'), e => toast(erroMsg(e))); };
  const ntT = $('#nt-t'); if (ntT) ntT.onclick = async () => {
    try { const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: S.empresa.ntfy.topico, title: '🔔 Teste da Gestão Nova Penedo', message: 'Se você recebeu isto, os alertas dos promotores vão chegar neste celular.', tags: ['bell'] }) }); toast(r.ok ? 'Teste enviado. Confira o app ntfy.' : 'O ntfy recusou o envio (' + r.status + ').', 6000); }
    catch (e) { toast('Não consegui falar com o ntfy: ' + (e.message || e), 6000); }
  };
}
function renderConfig() {
  const c = $('#v-config');
  if (c.dataset.ok) { // só atualiza os valores, sem apagar o resultado da importação
    const put = (id, v) => { const el = $(id); if (el && document.activeElement !== el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };
    put('#cf-check', S.checklist.join('\n')); put('#cf-pesq', S.pesquisa.join('\n')); put('#cf-raio', S.raio); put('#cf-base', S.regras.base); put('#cf-meta', S.regras.meta); put('#cf-prop', S.regras.prop);
    { const b = $('#nt-canal'); if (b && b.dataset.t !== JSON.stringify(S.empresa.ntfy || {}) && !b.contains(document.activeElement)) renderNtfyCanal(); }
    return;
  }
  c.dataset.ok = 1;
  c.innerHTML = `<h2>Configurações</h2><div class="grid2">
    <div class="card stack"><h3>Checklist da visita</h3><p class="muted" style="margin:0;font-size:14px">Uma pergunta por linha.</p><textarea id="cf-check" rows="6">${h(S.checklist.join('\n'))}</textarea><div><button class="btn primary" id="cf-check-s">Salvar checklist</button></div></div>
    <div class="card stack"><h3>Check-in e variável</h3>
      <label class="field"><span>Raio do check-in (metros)</span><input type="number" id="cf-raio" min="30" step="10" value="${S.raio}"></label>
      <label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="cf-trava" ${S.empresa && S.empresa.travaRaio ? 'checked' : ''}> Bloquear o check-in fora do raio (desligado = o check-in é feito, o promotor vê o aviso "Check-in fora da loja" e a gestão recebe o alerta)</label>
      <label class="field"><span>Variável da rota (R$)</span><input type="number" id="cf-base" step="10" value="${S.regras.base}"></label>
      <label class="field"><span>Faturamento mínimo da rota (R$)</span><input type="number" id="cf-meta" step="1000" value="${S.regras.meta}"></label>
      <label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="cf-prop" ${S.regras.prop ? 'checked' : ''}> Premiação de trocas proporcional ao faturamento</label>
      ${quadroPremiacao()}
      <div><button class="btn primary" id="cf-salvar">Salvar</button></div></div>
    <div class="card stack"><h3>Pesquisa de preço</h3><p class="muted" style="margin:0;font-size:14px">Produtos que o promotor pesquisa em toda visita (um por linha). Obrigatório para o check-out.</p><textarea id="cf-pesq" rows="4">${h(S.pesquisa.join('\n'))}</textarea><div><button class="btn primary" id="cf-pesq-s">Salvar pesquisa</button></div></div>
    <div class="card stack"><h3>Jornada e banco de horas</h3><p class="muted" style="margin:0;font-size:14px">Carga prevista por dia (horas:minutos). O banco de horas compara com o trabalhado.</p>
      <div class="cargas">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="field"><span>${DIAS[d]}</span><input type="text" data-cg="${d}" inputmode="numeric" value="${hmin(regrasJornada(S.empresa).carga[d]).replace('h', ':')}"></label>`).join('')}</div>
      <div class="row" style="gap:10px"><label class="field" style="flex:1"><span>Almoço descontado (minutos)</span><input type="number" id="cf-alm" min="0" step="15" value="${regrasJornada(S.empresa).almocoMin}"></label>
      <label class="field" style="flex:1"><span>Descontar quando a jornada passar de (horas)</span><input type="number" id="cf-almac" min="0" step="0.5" value="${regrasJornada(S.empresa).almocoAcima / 60}"></label></div>
      <div class="row" style="gap:10px"><label class="field" style="flex:1"><span>Início previsto do dia</span><input type="time" id="cf-inip" value="${h(regrasJornada(S.empresa).inicioPrevisto)}"></label>
      <label class="field" style="flex:1"><span>Alerta amarelo após (minutos sem check-in)</span><input type="number" id="cf-tol" min="5" step="5" value="${regrasJornada(S.empresa).tolerancia}"></label></div>
      <div class="row" style="gap:10px"><label class="field" style="flex:1"><span>Almoço automático: início (app bloqueado)</span><input type="time" id="cf-almi" value="${h((regrasJornada(S.empresa).almocoFixo || {}).ini || '12:00')}"></label><label class="field" style="flex:1"><span>Fim do almoço</span><input type="time" id="cf-almf" value="${h((regrasJornada(S.empresa).almocoFixo || {}).fim || '13:00')}"></label></div>
      <label class="field"><span>Início do controle pelo app (dias antes não contam falta)</span><input type="date" id="cf-ini" value="${h(S.empresa.inicioControle || '2026-10-30')}"></label>
      <div><button class="btn primary" id="cf-jor-s">Salvar jornada</button></div></div>
    <div class="card stack"><h3>Alertas no celular do gestor (app ntfy)</h3>
      <p class="muted" style="margin:0;font-size:14px">Chegam como notificação no celular, mesmo com tudo fechado. Instale o app gratuito <b>ntfy</b> (Play Store / App Store), toque em <b>+</b> e assine o canal abaixo, ou leia o QR com a câmera.</p>
      <div id="nt-canal" class="stack"></div>
      <details><summary style="cursor:pointer;font-weight:600">Verificador automático (quem não começou a rota)</summary>
        <p class="muted" style="font-size:13px">Roda sozinho às 08:35 e 09:35 (seg a sáb) no GitHub e avisa no canal quem tem rota e ainda não fez check-in. Precisa de um acesso só de leitura, criado aqui.</p>
        <div class="row"><button class="btn" id="nt-ver">${S.empresa.verificador ? 'Gerar nova senha do verificador' : 'Criar acesso do verificador'}</button></div><div id="nt-ver-r"></div></details></div>
    <div class="card stack"><h3>Passagens (custo de deslocamento)</h3><p class="muted" style="margin:0;font-size:14px">Usadas no PDF da rota. Uma linha por cidade (<b>CIDADE = valor</b>) e por trajeto entre cidades (<b>CIDADE A x CIDADE B = valor</b>).</p>
      <textarea id="cf-pass" rows="6">${h([...Object.entries(regrasPass().tarifas).map(([c, v]) => `${c} = ${String(v).replace('.', ',')}`), ...Object.entries(regrasPass().inter).map(([k, v]) => `${k.replace('|', ' x ')} = ${String(v).replace('.', ',')}`)].join('\n'))}</textarea>
      <label class="field"><span>Até quantos km o promotor vai a pé (sem passagem)</span><input type="number" id="cf-ape" min="0" step="0.1" value="${regrasPass().aPe}"></label>
      <div><button class="btn primary" id="cf-pass-s">Salvar passagens</button></div></div>
    <div class="card stack"><h3>Dados da empresa nos termos</h3><p class="muted" style="margin:0;font-size:14px">Aparecem nos termos de LGPD e do aparelho que o promotor assina no primeiro acesso.</p>
      <label class="field"><span>Razão social</span><input type="text" id="cf-emp" value="${h(S.empresa.empresa || 'Nova Penedo Distribuidora')}"></label>
      <label class="field"><span>CNPJ</span><input type="text" id="cf-cnpj" value="${h(S.empresa.cnpj || '')}"></label>
      <label class="field"><span>Contato para assuntos de dados pessoais (e-mail ou telefone)</span><input type="text" id="cf-cont" value="${h(S.empresa.contato || '')}"></label>
      <div><button class="btn primary" id="cf-emp-s">Salvar dados da empresa</button></div></div>
    <div class="card stack"><h3>Importar arquivo</h3><p class="muted" style="margin:0;font-size:14px">Cópia completa (migração ou restauração) ou vendas e trocas do mês que o Claude preparar.</p>
      <input type="file" id="cf-arq" accept=".json,application/json"><div id="cf-imp"></div></div>
    <div class="card stack"><h3>Cópia de segurança</h3><p class="muted" style="margin:0;font-size:14px">Baixa promotores, acessos, clientes, rotas, vendas e configurações num arquivo. Guarde no Google Drive, pasta Artefatos.</p><div><button class="btn" id="cf-bk">Baixar cópia</button></div></div>
  </div>`;
  $('#cf-check-s').onclick = () => { const itens = $('#cf-check').value.split('\n').map(s => s.trim()).filter(Boolean); if (!itens.length) return toast('Escreva pelo menos uma pergunta.'); setDoc(doc(db, 'config', 'checklist'), { itens }).then(() => toast('Checklist salvo'), e => toast(erroMsg(e))); };
  $('#cf-salvar').onclick = async () => {
    try { await setDoc(doc(db, 'config', 'app'), { raio: +$('#cf-raio').value || 150, travaRaio: $('#cf-trava').checked }, { merge: true }); await setDoc(doc(db, 'config', 'variavel'), { base: +$('#cf-base').value || 0, meta: +$('#cf-meta').value || 0, prop: $('#cf-prop').checked }); toast('Configurações salvas'); }
    catch (e) { toast(erroMsg(e)); }
  };
  renderNtfyCanal();
  $('#nt-ver').onclick = async () => {
    if (!(await confirma('Criar (ou renovar) o acesso só de leitura do verificador automático? Depois você copia o e-mail e a senha para o GitHub.', 'Continuar'))) return;
    const box = $('#nt-ver-r'); box.innerHTML = '<div class="muted">Criando…</div>';
    const ALF = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; const senha = Array.from(crypto.getRandomValues(new Uint8Array(20)), x => ALF[x % ALF.length]).join('');
    const email = 'verificador-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), x => ALF[x % 32].toLowerCase()).join('') + '@monitor.novapenedo.app';
    try {
      const uid = await criarContaMonitor(email, senha);
      await setDoc(doc(db, 'monitores', uid), { email, criado: Date.now() });
      if (S.empresa.verificador && S.empresa.verificador.uid && S.empresa.verificador.uid !== uid) await deleteDoc(doc(db, 'monitores', S.empresa.verificador.uid)).catch(() => {});
      await setDoc(doc(db, 'config', 'app'), { verificador: { uid, email, criado: Date.now() } }, { merge: true });
      box.innerHTML = `<div class="note ok stack" style="gap:6px"><b>Acesso criado.</b> Copie agora (a senha não aparece de novo):
        <div>E-mail: <code style="user-select:all">${h(email)}</code></div><div>Senha: <code style="user-select:all">${h(senha)}</code></div>
        <div style="font-size:13px">No GitHub, abra o repositório <b>novapenedo</b> → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b> → <b>New repository secret</b> e crie dois: <b>MONITOR_EMAIL</b> com o e-mail e <b>MONITOR_SENHA</b> com a senha.</div></div>`;
    } catch (e) { box.innerHTML = `<div class="note crit">${h(String(e.code).includes('permission') ? 'O banco recusou: publique as regras novas do Firebase (bloco "monitores").' : erroMsg(e))}</div>`; }
  };
  $('#cf-pesq-s').onclick = () => { const itens = $('#cf-pesq').value.split('\n').map(x => x.trim()).filter(Boolean); if (!itens.length) return toast('Informe pelo menos um produto.'); setDoc(doc(db, 'config', 'pesquisa'), { itens }).then(() => toast('Pesquisa salva'), e => toast(erroMsg(e))); };
  $('#cf-jor-s').onclick = () => {
    const carga = {}; let erro = false;
    document.querySelectorAll('[data-cg]').forEach(i => { const m = i.value.trim().match(/^(\d{1,2})(?:[:h](\d{1,2}))?$/); if (!m) erro = true; else carga[i.dataset.cg] = +m[1] * 60 + (+m[2] || 0); });
    if (erro) return toast('Use o formato 8:00 nas cargas.');
    setDoc(doc(db, 'config', 'app'), { inicioControle: $('#cf-ini').value || '2026-10-30', jornada: { carga, almocoMin: +$('#cf-alm').value || 0, almocoAcima: Math.round((+$('#cf-almac').value || 0) * 60), inicioPrevisto: $('#cf-inip').value || '08:00', tolerancia: +$('#cf-tol').value || 30, almocoFixo: { ini: $('#cf-almi').value || '12:00', fim: $('#cf-almf').value || '13:00' } } }, { merge: true }).then(() => { toast('Jornada salva'); P.dadosMes = {}; }, e => toast(erroMsg(e)));
  };
  $('#cf-pass-s').onclick = () => {
    const tarifas = {}, inter = {}; let erro = '';
    $('#cf-pass').value.split('\n').map(x => x.trim()).filter(Boolean).forEach(ln => { const m = ln.match(/^(.+?)\s*=\s*R?\$?\s*([\d.,]+)$/); if (!m) { erro = ln; return; } const v = +m[2].replace(/\./g, '').replace(',', '.'); const cs = m[1].split(/\s+x\s+/i).map(semAc); if (cs.length === 2) inter[cs.sort().join('|')] = v; else tarifas[cs[0]] = v; });
    if (erro) return toast('Não entendi a linha: ' + erro, 6000);
    updateDoc(doc(db, 'config', 'app'), { passagens: { tarifas, inter, aPe: +$('#cf-ape').value || 0 } }).then(() => toast('Passagens salvas'), e => toast(erroMsg(e)));
  };
  $('#cf-emp-s').onclick = () => setDoc(doc(db, 'config', 'app'), { empresa: $('#cf-emp').value.trim(), cnpj: $('#cf-cnpj').value.trim(), contato: $('#cf-cont').value.trim() }, { merge: true }).then(() => toast('Dados da empresa salvos'), e => toast(erroMsg(e)));
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
  if (d.formato === 'rostos-v1') {
    const itens = Object.entries(d.itens || {}).filter(([pid]) => S.promotores.some(p => p.id === pid));
    if (!(await confirma(`Cadastrar a foto do rosto de ${itens.length} promotor(es)? A foto atual de cada um será substituída.`, 'Cadastrar fotos'))) return;
    const linhas = [];
    for (let i = 0; i < itens.length; i++) {
      const [pid, x] = itens[i]; const p = S.promotores.find(y => y.id === pid);
      box.innerHTML = `<div class="note">Lendo o rosto ${i + 1} de ${itens.length} (${h(p.nome.split(' ')[0])})… na primeira vez demora alguns segundos.</div>`;
      try {
        const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = x.foto; });
        const lf = await leRostoFoto(img); const r = lf && lf.r;
        if (!r) { linhas.push([p.nome, 'rosto não encontrado na foto']); continue; }
        await setDoc(doc(db, 'rostos', pid), { foto: recorteRosto(lf.fonte, r.box), desc: r.desc, atualizado: Date.now(), origem: d.fonte || 'arquivo' });
        linhas.push([p.nome, 'cadastrada']);
      } catch (e) { linhas.push([p.nome, 'erro: ' + erroMsg(e)]); }
    }
    box.innerHTML = `<div class="note ok"><b>Fotos processadas.</b></div><table style="font-size:13px"><thead><tr><th>Promotor</th><th>Foto do rosto</th></tr></thead><tbody>${linhas.map(([a, b]) => `<tr><td>${h(a)}</td><td>${h(b)}</td></tr>`).join('')}</tbody></table>`;
    return;
  }
  if (d.formato === 'promotores-v1') {
    const novos = Object.entries(d.itens || {}).filter(([pid, x]) => x.novo && !S.promotores.some(p => p.id === pid));
    const itens = Object.entries(d.itens || {}).filter(([pid, x]) => S.promotores.some(p => p.id === pid) || (x.novo && novos.some(([n]) => n === pid)));
    if (!(await confirma(`Completar a ficha de ${itens.length - novos.length} promotores${novos.length ? ` e cadastrar ${novos.length} novo(s) (${novos.map(([, x]) => x.nome.split(' ')[0]).join(', ')})` : ''} com os dados do ${d.fonte || 'arquivo'}? Endereço residencial é gravado; telefone e e-mail só onde estiverem vazios.`, 'Completar fichas'))) return;
    for (const [pid, x] of novos) { const v = { nome: x.nome, base: (x.campos || {}).cidadeRes || '', ativo: true, criado: Date.now(), atualizado: Date.now() }; await setDoc(doc(db, 'promotores', pid), v); S.promotores.push(Object.assign({ id: pid }, v)); }
    const linhas = [];
    for (let i = 0; i < itens.length; i++) {
      const [pid, x] = itens[i]; const p = S.promotores.find(y => y.id === pid); const c = x.campos || {}; const upd = {};
      ['endereco', 'cidadeRes', 'ufRes', 'cepRes'].forEach(k => { if (c[k]) upd[k] = c[k]; });
      ['telefone', 'email', 'nascimento', 'admissao'].forEach(k => { if (c[k] && !p[k]) upd[k] = c[k]; });
      box.innerHTML = `<div class="note">Atualizando ${i + 1} de ${itens.length} (${h(p.nome.split(' ')[0])}) e localizando a casa no mapa…</div>`;
      try { await updateDoc(doc(db, 'promotores', pid), Object.assign(upd, { atualizado: Date.now() })); const casa = await localizaCasa(Object.assign({}, p, upd, { id: pid })); linhas.push([p.nome, Object.keys(upd).filter(k => k !== 'atualizado').length, casa ? (casa.nivel === 'rua' ? 'pela rua' : 'aproximada') : 'não localizada']); }
      catch (e) { linhas.push([p.nome, 'erro: ' + erroMsg(e), '—']); }
      await new Promise(r => setTimeout(r, 1100));
    }
    box.innerHTML = `<div class="note ok"><b>Fichas completadas.</b></div><table style="font-size:13px"><thead><tr><th>Promotor</th><th class="r">Campos gravados</th><th>Casa no mapa</th></tr></thead><tbody>${linhas.map(([a, b, c]) => `<tr><td>${h(a)}</td><td class="r">${h(String(b))}</td><td>${h(c)}</td></tr>`).join('')}</tbody></table>`;
    return;
  }
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
