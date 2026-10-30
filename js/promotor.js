// App do promotor: rota do dia, check-in com GPS + raio + selfie, fotos antes/depois, checklist, check-out
import {
  auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, collection, query, where, onSnapshot, serverTimestamp,
  emailPromotor, senhaPromotor, $, h, semAcento, DIAS_LONGO, ymd, diaSemana, hm, dur, lsGet, lsSet,
  toast, abreModal, fechaModal, confirma, erroMsg, distancia, pegaGPS, comprime, tiraFoto
} from './fb.js';
import { carregaRosto, leRosto, distRosto, LIMITE } from './rosto.js';
import { regrasJornada, calcJornada, hmin, saldoTxt } from './jornada.js';
import { VERSAO, termoLGPD, termoAparelho, hashTexto, infoAparelho } from './termos.js';

export const VERSAO_APP = '2026-10-30.5';
const ADMIN_UID = 'LwETkIMFw0b6gVWl6XV450J1Dr12';
const CHECK_PADRAO = ['Produto em ruptura (faltando na gôndola)', 'Produto com validade próxima', 'Preço divergente da tabela', 'Gôndola abastecida e organizada'];
const MOTIVOS = ['Loja fechada', 'Sem acesso / recebimento', 'Falta de tempo', 'Outro'];
const TIPOS = [['chegada', 'Chegada'], ['antes', 'Gôndola antes'], ['depois', 'Gôndola depois'], ['extra', 'Foto extra']];

const S = { jor: null, cfgApp: null, rosto: null, uid: null, pid: null, prom: null, lojas: [], todas: null, vis: {}, checklist: CHECK_PADRAO, raio: 150, hoje: ymd(new Date()), visita: null, fotos: [], unsub: [] };
const show = id => ['carregando', 'v-login', 'v-semacesso', 'v-rota', 'v-rosto', 'v-termos'].forEach(x => $('#' + x).hidden = x !== id);

/* ---------- login ---------- */
const pins = [0, 1, 2, 3].map(i => $('#pin-' + i));
pins.forEach((el, i) => {
  el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(-1); if (el.value && i < 3) pins[i + 1].focus(); });
  el.addEventListener('keydown', e => { if (e.key === 'Backspace' && !el.value && i > 0) pins[i - 1].focus(); });
});
$('#lg-usuario').value = lsGet('np.usuario') || '';
$('#versao').textContent = 'Versão do app ' + VERSAO_APP;
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault();
  const u = semAcento($('#lg-usuario').value.trim()).replace(/[^a-z0-9]/g, '');
  const c = pins.map(x => x.value).join('');
  if (!u) return $('#lg-msg').textContent = 'Digite seu login.';
  if (c.length < 4) return $('#lg-msg').textContent = 'Digite os 4 números da senha.';
  $('#lg-btn').disabled = true; $('#lg-msg').textContent = 'Entrando…';
  try { await signInWithEmailAndPassword(auth, emailPromotor(u), senhaPromotor(c)); lsSet('np.usuario', u); }
  catch (err) { $('#lg-msg').textContent = erroMsg(err); pins.forEach(x => x.value = ''); pins[0].focus(); }
  finally { $('#lg-btn').disabled = false; }
});
$('#sair').onclick = async () => { if (await confirma('Sair do aplicativo?', 'Sair')) { S.unsub.forEach(f => f()); await signOut(auth); location.reload(); } };

onAuthStateChanged(auth, async user => {
  if (!user) { show('v-login'); $('#sair').hidden = true; $('#quem').textContent = ''; return; }
  if (S.iniciado && user.uid === S.uid) return; // mesma pessoa entrando de novo (liberação pelo supervisor)
  S.uid = user.uid; $('#sair').hidden = false;
  if (user.uid === ADMIN_UID) { location.href = 'gestao.html'; return; }
  const guardado = lsGet('np.pid.' + user.uid);
  try {
    const u = await getDoc(doc(db, 'usuarios', user.uid));
    if (!u.exists()) {
      if (guardado && !navigator.onLine) { S.pid = guardado; iniciar(); return; }
      try { if ((await getDoc(doc(db, 'admins', user.uid))).exists()) { location.href = 'gestao.html'; return; } } catch (e) {}
      show('v-semacesso'); return;
    }
    S.pid = u.data().promotorId; lsSet('np.pid.' + user.uid, S.pid);
    iniciar();
  } catch (e) {
    if (guardado) { S.pid = guardado; iniciar(); return; } // sem sinal: usa o que já estava no celular
    show('v-semacesso'); toast(erroMsg(e));
  }
});

/* ---------- portão do rosto: o app só abre com o rosto do promotor ---------- */
async function iniciar() {
  S.iniciado = true; show('carregando');
  try { const pr = await getDoc(doc(db, 'promotores', S.pid)); if (pr.exists() && pr.data().ativo === false) { show('v-semacesso'); $('#v-semacesso').innerHTML = '<b>Cadastro inativo</b>Seu cadastro está inativo. Fale com o supervisor.'; return; } } catch (e) {}
  let ref = null;
  try { const r = await getDoc(doc(db, 'rostos', S.pid)); if (r.exists()) { ref = r.data(); lsSet('np.rosto.' + S.pid, JSON.stringify({ desc: ref.desc })); } }
  catch (e) {
    if (String(e && e.code).includes('permission')) return travado('Não consegui ler a foto do rosto no sistema (permissão). Avise o supervisor: as regras do banco precisam ser atualizadas.');
    try { ref = JSON.parse(lsGet('np.rosto.' + S.pid) || 'null'); } catch (e2) {}
  }
  S.rosto = ref && Array.isArray(ref.desc) ? ref.desc : null;
  // termos do primeiro acesso
  let assinou = lsGet('np.termo.' + S.pid) === VERSAO;
  if (!assinou) {
    try { const t = await getDocs(query(collection(db, 'termos'), where('promotorId', '==', S.pid))); assinou = t.docs.some(d => d.data().versao === VERSAO); if (assinou) lsSet('np.termo.' + S.pid, VERSAO); }
    catch (e) {
      if (String(e && e.code).includes('permission')) return travado('Não consegui conferir os termos no sistema (permissão). Avise o supervisor: as regras do banco precisam ser atualizadas.');
      assinou = true; // sem sinal: segue e pede na próxima vez
    }
  }
  if (!assinou) return telaTermos();
  let ok = false; try { const x = JSON.parse(sessionStorage.getItem('np.rok') || 'null'); ok = x && x.pid === S.pid && Date.now() - x.t < 12 * 3600e3; } catch (e) {}
  if (!S.rosto || ok) return abreApp();
  portaoRosto();
}
function portaoRosto() {
  show('v-rosto');
  getDoc(doc(db, 'promotores', S.pid)).then(s => { if (s.exists()) { const w = s.data().nome.split(' ').filter(x => x && !['da', 'de', 'do', 'das', 'dos', 'e'].includes(x.toLowerCase())); $('#ro-nome').textContent = w.length > 1 ? w[0] + ' ' + w[w.length - 1] : w[0]; } }).catch(() => {});
  carregaRosto().catch(() => {}); // já vai baixando o reconhecimento
  const st = t => $('#ro-st').innerHTML = t;
  const caixa = $('.rosto-cam'); const v = $('#ro-v');
  let stream = null, rodando = false;
  const para = () => { rodando = false; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; v.srcObject = null; };
  const libera = () => { para(); try { sessionStorage.setItem('np.rok', JSON.stringify({ pid: S.pid, t: Date.now() })); } catch (e) {} abreApp(); };
  $('#ro-ok').onclick = async () => {
    if (rodando) return;
    const b = $('#ro-ok'); b.disabled = true; caixa.classList.remove('ok', 'no');
    try {
      st('Abrindo a câmera…');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      v.srcObject = stream; await v.play().catch(() => {});
      st('Preparando o reconhecimento… (na primeira vez demora um pouco)');
      await carregaRosto();
    } catch (e) { para(); b.disabled = false; st('Não consegui abrir a câmera. Permita o uso da câmera para este app e tente de novo.'); return; }
    rodando = true; let acertos = 0; const ini = Date.now();
    st('Olhe para a câmera, com o rosto dentro do círculo…');
    while (rodando) {
      if (Date.now() - ini > 25000) { para(); b.disabled = false; caixa.classList.add('no'); st('<b>Não reconheci.</b> Procure um lugar com mais luz, tire boné ou óculos escuros e tente de novo.'); return; }
      let r = null; try { if (v.videoWidth) r = await leRosto(v, 320); } catch (e) {}
      const d = r ? distRosto(r.desc, S.rosto) : null;
      if (d != null && d <= LIMITE) { acertos++; caixa.classList.add('ok'); caixa.classList.remove('no'); if (acertos >= 2) { st('<b>Rosto reconhecido.</b> Abrindo sua rota…'); setTimeout(libera, 500); return; } }
      else { acertos = 0; caixa.classList.remove('ok'); if (d != null) { caixa.classList.add('no'); st('Rosto não confere com o cadastro. Fique de frente para a câmera.'); } else { caixa.classList.remove('no'); st('Procurando rosto… olhe para a câmera.'); } }
      await new Promise(res => setTimeout(res, 250));
    }
  };
  $('#ro-sup').onclick = () => {
    abreModal(`<h3>Liberar com a senha do supervisor</h3><p class="muted" style="font-size:14px">O supervisor digita o login e a senha deste promotor.</p>
      <label class="field"><span>Login</span><input type="text" id="sp-u" autocapitalize="none" autocomplete="off"></label>
      <label class="field"><span>Senha (4 números)</span><input type="password" id="sp-c" inputmode="numeric" maxlength="4" autocomplete="off"></label>
      <div id="sp-m" class="muted" style="font-size:13px;min-height:18px"></div>
      <div class="row end"><button class="btn" id="sp-x">Cancelar</button><button class="btn primary" id="sp-s">Liberar</button></div>`);
    $('#sp-x').onclick = fechaModal;
    $('#sp-s').onclick = async () => {
      const u = semAcento($('#sp-u').value.trim()).replace(/[^a-z0-9]/g, ''), c = $('#sp-c').value.trim();
      $('#sp-m').textContent = 'Conferindo…';
      try { const cr = await signInWithEmailAndPassword(auth, emailPromotor(u), senhaPromotor(c)); if (cr.user.uid !== S.uid) { location.reload(); return; } fechaModal(); libera(); }
      catch (e) { $('#sp-m').textContent = erroMsg(e); }
    };
  };
}
/* ---------- termos: LGPD + uso do aparelho, assinados com a foto ---------- */
async function telaTermos() {
  show('v-termos'); window.scrollTo(0, 0);
  const T = { propriedade: '', numero: '', cpf: '', aparelho: await infoAparelho(), empresa: 'Nova Penedo Distribuidora', cnpj: '', contato: '', nome: '' };
  try { const c = await getDoc(doc(db, 'config', 'app')); if (c.exists()) { const x = c.data(); if (x.empresa) T.empresa = x.empresa; T.cnpj = x.cnpj || ''; T.contato = x.contato || ''; } } catch (e) {}
  try { const p = await getDoc(doc(db, 'promotores', S.pid)); if (p.exists()) T.nome = p.data().nome; } catch (e) {}
  $('#tm-nome').value = T.nome;
  const A = T.aparelho;
  $('#tm-ap').innerHTML = `Aparelho identificado: <b>${h(A.modelo || 'modelo não informado pelo celular')}</b> · ${h(A.sistema)} · ${h(A.navegador)} · código ${h(A.id)}`;
  const atualiza = () => { $('#tm-lgpd').textContent = termoLGPD(T); $('#tm-apar').textContent = T.propriedade ? termoAparelho(T) : 'Escolha acima se o celular é da empresa ou seu para ver o termo.'; };
  atualiza();
  document.querySelectorAll('#tm-prop .chip').forEach(b => b.onclick = () => { T.propriedade = b.dataset.v; document.querySelectorAll('#tm-prop .chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); atualiza(); });
  $('#tm-num').oninput = e => { T.numero = e.target.value.trim(); atualiza(); };
  $('#tm-cpf').oninput = e => { const d = e.target.value.replace(/\D/g, '').slice(0, 11); e.target.value = d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4'); T.cpf = e.target.value; atualiza(); };
  carregaRosto().catch(() => {});
  const msg = t => $('#tm-msg').innerHTML = t;
  $('#tm-ok').onclick = async () => {
    if (!$('#tm-c1').checked || !$('#tm-c2').checked) return msg('<span style="color:var(--crit)">Marque as duas autorizações do termo 1.</span>');
    if (!T.propriedade) return msg('<span style="color:var(--crit)">Escolha se o celular é da empresa ou seu.</span>');
    if (T.numero.replace(/\D/g, '').length < 10) return msg('<span style="color:var(--crit)">Informe o número da linha com DDD.</span>');
    if (!$('#tm-c3').checked) return msg('<span style="color:var(--crit)">Marque que concorda com o termo do aparelho.</span>');
    if (!cpfValido(T.cpf)) return msg('<span style="color:var(--crit)">CPF inválido. Confira os números.</span>');
    const b = $('#tm-ok'); b.disabled = true;
    try {
      b.textContent = 'Abrindo a câmera…';
      const cv = await tiraFoto({ frontal: true, titulo: 'Foto para assinar os termos' });
      if (!cv) return;
      b.textContent = 'Conferindo o rosto…';
      let r = null; try { r = await leRosto(cv); } catch (e) {}
      if (!r) return msg('<span style="color:var(--crit)">Não encontrei seu rosto na foto. Tire de novo, de frente e com boa luz.</span>');
      const d = S.rosto ? distRosto(r.desc, S.rosto) : null;
      if (d != null && d > LIMITE) return msg('<span style="color:var(--crit)">A foto não confere com o rosto do cadastro. Só o(a) próprio(a) promotor(a) pode assinar.</span>');
      b.textContent = 'Pegando a localização…';
      let gps = null; try { gps = await pegaGPS(20000); } catch (e) {}
      const t1 = termoLGPD(T), t2 = termoAparelho(T);
      const reg = { promotorId: S.pid, uid: S.uid, versao: VERSAO, nome: T.nome, cpf: T.cpf, empresa: T.empresa, cnpj: T.cnpj, contato: T.contato,
        propriedade: T.propriedade, numero: T.numero, aparelho: T.aparelho, textoLgpd: t1, textoAparelho: t2, hashLgpd: await hashTexto(t1), hashAparelho: await hashTexto(t2),
        consentimentoDados: true, consentimentoBiometria: true, aceiteAparelho: true, assinadoEm: Date.now(), recebido: serverTimestamp(), gps,
        selfie: await comprime(cv, 45000), rostoDist: d, rostoConferido: d != null };
      b.textContent = 'Gravando…';
      grava(setDoc(doc(db, 'termos', S.pid + '_' + VERSAO), reg));
      lsSet('np.termo.' + S.pid, VERSAO);
      try { sessionStorage.setItem('np.rok', JSON.stringify({ pid: S.pid, t: Date.now() })); } catch (e) {}
      msgSalvo('Termos assinados');
      abreApp();
    } finally { b.disabled = false; b.textContent = 'Assinar com minha foto'; }
  };
}
function travado(txt) { show('v-semacesso'); $('#v-semacesso').innerHTML = `<b>Não foi possível abrir</b>${h(txt)}<div style="margin-top:10px"><button class="btn" onclick="location.reload()">Tentar de novo</button></div>`; }
function cpfValido(c) {
  const d = String(c).replace(/\D/g, ''); if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +d[9] && dv(10) === +d[10];
}
function abreApp() {
  show('v-rota');
  S.unsub.push(onSnapshot(doc(db, 'promotores', S.pid), s => { S.prom = s.exists() ? s.data() : { nome: 'Promotor' }; $('#quem').innerHTML = `Olá<b>${h(S.prom.nome.split(' ')[0])}</b>`; render(); }));
  S.unsub.push(onSnapshot(doc(db, 'config', 'checklist'), s => { const it = s.exists() && s.data().itens; S.checklist = Array.isArray(it) && it.length ? it : CHECK_PADRAO; if (S.visita) renderVisita(); }, () => {}));
  S.unsub.push(onSnapshot(doc(db, 'config', 'app'), s => { if (s.exists()) S.cfgApp = s.data(); if (s.exists() && +s.data().raio) S.raio = +s.data().raio; render(); }, () => {}));
  S.unsub.push(onSnapshot(doc(db, 'dias', S.hoje, 'jornadas', S.pid), s => { S.jor = s.exists() ? s.data() : null; render(); }, () => {}));
  setInterval(() => { if (!$('#v-rota').hidden) render(); }, 60000);
  S.unsub.push(onSnapshot(query(collection(db, 'lojas'), where('promotorId', '==', S.pid)), s => { S.lojas = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, e => toast(erroMsg(e))));
  S.unsub.push(onSnapshot(query(collection(db, 'dias', S.hoje, 'visitas'), where('promotorId', '==', S.pid)), { includeMetadataChanges: true }, s => {
    const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.vis = m;
    S.pendVis = s.docs.filter(d => d.metadata && d.metadata.hasPendingWrites).length; rede();
    render(); if (S.visita) renderVisita();
  }, e => toast(erroMsg(e))));
  window.addEventListener('online', rede); window.addEventListener('offline', rede); rede();
  // vira o dia sozinho se o app ficar aberto
  setInterval(() => { if (ymd(new Date()) !== S.hoje) location.reload(); }, 60000);
}

/* ---------- sem sinal: aviso do que está guardado no celular ---------- */
S.pendVis = 0; S.pendFotos = 0;
function rede() {
  let b = $('#rede');
  if (!b) { b = document.createElement('div'); b.id = 'rede'; b.className = 'rede'; document.body.appendChild(b); }
  const n = S.pendVis + S.pendFotos; const off = !navigator.onLine;
  if (!off && !n) { b.hidden = true; return; }
  b.hidden = false; b.className = 'rede ' + (off ? 'off' : 'env');
  b.textContent = off ? (n ? `Sem sinal · ${n} registro${n > 1 ? 's' : ''} guardado${n > 1 ? 's' : ''} no celular. ${n > 1 ? 'Serão enviados sozinhos' : 'Será enviado sozinho'} quando o sinal voltar.` : 'Sem sinal · pode trabalhar normal: tudo fica guardado no celular e é enviado quando o sinal voltar.')
    : `Enviando ${n} registro${n > 1 ? 's' : ''}…`;
}
// grava e acompanha o envio (sem sinal, a gravação fica no celular até a internet voltar)
function grava(p, ehFoto) {
  if (ehFoto) { S.pendFotos++; rede(); }
  return p.then(r => r, e => { toast(erroMsg(e), 6000); }).finally(() => { if (ehFoto) { S.pendFotos = Math.max(0, S.pendFotos - 1); rede(); } });
}
const msgSalvo = txt => toast(navigator.onLine ? txt : txt + ' (guardado no celular, envia quando tiver sinal)', navigator.onLine ? 3200 : 5000);

/* ---------- rota do dia ---------- */
const wdHoje = () => diaSemana(S.hoje);
function posDia(l, wd) { const o = l.ordemDia && l.ordemDia[wd]; return typeof o === 'number' ? o : 1000 + (l.ordem || 999); }
const lojasHoje = () => S.lojas.filter(l => (l.dias || []).map(Number).includes(wdHoje())).sort((a, b) => posDia(a, wdHoje()) - posDia(b, wdHoje()));
const vid = lojaId => lojaId + '_' + S.pid;
const endereco = l => [l.endereco, l.bairro, l.municipio].filter(Boolean).join(', ');
function statusPill(v) {
  if (!v) return '<span class="pill pend">Pendente</span>';
  if (v.status === 'nao_visitada') return '<span class="pill no">Não visitada</span>';
  if (v.status === 'concluida') return `<span class="pill ok num">${hm(v.checkin)}–${hm(v.checkout)}</span>`;
  return `<span class="pill live num">Em loja desde ${hm(v.checkin)}</span>`;
}
function render() {
  if ($('#v-rota').hidden) return;
  const c = $('#v-rota'); const lojas = lojasHoje();
  const feitas = lojas.filter(l => { const v = S.vis[vid(l.id)]; return v && v.status !== 'em_loja'; }).length;
  const extras = Object.values(S.vis).filter(v => v.foraRota);
  let html = `<div><div class="label">Rota de ${DIAS_LONGO[wdHoje()]} · ${S.hoje.split('-').reverse().slice(0, 2).join('/')}</div><h2 class="num">${feitas} de ${lojas.length} lojas</h2></div>
    <div class="progress"><i style="width:${lojas.length ? Math.round(feitas / lojas.length * 100) : 0}%"></i></div>${cartaoJornada()}`;
  if (!lojas.length) html += `<div class="empty"><b>Sem lojas para hoje</b>Nenhuma loja está marcada para ${DIAS_LONGO[wdHoje()]} na sua rota.</div>`;
  else html += '<div class="stops">' + lojas.map((l, i) => {
    const v = S.vis[vid(l.id)]; const cls = v ? (v.status === 'em_loja' ? 'live' : v.status === 'concluida' ? 'done' : '') : '';
    return `<button class="stop ${cls}" data-loja="${h(l.id)}"><span class="n num">${i + 1}</span><span class="t"><b>${h(l.nome)}</b><span>${h(l.codigo || '')} · ${h(l.bairro || l.cidade || '')}</span></span>${statusPill(v)}</button>`;
  }).join('') + '</div>';
  if (extras.length) html += '<div class="label">Fora da rota</div><div class="stops">' + extras.map(v => `<button class="stop" data-loja="${h(v.lojaId)}" data-fora="1"><span class="n">+</span><span class="t"><b>${h(v.lojaNome)}</b><span>${h(v.cidade || '')}</span></span>${statusPill(v)}</button>`).join('') + '</div>';
  html += `<button class="btn" id="b-fora">Visitar loja fora da rota de hoje</button>`;
  html += `<p class="muted" style="font-size:11px;text-align:center;margin:4px 0 0">Versão do app ${VERSAO_APP}</p>`;
  c.innerHTML = html;
  c.querySelectorAll('[data-loja]').forEach(b => b.onclick = () => abreVisita(b.dataset.loja, !!b.dataset.fora));
  $('#b-fora').onclick = buscaFora;
  const bj = $('#b-jor'); if (bj) bj.onclick = S.jor && S.jor.inicio && !S.jor.fim ? encerrarJornada : iniciarJornada;
}
/* ---------- jornada: início e fim do dia de trabalho ---------- */
function cartaoJornada() {
  const J = calcJornada({ j: S.jor, vs: Object.values(S.vis), date: S.hoje, regras: regrasJornada(S.cfgApp), hoje: S.hoje });
  if (!S.jor || !S.jor.inicio) return `<div class="jor card"><div><div class="label">Jornada</div><b>Ainda não iniciada</b></div><button class="btn primary" id="b-jor">Iniciar jornada</button></div>`;
  if (!S.jor.fim) return `<div class="jor card on"><div><div class="label">Jornada desde ${hm(S.jor.inicio)}</div><b class="num">${hmin(J.trabalhado)} trabalhadas</b>${J.almoco ? '<span class="muted" style="font-size:12px"> (almoço de 1h descontado)</span>' : ''}</div><button class="btn" id="b-jor">Encerrar jornada</button></div>`;
  return `<div class="jor card fim"><div><div class="label">Jornada encerrada</div><b class="num">${hm(S.jor.inicio)}–${hm(S.jor.fim)} · ${hmin(J.trabalhado)}</b> <span class="muted num" style="font-size:12px">saldo do dia ${saldoTxt(J.saldo)}</span></div></div>`;
}
// selfie conferida com o cadastro, usada no início e no fim da jornada
async function selfieConferida(titulo) {
  while (true) {
    const cv = await tiraFoto({ frontal: true, titulo }); if (!cv) return null;
    if (!S.rosto) return { cv, rosto: {} };
    let r = null; try { r = await leRosto(cv); } catch (e) {}
    const d = r ? distRosto(r.desc, S.rosto) : null;
    if (d != null && d <= LIMITE) return { cv, rosto: { rostoDist: d, rostoOk: true } };
    const esc = await new Promise(res => {
      abreModal(`<h3>${d == null ? 'Não encontrei seu rosto na selfie' : 'O rosto não confere com o cadastro'}</h3><p class="muted" style="font-size:14px">Tire de novo, de frente e com boa luz. Se registrar assim mesmo, vai para a gestão com alerta.</p>
        <div class="row end"><button class="btn" id="rf-f">Registrar assim mesmo</button><button class="btn primary" id="rf-t">Tirar de novo</button></div>`);
      $('#rf-t').onclick = () => { fechaModal(); res('t'); }; $('#rf-f').onclick = () => { fechaModal(); res('f'); };
    });
    if (esc === 'f') return { cv, rosto: { rostoDist: d, rostoOk: false } };
  }
}
async function iniciarJornada() {
  const b = $('#b-jor'); if (b) { b.disabled = true; b.textContent = 'Pegando o GPS…'; }
  let gps = null; try { gps = await pegaGPS(30000); } catch (e) {}
  const s = await selfieConferida('Selfie para iniciar a jornada');
  if (!s) { render(); return; }
  const t = Date.now();
  const reg = { promotorId: S.pid, data: S.hoje, inicio: t, gpsInicio: gps, fotoInicio: await comprime(s.cv, 30000), rostoInicio: s.rosto, recebidoInicio: serverTimestamp(), uid: S.uid };
  S.jor = reg; render();
  grava(setDoc(doc(db, 'dias', S.hoje, 'jornadas', S.pid), reg)); msgSalvo('Jornada iniciada às ' + hm(t));
}
async function encerrarJornada() {
  if (Object.values(S.vis).some(v => v.status === 'em_loja')) return toast('Faça o check-out da loja antes de encerrar a jornada.', 5000);
  const pend = lojasHoje().filter(l => !S.vis[vid(l.id)]).length;
  if (!(await confirma(pend ? `Ainda há ${pend} loja(s) da rota sem registro. Encerrar a jornada mesmo assim?` : 'Encerrar a jornada de hoje?', 'Encerrar jornada'))) return;
  let gps = null; try { gps = await pegaGPS(30000); } catch (e) {}
  const s = await selfieConferida('Selfie para encerrar a jornada'); if (!s) return;
  const t = Date.now();
  const upd = { fim: t, gpsFim: gps, fotoFim: await comprime(s.cv, 30000), rostoFim: s.rosto, recebidoFim: serverTimestamp() };
  S.jor = Object.assign({}, S.jor, upd); render();
  grava(updateDoc(doc(db, 'dias', S.hoje, 'jornadas', S.pid), upd)); msgSalvo('Jornada encerrada às ' + hm(t));
}

async function buscaFora() {
  abreModal(`<div class="spread"><h3>Loja fora da rota</h3><button class="btn ghost" id="bf-x">Fechar</button></div>
    <input type="text" id="bf-q" placeholder="Código ou nome da loja" autocomplete="off"><div id="bf-r" class="muted">Carregando lojas…</div>`);
  $('#bf-x').onclick = fechaModal;
  if (!S.todas) { try { S.todas = (await getDocs(collection(db, 'lojas'))).docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { $('#bf-r').textContent = erroMsg(e); return; } }
  const r = () => {
    const q = semAcento($('#bf-q').value.trim()); const box = $('#bf-r'); if (!box) return;
    if (q.length < 2) { box.innerHTML = '<span class="muted">Digite pelo menos 2 letras ou o código.</span>'; return; }
    const it = S.todas.filter(l => !l.bloqueado && semAcento([l.codigo, l.nome, l.razao, l.bairro, l.municipio].join(' ')).includes(q)).slice(0, 30);
    box.innerHTML = it.length ? it.map(l => `<div class="res"><div class="t"><b>${h(l.codigo)} · ${h(l.nome)}</b><div>${h(endereco(l))}</div></div><button class="btn sm primary" data-f="${h(l.id)}">Abrir</button></div>`).join('') : 'Nenhuma loja encontrada.';
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { fechaModal(); abreVisita(b.dataset.f, true); });
  };
  $('#bf-q').oninput = r; r(); $('#bf-q').focus();
}

/* ---------- visita ---------- */
let unsubFotos = null;
function abreVisita(lojaId, fora) {
  const loja = S.lojas.find(l => l.id === lojaId) || (S.todas || []).find(l => l.id === lojaId) || { id: lojaId, nome: (Object.values(S.vis).find(v => v.lojaId === lojaId) || {}).lojaNome || 'Loja' };
  const ordem = lojasHoje().findIndex(l => l.id === lojaId);
  S.visita = { loja, id: vid(lojaId), fora: fora || ordem < 0, ordem };
  S.fotos = []; $('#v-obs').value = ''; $('#v-obs-st').textContent = '';
  if (unsubFotos) unsubFotos();
  unsubFotos = onSnapshot(doc(db, 'dias', S.hoje, 'fotos', S.visita.id), s => { S.fotos = s.exists() ? (s.data().imgs || []) : []; renderFotos(); }, () => {});
  $('#sheet').hidden = false; $('#sheet').scrollTop = 0; renderVisita();
}
$('#v-voltar').onclick = () => { if (unsubFotos) { unsubFotos(); unsubFotos = null; } S.visita = null; $('#sheet').hidden = true; render(); };

function renderVisita() {
  const V = S.visita; if (!V) return; const v = S.vis[V.id];
  $('#v-ordem').textContent = V.fora ? 'Fora da rota' : `Parada ${V.ordem + 1} de ${lojasHoje().length}`;
  $('#v-nome').textContent = V.loja.nome; $('#v-end').textContent = [V.loja.codigo ? 'Cód. ' + V.loja.codigo : '', endereco(V.loja)].filter(Boolean).join(' · ');
  $('#v-pill').innerHTML = statusPill(v);
  const st = $('#v-status');
  if (!v) {
    const temLocal = V.loja.lat != null;
    st.innerHTML = `<button class="btn primary big" id="b-in">Fazer check-in<span style="font-size:13px;font-weight:500;opacity:.85">GPS + selfie na frente da loja</span></button>
      ${temLocal ? `<div class="note">Check-in liberado até ${S.raio} m da loja.</div>` : '<div class="note warn">Esta loja ainda não tem localização cadastrada. O seu check-in vai registrar o local para a gestão conferir.</div>'}
      <button class="btn" id="b-nao">Não consegui visitar esta loja</button>`;
    $('#b-in').onclick = checkin; $('#b-nao').onclick = naoVisitou; $('#v-detalhes').hidden = true; return;
  }
  if (v.status === 'nao_visitada') {
    st.innerHTML = `<div class="card"><div class="label">Motivo</div><div style="font-weight:600">${h(v.motivo)}</div>${v.obs ? `<div class="muted">${h(v.obs)}</div>` : ''}</div><button class="btn danger" id="b-desf">Desfazer e visitar a loja</button>`;
    $('#b-desf').onclick = async () => { if (await confirma('Apagar o registro de não visita?', 'Apagar')) deleteDoc(doc(db, 'dias', S.hoje, 'visitas', V.id)).catch(e => toast(erroMsg(e))); };
    $('#v-detalhes').hidden = true; return;
  }
  st.innerHTML = `<div class="times num"><div><span class="label">Entrada</span><b>${hm(v.checkin)}</b></div><div><span class="label">Saída</span><b>${hm(v.checkout)}</b></div><div><span class="label">Tempo</span><b>${dur(v.checkin, v.checkout || Date.now())}</b></div></div>
    ${v.distIn != null ? `<div class="note ${v.distIn > S.raio ? 'warn' : 'ok'}">Check-in a ${v.distIn} m da loja (precisão do GPS ${v.gpsIn ? v.gpsIn.prec : '?'} m).</div>` : ''}`;
  $('#v-detalhes').hidden = false; renderFotos(); renderCheck(v);
  if (document.activeElement !== $('#v-obs')) $('#v-obs').value = v.obs || '';
  $('#v-saida').innerHTML = v.status === 'em_loja' ? `<button class="btn primary big" id="b-out">Fazer check-out</button>` : `<div class="note ok">Visita concluída às ${hm(v.checkout)}.</div>`;
  const bo = $('#b-out'); if (bo) bo.onclick = checkout;
}

function novaVisita(extra) {
  const V = S.visita;
  return Object.assign({ data: S.hoje, lojaId: V.loja.id, lojaNome: V.loja.nome, codigo: V.loja.codigo || '', cidade: V.loja.cidade || '', promotorId: S.pid, promotorNome: S.prom ? S.prom.nome : '',
    foraRota: V.fora, ordem: V.fora ? null : V.ordem + 1, checklist: {}, obs: '', fotos: 0, uid: S.uid, atualizado: Date.now(),
    recebidoIn: serverTimestamp(), recebido: serverTimestamp() }, extra);
}
async function checkin() {
  const V = S.visita; const b = $('#b-in'); b.disabled = true; b.firstChild.textContent = 'Pegando o GPS…';
  let gps;
  try { gps = await pegaGPS(45000); } catch (e) { toast(e.message, 6000); b.disabled = false; b.firstChild.textContent = 'Fazer check-in'; return; }
  let dist = null;
  if (V.loja.lat != null) {
    dist = Math.round(distancia(gps, { lat: +V.loja.lat, lng: +V.loja.lng }));
    if (dist > S.raio) {
      b.disabled = false; b.firstChild.textContent = 'Fazer check-in';
      abreModal(`<h3>Você está longe da loja</h3><p>O GPS indica <b>${dist >= 1000 ? (dist / 1000).toFixed(1).replace('.', ',') + ' km' : dist + ' m'}</b> da ${h(V.loja.nome)}. O check-in só é liberado até ${S.raio} m.</p>
        <p class="muted" style="font-size:13px">Precisão do GPS agora: ${gps.prec} m. Se você já está na porta da loja, vá para um lugar aberto, espere alguns segundos e tente de novo.</p>
        <div class="row end"><button class="btn primary" id="lg-ok">Entendi</button></div>`);
      $('#lg-ok').onclick = fechaModal; return;
    }
  }
  let cv = null, rosto = null;
  while (true) {
    b.firstChild.textContent = 'Abrindo a câmera…';
    cv = await tiraFoto({ frontal: true, titulo: 'Selfie na frente da loja' });
    if (!cv) { b.disabled = false; b.firstChild.textContent = 'Fazer check-in'; return; }
    if (!S.rosto) break;
    b.firstChild.textContent = 'Conferindo o rosto…';
    let r = null; try { r = await leRosto(cv); } catch (e) {}
    const d = r ? distRosto(r.desc, S.rosto) : null;
    rosto = { rostoDist: d, rostoOk: d != null && d <= LIMITE };
    if (rosto.rostoOk) break;
    const esc = await new Promise(res => {
      abreModal(`<h3>${d == null ? 'Não encontrei seu rosto na selfie' : 'O rosto não confere com o cadastro'}</h3><p class="muted" style="font-size:14px">Tire a selfie de novo, de frente e com boa luz. Se registrar assim mesmo, a visita vai para a gestão com alerta.</p>
        <div class="row end"><button class="btn" id="rf-f">Registrar assim mesmo</button><button class="btn primary" id="rf-t">Tirar de novo</button></div>`);
      $('#rf-t').onclick = () => { fechaModal(); res('t'); }; $('#rf-f').onclick = () => { fechaModal(); res('f'); };
    });
    if (esc === 'f') break;
  }
  b.disabled = false; b.firstChild.textContent = 'Fazer check-in';
  const foto = { d: await comprime(cv), ts: Date.now(), tipo: 'chegada', gps };
  const visita = novaVisita(Object.assign({ status: 'em_loja', checkin: foto.ts, checkout: null, gpsIn: gps, distIn: dist, semCoord: V.loja.lat == null, fotos: 1 }, rosto || {}));
  S.vis[V.id] = visita; S.fotos = [foto]; renderVisita();
  grava(setDoc(doc(db, 'dias', S.hoje, 'visitas', V.id), visita));
  grava(setDoc(doc(db, 'dias', S.hoje, 'fotos', V.id), { visita: V.id, imgs: [foto] }), true);
  if (!S.jor || !S.jor.inicio) { // esqueceu de iniciar: a jornada começa no primeiro check-in
    const reg = { promotorId: S.pid, data: S.hoje, inicio: foto.ts, inicioAuto: true, gpsInicio: gps, rostoInicio: rosto || {}, recebidoInicio: serverTimestamp(), uid: S.uid };
    S.jor = reg; grava(setDoc(doc(db, 'dias', S.hoje, 'jornadas', S.pid), reg));
  }
  msgSalvo('Check-in registrado às ' + hm(visita.checkin));
}
async function checkout() {
  const V = S.visita; const v = S.vis[V.id];
  const semFoto = ['antes', 'depois'].filter(t => !S.fotos.some(x => x.tipo === t));
  if (semFoto.length) { toast('Para fazer check-out, tire a foto: gôndola ' + semFoto.join(' e ') + '.', 5000); $('#v-fotos').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const faltam = S.checklist.filter(q => !(v.checklist || {})[q.replace(/[.~*/\[\]]/g, '_')]).length;
  if (faltam && !(await confirma(`${faltam} pergunta(s) do checklist sem resposta. Fazer check-out mesmo assim?`, 'Fazer check-out'))) return;
  const b = $('#b-out'); if (b) { b.disabled = true; b.textContent = 'Pegando o GPS…'; }
  let gps = null, dist = null;
  try { gps = await pegaGPS(30000); if (V.loja.lat != null) dist = Math.round(distancia(gps, { lat: +V.loja.lat, lng: +V.loja.lng })); } catch (e) {}
  const t = Date.now();
  atualiza({ status: 'concluida', checkout: t, gpsOut: gps, distOut: dist }); msgSalvo('Check-out às ' + hm(t));
}
function naoVisitou() {
  abreModal(`<h3>Por que não visitou?</h3><div class="chips" id="mot">${MOTIVOS.map(m => `<button class="chip" aria-pressed="false" data-m="${h(m)}">${h(m)}</button>`).join('')}</div>
    <label class="field" for="mot-obs"><span>Detalhe (opcional)</span><input type="text" id="mot-obs"></label>
    <div class="row end"><button class="btn" id="mot-c">Cancelar</button><button class="btn primary" id="mot-s" disabled>Registrar</button></div>`);
  let esc = '';
  document.querySelectorAll('#mot .chip').forEach(b => b.onclick = () => { esc = b.dataset.m; document.querySelectorAll('#mot .chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#mot-s').disabled = false; });
  $('#mot-c').onclick = fechaModal;
  $('#mot-s').onclick = async () => {
    const obs = $('#mot-obs').value.trim(); fechaModal();
    let gps = null; try { gps = await pegaGPS(10000); } catch (e) {}
    const visita = novaVisita({ status: 'nao_visitada', motivo: esc, obs, registrado: Date.now(), gpsIn: gps });
    S.vis[S.visita.id] = visita; renderVisita();
    grava(setDoc(doc(db, 'dias', S.hoje, 'visitas', S.visita.id), visita)); msgSalvo('Registrado');
  };
}
function atualiza(campos) {
  const V = S.visita; const v = S.vis[V.id];
  if (v) { S.vis[V.id] = Object.assign({}, v, campos, campos.checklist ? { checklist: Object.assign({}, v.checklist, campos.checklist) } : {}); renderVisita(); }
  const upd = Object.assign({}, campos, { atualizado: Date.now(), recebido: serverTimestamp() });
  if (campos.checklist) { delete upd.checklist; Object.entries(campos.checklist).forEach(([k, val]) => upd['checklist.' + k.replace(/[.~*/\[\]]/g, '_')] = val); }
  return grava(updateDoc(doc(db, 'dias', S.hoje, 'visitas', V.id), upd));
}

function renderFotos() {
  if (!S.visita) return;
  const g = $('#v-fotos'); const v = S.vis[S.visita.id]; const pode = v && v.status === 'em_loja';
  g.innerHTML = TIPOS.map(([t, l]) => {
    const f = S.fotos.find(x => (x.tipo || 'extra') === t);
    if (f) return `<div class="stack" style="gap:4px"><div class="foto"><img src="${f.d}" alt="${l}">${pode && t !== 'chegada' ? `<button aria-label="Refazer ${l}" data-rm="${t}">×</button>` : ''}</div><span class="muted num" style="font-size:11px;text-align:center">${l} · ${hm(f.ts)}</span></div>`;
    if (t === 'chegada') return '';
    return pode ? `<div class="stack" style="gap:4px"><button class="addfoto" data-tirar="${t}"><b>+</b>${l}${t !== 'extra' ? '<span style="font-size:11px;color:var(--crit)">obrigatória</span>' : ''}</button></div>` : '';
  }).join('');
  $('#v-fotos-n').textContent = `${['antes', 'depois'].filter(t => S.fotos.some(x => x.tipo === t)).length} de 2 obrigatórias`;
  g.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (await confirma('Apagar esta foto para tirar de novo?', 'Apagar')) salvaFotos(S.fotos.filter(x => (x.tipo || 'extra') !== b.dataset.rm)); });
  g.querySelectorAll('[data-tirar]').forEach(b => b.onclick = async () => {
    const t = b.dataset.tirar; const cv = await tiraFoto({ titulo: (TIPOS.find(x => x[0] === t) || [])[1] });
    if (!cv) return;
    salvaFotos(S.fotos.filter(x => (x.tipo || 'extra') !== t).concat([{ d: await comprime(cv), ts: Date.now(), tipo: t }]));
  });
}
function salvaFotos(lista) {
  const V = S.visita; S.fotos = lista; renderFotos();
  grava(setDoc(doc(db, 'dias', S.hoje, 'fotos', V.id), { visita: V.id, imgs: lista }), true);
  atualiza({ fotos: lista.length }); msgSalvo('Foto salva');
}
function renderCheck(v) {
  const box = $('#v-check'); const resp = v.checklist || {};
  const chave = q => q.replace(/[.~*/\[\]]/g, '_');
  box.innerHTML = S.checklist.map((q, i) => `<div class="check-item"><span>${h(q)}</span><div class="yn" role="group" aria-label="${h(q)}">
    <button class="s" data-q="${i}" data-v="sim" aria-pressed="${resp[chave(q)] === 'sim'}">Sim</button><button class="n" data-q="${i}" data-v="nao" aria-pressed="${resp[chave(q)] === 'nao'}">Não</button></div></div>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => {
    if (S.vis[S.visita.id].status !== 'em_loja') return;
    const q = chave(S.checklist[+b.dataset.q]); const atual = (S.vis[S.visita.id].checklist || {})[q];
    atualiza({ checklist: { [q]: atual === b.dataset.v ? null : b.dataset.v } });
  });
}
let obsT = null;
$('#v-obs').addEventListener('input', () => {
  $('#v-obs-st').textContent = 'Salvando…'; clearTimeout(obsT);
  obsT = setTimeout(() => { atualiza({ obs: $('#v-obs').value }); $('#v-obs-st').textContent = navigator.onLine ? 'Salvo' : 'Salvo no celular'; }, 900);
});
