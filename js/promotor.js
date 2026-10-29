// App do promotor: rota do dia, check-in com GPS + raio + selfie, fotos antes/depois, checklist, check-out
import {
  auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, collection, query, where, onSnapshot,
  emailPromotor, senhaPromotor, $, h, semAcento, DIAS_LONGO, ymd, diaSemana, hm, dur, lsGet, lsSet,
  toast, abreModal, fechaModal, confirma, erroMsg, distancia, pegaGPS, comprime, tiraFoto
} from './fb.js';

const ADMIN_UID = 'LwETkIMFw0b6gVWl6XV450J1Dr12';
const CHECK_PADRAO = ['Produto em ruptura (faltando na gôndola)', 'Produto com validade próxima', 'Preço divergente da tabela', 'Gôndola abastecida e organizada'];
const MOTIVOS = ['Loja fechada', 'Sem acesso / recebimento', 'Falta de tempo', 'Outro'];
const TIPOS = [['chegada', 'Chegada'], ['antes', 'Gôndola antes'], ['depois', 'Gôndola depois'], ['extra', 'Foto extra']];

const S = { uid: null, pid: null, prom: null, lojas: [], todas: null, vis: {}, checklist: CHECK_PADRAO, raio: 150, hoje: ymd(new Date()), visita: null, fotos: [], unsub: [] };
const show = id => ['carregando', 'v-login', 'v-semacesso', 'v-rota'].forEach(x => $('#' + x).hidden = x !== id);

/* ---------- login ---------- */
const pins = [0, 1, 2, 3].map(i => $('#pin-' + i));
pins.forEach((el, i) => {
  el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(-1); if (el.value && i < 3) pins[i + 1].focus(); });
  el.addEventListener('keydown', e => { if (e.key === 'Backspace' && !el.value && i > 0) pins[i - 1].focus(); });
});
$('#lg-usuario').value = lsGet('np.usuario') || '';
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault();
  const u = semAcento($('#lg-usuario').value.trim()).replace(/[^a-z0-9]/g, '');
  const c = pins.map(x => x.value).join('');
  if (!u) return $('#lg-msg').textContent = 'Digite seu usuário.';
  if (c.length < 4) return $('#lg-msg').textContent = 'Digite os 4 números do código.';
  $('#lg-btn').disabled = true; $('#lg-msg').textContent = 'Entrando…';
  try { await signInWithEmailAndPassword(auth, emailPromotor(u), senhaPromotor(c)); lsSet('np.usuario', u); }
  catch (err) { $('#lg-msg').textContent = erroMsg(err); pins.forEach(x => x.value = ''); pins[0].focus(); }
  finally { $('#lg-btn').disabled = false; }
});
$('#sair').onclick = async () => { if (await confirma('Sair do aplicativo?', 'Sair')) { S.unsub.forEach(f => f()); await signOut(auth); location.reload(); } };

onAuthStateChanged(auth, async user => {
  if (!user) { show('v-login'); $('#sair').hidden = true; $('#quem').textContent = ''; return; }
  S.uid = user.uid; $('#sair').hidden = false;
  if (user.uid === ADMIN_UID) { location.href = 'gestao.html'; return; }
  try {
    const u = await getDoc(doc(db, 'usuarios', user.uid));
    if (!u.exists()) {
      try { if ((await getDoc(doc(db, 'admins', user.uid))).exists()) { location.href = 'gestao.html'; return; } } catch (e) {}
      show('v-semacesso'); return;
    }
    S.pid = u.data().promotorId;
    iniciar();
  } catch (e) { show('v-semacesso'); toast(erroMsg(e)); }
});

function iniciar() {
  show('v-rota');
  S.unsub.push(onSnapshot(doc(db, 'promotores', S.pid), s => { S.prom = s.exists() ? s.data() : { nome: 'Promotor' }; $('#quem').innerHTML = `Olá<b>${h(S.prom.nome.split(' ')[0])}</b>`; render(); }));
  S.unsub.push(onSnapshot(doc(db, 'config', 'checklist'), s => { const it = s.exists() && s.data().itens; S.checklist = Array.isArray(it) && it.length ? it : CHECK_PADRAO; if (S.visita) renderVisita(); }, () => {}));
  S.unsub.push(onSnapshot(doc(db, 'config', 'app'), s => { if (s.exists() && +s.data().raio) S.raio = +s.data().raio; }, () => {}));
  S.unsub.push(onSnapshot(query(collection(db, 'lojas'), where('promotorId', '==', S.pid)), s => { S.lojas = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, e => toast(erroMsg(e))));
  S.unsub.push(onSnapshot(query(collection(db, 'dias', S.hoje, 'visitas'), where('promotorId', '==', S.pid)), s => {
    const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.vis = m; render(); if (S.visita) renderVisita();
  }, e => toast(erroMsg(e))));
  // vira o dia sozinho se o app ficar aberto
  setInterval(() => { if (ymd(new Date()) !== S.hoje) location.reload(); }, 60000);
}

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
    <div class="progress"><i style="width:${lojas.length ? Math.round(feitas / lojas.length * 100) : 0}%"></i></div>`;
  if (!lojas.length) html += `<div class="empty"><b>Sem lojas para hoje</b>Nenhuma loja está marcada para ${DIAS_LONGO[wdHoje()]} na sua rota.</div>`;
  else html += '<div class="stops">' + lojas.map((l, i) => {
    const v = S.vis[vid(l.id)]; const cls = v ? (v.status === 'em_loja' ? 'live' : v.status === 'concluida' ? 'done' : '') : '';
    return `<button class="stop ${cls}" data-loja="${h(l.id)}"><span class="n num">${i + 1}</span><span class="t"><b>${h(l.nome)}</b><span>${h(l.codigo || '')} · ${h(l.bairro || l.cidade || '')}</span></span>${statusPill(v)}</button>`;
  }).join('') + '</div>';
  if (extras.length) html += '<div class="label">Fora da rota</div><div class="stops">' + extras.map(v => `<button class="stop" data-loja="${h(v.lojaId)}" data-fora="1"><span class="n">+</span><span class="t"><b>${h(v.lojaNome)}</b><span>${h(v.cidade || '')}</span></span>${statusPill(v)}</button>`).join('') + '</div>';
  html += `<button class="btn" id="b-fora">Visitar loja fora da rota de hoje</button>`;
  c.innerHTML = html;
  c.querySelectorAll('[data-loja]').forEach(b => b.onclick = () => abreVisita(b.dataset.loja, !!b.dataset.fora));
  $('#b-fora').onclick = buscaFora;
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
    foraRota: V.fora, ordem: V.fora ? null : V.ordem + 1, checklist: {}, obs: '', fotos: 0, uid: S.uid, atualizado: Date.now() }, extra);
}
async function checkin() {
  const V = S.visita; const b = $('#b-in'); b.disabled = true; b.firstChild.textContent = 'Pegando o GPS…';
  let gps;
  try { gps = await pegaGPS(); } catch (e) { toast(e.message, 6000); b.disabled = false; b.firstChild.textContent = 'Fazer check-in'; return; }
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
  b.firstChild.textContent = 'Abrindo a câmera…';
  const cv = await tiraFoto({ frontal: true, titulo: 'Selfie na frente da loja' });
  b.disabled = false; b.firstChild.textContent = 'Fazer check-in';
  if (!cv) return;
  const foto = { d: await comprime(cv), ts: Date.now(), tipo: 'chegada', gps };
  const visita = novaVisita({ status: 'em_loja', checkin: foto.ts, checkout: null, gpsIn: gps, distIn: dist, semCoord: V.loja.lat == null, fotos: 1 });
  S.vis[V.id] = visita; S.fotos = [foto]; renderVisita();
  try {
    await setDoc(doc(db, 'dias', S.hoje, 'visitas', V.id), visita);
    await setDoc(doc(db, 'dias', S.hoje, 'fotos', V.id), { visita: V.id, imgs: [foto] });
    toast('Check-in registrado às ' + hm(visita.checkin));
  } catch (e) { toast(erroMsg(e), 6000); }
}
async function checkout() {
  const V = S.visita; const v = S.vis[V.id];
  const semFoto = ['antes', 'depois'].filter(t => !S.fotos.some(x => x.tipo === t));
  if (semFoto.length) { toast('Para fazer check-out, tire a foto: gôndola ' + semFoto.join(' e ') + '.', 5000); $('#v-fotos').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const faltam = S.checklist.filter(q => !(v.checklist || {})[q.replace(/[.~*/\[\]]/g, '_')]).length;
  if (faltam && !(await confirma(`${faltam} pergunta(s) do checklist sem resposta. Fazer check-out mesmo assim?`, 'Fazer check-out'))) return;
  const b = $('#b-out'); if (b) { b.disabled = true; b.textContent = 'Pegando o GPS…'; }
  let gps = null, dist = null;
  try { gps = await pegaGPS(15000); if (V.loja.lat != null) dist = Math.round(distancia(gps, { lat: +V.loja.lat, lng: +V.loja.lng })); } catch (e) {}
  const t = Date.now();
  atualiza({ status: 'concluida', checkout: t, gpsOut: gps, distOut: dist }).then(() => toast('Check-out às ' + hm(t)));
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
    setDoc(doc(db, 'dias', S.hoje, 'visitas', S.visita.id), visita).catch(e => toast(erroMsg(e)));
  };
}
function atualiza(campos) {
  const V = S.visita; const v = S.vis[V.id];
  if (v) { S.vis[V.id] = Object.assign({}, v, campos, campos.checklist ? { checklist: Object.assign({}, v.checklist, campos.checklist) } : {}); renderVisita(); }
  const upd = Object.assign({}, campos, { atualizado: Date.now() });
  if (campos.checklist) { delete upd.checklist; Object.entries(campos.checklist).forEach(([k, val]) => upd['checklist.' + k.replace(/[.~*/\[\]]/g, '_')] = val); }
  return updateDoc(doc(db, 'dias', S.hoje, 'visitas', V.id), upd).catch(e => toast(erroMsg(e)));
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
  setDoc(doc(db, 'dias', S.hoje, 'fotos', V.id), { visita: V.id, imgs: lista })
    .then(() => { atualiza({ fotos: lista.length }); toast('Foto salva'); }, e => toast(erroMsg(e)));
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
  obsT = setTimeout(() => atualiza({ obs: $('#v-obs').value }).then(() => $('#v-obs-st').textContent = 'Salvo'), 900);
});
