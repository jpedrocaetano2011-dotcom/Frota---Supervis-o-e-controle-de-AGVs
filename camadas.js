/* ============================================================
   CAMADAS DO MAPA (0.20): Wi-Fi, espera no tráfego, obstáculos, tags
   ============================================================
   Botão "Camadas" no mapa da Visão geral e do editor da planta. Um mapa
   de calor por vez, com o período (agora, hoje, 7 ou 30 dias):
   - Wi-Fi: o sinal que cada Atta mediu onde passou (pontos cegos antes
     que virem problema: Atta sem conexão para antes dos cruzamentos);
   - Espera no tráfego: onde os Atta esperam passagem (cruzamento cheio);
   - Obstáculos: onde eles param por algo ou alguém na frente;
   - Tags com problema: tags que o Atta deveria ler e não leu.
   As paradas por causa e por ponto continuam em Indicadores › Paradas.
   Os dados são juntados por este navegador enquanto o site está aberto
   (a aba que despacha costuma ficar aberta o dia todo), em quadrados de
   1 m, guardados por 30 dias.
*/
const CamadasMapa = (function () {
    const CHAVE = "camadasMapa", CELULA = 1, DIAS = 30;
    const TIPOS = {
        wifi: ["Wi-Fi", "sinal medido pelos Atta"],
        espera: ["Espera no tráfego", "onde esperam passagem"],
        obst: ["Obstáculos", "onde param por algo na frente"],
        tags: ["Tags com problema", "tag que deveria ler e não leu"]
    };
    let dados = ler(), ativo = { tipo: "", periodo: "hoje" }, sujo = false;
    const agora10 = {};   // wifi "agora": últimas amostras por célula (10 min)
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    function ler() { try { return JSON.parse(localStorage.getItem(CHAVE) || "null") || { dias: {} }; } catch (e) { return { dias: {} }; } }
    function gravar() {
        const ds = Object.keys(dados.dias).sort();
        while (ds.length > DIAS) delete dados.dias[ds.shift()];
        try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) { /* cheio: fica na memória */ }
        sujo = false;
    }
    const hoje = () => (typeof Calendario !== "undefined" ? Calendario.local(Date.now()).data : new Date().toISOString().slice(0, 10));
    const dia = () => (dados.dias[hoje()] = dados.dias[hoje()] || { wifi: {}, espera: {}, obst: {}, tags: {} });
    const celula = (x, y) => `${Math.floor(x / CELULA)},${Math.floor(y / CELULA)}`;

    // amostra a cada 5 s
    function coletar() {
        if (typeof agvs === "undefined") return;
        const d = dia(), t = Date.now();
        Object.values(agvs).forEach(a => {
            if (!a.online) return;
            // a mesma posição estimada que a Visão geral desenha
            const pose = typeof poseEstimadaAGV === "function" ? poseEstimadaAGV(a) : null;
            if (!pose || typeof pose.x !== "number" || typeof pose.y !== "number") return;
            const c = celula(pose.x, pose.y);
            const rssi = Number(a.diagnostico?.rssi);
            if (Number.isFinite(rssi) && rssi < 0) {
                const w = d.wifi[c] || (d.wifi[c] = [0, 0, 0]);
                w[0]++; w[1] += rssi; w[2] = w[0] === 1 ? rssi : Math.min(w[2], rssi);
                agora10[c] = (agora10[c] || []).filter(s => t - s[0] < 600000).concat([[t, rssi]]);
            }
            if (a.trafego?.ag) d.espera[c] = (d.espera[c] || 0) + 5;
            if (a.leds === "OBSTACULO" || a.trafego?.ob) d.obst[c] = (d.obst[c] || 0) + 5;
            sujo = true;
        });
        if (ativo.tipo) redesenharMapas();
    }
    // evento do Atta (script.js chama): tag não lida
    function evento(agvId, nome, mensagem) {
        if (nome !== "TAG_NAO_LIDA") return;
        const m = /Tag\s+([0-9A-F]{10})/i.exec(mensagem || "");
        const pl = typeof plantaPublicada === "function" ? plantaPublicada() : null;
        const achado = m && pl ? Planta.localizarRfid(pl, m[1]) : null;
        const id = achado?.no?.id || (agvs[agvId]?.pontoAtual) || "";
        if (!id) return;
        const d = dia();
        d.tags[id] = (d.tags[id] || 0) + 1;
        sujo = true;
    }

    // junta o período escolhido
    function agregado(tipo, periodo) {
        if (tipo === "wifi" && periodo === "agora") {
            const r = {}, t = Date.now();
            Object.entries(agora10).forEach(([c, l]) => { const v = l.filter(s => t - s[0] < 600000); if (v.length) r[c] = [v.length, v.reduce((s, x) => s + x[1], 0), Math.min(...v.map(x => x[1]))]; });
            return r;
        }
        const n = periodo === "7" ? 7 : periodo === "30" ? 30 : 1;
        const ds = Object.keys(dados.dias).sort().slice(-n);
        const r = {};
        ds.forEach(k => Object.entries(dados.dias[k][tipo] || {}).forEach(([c, v]) => {
            if (tipo === "wifi") { const w = r[c] || (r[c] = [0, 0, 0]); w[2] = w[0] ? Math.min(w[2], v[2]) : v[2]; w[0] += v[0]; w[1] += v[1]; }
            else r[c] = (r[c] || 0) + v;
        }));
        return r;
    }
    const corWifi = m => m >= -60 ? "#16A34A" : m >= -67 ? "#84CC16" : m >= -74 ? "#F59E0B" : m >= -80 ? "#EA580C" : "#DC2626";

    // desenha por cima do mapa (MapaSVG.sobreposicao)
    function desenhar(mapa, grupo, util) {
        if (!ativo.tipo) return;
        const { Y, px } = util;
        const agg = agregado(ativo.tipo, ativo.periodo);
        const el = MapaSVG.el;
        if (ativo.tipo === "tags") {
            const pl = mapa.planta;
            Object.entries(agg).forEach(([id, n]) => {
                const no = pl && Planta.noPorId(pl, id);
                if (!no) return;
                el("circle", { cx: no.x, cy: Y(no.y), r: px(10 + Math.min(20, n * 3)), fill: "#DC2626", "fill-opacity": 0.25, stroke: "#DC2626", "stroke-width": px(1.5), class: "camada-calor" }, grupo);
                const t = el("text", { x: no.x, y: Y(no.y) - px(16), "text-anchor": "middle", "font-size": px(11), "font-weight": 700, fill: "#B91C1C", "paint-order": "stroke", stroke: "#fff", "stroke-width": px(3) }, grupo);
                t.textContent = `${n}× não lida`;
            });
            return;
        }
        const max = Math.max(1, ...Object.values(agg).map(v => Array.isArray(v) ? 0 : v));
        Object.entries(agg).forEach(([c, v]) => {
            const [cx, cy] = c.split(",").map(Number);
            const x = cx * CELULA, y = cy * CELULA;
            let fill, op;
            if (ativo.tipo === "wifi") { fill = corWifi(v[1] / v[0]); op = 0.5; }
            else { const f = Math.min(1, v / max); fill = ativo.tipo === "espera" ? "#7C3AED" : "#EA580C"; op = 0.15 + 0.6 * f; }
            el("rect", { x, y: Y(y + CELULA), width: CELULA, height: CELULA, fill, "fill-opacity": op, class: "camada-calor" }, grupo)
                .appendChild(Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "title"), { textContent: ativo.tipo === "wifi" ? `${Math.round(v[1] / v[0])} dBm (pior ${v[2]}) · ${v[0]} amostras` : `${Math.round(v / 60)} min` }));
        });
    }

    // o botão e o painel, dentro do contêiner do mapa
    const mapas = new Set();
    function ligar(mapa) {
        if (!mapa || mapas.has(mapa)) return;
        mapas.add(mapa);
        const anterior = mapa.sobreposicao;
        mapa.sobreposicao = (m, g, u) => { if (typeof anterior === "function") anterior(m, g, u); desenhar(m, g, u); };
        const host = mapa.container;
        if (!host || host.querySelector(".camadas-botao")) return;
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        host.insertAdjacentHTML("beforeend", `<div class="camadas-ui"><button type="button" class="btn btn-mini camadas-botao" data-camadas="abrir" aria-expanded="false">Camadas</button><div class="camadas-painel" hidden></div></div>`);
    }
    function htmlPainel() {
        return `<div class="camadas-titulo">Mapa de calor</div>
            ${[["", "Nenhum", ""]].concat(Object.entries(TIPOS).map(([k, [n, d]]) => [k, n, d])).map(([k, n, d]) => `<label class="camadas-op"><input type="radio" name="camadaTipo" value="${k}" ${ativo.tipo === k ? "checked" : ""}><span>${esc(n)}${d ? `<small>${esc(d)}</small>` : ""}</span></label>`).join("")}
            <label class="camadas-periodo"><span>Período</span><select data-camadas="periodo">${[["agora", "Agora (10 min)"], ["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"]].map(([v, t]) => `<option value="${v}" ${ativo.periodo === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            ${ativo.tipo === "wifi" ? `<div class="camadas-legenda">${[[-55, "bom"], [-64, ""], [-71, ""], [-77, ""], [-85, "fraco"]].map(([v, t]) => `<span><i style="background:${corWifi(v)}"></i>${t}</span>`).join("")}</div>` : ""}
            <small class="suave">Juntado por este navegador com o site aberto. Paradas por causa: Indicadores › Paradas.</small>`;
    }
    function redesenharMapas() { mapas.forEach(m => { try { m.desenhar(); } catch (e) { /* mapa fora da tela */ } }); }

    document.addEventListener("click", e => {
        const b = e.target.closest("[data-camadas='abrir']");
        if (b) {
            const painel = b.parentElement.querySelector(".camadas-painel");
            const abrir = painel.hidden;
            document.querySelectorAll(".camadas-painel").forEach(p => { p.hidden = true; });
            painel.hidden = !abrir;
            b.setAttribute("aria-expanded", String(abrir));
            if (abrir) painel.innerHTML = htmlPainel();
            return;
        }
        if (!e.target.closest(".camadas-ui")) document.querySelectorAll(".camadas-painel").forEach(p => { p.hidden = true; });
    });
    document.addEventListener("change", e => {
        if (e.target.name === "camadaTipo") ativo.tipo = e.target.value;
        else if (e.target.dataset?.camadas === "periodo") ativo.periodo = e.target.value;
        else return;
        if (ativo.tipo === "wifi" && !["agora", "hoje", "7", "30"].includes(ativo.periodo)) ativo.periodo = "hoje";
        document.querySelectorAll(".camadas-painel:not([hidden])").forEach(p => { p.innerHTML = htmlPainel(); });
        document.querySelectorAll(".camadas-botao").forEach(btn => btn.classList.toggle("ativo", Boolean(ativo.tipo)));
        redesenharMapas();
    });

    setInterval(coletar, 5000);
    setInterval(() => { if (sujo) gravar(); }, 30000);
    window.addEventListener("beforeunload", () => { if (sujo) gravar(); });
    // liga nos mapas que existirem (Visão geral e editor)
    setInterval(() => {
        if (typeof mapaVisaoGeral !== "undefined" && mapaVisaoGeral) ligar(mapaVisaoGeral);
        if (window.EditorPlanta?._estado?.mapa) ligar(EditorPlanta._estado.mapa);
    }, 1500);

    return { ligar, coletar, evento, agregado, ativar: (tipo, periodo) => { ativo.tipo = tipo || ""; if (periodo) ativo.periodo = periodo; redesenharMapas(); }, dados: () => dados, TIPOS };
})();
if (typeof window !== "undefined") window.CamadasMapa = CamadasMapa;
