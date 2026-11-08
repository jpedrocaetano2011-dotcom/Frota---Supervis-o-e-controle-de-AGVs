/* ============================================================
   MAPA SVG — desenho da planta (editor, Visão Geral, Missões e
   AGV virtual)
   ============================================================
   Coordenadas do mundo em metros com y para cima. No SVG, y cresce
   para baixo: Y = altura - y. Os traços usam "non-scaling-stroke",
   então a espessura fica igual em qualquer zoom; símbolos (pontos,
   AGV, rótulos) são desenhados em pixels de tela com px().
   As cores vêm das variáveis CSS do tema (style.css).
*/

(function (raiz) {
    "use strict";

    const NS = "http://www.w3.org/2000/svg";
    const mapasCriados = new Set();
    let contadorMapas = 0;

    // Mantido por compatibilidade (o desenho usa o tema)
    const CORES_LAYOUT = {
        MAQUINA: {}, BANCADA: {}, PRATELEIRA: {}, PAREDE: {}, PILAR: {}, POSTO: {},
        CORREDOR: {}, ZONA_LENTA: {}, ZONA_PROIBIDA: {}
    };

    const CORES_ESTADO = {
        missao: "--accent", pronto: "--green", atencao: "--amber", falha: "--red",
        emergencia: "--red", offline: "--muted", manual: "--accent", virtual: "--purple", manutencao: "--muted"
    };

    function el(tag, atributos = {}, pai = null) {
        const e = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(atributos)) {
            if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
        }
        if (pai) pai.appendChild(e);
        return e;
    }

    function tema() {
        const css = getComputedStyle(document.documentElement);
        const v = nome => css.getPropertyValue(nome).trim();
        return {
            papel: v("--mapa-papel"), grade: v("--mapa-grade"), parede: v("--mapa-parede"), corredor: v("--mapa-corredor"),
            fita: v("--mapa-fita"), maquina: v("--mapa-maquina"), maquinaBorda: v("--mapa-maquina-borda"),
            maquinaTexto: v("--mapa-maquina-texto"), hachura: v("--mapa-hachura"), tag: v("--mapa-tag"),
            agv: v("--mapa-agv"), roda: v("--mapa-roda"), carga: v("--mapa-carga"),
            fitaMagnetica: v("--mapa-fita-magnetica") || v("--mapa-fita"), faixa: v("--mapa-faixa") || "#F2F4F7",
            card: v("--card"), borda: v("--border"), texto: v("--text"), muted: v("--muted"),
            accent: v("--accent"), accentSoft: v("--accent-soft"), green: v("--green"), greenSoft: v("--green-soft"),
            amber: v("--amber"), amberSoft: v("--amber-soft"), amberZona: v("--amber-zone"),
            red: v("--red"), redSoft: v("--red-soft"), purple: v("--purple"),
            css: v
        };
    }

    function corEstado(t, estado) {
        return t.css(CORES_ESTADO[estado] || "--accent") || t.accent;
    }

    function criar(container, opcoes = {}) {
        const id = "m" + (++contadorMapas);
        const svg = el("svg", { class: "mapa-svg", xmlns: NS });
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.style.display = "block";
        svg.style.touchAction = "none";
        container.innerHTML = "";
        container.appendChild(svg);

        const defs = el("defs", {}, svg);
        const camadas = {};
        ["fundo", "grade", "layout", "rota", "segmentos", "tags", "nos", "rastros", "agvs", "sobreposicao", "textos", "escala"].forEach(nome => {
            camadas[nome] = el("g", { class: "camada-" + nome }, svg);
        });

        const mapa = {
            id, svg, defs, camadas, container,
            planta: null,
            vista: { x: 0, y: 0, largura: 10, altura: 6 },
            opcoes: Object.assign({
                grade: true, rotulos: true, interativo: true, mostrarTags: true,
                rota: true, rastro: true, outros: true, editor: false
            }, opcoes),
            selecao: null,          // { tipo, id }
            destaques: new Set(),   // ids com erro de validacao
            rota: null,             // { trechos: [{origem,destino,tipo}], atual, distancia }
            destinos: new Set(),    // nos (acessos) de destino destacados
            agvs: [],               // [{ id, x, y, orientacao, estado, rotulo, destaque, estimado, carga, cone, giroAlvo }]
            rastros: {},            // id -> [{x,y}]
            sobreposicao: null,     // funcao(mapa, grupo, util) para o editor/virtual
            ajustado: false
        };

        mapa.Y = y => (mapa.planta ? mapa.planta.dimensoes.altura : 0) - y;

        mapa.pixelsPorMetro = () => {
            const r = svg.getBoundingClientRect();
            return r.width > 0 ? r.width / mapa.vista.largura : 60;
        };

        mapa.aplicarVista = () => {
            const r = svg.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) mapa.vista.altura = mapa.vista.largura * r.height / r.width;
            const v = mapa.vista;
            svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.largura} ${v.altura}`);
            desenharEscala(mapa);
        };

        mapa.ajustar = () => {
            if (!mapa.planta) return;
            const d = mapa.planta.dimensoes;
            const r = svg.getBoundingClientRect();
            const proporcaoTela = r.width > 0 && r.height > 0 ? r.height / r.width : 0.6;
            const margem = Math.max(0.3, Math.min(d.largura, d.altura) * 0.04);
            let largura = d.largura + margem * 2;
            if ((d.altura + margem * 2) / largura > proporcaoTela) largura = (d.altura + margem * 2) / proporcaoTela;
            mapa.vista.largura = largura;
            mapa.vista.altura = largura * proporcaoTela;
            mapa.vista.x = d.largura / 2 - largura / 2;
            mapa.vista.y = d.altura / 2 - mapa.vista.altura / 2;
            mapa.ajustado = r.width > 0;
            mapa.usuarioMexeu = false;
            mapa.desenhar();
        };

        mapa.paraMundo = evento => {
            const r = svg.getBoundingClientRect();
            const sx = mapa.vista.x + (evento.clientX - r.left) / r.width * mapa.vista.largura;
            const sy = mapa.vista.y + (evento.clientY - r.top) / r.height * mapa.vista.altura;
            return { x: sx, y: mapa.Y(sy) };
        };

        mapa.zoom = (fator, cx, cy) => {
            mapa.usuarioMexeu = true;
            const v = mapa.vista;
            const novaLargura = Math.max(0.5, Math.min(400, v.largura * fator));
            const f = novaLargura / v.largura;
            const px = cx === undefined ? v.x + v.largura / 2 : cx;
            const py = cy === undefined ? v.y + v.altura / 2 : cy;
            v.x = px - (px - v.x) * f;
            v.y = py - (py - v.y) * f;
            v.largura = novaLargura;
            v.altura *= f;
            mapa.desenhar();
        };

        mapa.definirPlanta = planta => {
            const primeira = !mapa.planta;
            mapa.planta = planta;
            if (primeira || !mapa.ajustado) mapa.ajustar();
            else mapa.desenhar();
        };

        mapa.desenhar = () => {
            desenhar(mapa);
            if (mapa.vista3d) mapa.vista3d.atualizar(mapa);
        };

        // Rastro: guarda as últimas posições por onde o AGV passou
        mapa.registrarRastro = (agvId, x, y) => {
            const lista = mapa.rastros[agvId] || (mapa.rastros[agvId] = []);
            const ultimo = lista[lista.length - 1];
            if (!ultimo || Math.hypot(ultimo.x - x, ultimo.y - y) > 0.04) {
                lista.push({ x, y });
                if (lista.length > 160) lista.shift();
            }
        };

        if (mapa.opcoes.interativo) instalarNavegacao(mapa);
        if (mapa.opcoes.tresD !== false && typeof Planta3D !== "undefined") instalarTresD(mapa);

        if (typeof ResizeObserver !== "undefined") {
            const observador = new ResizeObserver(() => {
                if (!mapa.ajustado || !mapa.usuarioMexeu) mapa.ajustar();
                else mapa.desenhar();
            });
            observador.observe(container);
        }
        mapasCriados.add(mapa);
        return mapa;
    }

    // 2D / 3D (0.16): o mesmo mapa em perspectiva. A escolha fica guardada por
    // mapa ("visao", "despacho"...); no computador a Visão geral abre em 3D.
    function instalarTresD(mapa) {
        const c = mapa.container;
        if (getComputedStyle(c).position === "static") c.style.position = "relative";
        const chave = "mapa3d:" + (mapa.opcoes.nome || "mapa");
        let salvo = null;
        try { salvo = localStorage.getItem(chave); } catch (e) { /* ignora */ }
        const toque = window.matchMedia?.("(pointer: coarse)")?.matches;
        const padrao = Boolean(mapa.opcoes.tresDPadrao) && !navigator.webdriver && !toque && Planta3D.suportado();
        const barra = document.createElement("div");
        barra.className = "mapa-modo";
        barra.innerHTML = `<button type="button" data-modo="2d" class="ativo" title="Planta 2D">2D</button><button type="button" data-modo="3d" title="Planta 3D (gêmeo digital)">3D</button>
            <span class="sep" hidden></span><button type="button" data-modo="iso" hidden title="Voltar à vista isométrica">Iso</button><button type="button" data-modo="girar" hidden title="Girar sozinho (apresentação)">Girar</button>`;
        c.appendChild(barra);
        let host = null;
        const marcar = tres => {
            barra.querySelector('[data-modo="2d"]').classList.toggle("ativo", !tres);
            barra.querySelector('[data-modo="3d"]').classList.toggle("ativo", tres);
            barra.querySelectorAll('[data-modo="iso"], [data-modo="girar"], .sep').forEach(b => { b.hidden = !tres; });
        };
        async function ligar(guardar) {
            if (host) return;
            marcar(true);
            host = document.createElement("div");
            host.className = "mapa3d-host";
            c.insertBefore(host, barra);
            if (guardar) try { localStorage.setItem(chave, "3d"); } catch (e) { /* ignora */ }
            try {
                const v = await Planta3D.criar(host, { aoClicar: mapa.opcoes.aoClicar3D, capturar: Boolean(window.ECITON_3D_CAPTURA) });
                if (!host) { v.destruir(); return; }
                mapa.vista3d = v;
                if (mapa.planta) v.atualizar(mapa);
            } catch (erro) {
                if (!host) return;
                host.innerHTML = `<div class="mapa3d-aviso"><div><b>Não deu para abrir o 3D.</b><br>${String(erro?.message || erro).replace(/[<>&]/g, "")}<br><br>A vista 3D baixa a biblioteca gráfica da internet na primeira vez. Volte ao 2D, ou tente de novo com internet.</div></div>`;
            }
        }
        function desligar(guardar) {
            marcar(false);
            if (mapa.vista3d) { mapa.vista3d.destruir(); mapa.vista3d = null; }
            if (host) { host.remove(); host = null; }
            if (guardar) try { localStorage.setItem(chave, "2d"); } catch (e) { /* ignora */ }
            if (!mapa.usuarioMexeu) mapa.ajustar(); else mapa.desenhar();
        }
        barra.addEventListener("click", ev => {
            const b = ev.target.closest("[data-modo]");
            if (!b) return;
            const m = b.dataset.modo;
            if (m === "3d") ligar(true);
            else if (m === "2d") desligar(true);
            else if (m === "iso" && mapa.vista3d) mapa.vista3d.vista("iso");
            else if (m === "girar" && mapa.vista3d) b.classList.toggle("ativo", mapa.vista3d.girar());
        });
        mapa.ligar3D = () => ligar(true);
        mapa.desligar3D = () => desligar(true);
        mapa.em3D = () => Boolean(host);
        if (salvo === "3d" || (salvo === null && padrao)) setTimeout(() => ligar(false), 0);
    }

    // Roda do mouse = zoom; arrastar o fundo (ou botão do meio) = mover a vista
    function instalarNavegacao(mapa) {
        const svg = mapa.svg;
        svg.addEventListener("wheel", evento => {
            if (mapa.opcoes.zoomRoda === false) return;
            evento.preventDefault();
            const r = svg.getBoundingClientRect();
            const cx = mapa.vista.x + (evento.clientX - r.left) / r.width * mapa.vista.largura;
            const cy = mapa.vista.y + (evento.clientY - r.top) / r.height * mapa.vista.altura;
            mapa.zoom(evento.deltaY > 0 ? 1.15 : 1 / 1.15, cx, cy);
        }, { passive: false });

        let arraste = null;
        svg.addEventListener("pointerdown", evento => {
            const alvoFundo = !evento.target.closest("[data-tipo]");
            const podePan = evento.button === 1 || (evento.button === 0 && alvoFundo && mapa.permitePan !== false &&
                            (!mapa.ferramentaAtiva || mapa.ferramentaAtiva() === "SELECIONAR"));
            if (!podePan) return;
            arraste = { x: evento.clientX, y: evento.clientY, vx: mapa.vista.x, vy: mapa.vista.y, moveu: false };
            svg.setPointerCapture(evento.pointerId);
        });
        svg.addEventListener("pointermove", evento => {
            if (!arraste) return;
            const r = svg.getBoundingClientRect();
            const dx = (evento.clientX - arraste.x) / r.width * mapa.vista.largura;
            const dy = (evento.clientY - arraste.y) / r.height * mapa.vista.altura;
            if (Math.abs(evento.clientX - arraste.x) + Math.abs(evento.clientY - arraste.y) > 3) arraste.moveu = true;
            mapa.vista.x = arraste.vx - dx;
            mapa.vista.y = arraste.vy - dy;
            if (arraste.moveu) mapa.usuarioMexeu = true;
            mapa.aplicarVista();
        });
        const terminar = evento => {
            if (!arraste) return;
            mapa.ultimoArrasteMoveu = arraste.moveu;
            arraste = null;
            try { svg.releasePointerCapture(evento.pointerId); } catch (e) { /* ignora */ }
        };
        svg.addEventListener("pointerup", terminar);
        svg.addEventListener("pointercancel", terminar);
    }

    function limpar(grupo) {
        while (grupo.firstChild) grupo.removeChild(grupo.firstChild);
    }

    function texto(grupo, x, y, conteudo, tamanho, atributos = {}) {
        const t = el("text", Object.assign({
            x, y, "font-size": tamanho,
            "font-family": "IBM Plex Sans, system-ui, sans-serif",
            "text-anchor": "middle", "dominant-baseline": "central",
            "pointer-events": "none"
        }, atributos), grupo);
        t.textContent = conteudo;
        return t;
    }

    // Rótulo em "pílula": fundo arredondado com texto
    function pilula(grupo, x, y, conteudo, px, estilo = {}) {
        const tamanho = px(estilo.tamanho || 11.5);
        const largura = Math.max(px(24), conteudo.length * tamanho * (estilo.mono ? 0.62 : 0.56) + px(16));
        const altura = px(estilo.altura || 20);
        const ancora = estilo.ancora || "meio";
        const x0 = ancora === "esquerda" ? x : ancora === "direita" ? x - largura : x - largura / 2;
        const g = el("g", { "pointer-events": "none" }, grupo);
        el("rect", {
            x: x0, y: y - altura / 2, width: largura, height: altura, rx: estilo.raio !== undefined ? px(estilo.raio) : altura / 2,
            fill: estilo.fundo, stroke: estilo.borda || "none", "stroke-width": 1, "vector-effect": "non-scaling-stroke"
        }, g);
        texto(g, x0 + largura / 2, y, conteudo, tamanho, {
            fill: estilo.cor, "font-weight": 600,
            "font-family": estilo.mono ? "IBM Plex Mono, ui-monospace, monospace" : "IBM Plex Sans, system-ui, sans-serif"
        });
        return { largura, altura };
    }

    function garantirPadroes(mapa, t) {
        const chave = t.hachura + t.red;
        if (mapa.defs.dataset.chave === chave) return;
        mapa.defs.dataset.chave = chave;
        limpar(mapa.defs);
        const h = el("pattern", { id: mapa.id + "hach", width: 0.16, height: 0.16, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, mapa.defs);
        el("line", { x1: 0, y1: 0, x2: 0, y2: 0.16, stroke: t.hachura, "stroke-width": 0.05 }, h);
        const p = el("pattern", { id: mapa.id + "proib", width: 0.2, height: 0.2, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, mapa.defs);
        el("rect", { width: 0.2, height: 0.2, fill: t.redSoft }, p);
        el("line", { x1: 0, y1: 0, x2: 0, y2: 0.2, stroke: t.red, "stroke-opacity": 0.5, "stroke-width": 0.04 }, p);
        // 0.16: área livre (amarelo listrado) e cruzamento com empilhadeira (preto e amarelo)
        const l = el("pattern", { id: mapa.id + "livre", width: 0.3, height: 0.3, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, mapa.defs);
        el("line", { x1: 0, y1: 0, x2: 0, y2: 0.3, stroke: t.amber, "stroke-opacity": 0.55, "stroke-width": 0.06 }, l);
        const e = el("pattern", { id: mapa.id + "empi", width: 0.5, height: 0.5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, mapa.defs);
        el("rect", { width: 0.25, height: 0.5, fill: t.amber, opacity: 0.75 }, e);
        el("rect", { x: 0.25, width: 0.25, height: 0.5, fill: t.parede, opacity: 0.55 }, e);
    }

    // Símbolo 2D de cada objeto da biblioteca (0.16). Desenha dentro de "g"
    // (já transladado e girado); devolve a cor do rótulo.
    function simboloLayout(mapa, g, o, t, px, base, destaque) {
        const w = o.largura, h = o.profundidade, x0 = -w / 2, y0 = -h / 2;
        const r = (extra) => el("rect", Object.assign({}, base, extra, destaque), g);
        const linha = (x1, y1, x2, y2, extra = {}) => el("line", Object.assign({ x1, y1, x2, y2, stroke: t.maquinaBorda, "stroke-width": 1, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, extra), g);
        const maquina = () => {
            r({ fill: `url(#${mapa.id}hach)`, stroke: t.maquinaBorda, "stroke-width": 1.5, rx: px(4) });
            el("rect", Object.assign({}, base, { fill: t.maquina, opacity: 0.65, stroke: "none", rx: px(4), "pointer-events": "none" }), g);
        };
        switch (o.tipo) {
            case "CORREDOR":
                r({ fill: t.corredor, stroke: mapa.opcoes.editor ? t.borda : "none", "stroke-dasharray": mapa.opcoes.editor ? "6 4" : null });
                return t.muted;
            case "ZONA_LENTA":
                r({ fill: t.amberZona, stroke: t.amber, "stroke-width": 1.5, "stroke-dasharray": "6 4" });
                return t.amber;
            case "ZONA_PROIBIDA":
                r({ fill: `url(#${mapa.id}proib)`, stroke: t.red, "stroke-width": 1.5, "stroke-dasharray": "6 4" });
                return t.red;
            case "AREA_LIVRE":
                r({ fill: `url(#${mapa.id}livre)`, stroke: t.amber, "stroke-width": 1.5 });
                return t.amber;
            case "CRUZAMENTO_EMPILHADEIRA":
                r({ fill: t.amberZona, stroke: t.amber, "stroke-width": 1.5 });
                el("rect", { x: x0, y: y0, width: w, height: h, fill: "none", stroke: `url(#${mapa.id}empi)`, "stroke-width": Math.min(0.3, Math.min(w, h) * 0.15), "pointer-events": "none" }, g);
                return t.amber;
            case "FAIXA_PEDESTRE": {
                // listras na direção em que o Atta anda (largura), uma atrás da outra na direção de quem atravessa
                r({ fill: t.corredor || t.papel, stroke: mapa.opcoes.editor ? t.borda : "none", "stroke-dasharray": "4 4" });
                const n = Math.max(2, Math.round(h / 0.5));
                for (let i = 0; i < n; i++) {
                    el("rect", { x: x0 + w * 0.06, y: y0 + h * (i + 0.15) / n, width: w * 0.88, height: h * 0.55 / n, fill: t.faixa, stroke: t.maquinaBorda, "stroke-width": 0.6, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, g);
                }
                return t.muted;
            }
            case "PAREDE": case "PILAR":
                r({ fill: t.parede, stroke: t.parede });
                return t.papel;
            case "GRADE":
                r({ fill: t.papel, stroke: t.parede, "stroke-width": 2, "stroke-dasharray": "3 3" });
                return t.parede;
            case "PORTA": case "PORTAO": {
                r({ fill: t.papel, stroke: t.parede, "stroke-width": 1.2, "stroke-dasharray": o.tipo === "PORTAO" ? "8 4" : null });
                if (o.tipo === "PORTA") el("path", { d: `M${x0},${y0} A${w},${w} 0 0 1 ${x0 + w},${y0 + w}`, fill: "none", stroke: t.muted, "stroke-width": 1, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, g);
                return t.muted;
            }
            case "PRATELEIRA": case "PORTA_PALETE": case "FLOW_RACK": {
                r({ fill: t.maquina, stroke: t.maquinaBorda, "stroke-width": 1.5 });
                const vaos = Math.max(1, Math.round(w / (o.tipo === "PORTA_PALETE" ? 1.35 : 1)));
                for (let i = 1; i < vaos; i++) linha(x0 + w * i / vaos, y0, x0 + w * i / vaos, y0 + h);
                if (o.tipo === "FLOW_RACK") for (let i = 1; i < 4; i++) linha(x0, y0 + h * i / 4, x0 + w, y0 + h * i / 4, { "stroke-dasharray": "2 3" });
                return t.maquinaTexto;
            }
            case "PALETE": case "CAIXAS":
                r({ fill: t.carga || t.maquina, stroke: t.maquinaBorda, "stroke-width": 1.2, rx: px(2) });
                linha(x0, y0, x0 + w, y0 + h); linha(x0 + w, y0, x0, y0 + h);
                return t.maquinaTexto;
            case "ESTEIRA": {
                r({ fill: t.maquina, stroke: t.maquinaBorda, "stroke-width": 1.5, rx: px(2) });
                const rolos = Math.max(3, Math.round(w / 0.15));
                for (let i = 1; i < rolos; i++) linha(x0 + w * i / rolos, y0 + h * 0.12, x0 + w * i / rolos, y0 + h * 0.88, { opacity: 0.6 });
                return t.maquinaTexto;
            }
            case "CELULA_ROBO":
                maquina();
                el("circle", { r: Math.min(w, h) * 0.38, fill: "none", stroke: t.maquinaBorda, "stroke-width": 1, "stroke-dasharray": "4 3", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, g);
                el("circle", { r: Math.min(w, h) * 0.08, fill: t.maquinaBorda, "pointer-events": "none" }, g);
                return t.maquinaTexto;
            case "POSTO":
                r({ fill: t.greenSoft, stroke: t.green, "stroke-width": 1.5, rx: px(4) });
                return t.green;
            case "CARREGADOR":
                r({ fill: t.css("--purple-soft") || t.card, stroke: t.purple || t.accent, "stroke-width": 1.5, rx: px(2) });
                return t.purple || t.accent;
            case "DOCA":
                r({ fill: t.corredor || t.papel, stroke: t.parede, "stroke-width": 1.5, "stroke-dasharray": "6 3" });
                return t.muted;
            case "ESCRITORIO":
                r({ fill: t.card, stroke: t.parede, "stroke-width": 2 });
                return t.muted;
            case "PESSOA":
                el("circle", { r: Math.min(w, h) * 0.5, fill: t.amberSoft, stroke: t.amber, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }, g);
                return t.amber;
            case "EMPILHADEIRA":
                r({ fill: t.amberSoft, stroke: t.amber, "stroke-width": 1.5, rx: px(3) });
                linha(x0 + w, y0 + h * 0.25, x0 + w + w * 0.45, y0 + h * 0.25, { stroke: t.amber, "stroke-width": 2 });
                linha(x0 + w, y0 + h * 0.75, x0 + w + w * 0.45, y0 + h * 0.75, { stroke: t.amber, "stroke-width": 2 });
                return t.amber;
            case "MAQUINA": case "CNC": case "TORNO": case "PRENSA": case "INJETORA": case "SOLDA": case "INSPECAO":
                maquina();
                return t.maquinaTexto;
            default:
                r({ fill: t.maquina, stroke: t.maquinaBorda, "stroke-width": 1.5, rx: px(3) });
                return t.maquinaTexto;
        }
    }

    function nomeCurtoNo(planta, no, curto) {
        if (no.tipo === "ESTACAO" && typeof Planta !== "undefined" && Planta.estacaoDoNo) {
            const estacao = Planta.estacaoDoNo(planta, no);
            if (estacao) {
                if (curto) return no.nome ? `${estacao.id} · ${no.nome}` : estacao.id;
                const base = estacao.nome ? `${estacao.id} · ${estacao.nome}` : estacao.id;
                return no.nome ? `${base} · ${no.nome}` : base;
            }
        }
        if (curto) return no.id;
        return no.nome ? `${no.id} · ${no.nome}` : no.id;
    }

    function desenharEscala(mapa) {
        const g = mapa.camadas.escala;
        limpar(g);
        if (!mapa.planta || mapa.opcoes.escala === false) return;
        const ppm = mapa.pixelsPorMetro();
        if (!(ppm > 0)) return;
        const px = n => n / ppm;
        const t = mapa._tema || tema();
        const passos = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
        let metros = passos[0];
        for (const p of passos) if (p * ppm <= 110) metros = p;
        const v = mapa.vista;
        const x0 = v.x + px(18), y0 = v.y + v.altura - px(18);
        el("path", {
            d: `M${x0},${y0}h${metros}M${x0},${y0 - px(5)}v${px(10)}M${x0 + metros},${y0 - px(5)}v${px(10)}`,
            stroke: t.muted, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", fill: "none", "pointer-events": "none"
        }, g);
        texto(g, x0 + metros + px(8), y0, `${String(metros).replace(".", ",")} m`, px(11), {
            fill: t.muted, "text-anchor": "start", "font-family": "IBM Plex Mono, monospace"
        });
    }

    function desenhar(mapa) {
        const p = mapa.planta;
        const c = mapa.camadas;
        Object.values(c).forEach(limpar);
        const t = tema();
        mapa._tema = t;
        garantirPadroes(mapa, t);
        mapa.aplicarVista();
        if (!p) return;

        const H = p.dimensoes.altura;
        const W = p.dimensoes.largura;
        const Y = y => H - y;
        const ppm = mapa.pixelsPorMetro();
        const px = n => n / ppm;
        const fonte = px(11.5);
        const editor = mapa.opcoes.editor;
        mapa.svg.style.background = t.papel;

        // ---------- fundo ----------
        el("rect", { x: mapa.vista.x - 50, y: mapa.vista.y - 50, width: mapa.vista.largura + 100, height: mapa.vista.altura + 100, fill: t.papel }, c.fundo);
        if (p.fundo && p.fundo.imagem) {
            const f = p.fundo;
            el("image", {
                href: f.imagem, x: f.x, y: Y(f.y + f.altura), width: f.largura, height: f.altura,
                opacity: f.opacidade ?? 0.5, preserveAspectRatio: "none", "pointer-events": "none"
            }, c.fundo);
        }

        // ---------- grade ----------
        if (mapa.opcoes.grade) {
            let passo = p.grade || 0.5;
            while (passo * ppm < 18) passo *= 2;
            const caminho = [];
            for (let x = 0; x <= W + 1e-9; x += passo) caminho.push(`M${x},0V${H}`);
            for (let y = 0; y <= H + 1e-9; y += passo) caminho.push(`M0,${Y(y)}H${W}`);
            el("path", { d: caminho.join(""), stroke: t.grade, "stroke-width": 1, "vector-effect": "non-scaling-stroke", fill: "none", "pointer-events": "none" }, c.grade);
            if (editor) {
                const passoRotulo = passo * ppm < 40 ? Math.ceil(40 / ppm) : Math.max(1, Math.round(passo));
                for (let x = 0; x <= W + 1e-9; x += passoRotulo) texto(c.grade, x, H + px(10), `${Planta.arred(x, 1)}`, px(9.5), { fill: t.muted, "font-family": "IBM Plex Mono, monospace" });
                for (let y = 0; y <= H + 1e-9; y += passoRotulo) texto(c.grade, -px(13), Y(y), `${Planta.arred(y, 1)}`, px(9.5), { fill: t.muted, "font-family": "IBM Plex Mono, monospace" });
            }
        }
        // contorno do galpão
        el("rect", { x: 0, y: 0, width: W, height: H, fill: "none", stroke: t.parede, "stroke-width": editor ? 2 : 4, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, c.grade);

        // ---------- layout ----------
        const ordemLayout = { CORREDOR: 0, ZONA_LENTA: 1, ZONA_PROIBIDA: 1, AREA_LIVRE: 1, FAIXA_PEDESTRE: 1, CRUZAMENTO_EMPILHADEIRA: 1, DOCA: 1 };
        [...p.layout].sort((a, b) => (ordemLayout[a.tipo] ?? 2) - (ordemLayout[b.tipo] ?? 2)).forEach(o => {
            const g = el("g", { transform: `translate(${o.x},${Y(o.y)}) rotate(${-(o.rotacao || 0)})`, "data-tipo": "layout", "data-id": o.id }, c.layout);
            const selecionado = mapa.selecao?.tipo === "layout" && mapa.selecao.id === o.id;
            const base = { x: -o.largura / 2, y: -o.profundidade / 2, width: o.largura, height: o.profundidade, "vector-effect": "non-scaling-stroke" };
            const destaque = selecionado ? { stroke: t.accent, "stroke-width": 2.5 } : {};
            const corTexto = simboloLayout(mapa, g, o, t, px, base, destaque);
            if (mapa.opcoes.rotulos && Math.min(o.largura, o.profundidade) * ppm > 16) {
                const tipoInfo = Planta.TIPOS_LAYOUT[o.tipo];
                let rotulo = o.nome || (["CNC", "TORNO", "PRENSA", "INJETORA", "CELULA_ROBO", "SOLDA", "ESTEIRA", "FAIXA_PEDESTRE", "CRUZAMENTO_EMPILHADEIRA", "AREA_LIVRE"].includes(o.tipo) ? (tipoInfo?.nome || "") : "");
                if (o.tipo === "ZONA_LENTA") rotulo = `${(o.nome || "ZONA LENTA").toUpperCase()}${o.velocidadeMaxima ? " · " + String(o.velocidadeMaxima).replace(".", ",") + " m/s" : ""}`;
                if (rotulo) {
                    const tam = Math.min(px(13), o.profundidade * 0.42, o.largura / Math.max(4, rotulo.length) * 1.7);
                    texto(c.textos, o.x, Y(o.y), rotulo, tam, { fill: corTexto, "font-weight": 600 });
                }
            }
        });

        // ---------- rota ----------
        const pontoNo = id => Planta.noPorId(p, id);
        if (mapa.opcoes.rota && mapa.rota && Array.isArray(mapa.rota.trechos) && mapa.rota.trechos.length) {
            const trechos = mapa.rota.trechos;
            const atual = Number.isInteger(mapa.rota.atual) ? mapa.rota.atual : null;
            const todos = [];
            trechos.forEach(tr => {
                const a = pontoNo(tr.origem), b = pontoNo(tr.destino);
                if (!a || !b) return;
                // curva (0.16): pontos intermediários do arco
                const sg = tr.tipo === "CURVA" ? (Planta.segmentoPorId(p, tr.segmento) || p.segmentos.find(x => x.tipo === "CURVA" && ((x.a === a.id && x.b === b.id) || (x.a === b.id && x.b === a.id)))) : null;
                const meio = sg ? Planta.pontosSegmento(p, sg, 0.25).slice(1, -1) : [];
                todos.push([a, b, sg && sg.a !== a.id ? meio.reverse() : meio]);
            });
            const caminho = lista => lista.map(([a, b, meio], i) => `${i === 0 ? `M${a.x},${Y(a.y)}` : ""}${(meio || []).map(q => `L${q.x},${Y(q.y)}`).join("")}L${b.x},${Y(b.y)}`).join("");
            el("path", {
                d: caminho(todos), fill: "none", stroke: t.accent, "stroke-opacity": 0.18, "stroke-width": 16,
                "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none"
            }, c.rota);
            // parte que falta: do AGV (ou do trecho atual) até o fim
            let restante = todos;
            if (atual !== null) {
                restante = todos.slice(atual);
                const pos = mapa.rota.posicao;
                if (restante.length && pos) restante = [[{ x: pos.x, y: pos.y }, restante[0][1], []], ...restante.slice(1)];
            }
            if (restante.length) {
                el("path", {
                    d: caminho(restante), fill: "none", stroke: t.accent, "stroke-width": 4,
                    "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none"
                }, c.rota);
            }
        }

        // ---------- segmentos ----------
        const tipoSeg = s => (Planta.tipoSegmento ? Planta.tipoSegmento(s) : "LINHA");
        // Curva (0.16): arco de circunferência, com as setas e as tags ao longo dele
        function desenharCurva(s, a, b, selecionado, comErro, corGuia, guia) {
            const geo = Planta.geometriaCurva(p, s);
            if (!geo) return;
            const g = el("g", { "data-tipo": "segmento", "data-id": s.id }, c.segmentos);
            // no SVG o y é para baixo: o anti-horário do mapa vira horário na tela (sweep 1)
            const d = `M${a.x},${Y(a.y)}A${geo.R},${geo.R} 0 0 ${geo.esq ? 0 : 1} ${b.x},${Y(b.y)}`;
            el("path", { d, fill: "none", stroke: "transparent", "stroke-width": 16, "vector-effect": "non-scaling-stroke" }, g);
            const cor = comErro ? t.red : selecionado ? t.accent : corGuia;
            el("path", { d, fill: "none", stroke: cor, "stroke-width": guia === "VIRTUAL" ? 2.5 : (selecionado ? 5 : 4), "stroke-linecap": "round",
                "stroke-dasharray": guia === "VIRTUAL" ? "8 6" : null, "vector-effect": "non-scaling-stroke" }, g);
            const L = geo.comprimento;
            if (s.sentido !== "DUPLO" && L * ppm > 30) {
                const m = Planta.pontoNoSegmento(p, s, s.a, L / 2);
                const angulo = m.rumo * Math.PI / 180 + (s.sentido === "B_PARA_A" ? Math.PI : 0);
                const tam = px(7);
                const pts = [0, 2.5, -2.5].map(k => [m.x + Math.cos(angulo + k) * tam, m.y + Math.sin(angulo + k) * tam]).map(([x, y]) => `${x},${Y(y)}`).join(" ");
                el("polygon", { points: pts, fill: cor, "pointer-events": "none" }, g);
            }
            if (mapa.opcoes.mostrarTags) {
                (s.tags || []).forEach((tag, i) => {
                    const q = Planta.pontoNoSegmento(p, s, s.a, tag.distancia);
                    const r = px(5.5);
                    el("rect", { x: q.x - r, y: Y(q.y) - r, width: r * 2, height: r * 2, transform: `rotate(45 ${q.x} ${Y(q.y)})`,
                        fill: tag.rfid ? t.tag : t.papel, stroke: tag.rfid ? t.papel : t.tag, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
                        "data-tipo": "tag", "data-id": s.id, "data-indice": i }, c.tags);
                });
            }
            if (mapa.opcoes.rotulos && selecionado) {
                const m = Planta.pontoNoSegmento(p, s, s.a, L / 2);
                pilula(c.textos, m.x, Y(m.y) - px(16), `${s.id} · curva R ${Planta.arred(geo.R, 2)} m · ${Planta.arred(L, 2)} m`, px, {
                    fundo: t.accentSoft, borda: t.accent, cor: t.accent, tamanho: 10.5, altura: 18
                });
            }
        }
        p.segmentos.forEach(s => {
            const a = pontoNo(s.a), b = pontoNo(s.b);
            if (!a || !b) return;
            const selecionado = mapa.selecao?.tipo === "segmento" && mapa.selecao.id === s.id;
            const comErro = mapa.destaques.has(s.id);
            const lateral = tipoSeg(s) === "LATERAL";
            const guia = Planta.guiaSegmento ? Planta.guiaSegmento(p, s) : "OPTICA";
            const corGuia = guia === "MAGNETICA" ? t.fitaMagnetica : guia === "VIRTUAL" ? (t.purple || t.accent) : t.fita;
            if (tipoSeg(s) === "CURVA") { desenharCurva(s, a, b, selecionado, comErro, corGuia, guia); return; }
            // segmentos gêmeos (ida e volta nos mesmos pontos): afasta um do outro
            let desloc = 0;
            const gemeo = Planta.segmentoGemeo ? Planta.segmentoGemeo(p, s) : null;
            if (gemeo) desloc = (s.id < gemeo.id ? 1 : -1) * px(5);
            const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const nx = -(b.y - a.y) / L * desloc, ny = (b.x - a.x) / L * desloc;
            const x1 = a.x + nx, y1 = a.y + ny, x2 = b.x + nx, y2 = b.y + ny;

            const g = el("g", { "data-tipo": "segmento", "data-id": s.id }, c.segmentos);
            el("line", { x1, y1: Y(y1), x2, y2: Y(y2), stroke: "transparent", "stroke-width": 16, "vector-effect": "non-scaling-stroke" }, g);
            const cor = comErro ? t.red : selecionado ? t.accent : corGuia;
            el("line", {
                x1, y1: Y(y1), x2, y2: Y(y2), stroke: cor,
                "stroke-width": lateral ? 2.5 : guia === "VIRTUAL" ? 2.5 : (selecionado ? 5 : 4), "stroke-linecap": "round", "vector-effect": "non-scaling-stroke",
                "stroke-dasharray": lateral ? "2 6" : guia === "VIRTUAL" ? "8 6" : null, opacity: lateral ? 0.85 : 1
            }, g);
            const ang = Math.atan2(y2 - y1, x2 - x1);
            const triangulo = (mx, my, angulo, tamanho) => {
                const pts = [
                    [mx + Math.cos(angulo) * tamanho, my + Math.sin(angulo) * tamanho],
                    [mx + Math.cos(angulo + 2.5) * tamanho, my + Math.sin(angulo + 2.5) * tamanho],
                    [mx + Math.cos(angulo - 2.5) * tamanho, my + Math.sin(angulo - 2.5) * tamanho]
                ].map(([x, y]) => `${x},${Y(y)}`).join(" ");
                el("polygon", { points: pts, fill: cor, "pointer-events": "none" }, g);
            };
            if (lateral) {
                // setas duplas: anda de lado nos dois sentidos (ou só um)
                const ida = s.sentido !== "B_PARA_A", volta = s.sentido !== "A_PARA_B";
                const f1 = 0.5 + Math.min(0.35, px(10) / L), f2 = 0.5 - Math.min(0.35, px(10) / L);
                if (ida) triangulo(x1 + (x2 - x1) * f1, y1 + (y2 - y1) * f1, ang, px(6));
                if (volta) triangulo(x1 + (x2 - x1) * f2, y1 + (y2 - y1) * f2, ang + Math.PI, px(6));
            } else if (s.sentido !== "DUPLO" && L * ppm > 30) {
                const angulo = s.sentido === "A_PARA_B" ? ang : ang + Math.PI;
                const quantos = L * ppm > 260 ? 2 : 1;
                for (let k = 1; k <= quantos; k++) {
                    const f = k / (quantos + 1);
                    triangulo(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, angulo, px(7));
                }
            }
            if (mapa.opcoes.mostrarTags && !lateral) {
                (s.tags || []).forEach((tag, i) => {
                    const f = tag.distancia / L;
                    const x = x1 + (x2 - x1) * f, y = y1 + (y2 - y1) * f;
                    const r = px(5.5);
                    const selTag = selecionado && mapa.selecao.tag === i;
                    el("rect", {
                        x: x - r, y: Y(y) - r, width: r * 2, height: r * 2, transform: `rotate(45 ${x} ${Y(y)})`,
                        fill: tag.rfid ? t.tag : t.papel, stroke: selTag ? t.accent : (tag.rfid ? t.papel : t.tag),
                        "stroke-width": selTag ? 2.5 : 1.5, "vector-effect": "non-scaling-stroke",
                        "data-tipo": "tag", "data-id": s.id, "data-indice": i
                    }, c.tags);
                });
            }
            if (mapa.opcoes.rotulos && (selecionado || (editor && lateral && ppm > 70))) {
                const rotulo = lateral ? `${s.id} · lateral ${Planta.arred(L, 2)} m` : `${s.id} · ${Planta.arred(L, 2)} m`;
                pilula(c.textos, (x1 + x2) / 2, Y((y1 + y2) / 2) - px(16), rotulo, px, {
                    fundo: selecionado ? t.accentSoft : t.card, borda: selecionado ? t.accent : t.borda, cor: selecionado ? t.accent : t.muted, tamanho: 10.5, altura: 18
                });
            }
        });

        // ---------- nós ----------
        const destinos = mapa.destinos instanceof Set ? mapa.destinos : new Set(mapa.destinos || []);
        p.nos.forEach(no => {
            const selecionado = mapa.selecao?.tipo === "no" && mapa.selecao.id === no.id;
            const comErro = mapa.destaques.has(no.id);
            const destino = destinos.has(no.id);
            const g = el("g", { "data-tipo": "no", "data-id": no.id, transform: `translate(${no.x},${Y(no.y)})` }, c.nos);
            el("circle", { r: px(14), fill: "transparent" }, g);
            const contorno = comErro ? t.red : selecionado ? t.accent : null;
            if (no.tipo === "ESTACAO") {
                const r = px(11);
                el("rect", {
                    x: -r, y: -r, width: r * 2, height: r * 2, rx: px(4),
                    fill: destino ? t.accentSoft : t.greenSoft, stroke: contorno || (destino ? t.accent : t.green),
                    "stroke-width": destino || selecionado ? 3 : 2.5, "vector-effect": "non-scaling-stroke"
                }, g);
                if (no.orientacaoChegada !== null && no.orientacaoChegada !== undefined) {
                    const angulo = no.orientacaoChegada * Math.PI / 180;
                    const inicio = px(13), fim = px(26), cab = px(6);
                    const cor = destino ? t.accent : t.green;
                    const fx = Math.cos(angulo) * fim, fy = -Math.sin(angulo) * fim;
                    el("line", { x1: Math.cos(angulo) * inicio, y1: -Math.sin(angulo) * inicio, x2: fx, y2: fy, stroke: cor, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, g);
                    const ponta = [
                        [fx + Math.cos(angulo) * cab, fy - Math.sin(angulo) * cab],
                        [fx + Math.cos(angulo + 2.2) * cab * 0.9, fy - Math.sin(angulo + 2.2) * cab * 0.9],
                        [fx + Math.cos(angulo - 2.2) * cab * 0.9, fy - Math.sin(angulo - 2.2) * cab * 0.9]
                    ];
                    el("polygon", { points: ponta.map(q => q.join(",")).join(" "), fill: cor, "pointer-events": "none" }, g);
                }
            } else if (no.tipo === "BERCO") {
                // casinha (berço: casa e carregador do AGV)
                const r = px(11);
                const cor = t.purple || t.accent;
                el("path", {
                    d: `M${-r},${-r * 0.1}L0,${-r * 1.05}L${r},${-r * 0.1}L${r * 0.78},${-r * 0.1}L${r * 0.78},${r}L${-r * 0.78},${r}L${-r * 0.78},${-r * 0.1}Z`,
                    fill: t.css("--purple-soft") || t.card, stroke: contorno || cor, "stroke-width": selecionado ? 3 : 2.2,
                    "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke"
                }, g);
                el("path", { d: `M${-r * 0.22},${r}L${-r * 0.22},${r * 0.35}L${r * 0.22},${r * 0.35}L${r * 0.22},${r}`, fill: "none", stroke: cor, "stroke-width": 1.6, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, g);
            } else if (no.tipo === "ESPERA") {
                const r = px(10);
                el("rect", {
                    x: -r, y: -r, width: r * 2, height: r * 2, rx: px(3), transform: "rotate(45)",
                    fill: t.amberSoft, stroke: contorno || t.amber, "stroke-width": selecionado ? 3 : 2.5, "vector-effect": "non-scaling-stroke"
                }, g);
            } else {
                el("circle", { r: px(6), fill: t.papel, stroke: contorno || t.fita, "stroke-width": selecionado ? 3 : 2.5, "vector-effect": "non-scaling-stroke" }, g);
            }
            if (no.rfid && mapa.opcoes.mostrarTags) el("circle", { r: px(3), fill: t.tag, "pointer-events": "none" }, g);

            if (mapa.opcoes.rotulos) {
                const importante = no.tipo !== "REFERENCIA";
                if (importante) {
                    const rotulo = nomeCurtoNo(p, no, ppm < 34);
                    // rótulo à direita do símbolo, sem cobrir a fita
                    pilula(c.textos, no.x + px(18), Y(no.y), rotulo, px, {
                        ancora: "esquerda", fundo: destino ? t.accentSoft : t.card, borda: destino ? t.accent : t.borda,
                        cor: destino ? t.accent : t.texto
                    });
                } else if (editor || selecionado || ppm > 90) {
                    texto(c.textos, no.x + px(10), Y(no.y) - px(10), no.id, px(10), {
                        fill: selecionado ? t.accent : t.muted, "text-anchor": "start", "font-family": "IBM Plex Mono, monospace", "font-weight": 500
                    });
                }
            }
        });

        // ---------- rastros ----------
        if (mapa.opcoes.rastro) {
            Object.entries(mapa.rastros || {}).forEach(([agvId, pontos]) => {
                if (!pontos || pontos.length < 2) return;
                const agv = mapa.agvs.find(a => a.id === agvId);
                if (!agv) return;
                const cor = corEstado(t, agv.estado);
                el("polyline", {
                    points: pontos.map(q => `${q.x},${Y(q.y)}`).join(" "), fill: "none", stroke: cor,
                    "stroke-width": 2.5, "stroke-dasharray": "1 6", "stroke-linecap": "round", opacity: 0.6,
                    "vector-effect": "non-scaling-stroke", "pointer-events": "none"
                }, c.rastros);
            });
        }

        // ---------- AGVs ----------
        mapa.agvs.forEach(agv => {
            if (typeof agv.x !== "number" || typeof agv.y !== "number") return;
            if (!mapa.opcoes.outros && !agv.destaque && mapa.agvs.length > 1) return;
            desenharAGV(mapa, c, t, agv, Y, px);
        });

        if (typeof mapa.sobreposicao === "function") mapa.sobreposicao(mapa, c.sobreposicao, { Y, px, tema: t });
        desenharEscala(mapa);
    }

    function desenharAGV(mapa, c, t, agv, Y, px) {
        const cor = corEstado(t, agv.estado);
        // unidades do desenho: o corpo tem 42 × 34; nunca menor que o AGV real
        const s = Math.max(px(1), 0.34 / 42) * (agv.destaque ? 1 : 0.9);
        const graus = agv.orientacao || 0;
        const g = el("g", {
            transform: `translate(${agv.x},${Y(agv.y)}) rotate(${-graus}) scale(${s})`,
            "pointer-events": "none", opacity: agv.destaque === false ? 0.75 : 1,
            class: "agv-no-mapa"
        }, c.agvs);
        if (agv.cone) {
            const invadido = agv.cone === "INVADIDA";
            el("path", { d: "M24 -10 L76 -24 L76 24 L24 10 z", fill: invadido ? t.red : cor, opacity: invadido ? 0.22 : 0.08 }, g);
        }
        if (agv.destaque !== false) {
            el("circle", { r: 30, fill: cor, opacity: agv.estado === "emergencia" ? 0.22 : 0.10, class: agv.estado === "emergencia" ? "agv-halo-alarme" : "agv-halo" }, g);
        }
        // arco da manobra em andamento
        if (typeof agv.giroAlvo === "number" && Math.abs(agv.giroAlvo) > 1 && typeof agv.giroFeito === "number") {
            const restante = (agv.giroAlvo - agv.giroFeito) * Math.PI / 180;
            const r = 30;
            const fimX = Math.cos(restante) * r, fimY = -Math.sin(restante) * r;
            const grande = Math.abs(restante) > Math.PI ? 1 : 0;
            const varre = restante > 0 ? 0 : 1;
            el("path", { d: `M${r},0 A${r},${r} 0 ${grande} ${varre} ${fimX},${fimY}`, fill: "none", stroke: cor, "stroke-width": 2, "stroke-dasharray": "3 4", "vector-effect": "non-scaling-stroke" }, g);
        }
        if (agv.manutencao) g.setAttribute("opacity", "0.6");
        // módulo (0.14): G garra na frente, T engate atrás, R roletes, E plataforma de elevação
        if (agv.modulo === "G") {
            [[-12], [8]].forEach(([y]) => el("rect", { x: 19, y, width: 10, height: 4, rx: 1.2, fill: cor }, g));
        } else if (agv.modulo === "T") {
            el("line", { x1: -21, y1: 0, x2: -29, y2: 0, stroke: cor, "stroke-width": 2.5, "vector-effect": "non-scaling-stroke" }, g);
            el("circle", { cx: -31, cy: 0, r: 3.2, fill: "none", stroke: cor, "stroke-width": 2, "vector-effect": "non-scaling-stroke" }, g);
        }
        el("rect", {
            x: -21, y: -17, width: 42, height: 34, rx: 6, fill: t.agv, stroke: cor, "stroke-width": 2.5,
            "vector-effect": "non-scaling-stroke", "stroke-dasharray": agv.estimado || agv.manutencao ? "4 3" : null
        }, g);
        [[-17, -21], [7, -21], [-17, 16], [7, 16]].forEach(([x, y]) => el("rect", { x, y, width: 10, height: 5, rx: 1.5, fill: t.roda }, g));
        if (agv.modulo === "R") {
            [-12, -6, 0, 6].forEach(x => el("line", { x1: x, y1: -11, x2: x, y2: 11, stroke: t.roda, "stroke-width": 1.6, "vector-effect": "non-scaling-stroke" }, g));
        } else if (agv.modulo === "E") {
            el("circle", { cx: -2, cy: 0, r: 9, fill: "none", stroke: t.roda, "stroke-width": 1.6, "vector-effect": "non-scaling-stroke" }, g);
        }
        if (agv.carga) el("rect", { x: -12, y: -9, width: 18, height: 18, rx: 2, fill: t.carga }, g);
        el("path", { d: "M18 0 l-9 -8 v16 z", fill: cor }, g);
        if (agv.manutencao) {
            // chave inglesa (não gira com o AGV)
            const k = el("g", { transform: `translate(${agv.x},${Y(agv.y)}) scale(${Math.max(px(1), 0.34 / 42)})`, "pointer-events": "none" }, c.agvs);
            el("circle", { cx: 20, cy: -20, r: 11, fill: t.card, stroke: cor, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }, k);
            el("path", { d: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z", transform: "translate(11,-29) scale(0.75)",
                fill: "none", stroke: t.texto, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }, k);
        }

        // rótulo (não gira)
        if (mapa.opcoes.rotulos !== false || agv.destaque) {
            const rotulo = agv.rotulo || `AGV ${agv.id}`;
            const abaixo = 34 * s + px(14);
            // perto da borda, o rótulo não sai da área visível do mapa
            const meia = (Math.max(px(24), rotulo.length * px(11) * 0.62 + px(16))) / 2 + px(4);
            const v = mapa.vista;
            const xr = v && v.largura > 2 * meia ? Math.min(Math.max(agv.x, v.x + meia), v.x + v.largura - meia) : agv.x;
            pilula(c.textos, xr, Y(agv.y) + abaixo, rotulo, px, { fundo: cor, cor: "#ffffff", mono: true, tamanho: 11, altura: 21, raio: 5 });
        }
    }

    // Tema mudou: redesenha todos os mapas
    if (typeof document !== "undefined") {
        document.addEventListener("temaalterado", () => mapasCriados.forEach(m => m.desenhar()));
    }

    raiz.MapaSVG = { criar, el, NS, CORES_LAYOUT, tema, texto, pilula };
})(typeof window !== "undefined" ? window : globalThis);
