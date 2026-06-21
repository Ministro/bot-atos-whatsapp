require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "20mb" }));

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

const sessoes = new Map();
const timersEncerramento = new Map();

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

function pareceCpf(texto) {
  return limparCpf(texto).length === 11;
}

function respostaSim(texto) {
  const msg = String(texto || "").toLowerCase().trim();
  return ["sim", "s", "ss", "correto", "isso", "positivo"].includes(msg);
}

function respostaNao(texto) {
  const msg = String(texto || "").toLowerCase().trim();
  return ["não", "nao", "n", "negativo", "errado"].includes(msg);
}

function contemFinanceiro(texto) {
  const msg = String(texto || "").toLowerCase();
  return palavrasFinanceiro.some(p => msg.includes(p));
}

function contemLentidao(texto) {
  const msg = String(texto || "").toLowerCase();
  return palavrasLentidao.some(p => msg.includes(p));
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
  await axios.post(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    { number: numero, text: texto },
    {
      headers: {
        apikey: EVOLUTION_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );
}

async function enviarPdfBoleto(numero, base64Pdf, nomeArquivo = "boleto.pdf") {
  const base64Limpo = String(base64Pdf || "").replace(/^data:application\/pdf;base64,/, "");

  await axios.post(
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

  const dia = portoVelho.getDay(); // 0 = Domingo | 6 = Sábado
  const hora = portoVelho.getHours();
  const minuto = portoVelho.getMinutes();

  // ===== INÍCIO DO PLANTÃO =====
  // Sábado às 12:00
  if (
    dia === 6 &&
    (hora > 12 || (hora === 12 && minuto >= 00))
  ) {
    return true;
  }

  // ===== FIM DO PLANTÃO =====
  // Domingo até 16:00
  if (
    dia === 0 &&
    (
      hora < 16 ||
      (hora === 16 && minuto <= 0)
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

async function enviarBoletoOuPix(numero, sessao) {
  const idCliente = sessao?.cliente?.id;

  if (!idCliente) {
    await enviarMensagem(
      numero,
      "Não consegui identificar o cliente para localizar a fatura."
    );
    return;
  }

  await enviarMensagem(numero, "🔎 Consultando faturas em aberto...");

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
const linhaDigitavel = boleto.linha_digitavel || "";
  
  const pdfBoleto = await consultarDadosBoleto(boleto.id);

console.log("===== PDF BASE64 IXC =====");
console.log(JSON.stringify(pdfBoleto, null, 2).slice(0, 1000));
console.log("===== FIM PDF BASE64 IXC =====");

await enviarPdfBoleto(numero, pdfBoleto, `boleto-${boleto.id}.pdf`);

if (linhaDigitavel) {
  await enviarMensagem(numero, `💳 Fatura encontrada

📅 Vencimento: ${vencimento}
💰 Valor: R$ ${valor}

📄 Linha digitável:
${linhaDigitavel}`);
}

return;
}

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

• Boleto ou PIX para pagamento
• Lentidão ou oscilação
• Outro assunto`;
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
        if (!estaNoPlantao()) {
      console.log("Fora do horário do plantão. Webhook WhatsApp ignorado.");
      return res.sendStatus(200);
    }
    
    const body = req.body;
    const data = body.data || body;
    const key = data.key || {};
    const message = data.message || {};

    if (key.fromMe) return res.sendStatus(200);

    // Ignora mensagens de grupos
if (key.remoteJid?.endsWith("@g.us")) {
  return res.sendStatus(200);
}

    const numero = key.remoteJid?.replace("@s.whatsapp.net", "");

    const texto =
      message.conversation ||
      message.extendedTextMessage?.text ||
      data.text ||
      "";

    const audio = ehAudio(message, data);

    if (!numero) return res.sendStatus(200);

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

    if (sessao?.etapa === "cliente_conectado") {
      if (audio) {
        await enviarMensagem(numero, `🎤 No momento ainda não consigo compreender mensagens de áudio.

Em breve, um atendente entrará em contato para ajudá-lo.

Agradecemos pela compreensão.`);

        sessoes.set(numero, { etapa: "encerramento" });
        iniciarEncerramento(numero);
        return res.sendStatus(200);
      }

      if (contemFinanceiro(texto)) {
  await enviarBoletoOuPix(numero, sessao);
  return res.sendStatus(200);
}

      if (contemLentidao(texto)) {
        await enviarMensagem(
          numero,
          mensagemOrientacaoConectado(sessao.cliente, sessao.pppoe)
        );

        sessoes.set(numero, { etapa: "encerramento" });
        iniciarEncerramento(numero);
        return res.sendStatus(200);
      }

      await enviarMensagem(numero, `Entendido.

Um atendente entrará em contato assim que possível ou no próximo dia útil para dar continuidade ao atendimento.`);

      sessoes.set(numero, { etapa: "encerramento" });
      iniciarEncerramento(numero);
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

app.listen(PORT, () => {
  console.log(`Bot rodando na porta ${PORT}`);
});
