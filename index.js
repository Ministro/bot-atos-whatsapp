require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 3000;

const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "atos-teste";

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
  const agora = new Date();
  const dia = agora.getDay();
  return dia === 0 || dia === 6;
}

function contemProblema(texto) {
  const msg = texto.toLowerCase();
  return palavrasProblema.some(p => msg.includes(p));
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

app.get("/", (req, res) => {
  res.send("Bot Atos WhatsApp online ✅");
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const data = body.data || body;
    const key = data.key || {};
    const message = data.message || {};

    if (key.fromMe) {
      return res.sendStatus(200);
    }

    const numero = key.remoteJid?.replace("@s.whatsapp.net", "");
    const texto =
      message.conversation ||
      message.extendedTextMessage?.text ||
      data.text ||
      "";

    if (!numero || !texto) {
      return res.sendStatus(200);
    }

    console.log("Mensagem recebida:", numero, texto);

    if (!ehFimDeSemana()) {
      return res.sendStatus(200);
    }

    if (contemProblema(texto)) {
      await enviarMensagem(
        numero,
        `Olá! 👋 Aqui é o atendimento automático da ATOS TELECOM.

Identificamos que você pode estar com problema de conexão.

Para agilizar o suporte, envie por favor:

📌 Nome do titular
📌 CPF do titular
📌 Endereço
📌 Está sem internet total ou oscilando?

Nossa equipe de plantão irá verificar o mais breve possível.`
      );
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
