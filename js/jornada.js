// Cálculo da jornada do dia e do banco de horas (usado no app e na Gestão)
export const CARGA_PADRAO = { 0: 0, 1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 240 }; // minutos por dia da semana (dom=0)
export const ALMOCO_PADRAO = { min: 60, acimaDe: 360 }; // desconta 1h quando a jornada passa de 6h

export function regrasJornada(cfgApp) {
  const c = (cfgApp && cfgApp.jornada) || {};
  const carga = Object.assign({}, CARGA_PADRAO, c.carga || {});
  return { carga, almocoMin: c.almocoMin ?? ALMOCO_PADRAO.min, almocoAcima: c.almocoAcima ?? ALMOCO_PADRAO.acimaDe, inicioPrevisto: c.inicioPrevisto || '08:00', tolerancia: c.tolerancia ?? 30,
    almocoMinimo: c.almocoMinimo ?? 0, // (antigo) almoço marcado pelo promotor
    // almoço automático: todo dia no mesmo horário, app bloqueado e desconto exato desse intervalo (null = desligado)
    almocoFixo: c.almocoFixo === null ? null : Object.assign({ ini: '12:00', fim: '13:00', desde: '2026-11-10' }, c.almocoFixo || {}) };
}
// intervalo do almoço automático de um dia, em ms (hora local) — null se não vale para esse dia
export function janelaAlmoco(regras, date) {
  const f = regras && regras.almocoFixo; if (!f || (f.desde && date < f.desde)) return null;
  const em = t => { const [hh, mm] = String(t).split(':').map(Number); const d = new Date(date + 'T00:00:00'); d.setHours(hh || 0, mm || 0, 0, 0); return d.getTime(); };
  const a = em(f.ini), b = em(f.fim); return b > a ? [a, b] : null;
}

// Jornada = do primeiro check-in do dia até o check-out da última loja.
// vs = visitas do promotor no dia. Em andamento (hoje, ainda em loja ou com rota pendente) conta até agora.
export function calcJornada({ vs = [], j = null, date, regras, agora = Date.now(), hoje }) {
  const wd = new Date(date + 'T12:00:00').getDay();
  const esperado = (regras.carga[wd] || 0);
  const ins = vs.map(v => v.checkin).filter(Boolean);
  if (!ins.length) return { tem: false, esperado, wd };
  const inicio = Math.min(...ins);
  const outs = vs.map(v => v.checkout).filter(Boolean);
  const emLoja = vs.some(v => v.status === 'em_loja');
  let fim, andamento = false, fimEst = false;
  if (emLoja && date === hoje) { fim = agora; andamento = true; }
  else if (emLoja) { fim = Math.max(...ins.concat(outs)); fimEst = true; } // dia passado sem check-out: conta até a última entrada
  else fim = Math.max(...outs.concat(ins));
  const bruto = Math.max(0, Math.round((fim - inicio) / 60000));
  // almoço: se o promotor marcou início e fim, desconta o tempo real; senão, regra padrão (1h acima de 6h)
  let almoco, almocoMarcado = false, almocoAberto = false, almocoFixo = false, aIni = j && j.almocoInicio, aFim = j && j.almocoFim;
  const jan = janelaAlmoco(regras, date);
  if (jan) { // almoço automático: desconta só a parte do intervalo que caiu dentro da jornada
    almocoFixo = true; aIni = jan[0]; aFim = jan[1];
    almoco = Math.max(0, Math.round((Math.min(jan[1], fim) - Math.max(jan[0], inicio)) / 60000));
    almocoAberto = date === hoje && agora >= jan[0] && agora < jan[1];
  } else if (j && j.almocoInicio) {
    almocoMarcado = true; almocoAberto = !j.almocoFim;
    const fa = j.almocoFim || (date === hoje ? agora : j.almocoInicio);
    almoco = Math.max(0, Math.round((Math.min(fa, fim) - Math.max(j.almocoInicio, inicio)) / 60000));
  } else almoco = bruto > regras.almocoAcima ? regras.almocoMin : 0;
  const trabalhado = Math.max(0, bruto - almoco);
  return { tem: true, inicio, fim, fimEst, andamento, emLoja, bruto, almoco, almocoMarcado, almocoAberto, almocoFixo, almocoIni: aIni, almocoFim: aFim, trabalhado, esperado, saldo: trabalhado - esperado, wd };
}

export const hmin = m => { if (m == null) return '—'; const s = m < 0 ? '-' : ''; m = Math.abs(Math.round(m)); return s + Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };
export const saldoTxt = m => (m > 0 ? '+' : '') + hmin(m);
