// Verificador automático: avisa no canal ntfy quem tem rota hoje e ainda não fez nenhum registro.
// Roda no GitHub Actions (ver .github/workflows/verifica-inicio.yml). Usa uma conta só de leitura (monitores).
const KEY = 'AIzaSyC4iWQTEYl7TsxgTc5Aubbw-1bB4ct4V8U'; // chave pública do app web (não é segredo)
const PROJ = 'rota-nova-penedo';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;
const { MONITOR_EMAIL, MONITOR_SENHA, RODADA = '1', FORCAR = '' } = process.env;
if (!MONITOR_EMAIL || !MONITOR_SENHA) { console.log('Faltam os segredos MONITOR_EMAIL e MONITOR_SENHA no GitHub.'); process.exit(1); }

const val = v => v == null ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(val)
  : 'mapValue' in v ? obj(v.mapValue.fields || {}) : 'timestampValue' in v ? Date.parse(v.timestampValue) : null;
const obj = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));

const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: MONITOR_EMAIL, password: MONITOR_SENHA, returnSecureToken: true })
}).then(r => r.json());
if (!login.idToken) { console.log('Login do verificador falhou:', login.error && login.error.message); process.exit(1); }
const H = { Authorization: 'Bearer ' + login.idToken };

async function lista(caminho, campos = []) {
  const out = []; let pt = '';
  do {
    const q = new URLSearchParams({ pageSize: '300' }); campos.forEach(c => q.append('mask.fieldPaths', c)); if (pt) q.set('pageToken', pt);
    const r = await fetch(`${BASE}/${caminho}?${q}`, { headers: H }).then(r => r.json());
    if (r.error) throw new Error(caminho + ': ' + r.error.message);
    (r.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...obj(d.fields) })); pt = r.nextPageToken;
  } while (pt);
  return out;
}
async function pega(caminho) { const r = await fetch(`${BASE}/${caminho}`, { headers: H }).then(r => r.json()); return r.error ? null : obj(r.fields); }

// data e hora de São Paulo
const agora = new Date();
const sp = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(agora).map(p => [p.type, p.value]));
const hoje = `${sp.year}-${sp.month}-${sp.day}`; const hora = `${sp.hour}:${sp.minute}`;
const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(sp.weekday);

const cfg = (await pega('config/app')) || {};
const nt = cfg.ntfy || {};
if (!nt.topico) { console.log('Canal ntfy não criado na Gestão.'); process.exit(0); }
if (nt.inicio === false && !FORCAR) { console.log('Alerta "não começou" desligado na Gestão.'); process.exit(0); }

const [promotores, lojas, visitas] = await Promise.all([
  lista('promotores', ['nome', 'ativo']), lista('lojas', ['promotorId', 'dias']), lista(`dias/${hoje}/visitas`, ['promotorId'])
]);
const comRota = promotores.filter(p => p.ativo !== false).map(p => ({ ...p, n: lojas.filter(l => l.promotorId === p.id && (l.dias || []).map(Number).includes(wd)).length })).filter(p => p.n);
const comecou = new Set(visitas.map(v => v.promotorId));
const falta = comRota.filter(p => !comecou.has(p.id));
console.log(`${hoje} ${hora} · com rota: ${comRota.length} · sem registro: ${falta.map(p => p.nome).join(', ') || 'ninguém'}`);

const envia = (title, message, tags, priority = 3) => fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: nt.topico, title, message, tags, priority }) }).then(r => console.log('ntfy', r.status));
if (falta.length) {
  const nomes = falta.map(p => `• ${p.nome.split(' ')[0]} (${p.n} ${p.n === 1 ? 'loja' : 'lojas'})`).join('\n');
  await envia(RODADA === '2' ? `⏰ Ainda sem começar a rota (${hora})` : `⏰ ${falta.length} ${falta.length === 1 ? 'promotor não começou' : 'promotores não começaram'} a rota (${hora})`, nomes, ['alarm_clock'], 4);
} else if (RODADA !== '2' && comRota.length) await envia(`✅ Todos começaram a rota (${hora})`, `${comRota.length} promotores com rota hoje já fizeram check-in.`, ['white_check_mark'], 2);
