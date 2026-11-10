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
   - (0.21) Fita e piso: onde o Atta perdeu a fita (fita gasta, suja, emenda,
     piso molhado): manutenção da fita antes de parar a linha;
   - (0.21) Entrega por posto: tempo médio do pedido à entrega de cada posto
     hoje, no ponto do posto (verde até 10 min, âmbar até 20, vermelho acima).
   As paradas por causa e por ponto continuam em Indicadores › Paradas.
   (0.21) Na nuvem, a aba que despacha grava o dia a cada 5 min
   (public.camadas_mapa) e todas leem: não depende mais de um navegador só.
   (0.21) Fluxo do estudo: os trechos mais usados na simulação do Estudo
   de frota (quanto mais grosso e escuro, mais passagens no dia).
   Os dados são juntados por este navegador enquanto o site está aberto
   (a aba que despacha costuma ficar aberta o dia todo), em quadrados de
   1 m, guardados por 30 dias.
*/
const CamadasMapa = (function () {
    // 0.21.1: chave própria. Antes era "camadasMapa", a mesma das caixinhas de
    // Camadas da Visão geral: uma apagava a outra.
    const CHAVE = "camadasCalor", CHAVE_VELHA = "camadasMapa", CELULA = 1, DIAS = 30;
    const TIPOS = {
        wifi: ["Wi-Fi", "sinal medido pelos Atta"],
        espera: ["Espera no tráfego", "onde esperam passagem"],
        obst: ["Obstáculos", "onde param por algo na frente"],
        tags: ["Tags com problema", "tag que deveria ler e não leu"],
        fita: ["Fita e piso", "onde o Atta perdeu a fita (fita gasta, suja, piso)"],
        entrega: ["Entrega por posto", "tempo médio do pedido à entrega, hoje"],
        estudo: ["Fluxo do estudo", "trechos mais usados na simulação"]
    };
    // 0.21: o resultado do Estudo de frota (passagens por trecho num dia típico)
    let estudoDados = (() => { try { return JSON.parse(localStorage.getItem("camadaEstudo") || "null"); } catch (e) { return null; } })();
    function definirEstudo(R, nome) {
        const c = R?.recomendado || R?.cenarios?.[R.cenarios.length - 1];
        if (!c?.r) return;
        estudoDados = { nome: nome || "", frota: c.nome, passagens: c.r.passagens || {}, em: R.em };
        try { localStorage.setItem("camadaEstudo", JSON.stringify(estudoDados)); } catch (e) { /* ignora */ }
        if (ativo.tipo === "estudo") redesenharMapas();
    }
    let dados = ler(), ativo = { tipo: "", periodo: "hoje" }, sujo = false;
    const agora10 = {};   // wifi "agora": últimas amostras por célula (10 min)
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    function ler() {
        try {
            const novo = JSON.parse(localStorage.getItem(CHAVE) || "null");
            if (novo?.dias) return novo;
            // muda os dados do lugar antigo para o novo e devolve as caixinhas da Visão geral limpas
            const velho = JSON.parse(localStorage.getItem(CHAVE_VELHA) || "null");
            if (velho?.dias) {
                const { dias, ...caixinhas } = velho;
                localStorage.setItem(CHAVE, JSON.stringify({ dias }));
                localStorage.setItem(CHAVE_VELHA, JSON.stringify(caixinhas));
                return { dias };
            }
        } catch (e) { /* sem armazenamento */ }
        return { dias: {} };
    }
    function gravar() {
        const ds = Object.keys(dados.dias).sort();
        while (ds.length > DIAS) delete dados.dias[ds.shift()];
        try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) { /* cheio: fica na memória */ }
        sujo = false;
    }
    const hoje = () => (typeof Calendario !== "undefined" ? Calendario.local(Date.now()).data : new Date().toISOString().slice(0, 10));
    const dia = () => { const d = (dados.dias[hoje()] = dados.dias[hoje()] || { wifi: {}, espera: {}, obst: {}, tags: {}, fita: {} }); if (!d.fita) d.fita = {}; return d; };
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
    // evento do Atta (script.js chama): tag não lida, fita perdida
    function evento(agvId, nome, mensagem) {
        if (nome === "MISSAO_ERRO" && /linha perdida/i.test(mensagem || "")) {
            const a = typeof agvs !== "undefined" ? agvs[agvId] : null;
            const pose = a && typeof poseEstimadaAGV === "function" ? poseEstimadaAGV(a) : null;
            if (!pose || typeof pose.x !== "number") return;
            const d = dia(), c = celula(pose.x, pose.y);
            d.fita[c] = (d.fita[c] || 0) + 1;
            sujo = true;
            return;
        }
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
        const el = MapaSVG.el;
        if (ativo.tipo === "estudo") {
            const pl = mapa.planta;
            const pass = estudoDados?.passagens || {};
            const max = Math.max(1, ...Object.values(pass));
            Object.entries(pass).sort((a, b) => a[1] - b[1]).forEach(([id, n]) => {
                const sg = pl && Planta.segmentoPorId(pl, id);
                if (!sg) return;
                const pts = Planta.pontosSegmento(pl, sg);
                if (pts.length < 2) return;
                const f = n / max;
                el("polyline", { points: pts.map(q => `${q.x},${Y(q.y)}`).join(" "), fill: "none", stroke: f > 0.66 ? "#3B1F8C" : f > 0.33 ? "#6A3FB5" : "#A98BE0", "stroke-opacity": 0.35 + 0.5 * f,
                    "stroke-width": px(3 + 11 * f), "stroke-linecap": "round", class: "camada-calor" }, grupo)
                    .appendChild(Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "title"), { textContent: `${id}: ${Math.round(n)} passagens no dia` }));
            });
            return;
        }
        if (ativo.tipo === "entrega") {
            const pl = mapa.planta;
            const postos = typeof Despacho !== "undefined" && Despacho.postos ? Despacho.postos() : [];
            const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
            const conc = (typeof Despacho !== "undefined" ? Despacho.lista() : []).filter(x => x.estado === "concluido" && x.concluidoEm && x.criadoEm && x.concluidoEm >= inicio.getTime() && x.posto);
            postos.forEach(po => {
                const no = pl && Planta.noPorId(pl, po.ponto);
                const l = conc.filter(x => x.posto === po.id);
                if (!no || !l.length) return;
                const m = l.reduce((s2, x) => s2 + (x.concluidoEm - x.criadoEm), 0) / l.length / 60000;
                const cor = m <= 10 ? "#16A34A" : m <= 20 ? "#D97706" : "#DC2626";
                el("circle", { cx: no.x, cy: Y(no.y), r: px(16), fill: cor, "fill-opacity": 0.22, stroke: cor, "stroke-width": px(2), class: "camada-calor" }, grupo);
                const t = el("text", { x: no.x, y: Y(no.y) - px(20), "text-anchor": "middle", "font-size": px(11), "font-weight": 700, fill: cor, "paint-order": "stroke", stroke: "#fff", "stroke-width": px(3) }, grupo);
                t.textContent = `${po.nome || po.id}: ${m < 10 ? m.toFixed(1).replace(".", ",") : Math.round(m)} min · ${l.length}`;
            });
            return;
        }
        const agg = agregado(ativo.tipo, ativo.periodo);
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
            else { const f = Math.min(1, v / max); fill = ativo.tipo === "espera" ? "#7C3AED" : ativo.tipo === "fita" ? "#B45309" : "#EA580C"; op = 0.15 + 0.6 * f; }
            el("rect", { x, y: Y(y + CELULA), width: CELULA, height: CELULA, fill, "fill-opacity": op, class: "camada-calor" }, grupo)
                .appendChild(Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "title"), { textContent: ativo.tipo === "wifi" ? `${Math.round(v[1] / v[0])} dBm (pior ${v[2]}) · ${v[0]} amostras` : ativo.tipo === "fita" ? `${v}× perdeu a fita` : `${Math.round(v / 60)} min` }));
        });
    }

    // o botão e o painel, dentro do contêiner do mapa
    const mapas = new Set();
    const ICONE = `<svg class="icone icone-p" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3 4 6 6.5 6 10a6 6 0 0 1-12 0c0-2.4 1.4-3.8 2.2-5.6.8 1.4 1.6 2.1 2.6 2.1 0-2.4.4-4.4 1.2-6.5z"/></svg>`;
    function ligar(mapa) {
        if (!mapa || mapas.has(mapa)) return;
        mapas.add(mapa);
        const anterior = mapa.sobreposicao;
        mapa.sobreposicao = (m, g, u) => { if (typeof anterior === "function") anterior(m, g, u); desenhar(m, g, u); };
        const host = mapa.container;
        if (!host) return;
        // Visão geral: no cabeçalho do mapa, ao lado de "Camadas" (não cobre o mapa nem o 2D/3D)
        const ferramentas = host.closest("#visaoGeral")?.querySelector(".mapa-ferramentas");
        if (ferramentas) {
            if (ferramentas.querySelector(".camadas-botao")) return;
            ferramentas.insertAdjacentHTML("beforeend", `<div class="camadas-ui no-cabecalho"><button type="button" class="btn btn-mini camadas-botao" data-camadas="abrir" aria-expanded="false">${ICONE}Mapa de calor</button><div class="camadas-painel" hidden></div></div>`);
            return;
        }
        if (host.querySelector(".camadas-botao")) return;
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        host.insertAdjacentHTML("beforeend", `<div class="camadas-ui"><button type="button" class="btn btn-mini camadas-botao" data-camadas="abrir" aria-expanded="false">${ICONE}Mapa de calor</button><div class="camadas-painel" hidden></div></div>`);
    }
    // o mapa de calor só é desenhado na planta 2D: ao escolher uma camada, sai do 3D
    function para2D() {
        mapas.forEach(m => { const b = m.container?.querySelector('.mapa-modo [data-modo="2d"]'); if (b && !b.classList.contains("ativo")) b.click(); });
    }
    function htmlPainel() {
        return `<div class="camadas-titulo">Mapa de calor</div>
            ${[["", "Nenhum", ""]].concat(Object.entries(TIPOS).filter(([k]) => k !== "estudo" || estudoDados).map(([k, [n, d]]) => [k, n, k === "estudo" && estudoDados ? `${d}: ${estudoDados.nome} (${estudoDados.frota})` : d])).map(([k, n, d]) => `<label class="camadas-op"><input type="radio" name="camadaTipo" value="${k}" ${ativo.tipo === k ? "checked" : ""}><span>${esc(n)}${d ? `<small>${esc(d)}</small>` : ""}</span></label>`).join("")}
            ${ativo.tipo === "estudo" ? `<div class="camadas-legenda"><span><i style="background:#A98BE0"></i>pouco</span><span><i style="background:#6A3FB5"></i></span><span><i style="background:#3B1F8C"></i>muito usado</span></div>` : ""}
            <label class="camadas-periodo" ${["estudo", "entrega"].includes(ativo.tipo) ? "hidden" : ""}><span>Período</span><select data-camadas="periodo">${[["agora", "Agora (10 min)"], ["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"]].map(([v, t]) => `<option value="${v}" ${ativo.periodo === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            ${ativo.tipo === "wifi" ? `<div class="camadas-legenda">${[[-55, "bom"], [-64, ""], [-71, ""], [-77, ""], [-85, "fraco"]].map(([v, t]) => `<span><i style="background:${corWifi(v)}"></i>${t}</span>`).join("")}</div>` : ""}
            <small class="suave">${naNuvem() ? "Juntado pela aba que despacha e guardado na nuvem." : "Juntado por este navegador com o site aberto."} Aparece na planta 2D. Paradas por causa: Indicadores › Paradas.</small>`;
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
        if (e.target.name === "camadaTipo") { ativo.tipo = e.target.value; if (ativo.tipo) para2D(); }
        else if (e.target.dataset?.camadas === "periodo") ativo.periodo = e.target.value;
        else return;
        if (ativo.tipo === "wifi" && !["agora", "hoje", "7", "30"].includes(ativo.periodo)) ativo.periodo = "hoje";
        document.querySelectorAll(".camadas-painel:not([hidden])").forEach(p => { p.innerHTML = htmlPainel(); });
        document.querySelectorAll(".camadas-botao").forEach(btn => btn.classList.toggle("ativo", Boolean(ativo.tipo)));
        redesenharMapas();
    });

    /* ---------------- nuvem ---------------- */
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem && Nuvem.emNuvem());
    // junta um dia da nuvem com o deste navegador (fica o maior de cada quadrado)
    function juntarDia(local, nuvem) {
        const r = local || { wifi: {}, espera: {}, obst: {}, tags: {}, fita: {} };
        Object.keys(TIPOS).filter(t => !["estudo", "entrega"].includes(t)).forEach(t => {
            r[t] = r[t] || {};
            Object.entries(nuvem?.[t] || {}).forEach(([c, v]) => {
                const atual = r[t][c];
                if (t === "wifi") { if (!atual || (Array.isArray(v) && v[0] > atual[0])) r[t][c] = v; }
                else if (!(atual >= v)) r[t][c] = v;
            });
        });
        return r;
    }
    async function lerNuvem() {
        if (!naNuvem()) return;
        try {
            const desde = new Date(Date.now() - DIAS * 86400000).toISOString().slice(0, 10);
            const r = await Nuvem.cliente().from("camadas_mapa").select("dia, dados").eq("empresa_id", Nuvem.empresa().id).gte("dia", desde);
            if (r.error) return;
            (r.data || []).forEach(x => { dados.dias[x.dia] = juntarDia(dados.dias[x.dia], x.dados); });
            if (ativo.tipo) redesenharMapas();
        } catch (e) { /* sem nuvem agora */ }
    }
    async function gravarNuvem() {
        // só a aba que despacha (a líder) grava: é a que fica aberta o dia todo
        if (!naNuvem() || typeof Despacho === "undefined" || !Despacho.lider?.().eu || !Nuvem.pode("despachar")) return;
        try { await Nuvem.cliente().rpc("salvar_camadas_dia", { p_empresa: Nuvem.empresa().id, p_dia: hoje(), p_dados: dia() }); } catch (e) { /* tenta de novo */ }
    }
    setTimeout(lerNuvem, 4000);
    setInterval(() => { if (document.visibilityState === "visible") lerNuvem(); }, 10 * 60000);
    setInterval(gravarNuvem, 5 * 60000);

    setInterval(coletar, 5000);
    setInterval(() => { if (sujo) gravar(); }, 30000);
    window.addEventListener("beforeunload", () => { if (sujo) gravar(); });
    // liga nos mapas que existirem (Visão geral e editor)
    setInterval(() => {
        if (typeof mapaVisaoGeral !== "undefined" && mapaVisaoGeral) ligar(mapaVisaoGeral);
        if (window.EditorPlanta?._estado?.mapa) ligar(EditorPlanta._estado.mapa);
    }, 1500);

    return { ligar, coletar, evento, agregado, definirEstudo, estudo: () => estudoDados, juntarDia, lerNuvem, gravarNuvem,
        ativar: (tipo, periodo) => { ativo.tipo = tipo || ""; if (periodo) ativo.periodo = periodo; if (ativo.tipo) para2D(); document.querySelectorAll(".camadas-botao").forEach(btn => btn.classList.toggle("ativo", Boolean(ativo.tipo))); redesenharMapas(); }, dados: () => dados, TIPOS };
})();
if (typeof window !== "undefined") window.CamadasMapa = CamadasMapa;
