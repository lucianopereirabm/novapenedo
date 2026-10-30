// Textos dos termos assinados pelo promotor no primeiro acesso.
// Ao mudar o texto, mude a VERSAO: todos assinam de novo na próxima abertura do app.
export const VERSAO = '2026-10-v1';

const linha = (v, vazio = '________________') => (v && String(v).trim()) || vazio;

export function termoLGPD(c) {
  return `TERMO DE CIÊNCIA E CONSENTIMENTO PARA TRATAMENTO DE DADOS PESSOAIS
(Lei Geral de Proteção de Dados – Lei nº 13.709/2018)

1. PARTES
Empresa (controladora): ${linha(c.empresa)}, CNPJ ${linha(c.cnpj)}.
Promotor(a) (titular): ${linha(c.nome)}, CPF ${linha(c.cpf)}.

2. DADOS TRATADOS
a) Identificação e contato: nome, CPF, telefone e e-mail.
b) Imagem do rosto: foto de cadastro e as selfies tiradas no aplicativo.
c) Biometria facial: medidas do rosto calculadas a partir das fotos, usadas somente para confirmar que é o(a) próprio(a) promotor(a) quem usa o aplicativo.
d) Localização (GPS): registrada SOMENTE nos momentos de check-in, check-out e registro de loja não visitada. O aplicativo NÃO faz rastreamento contínuo e não coleta localização fora desses registros.
e) Dados do trabalho: lojas visitadas, horários de entrada e saída, fotos das gôndolas, respostas do checklist e observações.
f) Dados do aparelho: modelo, sistema, navegador e número da linha informado.

3. FINALIDADES
Controle da rota e das visitas; comprovação do trabalho realizado; cálculo da remuneração variável e da premiação; segurança do acesso, impedindo que outra pessoa use o login do(a) promotor(a).

4. BASES LEGAIS
Execução do contrato de trabalho e cumprimento de obrigações legais (art. 7º, II e V); legítimo interesse da empresa no controle das visitas, das fotos de trabalho e da localização nos registros (art. 7º, IX); CONSENTIMENTO ESPECÍFICO E DESTACADO para a biometria facial (art. 11, I).

5. COMPARTILHAMENTO E SEGURANÇA
Os dados não são vendidos nem cedidos a terceiros. O acesso é restrito à gestão da empresa. Os dados ficam guardados em serviço de nuvem contratado pela empresa (Google Firebase), com acesso protegido por senha. O(a) promotor(a) vê apenas os próprios dados.

6. TEMPO DE GUARDA
Durante o contrato e, depois dele, pelo prazo necessário ao cumprimento de obrigações legais e à defesa em processos (em regra, até 5 anos). A foto do rosto e a biometria facial serão excluídas em até 30 dias após o desligamento ou após a revogação do consentimento.

7. DIREITOS DO TITULAR (art. 18)
O(a) promotor(a) pode, a qualquer momento: confirmar e acessar seus dados; pedir correção; pedir a eliminação do que não for obrigatório guardar; e REVOGAR o consentimento da biometria facial, sem qualquer prejuízo. Nesse caso, a empresa definirá outra forma de acesso ao aplicativo.

8. CONTATO
Pedidos e dúvidas sobre dados pessoais: ${linha(c.contato)}.`;
}

export function termoAparelho(c) {
  const empresa = c.propriedade === 'empresa';
  const corpo = empresa ? `2. APARELHO CEDIDO PELA EMPRESA
O aparelho acima e a linha telefônica são de propriedade da empresa e foram entregues ao(à) promotor(a) para uso no trabalho. O(a) promotor(a) se compromete a:
a) guardar e conservar o aparelho com cuidado, usando capa e película quando fornecidas;
b) não emprestar o aparelho nem o login do aplicativo a outras pessoas;
c) usar o aparelho e a linha prioritariamente para o trabalho, de forma moderada no uso pessoal;
d) não apagar nem desinstalar o aplicativo de rotas;
e) comunicar à gestão, no mesmo dia, perda, roubo, furto ou defeito, apresentando boletim de ocorrência em caso de roubo ou furto;
f) devolver o aparelho, carregador e acessórios ao fim do contrato ou quando solicitado, no estado em que recebeu, ressalvado o desgaste natural.
Eventuais descontos por dano somente ocorrerão nas hipóteses do art. 462, § 1º, da CLT (dano causado com dolo, ou com culpa quando houver acordo).`
    : `2. APARELHO PARTICULAR DO PROMOTOR
O aparelho acima é de propriedade do(a) promotor(a), que autoriza a instalação e o uso do aplicativo de rotas da empresa nele. Fica combinado que:
a) o aplicativo só usa a câmera e a localização quando o(a) promotor(a) aciona as funções de check-in, fotos e check-out;
b) a empresa NÃO tem acesso a fotos, mensagens, contatos, arquivos ou qualquer conteúdo pessoal do aparelho;
c) o aplicativo é usado apenas para o trabalho, no horário de trabalho;
d) o(a) promotor(a) não empresta o login do aplicativo a outras pessoas;
e) eventual ressarcimento de despesas com internet e uso do aparelho segue o que for combinado com a empresa;
f) ao fim do contrato, o acesso ao aplicativo é encerrado e o(a) promotor(a) pode desinstalá-lo.`;
  return `TERMO DE RESPONSABILIDADE E USO DO APARELHO CELULAR

1. IDENTIFICAÇÃO
Empresa: ${linha(c.empresa)}, CNPJ ${linha(c.cnpj)}.
Promotor(a): ${linha(c.nome)}, CPF ${linha(c.cpf)}.
Aparelho: ${linha(c.aparelho && c.aparelho.modelo, 'modelo não identificado')} · ${linha(c.aparelho && c.aparelho.sistema, '')}
Número da linha: ${linha(c.numero)} · Código do aparelho no sistema: ${linha(c.aparelho && c.aparelho.id, '')}
Propriedade: ${empresa ? 'da EMPRESA (cedido para o trabalho)' : 'do(a) PROMOTOR(A) (aparelho particular)'}

${corpo}

3. REGISTRO DESTA ASSINATURA
Esta assinatura eletrônica registra data e hora, localização do momento, os dados do aparelho acima e uma foto do rosto do(a) promotor(a), conferida com a foto do cadastro.`;
}

// Impressão digital do texto assinado (garante que o texto não foi alterado depois)
export async function hashTexto(t) {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return ''; }
}

// Informações do aparelho que o navegador permite ler (número da linha e IMEI não são acessíveis)
export async function infoAparelho() {
  const ua = navigator.userAgent; let modelo = '', sistema = '';
  try { if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) { const x = await navigator.userAgentData.getHighEntropyValues(['model', 'platform', 'platformVersion']); modelo = x.model || ''; sistema = [x.platform, x.platformVersion].filter(Boolean).join(' '); } } catch (e) {}
  if (!sistema) { const m = ua.match(/Android [\d.]+|iPhone OS [\d_]+|iPad; CPU OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_.]+/); sistema = m ? m[0].replace(/_/g, '.').replace('iPhone OS', 'iOS') : ''; }
  if (!modelo) { const m = ua.match(/Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+)/i); modelo = m ? m[1].trim() : /iPhone/.test(ua) ? 'iPhone' : ''; if (modelo === 'K') modelo = ''; }
  let id = ''; try { id = localStorage.getItem('np.aparelho') || ''; if (!id) { id = 'AP-' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase(); localStorage.setItem('np.aparelho', id); } } catch (e) {}
  const nav = (ua.match(/SamsungBrowser\/[\d.]+|EdgA?\/[\d.]+|CriOS\/[\d.]+|Chrome\/[\d.]+|Firefox\/[\d.]+|Version\/[\d.]+ Mobile.*Safari/) || [''])[0].replace(/\/.*Safari/, ' Safari');
  return { modelo, sistema, navegador: nav, tela: `${screen.width}x${screen.height}`, id, userAgent: ua };
}
