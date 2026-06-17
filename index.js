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
  "lentidao",
  "travando",
  "internet lenta",
  "wifi lento",
  "wi-fi lento"
];

function contemProblema(texto) {
  const msg = texto.toLowerCase();

  const palavrasIgnoradas = [
    "boleto",
    "segunda via",
    "fatura",
    "pagamento",
    "pagar",
    "pix"
  ];

  if (palavrasIgnoradas.some(p => msg.includes(p))) return false;

  return palavrasProblema.some(p => msg.includes(p));
}

function limparCpf(texto) {
  return texto.replace(/\D/g, "");
}

function pareceCpf(texto) {
  return limparCpf(texto).length === 11;
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
  return [
    cliente?.endereco || pppoe?.endereco,
    cliente?.numero || pppoe?.numero,
    cliente?.complemento || pppoe?.complemento,
    cliente?.bairro || pppoe?.bairro
  ]
    .filter(Boolean)
    .join(", ") || "não informado";
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
5️⃣ Faça o teste de velocidade pelo link:
https://www.speedtest.net/pt

Caso a velocidade esteja de acordo com seu plano, pode ser uma instabilidade temporária em sites, aplicativos ou serviços externos.

Se o problema persistir, um atendente entrará em contato no próximo dia útil.`;
}

function montarOS(sessao, numeroCliente) {
  const cliente = sessao.cliente || {};
  const pppoe = sessao.pppoe || {};
  const protocolo = gerarProtocolo();
  const endereco = montarEndereco(cliente, pppoe);

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

📝 Relato do cliente:
"${sessao.relatoCliente || "não informado"}"

⚠️ Atendimento encaminhado ao plantão técnico.`
  };
}

async function iniciarRelatoDesconectado(numero, cliente, pppoe) {
  sessoes.set(numero, {
    etapa: "relato_cliente",
    cliente,
    pppoe
  });

  await enviarMensagem(numero, `🔴 Seu acesso está DESCONECTADO.

Para agilizar o atendimento técnico, informe o que você percebe no equipamento.

Ex.: luz vermelha, roteador não liga ou Wi-Fi não aparece.`);
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
      const pppoes = Array.isArray(dados.pppoes)
        ? dados.pppoes
        : dados.pppoe
          ? [dados.pppoe]
          : [];

      if (!pppoes.length) {
        await enviarMensagem(numero, `⚠️ ${cliente.nome}, encontrei seu cadastro, mas não localizei acesso PPPoE.

Seu atendimento foi encaminhado ao plantão técnico.`);
        sessoes.delete(numero);
        return res.sendStatus(200);
      }

      const ativos = pppoes.filter(p => p.ativo === "S");
      const acessos = ativos.length ? ativos : pppoes;

      const desconectados = acessos.filter(p => p.online !== "S");
      const conectados = acessos.filter(p => p.online === "S");

      if (desconectados.length === 1) {
        await iniciarRelatoDesconectado(numero, cliente, desconectados[0]);
        return res.sendStatus(200);
      }

      if (desconectados.length > 1) {
        sessoes.set(numero, {
          etapa: "selecionar_acesso_desconectado",
          cliente,
          opcoes: desconectados
        });

        const lista = desconectados.map((p, i) => listarAcesso(cliente, p, i)).join("\n\n");

        await enviarMensagem(numero, `🔴 ${cliente.nome}, encontramos ${desconectados.length} acessos DESCONECTADOS no seu CPF.

Escolha qual acesso está com problema:

${lista}

Responda apenas com o número do acesso.`);
        return res.sendStatus(200);
      }

      if (conectados.length === 1) {
        await enviarMensagem(numero, montarRespostaConectado(cliente, conectados[0]));
        sessoes.delete(numero);
        return res.sendStatus(200);
      }

      const lista = conectados.map((p, i) => listarAcesso(cliente, p, i)).join("\n\n");

      await enviarMensagem(numero, `🟢 ${cliente.nome}, todos os acessos encontrados estão CONECTADOS.

${lista}

Como os acessos aparecem conectados no sistema, siga estes testes:

1️⃣ Desligue o roteador da tomada.
2️⃣ Aguarde 3 minutos.
3️⃣ Ligue novamente e teste a internet.
4️⃣ Se possível, conecte na rede 5G do Wi-Fi.
5️⃣ Faça o teste de velocidade:
https://www.speedtest.net/pt

Se o problema persistir, um atendente entrará em contato no próximo dia útil.`);

      sessoes.delete(numero);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "selecionar_acesso_desconectado") {
      const escolha = Number(texto.trim());

      if (!escolha || escolha < 1 || escolha > sessao.opcoes.length) {
        await enviarMensagem(numero, `Opção inválida.

Responda apenas com o número do acesso desconectado.`);
        return res.sendStatus(200);
      }

      const pppoeEscolhido = sessao.opcoes[escolha - 1];

      await iniciarRelatoDesconectado(numero, sessao.cliente, pppoeEscolhido);
      return res.sendStatus(200);
    }

    if (sessao?.etapa === "relato_cliente") {
      sessao.relatoCliente = texto.trim();

      const os = montarOS(sessao, numero);

      if (TECNICO_NUMERO) {
        await enviarMensagem(TECNICO_NUMERO, os.mensagem);
      }

      await enviarMensagem(numero, `✅ ATENDIMENTO ABERTO

📌 Protocolo: ${os.protocolo}

Recebemos sua solicitação e ela já foi encaminhada ao técnico de plantão.

Em instantes, ele entrará em contato e seguirá para o atendimento em sua residência.

Agradecemos pela compreensão e pedimos que aguarde.`);

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
