/* ============================================================
   CONTROLES DA FROTA (0.20): pausar, modo devagar, ir para o ponto
   ============================================================
   Pausar e devagar valem para a frota inteira: uma mensagem retida em
   agv/<empresa>/frota/controle {pausa, lento, ate, por, motivo}. Os Atta
   cumprem sozinhos (firmware 0.20): na pausa ninguém parte nem entra em
   zona nova, e quem está andando para no próximo ponto; no modo devagar
   a velocidade de cruzeiro cai para o fator escolhido.
   Quem usa: líder, operador e administrador (o mesmo nível do tráfego).
   "Ir para o ponto": manda um Atta para uma espera, um berço ou uma
   estação sem criar missão (uma missão temporária de uma etapa).
*/
const FrotaControle = (function () {
    let estado = { pausa: false, lento: 1, ate: 0, por: "", motivo: "", em: 0 };
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const pode = () => !window.Nuvem || !Nuvem.emNuvem || !Nuvem.emNuvem() || Nuvem.pode("trafego");
    const podeMandar = () => !window.Nuvem || !Nuvem.emNuvem || !Nuvem.emNuvem() || Nuvem.pode("operar");
    const nome = () => (window.Nuvem && Nuvem.usuario && (Nuvem.usuario()?.nome || Nuvem.usuario()?.email)) || "site";
    const lentoValendo = () => estado.lento < 0.999 && (!estado.ate || Date.now() / 1000 < estado.ate);

    // mensagem retida do broker (ou do Atta virtual)
    function processar(caminho, valor) {
        if (caminho !== "controle") return false;
        try { const d = valor ? JSON.parse(valor) : {}; estado = Object.assign({ pausa: false, lento: 1, ate: 0, por: "", motivo: "", em: 0 }, d); } catch (e) { return true; }
        atualizar();
        return true;
    }
    function publicarEstado(novo) {
        estado = Object.assign({}, estado, novo, { por: nome(), em: Math.floor(Date.now() / 1000) });
        const msg = JSON.stringify(estado);
        let ok = false;
        try {
            if (typeof clienteMQTT !== "undefined" && clienteMQTT && clienteMQTT.connected && typeof mqttEmpresa !== "undefined") {
                clienteMQTT.publish(`agv/${mqttEmpresa}/frota/controle`, msg, { qos: 1, retain: true });
                ok = true;
            }
        } catch (e) { /* sem broker */ }
        if (typeof AgvVirtual !== "undefined" && AgvVirtual.publicarFrota) { AgvVirtual.publicarFrota("frota/controle", msg); ok = true; }
        if (typeof registrarAcaoSite === "function") registrarAcaoSite("", "trafego", novo.pausa === true ? "FROTA_PAUSADA" : novo.pausa === false && "pausa" in novo ? "FROTA_RETOMADA" : "FROTA_DEVAGAR",
            novo.pausa ? (estado.motivo || "pausa") : lentoValendo() ? `devagar ${Math.round(estado.lento * 100)}%` : "velocidade normal");
        atualizar();
        return ok;
    }

    async function pausar() {
        if (!pode()) { ui.aviso("Só líder, operador e administrador pausam a frota.", "aviso"); return; }
        const v = await ui.formulario({ titulo: "Pausar a frota", confirmar: "Pausar", campos: [
            { nome: "motivo", rotulo: "Por quê?", tipo: "radio", valor: "visita", opcoes: [["visita", "Visita ou auditoria"], ["inspecao", "Inspeção de segurança"], ["reuniao", "Reunião / DDS"], ["outro", "Outro motivo"]] }
        ], texto: "Nenhum Atta parte nem entra em cruzamento. Quem está andando para no próximo ponto. Não é emergência: para parar na hora, use o botão de emergência." });
        if (!v) return;
        const nomes = { visita: "visita ou auditoria", inspecao: "inspeção de segurança", reuniao: "reunião / DDS", outro: "pausa" };
        if (!publicarEstado({ pausa: true, motivo: nomes[v.motivo] || "pausa" })) ui.aviso("Sem conexão com o broker: a pausa não chegou aos Atta.", "erro");
        else ui.aviso("Frota pausada: os Atta param no próximo ponto.", "sucesso");
    }
    function retomar() { publicarEstado({ pausa: false, motivo: "" }); ui.aviso("Frota retomada.", "sucesso"); }
    async function devagar() {
        if (!pode()) { ui.aviso("Só líder, operador e administrador mudam a velocidade da frota.", "aviso"); return; }
        const v = await ui.formulario({ titulo: "Modo devagar", confirmar: "Aplicar", campos: [
            { nome: "fator", rotulo: "Velocidade", tipo: "radio", valor: lentoValendo() ? String(estado.lento) : "0.5", opcoes: [["0.25", "25% (obra, treinamento)"], ["0.5", "50%"], ["0.75", "75%"], ["1", "Normal"]] },
            { nome: "por", rotulo: "Por quanto tempo", tipo: "radio", valor: "60", opcoes: [["30", "30 min"], ["60", "1 h"], ["240", "4 h"], ["0", "até alguém voltar ao normal"]] }
        ], texto: "Vale para a frota inteira, por cima das velocidades da planta (zona lenta continua valendo)." });
        if (!v) return;
        const f = Number(v.fator), min = Number(v.por);
        publicarEstado({ lento: f, ate: f < 1 && min ? Math.floor(Date.now() / 1000) + min * 60 : 0 });
        ui.aviso(f < 1 ? `Frota a ${Math.round(f * 100)}% da velocidade${min ? ` por ${min >= 60 ? min / 60 + " h" : min + " min"}` : ""}.` : "Velocidade normal.", "sucesso");
    }

    // faixa no topo de todas as telas + botões na Frota
    function atualizar() {
        let faixa = document.getElementById("alertaControleFrota");
        const lento = lentoValendo();
        if (!estado.pausa && !lento) { if (faixa) faixa.remove(); }
        else {
            if (!faixa) { faixa = document.createElement("div"); faixa.id = "alertaControleFrota"; faixa.className = "alerta-controle"; faixa.setAttribute("role", "status"); document.body.prepend(faixa); }
            const ate = estado.ate ? new Date(estado.ate * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
            faixa.innerHTML = estado.pausa
                ? `<b>Frota pausada</b> · ${esc(estado.motivo || "pausa")}${estado.por ? ` · por ${esc(estado.por)}` : ""}. Os Atta param no próximo ponto e ninguém parte. ${pode() ? `<button type="button" class="btn btn-mini" data-frota-controle="retomar">Retomar</button>` : ""}`
                : `<b>Modo devagar</b> · ${Math.round(estado.lento * 100)}% da velocidade${ate ? " até " + ate : ""}${estado.por ? ` · por ${esc(estado.por)}` : ""}. ${pode() ? `<button type="button" class="btn btn-mini" data-frota-controle="normal">Voltar ao normal</button>` : ""}`;
            faixa.classList.toggle("pausa", Boolean(estado.pausa));
        }
        const grupo = document.querySelector("#frota .barra-acoes .grupo");
        if (grupo && pode()) {
            let b = document.getElementById("frotaPausar");
            if (!b) {
                grupo.insertAdjacentHTML("afterbegin", `<button type="button" class="btn" id="frotaPausar" data-frota-controle="pausar"></button><button type="button" class="btn" id="frotaDevagar" data-frota-controle="devagar">Modo devagar</button>`);
                b = document.getElementById("frotaPausar");
            }
            b.textContent = estado.pausa ? "Retomar a frota" : "Pausar a frota";
            b.dataset.frotaControle = estado.pausa ? "retomar" : "pausar";
            b.classList.toggle("btn-primario", Boolean(estado.pausa));
            const d = document.getElementById("frotaDevagar");
            if (d) d.textContent = lento ? `Devagar · ${Math.round(estado.lento * 100)}%` : "Modo devagar";
        }
    }

    /* ---------------- ir para o ponto ---------------- */
    const TEMP = "__IR_";
    async function irParaPonto(agvId) {
        const agv = typeof agvs !== "undefined" ? agvs[agvId] : null;
        if (!agv) return;
        if (!podeMandar()) { ui.aviso("Só operador e administrador mandam um Atta para um ponto.", "aviso"); return; }
        const pl = typeof plantaPublicada === "function" ? plantaPublicada() : null;
        if (!pl) return;
        const pontos = pl.nos.filter(n => ["ESPERA", "BERCO", "ESTACAO"].includes(n.tipo) && n.id !== agv.pontoAtual)
            .sort((a, b) => ["ESPERA", "BERCO", "ESTACAO"].indexOf(a.tipo) - ["ESPERA", "BERCO", "ESTACAO"].indexOf(b.tipo) || a.id.localeCompare(b.id, "pt-BR", { numeric: true }));
        if (!pontos.length) { ui.aviso("A planta publicada não tem esperas, berços ou estações para onde ir.", "aviso"); return; }
        const tipoNome = { ESPERA: "espera", BERCO: "berço", ESTACAO: "estação" };
        const v = await ui.formulario({ titulo: `Mandar o AGV ${agvId} para…`, confirmar: "Ir", campos: [
            { nome: "destino", rotulo: "Ponto", valor: pontos[0].id, opcoes: pontos.slice(0, 40).map(n => [n.id, `${n.id} · ${tipoNome[n.tipo]}${n.nome ? " · " + n.nome : ""}`]) }
        ], texto: "Sem criar missão: ele vai até o ponto e para. Use para tirar um Atta do caminho." });
        if (!v?.destino) return;
        const id = TEMP + v.destino;
        temporarias[id] = { id, nome: `Ir para ${v.destino}`, temporaria: true, prioridade: 2, etapas: [{ tipo: "IR_PARA", destino: v.destino }] };
        if (typeof iniciarMissaoPorId !== "function" || !iniciarMissaoPorId(agvId, id)) return;
        ui.aviso(`AGV ${agvId} indo para ${v.destino}. ${agv.modo === "AUTOMATICO" ? "Aperte START MISSÃO se ele pedir." : "Passe para AUTOMÁTICO para ele sair."}`, "sucesso");
    }
    const temporarias = {};

    document.addEventListener("click", e => {
        const b = e.target.closest("[data-frota-controle]");
        if (b) {
            const a = b.dataset.frotaControle;
            if (a === "pausar") pausar();
            if (a === "retomar") retomar();
            if (a === "devagar") devagar();
            if (a === "normal") { publicarEstado({ lento: 1, ate: 0 }); ui.aviso("Velocidade normal.", "sucesso"); }
            return;
        }
        const ir = e.target.closest("[data-ir-ponto]");
        if (ir) { e.stopPropagation(); irParaPonto(ir.dataset.irPonto); }
    });
    setInterval(() => { if (estado.lento < 1 && estado.ate) atualizar(); }, 30000);
    setTimeout(atualizar, 0);

    return { processar, pausar, retomar, devagar, irParaPonto, estado: () => Object.assign({}, estado), missaoTemporaria: id => temporarias[id] || null, atualizar };
})();
if (typeof window !== "undefined") window.FrotaControle = FrotaControle;
