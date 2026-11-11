// App do promotor: rota do dia, check-in com GPS + raio + selfie, fotos antes/depois, checklist, check-out
import {
  auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, collection, query, where, onSnapshot, serverTimestamp,
  emailPromotor, senhaPromotor, $, h, semAcento, DIAS_LONGO, ymd, diaSemana, hm, dur, lsGet, lsSet,
  toast, abreModal, fechaModal, confirma, erroMsg, distancia, pegaGPS, comprime, tiraFoto
} from './fb.js';
import { carregaRosto, leRosto, distRosto, LIMITE, marcosRosto, provaDeVida } from './rosto.js';
import { regrasJornada, calcJornada, hmin, saldoTxt, janelaAlmoco } from './jornada.js';
import { VERSAO, termoLGPD, termoAparelho, hashTexto, infoAparelho } from './termos.js';

export const VERSAO_APP = '2026-11-11.5';
const ADMIN_UID = 'LwETkIMFw0b6gVWl6XV450J1Dr12';
const PESQ_PADRAO = ['Pão de forma Seven Boys', 'Pão de forma Plus Vita', 'Pão de forma Panco'];
const CHECK_PADRAO = ['Produto em ruptura (faltando na gôndola)', 'Produto com validade próxima', 'Preço divergente da tabela', 'Gôndola abastecida e organizada'];
const MOTIVOS = ['Loja fechada', 'Sem acesso / recebimento', 'Falta de tempo', 'Outro'];
const TIPOS = [['chegada', 'Chegada'], ['antes', 'Gôndola antes'], ['depois', 'Gôndola depois'], ['extra', 'Foto extra'], ['saida', 'Saída']];

const S = { pesquisa: PESQ_PADRAO, jor: null, cfgApp: null, rosto: null, uid: null, pid: null, prom: null, lojas: [], todas: null, vis: {}, checklist: CHECK_PADRAO, raio: 150, hoje: ymd(new Date()), visita: null, fotos: [], unsub: [] };
const show = id => ['carregando', 'v-login', 'v-semacesso', 'v-rota', 'v-rosto', 'v-termos'].forEach(x => $('#' + x).hidden = x !== id);

/* ---------- login ---------- */
const pins = [0, 1, 2, 3].map(i => $('#pin-' + i));
pins.forEach((el, i) => {
  el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(-1); if (el.value && i < 3) pins[i + 1].focus(); });
  el.addEventListener('keydown', e => { if (e.key === 'Backspace' && !el.value && i > 0) pins[i - 1].focus(); });
});
$('#lg-usuario').value = lsGet('np.usuario') || '';
$('#versao').textContent = 'Versão do app ' + VERSAO_APP;
// Ativação do celular por QR/código (o promotor não usa senha)
async function ativar(codigo) {
  const c = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const msg = t => $('#at-msg').innerHTML = t;
  if (c.length < 8) return msg('Digite os 8 caracteres do código.');
  $('#at-btn').disabled = true; msg('Ativando…');
  try {
    const d = await getDoc(doc(db, 'ativacoes', c));
    if (!d.exists()) throw { code: 'ativacao' };
    const a = d.data();
    await signInWithEmailAndPassword(auth, emailPromotor(a.usuario), senhaPromotor(a.codigo));
    lsSet('np.usuario', a.usuario);
    lsSet('np.cred', JSON.stringify({ u: a.usuario, c: a.codigo, pid: a.promotorId || '' }));
    lsSet('np.ativNova', '1'); try { localStorage.removeItem('np.aviso'); } catch (e) {} // registra este celular como o aparelho do promotor // o celular fica ativado: depois do "Sair" basta o rosto
    // o código continua valendo (fixo) até a gestão desvincular o celular: serve para reativar se o app for apagado
    history.replaceState(null, '', location.pathname);
  } catch (e) {
    msg(e && e.code === 'ativacao' || String(e && e.code).includes('permission') ? 'Código inválido, já usado ou vencido. Peça um novo ao supervisor.' : erroMsg(e));
  } finally { $('#at-btn').disabled = false; }
}
$('#f-ativar').addEventListener('submit', e => { e.preventDefault(); ativar($('#at-cod').value); });
$('#at-cod').addEventListener('input', e => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); e.target.value = v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v; });
{ const m = location.hash.match(/ativar=([A-Za-z0-9-]+)/); if (m) { $('#at-cod').value = m[1]; setTimeout(() => ativar(m[1]), 300); } }
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
$('#sair').onclick = async () => { if (await confirma('Sair do aplicativo? Para entrar de novo é só tocar em "Entrar com o rosto".', 'Sair')) { S.unsub.forEach(f => f()); try { sessionStorage.removeItem('np.rok'); } catch (e) {} await signOut(auth); location.reload(); } };
// Celular já ativado: entra de novo só com o rosto (sem código)
const credAparelho = () => { try { const x = JSON.parse(lsGet('np.cred') || 'null'); return x && x.u && x.c ? x : null; } catch (e) { return null; } };
function telaLogin() {
  const cr = credAparelho();
  const av = lsGet('np.aviso'); if (av) { $('#at-msg').innerHTML = `<b style="color:var(--crit)">${h(av)}</b>`; }
  $('#volta').hidden = !cr; $('#ativa-box').hidden = !!cr;
  if (cr) $('#volta-nome').textContent = lsGet('np.nome.' + (cr.pid || '')) || cr.u;
}
$('#volta-btn').onclick = async () => {
  const cr = credAparelho(); if (!cr) return telaLogin();
  $('#volta-btn').disabled = true; $('#volta-msg').textContent = 'Entrando…';
  try { await signInWithEmailAndPassword(auth, emailPromotor(cr.u), senhaPromotor(cr.c)); }
  catch (e) {
    const c = String(e && e.code);
    if (/wrong-password|invalid-credential|user-not-found|user-disabled/.test(c)) { localStorage.removeItem('np.cred'); telaLogin(); $('#at-msg').textContent = 'O acesso deste celular foi trocado pelo supervisor. Peça um novo QR de ativação.'; }
    else $('#volta-msg').textContent = erroMsg(e);
  } finally { $('#volta-btn').disabled = false; }
};
$('#volta-outro').onclick = async () => { if (await confirma('Ativar este celular para outra pessoa? Vai ser preciso um novo QR de ativação do supervisor.', 'Continuar')) { localStorage.removeItem('np.cred'); telaLogin(); } };

onAuthStateChanged(auth, async user => {
  if (!user) { telaLogin(); show('v-login'); $('#sair').hidden = true; $('#quem').textContent = ''; return; }
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
// lojas da rota: as do próprio promotor, ou (usuário de teste) as do promotor que ele simula — só leitura, as visitas ficam no nome do teste
let unsubLojas = null, rotaDe = null;
function assinaLojas(pid) {
  if (pid === rotaDe && unsubLojas) return; rotaDe = pid; if (unsubLojas) unsubLojas();
  unsubLojas = onSnapshot(query(collection(db, 'lojas'), where('promotorId', '==', pid)), s => { S.lojas = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, e => toast(erroMsg(e)));
  S.unsub.push(() => { if (unsubLojas) { unsubLojas(); unsubLojas = null; rotaDe = null; } });
}
async function iniciar() {
  S.iniciado = true; show('carregando');
  try { const pr = await getDoc(doc(db, 'promotores', S.pid)); if (pr.exists()) lsSet('np.nome.' + S.pid, (pr.data().nome || '').split(' ')[0]); if (pr.exists() && pr.data().ativo === false) { show('v-semacesso'); $('#v-semacesso').innerHTML = '<b>Cadastro inativo</b>Seu cadastro está inativo. Fale com o supervisor.'; return; } } catch (e) {}
  vinculaAparelho().catch(() => {}); // registra o celular já no login (antes dos termos e do rosto), para a gestão ver que ativou
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
    rodando = true;
    // aviso por vibração + bipe a cada passo confirmado (quando o rosto está virado, a pessoa não vê a tela)
    let ac = null; try { ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume && ac.resume(); } catch (e) {}
    const bipe = (f, ms) => { try { if (!ac) return; const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + ms / 1000); } catch (e) {} };
    const sinal = (fim) => { try { navigator.vibrate && navigator.vibrate(fim ? [120, 80, 120] : 150); } catch (e) {} bipe(fim ? 1320 : 880, fim ? 260 : 140); };
    // prova de vida: reconhece de frente e depois vira o rosto para um lado sorteado (foto parada não passa)
    const passos = $('#ro-passos'); passos.hidden = false;
    const marca = (n, cls) => passos.querySelectorAll('span').forEach((e, k) => e.className = k < n ? 'feito' : k === n ? 'atual' : '');
    const res = await provaDeVida({
      ref: S.rosto, cancelado: () => !rodando,
      lerRosto: async () => { try { return v.videoWidth ? await leRosto(v, 320) : null; } catch (e) { return null; } },
      lerMarcos: async () => { try { return v.videoWidth ? await marcosRosto(v, 224) : null; } catch (e) { return null; } },
      aviso: (txt, n, tipo) => { if (tipo === 'ok') sinal(false); st(txt); marca(n); caixa.classList.toggle('ok', tipo === 'ok'); caixa.classList.toggle('no', tipo === 'no'); }
    });
    if (res.ok) { sinal(true); marca(2); st('<b>Rosto reconhecido.</b> Abrindo sua rota…'); caixa.classList.add('ok'); setTimeout(libera, 500); return; }
    para(); b.disabled = false; caixa.classList.add('no'); passos.hidden = true; try { navigator.vibrate && navigator.vibrate(500); } catch (e) {} try { ac && ac.close(); } catch (e) {}
    st(res.motivo === 'movimento' ? '<b>Não confirmei o movimento.</b> Vire o rosto devagar para o lado que o app pedir. Foto não é aceita.'
      : res.motivo === 'trocou' ? '<b>O rosto mudou durante a conferência.</b> Tente de novo.'
      : '<b>Não reconheci.</b> Procure um lugar com mais luz, tire boné ou óculos escuros e tente de novo.');
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
// Aparelho vinculado: um celular por promotor. Se a Gestão desvincular (ou ativar outro celular), este sai do app.
async function desvinculado(txt) {
  S.unsub.forEach(f => { try { f(); } catch (e) {} });
  try { ['np.cred', 'np.vinc.' + S.pid].forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem('np.rok'); } catch (e) {}
  lsSet('np.aviso', txt);
  try { await signOut(auth); } catch (e) {}
  location.reload();
}
async function vinculaAparelho() {
  const info = await infoAparelho(); const ref = doc(db, 'aparelhos', S.pid);
  const meu = info.id, reg = lsGet('np.vinc.' + S.pid);
  const grava = () => { lsSet('np.vinc.' + S.pid, meu); try { localStorage.removeItem('np.ativNova'); } catch (e) {}
    return setDoc(ref, { promotorId: S.pid, id: meu, modelo: info.modelo, sistema: info.sistema, navegador: info.navegador, ativadoEm: Date.now(), visto: Date.now(), versao: VERSAO_APP }).catch(() => {}); };
  if (lsGet('np.ativNova')) grava();
  else if (!reg) { // celular ativado antes desta versão: registra se ninguém estiver registrado
    try { const d = await getDoc(ref); if (!d.exists()) grava(); else if (d.data().id === meu) lsSet('np.vinc.' + S.pid, meu); else return desvinculado('Este acesso foi ativado em outro celular. Peça um novo QR ao supervisor.'); } catch (e) { return; }
  } else updateDoc(ref, { visto: Date.now(), versao: VERSAO_APP }).catch(() => {});
  S.unsub.push(onSnapshot(ref, { includeMetadataChanges: false }, s => {
    if ((s.metadata && s.metadata.fromCache) || !lsGet('np.vinc.' + S.pid)) return;
    if (!s.exists()) desvinculado('Este celular foi desvinculado pelo supervisor. Para usar o app aqui, peça um novo QR de ativação.');
    else if (s.data().id && s.data().id !== meu) desvinculado('Este acesso foi ativado em outro celular. Peça um novo QR ao supervisor.');
  }, () => {}));
}
function abreApp() {
  show('v-rota');
  S.unsub.push(onSnapshot(doc(db, 'promotores', S.pid), s => { S.prom = s.exists() ? s.data() : { nome: 'Promotor' };
    $('#quem').innerHTML = S.prom.espelhoDe ? `<b style="color:#F4BC1C">MODO TESTE</b>` : `Olá<b>${h(S.prom.nome.split(' ')[0])}</b>`;
    assinaLojas(S.prom.espelhoDe || S.pid); render(); }));
  S.unsub.push(onSnapshot(doc(db, 'config', 'pesquisa'), s => { const it = s.exists() && s.data().itens; S.pesquisa = Array.isArray(it) && it.length ? it : PESQ_PADRAO; if (S.visita) renderVisita(); }, () => {}));
  S.unsub.push(onSnapshot(doc(db, 'config', 'checklist'), s => { const it = s.exists() && s.data().itens; S.checklist = Array.isArray(it) && it.length ? it : CHECK_PADRAO; if (S.visita) renderVisita(); }, () => {}));
  S.unsub.push(onSnapshot(doc(db, 'dias', S.hoje, 'jornadas', S.pid), s => { S.jor = s.exists() ? s.data() : null; render(); }, () => {}));
  S.unsub.push(onSnapshot(doc(db, 'config', 'app'), s => { if (s.exists()) S.cfgApp = s.data(); if (s.exists() && +s.data().raio) S.raio = +s.data().raio; render(); }, () => {}));
  setInterval(() => { if (!$('#v-rota').hidden) render(); }, 60000);
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
const msgSalvo = () => {}; // sem mensagens de confirmação: a tela já mostra o que foi feito (sem sinal, a faixa no topo avisa)
// Leva o promotor direto ao próximo passo da visita: fotos obrigatórias → pesquisa de preço → check-out
function proximoPasso() {
  setTimeout(() => {
    if (!S.visita) return; const v = S.vis[S.visita.id]; if (!v || v.status !== 'em_loja') return;
    const falta = ['antes', 'depois'].find(t => !S.fotos.some(x => x.tipo === t));
    if (falta) { const b = document.querySelector(`[data-tirar="${falta}"]`); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    // pesquisa (opcional): quem está digitando preços vai para o próximo item sem resposta
    const ae = document.activeElement; const naPesq = ae && ae.dataset && ae.dataset.pq != null;
    if (naPesq || S.vaiPesq) {
      if (naPesq && !precoRespondido((v.precos || {})[chaveQ(S.pesquisa[+ae.dataset.pq])])) return; // ainda falta a validade deste produto
      const de = naPesq ? +ae.dataset.pq + 1 : 0;
      const i = S.pesquisa.findIndex((q, k) => k >= de && !precoRespondido((v.precos || {})[chaveQ(q)]) && !(document.querySelector(`[data-pq="${k}"]`) || {}).closest?.('.pp-item[hidden]'));
      if (i >= 0) { const inp = document.querySelector(`[data-pq="${i}"]`); if (inp) { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (naPesq) inp.focus(); } return; }
    }
    if (!Object.keys(v.precos || {}).length && !S.vaiPesq) { S.vaiPesq = true; const pp = $('#v-pp'); if (pp) pp.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const o = $('#v-saida'); if (o) o.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 250);
}

/* ---------- trava do almoço (horário de início e fim do dia é livre; o banco de horas confere) ---------- */
const regras = () => regrasJornada(S.cfgApp);
const janAlm = () => janelaAlmoco(regras(), S.hoje);
function almocoTravado() { // ms até o fim do almoço automático (0 = liberado)
  const j = janAlm(); const ag = Date.now();
  return j && ag >= j[0] && ag < j[1] ? j[1] - ag : 0;
}
// no horário do almoço nada pode ser feito: fecha a visita aberta e mostra a tarja
function bloqueiaAlmoco() {
  if (!almocoTravado()) return false;
  if (S.visita) { if (unsubFotos) { unsubFotos(); unsubFotos = null; } S.visita = null; $('#sheet').hidden = true; }
  toast('Horário de almoço: o app volta a funcionar às ' + ((regras().almocoFixo || {}).fim || '13:00') + '.', 5000);
  render(); return true;
}
let estAlm = null;
setInterval(() => { const t = !!almocoTravado(); if (t !== estAlm) { estAlm = t; if (t && S.visita && !document.querySelector('#modal:not([hidden])')) { if (unsubFotos) { unsubFotos(); unsubFotos = null; } S.visita = null; $('#sheet').hidden = true; } render(); } else if (t) render(); }, 15000);

/* ---------- aviso para o celular do gestor (app ntfy) ---------- */
// Envia na hora; sem sinal, guarda no celular e envia quando a internet voltar.
const FILA_AV = 'np.filaAvisos';
function avisaGestor(tipo, titulo, texto, tags) {
  const n = (S.cfgApp && S.cfgApp.ntfy) || {}; if (!n.topico || n[tipo] === false) return;
  let fila = []; try { fila = JSON.parse(localStorage.getItem(FILA_AV) || '[]'); } catch (e) {}
  fila.push({ topic: n.topico, title: titulo, message: texto, tags, priority: tipo === 'fora' ? 4 : 3, t: Date.now() });
  try { localStorage.setItem(FILA_AV, JSON.stringify(fila.slice(-50))); } catch (e) {}
  enviaAvisos();
}
let enviandoAv = false;
async function enviaAvisos() {
  if (enviandoAv || !navigator.onLine) return; enviandoAv = true;
  try {
    let fila = []; try { fila = JSON.parse(localStorage.getItem(FILA_AV) || '[]'); } catch (e) {}
    while (fila.length) {
      const a = fila[0]; const atraso = Date.now() - a.t > 5 * 60000;
      const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: a.topic, title: a.title, message: a.message + (atraso ? ` (enviado com atraso: sem sinal às ${hm(a.t)})` : ''), tags: a.tags, priority: a.priority }) });
      if (!r.ok) break;
      fila.shift(); try { localStorage.setItem(FILA_AV, JSON.stringify(fila)); } catch (e) {}
    }
  } catch (e) {} finally { enviandoAv = false; }
}
window.addEventListener('online', () => setTimeout(enviaAvisos, 2000)); setInterval(enviaAvisos, 120000);
const primNome = () => ((S.prom && S.prom.nome) || 'Promotor').split(' ')[0];

/* ---------- rota do dia ---------- */
const wdHoje = () => diaSemana(S.hoje);
function posDia(l, wd) { const o = l.ordemDia && l.ordemDia[wd]; return typeof o === 'number' ? o : 1000 + (l.ordem || 999); }
const lojasHoje = () => S.lojas.filter(l => (l.dias || []).map(Number).includes(wdHoje())).sort((a, b) => posDia(a, wdHoje()) - posDia(b, wdHoje()));
const vid = lojaId => lojaId + '_' + S.pid;
// visitas de hoje numa loja (a 1ª usa o id normal; a 2ª em diante: loja~2_promotor, loja~3_promotor…)
const visitasDaLoja = lojaId => Object.entries(S.vis).filter(([, v]) => v.lojaId === lojaId);
const idVisitaN = (lojaId, n) => n > 1 ? `${lojaId}~${n}_${S.pid}` : vid(lojaId);
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
  const extras = Object.entries(S.vis).filter(([k, v]) => v.foraRota || k !== vid(v.lojaId)).sort((a, b) => (a[1].checkin || 0) - (b[1].checkin || 0));
  let html = (S.prom && S.prom.espelhoDe ? `<div class="note warn"><b>Modo teste.</b> Você está usando a rota de outro promotor só para simular. Tudo o que fizer aqui fica no usuário de teste e não mexe na rota nem nos dados dele.</div>` : '') + `<div><div class="label">Rota de ${DIAS_LONGO[wdHoje()]} · ${S.hoje.split('-').reverse().slice(0, 2).join('/')}</div><h2 class="num">${feitas} de ${lojas.length} lojas</h2></div>
    <div class="progress"><i style="width:${lojas.length ? Math.round(feitas / lojas.length * 100) : 0}%"></i></div>${cartaoJornada()}`;
  if (!lojas.length) html += `<div class="empty"><b>Sem lojas para hoje</b>Nenhuma loja está marcada para ${DIAS_LONGO[wdHoje()]} na sua rota.</div>`;
  else html += '<div class="stops">' + lojas.map((l, i) => {
    const v = S.vis[vid(l.id)]; const cls = v ? (v.status === 'em_loja' ? 'live' : v.status === 'concluida' ? 'done' : '') : '';
    return `<button class="stop ${cls}" data-loja="${h(l.id)}"><span class="n num">${i + 1}</span><span class="t"><b>${h(l.nome)}</b><span>${h(l.codigo || '')} · ${h(l.bairro || l.cidade || '')}</span></span>${statusPill(v)}</button>`;
  }).join('') + '</div>';
  if (extras.length) html += '<div class="label">Fora da rota e visitas extras</div><div class="stops">' + extras.map(([k, v]) => `<button class="stop" data-loja="${h(v.lojaId)}" data-fora="1" data-vid="${h(k)}"><span class="n">+</span><span class="t"><b>${h(v.lojaNome)}${v.visitaN > 1 ? ` · ${v.visitaN}ª visita` : ''}</b><span>${h(v.cidade || '')}</span></span>${statusPill(v)}</button>`).join('') + '</div>';
  html += `<button class="btn" id="b-fora">Visitar loja fora da rota de hoje</button><button class="btn" id="b-var">💰 Minha variável</button>`;
  html += `<p class="muted" style="font-size:11px;text-align:center;margin:4px 0 0">Versão do app ${VERSAO_APP}</p>`;
  const trava = almocoTravado();
  if (trava) { // almoço automático: app bloqueado
    const f = regras().almocoFixo; const aberta = Object.values(S.vis).find(v => v.status === 'em_loja');
    html = `<div class="card stack alm-tarja" style="text-align:center;padding:28px 18px"><div style="font-size:44px">🍽️</div><h2>Horário de almoço</h2>
      <p style="margin:0">Das <b>${f.ini}</b> às <b>${f.fim}</b> o aplicativo fica <b>bloqueado</b>: nenhuma atividade é permitida. Aproveite para descansar.</p>
      ${aberta ? `<p class="muted" style="margin:0">A visita em <b>${h(aberta.lojaNome || (S.lojas.find(l => l.id === aberta.lojaId) || {}).nome || 'loja')}</b> continua aberta: termine depois das ${f.fim}.</p>` : ''}
      <div class="num" style="font:800 34px var(--f-body)">volta em ${hmin(Math.ceil(trava / 60000))}</div></div>
      <p class="muted" style="font-size:11px;text-align:center;margin:4px 0 0">Versão do app ${VERSAO_APP}</p>`;
  }
  c.innerHTML = html;
  if (trava) return;
  c.querySelectorAll('[data-loja]').forEach(b => b.onclick = () => abreVisita(b.dataset.loja, !!b.dataset.fora, b.dataset.vid));
  $('#b-fora').onclick = buscaFora; $('#b-var').onclick = () => minhaVariavel();
}
/* ---------- minha variável (liberada pela gestão: só a do próprio promotor) ---------- */
const brl = n => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pctf = n => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const FAIXAS_PADRAO = [[0.75, 500], [1, 375], [1.5, 250], [2, 150]];
// regras da premiação, iguais às de Configurações na Gestão
function regrasPremio(fx, R, iFx, temVenda) {
  const pc = n => String(n).replace('.', ',') + '%';
  return `<div class="card stack" style="gap:6px"><div class="label">Regras da premiação sobre troca (troca ÷ venda da rota)</div>
    <table class="num" style="font-size:13px;width:100%"><thead><tr><th style="text-align:left">% de troca no mês</th><th class="r">Premiação</th></tr></thead><tbody>${fx.map((f, i) => `<tr${i === iFx ? ' style="background:#E9F7EF;font-weight:700"' : ''}><td>${i ? 'de ' + pc(fx[i - 1].ate) + ' até menos de ' + pc(f.ate) : 'menos de ' + pc(f.ate)}${i === iFx ? ' ← você' : ''}</td><td class="r">${brl(f.valor)}</td></tr>`).join('')}
    <tr${temVenda && iFx === -1 ? ' style="background:#FDECEC;font-weight:700"' : ''}><td>${fx.length ? pc(fx[fx.length - 1].ate) + ' ou mais' : ''}${temVenda && iFx === -1 ? ' ← você' : ''}</td><td class="r">${brl(0)}</td></tr></tbody></table>
    <div class="muted" style="font-size:12px;line-height:1.45">Troca = troca do cliente + troca ERP. Variável da rota: ${brl(R.base)} quando a rota é cumprida${R.meta ? `, proporcional à venda até o mínimo de ${brl(R.meta)} (ex.: vendeu metade do mínimo, recebe metade)` : ''}. ${R.prop ? 'A premiação também é proporcional à venda até o mínimo.' : 'A premiação é paga cheia, sem proporção.'} Faltas/atraso marcados zeram a premiação.</div></div>`;
}
async function minhaVariavel(mesSel) {
  abreModal('<div class="spread"><h3>💰 Minha variável</h3><button class="btn ghost" id="mv-x">Fechar</button></div><div id="mv-c" class="muted">Carregando…</div>');
  $('#mv-x').onclick = fechaModal;
  let lista = [];
  try { lista = (await getDocs(query(collection(db, 'minhaVariavel'), where('promotorId', '==', S.pid)))).docs.map(d => d.data()).sort((a, b) => b.mes.localeCompare(a.mes)); }
  catch (e) { const c = $('#mv-c'); if (c) c.textContent = erroMsg(e); return; }
  const c = $('#mv-c'); if (!c) return;
  if (!lista.length) {
    let R = { base: 250, meta: 70000, prop: false }; try { const g = await getDoc(doc(db, 'config', 'variavel')); if (g.exists()) R = Object.assign(R, g.data()); } catch (e) {}
    c.className = 'stack'; c.style.gap = '12px';
    c.innerHTML = '<div class="empty"><b>Ainda não liberada</b>Quando o supervisor fechar a variável do mês, ela aparece aqui com a venda e a troca de cada cliente da sua rota.</div>' + regrasPremio(FAIXAS_PADRAO.map(([ate, valor]) => ({ ate, valor })), R, -2, false);
    return;
  }
  const r = lista.find(x => x.mes === mesSel) || lista[0];
  const fx = r.faixas || []; const pc = n => String(n).replace('.', ',') + '%';
  const iFx = r.v ? fx.findIndex(f => r.pct < f.ate) : -1;
  // quanto de troca precisa baixar para subir de faixa
  const prox = iFx > 0 ? fx[iFx - 1] : iFx === -1 && r.v && fx.length ? fx[fx.length - 1] : null;
  const alvo = prox ? Math.max(0, Math.floor((r.v * prox.ate / 100 - 0.01) * 100) / 100) : null;
  const dica = prox && alvo != null ? `<div class="note">Para chegar na faixa de <b>${brl(prox.valor)}</b>, a troca do mês precisa ficar abaixo de <b>${pc(prox.ate)}</b> da venda: até <b>${brl(alvo)}</b> com esta venda (foi ${brl(r.t)}).</div>` : '';
  c.className = 'stack'; c.style.gap = '12px';
  c.innerHTML = `${lista.length > 1 ? `<div class="chips">${lista.map(x => `<button class="chip" data-mv="${h(x.mes)}" aria-pressed="${x.mes === r.mes}">${h(x.nomeMes || x.mes)}</button>`).join('')}</div>` : ''}
    <div><div class="label">${h(r.nomeMes || r.mes)}</div><div class="muted" style="font-size:12px">Dados de vendas e trocas de ${h(r.dados || '')}</div></div>
    <div class="card stack" style="gap:6px;text-align:center"><span class="label">Total a receber</span><b class="num" style="font:800 34px var(--f-body);color:var(--ok)">${brl(r.total)}</b></div>
    <div class="times num" style="grid-template-columns:1fr 1fr"><div><span class="label">Venda da rota</span><b>${brl(r.v)}</b></div><div><span class="label">Troca</span><b>${brl(r.t)} · ${pctf(r.pct)}</b></div>
      <div><span class="label">Variável da rota</span><b>${brl(r.variavel)}</b></div><div><span class="label">Premiação sobre troca</span><b>${brl(r.premio)}</b></div></div>
    ${!r.cumprida ? '<div class="note crit">Rota não cumprida no mês: a variável da rota não foi paga.</div>' : ''}${r.zerar ? '<div class="note crit">Premiação zerada por falta/atraso no mês.</div>' : ''}
    ${r.fator < 1 ? `<div class="note warn">A venda da rota ficou em ${Math.round(r.fator * 100)}% do mínimo de ${brl(r.regras.meta)}: a variável${r.regras.prop ? ' e a premiação foram pagas' : ' foi paga'} na mesma proporção.</div>` : ''}
    ${regrasPremio(fx, r.regras || {}, iFx, !!r.v)}
    ${dica}
    <div class="card stack" style="gap:4px"><div class="label">Seus clientes (${r.clientes.length})</div>
      ${r.clientes.map(x => `<div class="spread" style="padding:6px 0;border-bottom:1px solid var(--line);gap:8px;align-items:flex-start"><span style="min-width:0"><b>${h(x.nome)}</b><span class="muted" style="display:block;font-size:12px">${h(x.cod)}${x.cidade ? ' · ' + h(x.cidade) : ''}</span></span>
        <span class="num" style="text-align:right;font-size:13px;white-space:nowrap">venda ${brl(x.v)}<br>troca ${brl(x.t)}${x.v ? ` · <b style="color:${x.t / x.v * 100 >= 2 ? 'var(--crit)' : 'inherit'}">${pctf(x.t / x.v * 100)}</b>` : ''}</span></div>`).join('')}</div>`;
  c.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => minhaVariavel(b.dataset.mv));
}

/* ---------- jornada: início e fim do dia de trabalho ---------- */
function cartaoJornada() {
  const J = calcJornada({ vs: Object.values(S.vis), j: S.jor, date: S.hoje, regras: regrasJornada(S.cfgApp), hoje: S.hoje });
  const jor = S.jor || {};
  if (!J.tem) return `<div class="jor card"><div><div class="label">Jornada</div><b>Começa no check-in da primeira loja</b></div></div>`;
  const pend = lojasHoje().filter(l => !S.vis[vid(l.id)]).length;
  const jan = janAlm(); const f = regras().almocoFixo;
  const alm = jan ? `<div class="jor-alm"><span class="muted">🍽️ Almoço automático das ${f.ini} às ${f.fim} (app bloqueado nesse horário)</span></div>`
    : jor.almocoFim ? `<div class="jor-alm"><span>🍽️ Almoço ${hm(jor.almocoInicio)}–${hm(jor.almocoFim)} · ${hmin((jor.almocoFim - jor.almocoInicio) / 60000)}</span></div>` : '';
  const desc = J.almoco ? `<span class="muted" style="font-size:12px"> (almoço ${J.almocoMarcado || J.almocoFixo ? hmin(J.almoco) : 'de 1h'} descontado)</span>` : '';
  if (J.andamento || pend) return `<div class="jor card on"><div style="flex:1"><div class="label">Jornada desde ${hm(J.inicio)}</div><b class="num">${hmin(J.trabalhado)} trabalhadas${J.andamento ? '' : ' até a última saída'}</b>${desc}${alm}</div></div>`;
  return `<div class="jor card fim"><div style="flex:1"><div class="label">Jornada do dia</div><b class="num">${hm(J.inicio)}–${hm(J.fim)} · ${hmin(J.trabalhado)}</b> <span class="muted num" style="font-size:12px">saldo ${saldoTxt(J.saldo)}</span>${desc}${alm}</div></div>`;
}
async function buscaFora() {
  if (bloqueiaAlmoco()) return;
  abreModal(`<div class="spread"><h3>Loja fora da rota</h3><button class="btn ghost" id="bf-x">Fechar</button></div>
    <input type="text" id="bf-q" placeholder="Código ou nome da loja" autocomplete="off"><div id="bf-r" class="muted">Carregando lojas…</div>`);
  $('#bf-x').onclick = fechaModal;
  if (!S.todas) { try { S.todas = (await getDocs(collection(db, 'lojas'))).docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { $('#bf-r').textContent = erroMsg(e); return; } }
  const r = () => {
    const q = semAcento($('#bf-q').value.trim()); const box = $('#bf-r'); if (!box) return;
    if (q.length < 2) { box.innerHTML = '<span class="muted">Digite pelo menos 2 letras ou o código.</span>'; return; }
    const it = S.todas.filter(l => !l.bloqueado && semAcento([l.codigo, l.nome, l.razao, l.bairro, l.municipio].join(' ')).includes(q)).slice(0, 30);
    box.innerHTML = it.length ? it.map(l => {
      const vs = visitasDaLoja(l.id); const aberta = vs.find(([, v]) => v.status === 'em_loja');
      const bt = aberta ? `<button class="btn sm primary" data-f="${h(l.id)}" data-fid="${h(aberta[0])}">Abrir visita</button>`
        : vs.length ? `<button class="btn sm primary" data-f="${h(l.id)}" data-nova="${vs.length + 1}">Nova visita (${vs.length + 1}ª)</button>`
        : `<button class="btn sm primary" data-f="${h(l.id)}">Abrir</button>`;
      return `<div class="res"><div class="t"><b>${h(l.codigo)} · ${h(l.nome)}</b><div>${h(endereco(l))}</div>${vs.length ? `<div class="muted" style="font-size:12px">Já visitada hoje ${vs.length}x${vs.filter(([, v]) => v.checkout).map(([, v]) => ' · saída ' + hm(v.checkout)).join('')}</div>` : ''}</div>${bt}</div>`;
    }).join('') : 'Nenhuma loja encontrada.';
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = async () => {
      if (b.dataset.nova) { const n = +b.dataset.nova; if (!(await confirma(`Fazer uma ${n}ª visita nesta loja hoje? Ela fica registrada como visita extra, com check-in, fotos, pesquisa e check-out próprios.`, 'Fazer nova visita'))) return; fechaModal(); return abreVisita(b.dataset.f, true, idVisitaN(b.dataset.f, n), n); }
      fechaModal(); abreVisita(b.dataset.f, true, b.dataset.fid);
    });
  };
  $('#bf-q').oninput = r; r(); $('#bf-q').focus();
}

/* ---------- visita ---------- */
let unsubFotos = null;
function abreVisita(lojaId, fora, idForcado, n) {
  if (bloqueiaAlmoco()) return;
  const loja = S.lojas.find(l => l.id === lojaId) || (S.todas || []).find(l => l.id === lojaId) || { id: lojaId, nome: (Object.values(S.vis).find(v => v.lojaId === lojaId) || {}).lojaNome || 'Loja' };
  const ordem = lojasHoje().findIndex(l => l.id === lojaId);
  const id = idForcado || vid(lojaId); const nv = n || (S.vis[id] && S.vis[id].visitaN) || 1;
  S.visita = { loja, id, n: nv, fora: fora || ordem < 0 || nv > 1, ordem };
  S.fotos = []; S.vaiPesq = false; $('#v-obs').value = ''; $('#v-obs-st').textContent = '';
  if (unsubFotos) unsubFotos();
  unsubFotos = onSnapshot(doc(db, 'dias', S.hoje, 'fotos', S.visita.id), s => { S.fotos = s.exists() ? (s.data().imgs || []) : []; renderFotos(); }, () => {});
  $('#sheet').hidden = false; $('#sheet').scrollTop = 0; renderVisita();
}
$('#v-voltar').onclick = () => { if (unsubFotos) { unsubFotos(); unsubFotos = null; } S.visita = null; $('#sheet').hidden = true; render(); };

function renderVisita() {
  const V = S.visita; if (!V) return; const v = S.vis[V.id];
  $('#v-ordem').textContent = V.n > 1 ? `${V.n}ª visita do dia nesta loja` : V.fora ? 'Fora da rota' : `Parada ${V.ordem + 1} de ${lojasHoje().length}`;
  $('#v-nome').textContent = V.loja.nome; $('#v-end').textContent = [V.loja.codigo ? 'Cód. ' + V.loja.codigo : '', endereco(V.loja)].filter(Boolean).join(' · ');
  $('#v-pill').innerHTML = statusPill(v);
  const st = $('#v-status');
  if (!v) {
    const temLocal = V.loja.lat != null || V.loja.latAprox != null;
    st.innerHTML = `<button class="btn primary big" id="b-in">Fazer check-in<span style="font-size:13px;font-weight:500;opacity:.85">GPS + selfie na frente da loja</span></button>
      ${temLocal ? `<div class="note">${V.loja.lat != null ? `Check-in conferido até ${S.raio} m da loja.` : `Check-in conferido até ${Math.max(500, S.raio)} m do endereço da loja (local aproximado).`}</div>` : '<div class="note warn">Esta loja ainda não tem localização cadastrada. O seu check-in vai registrar o local para a gestão conferir.</div>'}
      <button class="btn" id="b-nao">Não consegui visitar esta loja</button>`;
    $('#b-in').onclick = checkin; $('#b-nao').onclick = naoVisitou; $('#v-detalhes').hidden = true; return;
  }
  if (v.status === 'nao_visitada') {
    st.innerHTML = `<div class="card"><div class="label">Motivo</div><div style="font-weight:600">${h(v.motivo)}</div>${v.obs ? `<div class="muted">${h(v.obs)}</div>` : ''}</div><button class="btn danger" id="b-desf">Desfazer e visitar a loja</button>`;
    $('#b-desf').onclick = async () => { if (await confirma('Apagar o registro de não visita?', 'Apagar')) deleteDoc(doc(db, 'dias', S.hoje, 'visitas', V.id)).catch(e => toast(erroMsg(e))); };
    $('#v-detalhes').hidden = true; return;
  }
  st.innerHTML = `<div class="times num"><div><span class="label">Entrada</span><b>${hm(v.checkin)}</b></div><div><span class="label">Saída</span><b>${hm(v.checkout)}</b></div><div><span class="label">Tempo</span><b>${dur(v.checkin, v.checkout || Date.now())}</b></div></div>
    ${v.distIn != null ? (v.distIn > (v.limite || v.raio || S.raio) ? `<div class="note crit"><b>⚠️ Check-in fora da loja</b> · a ${v.distIn >= 1000 ? (v.distIn / 1000).toFixed(1).replace('.', ',') + ' km' : v.distIn + ' m'} ${v.localAprox ? 'do endereço' : 'da loja'} (o certo é até ${v.limite || v.raio || S.raio} m). A gestão foi avisada.</div>` : `<div class="note ok">Check-in a ${v.distIn} m ${v.localAprox ? 'do endereço (local aproximado)' : 'da loja'} (precisão do GPS ${v.gpsIn ? v.gpsIn.prec : '?'} m).</div>`)
      : `<div class="note warn">Loja sem localização cadastrada: a distância do check-in não foi conferida. A gestão vai fixar o local.</div>`}`;
  $('#v-detalhes').hidden = false; renderFotos(); renderCheck(v); renderPesquisa(v);
  if (document.activeElement !== $('#v-obs')) $('#v-obs').value = v.obs || '';
  const sai = v.status === 'em_loja' ? `<button class="btn primary big" id="b-out">Fazer check-out<span style="font-size:13px;font-weight:500;opacity:.85">GPS + selfie de saída na loja</span></button>` : `<div class="note ${v.foraRaioOut ? 'crit' : 'ok'}">Visita concluída às ${hm(v.checkout)}${v.distOut != null ? (v.foraRaioOut ? ` · <b>⚠️ check-out fora da loja</b> (a ${kmOuM(v.distOut)}). A gestão foi avisada.` : ` · check-out a ${v.distOut} m da loja.`) : '.'}</div>`;
  if ($('#v-saida').dataset.k !== sai) { $('#v-saida').innerHTML = sai; $('#v-saida').dataset.k = sai; } // não recria o botão à toa (o toque se perdia ao sair do campo de preço)
  const bo = $('#b-out'); if (bo && !bo.disabled) bo.onclick = checkout;
}

function novaVisita(extra) {
  const V = S.visita;
  return Object.assign({ data: S.hoje, lojaId: V.loja.id, lojaNome: V.loja.nome, codigo: V.loja.codigo || '', cidade: V.loja.cidade || '', promotorId: S.pid, promotorNome: S.prom ? S.prom.nome : '',
    foraRota: V.fora, ordem: V.fora ? null : V.ordem + 1, visitaN: V.n || 1, checklist: {}, obs: '', fotos: 0, uid: S.uid, atualizado: Date.now(),
    recebidoIn: serverTimestamp(), recebido: serverTimestamp() }, extra);
}
// selfie com conferência do rosto (check-in e check-out)
async function selfieConferida(b, titulo, rotulo) {
  let cv = null, rosto = null;
  const txt = t => { if (b) (b.firstChild || b).textContent = t; };
  while (true) {
    txt('Abrindo a câmera…');
    cv = await tiraFoto({ frontal: true, titulo });
    if (!cv) { if (b) b.disabled = false; txt(rotulo); return null; }
    if (!S.rosto) break;
    txt('Conferindo o rosto…');
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
  if (b) b.disabled = false; txt(rotulo);
  return { cv, rosto };
}
// ponto da loja e distância (exato fixado pela gestão, ou aproximado pelo endereço com folga maior)
function confereLocal(loja, gps) {
  const aprox = loja.lat == null && loja.latAprox != null;
  const ponto = loja.lat != null ? { lat: +loja.lat, lng: +loja.lng } : aprox ? { lat: +loja.latAprox, lng: +loja.lngAprox } : null;
  const limite = aprox ? Math.max(500, S.raio) : S.raio;
  const dist = ponto ? Math.round(distancia(gps, ponto)) : null;
  return { aprox, limite, dist, fora: dist != null && dist > limite, trava: dist != null && dist > limite && !aprox && !!(S.cfgApp && S.cfgApp.travaRaio) };
}
const kmOuM = d => d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' km' : d + ' m';
async function checkin() {
  const V = S.visita; V.foraRaio = false; const b = $('#b-in'); b.disabled = true; b.firstChild.textContent = 'Pegando o GPS…';
  let gps;
  try { gps = await pegaGPS(45000); } catch (e) { toast(e.message, 6000); b.disabled = false; b.firstChild.textContent = 'Fazer check-in'; return; }
  let dist = null;
  // ponto da loja: exato (fixado pela gestão) ou aproximado pelo endereço (com folga maior, porque pode errar)
  const aprox = V.loja.lat == null && V.loja.latAprox != null;
  const ponto = V.loja.lat != null ? { lat: +V.loja.lat, lng: +V.loja.lng } : aprox ? { lat: +V.loja.latAprox, lng: +V.loja.lngAprox } : null;
  const limite = aprox ? Math.max(500, S.raio) : S.raio; V.limite = limite; V.aprox = aprox;
  if (ponto) {
    dist = Math.round(distancia(gps, ponto));
    if (dist > limite) {
      if (S.cfgApp && S.cfgApp.travaRaio && !aprox) { // bloqueio ligado na Gestão
        b.disabled = false; b.firstChild.textContent = 'Fazer check-in';
        abreModal(`<h3 style="color:var(--crit)">⚠️ Check-in fora da loja</h3><p>Você está a <b>${dist >= 1000 ? (dist / 1000).toFixed(1).replace('.', ',') + ' km' : dist + ' m'}</b> da loja. O check-in só é liberado até ${S.raio} m.</p><div class="row end"><button class="btn primary" id="lg-ok">Entendi</button></div>`);
        $('#lg-ok').onclick = fechaModal; return;
      }
      V.foraRaio = true; // liberado: segue o check-in e avisa o promotor; a gestão vê o alerta
    }
  }
  const sf = await selfieConferida(b, 'Selfie na frente da loja', 'Fazer check-in');
  if (!sf) return; const { cv, rosto } = sf;
  if (bloqueiaAlmoco()) return;
  b.disabled = false; b.firstChild.textContent = 'Fazer check-in';
  const foto = { d: await comprime(cv), ts: Date.now(), tipo: 'chegada', gps };
  const visita = novaVisita(Object.assign({ status: 'em_loja', checkin: foto.ts, checkout: null, gpsIn: gps, distIn: dist, foraRaio: !!V.foraRaio, raio: S.raio, limite: V.limite, localAprox: !!V.aprox, semCoord: V.loja.lat == null && !V.aprox, fotos: 1 }, rosto || {}));
  S.vis[V.id] = visita; S.fotos = [foto]; renderVisita();
  grava(setDoc(doc(db, 'dias', S.hoje, 'visitas', V.id), visita));
  grava(setDoc(doc(db, 'dias', S.hoje, 'fotos', V.id), { visita: V.id, imgs: [foto] }), true);
  if (V.foraRaio) { try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} }
  avisaGestor(V.foraRaio ? 'fora' : 'chegada', `📍 ${primNome()} chegou: ${V.loja.nome}`, `Check-in às ${hm(visita.checkin)}${V.foraRaio ? ` · ⚠️ FORA DA LOJA (${dist} m)` : ''}${rosto && rosto.rostoOk === false ? ' · ⚠️ rosto não confere' : ''}${V.fora ? ' · fora da rota' : ''}`, V.foraRaio ? ['warning'] : ['round_pushpin']);
  proximoPasso();
}
async function checkout() {
  const V = S.visita; const v = S.vis[V.id];
  const semFoto = ['antes', 'depois'].filter(t => !S.fotos.some(x => x.tipo === t));
  if (semFoto.length) { toast('Para fazer check-out, tire a foto: gôndola ' + semFoto.join(' e ') + '.', 5000); $('#v-fotos').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  document.querySelectorAll('#v-pp [data-pq]').forEach(inp => salvaPreco(inp, false)); // grava o que foi digitado e ainda não foi salvo
  const v2 = S.vis[V.id] || v;
  const semPreco = S.pesquisa.filter(q => !precoRespondido((v2.precos || {})[chaveQ(q)]));
  if (semPreco.length) { // pesquisa obrigatória: cada produto com Ruptura, ou preço + validade
    const i = S.pesquisa.indexOf(semPreco[0]); const inp = document.querySelector(`[data-pq="${i}"]`);
    const bx = $('#pp-busca'); if (bx && bx.value) { bx.value = ''; bx.oninput({ target: bx }); }
    toast(`Falta completar a pesquisa (${semPreco.length} produto${semPreco.length > 1 ? 's' : ''}): marque Ruptura ou informe o preço e a validade (e a quantidade, se vencer em menos de 10 dias). Primeiro: ${semPreco[0].replace(/^\d+ - /, '')}.`, 7000);
    if (inp) inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
  }
  if (bloqueiaAlmoco()) return;
  const b = $('#b-out'); const rot = 'Fazer check-out';
  if (b) { b.disabled = true; b.firstChild.textContent = 'Pegando o GPS…'; }
  let gps;
  try { gps = await pegaGPS(45000); } catch (e) { toast(e.message, 6000); if (b) { b.disabled = false; b.firstChild.textContent = rot; } return; }
  const L = confereLocal(V.loja, gps);
  if (L.trava) { // bloqueio ligado na Gestão
    if (b) { b.disabled = false; b.firstChild.textContent = rot; }
    abreModal(`<h3 style="color:var(--crit)">⚠️ Check-out fora da loja</h3><p>Você está a <b>${kmOuM(L.dist)}</b> da loja. O check-out só é liberado até ${S.raio} m.</p><div class="row end"><button class="btn primary" id="lg-ok">Entendi</button></div>`);
    $('#lg-ok').onclick = fechaModal; return;
  }
  const sf = await selfieConferida(b, 'Selfie de saída na loja', rot);
  if (!sf) return;
  if (bloqueiaAlmoco()) return;
  const t = Date.now();
  const foto = { d: await comprime(sf.cv), ts: t, tipo: 'saida', gps };
  const lista = S.fotos.filter(x => x.tipo !== 'saida').concat([foto]); S.fotos = lista;
  grava(setDoc(doc(db, 'dias', S.hoje, 'fotos', V.id), { visita: V.id, imgs: lista }), true);
  const ro = sf.rosto ? { rostoOutDist: sf.rosto.rostoDist, rostoOutOk: sf.rosto.rostoOk } : {};
  atualiza(Object.assign({ status: 'concluida', checkout: t, gpsOut: gps, distOut: L.dist, foraRaioOut: L.fora, limiteOut: L.limite, fotos: lista.length }, ro));
  if (L.fora) { try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} toast(`⚠️ Check-out fora da loja (a ${kmOuM(L.dist)}). A gestão foi avisada.`, 6000); }
  avisaGestor(L.fora ? 'fora' : 'saida', `✅ ${primNome()} saiu: ${V.loja.nome}`, `Check-out às ${hm(t)} · ficou ${dur(v.checkin, t)}${L.fora ? ` · ⚠️ SAÍDA FORA DA LOJA (${L.dist} m)` : ''}${sf.rosto && sf.rosto.rostoOk === false ? ' · ⚠️ rosto não confere' : ''}`, L.fora ? ['warning'] : ['white_check_mark']);
  setTimeout(() => { if (S.visita && S.visita.id === V.id) $('#v-voltar').click(); }, L.fora ? 2500 : 700); // volta para a rota
}
function naoVisitou() {
  abreModal(`<h3>Por que não visitou?</h3><div class="chips" id="mot">${MOTIVOS.map(m => `<button class="chip" aria-pressed="false" data-m="${h(m)}">${h(m)}</button>`).join('')}</div>
    <label class="field" for="mot-obs"><span>Detalhe (opcional)</span><input type="text" id="mot-obs"></label>
    <div class="row end"><button class="btn" id="mot-c">Cancelar</button><button class="btn primary" id="mot-s" disabled>Registrar</button></div>`);
  let esc = '';
  document.querySelectorAll('#mot .chip').forEach(b => b.onclick = () => { esc = b.dataset.m; document.querySelectorAll('#mot .chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#mot-s').disabled = false; });
  $('#mot-c').onclick = fechaModal;
  $('#mot-s').onclick = async () => {
    if (bloqueiaAlmoco()) { fechaModal(); return; }
    const obs = $('#mot-obs').value.trim(); fechaModal();
    let gps = null; try { gps = await pegaGPS(10000); } catch (e) {}
    avisaGestor('naoVisitou', `🚫 ${primNome()} não visitou: ${S.visita.loja.nome}`, `Motivo: ${esc}${obs ? ' — ' + obs : ''}`, ['no_entry']);
    const visita = novaVisita({ status: 'nao_visitada', motivo: esc, obs, registrado: Date.now(), gpsIn: gps });
    S.vis[S.visita.id] = visita; renderVisita();
    grava(setDoc(doc(db, 'dias', S.hoje, 'visitas', S.visita.id), visita)); setTimeout(() => $('#v-voltar').click(), 500);
  };
}
function atualiza(campos) {
  if (!campos.checkout && bloqueiaAlmoco()) return Promise.resolve();
  const V = S.visita; if (!V) return Promise.resolve(); const v = S.vis[V.id];
  if (v) { S.vis[V.id] = Object.assign({}, v, campos, campos.checklist ? { checklist: Object.assign({}, v.checklist, campos.checklist) } : {}, campos.precos ? { precos: Object.assign({}, v.precos, Object.fromEntries(Object.entries(campos.precos).map(([k, x]) => [chaveQ(k), x]))) } : {}); renderVisita(); }
  const upd = Object.assign({}, campos, { atualizado: Date.now(), recebido: serverTimestamp() });
  if (campos.precos) { delete upd.precos; Object.entries(campos.precos).forEach(([k, val]) => upd['precos.' + chaveQ(k)] = val); }
  if (campos.checklist) { delete upd.checklist; Object.entries(campos.checklist).forEach(([k, val]) => upd['checklist.' + k.replace(/[.~*/\[\]]/g, '_')] = val); }
  return grava(updateDoc(doc(db, 'dias', S.hoje, 'visitas', V.id), upd));
}

function renderFotos() {
  if (!S.visita) return;
  const g = $('#v-fotos'); const v = S.vis[S.visita.id]; const pode = v && v.status === 'em_loja';
  g.innerHTML = TIPOS.map(([t, l]) => {
    const f = S.fotos.find(x => (x.tipo || 'extra') === t);
    if (f) return `<div class="stack" style="gap:4px"><div class="foto"><img src="${f.d}" alt="${l}">${pode && t !== 'chegada' && t !== 'saida' ? `<button aria-label="Refazer ${l}" data-rm="${t}">×</button>` : ''}</div><span class="muted num" style="font-size:11px;text-align:center">${l} · ${hm(f.ts)}</span></div>`;
    if (t === 'chegada' || t === 'saida') return '';
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
  if (bloqueiaAlmoco()) return;
  const V = S.visita; S.fotos = lista; renderFotos();
  grava(setDoc(doc(db, 'dias', S.hoje, 'fotos', V.id), { visita: V.id, imgs: lista }), true);
  atualiza({ fotos: lista.length }); proximoPasso();
}
/* ---------- pesquisa de preço ---------- */
const chaveQ = q => q.replace(/[.~*/\[\]]/g, '_');
// item completo: Ruptura, ou preço de ponta + validade (a quantidade é opcional)
// validade com menos de 10 dias (alerta) exige também a quantidade a vender
const precisaQtd = x => !!x && !x.falta && !!x.val && diasAte(x.val) < 10;
const precoRespondido = x => !!x && (x.falta === true || (typeof x.preco === 'number' && x.preco >= 0 && !!x.val && (!precisaQtd(x) || (x.qtd != null && x.qtd >= 0))));
const brl2 = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Lê o campo de preço e grava (só se mudou). avancar = leva para o próximo item.
function salvaPreco(inp, avancar) {
  if (!S.visita || !S.vis[S.visita.id]) return;
  const q = S.pesquisa[+inp.dataset.pq]; const atual = (S.vis[S.visita.id].precos || {})[chaveQ(q)];
  const t = inp.value.trim(); const n = t ? +t.replace(/\./g, '').replace(',', '.') : null;
  if (n == null) { if (atual && !atual.falta && typeof atual.preco === 'number') atualiza({ precos: { [q]: (atual.val || atual.qtd != null) ? Object.fromEntries(Object.entries({ val: atual.val, qtd: atual.qtd, ts: Date.now() }).filter(([, x]) => x != null)) : null } }); return; }
  if (!isFinite(n) || n < 0 || n > 999) { toast('Preço inválido. Use o formato 7,99.'); inp.value = ''; return; }
  const val = Math.round(n * 100) / 100;
  if (!(atual && atual.preco === val)) atualiza({ precos: { [q]: Object.assign({}, atual && !atual.falta ? atual : {}, { preco: val, ts: Date.now() }) } });
  if (avancar) proximoPasso();
}
// validade: menos de 10 dias = amarelo; menos de 7 = vermelho
const diasAte = d => Math.round((new Date(d + 'T12:00:00') - new Date(S.hoje + 'T12:00:00')) / 864e5);
const corVal = d => { if (!d) return ''; const n = diasAte(d); return n < 7 ? 'crit' : n < 10 ? 'warn' : ''; };
const txtVal = d => { if (!d) return ''; const n = diasAte(d); return n < 0 ? `vencido há ${-n} dia${n < -1 ? 's' : ''}` : n === 0 ? 'vence hoje' : `vence em ${n} dia${n > 1 ? 's' : ''}`; };
function renderPesquisa(v) {
  const box = $('#v-pp');
  { const r = v.precos || {}, ok = S.pesquisa.filter(q => precoRespondido(r[chaveQ(q)])).length; $('#v-pp-n').innerHTML = ok === S.pesquisa.length ? '<span style="color:var(--ok)">completa</span>' : `${ok} de ${S.pesquisa.length}`; }
  const resp = v.precos || {}; const pode = v.status === 'em_loja';
  // já montado para esta visita: só atualiza no lugar (não recria os campos — senão perde o que está sendo digitado)
  const chave = (S.visita && S.visita.id) + '|' + S.pesquisa.join('|');
  if (box.dataset.k === chave) {
    S.pesquisa.forEach((q, i) => { const x = resp[chaveQ(q)] || {}; const inp = box.querySelector(`[data-pq="${i}"]`), bt = box.querySelector(`[data-pf="${i}"]`); if (!inp) return;
      if (document.activeElement !== inp) { const novo = typeof x.preco === 'number' ? brl2(x.preco) : (x.falta ? '' : inp.value); if (inp.value !== novo) inp.value = novo; }
      inp.disabled = !pode || !!x.falta; inp.parentElement.classList.toggle('off', !!x.falta); bt.setAttribute('aria-pressed', String(!!x.falta)); bt.disabled = !pode;
      const qt = box.querySelector(`[data-pqt="${i}"]`); if (qt) { if (document.activeElement !== qt) qt.value = x.qtd != null ? x.qtd : ''; qt.disabled = !pode || !!x.falta; qt.closest('.pp-val').classList.toggle('off', !!x.falta); qt.closest('.pp-val').hidden = !precisaQtd(x); }
      const vd = box.querySelector(`[data-pv="${i}"]`); if (vd) { if (document.activeElement !== vd) vd.value = x.val || ''; vd.disabled = !pode || !!x.falta; const w = vd.closest('.pp-val'); w.className = 'pp-val ' + corVal(x.val) + (x.falta ? ' off' : ''); w.querySelector('small').textContent = txtVal(x.val); } });
    return;
  }
  box.dataset.k = chave;
  box.innerHTML = S.pesquisa.map((q, i) => { const x = resp[chaveQ(q)] || {};
    return `<div class="pp-item"><span class="pp-nome">${h(q)}</span><div class="pp-ctl">
      <div class="pp-preco ${x.falta ? 'off' : ''}"><span>R$</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-pq="${i}" placeholder="0,00" value="${typeof x.preco === 'number' ? brl2(x.preco) : ''}" ${!pode || x.falta ? 'disabled' : ''}></div>
      <label class="pp-val ${corVal(x.val)}${x.falta ? ' off' : ''}"><span>Validade</span><input type="date" data-pv="${i}" value="${h(x.val || '')}" ${!pode || x.falta ? 'disabled' : ''}><small>${txtVal(x.val)}</small></label>
      <label class="pp-val pp-qtd${x.falta ? ' off' : ''}" ${precisaQtd(x) ? '' : 'hidden'}><span>Qtd a vender *</span><input type="number" inputmode="numeric" min="0" step="1" data-pqt="${i}" value="${x.qtd != null ? x.qtd : ''}" placeholder="un" ${!pode || x.falta ? 'disabled' : ''}><small></small></label>
      <button class="btn sm pp-falta" data-pf="${i}" aria-pressed="${!!x.falta}" ${pode ? '' : 'disabled'}>Ruptura</button></div></div>`; }).join('');
  if (S.pesquisa.length > 8) { // lista grande: campo para achar o produto
    box.insertAdjacentHTML('afterbegin', `<input type="search" id="pp-busca" placeholder="Buscar produto (nome ou código)" autocomplete="off" style="margin-bottom:6px">`);
    $('#pp-busca').oninput = e => { const t = semAcento(e.target.value.trim()); box.querySelectorAll('.pp-item').forEach(it => { it.hidden = !!t && !semAcento(it.querySelector('.pp-nome').textContent).includes(t); }); };
  }
  const ok = S.pesquisa.filter(q => precoRespondido(resp[chaveQ(q)])).length;
  $('#v-pp-n').innerHTML = ok === S.pesquisa.length ? '<span style="color:var(--ok)">completa</span>' : `${ok} de ${S.pesquisa.length}`;
  box.querySelectorAll('[data-pq]').forEach(inp => {
    // máscara de dinheiro: digita só os números e a vírgula entra sozinha (4 → 0,04; 46 → 0,46; 460 → 4,60)
    // grava enquanto digita (o iPhone não avisa "change" quando a máscara reescreve o campo)
    let t0 = null;
    inp.oninput = () => { const d = inp.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 5); inp.value = d ? brl2(+d / 100) : ''; clearTimeout(t0); t0 = setTimeout(() => salvaPreco(inp, false), 900); };
    inp.onchange = inp.onblur = () => { clearTimeout(t0); salvaPreco(inp, true); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
  });
  box.querySelectorAll('[data-pv]').forEach(inp => inp.onchange = () => { // validade mais próxima vista na gôndola (opcional)
    if (!S.visita || !S.vis[S.visita.id]) return;
    const q = S.pesquisa[+inp.dataset.pv]; const atual = (S.vis[S.visita.id].precos || {})[chaveQ(q)] || {};
    const val = inp.value || null; if ((atual.val || null) === val) return;
    const novo = Object.assign({}, atual.falta ? {} : atual, { ts: Date.now() }); if (val) novo.val = val; else delete novo.val;
    atualiza({ precos: { [q]: (typeof novo.preco === 'number' || novo.val || novo.qtd != null) ? novo : null } });
    if (val && diasAte(val) < 10) { toast(`⚠️ ${q.replace(/^\d+ - /, '')}: ${txtVal(val)}. Informe a quantidade a vender.`, 5000); setTimeout(() => { const qt = document.querySelector(`[data-pqt="${inp.dataset.pv}"]`); if (qt) { qt.closest('.pp-val').hidden = false; qt.focus(); } }, 300); }
  });
  box.querySelectorAll('[data-pqt]').forEach(inp => inp.onchange = () => { // quantidade com essa validade na gôndola (a vender)
    if (!S.visita || !S.vis[S.visita.id]) return;
    const q = S.pesquisa[+inp.dataset.pqt]; const atual = (S.vis[S.visita.id].precos || {})[chaveQ(q)] || {};
    const n = inp.value === '' ? null : Math.max(0, Math.round(+inp.value)); if ((atual.qtd ?? null) === n) return;
    const novo = Object.assign({}, atual.falta ? {} : atual, { ts: Date.now() }); if (n != null) novo.qtd = n; else delete novo.qtd;
    atualiza({ precos: { [q]: (typeof novo.preco === 'number' || novo.val || novo.qtd != null) ? novo : null } });
  });
  box.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => {
    const q = S.pesquisa[+b.dataset.pf]; const atual = ((S.vis[S.visita.id].precos || {})[chaveQ(q)] || {}).falta;
    atualiza({ precos: { [q]: atual ? null : { falta: true, ts: Date.now() } } }); if (!atual) proximoPasso();
  });
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
