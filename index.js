require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 3000;

const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "atos-teste";

const IXC_URL = process.env.IXC_URL;
const IXC_USER = process.env.IXC_USER;
const IXC_PASS = process.env.IXC_PASS;

const aguardandoCpf = new Map();

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

function ehFimDeSemana() {
  const dia = new Date().getDay();
  return dia === 0 || dia === 6;
}

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

async function ixcPost(endpoint, body) {
  const auth = Buffer.from(`${IXC_USER}:${IXC_PASS}`).toString("base64");

  const response = await axios.post(
    `${IXC_URL}/webservice/v1/${endpoint}`,
    body,
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

async function buscarClientePorCpf(cpf) {
  const dados = await ixcPost("cliente", {
    qtype: "cliente.cnpj_cpf",
    query: cpf,
    oper: "=",
    page: "1",
    rp: "1",
    sortname: "cliente.id",
    sortorder: "desc"
  });

  return dados?.registros?.[0] || null;
}

async function buscarPppoePorCliente(idCliente) {
  const dados = await ixcPost("radusuarios", {
    qtype: "radusuarios.id_cliente",
    query: idCliente,
    oper: "=",
    page: "1",
    rp: "1",
    sortname: "radusuarios.id",
    sortorder: "desc"
  });

  return dados?.registros?.[0] || null;
}

async function consultarStatusPorCpf(cpf) {
  const cliente = await buscarClientePorCpf(cpf);

  if (!cliente) {
    return `❌ Não encontrei cadastro com esse CPF.

Confira se digitou corretamente e envie novamente apenas o CPF do titular.`;
  }

  const pppoe = await buscarPppoePorCliente(cliente.id);

  const nome = cliente.razao || cliente.nome || "cliente";

  if (!pppoe) {
    return `⚠️ ${nome}, encontrei seu cadastro, mas não localizei o acesso PPPoE.

Seu atendimento foi encaminhado ao plantão técnico.`;
  }

  const online = pppoe.online === "S";
  const tempo = formatarTempo(pppoe.tempoConectado);
  const ip = pppoe.ip || "não informado";

  const ultimaConexao =
    pppoe.ultimaConexao ||
    pppoe.ultima_conexao ||
    pppoe.ultima_desconexao ||
    "não informado";

  if (online) {
    return `🟢 ${nome}, seu acesso está CONECTADO.

⏱️ Tempo conectado: ${tempo}
🌐 IP: ${ip}

Caso ainda esteja sem internet, reinicie o roteador, aguarde 2 minutos e teste novamente.

Se continuar sem conexão, responda ATENDENTE.`;
  }

  return `🔴 ${nome}, seu acesso está DESCONECTADO.

🕒 Última conexão: ${ultimaConexao}

Seu atendimento foi encaminhado ao plantão técnico.`;
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

    // TESTE: deixei liberado todos os dias.
    // Depois, para funcionar só sábado e domingo, descomente abaixo:
    /*
    if (!ehFimDeSemana()) {
      return res.sendStatus(200);
    }
    */

    if (aguardandoCpf.has(numero)) {
      if (!pareceCpf(texto)) {
        await enviarMensagem(
          numero,
          `CPF inválido.

Envie somente o CPF do titular.

Exemplo:
123.456.789-00`
        );
        return res.sendStatus(200);
      }

      const cpf = limparCpf(texto);

      await enviarMensagem(numero, "🔎 Aguarde enquanto verifico sua conexão...");

      const resposta = await consultarStatusPorCpf(cpf);

      await enviarMensagem(numero, resposta);

      aguardandoCpf.delete(numero);
      return res.sendStatus(200);
    }

    if (contemProblema(texto)) {
      aguardandoCpf.set(numero, true);

      await enviarMensagem(
        numero,
        `Olá! 👋 Aqui é o atendimento automático da ATOS TELECOM.

Para verificar sua conexão, envie somente o CPF do titular.

Exemplo:
123.456.789-00`
      );

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
