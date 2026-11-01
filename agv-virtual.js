/* ============================================================
   AGV VIRTUAL
   ============================================================
   Roda o firmware de verdade (AGV_FROTA.ino compilado para
   WebAssembly) dentro do navegador, num mundo simulado montado a
   partir da planta publicada: linhas, tags RFID, máquinas e
   obstáculos. O AGV virtual aparece na frota como qualquer outro;
   os comandos que o site manda para ele não passam pelo broker.

   O arquivo agv-virtual-wasm.js (firmware em base64) só é carregado
   quando um AGV virtual é ligado.
*/

const AgvVirtual = (function () {
    "use strict";

    const BITS = { START: 0, REARME: 1, ESTOP: 2, SELETORA: 3, STOP: 4, START_MISSAO: 5 };
    const SAIDA_LED_START = 8, SAIDA_LED_REARME = 9, SAIDA_ENABLE = 15;
    const CHAVE_NVS = "agvVirtualNvs_";
    const CHAVE_ARQUIVOS = "agvVirtualArquivos_";   // flash: fila de missões e rotas de saída
    const CHAVE_CONFIG = "agvVirtualMundo_";

    let modulo = null;
    let carregando = null;
    const instancias = {};
    let laco = null;
    let ultimoTempo = 0;
    let mapa = null;
    let selecionado = null;
    let modoClique = null;            // "POSICIONAR" | "OBSTACULO" | null
    let ultimaRevisaoMundo = -1;
    const ultimoRfid = {};


    /* ========================================================
       CARREGAMENTO DO WASM
       ======================================================== */

    function carregarScript(src) {
        return new Promise((ok, erro) => {
            const s = document.createElement("script");
            s.src = src;
            s.onload = ok;
            s.onerror = () => erro(new Error("Não foi possível carregar " + src));
            document.head.appendChild(s);
        });
    }

    function carregarModulo() {
        if (modulo) return Promise.resolve(modulo);
        if (carregando) return carregando;
        carregando = (async () => {
            if (!window.AGV_VIRTUAL_WASM) await carregarScript("agv-virtual-wasm.js");
            const binario = Uint8Array.from(atob(window.AGV_VIRTUAL_WASM), c => c.charCodeAt(0));
            modulo = await WebAssembly.compile(binario);
            return modulo;
        })();
        return carregando;
    }

    function lerTexto(memoria, ponteiro) {
        const bytes = new Uint8Array(memoria.buffer, ponteiro);
        let fim = 0;
        while (bytes[fim] !== 0) fim++;
        return new TextDecoder().decode(bytes.subarray(0, fim));
    }

    function escreverTexto(instancia, ponteiro, texto, maximo) {
        const bytes = new TextEncoder().encode(texto);
        const n = Math.min(bytes.length, maximo - 1);
        const destino = new Uint8Array(instancia.memoria.buffer, ponteiro, maximo);
        destino.set(bytes.subarray(0, n));
        destino[n] = 0;
        return n;
    }


    /* ========================================================
       INSTÂNCIAS
       ======================================================== */

    function configuracaoMundo(id) {
        const padrao = { bracoReal: 0.15, raioReal: 0.036, qtrAvanco: 0.10, inversao: [false, false, false, false], velocidade: 1 };
        try {
            return Object.assign(padrao, JSON.parse(localStorage.getItem(CHAVE_CONFIG + id) || "{}"));
        } catch (erro) {
            return padrao;
        }
    }

    function salvarConfiguracaoMundo(inst) {
        try {
            localStorage.setItem(CHAVE_CONFIG + inst.id, JSON.stringify(inst.mundo));
        } catch (erro) { /* sem espaço: ignora */ }
    }

    async function ligar(id, motivoReinicio = 1) {
        await carregarModulo();
        desligar(id, false);

        const inst = {
            id,
            filaSaida: [],
            pulsos: [],
            obstaculos: (instancias[id]?.obstaculos) || [],
            entradas: (1 << BITS.STOP) | (1 << BITS.ESTOP),
            mundo: configuracaoMundo(id),
            pausado: false,
            versaoNvs: 0,
            brokerDisponivel: true
        };

        const wasi = {
            fd_write: (fd, iovs, n, escrito) => {
                // printf do firmware: soma os bytes e descarta
                const mem = new DataView(inst.memoria.buffer);
                let total = 0;
                for (let i = 0; i < n; i++) total += mem.getUint32(iovs + i * 8 + 4, true);
                mem.setUint32(escrito, total, true);
                return 0;
            },
            fd_close: () => 0,
            fd_seek: () => 0,
            fd_fdstat_get: () => 0
        };
        const env = {
            js_publicar: (pTopico, pPayload, retido) => {
                const topico = lerTexto(inst.memoria, pTopico);
                const payload = lerTexto(inst.memoria, pPayload);
                // o firmware publica em agv/<EMPRESA>/<id>/...; o site trata como agv/<id>/...
                const base = inst.base || "agv/01/";
                inst.filaSaida.push([topico.startsWith(base) ? `agv/${id}/` + topico.slice(base.length) : topico, payload, topico, Boolean(retido)]);
            }
        };
        const instancia = await WebAssembly.instantiate(modulo, { env, wasi_snapshot_preview1: wasi });
        inst.exp = instancia.exports;
        inst.memoria = instancia.exports.memory;
        inst.exp._initialize();
        inst.ptrTopico = inst.exp.vi_buffer_topico();
        if (inst.exp.vi_identidade) {
            // cada AGV virtual com o próprio ID nos tópicos (tráfego entre eles)
            escreverTexto(inst, inst.ptrTopico, `${empresaVirtual()}/${id}`, 160);
            inst.exp.vi_identidade();
        }
        inst.base = inst.exp.vi_topico_base ? lerTexto(inst.memoria, inst.exp.vi_topico_base()) : "agv/01/";
        inst.ptrPayload = inst.exp.vi_buffer_payload();
        inst.tamPayload = inst.exp.vi_tamanho_payload();

        // Memória (NVS) guardada no navegador: configuração e calibrações sobrevivem
        const nvs = localStorage.getItem(CHAVE_NVS + id);
        if (nvs) {
            const n = escreverTexto(inst, inst.ptrPayload, nvs, inst.tamPayload);
            inst.exp.vi_nvs_importar(n);
        }
        const arquivos = inst.exp.vi_arquivos_importar ? localStorage.getItem(CHAVE_ARQUIVOS + id) : null;
        if (arquivos) inst.exp.vi_arquivos_importar(escreverTexto(inst, inst.ptrPayload, arquivos, inst.tamPayload));
        aplicarGeometria(inst);
        instancias[id] = inst;
        montarMundo(inst);

        const agv = agvs[id];
        const pose = agv?.virtualPose;
        if (pose) inst.exp.vi_teleportar(pose.x, pose.y, pose.orientacao);

        // relógio do AGV virtual = hora deste computador (o turno usa)
        if (inst.exp.vi_relogio) inst.exp.vi_relogio(Date.now() / 1000);
        inst.exp.vi_iniciar(motivoReinicio);
        if (!nvs) {
            // Primeira vez: AGV "de fábrica" já com braço, garra e QTR calibrados
            inst.exp.vi_preparar_fabrica();
        }
        inst.exp.vi_entradas(inst.entradas);
        inst.versaoNvs = inst.exp.vi_nvs_versao();
        entregarRetidos(inst);
        if (agv) {
            agv.virtualAtivo = true;
            salvarAgvsFrota();
        }
        iniciarLaco();
        return inst;
    }

    function desligar(id, marcar = true) {
        const inst = instancias[id];
        if (!inst) return;
        if (agvs[id]) {
            agvs[id].virtualPose = { x: inst.exp.vi_x(), y: inst.exp.vi_y(), orientacao: inst.exp.vi_th() * 180 / Math.PI };
            if (marcar) agvs[id].virtualAtivo = false;
            salvarAgvsFrota();
        }
        delete instancias[id];
        // Sem heartbeat o site marca o AGV como offline em poucos segundos;
        // a mensagem de LWT deixa isso imediato.
        if (marcar) entregarAoSite(`agv/${id}/status/conexao`, "OFFLINE");
    }

    function aplicarGeometria(inst) {
        const m = inst.mundo;
        inst.exp.vi_geometria(m.bracoReal, m.raioReal, m.qtrAvanco);
        for (let i = 0; i < 4; i++) inst.exp.vi_inversao(i, m.inversao[i] ? 1 : 0);
    }

    // Linhas, tags e objetos sólidos da planta publicada
    function montarMundo(inst) {
        const planta = plantaPublicada();
        const e = inst.exp;
        e.vi_mundo_limpar();
        planta.segmentos.forEach(s => {
            const a = Planta.noPorId(planta, s.a), b = Planta.noPorId(planta, s.b);
            // troca lateral não tem fita no chão
            if (!a || !b || Planta.tipoSegmento(s) === "LATERAL") return;
            e.vi_mundo_linha(a.x, a.y, b.x, b.y);
            const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            (s.tags || []).forEach(t => {
                if (!t.rfid) return;
                escreverTexto(inst, inst.ptrTopico, t.rfid, 160);
                const f = t.distancia / L;
                e.vi_mundo_tag(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
            });
        });
        planta.nos.forEach(no => {
            if (!no.rfid) return;
            escreverTexto(inst, inst.ptrTopico, no.rfid, 160);
            e.vi_mundo_tag(no.x, no.y);
        });
        atualizarObstaculos(inst);
        inst.revisaoMundo = planta.revisao;
    }

    function atualizarObstaculos(inst) {
        const planta = plantaPublicada();
        const e = inst.exp;
        e.vi_obstaculos_limpar();
        planta.layout.forEach(o => {
            if (Planta.TIPOS_LAYOUT[o.tipo]?.solido) {
                e.vi_mundo_obstaculo(o.x, o.y, o.largura, o.profundidade, (o.rotacao || 0) * Math.PI / 180);
            }
        });
        inst.obstaculos.forEach(o => e.vi_mundo_obstaculo(o.x, o.y, o.largura, o.profundidade, 0));
        if (!e.vi_outro_agv) {
            Object.values(instancias).forEach(outro => {
                if (outro === inst || !outro.exp) return;
                e.vi_mundo_obstaculo(outro.exp.vi_x(), outro.exp.vi_y(), 0.34, 0.28, outro.exp.vi_th());
            });
        }
    }

    // Os outros AGVs virtuais aparecem no sensor de distância deste
    function atualizarOutrosAgvs(inst) {
        const e = inst.exp;
        if (!e.vi_outro_agv) return;
        e.vi_outros_limpar();
        Object.values(instancias).forEach(outro => {
            if (outro === inst || !outro.exp) return;
            e.vi_outro_agv(outro.exp.vi_x(), outro.exp.vi_y(), 0.34, 0.28, outro.exp.vi_th());
        });
    }


    /* ========================================================
       TRÁFEGO ENTRE AGVS VIRTUAIS
       ========================================================
       O papel do broker: o status/trafego de cada AGV virtual vai para
       os outros (agv/<empresa>/+/status/trafego) e o retido fica guardado
       para quem ligar depois. */

    const trafegoRetido = new Map();   // tópico completo -> payload

    function empresaVirtual() {
        try {
            const codigo = window.Nuvem && Nuvem.empresa && Nuvem.empresa()?.codigo;
            if (codigo && /^[a-z0-9-]{1,24}$/.test(codigo)) return codigo;
        } catch (erro) { /* sem nuvem */ }
        return "demo";
    }

    function entregarMqtt(inst, topico, payload) {
        if (!inst.exp || !inst.brokerDisponivel) return;
        escreverTexto(inst, inst.ptrTopico, topico, 160);
        inst.exp.vi_mqtt(escreverTexto(inst, inst.ptrPayload, payload, inst.tamPayload));
    }

    function entregarTrafego(origem, topico, payload, retido) {
        if (retido) trafegoRetido.set(topico, payload);
        Object.values(instancias).forEach(inst => { if (inst !== origem) entregarMqtt(inst, topico, payload); });
    }

    // Ao ligar (ou o broker voltar): recebe o que estava retido, inclusive o
    // próprio estado (o AGV que reiniciou continua dono das zonas que ocupava).
    function entregarRetidos(inst) {
        trafegoRetido.forEach((payload, topico) => entregarMqtt(inst, topico, payload));
    }

    // AGV virtual removido ou desligado com zonas presas: solta tudo dele
    function esquecerTrafego(id) {
        const vazio = JSON.stringify({ o: [], c: [], p: [] });
        [...trafegoRetido.keys()].filter(t => t.split("/")[2] === id).forEach(topico => {
            trafegoRetido.delete(topico);
            entregarTrafego(null, topico, vazio, false);
        });
        entregarAoSite(`agv/${id}/status/trafego`, vazio);
    }


    /* ========================================================
       LAÇO DE SIMULAÇÃO
       ======================================================== */

    function entregarAoSite(topico, payload) {
        if (typeof processarMensagemMQTT === "function") {
            processarMensagemMQTT(topico, payload);
        }
    }

    function iniciarLaco() {
        if (laco) return;
        ultimoTempo = performance.now();
        laco = setInterval(passo, 20);
    }

    function passo() {
        const agora = performance.now();
        const dt = Math.min(100, agora - ultimoTempo);
        ultimoTempo = agora;
        const ids = Object.keys(instancias);
        if (!ids.length) {
            clearInterval(laco);
            laco = null;
            return;
        }
        const planta = plantaPublicada();

        ids.forEach(id => {
            const inst = instancias[id];
            if (!inst || inst.pausado) return;
            if (inst.revisaoMundo !== planta.revisao) montarMundo(inst);
            else if (ids.length > 1 && !inst.exp.vi_outro_agv) atualizarObstaculos(inst);
            if (ids.length > 1) atualizarOutrosAgvs(inst);

            const ms = Math.round(dt * (inst.mundo.velocidade || 1));
            // passos de até 20 ms para os pulsos de botão terem resolução
            let restante = ms;
            while (restante > 0) {
                const fatia = Math.min(20, restante);
                const tempo = inst.exp.vi_tempo_ms();
                let mudou = false;
                inst.pulsos = inst.pulsos.filter(p => {
                    if (tempo >= p.ate) {
                        inst.entradas &= ~(1 << p.bit);
                        mudou = true;
                        return false;
                    }
                    return true;
                });
                if (mudou) inst.exp.vi_entradas(inst.entradas);
                inst.exp.vi_passo(fatia);
                restante -= fatia;
            }

            // Publicações do firmware -> site (fora da chamada ao WASM)
            const fila = inst.filaSaida;
            inst.filaSaida = [];
            fila.forEach(([t, p, original, retido]) => {
                if (t.endsWith("/status/trafego")) entregarTrafego(inst, original, p, retido);
                if (t.endsWith("/status/sensores/rfid")) {
                    try { ultimoRfid[id] = JSON.parse(p).codigo; } catch (erro) { /* ignora */ }
                }
                entregarAoSite(t, p);
            });

            // NVS mudou (configuração, calibração): guarda no navegador
            const versao = inst.exp.vi_nvs_versao();
            if (versao !== inst.versaoNvs) {
                inst.versaoNvs = versao;
                const n = inst.exp.vi_nvs_exportar();
                const texto = new TextDecoder().decode(new Uint8Array(inst.memoria.buffer, inst.ptrPayload, n));
                try { localStorage.setItem(CHAVE_NVS + id, texto); } catch (erro) { /* ignora */ }
            }
            // Flash (fila, rotas de saída): confere 1×/s
            if (inst.exp.vi_arquivos_versao && agora - (inst.arquivosVistoEm || 0) > 1000) {
                inst.arquivosVistoEm = agora;
                const v = inst.exp.vi_arquivos_versao();
                if (v !== inst.versaoArquivos) {
                    inst.versaoArquivos = v;
                    const n = inst.exp.vi_arquivos_exportar();
                    if (n >= 0) {
                        const texto = new TextDecoder().decode(new Uint8Array(inst.memoria.buffer, inst.ptrPayload, n));
                        try { localStorage.setItem(CHAVE_ARQUIVOS + id, texto); } catch (erro) { /* sem espaço: ignora */ }
                    }
                }
            }
        });

        if (document.getElementById("agvVirtual")?.classList.contains("ativa")) {
            desenhar();
            if (agora - (passo.ultimaLista || 0) > 1000) {
                passo.ultimaLista = agora;
                atualizarAbas();
            }
        }
    }

    // Comando que o site publicou para um AGV virtual
    function receberComando(id, caminho, mensagem) {
        const inst = instancias[id];
        if (!inst) {
            console.warn(`AGV virtual ${id} desligado: comando ${caminho} ignorado.`);
            return false;
        }
        if (!inst.brokerDisponivel) return false;
        escreverTexto(inst, inst.ptrTopico, `${inst.base}${caminho}`, 160);
        const n = escreverTexto(inst, inst.ptrPayload, mensagem, inst.tamPayload);
        inst.exp.vi_mqtt(n);
        return true;
    }


    /* ========================================================
       PAINEL FÍSICO
       ======================================================== */

    function pulsar(id, bit, ms = 150) {
        const inst = instancias[id];
        if (!inst) return;
        inst.entradas |= 1 << bit;
        inst.exp.vi_entradas(inst.entradas);
        inst.pulsos.push({ bit, ate: inst.exp.vi_tempo_ms() + ms });
    }

    function alternar(id, bit, valor) {
        const inst = instancias[id];
        if (!inst) return;
        if (valor) inst.entradas |= 1 << bit;
        else inst.entradas &= ~(1 << bit);
        inst.exp.vi_entradas(inst.entradas);
    }

    function bit(inst, b) {
        return Boolean(inst.entradas & (1 << b));
    }


    /* ========================================================
       TELA "AGV VIRTUAL"
       ======================================================== */

    function idsVirtuais() {
        return Object.values(agvs).filter(a => a.virtual).map(a => a.id).sort();
    }

    function criarNovo() {
        let n = 1;
        while (agvs["V" + n]) n++;
        const id = "V" + n;
        agvs[id] = criarAGV(id, `Virtual ${n}`);
        agvs[id].virtual = true;
        // começa numa estação da planta, se houver
        const planta = plantaPublicada();
        const inicio = planta.nos.find(no => no.tipo === "ESPERA") || planta.nos.find(no => no.tipo === "ESTACAO") || planta.nos[0];
        if (inicio) {
            agvs[id].virtualPose = { x: inicio.x, y: inicio.y, orientacao: inicio.orientacaoChegada ?? 0, ponto: inicio.id };
        } else {
            agvs[id].virtualPose = { x: 1, y: 1, orientacao: 0 };
        }
        salvarAgvsFrota();
        renderizarFrota();
        selecionado = id;
        return ligar(id).then(() => renderizarTela());
    }

    async function remover(id) {
        if (!(await ui.confirmar({ titulo: `Remover o AGV virtual ${id}?`, texto: "A memória e a configuração salvas dele neste navegador também serão apagadas.", confirmar: "Remover", perigo: true }))) return;
        desligar(id);
        esquecerTrafego(id);
        delete agvs[id];
        localStorage.removeItem(CHAVE_NVS + id);
        localStorage.removeItem(CHAVE_ARQUIVOS + id);
        localStorage.removeItem(CHAVE_CONFIG + id);
        if (agvSelecionado === id) agvSelecionado = null;
        salvarAgvsFrota();
        renderizarFrota();
        selecionado = idsVirtuais()[0] || null;
        renderizarTela();
    }

    function posicionar(id, x, y, orientacao, informar) {
        const inst = instancias[id];
        if (!inst) return;
        inst.exp.vi_teleportar(x, y, orientacao);
        if (agvs[id]) agvs[id].virtualPose = { x, y, orientacao };
        if (informar) {
            const planta = plantaPublicada();
            const no = planta.nos.find(n => Math.hypot(n.x - x, n.y - y) < 0.02);
            if (no) {
                const comando = { comando: "DEFINIR_POSICAO", ponto: no.id, orientacao: Planta.normalizarAngulo(orientacao) };
                if (no.barreira > 0) comando.barreira = no.barreira;
                const zona = typeof zonaDoPonto === "function" ? zonaDoPonto(no.id) : null;
                if (zona) comando.zona = zona;
                receberComando(id, "comando/definir_posicao", JSON.stringify(comando));
            }
        }
    }

    function abrir() {
        const ids = idsVirtuais();
        if (!selecionado || !agvs[selecionado]) selecionado = ids[0] || null;
        const container = document.getElementById("virtualMapa");
        if (container && !mapa) {
            mapa = MapaSVG.criar(container, { grade: false, rastro: true });
            mapa.sobreposicao = desenharSobreposicao;
            mapa.ferramentaAtiva = () => (modoClique ? "CLIQUE" : "SELECIONAR");
            mapa.svg.addEventListener("pointerdown", aoClicarMapa);
            document.getElementById("virtualZoomMais")?.addEventListener("click", () => mapa.zoom(1 / 1.3));
            document.getElementById("virtualZoomMenos")?.addEventListener("click", () => mapa.zoom(1.3));
            document.getElementById("virtualAjustar")?.addEventListener("click", () => mapa.ajustar());
        }
        if (mapa) {
            const planta = plantaPublicada();
            if (mapa.planta !== planta) {
                mapa.ajustado = false;
                mapa.definirPlanta(planta);
            }
        }
        renderizarTela();
    }

    function aoClicarMapa(evento) {
        if (!modoClique || evento.button !== 0 || !selecionado) return;
        const inst = instancias[selecionado];
        if (!inst) return;
        const p = mapa.paraMundo(evento);
        const planta = plantaPublicada();
        if (modoClique === "POSICIONAR") {
            // gruda no ponto mais próximo (até 15 cm)
            let alvo = { x: p.x, y: p.y };
            const no = planta.nos.map(n => ({ n, d: Math.hypot(n.x - p.x, n.y - p.y) })).sort((a, b) => a.d - b.d)[0];
            if (no && no.d < 0.15) alvo = { x: no.n.x, y: no.n.y };
            const orientacao = Number(document.getElementById("virtualOrientacao")?.value) || 0;
            posicionar(selecionado, alvo.x, alvo.y, orientacao, document.getElementById("virtualInformar")?.checked);
        } else if (modoClique === "OBSTACULO") {
            const i = inst.obstaculos.findIndex(o => Math.abs(o.x - p.x) < o.largura / 2 && Math.abs(o.y - p.y) < o.profundidade / 2);
            if (i >= 0) inst.obstaculos.splice(i, 1);
            else inst.obstaculos.push({ x: Planta.arred(p.x, 2), y: Planta.arred(p.y, 2), largura: 0.3, profundidade: 0.3 });
            atualizarObstaculos(inst);
        }
        evento.stopPropagation();
        desenhar();
    }

    function desenharSobreposicao(m, grupo, { Y, px, tema }) {
        const el = MapaSVG.el;
        const t = tema || MapaSVG.tema();
        if (typeof desenharZonasTrafego === "function") desenharZonasTrafego(m, grupo, { Y, px, tema: t });
        Object.values(instancias).forEach(inst => {
            inst.obstaculos.forEach(o => {
                el("rect", { x: o.x - o.largura / 2, y: Y(o.y + o.profundidade / 2), width: o.largura, height: o.profundidade, fill: t.redSoft, stroke: t.red, "stroke-width": 2, rx: 0.02, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, grupo);
                el("path", { d: `M${o.x - o.largura / 2 + 0.04},${Y(o.y + o.profundidade / 2 - 0.04)}L${o.x + o.largura / 2 - 0.04},${Y(o.y - o.profundidade / 2 + 0.04)}M${o.x + o.largura / 2 - 0.04},${Y(o.y + o.profundidade / 2 - 0.04)}L${o.x - o.largura / 2 + 0.04},${Y(o.y - o.profundidade / 2 + 0.04)}`, stroke: t.red, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, grupo);
            });
            // raios dos VL53
            const x = inst.exp.vi_x(), y = inst.exp.vi_y(), th = inst.exp.vi_th();
            [0, 1].forEach(k => {
                const d = inst.exp.vi_vl53(k);
                const lateral = k === 0 ? 0.05 : -0.05;
                const ox = x + 0.12 * Math.cos(th) - lateral * Math.sin(th);
                const oy = y + 0.12 * Math.sin(th) + lateral * Math.cos(th);
                const alcance = d >= 0 ? d / 1000 : 2.0;
                el("line", {
                    x1: ox, y1: Y(oy), x2: ox + alcance * Math.cos(th), y2: Y(oy + alcance * Math.sin(th)),
                    stroke: d >= 0 && d < (agvs[inst.id]?.sensores?.vl53?.limite || 1000) ? t.red : t.tag,
                    "stroke-opacity": d >= 0 && d < (agvs[inst.id]?.sensores?.vl53?.limite || 1000) ? 0.9 : 0.55,
                    "stroke-width": 1.5, "stroke-dasharray": "3 4", "vector-effect": "non-scaling-stroke", "pointer-events": "none"
                }, grupo);
            });
            // barra do QTR
            const a = inst.mundo.qtrAvanco;
            const cx = x + a * Math.cos(th), cy = y + a * Math.sin(th);
            for (let i = 0; i < 8; i++) {
                const lat = (i - 3.5) * 0.009525;
                const sx = cx - lat * Math.sin(th), sy = cy + lat * Math.cos(th);
                const v = inst.exp.vi_qtr(i);
                el("circle", { cx: sx, cy: Y(sy), r: Math.max(0.004, px(1.6)), fill: v > 2000 ? t.green : t.muted, "pointer-events": "none" }, grupo);
            }
        });
    }

    function desenhar() {
        if (!mapa) return;
        mapa.agvs = Object.values(instancias).map(inst => {
            const agv = agvs[inst.id];
            const x = inst.exp.vi_x(), y = inst.exp.vi_y();
            if (Math.abs(inst.exp.vi_velocidade_roda(0)) + Math.abs(inst.exp.vi_velocidade_roda(1)) > 0.002) mapa.registrarRastro(inst.id, x, y);
            return {
                id: inst.id, x, y,
                orientacao: inst.exp.vi_th() * 180 / Math.PI,
                destaque: inst.id === selecionado,
                rotulo: inst.id,
                estado: agv && typeof categoriaEstadoAGV === "function" ? categoriaEstadoAGV(agv).chave : "pronto",
                carga: typeof garraCarregada === "function" ? garraCarregada(agv) : false,
                cone: agv?.barreira
            };
        });
        mapa.rota = selecionado ? rotaDoAGV(agvs[selecionado]) : null;
        mapa.desenhar();
        atualizarPainel();
    }

    function cor(rgb) {
        return "#" + rgb.toString(16).padStart(6, "0");
    }

    // A fita real troca os canais conforme LEDS_ORDEM_CORES; aqui desfaz para mostrar a cor certa
    function corDaFita(valor, ordem) {
        const a = (valor >> 16) & 255, b = (valor >> 8) & 255, c = valor & 255;
        const rgb = [[a, b, c], [b, a, c], [b, c, a], [a, c, b], [c, a, b], [c, b, a]][ordem] || [a, b, c];
        return rgb;
    }

    function desenharFitaVirtual(inst, fita, elemento) {
        if (!elemento) return;
        const n = Math.max(0, Math.min(60, inst.exp.vi_num_leds(fita)));
        const mostrar = Math.min(n, 30);
        if (elemento.children.length !== mostrar) elemento.innerHTML = "<i></i>".repeat(mostrar);
        const ordem = Number(agvs[inst.id]?.parametros?.LEDS_ORDEM_CORES) || 0;
        [...elemento.children].forEach((led, i) => {
            const indice = mostrar < n ? Math.floor(i * n / mostrar) : i;
            const [r, g, b] = corDaFita(inst.exp.vi_led(fita, indice), ordem);
            const aceso = r + g + b > 24;
            // realça um pouco: na tela a fita parece mais fraca que ao vivo
            const k = aceso ? Math.min(2.2, 255 / Math.max(r, g, b, 1)) * 0.85 + 0.15 : 1;
            const css = aceso ? `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})` : "#1C2530";
            led.style.background = css;
            led.style.boxShadow = aceso ? `0 0 8px ${css}` : "none";
        });
    }

    function atualizarPainel() {
        const inst = instancias[selecionado];
        const status = document.getElementById("virtualStatus");
        const agv = agvs[selecionado];
        if (status) {
            status.textContent = !selecionado ? "Nenhum AGV virtual"
                : !inst ? "Desligado"
                : inst.pausado ? "Pausado"
                : `${agv?.maquina || "--"} · ${agv?.modo === "MANUAL" ? "manual" : "automático"}`;
        }
        const painel = document.getElementById("virtualPainel");
        if (!painel) return;
        painel.classList.toggle("desligado", !inst);
        const texto = (idEl, valor) => { const e = document.getElementById(idEl); if (e) e.textContent = valor; };
        texto("virtualPainelId", selecionado || "--");
        if (!inst) return;

        const saidas = inst.exp.vi_saidas();
        const ledStartMissao = Boolean(saidas & (1 << SAIDA_LED_START));
        const ledRearme = Boolean(saidas & (1 << SAIDA_LED_REARME));
        document.getElementById("virtualStartMissao")?.classList.toggle("aceso", ledStartMissao);
        document.getElementById("virtualRearme")?.classList.toggle("aceso", ledRearme);
        // a fita mostra o estado; os textos explicam as lâmpadas dos botões
        const sinal = agv?.leds;
        texto("virtualStartMissaoTexto", ledStartMissao ? (sinal === "MISSAO_ANDANDO" || agv?.estadoMissao === "EM_EXECUCAO" ? "aceso · em missão" : "aceso") : sinal === "APERTE_START" ? "piscando · missão pronta" : sinal === "PARTINDO" ? "piscando · vai partir sozinho" : sinal === "CONFIRMACAO" ? "piscando · confirmar" : "apagado");
        texto("virtualRearmeTexto", ledRearme || agv?.aguardandoRearme ? "piscando · aperte" : "apagado");
        document.getElementById("virtualLedOn")?.classList.toggle("aceso", Boolean(agv?.mqttConectado || inst.brokerDisponivel));
        document.getElementById("virtualLedEnable")?.classList.toggle("aceso", !(saidas & (1 << SAIDA_ENABLE)));
        const ledEstado = document.getElementById("virtualLedEstado");
        if (ledEstado) {
            const [r, g, b] = corDaFita(inst.exp.vi_led(1, 0), Number(agv?.parametros?.LEDS_ORDEM_CORES) || 0);
            ledEstado.style.background = r + g + b > 24 ? `rgb(${r},${g},${b})` : "#2A3442";
        }
        desenharFitaVirtual(inst, 1, document.getElementById("virtualFitaEstado"));
        desenharFitaVirtual(inst, 0, document.getElementById("virtualFitaComunicacao"));
        const nomeSinal = typeof SINAIS_LED_SITE !== "undefined" && SINAIS_LED_SITE[sinal] ? SINAIS_LED_SITE[sinal][2] : (sinal || "");
        texto("virtualFitaEstadoNome", nomeSinal);

        document.getElementById("virtualEstop")?.classList.toggle("acionado", !bit(inst, BITS.ESTOP));
        document.getElementById("virtualStop")?.classList.toggle("acionado", !bit(inst, BITS.STOP));
        texto("virtualStopTexto", bit(inst, BITS.STOP) ? "" : "travado");
        const auto = bit(inst, BITS.SELETORA);
        const seletora = document.getElementById("virtualSeletora");
        if (seletora) {
            seletora.classList.toggle("auto", auto);
            seletora.setAttribute("aria-label", `Seletora em ${auto ? "automático" : "manual"}`);
        }
        document.getElementById("virtualRotuloMan")?.classList.toggle("ativo", !auto);
        document.getElementById("virtualRotuloAuto")?.classList.toggle("ativo", auto);

        const qtr = document.getElementById("virtualQtr");
        if (qtr) {
            if (!qtr.children.length) qtr.innerHTML = Array.from({ length: 8 }, () => "<span><i></i></span>").join("");
            [...qtr.children].forEach((barra, i) => { barra.firstChild.style.height = `${Math.round(inst.exp.vi_qtr(i) / 4095 * 100)}%`; });
        }
        const d1 = inst.exp.vi_vl53(0), d2 = inst.exp.vi_vl53(1);
        const m = v => v >= 0 ? `${(v / 1000).toFixed(2).replace(".", ",")} m` : "livre";
        texto("virtualVl53", `${m(d1)} / ${m(d2)}`);
        texto("virtualRfid", ultimoRfid[selecionado] || "--");
        const th = Planta.normalizarAngulo(inst.exp.vi_th() * 180 / Math.PI);
        texto("virtualPose", `x ${inst.exp.vi_x().toFixed(2).replace(".", ",")} · y ${inst.exp.vi_y().toFixed(2).replace(".", ",")} m`);
        texto("virtualOrientacaoReal", `${th}° · ${ui.direcao(th)}`);
        const ms = inst.exp.vi_tempo_ms();
        const seg = Math.floor(ms / 1000);
        texto("virtualTempo", `${String(Math.floor(seg / 3600)).padStart(2, "0")}:${String(Math.floor(seg / 60) % 60).padStart(2, "0")}:${String(seg % 60).padStart(2, "0")}`);
        texto("virtualRodas", [0, 1, 2, 3].map(i => inst.exp.vi_velocidade_roda(i).toFixed(3)).join(" · "));
        const curso = inst.exp.vi_garra_curso();
        texto("virtualGarra", curso ? `${inst.exp.vi_garra()} / ${curso} passos` : "não configurada");
        texto("virtualOdometro", `${inst.exp.vi_odometro().toFixed(2).replace(".", ",")} m`);
        const pausar = document.getElementById("virtualPausar");
        if (pausar) pausar.textContent = inst.pausado ? "Continuar" : "Pausar";
        document.querySelectorAll("[data-velocidade]").forEach(b => b.classList.toggle("ativo", Number(b.dataset.velocidade) === inst.mundo.velocidade));
    }

    function atualizarAbas() {
        const lista = document.getElementById("virtualLista");
        if (!lista) return;
        const assinatura = idsVirtuais().map(id => `${id}:${instancias[id] ? (typeof categoriaEstadoAGV === "function" ? categoriaEstadoAGV(agvs[id]).chave : 1) : 0}`).join(",") + "|" + selecionado;
        if (lista.dataset.assinatura !== assinatura) {
            lista.dataset.assinatura = assinatura;
            renderizarTela();
        }
    }

    function renderizarTela() {
        const ids = idsVirtuais();
        const lista = document.getElementById("virtualLista");
        if (lista) {
            lista.innerHTML = ids.length
                ? ids.map(id => {
                    const agv = agvs[id];
                    const ligado = Boolean(instancias[id]);
                    const cat = ligado && typeof categoriaEstadoAGV === "function" ? categoriaEstadoAGV(agv) : null;
                    const corEstado = !ligado ? "var(--muted)" : { missao: "var(--accent)", pronto: "var(--green)", atencao: "var(--amber)", falha: "var(--red)", emergencia: "var(--red)" }[cat?.chave] || "var(--muted)";
                    return `<button type="button" role="tab" aria-selected="${id === selecionado}" class="virtual-aba ${id === selecionado ? "ativo" : ""}" data-virtual="${id}">
                        <span class="mono">${escaparHtml(id)}</span>
                        <span><b>${escaparHtml(agv?.nome || id)}</b><small style="color:${corEstado}">● ${ligado ? (cat ? cat.texto.toLowerCase().replace(/^./, c => c.toUpperCase()) : "Ligado") : "Desligado"}</small></span>
                    </button>`;
                }).join("")
                : `<span class="editor-texto suave">Nenhum AGV virtual ainda.</span>`;
        }
        const inst = instancias[selecionado];
        const ligar = document.getElementById("virtualLigar");
        if (ligar) {
            ligar.disabled = !selecionado;
            ligar.textContent = inst ? "Desligar" : "Ligar";
        }
        ["virtualRemover", "virtualAbrirPainel"].forEach(i => { const b = document.getElementById(i); if (b) b.disabled = !selecionado; });

        // pontos para posicionar
        const select = document.getElementById("virtualPonto");
        if (select) {
            const planta = plantaPublicada();
            const assinatura = planta.revisao + "|" + planta.nos.map(n => n.id).join(",");
            if (select.dataset.assinatura !== assinatura) {
                select.innerHTML = planta.nos.map(n => `<option value="${n.id}">${escaparHtml(Planta.nomeDoPonto(planta, n.id))}</option>`).join("");
                select.dataset.assinatura = assinatura;
            }
        }
        const m = inst?.mundo || (selecionado ? configuracaoMundo(selecionado) : null);
        if (m) {
            const valor = (idEl, v) => { const e = document.getElementById(idEl); if (e && document.activeElement !== e) e.value = v; };
            valor("virtualBracoReal", m.bracoReal);
            valor("virtualRaioReal", m.raioReal);
            valor("virtualQtrAvanco", m.qtrAvanco);
            m.inversao.forEach((v, i) => { const e = document.getElementById("virtualInv" + (i + 1)); if (e) e.checked = v; });
        }
        const aviso = document.getElementById("virtualAviso");
        if (aviso) {
            const planta = plantaPublicada();
            aviso.hidden = planta.nos.length > 0;
        }
        atualizarPainel();
        desenhar();
    }

    function ligarBotoes() {
        const $ = id => document.getElementById(id);
        $("virtualNovo")?.addEventListener("click", () => criarNovo().catch(e => ui.aviso("Não foi possível iniciar o AGV virtual: " + e.message, "erro")));
        $("virtualLista")?.addEventListener("click", e => {
            const b = e.target.closest("[data-virtual]");
            if (!b) return;
            selecionado = b.dataset.virtual;
            renderizarTela();
        });
        $("virtualLigar")?.addEventListener("click", () => {
            if (!selecionado) return;
            if (instancias[selecionado]) {
                desligar(selecionado);
                renderizarTela();
            } else {
                ligar(selecionado).then(renderizarTela).catch(e => ui.aviso(e.message, "erro"));
            }
        });
        $("virtualRemover")?.addEventListener("click", () => selecionado && remover(selecionado));
        $("virtualAbrirPainel")?.addEventListener("click", () => {
            if (!selecionado) return;
            selecionarAGV(selecionado);
        });
        $("virtualPausar")?.addEventListener("click", () => {
            const inst = instancias[selecionado];
            if (inst) inst.pausado = !inst.pausado;
            atualizarPainel();
        });
        document.querySelectorAll("[data-velocidade]").forEach(b => b.addEventListener("click", () => {
            const inst = instancias[selecionado];
            if (!inst) return;
            inst.mundo.velocidade = Number(b.dataset.velocidade);
            salvarConfiguracaoMundo(inst);
            atualizarPainel();
        }));
        $("virtualReiniciar")?.addEventListener("click", () => selecionado && ligar(selecionado, 1).then(renderizarTela));
        $("virtualBrownout")?.addEventListener("click", () => selecionado && ligar(selecionado, 9).then(renderizarTela));
        $("virtualBroker")?.addEventListener("change", e => {
            const inst = instancias[selecionado];
            if (!inst) return;
            inst.brokerDisponivel = e.target.checked;
            inst.exp.vi_broker(e.target.checked ? 1 : 0);
            if (e.target.checked) entregarRetidos(inst);
        });

        // painel físico
        $("virtualStart")?.addEventListener("click", () => pulsar(selecionado, BITS.START));
        $("virtualRearme")?.addEventListener("click", () => pulsar(selecionado, BITS.REARME));
        $("virtualStartMissao")?.addEventListener("click", () => pulsar(selecionado, BITS.START_MISSAO));
        $("virtualStop")?.addEventListener("click", () => {
            const inst = instancias[selecionado];
            if (inst) alternar(selecionado, BITS.STOP, !bit(inst, BITS.STOP));
            atualizarPainel();
        });
        $("virtualEstop")?.addEventListener("click", () => {
            const inst = instancias[selecionado];
            if (inst) alternar(selecionado, BITS.ESTOP, !bit(inst, BITS.ESTOP));
            atualizarPainel();
        });
        $("virtualSeletora")?.addEventListener("click", () => {
            const inst = instancias[selecionado];
            if (inst) alternar(selecionado, BITS.SELETORA, !bit(inst, BITS.SELETORA));
            atualizarPainel();
        });

        // posicionar / obstáculos
        $("virtualColocar")?.addEventListener("click", () => {
            const planta = plantaPublicada();
            const no = Planta.noPorId(planta, $("virtualPonto")?.value);
            if (!no || !selecionado) return;
            posicionar(selecionado, no.x, no.y, Number($("virtualOrientacao")?.value) || 0, $("virtualInformar")?.checked);
            desenhar();
        });
        document.querySelectorAll("[data-modo-clique]").forEach(b => b.addEventListener("click", () => {
            modoClique = modoClique === b.dataset.modoClique ? null : b.dataset.modoClique;
            document.querySelectorAll("[data-modo-clique]").forEach(x => x.classList.toggle("ativo", x.dataset.modoClique === modoClique));
            const container = $("virtualMapa");
            if (container) container.dataset.modo = modoClique || "";
        }));
        $("virtualLimparObstaculos")?.addEventListener("click", () => {
            const inst = instancias[selecionado];
            if (!inst) return;
            inst.obstaculos = [];
            atualizarObstaculos(inst);
        });

        // hardware simulado
        const aplicarHardware = () => {
            if (!selecionado) return;
            const m = instancias[selecionado]?.mundo || configuracaoMundo(selecionado);
            m.bracoReal = Number($("virtualBracoReal")?.value) || 0.15;
            m.raioReal = Number($("virtualRaioReal")?.value) || 0.036;
            m.qtrAvanco = Number($("virtualQtrAvanco")?.value) || 0.10;
            m.inversao = [1, 2, 3, 4].map(i => Boolean($("virtualInv" + i)?.checked));
            const inst = instancias[selecionado];
            if (inst) {
                aplicarGeometria(inst);
                salvarConfiguracaoMundo(inst);
            } else {
                localStorage.setItem(CHAVE_CONFIG + selecionado, JSON.stringify(m));
            }
        };
        ["virtualBracoReal", "virtualRaioReal", "virtualQtrAvanco", "virtualInv1", "virtualInv2", "virtualInv3", "virtualInv4"]
            .forEach(id => $(id)?.addEventListener("change", aplicarHardware));
        $("virtualApagarMemoria")?.addEventListener("click", async () => {
            if (!selecionado) return;
            if (!(await ui.confirmar({ titulo: "Apagar a memória do AGV virtual?", texto: `O AGV ${selecionado} volta como saiu da fábrica (parâmetros, calibrações e contadores).`, confirmar: "Apagar", perigo: true }))) return;
            localStorage.removeItem(CHAVE_NVS + selecionado);
            localStorage.removeItem(CHAVE_ARQUIVOS + selecionado);
            if (instancias[selecionado]) ligar(selecionado).then(renderizarTela);
        });
    }

    function adicionarObstaculo(id, x, y, largura = 0.3, profundidade = 0.3) {
        const inst = instancias[id];
        if (!inst) return;
        inst.obstaculos.push({ x, y, largura, profundidade });
        atualizarObstaculos(inst);
    }

    // Religa os AGVs virtuais que estavam ligados quando a página fechou
    function retomar() {
        const ativos = Object.values(agvs).filter(a => a.virtual && a.virtualAtivo);
        if (!ativos.length) return;
        ativos.reduce((p, agv) => p.then(() => ligar(agv.id)), Promise.resolve())
            .catch(e => console.warn("AGV virtual:", e.message));
    }

    return {
        ligar, desligar, receberComando, pulsar, alternar, posicionar, abrir, criarNovo, adicionarObstaculo,
        retomar, ligarBotoes, instancias, BITS, esquecerTrafego,
        _passo: passo
    };
})();
