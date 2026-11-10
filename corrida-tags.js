/* ============================================================
   CORRIDA DAS TAGS E ESCANEAR (0.20) — Planta (editor)
   ============================================================
   Escanear: no campo "Tag RFID" de um ponto, o Eciton espera a PRÓXIMA
   leitura do Atta escolhido (parado ou em MANUAL; nunca um em missão).
   Leituras de outros Atta e as de antes do clique não contam.

   Corrida: um modo do editor (como o Alinhar do DXF). Você monta a
   sequência de pontos (seguindo a fita de um ponto a outro, ou clicando
   na ordem), escolhe quem lê (um Atta ou o leitor USB do computador) e
   dá Start: o Eciton destaca o ponto da vez e grava a tag lida nele,
   avança sozinho e para quando há conflito (tag repetida, Atta longe).
   A corrida só preenche tags: os pontos e os tipos vêm da planta.
   No fim, tudo fica no rascunho; publicar continua o passo normal.

   Leitor USB: os de 125 kHz (EM4100, o mesmo tipo do RDM6300 do Atta)
   funcionam como teclado. Muitos digitam o número em decimal (10
   dígitos): o Eciton converte para hexadecimal e completa o prefixo com
   o das outras tags da planta. Teste com uma tag antes de confiar.
*/
const CorridaTags = (function () {
    const ESPERA_MS = 60000, LONGE_M = 3;
    let escaneando = null;   // { no, agv, desde, seq, ate }
    let corrida = null;      // { etapa, lista, i, leitor, pularComTag, lidas, puladas, conflito, inicio, fim }
    let ultimoSelecionado = null;
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const ed = () => window.EditorPlanta;
    const planta = () => ed()?.rascunho();
    const nomeTipo = t => ({ ESTACAO: "estação", BERCO: "berço", ESPERA: "espera", REFERENCIA: "referência" })[t] || t;

    // Quem pode ler: Atta online, parado ou em MANUAL, sem missão andando
    function leitores() {
        if (typeof agvs === "undefined") return [];
        return Object.values(agvs).filter(a => a.online && !["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"].includes(a.estadoMissao))
            .sort((a, b) => String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }));
    }
    function leitorPadrao() {
        const l = leitores();
        const sel = typeof agvSelecionado !== "undefined" ? agvSelecionado : null;
        return (l.find(a => a.id === sel) || l.find(a => a.modo === "MANUAL") || l[0])?.id || "USB";
    }
    // Distância (m) da última posição conhecida do Atta até o ponto (null = não sabe)
    function distancia(agvId, noId) {
        const a = typeof agvs !== "undefined" ? agvs[agvId] : null, pl = planta();
        const no = pl && Planta.noPorId(pl, noId);
        if (!a || !no) return null;
        const pub = typeof plantaPublicada === "function" ? plantaPublicada() : pl;
        const base = a.posicaoConhecida && a.pontoAtual ? a.pontoAtual : a.poseOdometria?.base;
        const ref = base && (Planta.noPorId(pl, base) || Planta.noPorId(pub, base));
        if (!ref) return null;
        return Math.hypot(ref.x - no.x, ref.y - no.y);
    }
    // Tag de leitor USB: hexadecimal de 10, ou decimal de 10 dígitos (último 8 hex)
    function normalizarDigitada(texto) {
        const t = String(texto || "").trim().replace(/\s+/g, "");
        if (/^[0-9A-Fa-f]{10}$/.test(t) && /[A-Fa-f]/.test(t)) return { codigo: t.toUpperCase(), convertido: false };
        if (/^\d{8,10}$/.test(t)) {
            const n = Number(t);
            if (n > 0xFFFFFFFF) return /^[0-9A-Fa-f]{10}$/.test(t) ? { codigo: t.toUpperCase(), convertido: false } : null;
            const prefixos = {};
            (planta()?.nos || []).forEach(no => { if (/^[0-9A-F]{10}$/.test(no.rfid || "")) prefixos[no.rfid.slice(0, 2)] = (prefixos[no.rfid.slice(0, 2)] || 0) + 1; });
            const pre = Object.entries(prefixos).sort((a, b) => b[1] - a[1])[0]?.[0] || "00";
            return { codigo: pre + n.toString(16).toUpperCase().padStart(8, "0"), convertido: true, prefixo: pre };
        }
        if (/^[0-9A-Fa-f]{10}$/.test(t)) return { codigo: t.toUpperCase(), convertido: false };
        return null;
    }
    const donoDaTag = (codigo, menos) => (planta()?.nos || []).find(n => n.id !== menos && Planta.normalizarRfid(n.rfid || "") === codigo) || null;

    function gravar(noId, codigo, tirarDe) {
        if (!ed()?.alterarComDesfazer || !Planta.noPorId(planta(), noId)) return false;
        ed().alterarComDesfazer(pl => {
            if (tirarDe) { const outro = Planta.noPorId(pl, tirarDe); if (outro) outro.rfid = ""; }
            Planta.noPorId(pl, noId).rfid = Planta.normalizarRfid(codigo);
        });
        return true;
    }

    /* ---------------- Escanear avulso (campo Tag RFID) ---------------- */

    function htmlEscanear(no) {
        if (corrida) return "";
        const ls = leitores();
        if (escaneando && escaneando.no === no.id) {
            const resta = Math.max(0, Math.ceil((escaneando.ate - Date.now()) / 1000));
            return `<div class="editor-esperando corrida-escaneando"><b>Passe a tag no ${escaneando.agv === "USB" ? "leitor USB" : "AGV " + esc(escaneando.agv)}…</b>
                <small class="suave">${escaneando.agv === "USB" ? "Clique no campo abaixo e encoste a tag no leitor." : `Só vale a próxima leitura do AGV ${esc(escaneando.agv)}. Espera ${resta} s.`}</small>
                ${escaneando.agv === "USB" ? `<input type="text" class="corrida-usb" data-corrida-usb="avulso" placeholder="a tag aparece aqui" autocomplete="off" spellcheck="false">` : ""}
                <button class="btn btn-mini" data-corrida="cancelarEscanear">Cancelar</button></div>`;
        }
        return `<div class="corrida-escanear">
            <select data-corrida-leitor="avulso" aria-label="Quem lê">${ls.map(a => `<option value="${esc(a.id)}" ${a.id === leitorPadrao() ? "selected" : ""}>AGV ${esc(a.id)}${a.modo === "MANUAL" ? " · manual" : ""}</option>`).join("")}<option value="USB" ${!ls.length ? "selected" : ""}>Leitor USB</option></select>
            <button class="btn btn-mini" data-corrida="escanear" data-no="${esc(no.id)}">Escanear</button>
            <button class="btn btn-mini" data-corrida="iniciarCorrida">Corrida das tags…</button>
        </div>
        ${ultimaRecente(no)}`;
    }
    // "AGV 2 leu 0A…1C há 12 s · usar" (o Atta já parado em cima da tag não lê de novo)
    function ultimaRecente(no) {
        const a = typeof agvs !== "undefined" ? agvs[leitorPadrao()] : null;
        const r = a?.sensores?.rfid;
        if (!r?.ultimo || !r.quando || Date.now() - r.quando > 120000) return "";
        const c = Planta.normalizarRfid(r.ultimo);
        if (c === no.rfid) return `<small class="editor-rfid-atual">AGV ${esc(a.id)} leu ${esc(c)}: já é a tag deste ponto</small>`;
        return `<button class="btn btn-mini corrida-recente" data-corrida="usarRecente" data-no="${esc(no.id)}" data-rfid="${esc(c)}">Usar ${esc(c)} <em>lida pelo AGV ${esc(a.id)} há ${Math.round((Date.now() - r.quando) / 1000)} s</em></button>`;
    }

    /* ---------------- Corrida ---------------- */

    // Seguir a fita de um ponto a outro (menor caminho pelos trechos, ida e volta)
    function seguirFita(de, ate) {
        const pl = planta();
        const viz = {};
        (pl.segmentos || []).forEach(s => { (viz[s.a] = viz[s.a] || []).push(s.b); (viz[s.b] = viz[s.b] || []).push(s.a); });
        const ant = { [de]: null }, fila = [de];
        while (fila.length) {
            const x = fila.shift();
            if (x === ate) break;
            (viz[x] || []).forEach(y => { if (!(y in ant)) { ant[y] = x; fila.push(y); } });
        }
        if (!(ate in ant)) return null;
        const caminho = [];
        for (let x = ate; x != null; x = ant[x]) caminho.unshift(x);
        return caminho;
    }

    function iniciar() {
        const pl = planta();
        if (!pl) return;
        corrida = { etapa: "montar", lista: [], i: 0, leitor: leitorPadrao(), pularComTag: true, lidas: {}, puladas: [], conflito: null,
            inicio: pl.nos[0]?.id || "", fim: pl.nos[pl.nos.length - 1]?.id || "" };
        escaneando = null;
        redesenhar();
    }
    function sair() { corrida = null; escaneando = null; redesenhar(); }
    function redesenhar() {
        const e = ed();
        if (e?.renderizarPropriedades) e.renderizarPropriedades();
        if (e?.redesenhar) e.redesenhar();
    }
    const listaEfetiva = () => corrida.lista.filter(id => !(corrida.pularComTag && corrida.etapa === "rodando" && corrida.jaTinha?.includes(id)));

    function htmlLinhaNo(id, i, atual) {
        const no = Planta.noPorId(planta(), id);
        if (!no) return "";
        const est = no.tipo === "ESTACAO" ? Planta.estacaoPorId(planta(), no.estacao) : null;
        const nome = no.nome || est?.nome || "";
        const lida = corrida.lidas[id];
        const pulada = corrida.puladas.includes(id);
        return `<li class="corrida-item ${atual ? "atual" : ""} ${lida ? "lida" : ""} ${pulada ? "pulada" : ""}" data-corrida-item="${esc(id)}">
            <span class="corrida-num">${i + 1}</span>
            <span class="corrida-no"><b>${esc(id)}</b> · ${esc(nomeTipo(no.tipo))}${nome ? " · " + esc(nome) : ""}</span>
            <span class="corrida-tag">${lida ? `✓ ${esc(lida)}` : pulada ? "pulado" : no.rfid ? `<span class="suave">${esc(no.rfid)}</span>` : `<span class="suave">sem tag</span>`}</span>
            ${corrida.etapa === "montar" ? `<span class="corrida-mover"><button class="btn btn-mini" data-corrida="subir" data-i="${i}" aria-label="Subir">↑</button><button class="btn btn-mini" data-corrida="descer" data-i="${i}" aria-label="Descer">↓</button><button class="btn btn-mini btn-perigo" data-corrida="tirar" data-i="${i}" aria-label="Tirar">✕</button></span>` : ""}
        </li>`;
    }

    function htmlControleManual() {
        if (corrida.leitor === "USB") return "";
        const a = typeof agvs !== "undefined" ? agvs[corrida.leitor] : null;
        if (!a) return "";
        const manual = a.modo === "MANUAL";
        return `<div class="corrida-manual"><span class="editor-subtitulo">Controle manual · AGV ${esc(a.id)}</span>
            ${manual ? `<div class="corrida-manual-botoes">
                <span></span><button class="btn" data-corrida-mover="frente" aria-label="Frente">▲</button><span></span>
                <button class="btn" data-corrida-mover="esquerda" aria-label="Esquerda">◀</button><button class="btn" data-corrida-mover="girar" aria-label="Girar">⟲</button><button class="btn" data-corrida-mover="direita" aria-label="Direita">▶</button>
                <span></span><button class="btn" data-corrida-mover="re" aria-label="Ré">▼</button><span></span></div>
                <small class="suave">Segure para andar; solte para parar. Os sensores continuam valendo.</small>`
                : `<small class="suave">Passe a seletora do AGV ${esc(a.id)} para MANUAL para manobrar por aqui (ou empurre/leve o Atta até o ponto).</small>`}</div>`;
    }

    function html(pl, sel) {
        // clique num ponto do mapa durante a corrida
        if (sel?.tipo === "no" && sel.id !== ultimoSelecionado) { ultimoSelecionado = sel.id; clicouNo(sel.id); }
        if (!sel) ultimoSelecionado = null;
        const c = corrida;
        const opcoesNos = pl.nos.map(n => `<option value="${esc(n.id)}">${esc(n.id)} · ${esc(nomeTipo(n.tipo))}</option>`);
        const opcoesLeitor = leitores().map(a => `<option value="${esc(a.id)}" ${a.id === c.leitor ? "selected" : ""}>AGV ${esc(a.id)}${a.modo === "MANUAL" ? " · manual" : ""}</option>`).join("") +
            `<option value="USB" ${c.leitor === "USB" ? "selected" : ""}>Leitor USB no computador</option>`;
        if (c.etapa === "montar") {
            return `<p class="editor-texto">Escolha os pontos na ordem em que o Atta vai passar. A corrida só grava as tags: os pontos e os tipos vêm da planta.</p>
                <div class="editor-bloco"><span class="editor-subtitulo">Seguir a fita</span>
                    <div class="editor-linha">
                        <label class="editor-campo"><span>De</span><select data-corrida-campo="inicio">${opcoesNos.map(o => o.replace(`value="${esc(c.inicio)}"`, `value="${esc(c.inicio)}" selected`)).join("")}</select></label>
                        <label class="editor-campo"><span>Até</span><select data-corrida-campo="fim">${opcoesNos.map(o => o.replace(`value="${esc(c.fim)}"`, `value="${esc(c.fim)}" selected`)).join("")}</select></label>
                    </div>
                    <div class="editor-acoes"><button class="btn btn-mini" data-corrida="seguir">Preencher pela fita</button><button class="btn btn-mini" data-corrida="todos">Todos os pontos</button><button class="btn btn-mini" data-corrida="limpar">Limpar</button></div>
                    <small class="suave">Ou clique nos pontos do mapa, na ordem (clicar de novo tira).</small>
                </div>
                <ol class="corrida-lista">${c.lista.map((id, i) => htmlLinhaNo(id, i, false)).join("") || `<li class="suave">Nenhum ponto ainda.</li>`}</ol>
                <label class="editor-campo editor-check"><input type="checkbox" data-corrida-campo="pularComTag" ${c.pularComTag ? "checked" : ""}> <span>Pular os que já têm tag</span></label>
                <label class="editor-campo"><span>Quem lê</span><select data-corrida-campo="leitor">${opcoesLeitor}</select></label>
                <small class="suave">Só aparecem os Atta parados ou em MANUAL. Atta em missão nunca lê para a corrida.</small>
                <div class="editor-acoes"><button class="btn btn-primario" data-corrida="start" ${c.lista.length ? "" : "disabled"}>Start</button><button class="btn" data-corrida="sair">Cancelar</button></div>`;
        }
        if (c.etapa === "rodando") {
            const lista = listaEfetiva();
            const id = lista[c.i];
            const no = id && Planta.noPorId(pl, id);
            const est = no?.tipo === "ESTACAO" ? Planta.estacaoPorId(pl, no.estacao) : null;
            const conf = c.conflito;
            return `<div class="corrida-cartao">
                    <small class="suave">${Math.min(c.i + 1, lista.length)} de ${lista.length}</small>
                    ${no ? `<b class="corrida-proximo">Próximo: ${esc(no.id)} · ${esc(nomeTipo(no.tipo))}${no.nome || est?.nome ? " · " + esc(no.nome || est?.nome) : ""}</b>
                        <span>${c.leitor === "USB" ? "Encoste a tag deste ponto no leitor USB." : `Leve o AGV ${esc(c.leitor)} até lá e pare em cima da tag.`}</span>
                        ${c.leitor === "USB" ? `<input type="text" class="corrida-usb" data-corrida-usb="corrida" placeholder="a tag aparece aqui" autocomplete="off" spellcheck="false">` : ""}`
                        : `<b>Fim da sequência.</b>`}
                </div>
                ${conf ? `<div class="missao-dica ambar corrida-conflito"><b>${esc(conf.texto)}</b>
                    <div class="editor-acoes"><button class="btn btn-mini btn-primario" data-corrida="aceitar">${esc(conf.aceitar)}</button><button class="btn btn-mini" data-corrida="ignorar">Ignorar esta leitura</button></div></div>` : ""}
                <div class="editor-acoes"><button class="btn btn-mini" data-corrida="voltar" ${c.i > 0 ? "" : "disabled"}>Voltar</button><button class="btn btn-mini" data-corrida="pular" ${no ? "" : "disabled"}>Pular</button><button class="btn btn-mini" data-corrida="pausar">Pausar</button><button class="btn btn-mini btn-primario" data-corrida="encerrar">Encerrar</button></div>
                ${htmlControleManual()}
                <ol class="corrida-lista">${lista.map((x, i) => htmlLinhaNo(x, i, i === c.i)).join("")}</ol>`;
        }
        // fim
        const nLidas = Object.keys(c.lidas).length;
        return `<div class="corrida-cartao"><b>Corrida encerrada</b>
                <span>${nLidas} tag${nLidas === 1 ? "" : "s"} gravada${nLidas === 1 ? "" : "s"} · ${c.puladas.length} pulado${c.puladas.length === 1 ? "" : "s"}${c.conflitos ? ` · ${c.conflitos} conflito${c.conflitos === 1 ? "" : "s"}` : ""}</span>
                <small class="suave">As tags estão no rascunho. Confira na validação e publique a planta.</small></div>
            <ol class="corrida-lista">${c.lista.map((x, i) => htmlLinhaNo(x, i, false)).join("")}</ol>
            <div class="editor-acoes"><button class="btn btn-primario" data-corrida="sair">Fechar</button><button class="btn" data-corrida="reabrir">Montar outra</button></div>`;
    }

    function clicouNo(id) {
        if (!corrida) return;
        if (corrida.etapa === "montar") {
            corrida.lista = corrida.lista.includes(id) ? corrida.lista.filter(x => x !== id) : corrida.lista.concat([id]);
        } else if (corrida.etapa === "rodando") {
            const i = listaEfetiva().indexOf(id);
            if (i >= 0) { corrida.i = i; corrida.conflito = null; }
        }
    }

    function focarAtual() {
        if (!corrida || corrida.etapa !== "rodando") return;
        const id = listaEfetiva()[corrida.i];
        if (id && ed()) { ultimoSelecionado = id; ed().selecionar("no", id); }
        setTimeout(() => document.querySelector('[data-corrida-usb="corrida"]')?.focus(), 30);
    }
    function avancar() {
        corrida.conflito = null;
        corrida.i++;
        if (corrida.i >= listaEfetiva().length) { corrida.etapa = "fim"; redesenhar(); return; }
        focarAtual();
        redesenhar();
    }

    // Uma tag chegou (do Atta escolhido ou do leitor USB)
    function recebeu(codigo, origem, forcar = false) {
        const c = Planta.normalizarRfid(codigo);
        if (escaneando && !corrida) {
            const dono = donoDaTag(c, escaneando.no);
            if (dono && !forcar) {
                ui.confirmar({ titulo: "Tag repetida", texto: `A tag ${c} já é do ponto ${dono.id}. Passar para ${escaneando.no} (e tirar de ${dono.id})?`, confirmar: "Passar para este ponto" })
                    .then(sim => { if (sim) { gravar(escaneando.no, c, dono.id); ui.aviso(`Tag ${c} gravada em ${escaneando.no}.`, "sucesso"); } escaneando = null; redesenhar(); });
                return;
            }
            gravar(escaneando.no, c);
            ui.aviso(`Tag ${c} gravada em ${escaneando.no}${origem !== "USB" ? ` (lida pelo AGV ${origem})` : ""}.`, "sucesso");
            escaneando = null;
            redesenhar();
            return;
        }
        if (!corrida || corrida.etapa !== "rodando" || corrida.conflito) return;
        const id = listaEfetiva()[corrida.i];
        if (!id) return;
        const no = Planta.noPorId(planta(), id);
        if (Planta.normalizarRfid(no.rfid || "") === c && !forcar) { corrida.lidas[id] = c; bip(true); avancar(); return; }
        const dono = donoDaTag(c, id);
        if (dono) {
            corrida.conflito = { codigo: c, texto: `A tag ${c} já é do ponto ${dono.id}.`, aceitar: `Passar para ${id}`, tirarDe: dono.id };
            corrida.conflitos = (corrida.conflitos || 0) + 1;
            bip(false); redesenhar(); return;
        }
        if (origem !== "USB") {
            const d = distancia(origem, id);
            if (d != null && d > LONGE_M) {
                corrida.conflito = { codigo: c, texto: `O AGV ${origem} estava a ${Math.round(d)} m de ${id} na última posição conhecida. É essa tag mesmo?`, aceitar: "É essa, gravar" };
                corrida.conflitos = (corrida.conflitos || 0) + 1;
                bip(false); redesenhar(); return;
            }
        }
        gravar(id, c);
        corrida.lidas[id] = c;
        bip(true);
        avancar();
    }

    let audio = null;
    function bip(bom) {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            const o = audio.createOscillator(), g = audio.createGain();
            o.frequency.value = bom ? 1320 : 330; g.gain.value = 0.08;
            o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (bom ? 0.12 : 0.3));
        } catch (e) { /* sem som */ }
    }

    // leitura nova de um Atta (script.js dispara ao receber status/sensores/rfid)
    document.addEventListener("rfid-lida", ev => {
        const { agv, codigo, quando } = ev.detail || {};
        if (escaneando && !corrida && escaneando.agv === agv && quando >= escaneando.desde) recebeu(codigo, agv);
        else if (corrida?.etapa === "rodando" && corrida.leitor === agv && quando >= (corrida.desde || 0)) recebeu(codigo, agv);
    });
    setInterval(() => {
        if (escaneando && Date.now() > escaneando.ate) { escaneando = null; ui.aviso("Nenhuma tag lida em 60 s.", "aviso"); redesenhar(); }
        else if (escaneando && escaneando.agv !== "USB") {
            const el = document.querySelector(".corrida-escaneando small");
            if (el) el.textContent = `Só vale a próxima leitura do AGV ${escaneando.agv}. Espera ${Math.max(0, Math.ceil((escaneando.ate - Date.now()) / 1000))} s.`;
        }
    }, 1000);

    // controle manual compacto (segura = anda)
    let movendo = null;
    function mover(direcao) {
        const id = corrida?.leitor;
        if (!id || id === "USB" || typeof publicar !== "function") return;
        const vx = typeof VX_MAX !== "undefined" ? VX_MAX * 0.5 : 0.04, vy = typeof VY_MAX !== "undefined" ? VY_MAX * 0.5 : 0.02, w = typeof W_MAX !== "undefined" ? W_MAX * 0.5 : 0.3;
        const cmd = { frente: { vx, vy: 0, w: 0 }, re: { vx: -vx, vy: 0, w: 0 }, esquerda: { vx: 0, vy, w: 0 }, direita: { vx: 0, vy: -vy, w: 0 }, girar: { vx: 0, vy: 0, w } }[direcao];
        if (!cmd) return;
        parar();
        const enviar = () => publicar("comando/manual", JSON.stringify(cmd), id, 0);
        enviar();
        movendo = setInterval(enviar, 150);
    }
    function parar() {
        if (!movendo) return;
        clearInterval(movendo); movendo = null;
        if (corrida?.leitor && corrida.leitor !== "USB" && typeof publicar === "function") publicar("comando/manual", JSON.stringify({ vx: 0, vy: 0, w: 0 }), corrida.leitor);
    }
    document.addEventListener("pointerdown", e => { const b = e.target.closest("[data-corrida-mover]"); if (b) { e.preventDefault(); mover(b.dataset.corridaMover); } });
    ["pointerup", "pointercancel", "pointerleave"].forEach(t => document.addEventListener(t, e => { if (movendo && (t !== "pointerleave" || e.target.closest?.("[data-corrida-mover]"))) parar(); }, true));

    document.addEventListener("click", e => {
        const b = e.target.closest("[data-corrida]");
        if (!b) return;
        const a = b.dataset.corrida;
        if (a === "escanear") {
            const leitor = document.querySelector('[data-corrida-leitor="avulso"]')?.value || leitorPadrao();
            escaneando = { no: b.dataset.no, agv: leitor, desde: Date.now(), ate: Date.now() + ESPERA_MS };
            redesenhar();
            if (leitor === "USB") setTimeout(() => document.querySelector('[data-corrida-usb="avulso"]')?.focus(), 30);
            return;
        }
        if (a === "cancelarEscanear") { escaneando = null; redesenhar(); return; }
        if (a === "usarRecente") { escaneando = { no: b.dataset.no, agv: "recente", desde: 0, ate: Date.now() + ESPERA_MS }; recebeu(b.dataset.rfid, "recente"); return; }
        if (a === "iniciarCorrida") { iniciar(); return; }
        if (!corrida) return;
        const i = Number(b.dataset.i);
        switch (a) {
            case "seguir": { const c = seguirFita(corrida.inicio, corrida.fim); if (!c) ui.aviso("Não há fita ligando esses dois pontos.", "aviso"); else corrida.lista = c; break; }
            case "todos": corrida.lista = planta().nos.map(n => n.id); break;
            case "limpar": corrida.lista = []; break;
            case "subir": if (i > 0) [corrida.lista[i - 1], corrida.lista[i]] = [corrida.lista[i], corrida.lista[i - 1]]; break;
            case "descer": if (i < corrida.lista.length - 1) [corrida.lista[i + 1], corrida.lista[i]] = [corrida.lista[i], corrida.lista[i + 1]]; break;
            case "tirar": corrida.lista.splice(i, 1); break;
            case "start":
                corrida.jaTinha = corrida.lista.filter(id => Planta.noPorId(planta(), id)?.rfid);
                corrida.etapa = "rodando"; corrida.i = 0; corrida.desde = Date.now(); corrida.lidas = {}; corrida.puladas = []; corrida.conflitos = 0;
                if (!listaEfetiva().length) { ui.aviso("Todos os pontos da lista já têm tag. Desmarque \"Pular os que já têm tag\" para regravar.", "aviso"); corrida.etapa = "montar"; break; }
                redesenhar(); focarAtual(); return;
            case "pular": corrida.puladas.push(listaEfetiva()[corrida.i]); avancar(); return;
            case "voltar": corrida.i = Math.max(0, corrida.i - 1); corrida.conflito = null; delete corrida.lidas[listaEfetiva()[corrida.i]]; focarAtual(); break;
            case "pausar": parar(); corrida.etapa = "montar"; break;
            case "encerrar": parar(); corrida.etapa = "fim"; break;
            case "aceitar": { const cf = corrida.conflito; const id = listaEfetiva()[corrida.i]; corrida.conflito = null; gravar(id, cf.codigo, cf.tirarDe); corrida.lidas[id] = cf.codigo; avancar(); return; }
            case "ignorar": corrida.conflito = null; break;
            case "reabrir": corrida.etapa = "montar"; corrida.lidas = {}; corrida.puladas = []; break;
            case "sair": parar(); sair(); return;
        }
        redesenhar();
    });
    document.addEventListener("change", e => {
        const t = e.target;
        const campo = t.dataset.corridaCampo;
        if (!campo || !corrida) return;
        if (campo === "pularComTag") corrida.pularComTag = t.checked; else corrida[campo] = t.value;
        redesenhar();
    });
    // leitor USB: digita o código e um Enter
    document.addEventListener("keydown", e => {
        const t = e.target;
        if (!t.dataset?.corridaUsb || e.key !== "Enter") return;
        e.preventDefault();
        const n = normalizarDigitada(t.value);
        t.value = "";
        if (!n) { ui.aviso("Não parece uma tag de 125 kHz (10 caracteres hexadecimais ou o número decimal do leitor).", "aviso"); bip(false); return; }
        if (n.convertido) ui.aviso(`O leitor deu o número em decimal: virou ${n.codigo} (prefixo ${n.prefixo} das outras tags). Confira com o Atta na primeira vez.`, "info");
        recebeu(n.codigo, "USB");
    });

    return { ativa: () => Boolean(corrida), estado: () => corrida, escaneando: () => escaneando, html, htmlEscanear, iniciar, sair, recebeu, seguirFita, normalizarDigitada, leitores };
})();
if (typeof window !== "undefined") window.CorridaTags = CorridaTags;
