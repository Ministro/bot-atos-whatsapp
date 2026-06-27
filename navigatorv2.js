const axios = require("axios");

axios.defaults.insecureHTTPParser = true;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function limparHtml(texto) {
  return String(texto || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pegarEntre(html, label) {
  const regex = new RegExp(`<th[^>]*>${label}</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i");
  const match = String(html || "").match(regex);
  return match ? limparHtml(match[1]) : "";
}

function pegarVar(html, nome, indice = 0) {
  const texto = String(html || "");

  const regex = new RegExp(
    `${nome}\\s*\\[\\s*${indice}\\s*\\]\\s*=\\s*['"]([^'"]*)['"]\\s*;`,
    "i"
  );

  const match = texto.match(regex);
  return match ? match[1].trim() : "";
}

function pegarVarNumero(html, nome, indice = 0) {
  const valor = pegarVar(html, nome, indice);
  const numero = String(valor || "").match(/\d+/);
  return numero ? numero[0] : "";
}

function pegarInputValue(html, nome) {
  const texto = String(html || "");

  const regex1 = new RegExp(`name=["']?${nome}["']?[^>]*value=["']([^"']*)["']`, "i");
  const match1 = texto.match(regex1);
  if (match1) return match1[1].trim();

  const regex2 = new RegExp(`value=["']([^"']*)["'][^>]*name=["']?${nome}["']?`, "i");
  const match2 = texto.match(regex2);
  if (match2) return match2[1].trim();

  return "";
}

function extrairClientesWifi(html) {
  const texto = String(html || "");
  const dispositivos = [];

  const macs = texto.match(/([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g) || [];

  for (const mac of macs) {
    const macNormalizado = mac.toUpperCase();

    if (
      macNormalizado === "00:00:00:00:00:00" ||
      macNormalizado === "FF:FF:FF:FF:FF:FF"
    ) {
      continue;
    }

    if (!dispositivos.find(d => d.mac === macNormalizado)) {
      dispositivos.push({
    nome: "Aparelho conectado",
    ip: "",
    mac: macNormalizado,
    rede: ""
});
    }
  }

  return dispositivos;
}

function formatarDispositivos(lista) {
  if (!lista || !lista.length) {
    return "Nenhum aparelho conectado.";
  }

  return lista.map((d, i) => {
    return `📱 Aparelho ${i + 1}
🔗 MAC: ${d.mac || "Não informado"}`;
  }).join("\n\n");
}

function calcularPostSecurityFlag(queryStringSemFlag) {
  let inputVal = queryStringSemFlag;

  if (!inputVal.endsWith("&")) {
    inputVal += "&";
  }

  let csum = 0;
  let i = 0;

  while (i < inputVal.length) {
    if ((i + 4) > inputVal.length) {
      if (i < inputVal.length) csum += inputVal.charCodeAt(i) << 24;
      if ((i + 1) < inputVal.length) csum += inputVal.charCodeAt(i + 1) << 16;
      if ((i + 2) < inputVal.length) csum += inputVal.charCodeAt(i + 2) << 8;
      break;
    } else {
      csum +=
        (inputVal.charCodeAt(i) << 24) +
        (inputVal.charCodeAt(i + 1) << 16) +
        (inputVal.charCodeAt(i + 2) << 8) +
        inputVal.charCodeAt(i + 3);
      i += 4;
    }
  }

  csum = (csum & 0xffff) + (csum >> 16);
  csum = csum & 0xffff;
  csum = ~csum & 0xffff;

  return String(csum);
}

async function loginNavigator(ip, usuario = "adminisp", senha = "adminisp") {
  const body = new URLSearchParams({
    challenge: "",
    username: usuario,
    password: senha,
    save: "Login",
    "submit-url": "/admin/login.asp",
    postSecurityFlag: "5942"
  });

  await axios.post(`http://${ip}/boaform/admin/formLogin`, body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: `http://${ip}`,
      Referer: `http://${ip}/admin/login.asp`,
      "User-Agent": "Mozilla/5.0"
    },
    timeout: 60000,
    maxRedirects: 0,
    validateStatus: () => true
  });
}

async function abrirWifi(ip, wlanIdx, pagina) {
  const paginaReal = pagina === "status_wlan.asp" ? "wlstatus.asp" : pagina;

  const res = await axios.get(
    `http://${ip}/boaform/formWlanRedirect?redirect-url=/${paginaReal}&wlan_idx=${wlanIdx}`,
    {
      timeout: 60000,
      validateStatus: () => true
    }
  );

  return String(res.data || "");
}

async function abrirClientesWifi(ip, wlanIdx) {
  const res = await axios.get(
    `http://${ip}/boaform/admin/formWirelessTbl?submit-url=/admin/wlstatbl.asp&wlan_idx=${wlanIdx}&_=${Date.now()}`,
    {
      timeout: 60000,
      validateStatus: () => true
    }
  );

  return String(res.data || "");
}

function extrairSsidBasic(html) {
  return (
    pegarInputValue(html, "ssid") ||
    pegarVar(html, "ssid_drv") ||
    pegarVar(html, "ssid_5g") ||
    pegarVar(html, "ssid_2g") ||
    ""
  );
}

function extrairCanalStatus(html) {
  return (
    pegarVarNumero(html, "channel_drv") ||
    pegarVar(html, "channel_drv") ||
    ""
  );
}

function extrairCanalBasic(html) {
  return (
    pegarInputValue(html, "chan") ||
    pegarVarNumero(html, "defaultChan") ||
    ""
  );
}

async function diagnosticarNavigator(ip) {
  await loginNavigator(ip);

  const statusRes = await axios.get(`http://${ip}/status.asp?_=${Date.now()}`, {
    timeout: 60000,
    validateStatus: () => true
  });

  const ponRes = await axios.get(`http://${ip}/status_pon.asp?_=${Date.now()}`, {
    timeout: 60000,
    validateStatus: () => true
  });

  const wifi5 = await abrirWifi(ip, "0", "status_wlan.asp");
  const basic5 = await abrirWifi(ip, "0", "wlbasic.asp");
  const clientesHtml5 = await abrirClientesWifi(ip, "0");

  const wifi24 = await abrirWifi(ip, "1", "status_wlan.asp");
  const basic24 = await abrirWifi(ip, "1", "wlbasic.asp");
  const clientesHtml24 = await abrirClientesWifi(ip, "1");

  const clientes5 = extrairClientesWifi(clientesHtml5).map(d => ({
    ...d,
    rede: "5 GHz"
  }));

  const clientes24 = extrairClientesWifi(clientesHtml24).map(d => ({
    ...d,
    rede: "2.4 GHz"
  }));

  const qtd5 =
    pegarVar(wifi5, "clientnum") ||
    pegarVarNumero(wifi5, "clientnum") ||
    String(clientes5.length);

  const qtd24 =
    pegarVar(wifi24, "clientnum") ||
    pegarVarNumero(wifi24, "clientnum") ||
    String(clientes24.length);

  return {
    equipamento: {
      modelo: pegarEntre(statusRes.data, "Device Name") || "Navigator SUMEC V2",
      uptime: pegarEntre(statusRes.data, "Uptime"),
      firmware: pegarEntre(statusRes.data, "Firmware Version"),
      onuState: pegarEntre(statusRes.data, "ONU State"),
      cpu: pegarEntre(statusRes.data, "CPU Usage"),
      memoria: pegarEntre(statusRes.data, "Memory Usage"),
      ipWan: ip
    },
    fibra: {
      vendor: pegarEntre(ponRes.data, "Vendor Name"),
      partNumber: pegarEntre(ponRes.data, "Part Number"),
      temperatura: pegarEntre(ponRes.data, "Temperature"),
      voltagem: pegarEntre(ponRes.data, "Voltage"),
      txPower: pegarEntre(ponRes.data, "Tx Power"),
      rxPower: pegarEntre(ponRes.data, "Rx Power"),
      onuState: pegarEntre(ponRes.data, "ONU State"),
      onuId: pegarEntre(ponRes.data, "ONU ID")
    },
    wifi5: {
      ssid: pegarVar(wifi5, "ssid_drv") || extrairSsidBasic(basic5),
      canal: extrairCanalStatus(wifi5) || extrairCanalBasic(basic5),
      criptografia: pegarVar(wifi5, "wep"),
      bssid: pegarVar(wifi5, "bssid_drv"),
      clientes: qtd5,
      dispositivos: clientes5
    },
    wifi24: {
      ssid: pegarVar(wifi24, "ssid_drv") || extrairSsidBasic(basic24),
      canal: extrairCanalStatus(wifi24) || extrairCanalBasic(basic24),
      criptografia: pegarVar(wifi24, "wep"),
      bssid: pegarVar(wifi24, "bssid_drv"),
      clientes: qtd24,
      dispositivos: clientes24
    },
    totalDispositivos: Number(qtd24 || 0) + Number(qtd5 || 0)
  };
}

async function alterarSenhaWifi(ip, banda, novaSenha) {
  await loginNavigator(ip);

  const wlanIdx = banda === "5g" ? "0" : "1";
  await abrirWifi(ip, wlanIdx, "wlwpa.asp");
  
  const bodySemFlag = new URLSearchParams({
    wlanDisabled: "OFF",
    isNmode: "1",
    wpaSSID: "0",
    security_method: "6",
    auth_type: "both",
    wepEnabled: "ON",
    length0: "1",
    format0: "1",
    wpaAuth: "psk",
    wpa3_sae_pwe: "2",
    dotIEEE80211W: "0",
    sha256: "0",
    gk_rekey: "86400",
    pskFormat: "0",
    wapiPskFormat: "0",
    wapiPskValue: "",
    wepKeyLen: "wep64",
    radiusIP: "0.0.0.0",
    radiusPort: "1812",
    radius2IP: "0.0.0.0",
    radius2Port: "1812",
    wapiASIP: "0.0.0.0",
    wlan_idx: wlanIdx,
    wlan6gSupport: "0",
    "submit-url": "/admin/wlwpa.asp",
    encodekey0: "",
    encodepskValue: Buffer.from(novaSenha).toString("base64"),
    encoderadiusPass: "",
    encoderadius2Pass: "",
    save: "Apply Changes"
  });

  const postSecurityFlag = calcularPostSecurityFlag(bodySemFlag.toString());
  const bodyFinal = new URLSearchParams(bodySemFlag);
  bodyFinal.append("postSecurityFlag", postSecurityFlag);

  const response = await axios.post(
    `http://${ip}/boaform/admin/formWlEncrypt`,
    bodyFinal.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: `http://${ip}`,
        Referer: `http://${ip}/admin/wlwpa.asp`,
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 60000,
      validateStatus: () => true
    }
  );

  const texto = String(response.data || "").toLowerCase();
  const sucesso =
    response.status >= 200 &&
    response.status < 400 &&
    texto.includes("change setting successfully");

  return {
    sucesso,
    status: response.status,
    banda,
    mensagem: sucesso
      ? `Senha do Wi-Fi ${banda === "5g" ? "5 GHz" : "2.4 GHz"} alterada com sucesso.`
      : `Não consegui confirmar a alteração da senha do Wi-Fi ${banda === "5g" ? "5 GHz" : "2.4 GHz"}.`
  };
}

function escolherProximoCanal24(canalAtual) {
  const canais = ["1", "6", "11"];
  const atual = String(canalAtual || "");
  const idx = canais.indexOf(atual);

  if (idx === -1) return "6";
  return canais[(idx + 1) % canais.length];
}

function escolherProximoCanal5(canalAtual) {
  const canais = ["36", "44", "149", "157"];
  const atual = String(canalAtual || "");
  const idx = canais.indexOf(atual);

  if (idx === -1) return "36";
  return canais[(idx + 1) % canais.length];
}

async function alterarCanalWifi(ip, banda, novoCanal) {
  await loginNavigator(ip);

  const wlanIdx = banda === "5g" ? "0" : "1";
  const status = await abrirWifi(ip, wlanIdx, "status_wlan.asp");
  const pagina = await abrirWifi(ip, wlanIdx, "wlbasic.asp");

  const ssidAtual =
    pegarVar(status, "ssid_drv") ||
    pegarInputValue(pagina, "ssid") ||
    "";

  const canalAtual =
    extrairCanalStatus(status) ||
    pegarInputValue(pagina, "chan") ||
    "";

  const is5g = banda === "5g";
  const canalEscolhido =
    novoCanal ||
    (is5g ? escolherProximoCanal5(canalAtual) : escolherProximoCanal24(canalAtual));

  const bodySemFlag = new URLSearchParams({
    band: is5g ? "75" : "10",
    mode: "0",
    ssid: ssidAtual,
    chanwid: is5g ? "2" : "0",
    chan: canalEscolhido,
    txpower: "0",
    tx_restrict: "0",
    rx_restrict: "0",
    wl_limitstanum: "0",
    wl_stanum: "",
    regdomain_demo: "1",
    "submit-url": "/admin/wlbasic.asp",
    save: "Apply Changes",
    basicrates: is5g ? "496" : "15",
    operrates: is5g ? "4080" : "4095",
    wlan_idx: wlanIdx,
    Band2G5GSupport: is5g ? "2" : "1",
    wlanBand2G5Select: "0",
    dfs_enable: is5g ? "1" : "0"
  });

  const postSecurityFlag = calcularPostSecurityFlag(bodySemFlag.toString());
  const bodyFinal = new URLSearchParams(bodySemFlag);
  bodyFinal.append("postSecurityFlag", postSecurityFlag);

  const response = await axios.post(
    `http://${ip}/boaform/admin/formWlanSetup`,
    bodyFinal.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: `http://${ip}`,
        Referer: `http://${ip}/admin/wlbasic.asp`,
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 60000,
      validateStatus: () => true
    }
  );

  const texto = String(response.data || "").toLowerCase();
  const sucesso =
    response.status >= 200 &&
    response.status < 400 &&
    texto.includes("change setting successfully");

  return {
    sucesso,
    banda,
    canalAnterior: canalAtual || "Auto",
    canalNovo: canalEscolhido,
    mensagem: sucesso
      ? `Canal do Wi-Fi ${is5g ? "5 GHz" : "2.4 GHz"} alterado de ${canalAtual || "Auto"} para ${canalEscolhido}.`
      : `Não consegui confirmar a alteração do canal ${is5g ? "5 GHz" : "2.4 GHz"}.`
  };
}

async function otimizarCanal(ip) {
  const r5 = await alterarCanalWifi(ip, "5g");
  await delay(1200);
  const r24 = await alterarCanalWifi(ip, "24g");

  const sucesso = r5.sucesso || r24.sucesso;

  return {
    sucesso,
    canal5gAnterior: r5.canalAnterior,
    canal5gNovo: r5.canalNovo,
    canal24Anterior: r24.canalAnterior,
    canal24Novo: r24.canalNovo,
    resultados: [r5, r24],
    mensagem: sucesso
      ? `CANAIS OTIMIZADOS COM SUCESSO

📶 5 GHz: canal ${r5.canalAnterior} → ${r5.canalNovo}
📶 2.4 GHz: canal ${r24.canalAnterior} → ${r24.canalNovo}`
      : "Não consegui confirmar a otimização dos canais."
  };
}

async function reiniciarRoteador(ip) {
  await loginNavigator(ip);

  const body = new URLSearchParams({
    postSecurityFlag: "65535"
  });

  const response = await axios.post(
    `http://${ip}/boaform/admin/formReboot`,
    body.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: `http://${ip}`,
        Referer: `http://${ip}/reboot.asp`,
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 60000,
      validateStatus: () => true
    }
  );

  const texto = String(response.data || "").toLowerCase();

  const sucesso =
    response.status >= 200 &&
    response.status < 400 &&
    (
      texto.includes("restarting") ||
      texto.includes("rebooting") ||
      texto.includes("configured and is rebooting")
    );

  return {
    sucesso,
    status: response.status,
    mensagem: sucesso
      ? "Comando de reinício enviado com sucesso."
      : "Comando enviado, mas não consegui confirmar o reinício."
  };
}

function montarMensagemAparelhosConectados(dados) {
  const total = Number(dados.totalDispositivos || 0);

  return `📶 *Consulta concluída*

📊 *Total de aparelhos conectados:* ${total}

━━━━━━━━━━━━━━━━━━

📶 *Rede 5 GHz*
📡 Nome: ${dados.wifi5?.ssid || "Não informado"}
👥 Aparelhos: ${dados.wifi5?.clientes || "0"}

${formatarDispositivos(dados.wifi5?.dispositivos)}

━━━━━━━━━━━━━━━━━━

📶 *Rede 2.4 GHz*
📡 Nome: ${dados.wifi24?.ssid || "Não informado"}
👥 Aparelhos: ${dados.wifi24?.clientes || "0"}

${formatarDispositivos(dados.wifi24?.dispositivos)}

━━━━━━━━━━━━━━━━━━

O que deseja fazer agora?

1️⃣ Trocar senha do Wi-Fi
2️⃣ Otimizar canal do Wi-Fi
3️⃣ Reiniciar roteador
4️⃣ Voltar ao menu`;
}

function montarMensagemDiagnostico(dados) {
  const total = Number(dados.totalDispositivos || 0);

  return `🔎 *Diagnóstico do roteador concluído*

✅ *Equipamento:* ${dados.equipamento.modelo || "Navigator SUMEC V2"}
⏱️ *Tempo ligado:* ${dados.equipamento.uptime || "Não informado"}
🧠 *CPU:* ${dados.equipamento.cpu || "Não informado"}
💾 *Memória:* ${dados.equipamento.memoria || "Não informado"}

💡 *Fibra*
• RX: ${dados.fibra.rxPower || "Não informado"}
• TX: ${dados.fibra.txPower || "Não informado"}
• Estado ONU: ${dados.fibra.onuState || dados.equipamento.onuState || "Não informado"}

📶 *Wi-Fi 5 GHz*
• Nome: ${dados.wifi5.ssid || "Não informado"}
• Canal: ${dados.wifi5.canal || "Não informado"}
• Aparelhos conectados: ${dados.wifi5.clientes || "0"}

${formatarDispositivos(dados.wifi5.dispositivos)}

📶 *Wi-Fi 2.4 GHz*
• Nome: ${dados.wifi24.ssid || "Não informado"}
• Canal: ${dados.wifi24.canal || "Não informado"}
• Aparelhos conectados: ${dados.wifi24.clientes || "0"}

${formatarDispositivos(dados.wifi24.dispositivos)}

📊 *Total de aparelhos conectados:* ${total}`;
}

module.exports = {
  diagnosticarNavigator,
  montarMensagemDiagnostico,
  montarMensagemAparelhosConectados,
  alterarSenhaWifi,
  alterarCanalWifi,
  otimizarCanal,
  reiniciarRoteador,
  loginNavigator
};
