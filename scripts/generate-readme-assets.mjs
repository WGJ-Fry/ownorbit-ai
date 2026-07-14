import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "docs/assets/readme");
mkdirSync(outDir, { recursive: true });

const font = "Inter, Arial, Helvetica, sans-serif";

function card(x, y, w, h, title, body, accent = "#38BDF8") {
  const lines = Array.isArray(body) ? body : [body];
  return `
  <g transform="translate(${x} ${y})">
    <rect width="${w}" height="${h}" rx="22" fill="#0F172A" stroke="#26384F"/>
    <rect x="0" y="0" width="7" height="${h}" rx="4" fill="${accent}"/>
    <text x="28" y="42" fill="${accent}" font-family="${font}" font-size="21" font-weight="850">${title}</text>
    ${lines.map((line, i) => `<text x="28" y="${78 + i * 28}" fill="#CBD5E1" font-family="${font}" font-size="18">${line}</text>`).join("")}
  </g>`;
}

function pill(x, y, text, fill = "#102033", stroke = "#2DD4BF", color = "#CCFBF1") {
  return `
  <g>
    <rect x="${x}" y="${y}" width="${Math.max(116, text.length * 11 + 34)}" height="38" rx="19" fill="${fill}" stroke="${stroke}"/>
    <text x="${x + 17}" y="${y + 25}" fill="${color}" font-family="${font}" font-size="16" font-weight="800">${text}</text>
  </g>`;
}

function write(name, svg) {
  writeFileSync(join(outDir, name), `${svg.trimStart().replace(/[ \t]+$/gm, "")}\n`);
}

function hero(lang) {
  const zh = lang === "zh";
  const title = zh ? "OwnOrbit AI" : "OwnOrbit AI";
  const subtitle = zh
    ? "本地优先的个人 AI 管家"
    : "Local-first personal AI assistant";
  const question = zh ? "我是不是忘了什么？" : "What am I forgetting?";
  const summary = zh
    ? ["电脑端是私有 AI 核心，手机端是随身入口。", "从笔记、记忆和真实需求里发现下一步行动。"]
    : ["Your computer runs the private core.", "Your phone becomes the everyday assistant."];
  const labels = zh
    ? [
        ["记忆提醒", ["发现截止日期、承诺", "续期和遗漏任务"]],
        ["解决问题", ["需要记账、规划、整理", "计算时生成可运行程序"]],
        ["异地连接", ["通过 LAN、VPN", "或 Tunnel 连接手机"]],
      ]
    : [
        ["Memory recall", ["Find deadlines, promises", "renewals, and loose ends"]],
        ["Problem-solving tools", ["Generate runnable programs", "for real needs"]],
        ["Remote companion", ["Connect through LAN", "VPN, or Tunnel"]],
      ];

  return `<svg width="1280" height="720" viewBox="0 0 1280 720" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${zh ? "OwnOrbit AI 首屏图" : "OwnOrbit AI hero"}</title>
  <desc id="desc">${zh ? "OwnOrbit AI 本地优先个人 AI 管家，包含记忆提醒、自动生成解决问题程序和手机异地连接。" : "OwnOrbit AI local-first personal AI assistant with memory recall, generated problem-solving programs, and remote mobile access."}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1280" y2="720" gradientUnits="userSpaceOnUse">
      <stop stop-color="#08111F"/>
      <stop offset="0.58" stop-color="#0A1724"/>
      <stop offset="1" stop-color="#102033"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="500" gradientUnits="userSpaceOnUse">
      <stop stop-color="#13293D"/>
      <stop offset="1" stop-color="#0B1220"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" rx="34" fill="url(#bg)"/>
  <rect x="34" y="34" width="1212" height="652" rx="30" fill="#08111C" stroke="#223449"/>
  ${pill(72, 72, zh ? "Private AI core + mobile companion" : "Private AI core + mobile companion")}
  <text x="72" y="164" fill="#F8FAFC" font-family="${font}" font-size="70" font-weight="900">${title}</text>
  <text x="72" y="218" fill="#A7F3D0" font-family="${font}" font-size="34" font-weight="850">${subtitle}</text>
  <text x="72" y="274" fill="#CBD5E1" font-family="${font}" font-size="23">${summary[0]}</text>
  <text x="72" y="308" fill="#CBD5E1" font-family="${font}" font-size="23">${summary[1]}</text>
  <rect x="72" y="350" width="568" height="88" rx="22" fill="#12263A" stroke="#2DD4BF" stroke-width="2"/>
  <text x="104" y="405" fill="#FFFFFF" font-family="${font}" font-size="34" font-weight="900">"${question}"</text>
  ${card(72, 486, 338, 136, labels[0][0], labels[0][1], "#67E8F9")}
  ${card(440, 486, 376, 136, labels[1][0], labels[1][1], "#FDE68A")}
  ${card(846, 486, 338, 136, labels[2][0], labels[2][1], "#93C5FD")}
  <g transform="translate(794 86)">
    <rect width="332" height="364" rx="32" fill="url(#panel)" stroke="#334155" stroke-width="2"/>
    <rect x="30" y="30" width="272" height="66" rx="18" fill="#020617" stroke="#26384F"/>
    <text x="54" y="70" fill="#F8FAFC" font-family="${font}" font-size="20" font-weight="850">${zh ? "电脑端核心" : "Desktop Core"}</text>
    <rect x="30" y="120" width="128" height="92" rx="18" fill="#134E4A" stroke="#14B8A6"/>
    <text x="52" y="157" fill="#CCFBF1" font-family="${font}" font-size="17" font-weight="850">${zh ? "记忆" : "Memory"}</text>
    <text x="52" y="184" fill="#CCFBF1" font-family="${font}" font-size="16">${zh ? "提醒" : "Recall"}</text>
    <rect x="174" y="120" width="128" height="92" rx="18" fill="#422006" stroke="#F59E0B"/>
    <text x="196" y="157" fill="#FEF3C7" font-family="${font}" font-size="17" font-weight="850">${zh ? "生成" : "Generated"}</text>
    <text x="196" y="184" fill="#FEF3C7" font-family="${font}" font-size="16">${zh ? "程序" : "Tools"}</text>
    <rect x="30" y="236" width="272" height="86" rx="18" fill="#172554" stroke="#2563EB"/>
    <text x="54" y="270" fill="#DBEAFE" font-family="${font}" font-size="18" font-weight="850">${zh ? "手机端随身入口" : "Mobile companion"}</text>
    <text x="54" y="298" fill="#BFDBFE" font-family="${font}" font-size="16">${zh ? "扫码绑定、异地连接、离线队列" : "Pairing, remote access, offline queue"}</text>
  </g>
</svg>`;
}

function featureMap(lang) {
  const zh = lang === "zh";
  const title = zh ? "OwnOrbit 功能地图" : "OwnOrbit Feature Map";
  const subtitle = zh
    ? "先解决真实问题，再扩展成长期自用的私有 AI 系统。"
    : "Solve real problems first, then grow into a private long-term AI home.";
  const center = zh ? ["私有电脑核心", "认证 / SQLite / AI Provider", "备份 / 诊断 / 设备绑定"] : ["Private Desktop Core", "Auth / SQLite / AI Providers", "Backups / Diagnostics / Device Pairing"];
  const items = zh
    ? [
        ["个人记忆", ["Markdown、承诺、截止日期", "续期、任务、来源引用"], "#67E8F9"],
        ["自动生成程序", ["针对当前问题生成工具", "记账、规划、查询、表单"], "#FDE68A"],
        ["手机入口", ["PWA、离线队列", "绑定、撤销、本地动作"], "#A7F3D0"],
        ["异地连接", ["LAN、Tailscale/VPN", "Cloudflare Tunnel、HTTPS"], "#93C5FD"],
        ["安全底座", ["管理员认证、CSRF", "URL 白名单、危险确认"], "#FDA4AF"],
        ["长期数据", ["SQLite migration", "备份恢复、诊断包脱敏"], "#C4B5FD"],
      ]
    : [
        ["Personal Memory", ["Markdown, promises, deadlines", "renewals, tasks, source refs"], "#67E8F9"],
        ["Generated Programs", ["Create tools for the current problem", "budgeting, planning, lookup, forms"], "#FDE68A"],
        ["Mobile Companion", ["PWA, offline queue", "pairing, revoke, local actions"], "#A7F3D0"],
        ["Remote Access", ["LAN, Tailscale/VPN", "Cloudflare Tunnel, HTTPS"], "#93C5FD"],
        ["Safety Layer", ["Admin auth, CSRF", "URL allowlist, risky action confirm"], "#FDA4AF"],
        ["Long-term Data", ["SQLite migrations", "backup/restore, redacted diagnostics"], "#C4B5FD"],
      ];
  return `<svg width="1280" height="900" viewBox="0 0 1280 900" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${subtitle}</desc>
  <rect width="1280" height="900" rx="34" fill="#071019"/>
  <rect x="34" y="34" width="1212" height="832" rx="30" fill="#0A1420" stroke="#223449"/>
  <text x="64" y="94" fill="#F8FAFC" font-family="${font}" font-size="48" font-weight="900">${title}</text>
  <text x="64" y="134" fill="#94A3B8" font-family="${font}" font-size="21">${subtitle}</text>
  <g transform="translate(438 310)">
    <rect width="404" height="250" rx="32" fill="#102033" stroke="#38BDF8" stroke-width="2"/>
    <text x="36" y="72" fill="#F8FAFC" font-family="${font}" font-size="32" font-weight="900">${center[0]}</text>
    <text x="36" y="124" fill="#CBD5E1" font-family="${font}" font-size="20">${center[1]}</text>
    <text x="36" y="158" fill="#CBD5E1" font-family="${font}" font-size="20">${center[2]}</text>
    <rect x="36" y="190" width="214" height="42" rx="21" fill="#134E4A" stroke="#14B8A6"/>
    <text x="58" y="217" fill="#CCFBF1" font-family="${font}" font-size="17" font-weight="850">${zh ? "电脑保留大脑" : "Computer stays the brain"}</text>
  </g>
  ${card(78, 226, 310, 142, items[0][0], items[0][1], items[0][2])}
  ${card(78, 438, 310, 142, items[1][0], items[1][1], items[1][2])}
  ${card(78, 650, 310, 142, items[5][0], items[5][1], items[5][2])}
  ${card(892, 226, 310, 142, items[2][0], items[2][1], items[2][2])}
  ${card(892, 438, 310, 142, items[3][0], items[3][1], items[3][2])}
  ${card(892, 650, 310, 142, items[4][0], items[4][1], items[4][2])}
  <path d="M388 297H438" stroke="#334155" stroke-width="4"/>
  <path d="M388 509H438" stroke="#334155" stroke-width="4"/>
  <path d="M388 721H438" stroke="#334155" stroke-width="4"/>
  <path d="M842 297H892" stroke="#334155" stroke-width="4"/>
  <path d="M842 509H892" stroke="#334155" stroke-width="4"/>
  <path d="M842 721H892" stroke="#334155" stroke-width="4"/>
</svg>`;
}

function generatedPrograms(lang) {
  const zh = lang === "zh";
  const title = zh ? "自动生成解决问题的程序" : "Generate programs that solve the current problem";
  const subtitle = zh
    ? "不是为了炫技，而是根据当前需求做出能处理问题的工具。"
    : "Not a toy app generator: create the tool for the concrete task.";
  const left = zh
    ? ["真实需求", "记账", "规划", "查询", "整理", "打卡", "计算", "表单", "流程面板"]
    : ["Real needs", "Budgeting", "Planning", "Lookup", "Sorting", "Check-ins", "Calculation", "Forms", "Workflow panels"];
  const middle = zh
    ? ["OwnOrbit Studio", "描述问题，而不是写需求文档", "AI 生成可运行程序", "继续调试和调整", "保留 HTML / CSS / JS 可编辑性"]
    : ["OwnOrbit Studio", "Describe the problem", "AI generates a runnable program", "Keep debugging and refining", "HTML / CSS / JS remains editable"];
  const right = zh
    ? ["结果", "可运行工具", "可编辑面板", "问题处理流程"]
    : ["Result", "Runnable tool", "Editable panel", "Problem workflow"];
  return `<svg width="1280" height="650" viewBox="0 0 1280 650" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${subtitle}</desc>
  <rect width="1280" height="650" rx="32" fill="#080F18"/>
  <rect x="34" y="34" width="1212" height="582" rx="30" fill="#0A1420" stroke="#223449"/>
  <text x="64" y="92" fill="#F8FAFC" font-family="${font}" font-size="45" font-weight="900">${title}</text>
  <text x="64" y="132" fill="#94A3B8" font-family="${font}" font-size="21">${subtitle}</text>
  <g transform="translate(74 188)">
    <rect width="320" height="344" rx="28" fill="#111827" stroke="#334155"/>
    <text x="30" y="56" fill="#FDE68A" font-family="${font}" font-size="27" font-weight="900">${left[0]}</text>
    ${left.slice(1).map((item, i) => `<text x="32" y="${104 + i * 30}" fill="#E5E7EB" font-family="${font}" font-size="19">${item}</text>`).join("")}
  </g>
  <path d="M422 360H514" stroke="#64748B" stroke-width="5"/>
  <path d="M500 340L522 360L500 380" stroke="#64748B" stroke-width="5" fill="none"/>
  <g transform="translate(544 166)">
    <rect width="384" height="390" rx="30" fill="#0F172A" stroke="#38BDF8" stroke-width="2"/>
    <text x="32" y="62" fill="#67E8F9" font-family="${font}" font-size="29" font-weight="900">${middle[0]}</text>
    <rect x="32" y="96" width="320" height="68" rx="17" fill="#172554" stroke="#2563EB"/>
    <text x="52" y="136" fill="#DBEAFE" font-family="${font}" font-size="18">${middle[1]}</text>
    <rect x="32" y="190" width="320" height="126" rx="17" fill="#020617" stroke="#334155"/>
    <text x="52" y="229" fill="#A7F3D0" font-family="${font}" font-size="18" font-weight="850">${middle[2]}</text>
    <text x="52" y="264" fill="#CBD5E1" font-family="${font}" font-size="18">${middle[3]}</text>
    <text x="52" y="297" fill="#CBD5E1" font-family="${font}" font-size="18">${middle[4]}</text>
  </g>
  <path d="M954 360H1038" stroke="#64748B" stroke-width="5"/>
  <path d="M1024 340L1046 360L1024 380" stroke="#64748B" stroke-width="5" fill="none"/>
  <g transform="translate(1066 206)">
    <rect width="142" height="308" rx="28" fill="#111827" stroke="#334155"/>
    <text x="33" y="56" fill="#A7F3D0" font-family="${font}" font-size="24" font-weight="900">${right[0]}</text>
    <rect x="18" y="86" width="106" height="54" rx="14" fill="#134E4A"/>
    <text x="34" y="120" fill="#CCFBF1" font-family="${font}" font-size="15" font-weight="850">${right[1]}</text>
    <rect x="18" y="164" width="106" height="54" rx="14" fill="#172554"/>
    <text x="31" y="198" fill="#DBEAFE" font-family="${font}" font-size="15" font-weight="850">${right[2]}</text>
    <rect x="18" y="242" width="106" height="44" rx="14" fill="#422006"/>
    <text x="32" y="270" fill="#FEF3C7" font-family="${font}" font-size="15" font-weight="850">${right[3]}</text>
  </g>
</svg>`;
}

function remoteAccess(lang) {
  const zh = lang === "zh";
  const title = zh ? "手机异地连回电脑" : "Remote phone access";
  const subtitle = zh
    ? "电脑保留私有 AI 核心，手机通过安全入口连接回来。"
    : "The private AI core stays on your computer; the phone connects back safely.";
  const modes = zh
    ? [
        ["LAN", "同一 Wi-Fi", "自动检测局域网地址", "最快本地体验", "#A7F3D0"],
        ["Tailscale / VPN", "长期自用推荐", "检测安装、设备和可达性", "适合每天使用", "#93C5FD"],
        ["Cloudflare Tunnel", "HTTPS 公网入口", "生成命令、检测 URL", "适合测试和临时远程", "#FDE68A"],
      ]
    : [
        ["LAN", "Same Wi-Fi", "Auto-detect local address", "Fast local setup", "#A7F3D0"],
        ["Tailscale / VPN", "Recommended for long-term use", "Detect install, devices, reachability", "Best for daily access", "#93C5FD"],
        ["Cloudflare Tunnel", "HTTPS public entry", "Generate commands and detect URL", "Good for testing", "#FDE68A"],
      ];
  return `<svg width="1280" height="650" viewBox="0 0 1280 650" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${subtitle}</desc>
  <rect width="1280" height="650" rx="32" fill="#071019"/>
  <rect x="34" y="34" width="1212" height="582" rx="30" fill="#0A1420" stroke="#223449"/>
  <text x="64" y="92" fill="#F8FAFC" font-family="${font}" font-size="43" font-weight="900">${title}</text>
  <text x="64" y="132" fill="#94A3B8" font-family="${font}" font-size="21">${subtitle}</text>
  ${modes.map((m, i) => {
    const x = 76 + i * 384;
    return `<g transform="translate(${x} 206)">
      <rect width="332" height="286" rx="28" fill="#0F172A" stroke="${m[4]}" stroke-width="2"/>
      <text x="30" y="58" fill="${m[4]}" font-family="${font}" font-size="28" font-weight="900">${m[0]}</text>
      <text x="30" y="106" fill="#E2E8F0" font-family="${font}" font-size="19">${m[1]}</text>
      <text x="30" y="140" fill="#CBD5E1" font-family="${font}" font-size="18">${m[2]}</text>
      <rect x="30" y="194" width="246" height="46" rx="16" fill="#102033" stroke="#334155"/>
      <text x="50" y="224" fill="${m[4]}" font-family="${font}" font-size="17" font-weight="850">${m[3]}</text>
    </g>`;
  }).join("")}
  <g transform="translate(64 548)">
    <rect width="1150" height="52" rx="18" fill="#2A1114" stroke="#7F1D1D"/>
    <text x="24" y="34" fill="#FCA5A5" font-family="${font}" font-size="18" font-weight="900">${zh ? "安全规则：" : "Safety rule:"}</text>
    <text x="${zh ? 122 : 130}" y="34" fill="#E5E7EB" font-family="${font}" font-size="18">${zh ? "没有管理员认证、HTTPS、备份和诊断时，不要把电脑端核心直接暴露到公网。" : "Do not expose the desktop core without admin auth, HTTPS, backups, and diagnostics."}</text>
  </g>
</svg>`;
}

write("lifeos-readme-hero-en.svg", hero("en"));
write("lifeos-readme-hero-zh.svg", hero("zh"));
write("lifeos-feature-map-en.svg", featureMap("en"));
write("lifeos-feature-map-zh.svg", featureMap("zh"));
write("lifeos-generated-programs-en.svg", generatedPrograms("en"));
write("lifeos-generated-programs-zh.svg", generatedPrograms("zh"));
write("lifeos-remote-access-en.svg", remoteAccess("en"));
write("lifeos-remote-access-zh.svg", remoteAccess("zh"));

console.log("Generated README assets in docs/assets/readme");
