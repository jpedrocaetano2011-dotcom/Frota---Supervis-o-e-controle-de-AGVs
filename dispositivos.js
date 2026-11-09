/* ============================================================
   DISPOSITIVOS (0.19): o Eciton I/O
   ============================================================
   Módulos na parede (ESP32 com 4 relés e 4 entradas) que controlam
   portas automáticas, semáforos de cruzamento e a entrada do alarme
   de incêndio. Falam com a frota pelo mesmo broker dos Atta
   (agv/<empresa>/<IO>/...) e entram no tráfego como mais um
   participante: o módulo ocupa a zona da porta fechada e só solta
   quando o sensor confirma que abriu.

   Aqui: o estado ao vivo (status/io, status/trafego, eventos), a
   tela Dispositivos, a configuração que vai para cada módulo
   (config/io, retida, gerada da planta publicada) e os comandos de
   teste. Os módulos virtuais (io-virtual.js) usam o mesmo caminho.
*/

const Dispositivos = (function () {
    "use strict";

    const estado = {};            // id -> { visto, io, trafego, info, conexao, eventos: [] }
    const ultimoEnvioConfig = {}; // id -> ms (sincronização automática)
    const ONLINE_MS = 15000;
    let alarmeMostrado = null;

    const esc = t => (typeof escaparHtml === "function" ? escaparHtml(t) : String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
    const planta = () => (typeof plantaPublicada === "function" ? plantaPublicada() : null);
    const lista = () => planta()?.dispositivos || [];
    const virtual = id => typeof IoVirtual !== "undefined" && IoVirtual.ativo(id);
    const pode = nivel => !window.Nuvem || Nuvem.pode(nivel);
    const de = id => (estado[id] = estado[id] || { visto: 0, io: null, trafego: null, info: null, conexao: null, eventos: [] });
    const online = id => { const e = estado[id]; return Boolean(e && e.visto && Date.now() - e.visto < ONLINE_MS); };

    /* ---------------- mensagens (MQTT ou virtual) ---------------- */

    // Chamado por processarMensagemMQTT antes de procurar o AGV. true = era de um módulo.
    function processar(id, caminho, valor) {
        if (typeof agvs !== "undefined" && agvs[id]) return false;
        const conhecido = lista().some(d => d.id === id) || estado[id];
        const deModulo = ["status/io", "sistema/info", "evento/io"].includes(caminho);
        if (!conhecido && !deModulo) return false;
        if (caminho === "sistema/info") {
            try { const info = JSON.parse(valor); if (info.tipo !== "IO") return false; de(id).info = info; } catch (e) { return false; }
        }
        const e = de(id);
        const ler = () => { try { return JSON.parse(valor); } catch (err) { return null; } };
        switch (caminho) {
            case "status/io": {
                const io = ler();
                if (!io) return true;
                e.io = io;
                e.visto = Date.now();
                sincronizarConfig(id);
                break;
            }
            case "status/trafego":
                e.trafego = valor ? ler() : null;
                if (e.trafego && !e.trafego.off) e.visto = e.visto || Date.now();
                verificarAlarme();
                break;
            case "status/conexao":
                e.conexao = valor;
                if (valor === "ONLINE") e.visto = Date.now();
                break;
            case "evento/io": {
                const ev = ler();
                if (!ev) return true;
                ev.em = Date.now();
                e.eventos.unshift(ev);
                e.eventos.length = Math.min(e.eventos.length, 40);
                avisarEvento(id, ev);
                break;
            }
        }
        agendar();
        return true;
    }

    function avisarEvento(id, ev) {
        if (typeof ui === "undefined") return;
        const nome = nomeModulo(id);
        const importantes = { PORTA_NAO_ABRIU: "erro", PORTA_FECHOU_SOZINHA: "erro", PORTA_NAO_FECHOU: "aviso", CONFIG_RECUSADA: "erro", ALARME_NORMALIZADO: "sucesso" };
        if (importantes[ev.tipo]) ui.aviso(`${nome}: ${ev.mensagem || ev.tipo}`, importantes[ev.tipo]);
    }

    function nomeModulo(id) {
        const d = lista().find(x => x.id === id);
        return d && d.nome ? `${id} (${d.nome})` : id;
    }

    /* ---------------- alarme de incêndio ---------------- */

    function alarmesAtivos() {
        return Object.keys(estado).filter(id => estado[id].trafego?.al === true || estado[id].io?.al === true);
    }

    function verificarAlarme() {
        const ativos = alarmesAtivos();
        let faixa = document.getElementById("alertaAlarmeIncendio");
        if (!ativos.length) {
            if (faixa) faixa.remove();
            alarmeMostrado = null;
            return;
        }
        if (!faixa) {
            faixa = document.createElement("div");
            faixa.id = "alertaAlarmeIncendio";
            faixa.className = "alerta-alarme";
            faixa.setAttribute("role", "alert");
            document.body.prepend(faixa);
        }
        const texto = `<b>Alarme de incêndio</b> (${ativos.map(esc).join(", ")}): os Atta não entram em cruzamentos nem portas e não partem. Quem já estava passando termina de sair.`;
        if (faixa.innerHTML !== texto) faixa.innerHTML = texto;
        const chave = ativos.join(",");
        if (alarmeMostrado !== chave) {
            alarmeMostrado = chave;
            if (typeof ui !== "undefined") ui.aviso("ALARME DE INCÊNDIO: a frota está parando.", "erro");
        }
    }

    /* ---------------- configuração (config/io) ---------------- */

    function publicarMqtt(id, caminho, texto, retido) {
        if (typeof clienteMQTT === "undefined" || !clienteMQTT || !clienteMQTT.connected || typeof gerarTopico !== "function") return false;
        clienteMQTT.publish(gerarTopico(id, caminho), texto, { qos: 1, retain: Boolean(retido) });
        return true;
    }

    // Manda a configuração (gerada da planta publicada) para o módulo
    function enviarConfig(id, silencioso = false) {
        const p = planta();
        const cfg = p && Planta.configIO(p, id);
        if (!cfg) return false;
        ultimoEnvioConfig[id] = Date.now();
        if (virtual(id)) { IoVirtual.receberConfig(id, cfg); return true; }
        if (!pode("administrar")) { if (!silencioso) ui.aviso("Só o administrador envia a configuração dos módulos.", "aviso"); return false; }
        const ok = publicarMqtt(id, "config/io", JSON.stringify(cfg), true);
        if (!ok && !silencioso) ui.aviso("Sem conexão com o MQTT: a configuração vai quando conectar (o módulo pega a última, retida).", "aviso");
        return ok;
    }

    // Planta publicada: cada módulo recebe a configuração nova
    function aoPublicarPlanta() {
        lista().forEach(d => enviarConfig(d.id, true));
        if (typeof IoVirtual !== "undefined") IoVirtual.aoPublicarPlanta();
        agendar();
    }

    // Módulo com a revisão diferente da planta: manda de novo (no máximo a cada 30 s)
    function sincronizarConfig(id) {
        const p = planta();
        const io = estado[id]?.io;
        if (!p || !io || !lista().some(d => d.id === id)) return;
        if (Number(io.rev) === Number(p.revisao)) return;
        if (Date.now() - (ultimoEnvioConfig[id] || 0) < 30000) return;
        if (!virtual(id) && !pode("administrar")) return;
        enviarConfig(id, true);
    }

    /* ---------------- comandos ---------------- */

    function comando(id, obj) {
        if (!pode("manutencao") && !pode("administrar")) { ui.aviso("Seu perfil não comanda os módulos.", "aviso"); return false; }
        const texto = JSON.stringify(obj);
        if (virtual(id)) return IoVirtual.comando(id, obj);
        if (!publicarMqtt(id, "comando/io", texto, false)) { ui.aviso("Sem conexão com o MQTT.", "erro"); return false; }
        if (typeof registrarAcaoSite === "function") { try { registrarAcaoSite(id, "io", obj.acao, texto); } catch (e) { /* ignora */ } }
        return true;
    }

    // Módulo fora do ar com a última vontade (zonas ocupadas): libera os Atta
    async function liberarZonas(id) {
        if (window.Nuvem && !Nuvem.exigir("administrar", "liberar as zonas de um módulo")) return;
        const zonas = (estado[id]?.trafego?.o || []).join(", ") || "—";
        if (!(await ui.confirmar({
            titulo: `Liberar as zonas do módulo ${id}?`,
            texto: `${zonas}\n\nOs Atta vão passar pelas portas e cruzamentos deste módulo SEM ele abrir ou avisar. Use só depois de conferir no local que as portas estão abertas (ou travadas abertas) e os cruzamentos sinalizados.`,
            confirmar: "Liberar", perigo: true
        }))) return;
        if (virtual(id)) IoVirtual.esquecer(id);
        else if (!publicarMqtt(id, "status/trafego", "", true)) { ui.aviso("Sem conexão com o MQTT.", "erro"); return; }
        de(id).trafego = null;
        ui.aviso(`Zonas do módulo ${id} liberadas.`, "sucesso");
        verificarAlarme();
        agendar();
    }

    /* ---------------- o que o mapa mostra ---------------- */

    const NOMES_ESTADO = { FECHADA: "fechada", ABRINDO: "abrindo", ABERTA: "aberta", FECHANDO: "fechando", FALHA: "falha" };

    // Estado de uma porta/faixa ligada a um módulo (para o mapa e a Mira)
    function estadoObjeto(objetoId) {
        const p = planta();
        const o = p && (p.layout || []).find(x => x.id === objetoId);
        if (!o || !o.io) return null;
        const e = estado[o.io.dispositivo];
        const off = !online(o.io.dispositivo);
        if (Planta.TIPOS_LAYOUT[o.tipo]?.regra === "PORTA") {
            const s = (e?.io?.portas || []).find(x => x.id === o.id);
            if (!s) return { offline: true, estado: null, texto: off ? "módulo sem sinal" : "sem configuração" };
            return { offline: off, estado: s.estado, aberta: s.aberta, quem: s.quem, falha: s.falha, bloqueada: s.bloqueada,
                     texto: off ? "módulo sem sinal" : s.bloqueada ? "bloqueada" : (NOMES_ESTADO[s.estado] || s.estado) };
        }
        const c = (e?.io?.cruzamentos || []).find(x => x.id === o.id);
        return c ? { offline: off, vermelho: c.agv, ocupa: c.ocupa, botao: c.botao, texto: c.agv ? "Atta passando" : c.ocupa ? "segurando os Atta" : "livre" }
                 : { offline: true, texto: off ? "módulo sem sinal" : "sem configuração" };
    }

    // Resumo para a Mira
    function resumo() {
        return lista().map(d => {
            const e = estado[d.id] || {};
            return {
                id: d.id, nome: d.nome || "", online: online(d.id), virtual: virtual(d.id), alarme: Boolean(e.trafego?.al || e.io?.al),
                rev: e.io?.rev ?? null, portas: (e.io?.portas || []).map(p => ({ id: p.id, estado: p.estado, falha: p.falha || "", quem: p.quem || "" })),
                cruzamentos: (e.io?.cruzamentos || []).map(c => ({ id: c.id, agv: c.agv, ocupa: c.ocupa }))
            };
        });
    }

    /* ---------------- tela ---------------- */

    let agendado = false;
    function agendar() {
        if (agendado) return;
        agendado = true;
        setTimeout(() => {
            agendado = false;
            if (document.getElementById("dispositivos")?.classList.contains("ativa")) renderizar();
            if (typeof EditorPlanta !== "undefined" && document.getElementById("visaoGeral")?.classList.contains("ativa") && typeof renderizarMapaVisaoGeral === "function") {
                // as portas mudam de cor no mapa
                try { renderizarAGVMapaVisaoGeral(); } catch (e) { /* ignora */ }
            }
        }, 250);
    }

    function pilulaConexao(id) {
        if (virtual(id)) return `<span class="pilula azul">virtual</span>`;
        const e = estado[id];
        if (online(id)) return `<span class="pilula verde">online</span>`;
        if (!e || !e.visto) return `<span class="pilula">nunca conectou</span>`;
        return `<span class="pilula vermelho">sem sinal há ${ui.duracao(Math.round((Date.now() - e.visto) / 1000))}</span>`;
    }

    function usoDosPinos(p, id) {
        const reles = {}, entradas = {};
        const d = (p.dispositivos || []).find(x => x.id === id);
        if (d?.alarme) entradas[d.alarme.entrada] = `alarme (${d.alarme.nf ? "NF" : "NA"})`;
        Planta.objetosIo(p, id).forEach(o => {
            const nome = o.nome || Planta.TIPOS_LAYOUT[o.tipo].nome;
            if (o.io.rele) reles[o.io.rele] = `${nome}: abrir`;
            if (o.io.aberta) entradas[o.io.aberta] = `${nome}: aberta`;
            if (o.io.fechada) entradas[o.io.fechada] = `${nome}: fechada`;
            if (o.io.vermelho) reles[o.io.vermelho] = `${nome}: vermelho`;
            if (o.io.verde) reles[o.io.verde] = `${nome}: verde`;
            if (o.io.botao) entradas[o.io.botao] = `${nome}: botão`;
        });
        return { reles, entradas };
    }

    function htmlModulo(p, d) {
        const e = estado[d.id] || {};
        const io = e.io;
        const objetos = Planta.objetosIo(p, d.id);
        const podeTestar = pode("manutencao") || pode("administrar");
        const revOk = io && Number(io.rev) === Number(p.revisao);
        const uso = usoDosPinos(p, d.id);
        const alarme = e.trafego?.al || io?.al;
        const portas = objetos.filter(o => Planta.TIPOS_LAYOUT[o.tipo].regra === "PORTA").map(o => {
            const s = (io?.portas || []).find(x => x.id === o.id);
            const cor = !s ? "" : s.estado === "FALHA" ? "vermelho" : s.estado === "ABERTA" ? "verde" : s.estado === "FECHADA" ? "" : "ambar";
            return `<tr>
                <td><strong>${esc(o.nome || "Porta")}</strong> <span class="suave">${esc(o.id)}</span></td>
                <td>${s ? `<span class="pilula ${cor}">${esc(s.bloqueada ? "bloqueada" : NOMES_ESTADO[s.estado] || s.estado)}</span>${s.falha ? ` <span class="suave">${esc(s.falha)}</span>` : ""}` : `<span class="suave">—</span>`}</td>
                <td class="suave">${s ? `aberta ${s.aberta ? "✓" : "·"}${"fechada" in s ? ` · fechada ${s.fechada ? "✓" : "·"}` : ""}` : ""}</td>
                <td class="suave">${s?.quem ? "último: " + esc(s.quem) : ""}${s ? ` · ${Number(s.n) || 0} aberturas` : ""}</td>
                <td class="usuarios-acao">${podeTestar && s ? `<button type="button" class="btn btn-mini" data-io="abrir" data-id="${esc(d.id)}" data-porta="${esc(o.id)}" ${alarme || s.bloqueada ? "disabled" : ""}>Abrir 30 s</button>
                    <button type="button" class="btn btn-mini" data-io="${s.bloqueada ? "desbloquear" : "bloquear"}" data-id="${esc(d.id)}" data-porta="${esc(o.id)}">${s.bloqueada ? "Desbloquear" : "Bloquear"}</button>` : ""}
                    ${virtual(d.id) ? `<button type="button" class="btn btn-mini" data-io="emperrar" data-id="${esc(d.id)}" data-porta="${esc(o.id)}">${IoVirtual.emperrada(d.id, o.id) ? "Desemperrar" : "Emperrar"}</button>` : ""}</td>
            </tr>`;
        }).join("");
        const cruz = objetos.filter(o => Planta.TIPOS_LAYOUT[o.tipo].regra === "FAIXA").map(o => {
            const s = (io?.cruzamentos || []).find(x => x.id === o.id);
            return `<tr>
                <td><strong>${esc(o.nome || Planta.TIPOS_LAYOUT[o.tipo].nome)}</strong> <span class="suave">${esc(o.id)}</span></td>
                <td>${s ? `<span class="semaforo ${s.agv ? "vermelho" : "verde"}" aria-hidden="true"></span> ${s.agv ? "vermelho (Atta passando)" : "verde"}` : `<span class="suave">—</span>`}</td>
                <td class="suave">${s ? (s.ocupa ? "segurando os Atta" : "") + (s.botao ? " · botão apertado" : "") : ""}</td>
                <td></td>
                <td class="usuarios-acao">${virtual(d.id) && o.io.botao ? `<button type="button" class="btn btn-mini" data-io="botao" data-id="${esc(d.id)}" data-objeto="${esc(o.id)}">Apertar o botão</button>` : ""}</td>
            </tr>`;
        }).join("");
        const chips = (tipo, n, valores, nomes) => [1, 2, 3, 4].map(k => {
            const ligado = Boolean(valores?.[k - 1]);
            return `<span class="io-chip ${ligado ? "ligado" : ""}" title="${esc(nomes[k] || "livre")}"><b>${tipo}${k}</b><small>${esc(nomes[k] || "livre")}</small></span>`;
        }).join("");
        const codigo = window.Nuvem?.empresa?.()?.codigo || (typeof mqttEmpresa !== "undefined" && mqttEmpresa) || "demo";
        const eventos = (e.eventos || []).slice(0, 8).map(ev => `<li><span class="mono suave">${new Date(ev.em).toLocaleTimeString("pt-BR")}</span> <b>${esc(ev.tipo)}</b> ${esc(ev.mensagem || "")}</li>`).join("");
        return `<section class="card io-modulo" data-modulo="${esc(d.id)}">
            <div class="card-barra">
                <div><h2>${esc(d.id)}${d.nome ? " · " + esc(d.nome) : ""}</h2>
                    <div class="card-sub">${pilulaConexao(d.id)} ${io ? `firmware ${esc(io.fw || e.info?.firmware || "?")} · sinal ${esc(io.rssi ?? "?")} dBm · ligado há ${ui.duracao(Number(io.up) || 0)}` : ""}
                    ${io ? (revOk ? ` · <span class="pilula verde">configuração da rev ${esc(p.revisao)}</span>` : ` · <span class="pilula ambar">configuração rev ${esc(io.rev)} (planta: rev ${esc(p.revisao)})</span>`) : ""}
                    ${alarme ? ` · <span class="pilula vermelho">ALARME DE INCÊNDIO</span>` : ""}</div></div>
                <div class="grupo">
                    ${pode("administrar") || virtual(d.id) ? `<button type="button" class="btn btn-mini" data-io="config" data-id="${esc(d.id)}">Enviar configuração</button>` : ""}
                    ${virtual(d.id) && d.alarme ? `<button type="button" class="btn btn-mini ${alarme ? "btn-primario" : "btn-perigo"}" data-io="alarme" data-id="${esc(d.id)}">${alarme ? "Normalizar o alarme" : "Disparar o alarme"}</button>` : ""}
                    ${typeof IoVirtual !== "undefined" ? `<label class="config-chave"><input type="checkbox" data-io="virtual" data-id="${esc(d.id)}" ${virtual(d.id) ? "checked" : ""}><span>Simular (I/O virtual)</span></label>` : ""}
                </div>
            </div>
            ${!online(d.id) && !virtual(d.id) && (e.trafego?.o || []).length ? `<div class="editor-aviso">O módulo está fora do ar e deixou as zonas <b>${esc(e.trafego.o.join(", "))}</b> ocupadas (última vontade): os Atta esperam antes das portas e cruzamentos dele. Volte a ligar o módulo${pode("administrar") ? ` ou <button type="button" class="btn btn-mini btn-perigo" data-io="liberar" data-id="${esc(d.id)}">Liberar as zonas</button>` : ""}.</div>` : ""}
            ${objetos.length ? `<div class="tabela-rolagem"><table class="tabela-usuarios">
                <thead><tr><th>Ligado a</th><th>Estado</th><th>Sensores</th><th></th><th></th></tr></thead>
                <tbody>${portas}${cruz}</tbody></table></div>` : `<p class="suave io-vazio">Nada ligado a este módulo. Na Planta, selecione uma porta automática, faixa de pedestre ou cruzamento com empilhadeira e escolha o módulo.</p>`}
            <div class="io-pinos">
                <div><span class="editor-subtitulo">Relés</span><div class="io-chips">${chips("R", 4, io?.reles, uso.reles)}</div></div>
                <div><span class="editor-subtitulo">Entradas</span><div class="io-chips">${chips("E", 4, io?.entradas, uso.entradas)}</div></div>
            </div>
            ${podeTestar ? `<div class="io-teste">${[1, 2, 3, 4].filter(k => !uso.reles[k]).map(k => `<button type="button" class="btn btn-mini" data-io="rele" data-id="${esc(d.id)}" data-rele="${k}">Testar relé ${k} (2 s)</button>`).join("")}</div>` : ""}
            ${eventos ? `<details class="editor-mais"><summary>Últimos eventos</summary><ul class="io-eventos">${eventos}</ul></details>` : ""}
            <details class="editor-mais"><summary>Linhas do firmware e ligação</summary>
                <p class="suave">No <code>ECITON_IO.ino</code>, troque as linhas do topo (o usuário e a senha MQTT são os mesmos dos AGVs da empresa: Usuários › MQTT, fornecedor):</p>
                <pre class="io-codigo">#define EMPRESA "${esc(codigo)}"
#define IO_ID "${esc(d.id)}"</pre>
                <p class="suave">Relés 1 a 4 nos GPIO 25, 26, 27 e 14 (módulo de relés ativo em nível baixo). Entradas 1 a 4 nos GPIO 34, 35, 32 e 33, com optoacoplador (contato fechado = ativa). O LED azul da placa: aceso = tudo certo; pisca rápido = sem Wi-Fi; devagar = sem broker; dois piscos = falha ou alarme.</p>
            </details>
        </section>`;
    }

    function renderizar() {
        const caixa = document.getElementById("dispositivosConteudo");
        if (!caixa) return;
        const p = planta();
        const mods = lista();
        const desconhecidos = Object.keys(estado).filter(id => !mods.some(d => d.id === id) && estado[id].info);
        if (!p || !mods.length) {
            ui.trocarHtml(caixa, `<section class="card io-intro">
                <h2>Eciton I/O</h2>
                <p>O Eciton I/O é um controlador na parede (ESP32 com 4 relés e 4 entradas) que abre portas automáticas para os Atta, acende o semáforo do cruzamento com empilhadeira e recebe o alarme de incêndio. Ele fala com a frota pelo mesmo broker, sem computador no meio.</p>
                <ol>
                    <li>Na <b>Planta</b>, clique num lugar vazio do mapa e use <b>+ Módulo Eciton I/O</b>.</li>
                    <li>Desenhe a <b>Porta automática</b> (biblioteca › Estrutura) em cima da fita e, no painel dela, escolha o módulo, o relé e os sensores. Use <b>Criar pontos dos dois lados</b>.</li>
                    <li>Publique a planta: a configuração vai sozinha para o módulo.</li>
                    <li>Para testar sem hardware, marque <b>Simular (I/O virtual)</b> aqui e use o AGV virtual.</li>
                </ol>
                <button type="button" class="btn btn-primario" data-io="irPlanta">Ir para a Planta</button>
                ${desconhecidos.length ? `<p class="suave">Módulos falando no broker que não estão na planta: ${desconhecidos.map(esc).join(", ")}.</p>` : ""}
            </section>`);
            return;
        }
        ui.trocarHtml(caixa, `
            <p class="suave io-texto">Cada módulo ocupa a zona da porta enquanto ela está fechada e só solta quando o sensor confirma que abriu. Módulo fora do ar: as zonas dele ficam ocupadas (os Atta esperam). A configuração vem da planta publicada (rev ${esc(p.revisao)}).</p>
            ${mods.map(d => htmlModulo(p, d)).join("")}
            ${desconhecidos.length ? `<p class="suave">Módulos falando no broker que não estão na planta: ${desconhecidos.map(esc).join(", ")}.</p>` : ""}`);
    }

    function abrir() {
        renderizar();
    }

    document.addEventListener("click", evento => {
        const b = evento.target.closest("[data-io]");
        if (!b || b.tagName === "INPUT") return;
        const id = b.dataset.id;
        switch (b.dataset.io) {
            case "irPlanta": if (typeof mudarTela === "function") mudarTela("controlePlanta"); return;
            case "config": if (enviarConfig(id)) ui.aviso(`Configuração enviada para ${id}.`, "sucesso"); return;
            case "abrir": comando(id, { acao: "ABRIR", porta: b.dataset.porta }); return;
            case "bloquear": comando(id, { acao: "BLOQUEAR", porta: b.dataset.porta }); return;
            case "desbloquear": comando(id, { acao: "DESBLOQUEAR", porta: b.dataset.porta }); return;
            case "rele": comando(id, { acao: "TESTAR_RELE", rele: Number(b.dataset.rele), ms: 2000 }); return;
            case "liberar": liberarZonas(id); return;
            case "emperrar": IoVirtual.emperrar(id, b.dataset.porta, !IoVirtual.emperrada(id, b.dataset.porta)); agendar(); return;
            case "botao": IoVirtual.apertarBotao(id, b.dataset.objeto); return;
            case "alarme": IoVirtual.alarme(id, !IoVirtual.emAlarme(id)); return;
        }
    });
    document.addEventListener("change", evento => {
        const b = evento.target.closest("input[data-io='virtual']");
        if (!b) return;
        IoVirtual.simular(b.dataset.id, b.checked).then(() => agendar());
    });

    // estado "sem sinal" muda com o tempo; o "!" no menu: alarme, porta em falha ou módulo que caiu
    function atualizarBadge() {
        const b = document.getElementById("menuBadgeDispositivos");
        if (!b) return;
        const problema = alarmesAtivos().length > 0 || lista().some(d => {
            const e = estado[d.id];
            if (!e) return false;
            if (!virtual(d.id) && e.visto && !online(d.id)) return true;
            // porta em falha agora, ou que falhou nos últimos 2 min e ainda não abriu de novo
            const falhou = (e.eventos || []).some(ev => /^PORTA_(NAO_ABRIU|FECHOU_SOZINHA|NAO_FECHOU)$/.test(ev.tipo) && Date.now() - ev.em < 120000 &&
                (e.io?.portas || []).some(p => p.id === ev.alvo && p.estado !== "ABERTA" && p.estado !== "FECHADA"));
            return falhou || (e.io?.portas || []).some(p => p.estado === "FALHA");
        });
        b.hidden = !problema;
    }
    setInterval(() => {
        atualizarBadge();
        if (document.getElementById("dispositivos")?.classList.contains("ativa")) renderizar();
    }, 5000);

    return { processar, estadoObjeto, enviarConfig, aoPublicarPlanta, comando, liberarZonas, abrir, renderizar, resumo,
             alarmesAtivos, online, estado, lista, de, agendar, verificarAlarme };
})();
