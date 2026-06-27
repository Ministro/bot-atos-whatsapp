const axios = require("axios");

function pegarEntre(html, label) {
  const regex = new RegExp(`<th[^>]*>${label}</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i");
  const match = html.match(regex);
  if (!match) return "";
  return match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function pegarVar(html, nome) {
  const regex = new RegExp(`${nome}\\[0\\]='([^']*)'`, "i");
  const match = html.match(regex);
  return match ? match[1].trim() : "";
}

function extrairClientesWifi(html) {
  const clientes = [];
  const linhas = String(html || "").match(/<tr><td>[\s\S]*?<\/tr>/gi) || [];

  for (const linha of linhas) {
    const colunas = [...linha.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());

    if (colunas.length >= 6 && colunas[0] && colunas[0].toLowerCase() !== "none") {
      clientes.push({
        mac: colunas[0],
        txPackets: colunas[1],
        rxPackets: colunas[2],
        txRate: colunas[3],
        powerSaving: colunas[4],
        expiredTime: colunas[5]
      });
    }
  }

  return clientes;
}

function formatarDispositivos(lista) {
  if (!Array.isArray(lista) || !lista.length) {
    return "Nenhum aparelho conectado.";
  }

  return lista.map((d, i) => {
    let msg = `📱 Aparelho ${i + 1}
🔗 MAC: ${d.mac || "Não informado"}`;

    if (d.txRate && d.txRate !== "0" && d.txRate !== "0 Mbps") {
      msg += `
🚀 Veloc. Da Conexão: ${d.txRate} Mbps`;
    }

    return msg;
  }).join("\n\n");
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
    save: "Login",
    encodePassword: Buffer.from(senha).toString("base64"),
    "submit-url": "/admin/login.asp",
    postSecurityFlag: "20157"
  });

  await axios.post(`http://${ip}/boaform/admin/formLogin`, body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    timeout: 60000,
    validateStatus: () => true
  });
}

async function diagnosticarNavigator(ip) {
  await loginNavigator(ip);

  const statusRes = await axios.get(`http://${ip}/status.asp`, {
    timeout: 10000
  });

  const ponRes = await axios.get(`http://${ip}/status_pon.asp`, {
    timeout: 10000
  });

  const wifi24Res = await axios.get(
    `http://${ip}/boaform/formWlanRedirect?redirect-url=/status_wlan.asp&wlan_idx=1`,
    { timeout: 60000 }
  );

  await new Promise(resolve => setTimeout(resolve, 800));

  const wifi5Res = await axios.get(
    `http://${ip}/boaform/formWlanRedirect?redirect-url=/status_wlan.asp&wlan_idx=0`,
    { timeout: 60000 }
  );

  const status = statusRes.data;
  const pon = ponRes.data;
  const wifi24 = wifi24Res.data;
  const wifi5 = wifi5Res.data;

  const clientes24 = extrairClientesWifi(wifi24);
  const clientes5 = extrairClientesWifi(wifi5);

  return {
    equipamento: {
      modelo: pegarEntre(status, "Device Name"),
      uptime: pegarEntre(status, "Uptime"),
      firmware: pegarEntre(status, "Firmware Version"),
      onuState: pegarEntre(status, "ONU State"),
      cpu: pegarEntre(status, "CPU Usage"),
      memoria: pegarEntre(status, "Memory Usage"),
      ipWan: ip
    },
    fibra: {
      vendor: pegarEntre(pon, "Vendor Name"),
      partNumber: pegarEntre(pon, "Part Number"),
      temperatura: pegarEntre(pon, "Temperature"),
      voltagem: pegarEntre(pon, "Voltage"),
      txPower: pegarEntre(pon, "Tx Power"),
      rxPower: pegarEntre(pon, "Rx Power"),
      onuState: pegarEntre(pon, "ONU State"),
      onuId: pegarEntre(pon, "ONU ID")
    },
    wifi24: {
      ssid: pegarVar(wifi24, "ssid_drv"),
      canal: pegarVar(wifi24, "channel_drv"),
      criptografia: pegarVar(wifi24, "wep"),
      bssid: pegarVar(wifi24, "bssid_drv"),
      clientes: String(clientes24.length),
      dispositivos: clientes24
    },
    wifi5: {
      ssid: pegarVar(wifi5, "ssid_drv"),
      canal: pegarVar(wifi5, "channel_drv"),
      criptografia: pegarVar(wifi5, "wep"),
      bssid: pegarVar(wifi5, "bssid_drv"),
      clientes: String(clientes5.length),
      dispositivos: clientes5
    },
    totalDispositivos: clientes24.length + clientes5.length
  };
}

async function alterarSenhaWifi(ip, banda, novaSenha) {
  await loginNavigator(ip);

  const wlanIdx = banda === "5g" ? "0" : "1";

  await axios.get(
    `http://${ip}/boaform/formWlanRedirect?redirect-url=/wlwpa.asp&wlan_idx=${wlanIdx}`,
    {
      timeout: 60000,
      validateStatus: () => true
    }
  );

  await axios.get(`http://${ip}/admin/wlwpa.asp`, {
    timeout: 60000,
    validateStatus: () => true
  });

  await new Promise(resolve => setTimeout(resolve, 800));

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

  const respostaTexto = String(response.data || "");

  const sucesso =
    response.status >= 200 &&
    response.status < 400 &&
    respostaTexto.toLowerCase().includes("change setting successfully");

  return {
    sucesso,
    status: response.status,
    banda,
    mensagem: sucesso
      ? `Senha do Wi-Fi ${banda === "5g" ? "5 GHz" : "2.4 GHz"} alterada com sucesso.`
      : `Não consegui confirmar a alteração da senha do Wi-Fi ${banda === "5g" ? "5 GHz" : "2.4 GHz"}.`
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

function montarMensagemDiagnostico(dados) {
  const total = Number(dados.totalDispositivos || 0);

  return `🔎 *Diagnóstico do roteador concluído*

✅ *Equipamento:* ${dados.equipamento.modelo || "Não identificado"}
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
  reiniciarRoteador
};
