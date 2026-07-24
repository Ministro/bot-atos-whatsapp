require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const {
  diagnosticarNavigator,
  montarMensagemDiagnostico,
  montarMensagemAparelhosConectados
} = require("./navigator");

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(cors());

const PORT = process.env.PORT || 3000;

const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "atos-teste";
const STATUS_CPF_URL = process.env.STATUS_CPF_URL;
const TECNICO_NUMERO = process.env.TECNICO_NUMERO;

const OPA_BASE_URL = process.env.OPA_BASE_URL;
const IXC_URL = process.env.IXC_URL;
const IXC_USER = process.env.IXC_USER;
const IXC_PASS = process.env.IXC_PASS;
const OPA_TOKEN = process.env.OPA_TOKEN;

const NAVIGATOR_API_URL = process.env.NAVIGATOR_API_URL || "https://quintuple-backwash-slacked.ngrok-free.dev";
const NAVIGATOR_API_TOKEN = process.env.NAVIGATOR_API_TOKEN || "193746285";
const ENVIO_MASSA_TOKEN = "193746285";

const sessoes = new Map();
const timersEncerramento = new Map(); 

// Guarda o último CPF que cada número enviou no chat, para o comando manual /boleto
const cpfsCapturados = new Map();

// ===========================================================================
// NOVO: controle de "atendente assumiu o chat manualmente"
// ===========================================================================
// Guarda os IDs das mensagens que o PRÓPRIO BOT enviou. Como o bot manda
// mensagens usando o mesmo número/instância que você usa no celular, toda
// mensagem enviada pelo bot também chega de volta no webhook como
// "fromMe: true". Sem isso, o bot acabaria se autopausando toda vez que
// respondesse alguma coisa.
const idsMensagensBot = new Set();

// Guarda, por número de cliente, o timer dos 10 minutos de pausa. Enquanto o
// número estiver neste Map, o bot fica em silêncio nesse chat específico —
// os outros chats continuam funcionando normalmente.
const pausasAtendimentoHumano = new Map();

const palavrasDespedida = [
  "obrigado", "obrigada", "obg", "valeu", "vlw", "ok",
  "tá bom", "ta bom", "beleza", "blz", "certo",
  "perfeito", "show", "👍", "🙏"
];

const palavrasFinanceiro = [
  "boleto", "segunda via", "2 via", "fatura", "pagamento",
  "pagar", "pix", "vencimento", "financeiro",
  "codigo de barras", "código de barras"
];

const palavrasLentidao = [
  "lento", "lentidão", "lentidao", "oscilando", "travando",
  "internet lenta", "wifi lento", "wi-fi lento", "ping", "velocidade"
];

function limparCpf(texto) {
  return String(texto || "").replace(/\D/g, "");
}

function extrairCpfComHash(texto) {
  const match = String(texto || "").match(/#(\d{11})/);

  if (!match) return null;

  return match[1];
}

function pareceCpf(texto) {
  return limparCpf(texto).length === 11;
}

function respostaSim(texto) {
  const msg = String(texto || "").toLowerCase().trim();
  return ["sim", "s", "ss", "correto", "isso", "positivo", "1"].includes(msg);
}

function respostaNao(texto) {
  const msg = String(texto || "").toLowerCase().trim();
  return ["não", "nao", "n", "negativo", "errado", "2"].includes(msg);
}

function contemFinanceiro(texto) {
  const msg = String(texto || "").toLowerCase();
  return palavrasFinanceiro.some(p => msg.includes(p));
}

function contemLentidao(texto) {
  const msg = String(texto || "").toLowerCase();
  return palavrasLentidao.some(p => msg.includes(p));
}

function contemTrocarSenhaWifi(texto) {
  const msg = String(texto || "").toLowerCase();

  return (
    msg.includes("trocar senha") ||
    msg.includes("mudar senha") ||
    msg.includes("alterar senha") ||
    msg.includes("senha do wifi") ||
    msg.includes("senha do wi-fi") ||
    msg.includes("senha wifi") ||
    msg.includes("senha wi-fi")
  );
}

function contemDespedida(texto) {
  const msg = String(texto || "").toLowerCase().trim();
  return palavrasDespedida.some(p => msg.includes(p));
}

function ehAudio(message, data) {
  return Boolean(
    message?.audioMessage ||
    message?.pttMessage ||
    data?.messageType === "audioMessage" ||
    data?.messageType === "audio"
  );
}

function cancelarEncerramento(numero) {
  if (timersEncerramento.has(numero)) {
    clearTimeout(timersEncerramento.get(numero));
    timersEncerramento.delete(numero);
  }
}

function iniciarEncerramento(numero) {
  cancelarEncerramento(numero);

  const timer = setTimeout(async () => {
    try {
      await enviarMensagem(numero, `😊 Agradecemos o seu contato.

Caso precise de qualquer outra informação, estaremos à disposição.

Tenha um excelente dia! 💙`);

      sessoes.delete(numero);
      timersEncerramento.delete(numero);
    } catch (error) {
      console.error("Erro ao encerrar conversa:", error.message);
    }
  }, 120000);

  timersEncerramento.set(numero, timer);
}

// ===========================================================================
// NOVO: funções de pausa por atendimento humano
// ===========================================================================

// Marca (ou renova) a pausa de 10 minutos para um número específico.
// Chamada tanto quando VOCÊ manda uma mensagem manual pro cliente, quanto
// quando o CLIENTE manda mensagem enquanto o chat já está pausado — em
// ambos os casos o "relógio" de 10 minutos de silêncio recomeça do zero.
function pausarAtendimentoHumano(numero) {
  // Cancela qualquer timer de encerramento automático em andamento, já que
  // o atendente está cuidando da conversa manualmente agora.
  cancelarEncerramento(numero);

  // Zera o fluxo automático em que o cliente estava. Assim, quando o bot
  // voltar a responder (depois dos 10 minutos), ele começa do zero em vez
  // de tentar continuar um fluxo no meio, que pode já ter sido resolvido
  // por você manualmente.
  sessoes.delete(numero);

  if (pausasAtendimentoHumano.has(numero)) {
    clearTimeout(pausasAtendimentoHumano.get(numero));
  }

  const timer = setTimeout(() => {
    pausasAtendimentoHumano.delete(numero);
    console.log(`Bot retomado automaticamente para ${numero} após 10 minutos sem mensagens.`);
  }, 10 * 60 * 1000);

  pausasAtendimentoHumano.set(numero, timer);
}

function estaPausadoPorHumano(numero) {
  return pausasAtendimentoHumano.has(numero);
}

// Registra o ID de uma mensagem que o BOT acabou de enviar, para que quando
// ela "ecoar" de volta no webhook como fromMe:true, o sistema saiba que não
// foi você quem digitou aquilo manualmente.
function registrarMensagemDoBot(dadosResposta) {
  const id = dadosResposta?.key?.id;

  if (!id) return;

  idsMensagensBot.add(id);

  // Limpeza de segurança, caso o eco do webhook nunca chegue por algum motivo.
  setTimeout(() => idsMensagensBot.delete(id), 5 * 60 * 1000);
}

async function responderDespedida(numero) {
  cancelarEncerramento(numero);

  await enviarMensagem(numero, `😊 Nós que agradecemos!

A ATOS TELECOM agradece o seu contato.

Sempre que precisar, estaremos à disposição.

Tenha um excelente dia! 💙`);

  sessoes.delete(numero);
}

function gerarProtocolo() {
  const agora = new Date();
  const ano = String(agora.getFullYear()).slice(2);
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  const hora = String(agora.getHours()).padStart(2, "0");
  const min = String(agora.getMinutes()).padStart(2, "0");
  return `AT${ano}${mes}${dia}-${hora}${min}`;
}

function formatarTempo(segundos) {
  const total = Number(segundos || 0);
  if (!total) return "não informado";

  const dias = Math.floor(total / 86400);
  const horas = Math.floor((total % 86400) / 3600);
  const minutos = Math.floor((total % 3600) / 60);

  if (dias > 0) return `${dias} dia(s) e ${horas} hora(s)`;
  if (horas > 0) return `${horas} hora(s) e ${minutos} minuto(s)`;
  return `${minutos} minuto(s)`;
}

function montarEndereco(cliente, pppoe) {
  const enderecoContrato = [
    pppoe?.endereco,
    pppoe?.numero,
    pppoe?.complemento,
    pppoe?.bairro
  ].filter(Boolean).join(", ");

  if (enderecoContrato) return enderecoContrato;

  return [
    cliente?.endereco,
    cliente?.numero,
    cliente?.complemento,
    cliente?.bairro
  ].filter(Boolean).join(", ") || "não informado";
}

function listarAcesso(cliente, pppoe, index) {
  const endereco = montarEndereco(cliente, pppoe);
  const status = pppoe.online === "S" ? "🟢 CONECTADO" : "🔴 DESCONECTADO";

  return `${index + 1}️⃣ ${status}
📍 ${endereco}
🔐 Login: ${pppoe.login || "não informado"}
📄 Contrato: ${pppoe.id_contrato || "não informado"}`;
}

async function enviarMensagem(numero, texto) {
  const resposta = await axios.post(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    { number: numero, text: texto },
    {
      headers: {
        apikey: EVOLUTION_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );

  registrarMensagemDoBot(resposta?.data);
}

async function trocarSenhaWifiRemoto(ip, banda, senha) {
  const response = await axios.post(
    `${NAVIGATOR_API_URL}/trocar-senha`,
    {
      ip,
      banda,
      senha
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NAVIGATOR_API_TOKEN}`,
        "ngrok-skip-browser-warning": "1"
      },
      timeout: 90000
    }
  );

  return response.data;
}

async function consultarDiagnosticoRemoto(ip) {
  const response = await axios.post(
    `${NAVIGATOR_API_URL}/navigator`,
    { ip },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NAVIGATOR_API_TOKEN}`,
        "ngrok-skip-browser-warning": "1"
      },
      timeout: 90000
    }
  );

  return response.data;
}

async function reiniciarRoteadorRemoto(ip) {
  const response = await axios.post(
    `${NAVIGATOR_API_URL}/reiniciar-roteador`,
    { ip },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NAVIGATOR_API_TOKEN}`,
        "ngrok-skip-browser-warning": "1"
      },
      timeout: 90000
    }
  );

  return response.data;
}

async function otimizarCanalRemoto(ip) {
  const response = await axios.post(
    `${NAVIGATOR_API_URL}/otimizar-canal`,
    { ip },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NAVIGATOR_API_TOKEN}`,
        "ngrok-skip-browser-warning": "1"
      },
      timeout: 90000
    }
  );

  return response.data;
}

async function enviarPdfBoleto(numero, base64Pdf, nomeArquivo = "boleto.pdf") {
  const base64Limpo = String(base64Pdf || "").replace(/^data:application\/pdf;base64,/, "");

  const resposta = await axios.post(
    `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
    {
      number: numero,
      mediatype: "document",
      mimetype: "application/pdf",
      caption: "📄 Segue seu boleto em PDF.",
      fileName: nomeArquivo,
      media: base64Limpo
    },
    {
      headers: {
        apikey: EVOLUTION_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );

  registrarMensagemDoBot(resposta?.data);
}

async function consultarCpf(cpf) {
  const response = await axios.get(`${STATUS_CPF_URL}?cpf=${cpf}`);
  return response.data;
}

async function buscarAtendimentoOPA(atendimentoId) {
  if (!OPA_BASE_URL || !OPA_TOKEN) {
    throw new Error("OPA_BASE_URL ou OPA_TOKEN não configurado no Railway");
  }

  const response = await axios.get(
    `${OPA_BASE_URL}/api/v1/atendimento/${atendimentoId}`,
    {
      headers: {
        Authorization: `Bearer ${OPA_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data?.data || response.data;
}

function estaNoPlantao() {
  const agora = new Date();

  const portoVelho = new Date(
    agora.toLocaleString("en-US", {
      timeZone: "America/Porto_Velho"
    })
  );

  const dia = portoVelho.getDay();
  const hora = portoVelho.getHours();
  const minuto = portoVelho.getMinutes();

  if (
    dia === 6 &&
    (hora > 12 || (hora === 12 && minuto >= 00))
  ) {
    return true;
  }

  if (
    dia === 0 &&
    (
      hora < 9 ||
      (hora === 9 && minuto <= 0)
    )
  ) {
    return true;
  }

  return false;
}

function getAuthIXC() {
  return Buffer.from(`${IXC_USER}:${IXC_PASS}`).toString("base64");
}

async function consultarBoletosPorCliente(idCliente) {
  const auth = getAuthIXC();

  const params = {
    qtype: "fn_areceber.id_cliente",
    query: String(idCliente),
    oper: "=",
    page: "1",
    rp: "20",
    sortname: "fn_areceber.data_vencimento",
    sortorder: "asc",
    grid_param: JSON.stringify([
      { TB: "fn_areceber.liberado", OP: "=", P: "S" },
      { TB: "fn_areceber.status", OP: "!=", P: "C" },
      { TB: "fn_areceber.status", OP: "!=", P: "R" }
    ])
  };

  const response = await axios.post(
    `${IXC_URL}/fn_areceber`,
    params,
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ixcsoft: "listar"
      }
    }
  );

  return response.data;
}

function escolherBoleto(registros) {
  const boletos = Array.isArray(registros) ? registros : [];

  if (!boletos.length) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const ordenados = boletos
    .filter(b => b.status !== "C" && b.status !== "R")
    .sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));

  const vencido = ordenados.find(b => {
    const venc = new Date(`${b.data_vencimento}T00:00:00`);
    return venc < hoje;
  });

  return vencido || ordenados[0] || null;
}

async function consultarDadosBoleto(idBoleto) {
  const auth = getAuthIXC();

  const params = {
    boletos: String(idBoleto),
    juro: "N",
    multa: "N",
    atualiza_boleto: "N",
    tipo_boleto: "arquivo",
    base64: "S"
  };

  const response = await axios.post(
    `${IXC_URL}/get_boleto`,
    params,
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ixcsoft: "listar"
      }
    }
  );

  return response.data;
}

async function consultarPix(idAReceber) {
  const auth = getAuthIXC();

  const response = await axios.post(
    `${IXC_URL}/get_pix`,
    {
      id_areceber: String(idAReceber)
    },
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ixcsoft: "listar"
      }
    }
  );

  return response.data;
}

async function enviarImagemBase64(numero, base64, nomeArquivo, legenda = "") {
  try {
    const resposta = await axios.post(
      `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
      {
        number: numero,
        mediatype: "image",
        mimetype: "image/png",
        fileName: nomeArquivo,
        media: base64,
        caption: legenda
      },
      {
        headers: {
          apikey: EVOLUTION_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    registrarMensagemDoBot(resposta?.data);
  } catch (erro) {
    console.error("Erro ao enviar QR Code:", erro.response?.data || erro.message);
  }
}

async function enviarBoletoOuPix(numero, sessao) {
  const idCliente = sessao?.cliente?.id;

  if (!idCliente) {
    await enviarMensagem(
      numero,
      "Não consegui identificar o cliente para localizar a fatura."
    );
    return;
  }

  await enviarMensagem(numero, "🔎 Gerando fatura...");

  const dados = await consultarBoletosPorCliente(idCliente);

  const boleto = escolherBoleto(dados.registros || []);

  if (!boleto) {
    await enviarMensagem(
      numero,
      "Não encontrei boletos em aberto para este contrato."
    );
    return;
  }

  console.log("===== BOLETO ESCOLHIDO =====");
  console.log(JSON.stringify(boleto, null, 2));
  console.log("===== FIM BOLETO ESCOLHIDO =====");

  const valor = String(boleto.valor_aberto || boleto.valor || "0.00").replace(".", ",");
  const vencimento = boleto.data_vencimento || "não informado";
  const linhaDigitavel = String(boleto.linha_digitavel || "").replace(/\D/g, "");

  const pdfBoleto = await consultarDadosBoleto(boleto.id);
  const pix = await consultarPix(boleto.id);

console.log("===== PIX =====");
console.log(JSON.stringify(pix, null, 2));
console.log("===== FIM PIX =====");

  await enviarPdfBoleto(numero, pdfBoleto, `boleto-${boleto.id}.pdf`);

  if (linhaDigitavel) {
    await enviarMensagem(
  numero,
  `💳 Fatura encontrada

📅 Vencimento: ${vencimento}
💰 Valor: R$ ${valor}

📄Linha digitável.`
);

await enviarMensagem(numero, linhaDigitavel);

if (pix?.type === "success") {

  const copiaCola = pix.pix?.qrCode?.qrcode;
  const qrBase64 = pix.pix?.qrCode?.imagemQrcode;

  if (copiaCola) {
    await enviarMensagem(numero, "💠 Pix Copia e Cola 👇🏻");
    await enviarMensagem(numero, copiaCola);
  }

  if (qrBase64) {
    await enviarImagemBase64(
      numero,
      qrBase64,
      "qrcode.png",
      "📲 QR Code PIX"
    );
  }
}

return;
}

}

// ===================== NOVO: comando manual /boleto =====================
// Usa o CPF passado junto no comando (/boleto 12345678900) ou, se não vier
// nenhum, usa o último CPF que o próprio cliente digitou naquele chat.
async function processarComandoBoleto(numero, cpfLimpo) {
  try {
    const dadosCpf = await consultarCpf(cpfLimpo);

    if (dadosCpf.erro || dadosCpf.aviso || !dadosCpf.cliente) {
      await enviarMensagem(numero, `⚠️ Não localizei cadastro para o CPF ${cpfLimpo}.`);
      return;
    }

    await enviarBoletoOuPix(numero, { cliente: dadosCpf.cliente });

    cpfsCapturados.delete(numero);
  } catch (erro) {
    console.error("Erro ao processar comando /boleto:", erro.response?.data || erro.message);
    await enviarMensagem(numero, "⚠️ Não consegui localizar/enviar o boleto agora.");
  }
}
// ==========================================================================

function mensagemBoasVindas() {
  return `👋 Olá! Seja bem-vindo ao atendimento de plantão da ATOS TELECOM.

Durante o plantão, os atendimentos presenciais são priorizados para clientes com o acesso desconectado.

Para agilizar seu atendimento, informe o CPF do titular.`;
}

function mensagemAudioInicial() {
  return `🎤 No momento, ainda não consigo compreender mensagens de áudio.

Para agilizar seu atendimento, informe o CPF do titular.`;
}

function mensagemFinanceiro() {
  return `💳 Entendido!

Durante o plantão, o setor financeiro não realiza atendimento, mas você pode emitir a segunda via e realizar o pagamento agora mesmo.

Acesse:
https://cliente.atostelecom.com.br/central_assinante_web/login

Login: CPF do titular
Senha: 1020 ou os 6 primeiros dígitos do CPF.

Caso não consiga acessar, nossa equipe retornará no próximo dia útil.`;
}

function montarRespostaConectado(cliente, pppoe) {
  const tempo = formatarTempo(pppoe.tempo_conectado || pppoe.tempoConectado);
  const ip = pppoe.ip || "não informado";
  const conectouEm = pppoe.ultima_conexao_inicial || "não informado";
  const endereco = montarEndereco(cliente, pppoe);

  return `🟢 Olá, ${cliente.nome}!

Identificamos seu cadastro e seu acesso está CONECTADO.

📍 Endereço:
${endereco}

⏱️ Tempo conectado: ${tempo}
🕒 Conectou em: ${conectouEm}
🌐 IP: ${ip}

Como posso ajudar?

1️⃣ Boleto para pagamento
2️⃣ Lentidão ou oscilação
3️⃣ Trocar senha do Wi-Fi
4️⃣ Aparelhos conectados
5️⃣ Outro assunto`;
}

function mensagemOrientacaoConectado(cliente, pppoe) {
  const tempo = formatarTempo(pppoe.tempo_conectado || pppoe.tempoConectado);
  const ip = pppoe.ip || "não informado";
  const conectouEm = pppoe.ultima_conexao_inicial || "não informado";
  const endereco = montarEndereco(cliente, pppoe);

  return `🟢 ${cliente.nome}, seu acesso está CONECTADO.

📍 Endereço:
${endereco}

⏱️ Tempo conectado: ${tempo}
🕒 Conectou em: ${conectouEm}
🌐 IP: ${ip}

Como seu acesso aparece conectado no sistema, siga estes testes:

1️⃣ Desligue o roteador da tomada.
2️⃣ Aguarde 3 minutos.
3️⃣ Ligue novamente e teste a internet.
4️⃣ Se possível, conecte na rede 5G do Wi-Fi.
5️⃣ Faça o teste de velocidade:
https://www.speedtest.net/pt

Caso a velocidade esteja de acordo com seu plano, pode ser instabilidade temporária em sites, aplicativos ou serviços externos.

Se o problema persistir, um atendente entrará em contato no próximo dia útil.`;
}

function montarOS(sessao, numeroCliente) {
  const cliente = sessao.cliente || {};
  const pppoe = sessao.pppoe || {};
  const protocolo = gerarProtocolo();
  const endereco = sessao.enderecoFinal || montarEndereco(cliente, pppoe);

  return {
    protocolo,
    mensagem: `🚨 NOVA O.S - ATOS TELECOM

📌 Protocolo: ${protocolo}

👤 Cliente: ${cliente.nome || "não informado"}
📞 WhatsApp: ${numeroCliente}
🆔 ID Cliente: ${cliente.id || pppoe.id_cliente || "não informado"}
🔐 Login PPPoE: ${pppoe.login || "não informado"}
📄 Contrato: ${pppoe.id_contrato || "não informado"}

📍 Endereço:
${endereco}

🔴 Status: DESCONECTADO
🕒 Desconectou em: ${pppoe.ultima_conexao_final || pppoe.ultima_atualizacao || "não informado"}
🌐 Último IP: ${pppoe.ip || "não informado"}
📡 Concentrador: ${pppoe.concentrador || "não informado"}

📝 Relato do cliente:
"${sessao.relatoCliente || "não informado"}"

⚠️ Ao finalizar o atendimento, coloque o nome do cliente na lista de serviços do grupo com ✅.`
  };
}

async function finalizarAtendimento(numero, sessao) {
  const os = montarOS(sessao, numero);

  if (TECNICO_NUMERO) {
    await enviarMensagem(TECNICO_NUMERO, os.mensagem);
  }

  await enviarMensagem(numero, `✅ ATENDIMENTO ABERTO

📌 Protocolo: ${os.protocolo}

Recebemos sua solicitação e ela já foi encaminhada ao técnico de plantão.

Em instantes, ele entrará em contato e seguirá para o atendimento em sua residência.

Agradecemos pela compreensão e pedimos que aguarde.`);

  sessoes.set(numero, { etapa: "encerramento" });
  iniciarEncerramento(numero);
}

async function finalizarAtendimentoAudio(numero, sessao) {
  sessao.relatoCliente =
    "Cliente enviou áudio. Problema não foi relatado por texto. Entrar em contato por ligação ou WhatsApp para obter mais informações.";

  sessao.enderecoFinal = montarEndereco(sessao.cliente, sessao.pppoe);

  await finalizarAtendimento(numero, sessao);
}

async function iniciarRelatoDesconectado(numero, cliente, pppoe) {
  sessoes.set(numero, {
    etapa: "relato_cliente",
    cliente,
    pppoe
  });

  const desconectouEm =
    pppoe.ultima_conexao_final ||
    pppoe.ultima_atualizacao ||
    "não informado";

  await enviarMensagem(numero, `🔴 Olá, ${cliente.nome}!

Localizamos seu cadastro e verificamos que seu acesso está DESCONECTADO.

🕒 Desconectou em:
${desconectouEm}

Para agilizar o atendimento técnico, descreva rapidamente o que você percebe no equipamento.

Ex.: luz vermelha, roteador não liga ou Wi-Fi não aparece.`);
}

async function processarCpf(numero, cpf) {
  await enviarMensagem(numero, "🔎 Aguarde enquanto verifico sua conexão...");

  const dados = await consultarCpf(cpf);

  if (dados.erro || dados.aviso || !dados.cliente) {
    await enviarMensagem(numero, `❌ Não consegui localizar esse CPF.

Confira se digitou corretamente e envie novamente apenas o CPF do titular.`);
    return;
  }

  const cliente = dados.cliente;
  const pppoes = Array.isArray(dados.pppoes)
    ? dados.pppoes
    : dados.pppoe
      ? [dados.pppoe]
      : [];

  if (!pppoes.length) {
    await enviarMensagem(numero, `⚠️ ${cliente.nome}, encontrei seu cadastro, mas não localizei acesso PPPoE.

Um atendente entrará em contato assim que possível.`);

    sessoes.set(numero, { etapa: "encerramento" });
    iniciarEncerramento(numero);
    return;
  }

  const ativos = pppoes.filter(p => p.ativo === "S");
  const acessos = ativos.length ? ativos : pppoes;

  const desconectados = acessos.filter(p => p.online !== "S");
  const conectados = acessos.filter(p => p.online === "S");

  if (desconectados.length === 1) {
    await iniciarRelatoDesconectado(numero, cliente, desconectados[0]);
    return;
  }

  if (desconectados.length > 1) {
    sessoes.set(numero, {
      etapa: "selecionar_acesso_desconectado",
      cliente,
      opcoes: desconectados
    });

    const lista = desconectados
      .map((p, i) => listarAcesso(cliente, p, i))
      .join("\n\n");

    await enviarMensagem(numero, `🔴 ${cliente.nome}, encontramos ${desconectados.length} acessos DESCONECTADOS no seu CPF.

Escolha qual acesso está com problema:

${lista}

Responda apenas com o número do acesso.`);
    return;
  }

  const pppoeConectado = conectados[0] || acessos[0];

  sessoes.set(numero, {
    etapa: "cliente_conectado",
    cliente,
    pppoe: pppoeConectado
  });

  await enviarMensagem(numero, montarRespostaConectado(cliente, pppoeConectado));
}

async function finalizarAtendimentoOPA(atendimento, dadosCpf) {
  const cliente = dadosCpf.cliente || {};

  const pppoes = Array.isArray(dadosCpf.pppoes)
    ? dadosCpf.pppoes
    : dadosCpf.pppoe
      ? [dadosCpf.pppoe]
      : [];

  const pppoe = pppoes.find(p => p.online !== "S") || pppoes[0] || {};

  const numeroCliente = String(atendimento.canal_cliente || "")
    .replace("@c.us", "")
    .replace(/\D/g, "");

  const protocolo = atendimento.protocolo || gerarProtocolo();
  const endereco = montarEndereco(cliente, pppoe);

  const mensagemTecnico = `🚨 NOVA O.S - PLANTÃO OPA

📌 Protocolo OPA: ${protocolo}

👤 Cliente: ${cliente.nome || atendimento.id_cliente?.nome || "não informado"}
📞 WhatsApp: ${numeroCliente || "não informado"}
🆔 ID Cliente: ${cliente.id || atendimento.id_cliente?._id || "não informado"}
🔐 Login PPPoE: ${pppoe.login || "não informado"}
📄 Contrato: ${pppoe.id_contrato || "não informado"}

📍 Endereço:
${endereco}

🔴 Status: DESCONECTADO
🕒 Desconectou em: ${pppoe.ultima_conexao_final || pppoe.ultima_atualizacao || "não informado"}
🌐 Último IP: ${pppoe.ip || "não informado"}
📡 Concentrador: ${pppoe.concentrador || "não informado"}

⚠️ IMPORTANTE🚨

Entre em contato com o cliente antes de sair para confirmar o endereço do atendimento, pois ele possui mais de um contrato cadastrado.

⚠️ Ao finalizar o atendimento, coloque o nome do cliente na lista de serviços do grupo com ✅.`;

  if (TECNICO_NUMERO) {
    await enviarMensagem(TECNICO_NUMERO, mensagemTecnico);
  }

  console.log("✅ O.S do OPA enviada ao técnico");
}

app.get("/opa/webhook", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Webhook OPA funcionando"
  });
});

app.post("/opa/webhook", async (req, res) => {
  res.status(200).json({ success: true });

  try {
    const evento = req.body?.event;

    if (!evento || evento.type !== "customerServiceEvent") return;

    const action = evento.data?.action;
    const payload = evento.data?.payload;

    const TAG_SEM_CONEXAO = "62878ee28d8911cd3916e8d4";

    const tags = Array.isArray(payload?.tags)
      ? payload.tags.filter(Boolean)
      : [];

    console.log("====================================");
    console.log("Webhook OPA recebido");
    console.log("Ação:", action);
    console.log("Tags:", tags);

    if (action !== "transferToDepartment") {
      console.log("Ignorado: não é transferência.");
      return;
    }

    if (!tags.includes(TAG_SEM_CONEXAO)) {
      console.log("Ignorado: não é Sem conexão.");
      return;
    }

    if (!estaNoPlantao()) {
      console.log("Fora do horário do plantão. OPA continuará o fluxo normal.");
      return;
    }

    if (!payload?._id) {
      console.log("Evento sem ID de atendimento.");
      return;
    }

    const atendimento = await buscarAtendimentoOPA(payload._id);
    const cpf = atendimento.id_cliente?.cpf_cnpj;

    if (!cpf) {
      console.log("Atendimento sem CPF.");
      return;
    }

    console.log("✅ Sem conexão confirmado no OPA");
    console.log("Cliente:", atendimento.id_cliente?.nome);
    console.log("CPF:", cpf);
    console.log("Protocolo:", atendimento.protocolo);

    const dadosCpf = await consultarCpf(cpf);

    if (dadosCpf.erro || dadosCpf.aviso || !dadosCpf.cliente) {
      console.log("Não localizou dados pelo CPF:");
      console.log(JSON.stringify(dadosCpf, null, 2));
      return;
    }

    await finalizarAtendimentoOPA(atendimento, dadosCpf);
  } catch (error) {
    console.error("Erro no webhook OPA:");
    console.error(error.response?.data || error.message);
  }
});

app.get("/", (req, res) => {
  res.send("Bot Atos WhatsApp online ✅");
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const data = body.data || body;
    const key = data.key || {};
    const message = data.message || {};

    if (key.remoteJid?.endsWith("@g.us")) {
      return res.sendStatus(200);
    }

    const numero = key.remoteJid?.replace("@s.whatsapp.net", "");

    if (!numero) return res.sendStatus(200);

    const texto =
      message.conversation ||
      message.extendedTextMessage?.text ||
      data.text ||
      "";

    // ===================================================================
    // fromMe: mensagens enviadas pelo número/instância do WhatsApp — tanto
    // as que o PRÓPRIO BOT manda (eco do webhook) quanto as que VOCÊ manda
    // manualmente pelo celular/WhatsApp Web.
    // ===================================================================
    if (key.fromMe) {
      const idMensagem = key.id;

      // Se esse ID é de uma mensagem que o bot mesmo enviou, é só o eco do
      // webhook — não significa que você assumiu a conversa. Ignora.
      if (idMensagem && idsMensagensBot.has(idMensagem)) {
        idsMensagensBot.delete(idMensagem);
        return res.sendStatus(200);
      }

      // =================================================================
// NOVO: boleto pelo CPF com # enviado pelo atendente
// Exemplo:
// CPF
// #02924314224
// =================================================================

const cpfComHash = extrairCpfComHash(texto);

if (cpfComHash) {
  console.log("CPF encontrado pelo comando com #:", cpfComHash);

  await processarComandoBoleto(numero, cpfComHash);

  return res.sendStatus(200);
}
      // =================================================================
      // Comando manual do administrador. Funciona a QUALQUER hora,
      // independente do plantão, porque é tratado antes do bloqueio
      // abaixo. Digite na própria conversa do cliente:
      //   /boleto            -> usa o último CPF que o cliente mandou
      //   /boleto 12345678900 -> usa o CPF informado no próprio comando
      // =================================================================
      const comandoTexto = String(texto || "").trim();
      const matchComando = comandoTexto.match(/^\/boleto(?:\s+([\d.\-]+))?$/i);

      if (matchComando) {
        const cpfDoArgumento = matchComando[1] ? limparCpf(matchComando[1]) : null;
        const cpfValido = cpfDoArgumento && cpfDoArgumento.length === 11
          ? cpfDoArgumento
          : cpfsCapturados.get(numero);

        if (!cpfValido) {
          await enviarMensagem(numero, `⚠️ Não tenho nenhum CPF salvo para este número ainda.

Use: /boleto 12345678900`);
          return res.sendStatus(200);
        }

        await processarComandoBoleto(numero, cpfValido);
        return res.sendStatus(200);
      }

      // =================================================================
      // NOVO: qualquer outra mensagem "fromMe" que não seja eco do bot nem
      // o comando /boleto é você digitando manualmente pro cliente. Isso
      // significa que você assumiu o atendimento — o bot para de
      // responder nesse número até 10 minutos sem mensagens de nenhum dos
      // dois lados. Os outros chats continuam normais.
      // =================================================================
      pausarAtendimentoHumano(numero);
      console.log(`Atendente assumiu manualmente a conversa com ${numero}. Bot pausado por 10 minutos de inatividade.`);

      return res.sendStatus(200);
    }

    // ===================================================================
    // Comando manual do PRÓPRIO CLIENTE. Funciona a QUALQUER hora, igual
    // ao comando do admin acima, sem depender do horário de plantão.
    // O cliente pode digitar na conversa:
    //   /boleto 12345678900  -> usa o CPF informado no próprio comando
    //   /boleto              -> usa o último CPF que ele mesmo já enviou
    // ===================================================================
    {
      const comandoClienteTexto = String(texto || "").trim();
      const matchComandoCliente = comandoClienteTexto.match(/^\/boleto(?:\s+([\d.\-]+))?$/i);

      if (matchComandoCliente) {
        const cpfDoArgumentoCliente = matchComandoCliente[1] ? limparCpf(matchComandoCliente[1]) : null;
        const cpfValidoCliente = cpfDoArgumentoCliente && cpfDoArgumentoCliente.length === 11
          ? cpfDoArgumentoCliente
          : cpfsCapturados.get(numero);

        if (!cpfValidoCliente) {
          await enviarMensagem(numero, `⚠️ Não localizei nenhum CPF salvo para este número ainda.

Envie: /boleto 12345678900`);
          return res.sendStatus(200);
        }

        await processarComandoBoleto(numero, cpfValidoCliente);
        return res.sendStatus(200);
      }
    }

    // Captura passiva: se o cliente digitar um CPF em qualquer momento,
    // guardamos para o comando /boleto poder usar depois.
    if (pareceCpf(texto)) {
      cpfsCapturados.set(numero, limparCpf(texto));
    }

    // ===================================================================
    // NOVO: se você assumiu esse chat manualmente, o bot fica em silêncio
    // aqui. A cada mensagem do cliente enquanto pausado, apenas renovamos
    // os 10 minutos (sem responder nada), até que se passem 10 minutos
    // sem mensagens de nenhum dos dois lados — aí o bot volta a responder
    // normalmente, do zero.
    // ===================================================================
    if (estaPausadoPorHumano(numero)) {
      pausarAtendimentoHumano(numero);
      return res.sendStatus(200);
    }

    // ===================================================================
    // A partir daqui segue o fluxo ORIGINAL, que só funciona no plantão.
    // ===================================================================
    if (!estaNoPlantao()) {
      console.log("Fora do horário do plantão. Webhook WhatsApp ignorado.");
      return res.sendStatus(200);
    }

    const message2 = message; // mantém compatibilidade com o restante do código abaixo

    const audio = ehAudio(message, data);

    console.log("Mensagem recebida:", numero, texto || "[sem texto]", audio ? "[áudio]" : "");

    const sessao = sessoes.get(numero);

      if (sessao && contemDespedida(texto)) {
      await responderDespedida(numero);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "encerramento") {
      cancelarEncerramento(numero);

      await enviarMensagem(numero, `Entendido.

Caso precise de qualquer outra informação, estaremos à disposição. 💙`);

      sessoes.delete(numero);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "aguardando_cpf") {
      if (audio) {
        await enviarMensagem(numero, mensagemAudioInicial());
        return res.sendStatus(200);
      }

      if (!pareceCpf(texto)) {
        await enviarMensagem(numero, `CPF inválido.

Envie somente o CPF do titular.

Exemplo:
123.456.789-00`);
        return res.sendStatus(200);
      }

      await processarCpf(numero, limparCpf(texto));
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "confirmar_troca_senha_wifi_5g") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Responda apenas:

1️⃣ Sim
2️⃣ Não`);
        return res.sendStatus(200);
      }

      if (respostaNao(texto)) {
        await enviarMensagem(numero, "Tudo bem. A senha do Wi-Fi não será alterada.");

        sessoes.set(numero, { etapa: "encerramento" });
        iniciarEncerramento(numero);
        return res.sendStatus(200);
      }

      if (respostaSim(texto)) {
        sessao.etapa = "aguardando_senha_wifi_5g";
        sessoes.set(numero, sessao);

        await enviarMensagem(numero, `🔐 Envie agora a nova senha da rede *5G*.

⚠️ ATENÇÃO:
A senha ficará exatamente como você enviar aqui.

Ela deve ter no mínimo 8 caracteres.`);
        return res.sendStatus(200);
      }

      await enviarMensagem(numero, `Não entendi.

Deseja continuar com a alteração da senha do Wi-Fi?

1️⃣ Sim
2️⃣ Não`);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "aguardando_senha_wifi_5g") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Envie a nova senha da rede 5G por texto.`);
        return res.sendStatus(200);
      }

      const novaSenha = String(texto || "").trim();

      if (novaSenha.length < 8) {
        await enviarMensagem(numero, `⚠️ A senha deve ter no mínimo 8 caracteres.

Envie novamente a nova senha da rede 5G.`);
        return res.sendStatus(200);
      }

      sessao.novaSenha5g = novaSenha;
      sessao.etapa = "confirmar_senha_wifi_5g";
      sessoes.set(numero, sessao);

      await enviarMensagem(numero, `⚠️ CONFIRMAÇÃO

A senha da rede *5G* será alterada para:

${novaSenha}

Confirma a alteração?

1️⃣ Sim
2️⃣ Não`);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "confirmar_senha_wifi_5g") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Responda apenas:

1️⃣ Sim
2️⃣ Não`);
        return res.sendStatus(200);
      }

      if (respostaNao(texto)) {
        sessao.etapa = "aguardando_senha_wifi_5g";
        sessoes.set(numero, sessao);

        await enviarMensagem(numero, `Tudo bem.

Envie novamente a senha desejada para a rede *5G*.`);
        return res.sendStatus(200);
      }

      if (!respostaSim(texto)) {
        await enviarMensagem(numero, `Não entendi.

Confirma a alteração da senha da rede 5G?

1️⃣ Sim
2️⃣ Não`);
        return res.sendStatus(200);
      }

      const ipCliente = sessao.pppoe?.ip;

      if (!ipCliente || ipCliente === "não informado") {
        await enviarMensagem(numero, `⚠️ Não consegui identificar o IP do roteador para alterar a senha automaticamente.

Um atendente dará continuidade.`);
        sessoes.set(numero, { etapa: "encerramento" });
        iniciarEncerramento(numero);
        return res.sendStatus(200);
      }

      await enviarMensagem(numero, "🔄 Alterando a senha da rede 5G. Aguarde alguns segundos...");

      try {
        const resultado = await trocarSenhaWifiRemoto(ipCliente, "5g", sessao.novaSenha5g);

        if (!resultado?.sucesso) {
          throw new Error(resultado?.mensagem || "Não confirmou sucesso na troca da senha 5G");
        }

        sessao.etapa = "perguntar_alterar_senha_24g";
        sessoes.set(numero, sessao);

        await enviarMensagem(numero, `✅ Senha da rede *5G* alterada com sucesso!

⚠️ Os aparelhos conectados na rede 5G podem desconectar.

Deseja alterar também a senha da rede *2.4G*?

1️⃣ Sim
2️⃣ Não`);
        return res.sendStatus(200);

      } catch (erro) {
        console.error("Erro ao trocar senha 5G:", erro.message);

        await enviarMensagem(numero, `⚠️ Não consegui alterar a senha da rede 5G automaticamente agora.

Um atendente dará continuidade.`);

        sessoes.set(numero, { etapa: "encerramento" });
        iniciarEncerramento(numero);
        return res.sendStatus(200);
      }
    }

    if (sessao?.etapa === "perguntar_alterar_senha_24g") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Responda apenas:

1️⃣ Sim
2️⃣ Não`);
        return res.sendStatus(200);
      }

      if (respostaNao(texto)) {
        await enviarMensagem(numero, `✅ Alteração concluída.

A senha da rede 5G já está ativa.

Caso algum aparelho desconecte, conecte novamente usando a nova senha.`);

        sessoes.set(numero, { etapa: "encerramento" });
        iniciarEncerramento(numero);
        return res.sendStatus(200);
      }

      if (respostaSim(texto)) {
        sessao.etapa = "aguardando_senha_wifi_24g";
        sessoes.set(numero, sessao);

        await enviarMensagem(numero, `🔐 Envie agora a nova senha da rede *2.4G*.

⚠️ ATENÇÃO:
A senha ficará exatamente como você enviar aqui.

Ela deve ter no mínimo 8 caracteres.`);
        return res.sendStatus(200);
      }

      await enviarMensagem(numero, `Não entendi.

Deseja alterar também a senha da rede 2.4G?

1️⃣ Sim
2️⃣ Não`);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "aguardando_senha_wifi_24g") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Envie a nova senha da rede 2.4G por texto.`);
        return res.sendStatus(200);
      }

      const novaSenha = String(texto || "").trim();

      if (novaSenha.length < 8) {
        await enviarMensagem(numero, `⚠️ A senha deve ter no mínimo 8 caracteres.

Envie novamente a nova senha da rede 2.4G.`);
        return res.sendStatus(200);
      }

      sessao.novaSenha24g = novaSenha;
      sessao.etapa = "confirmar_senha_wifi_24g";
      sessoes.set(numero, sessao);

      await enviarMensagem(numero, `⚠️ CONFIRMAÇÃO

A senha da rede *2.4G* será alterada para:

${novaSenha}

Confirma a alteração?

1️⃣ Sim
2️⃣ Não`);
      return res.sendStatus(200);
    }

      if (sessao?.etapa === "confirmar_senha_wifi_24g") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Responda apenas:

1️⃣ Sim
2️⃣ Não`);
        return res.sendStatus(200);
      }

      if (respostaNao(texto)) {
        sessao.etapa = "aguardando_senha_wifi_24g";
        sessoes.set(numero, sessao);

        await enviarMensagem(numero, `Tudo bem.

Envie novamente a senha desejada para a rede *2.4G*.`);
        return res.sendStatus(200);
      }

      if (!respostaSim(texto)) {
        await enviarMensagem(numero, `Não entendi.

Confirma a alteração da senha da rede 2.4G?

1️⃣ Sim
2️⃣ Não`);
        return res.sendStatus(200);
      }

      const ipCliente = sessao.pppoe?.ip;

      await enviarMensagem(numero, "🔄 Alterando a senha da rede 2.4G. Aguarde alguns segundos...");

      try {
        const resultado = await trocarSenhaWifiRemoto(ipCliente, "24g", sessao.novaSenha24g);

        if (!resultado?.sucesso) {
          throw new Error(resultado?.mensagem || "Não confirmou sucesso na troca da senha 2.4G");
        }

        await enviarMensagem(numero, `✅ Senha da rede *2.4G* alterada com sucesso!

✅ Alteração concluída.

Caso algum aparelho desconecte, conecte novamente usando a nova senha.`);

      } catch (erro) {
        console.error("Erro ao trocar senha 2.4G:", erro.message);

        await enviarMensagem(numero, `⚠️ Não consegui alterar a senha da rede 2.4G automaticamente agora.

Um atendente dará continuidade.`);
      }

      sessoes.set(numero, { etapa: "encerramento" });
      iniciarEncerramento(numero);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "cliente_conectado") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Em breve, um atendente entrará em contato para ajudá-lo.

Agradecemos pela compreensão.`);

        sessoes.set(numero, { etapa: "encerramento" });
        iniciarEncerramento(numero);
        return res.sendStatus(200);
      }

      if (contemFinanceiro(texto) || String(texto || "").trim() === "1") {
        await enviarBoletoOuPix(numero, sessao);
        return res.sendStatus(200);
      }

            if (contemTrocarSenhaWifi(texto) || String(texto || "").trim() === "3") {
        sessoes.set(numero, {
          etapa: "confirmar_troca_senha_wifi_5g",
          cliente: sessao.cliente,
          pppoe: sessao.pppoe
        });

        await enviarMensagem(numero, `⚠️ ATENÇÃO

A senha será alterada exatamente como você enviar aqui.

• Será alterada primeiro a rede 5G.
• A senha deve ter no mínimo 8 caracteres.
• Os aparelhos conectados podem desconectar e precisarão entrar novamente com a nova senha.

Deseja continuar?

1️⃣ Sim
2️⃣ Não`);

        return res.sendStatus(200);
      }

            if (String(texto || "").trim() === "4") {
        const ipCliente = sessao.pppoe?.ip;

        if (!ipCliente || ipCliente === "não informado") {
          await enviarMensagem(numero, "⚠️ Não consegui identificar o IP do roteador para consultar os aparelhos conectados.");
          return res.sendStatus(200);
        }

        await enviarMensagem(numero, "🔎 Consultando aparelhos conectados ao Wi-Fi...");

        try {
          const dados = await consultarDiagnosticoRemoto(ipCliente);
          const mensagemAparelhos = montarMensagemAparelhosConectados(dados);

          await enviarMensagem(numero, mensagemAparelhos);

          sessoes.set(numero, {
            etapa: "pos_aparelhos_conectados",
            cliente: sessao.cliente,
            pppoe: sessao.pppoe,
            diagnostico: dados
          });
        } catch (erro) {
          console.error("Erro ao consultar aparelhos:", erro.message);
          await enviarMensagem(numero, "⚠️ Não consegui consultar os aparelhos conectados agora.");
        }

        return res.sendStatus(200);
      }

      if (contemLentidao(texto) || String(texto || "").trim() === "2") {
        const ipCliente = sessao.pppoe?.ip;

        if (!ipCliente || ipCliente === "não informado") {
          await enviarMensagem(
            numero,
            mensagemOrientacaoConectado(sessao.cliente, sessao.pppoe)
          );

          sessoes.set(numero, { etapa: "encerramento" });
          iniciarEncerramento(numero);
          return res.sendStatus(200);
        }

        await enviarMensagem(numero, "🔎 Aguarde, estou verificando seu roteador remotamente...");

        try {
          const dados = await consultarDiagnosticoRemoto(ipCliente);
          const mensagemDiagnostico = montarMensagemDiagnostico(dados);

          await enviarMensagem(numero, `${mensagemDiagnostico}

O que deseja fazer agora?

1️⃣ Otimizar canal do Wi-Fi
2️⃣ Reiniciar roteador
3️⃣ Trocar senha do Wi-Fi
4️⃣ Ver aparelhos conectados
5️⃣ Encerrar`);

          sessoes.set(numero, {
            etapa: "pos_diagnostico_lentidao",
            cliente: sessao.cliente,
            pppoe: sessao.pppoe,
            diagnostico: dados
          });

        } catch (erro) {
          console.error("Erro no diagnóstico:", erro.message);

          await enviarMensagem(
            numero,
            "⚠️ Não consegui acessar seu roteador automaticamente agora.\n\n" +
            mensagemOrientacaoConectado(sessao.cliente, sessao.pppoe)
          );

          sessoes.set(numero, { etapa: "encerramento" });
          iniciarEncerramento(numero);
        }

        return res.sendStatus(200);
      }

      if (String(texto || "").trim() === "5") {
  await enviarMensagem(numero, `Entendido.

Um atendente entrará em contato assim que possível ou no próximo dia útil para dar continuidade ao atendimento.`);

  sessoes.set(numero, { etapa: "encerramento" });
  iniciarEncerramento(numero);
  return res.sendStatus(200);
}

      sessoes.set(numero, { etapa: "encerramento" });
      iniciarEncerramento(numero);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "pos_diagnostico_lentidao") {
  const opcao = String(texto || "").trim();

  if (opcao === "1") {

  const ipCliente = sessao.pppoe?.ip;

  if (!ipCliente) {
    await enviarMensagem(numero, "⚠️ Não consegui localizar o IP do roteador.");
    return res.sendStatus(200);
  }

  await enviarMensagem(
    numero,
    "📡 Otimizando os canais do Wi-Fi..."
  );

  try {

    const resultado = await otimizarCanalRemoto(ipCliente);

    if (resultado.sucesso) {

      await enviarMensagem(
        numero,
`✅ Canais otimizados com sucesso!

📶 5 GHz
${resultado.canal5gAnterior} ➜ ${resultado.canal5gNovo}

📶 2.4 GHz
${resultado.canal24Anterior} ➜ ${resultado.canal24Novo}

⏳ Aguarde alguns segundos para o Wi-Fi estabilizar.`
      );

    } else {

      await enviarMensagem(numero, resultado.mensagem);

    }

  } catch (erro) {

    console.error(erro);

    await enviarMensagem(
      numero,
      "⚠️ Não foi possível otimizar os canais do Wi-Fi."
    );

  }

  sessoes.set(numero, {
  etapa: "confirmar_reinicio_pos_otimizacao",
  cliente: sessao.cliente,
  pppoe: sessao.pppoe
});

await enviarMensagem(numero, `🔄 Para aplicar completamente a otimização, recomendamos reiniciar o roteador agora.

Deseja reiniciar agora?

1️⃣ Sim
2️⃣ Depois eu reinicio`);

return res.sendStatus(200);
  }

  if (opcao === "2") {
    const ipCliente = sessao.pppoe?.ip;

    if (!ipCliente) {
      await enviarMensagem(numero, "⚠️ Não consegui localizar o IP do roteador.");
      return res.sendStatus(200);
    }

    await enviarMensagem(
      numero,
      "🔄 Reiniciando seu roteador..."
    );

    try {
      const resultado = await reiniciarRoteadorRemoto(ipCliente);

      if (resultado.sucesso) {
        await enviarMensagem(
          numero,
`✅ Roteador reiniciado com sucesso!

Está Reiniciando.

⏳ Aguarde aproximadamente 2 minutos.

Durante esse período a internet ficará indisponível.`
        );
      } else {
        await enviarMensagem(numero, resultado.mensagem);
      }

    } catch (erro) {
      console.error(erro);

      await enviarMensagem(
        numero,
        "⚠️ Não foi possível reiniciar o roteador remotamente."
      );
    }

    sessoes.set(numero, {
      etapa: "encerramento"
    });

    iniciarEncerramento(numero);

    return res.sendStatus(200);
  }

  if (opcao === "3" || contemTrocarSenhaWifi(texto)) {
    sessoes.set(numero, {
      etapa: "confirmar_troca_senha_wifi_5g",
      cliente: sessao.cliente,
      pppoe: sessao.pppoe
    });

    await enviarMensagem(numero, `⚠️ ATENÇÃO

A senha será alterada exatamente como você enviar aqui.

• Será alterada primeiro a rede 5G.
• A senha deve ter no mínimo 8 caracteres.
• Os aparelhos conectados podem desconectar e precisarão entrar novamente com a nova senha.

Deseja continuar?

1️⃣ Sim
2️⃣ Não`);

    return res.sendStatus(200);
  }

  if (opcao === "4") {
    const mensagem = montarMensagemAparelhosConectados(sessao.diagnostico);

    await enviarMensagem(numero, mensagem);

    sessoes.set(numero, {
      etapa: "pos_aparelhos_conectados",
      cliente: sessao.cliente,
      pppoe: sessao.pppoe,
      diagnostico: sessao.diagnostico
    });

    return res.sendStatus(200);
  }

  if (opcao === "5") {
    await enviarMensagem(numero, `✅ Atendimento encerrado.

A ATOS TELECOM agradece o seu contato.

Sempre que precisar, estaremos à disposição. 💙`);

    sessoes.delete(numero);

    return res.sendStatus(200);
}

  await enviarMensagem(numero, `Opção inválida.

Responda apenas:

1️⃣ Otimizar canal do Wi-Fi
2️⃣ Reiniciar roteador
3️⃣ Trocar senha do Wi-Fi
4️⃣ Ver aparelhos conectados
5️⃣ Encerrar`);

  return res.sendStatus(200);
}

        if (sessao?.etapa === "pos_aparelhos_conectados") {
      const opcao = String(texto || "").trim();

      if (opcao === "1") {
        sessoes.set(numero, {
          etapa: "confirmar_troca_senha_wifi_5g",
          cliente: sessao.cliente,
          pppoe: sessao.pppoe
        });

        await enviarMensagem(numero, `⚠️ ATENÇÃO

A senha será alterada exatamente como você enviar aqui.

• Será alterada primeiro a rede 5G.
• A senha deve ter no mínimo 8 caracteres.
• Os aparelhos conectados podem desconectar e precisarão entrar novamente com a nova senha.

Deseja continuar?

1️⃣ Sim
2️⃣ Não`);
        return res.sendStatus(200);
      }

      if (opcao === "2") {

  const ipCliente = sessao.pppoe?.ip;

  if (!ipCliente) {
    await enviarMensagem(numero, "⚠️ Não consegui localizar o IP do roteador.");
    return res.sendStatus(200);
  }

  await enviarMensagem(
    numero,
    "📡 Otimizando os canais do Wi-Fi..."
  );

  try {

    const resultado = await otimizarCanalRemoto(ipCliente);

    if (resultado.sucesso) {

      await enviarMensagem(
        numero,
`✅ Canais otimizados com sucesso!

📶 5 GHz
${resultado.canal5gAnterior} ➜ ${resultado.canal5gNovo}

📶 2.4 GHz
${resultado.canal24Anterior} ➜ ${resultado.canal24Novo}

⏳ Aguarde alguns segundos para o Wi-Fi estabilizar.`
      );

    } else {

      await enviarMensagem(numero, resultado.mensagem);

    }

  } catch (erro) {

    console.error(erro);

    await enviarMensagem(
      numero,
      "⚠️ Não foi possível otimizar os canais do Wi-Fi."
    );

  }

  sessoes.set(numero, {
  etapa: "confirmar_reinicio_pos_otimizacao",
  cliente: sessao.cliente,
  pppoe: sessao.pppoe
});

await enviarMensagem(numero, `🔄 Para aplicar completamente a otimização, recomendamos reiniciar o roteador agora.

Deseja reiniciar agora?

1️⃣ Sim
2️⃣ Depois eu reinicio`);

return res.sendStatus(200);
      }

      if (opcao === "3") {
  const ipCliente = sessao.pppoe?.ip;

  if (!ipCliente) {
    await enviarMensagem(numero, "⚠️ Não consegui localizar o IP do roteador.");
    return res.sendStatus(200);
  }

  await enviarMensagem(
    numero,
    "🔄 Reiniciando seu roteador..."
  );

  try {
    const resultado = await reiniciarRoteadorRemoto(ipCliente);

    if (resultado.sucesso) {
      await enviarMensagem(
        numero,
`✅ Roteador reiniciado com sucesso!

Esta reiniciando.

⏳ Aguarde aproximadamente 2 minutos.

Durante esse período a internet ficará indisponível.`
      );
    } else {
      await enviarMensagem(numero, resultado.mensagem);
    }

  } catch (erro) {
    console.error(erro);

    await enviarMensagem(
      numero,
      "⚠️ Não foi possível reiniciar o roteador remotamente."
    );
  }

  sessoes.set(numero, {
    etapa: "encerramento"
  });

  iniciarEncerramento(numero);

  return res.sendStatus(200);
}

      if (opcao === "4") {
        sessoes.set(numero, {
          etapa: "cliente_conectado",
          cliente: sessao.cliente,
          pppoe: sessao.pppoe
        });

        await enviarMensagem(numero, montarRespostaConectado(sessao.cliente, sessao.pppoe));
        return res.sendStatus(200);
      }

      await enviarMensagem(numero, `Opção inválida.

Responda apenas:

1️⃣ Trocar senha do Wi-Fi
2️⃣ Otimizar canal do Wi-Fi
3️⃣ Reiniciar roteador
4️⃣ Voltar ao menu`);
      return res.sendStatus(200);
    }

          if (sessao?.etapa === "confirmar_reinicio_pos_otimizacao") {

  const opcao = String(texto || "").trim();

  if (opcao === "1") {

    const ipCliente = sessao.pppoe?.ip;

    await enviarMensagem(
      numero,
      "🔄 Reiniciando seu roteador..."
    );

    try {

      const resultado = await reiniciarRoteadorRemoto(ipCliente);

      if (resultado.sucesso) {

        await enviarMensagem(
          numero,
`✅ Roteador reiniciado com sucesso!

⏳ Aguarde aproximadamente 2 minutos.

Durante esse período a internet ficará indisponível.`
        );

      } else {

        await enviarMensagem(numero, resultado.mensagem);

      }

    } catch (erro) {

      console.error(erro);

      await enviarMensagem(
        numero,
        "⚠️ Não foi possível reiniciar o roteador."
      );

    }

    sessoes.set(numero,{
      etapa:"encerramento"
    });

    iniciarEncerramento(numero);

    return res.sendStatus(200);

  }

  if (opcao === "2") {

    await enviarMensagem(
      numero,
`Perfeito.

A otimização já foi aplicada.

Recomendamos reiniciar o roteador mais tarde para garantir o melhor desempenho do Wi-Fi.`
    );

    sessoes.set(numero,{
      etapa:"encerramento"
    });

    iniciarEncerramento(numero);

    return res.sendStatus(200);

  }

  await enviarMensagem(
    numero,
`Escolha uma opção:

1️⃣ Sim
2️⃣ Depois eu reinicio`
  );

  return res.sendStatus(200);

}
          
    if (sessao?.etapa === "selecionar_acesso_desconectado") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Responda apenas com o número do acesso desconectado.`);
        return res.sendStatus(200);
      }

      const escolha = Number(String(texto || "").trim());

      if (!escolha || escolha < 1 || escolha > sessao.opcoes.length) {
        await enviarMensagem(numero, `Opção inválida.

Responda apenas com o número do acesso desconectado.`);
        return res.sendStatus(200);
      }

      await iniciarRelatoDesconectado(numero, sessao.cliente, sessao.opcoes[escolha - 1]);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "relato_cliente") {
      if (audio) {
        await finalizarAtendimentoAudio(numero, sessao);
        return res.sendStatus(200);
      }

      sessao.relatoCliente = String(texto || "").trim();
      sessao.enderecoSistema = montarEndereco(sessao.cliente, sessao.pppoe);
      sessao.etapa = "confirmar_endereco";
      sessoes.set(numero, sessao);

      await enviarMensagem(numero, `📍 O endereço abaixo está correto?

${sessao.enderecoSistema}

Responda SIM ou NÃO.`);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "confirmar_endereco") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Responda apenas SIM ou NÃO.`);
        return res.sendStatus(200);
      }

      if (respostaSim(texto)) {
        sessao.enderecoFinal = sessao.enderecoSistema;
        await finalizarAtendimento(numero, sessao);
        return res.sendStatus(200);
      }

      if (respostaNao(texto)) {
        sessao.etapa = "aguardando_endereco_manual";
        sessoes.set(numero, sessao);

        await enviarMensagem(numero, `Por favor, envie o endereço correto com uma referência.

Ex.: Rua X, nº 123, próximo ao mercado Y.`);
        return res.sendStatus(200);
      }

      await enviarMensagem(numero, `Não entendi.

O endereço abaixo está correto?

${sessao.enderecoSistema}

Responda apenas SIM ou NÃO.`);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "aguardando_endereco_manual") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Envie o endereço correto por texto, com uma referência.`);
        return res.sendStatus(200);
      }

      sessao.enderecoFinal = `${String(texto || "").trim()}

⚠️ Endereço informado pelo cliente após confirmação.`;

      await finalizarAtendimento(numero, sessao);
      return res.sendStatus(200);
    }

    if (audio) {
      sessoes.set(numero, { etapa: "aguardando_cpf" });
      await enviarMensagem(numero, mensagemAudioInicial());
      return res.sendStatus(200);
    }

    if (pareceCpf(texto)) {
      await processarCpf(numero, limparCpf(texto));
      return res.sendStatus(200);
    }

    sessoes.set(numero, { etapa: "aguardando_cpf" });
    await enviarMensagem(numero, mensagemBoasVindas());
    return res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error.response?.data || error.message);
    res.sendStatus(200);
  }
});

app.post("/enviar-massa", async (req, res) => {
  const { numeros, mensagem, token } = req.body || {};

  if (token !== ENVIO_MASSA_TOKEN) {
    return res.status(401).json({ erro: "Token inválido." });
  }

  const listaNumeros = Array.isArray(numeros)
    ? numeros.filter(n => String(n || "").replace(/\D/g, "").length >= 10)
    : [];

  if (!listaNumeros.length) {
    return res.status(400).json({ erro: "Nenhum número válido informado." });
  }

  if (!mensagem || !String(mensagem).trim()) {
    return res.status(400).json({ erro: "Mensagem vazia." });
  }

  res.status(200).json({
    status: "iniciado",
    total: listaNumeros.length
  });

  const INTERVALO_ENTRE_ENVIOS_MS = 3000;
  let enviados = 0;
  let falhas = 0;

  for (const numero of listaNumeros) {
    try {
      await enviarMensagem(numero, mensagem);
      enviados++;
    } catch (erro) {
      falhas++;
      console.error(`Erro ao enviar aviso em massa para ${numero}:`, erro.response?.data || erro.message);
    }

    await new Promise(resolve => setTimeout(resolve, INTERVALO_ENTRE_ENVIOS_MS));
  }

  console.log(`📨 Envio em massa concluído: ${enviados} enviados, ${falhas} falharam, de ${listaNumeros.length} total.`);
});

app.listen(PORT, () => {
  console.log(`Bot rodando na porta ${PORT}`);
});
