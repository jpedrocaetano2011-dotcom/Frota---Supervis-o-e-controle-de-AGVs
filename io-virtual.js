/* ============================================================
   ECITON I/O VIRTUAL (0.19)
   ============================================================
   O firmware real do módulo (ECITON_IO.ino em WebAssembly, no
   io-virtual-wasm.js) rodando no navegador, ligado aos AGVs virtuais
   pelo mesmo "broker" de mentira do agv-virtual.js. A porta é
   simulada: a folha leva PORTA_S segundos para abrir ou fechar, os
   sensores "aberta" e "fechada" seguem a folha, e a folha fechada é
   um obstáculo para o sensor de distância dos Atta virtuais. Dá para
   emperrar a porta, apertar o botão do cruzamento e disparar o alarme.
*/

const IoVirtual = (function () {
    "use strict";

    const CHAVE = "ioVirtualAtivos";
    const PORTA_S = 2.5;
    let modulo = null, carregando = null, laco = null, ultimo = 0;
    const inst = {};

    const planta = () => (typeof plantaPublicada === "function" ? plantaPublicada() : null);
    const lerAtivos = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch (e) { return []; } };
    const gravarAtivos = () => { try { localStorage.setItem(CHAVE, JSON.stringify(Object.keys(inst))); } catch (e) { /* ignora */ } };
    function empresa() {
        try { const c = window.Nuvem && Nuvem.empresa && Nuvem.empresa()?.codigo; if (c && /^[a-z0-9-]{1,24}$/.test(c)) return c; } catch (e) { /* ignora */ }
        return "demo";
    }

    function carregarScript(src) {
        return new Promise((ok, erro) => {
            const s = document.createElement("script");
            s.src = src; s.onload = ok; s.onerror = () => erro(new Error("Não foi possível carregar " + src));
            document.head.appendChild(s);
        });
    }
    function carregarModulo() {
        if (modulo) return Promise.resolve(modulo);
        if (carregando) return carregando;
        carregando = (async () => {
            if (!window.IO_VIRTUAL_WASM) await carregarScript("io-virtual-wasm.js");
            modulo = await WebAssembly.compile(Uint8Array.from(atob(window.IO_VIRTUAL_WASM), c => c.charCodeAt(0)));
            return modulo;
        })();
        return carregando;
    }
    function lerTexto(m, p) { const b = new Uint8Array(m.buffer, p); let f = 0; while (b[f] !== 0) f++; return new TextDecoder().decode(b.subarray(0, f)); }
    function escrever(i, p, texto, max) {
        const bytes = new TextEncoder().encode(texto);
        const n = Math.min(bytes.length, max - 1);
        const d = new Uint8Array(i.memoria.buffer, p, max);
        d.set(bytes.subarray(0, n)); d[n] = 0;
        return n;
    }
    function mqtt(i, topico, payload) {
        escrever(i, i.ptrT, topico, 160);
        i.exp.vi_mqtt(escrever(i, i.ptrP, payload, i.tamP));
    }

    // Portas e cruzamentos deste módulo na planta publicada
    function montarObjetos(i) {
        const p = planta();
        const antes = i.portas || {};
        i.portas = {};
        i.cruz = {};
        if (!p) return;
        Planta.objetosIo(p, i.id).forEach(o => {
            if (Planta.TIPOS_LAYOUT[o.tipo].regra === "PORTA") i.portas[o.id] = Object.assign({ pos: 0, emperrada: false }, antes[o.id] || {}, { objeto: o });
            else i.cruz[o.id] = { objeto: o, ateMs: 0 };
        });
        const d = (p.dispositivos || []).find(x => x.id === i.id);
        i.alarmeCfg = d?.alarme || null;
    }

    function aplicarEntradas(i) {
        const t = i.exp.vi_tempo_ms();
        const ativas = new Set();
        Object.values(i.portas).forEach(pt => {
            if (pt.objeto.io.aberta && pt.pos >= 0.98) ativas.add(pt.objeto.io.aberta);
            if (pt.objeto.io.fechada && pt.pos <= 0.02) ativas.add(pt.objeto.io.fechada);
        });
        Object.values(i.cruz).forEach(c => { if (c.objeto.io.botao && c.ateMs > t) ativas.add(c.objeto.io.botao); });
        if (i.alarmeCfg) { const contato = i.alarmeCfg.nf ? !i.emAlarme : i.emAlarme; if (contato) ativas.add(i.alarmeCfg.entrada); }
        for (let n = 1; n <= 4; n++) i.exp.vi_entrada(n, ativas.has(n) ? 1 : 0);
    }

    async function ligar(id) {
        await carregarModulo();
        desligar(id, false);
        const i = { id, fila: [], portas: {}, cruz: {}, emAlarme: false };
        const wasi = {
            fd_write: (fd, iovs, n, esc) => { const m = new DataView(i.memoria.buffer); let t = 0; for (let k = 0; k < n; k++) t += m.getUint32(iovs + k * 8 + 4, true); m.setUint32(esc, t, true); return 0; },
            fd_close: () => 0, fd_seek: () => 0, fd_fdstat_get: () => 0
        };
        const env = { js_publicar: (pt, pp, r) => i.fila.push([lerTexto(i.memoria, pt), lerTexto(i.memoria, pp), Boolean(r)]) };
        const instancia = await WebAssembly.instantiate(modulo, { env, wasi_snapshot_preview1: wasi });
        i.exp = instancia.exports;
        i.memoria = i.exp.memory;
        i.exp._initialize();
        i.ptrT = i.exp.vi_buffer_topico();
        i.ptrP = i.exp.vi_buffer_payload();
        i.tamP = i.exp.vi_tamanho_payload();
        i.base = `agv/${empresa()}/${id}/`;
        escrever(i, i.ptrT, `${empresa()}/${id}`, 160);
        i.exp.vi_identidade();
        montarObjetos(i);
        aplicarEntradas(i);
        i.exp.vi_iniciar();
        inst[id] = i;
        const p = planta();
        const cfg = p && Planta.configIO(p, id);
        if (cfg) mqtt(i, i.base + "config/io", JSON.stringify(cfg));
        // o que os AGVs virtuais já publicaram (retido)
        if (typeof AgvVirtual !== "undefined" && AgvVirtual.retidosTrafego) AgvVirtual.retidosTrafego().forEach(([t, v]) => mqtt(i, t, v));
        gravarAtivos();
        iniciarLaco();
        return i;
    }

    // Desliga o módulo virtual: com "ultimaVontade", o broker de mentira entrega
    // o que o firmware deixou combinado (todas as zonas ocupadas), como no real.
    function desligar(id, ultimaVontade = true) {
        const i = inst[id];
        if (!i) return;
        delete inst[id];
        if (ultimaVontade) {
            const topico = lerTexto(i.memoria, i.exp.vi_will_topico()), payload = lerTexto(i.memoria, i.exp.vi_will_mensagem());
            if (topico) entregar(topico, payload, true);
        }
        gravarAtivos();
        if (typeof AgvVirtual !== "undefined" && AgvVirtual.atualizarObstaculosTodos) AgvVirtual.atualizarObstaculosTodos();
    }

    // Publicação de um módulo -> AGVs virtuais (tráfego) e o site
    function entregar(topico, payload, retido) {
        if (topico.endsWith("/status/trafego") && typeof AgvVirtual !== "undefined" && AgvVirtual.entregarTrafegoExterno) {
            AgvVirtual.entregarTrafegoExterno(topico, payload, retido);
        }
        const m = /^agv\/[^/]+\/([^/]+)\/(.+)$/.exec(topico);
        if (m && typeof processarMensagemMQTT === "function") processarMensagemMQTT(`agv/${m[1]}/${m[2]}`, payload);
    }

    function iniciarLaco() {
        if (laco) return;
        ultimo = performance.now();
        laco = setInterval(passo, 20);
    }

    function passo() {
        const ids = Object.keys(inst);
        if (!ids.length) { clearInterval(laco); laco = null; return; }
        const agora = performance.now();
        const dt = Math.min(100, agora - ultimo);
        ultimo = agora;
        const vel = typeof AgvVirtual !== "undefined" && AgvVirtual.velocidade ? AgvVirtual.velocidade() : 1;
        const ms = Math.max(1, Math.round(dt * vel));
        let mudouObstaculo = false;
        ids.forEach(id => {
            const i = inst[id];
            if (!i) return;
            Object.values(i.portas).forEach(pt => {
                const abrir = pt.objeto.io.rele && i.exp.vi_rele(pt.objeto.io.rele) === 1;
                const antes = pt.pos < 0.95;
                if (!pt.emperrada) pt.pos = Math.max(0, Math.min(1, pt.pos + (abrir ? 1 : -1) * ms / (PORTA_S * 1000)));
                if ((pt.pos < 0.95) !== antes) mudouObstaculo = true;
            });
            aplicarEntradas(i);
            i.exp.vi_passo(ms);
            const fila = i.fila;
            i.fila = [];
            fila.forEach(([t, v, r]) => entregar(t, v, r));
        });
        if (mudouObstaculo && typeof AgvVirtual !== "undefined" && AgvVirtual.atualizarObstaculosTodos) AgvVirtual.atualizarObstaculosTodos();
        if (mudouObstaculo && typeof Dispositivos !== "undefined") Dispositivos.agendar();
    }

    /* ---------------- ligação com o resto ---------------- */

    // status/trafego dos AGVs virtuais
    function receberTrafego(topico, payload) {
        Object.values(inst).forEach(i => { if (!topico.startsWith(i.base)) mqtt(i, topico, payload); });
    }
    function receberConfig(id, cfg) {
        const i = inst[id];
        if (!i) return false;
        montarObjetos(i);
        mqtt(i, i.base + "config/io", JSON.stringify(cfg));
        return true;
    }
    function comando(id, obj) {
        const i = inst[id];
        if (!i) return false;
        mqtt(i, i.base + "comando/io", JSON.stringify(obj));
        return true;
    }
    function aoPublicarPlanta() {
        const p = planta();
        Object.keys(inst).forEach(id => {
            if (!p || !(p.dispositivos || []).some(d => d.id === id)) { desligar(id, false); esquecer(id); return; }
            montarObjetos(inst[id]);
        });
    }
    // Folhas fechadas (obstáculo para os Atta virtuais)
    function obstaculos() {
        const lista = [];
        Object.values(inst).forEach(i => Object.values(i.portas).forEach(pt => {
            if (pt.pos < 0.95) { const o = pt.objeto; lista.push({ x: o.x, y: o.y, largura: o.largura, profundidade: Math.min(o.profundidade, 0.2), rotacao: o.rotacao || 0 }); }
        }));
        return lista;
    }
    // Esquece o estado retido do módulo (zonas liberadas)
    function esquecer(id) {
        entregar(`agv/${empresa()}/${id}/status/trafego`, "", true);
    }

    async function simular(id, ligado) {
        try {
            if (ligado) await ligar(id);
            else { desligar(id, false); esquecer(id); }
        } catch (e) {
            ui.aviso("Não foi possível ligar o I/O virtual: " + e.message, "erro");
        }
    }

    function iniciar() {
        const p = planta();
        lerAtivos().forEach(id => { if (p && (p.dispositivos || []).some(d => d.id === id)) ligar(id).catch(() => {}); });
    }
    setTimeout(iniciar, 1500);

    return {
        ativo: id => Boolean(inst[id]),
        simular, ligar, desligar, esquecer,
        receberTrafego, receberConfig, comando, aoPublicarPlanta, obstaculos,
        emperrar: (id, porta, sim) => { const pt = inst[id]?.portas[porta]; if (pt) pt.emperrada = Boolean(sim); },
        emperrada: (id, porta) => Boolean(inst[id]?.portas[porta]?.emperrada),
        apertarBotao: (id, objeto) => { const i = inst[id]; const c = i?.cruz[objeto]; if (c) c.ateMs = i.exp.vi_tempo_ms() + 800; },
        alarme: (id, sim) => { const i = inst[id]; if (i) i.emAlarme = Boolean(sim); },
        emAlarme: id => Boolean(inst[id]?.emAlarme),
        portaPosicao: (id, porta) => inst[id]?.portas[porta]?.pos ?? null,
        instancias: inst
    };
})();
