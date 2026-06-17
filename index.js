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

const sessoes = new Map();

const palavrasProblema = [
  "sem internet",
  "sem conexão",
  "internet caiu",
  "caiu",
  "não conecta",
  "nao conecta",
  "desconectado",
  "suporte",
  "sem sinal",
  "oscilando",
  "lento",
  "lentidão",
  "lentidao"
];

function contemProblema(texto) {
  const msg = texto.toLowerCase();
  return palavrasProblema.some(p => msg.includes(p));
}

function limparCpf(texto) {
  return texto.replace(/\D/g, "");
}

function pareceCpf(texto) {
  return limparCpf(texto).length === 11;
}

function respostaSimNao(texto) {
  const msg = texto.toLowerCase().trim();

  if (["sim", "s", "ss", "positivo"].includes(msg)) return "SIM";
  if (["não", "nao", "n", "negativo"].includes(msg)) return "NÃO";

  return texto;
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

async function enviarMensagem(numero, texto) {
  await axios.post(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    {
      number: numero,
      text: texto
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

function montarRespostaConectado(cliente, pppoe) {
  const tempo = formatarTempo(pppoe.tempo_conectado || pppoe.tempoConectado);
  const ip = pppoe.ip || "não informado";
  const conectouEm = pppoe.ultima_conexao_inicial || "não informado";

  return `🟢 ${cliente.nome}, seu acesso está CONECTADO.

⏱️ Tempo conectado: ${tempo}
🕒 Conectou em: ${conectouEm}
🌐 IP: ${ip}

Caso ainda esteja sem internet, desligue o roteador da tomada, aguarde 2 minutos e ligue novamente.

Se continuar sem conexão, responda ATENDENTE.`;
}

function montarOS(sessao, numeroCliente) {
  const cliente = sessao.cliente || {};
  const pppoe = sessao.pppoe || {};
  const protocolo = gerarProtocolo();

  const endereco =
    [
      cliente.endereco || pppoe.endereco,
      cliente.numero || pppoe.numero,
      cliente.complemento || pppoe.complemento,
      cliente.bairro || pppoe.bairro
    ]
      .filter(Boolean)
      .join(", ") || "não informado";

  return {
    protocolo,
    mensagem: `🚨 NOVA PRÉ-O.S - ATOS TELECOM

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

📋 Triagem do cliente:
🔴 Luz vermelha no aparelho? ${sessao.luzVermelha || "não informado"}
📶 Aparece o nome do Wi-Fi? ${sessao.nomeWifi || "não informado"}
🔌 Equipamento está ligado? ${sessao.equipamentoLigado || "não informado"}
🔄 Já reiniciou o equipamento? ${sessao.reiniciou || "não informado"}

⚠️ Encaminhar para análise do plantão técnico.`
  };
}

app.get("/", (req, res) => {
  res.send("Bot Atos WhatsApp online ✅");
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const data = body.data || body;
    const key = data.key || {};
    const message = data.message || {};

    if (key.fromMe) return res.sendStatus(200);

    const numero = key.remoteJid?.replace("@s.whatsapp.net", "");
    const texto =
      message.conversation ||
      message.extendedTextMessage?.text ||
      data.text ||
      "";

    if (!numero || !texto) return res.sendStatus(200);

    console.log("Mensagem recebida:", numero, texto);

    const sessao = sessoes.get(numero);

    if (sessao?.etapa === "aguardando_cpf") {
      if (!pareceCpf(texto)) {
        await enviarMensagem(numero, `CPF inválido.

Envie somente o CPF do titular.

Exemplo:
123.456.789-00`);
        return res.sendStatus(200);
      }

      const cpf = limparCpf(texto);

      await enviarMensagem(numero, "🔎 Aguarde enquanto verifico sua conexão...");

      const dados = await consultarCpf(cpf);

      if (dados.erro || dados.aviso || !dados.cliente) {
        await enviarMensagem(numero, `❌ Não consegui localizar esse CPF.

Confira se digitou corretamente e envie novamente apenas o CPF do titular.`);
        return res.sendStatus(200);
      }

      const cliente = dados.cliente;
      const pppoe = dados.pppoe;

      if (!pppoe) {
        await enviarMensagem(numero, `⚠️ ${cliente.nome}, encontrei seu cadastro, mas não localizei o acesso PPPoE.

Seu atendimento foi encaminhado ao plantão técnico.`);
        sessoes.delete(numero);
        return res.sendStatus(200);
      }

      if (pppoe.online === "S") {
        await enviarMensagem(numero, montarRespostaConectado(cliente, pppoe));
        sessoes.delete(numero);
        return res.sendStatus(200);
      }

      sessoes.set(numero, {
        etapa: "luz_vermelha",
        cliente,
        pppoe
      });

      await enviarMensagem(numero, `🔴 ${cliente.nome}, seu acesso está DESCONECTADO.

🕒 Desconectou em: ${pppoe.ultima_conexao_final || pppoe.ultima_atualizacao || "não informado"}

Vou fazer algumas perguntas rápidas para encaminhar ao plantão técnico.

🔴 Há alguma luz vermelha no aparelho? Responda SIM ou NÃO.`);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "luz_vermelha") {
      sessao.luzVermelha = respostaSimNao(texto);
      sessao.etapa = "nome_wifi";
      sessoes.set(numero, sessao);

      await enviarMensagem(numero, "📶 O nome do Wi-Fi aparece no celular? Responda SIM ou NÃO.");
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "nome_wifi") {
      sessao.nomeWifi = respostaSimNao(texto);
      sessao.etapa = "equipamento_ligado";
      sessoes.set(numero, sessao);

      await enviarMensagem(numero, "🔌 O equipamento/roteador está ligado na tomada? Responda SIM ou NÃO.");
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "equipamento_ligado") {
      sessao.equipamentoLigado = respostaSimNao(texto);
      sessao.etapa = "reiniciou";
      sessoes.set(numero, sessao);

      await enviarMensagem(numero, "🔄 Você já reiniciou o equipamento, tirando da tomada por 2 minutos? Responda SIM ou NÃO.");
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "reiniciou") {
      sessao.reiniciou = respostaSimNao(texto);

      const os = montarOS(sessao, numero);

      if (TECNICO_NUMERO) {
        await enviarMensagem(TECNICO_NUMERO, os.mensagem);
      }

      await enviarMensagem(numero, `✅ Atendimento registrado com sucesso.

📌 Protocolo: ${os.protocolo}

O plantão técnico já recebeu suas informações e fará a análise o mais breve possível.`);

      sessoes.delete(numero);
      return res.sendStatus(200);
    }

    if (contemProblema(texto)) {
      sessoes.set(numero, {
        etapa: "aguardando_cpf"
      });

      await enviarMensagem(numero, `Olá! 👋 Aqui é o atendimento automático da ATOS TELECOM.

Para verificar sua conexão, envie somente o CPF do titular.

Exemplo:
123.456.789-00`);
      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error.response?.data || error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Bot rodando na porta ${PORT}`);
});
