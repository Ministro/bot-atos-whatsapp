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
    timeout: 10000,
    validateStatus: () => true
  });
}

async function diagnosticarNavigator(ip) {
  await loginNavigator(ip);

  const [statusRes, ponRes, wifi24Res, wifi5Res] = await Promise.all([
    axios.get(`http://${ip}/status.asp`, { timeout: 10000 }),
    axios.get(`http://${ip}/status_pon.asp`, { timeout: 10000 }),
    axios.get(`http://${ip}/boaform/formWlanRedirect?redirect-url=/status_wlan.asp&wlan_idx=1`, { timeout: 10000 }),
    axios.get(`http://${ip}/boaform/formWlanRedirect?redirect-url=/status_wlan.asp&wlan_idx=0`, { timeout: 10000 })
  ]);

  const status = statusRes.data;
  const pon = ponRes.data;
  const wifi24 = wifi24Res.data;
  const wifi5 = wifi5Res.data;

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
      clientes: pegarVar(wifi24, "clientnum")
    },
    wifi5: {
      ssid: pegarVar(wifi5, "ssid_drv"),
      canal: pegarVar(wifi5, "channel_drv"),
      criptografia: pegarVar(wifi5, "wep"),
      bssid: pegarVar(wifi5, "bssid_drv"),
      clientes: pegarVar(wifi5, "clientnum")
    }
  };
}

function montarMensagemDiagnostico(dados) {
  return `🔎 *Diagnóstico do roteador concluído*

✅ *Equipamento:* ${dados.equipamento.modelo || "Não identificado"}
⏱️ *Tempo ligado:* ${dados.equipamento.uptime || "Não informado"}
🧠 *CPU:* ${dados.equipamento.cpu || "Não informado"}
💾 *Memória:* ${dados.equipamento.memoria || "Não informado"}

💡 *Fibra*
• RX: ${dados.fibra.rxPower || "Não informado"}
• TX: ${dados.fibra.txPower || "Não informado"}
• Estado ONU: ${dados.fibra.onuState || dados.equipamento.onuState || "Não informado"}

📶 *Wi-Fi 2.4 GHz*
• Nome: ${dados.wifi24.ssid || "Não informado"}
• Canal: ${dados.wifi24.canal || "Não informado"}
• Clientes conectados: ${dados.wifi24.clientes || "0"}

📶 *Wi-Fi 5 GHz*
• Nome: ${dados.wifi5.ssid || "Não informado"}
• Canal: ${dados.wifi5.canal || "Não informado"}
• Clientes conectados: ${dados.wifi5.clientes || "0"}`;
}

module.exports = {
  diagnosticarNavigator,
  montarMensagemDiagnostico
};
