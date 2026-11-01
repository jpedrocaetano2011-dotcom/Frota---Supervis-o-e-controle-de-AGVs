/* ============================================================
   ROTINA DA FROTA: BERÇOS E TURNOS (Frota › Rotina e berços)
   ============================================================
   Cada AGV tem um berço (casa e carregador; vários AGVs podem
   dividir o mesmo) e um turno (início, fim, dias da semana).
   A rotina fica guardada no site (e no banco, com a nuvem) e é
   mandada para o AGV, que guarda na flash e cumpre sozinho, com
   a hora do NTP (ou a do site, se a rede bloquear o NTP).

   comando/rotina  {acao: CONFIGURAR | FIM_TURNO | INICIAR_TURNO | HORA}
   status/rotina   {rev, berco, turno, fimDeTurno, estado, noBerco, dentro, hora, voltarApos}
*/

const DIAS_SEMANA = [["D", "Domingo"], ["S", "Segunda"], ["T", "Terça"], ["Q", "Quarta"], ["Q", "Quinta"], ["S", "Sexta"], ["S", "Sábado"]];
const NOMES_DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const FUSO_PADRAO = "<-03>3";   // Brasília (POSIX)

const ESTADOS_ROTINA = {
    TRABALHANDO: ["Trabalhando", "verde"],
    FINALIZANDO_MISSAO: ["Finalizando a missão para encerrar o turno", "ambar"],
    INDO_PARA_BERCO: ["Indo para o berço", "roxo"],
    ENCERRADO: ["Turno encerrado · no berço", "roxo"],
    ENCERRADO_FORA_DO_BERCO: ["Turno encerrado · fora do berço", "vermelho"],
    SEM_BERCO: ["Turno encerrado · sem berço", "vermelho"]
};

function rotinaPadrao() {
    return { berco: "", turno: { ativo: false, inicio: "07:00", fim: "17:00", dias: [1, 2, 3, 4, 5] }, voltarApos: 60, fuso: FUSO_PADRAO };
}

function rotinaDoAGV(agv) {
    const r = Object.assign(rotinaPadrao(), agv?.rotina || {});
    r.turno = Object.assign(rotinaPadrao().turno, agv?.rotina?.turno || {});
    return r;
}

function bercosDaPlanta() {
    return plantaPublicada().nos.filter(no => no.tipo === "BERCO");
}

function hashTexto(texto) {
    let h = 2166136261;
    for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
}

// O que vai para o AGV: rotina + os dados do berço tirados da planta publicada
function pacoteRotina(agv) {
    const r = rotinaDoAGV(agv);
    const no = r.berco ? Planta.noPorId(plantaPublicada(), r.berco) : null;
    const berco = no && no.tipo === "BERCO" ? no : null;
    const p = {
        berco: berco ? berco.id : "",
        bercoTag: berco?.rfid || "",
        bercoOrientacao: berco?.orientacaoChegada ?? -1,
        bercoZona: berco && typeof zonaDoPonto === "function" ? (zonaDoPonto(berco.id) || "") : "",
        bercoBarreira: berco?.barreira || 0,
        turno: { ativo: Boolean(r.turno.ativo), inicio: r.turno.inicio, fim: r.turno.fim, dias: [...r.turno.dias].sort() },
        voltarApos: Number(r.voltarApos) || 0,
        fuso: r.fuso || FUSO_PADRAO
    };
    p.rev = hashTexto(JSON.stringify(p)).slice(0, 10);
    return p;
}

function podeMexerNaRotina() {
    return !window.Nuvem || Nuvem.pode("operar");
}

// Rotina do site diferente da do AGV: manda de novo. Sem hora no AGV: manda a hora.
function sincronizarRotina(agv, forcar = false) {
    if (!agv?.online || !agv.rotinaStatus || !podeMexerNaRotina()) return;
    if (!agv.rotina) return;   // nunca configurada neste site: não apaga a do AGV
    const p = pacoteRotina(agv);
    const agora = Date.now();
    if (agv.rotinaStatus.rev !== p.rev) {
        if (!forcar && agv.rotinaEnviadaEm && agora - agv.rotinaEnviadaEm < 15000) return;
        agv.rotinaEnviadaEm = agora;
        publicar("comando/rotina", JSON.stringify(Object.assign({ acao: "CONFIGURAR", agora: Math.floor(agora / 1000) }, p)), agv.id);
    } else if (!agv.rotinaStatus.hora && (!agv.horaEnviadaEm || agora - agv.horaEnviadaEm > 60000)) {
        agv.horaEnviadaEm = agora;
        publicar("comando/rotina", JSON.stringify({ acao: "HORA", agora: Math.floor(agora / 1000) }), agv.id, 0);
    }
}

function salvarRotinaAGV(agvId, rotina) {
    const agv = agvs[agvId];
    if (!agv) return;
    agv.rotina = rotina;
    salvarAgvsFrota();
    if (window.Nuvem) Nuvem.salvarRotina(agvId, rotina);
    registrarAcaoSite(agvId, "configuracao", "ROTINA_SALVA", `Berço ${rotina.berco || "—"} · turno ${rotina.turno.ativo ? `${rotina.turno.inicio}–${rotina.turno.fim}` : "sem horário"}`);
    sincronizarRotina(agv, true);
}

function comandoTurno(agvId, acao) {
    const agv = agvs[agvId];
    if (!agv) return;
    if (!agv.online) { ui.aviso(`AGV ${agvId} offline.`, "aviso"); return; }
    if (acao === "FIM_TURNO" && !rotinaDoAGV(agv).berco) {
        ui.aviso(`O AGV ${agvId} não tem berço: escolha um antes de encerrar o turno.`, "aviso");
        return;
    }
    if (publicar("comando/rotina", JSON.stringify({ acao, agora: Math.floor(Date.now() / 1000) }), agvId)) {
        registrarAcaoSite(agvId, "missao", acao === "FIM_TURNO" ? "FIM_TURNO_PEDIDO" : "INICIO_TURNO_PEDIDO", acao === "FIM_TURNO" ? "Fim de turno pelo site" : "Início de turno pelo site");
        ui.aviso(acao === "FIM_TURNO"
            ? (["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"].includes(agv.estadoMissao)
                ? `AGV ${agvId}: finalizando a missão para encerrar o turno.`
                : `AGV ${agvId}: encerrando o turno e indo para o berço.`)
            : `AGV ${agvId}: turno iniciado.`, "sucesso");
    }
}

// Linha do cartão do AGV na Frota
function linhaRotinaCard(agv) {
    const st = agv.rotinaStatus;
    const r = rotinaDoAGV(agv);
    if (!agv.online || !st) {
        return r.berco ? `<dt>Berço</dt><dd>${escaparHtml(r.berco)}</dd>` : `<dt>Berço</dt><dd class="suave">sem berço</dd>`;
    }
    const [texto, cor] = ESTADOS_ROTINA[st.estado] || [st.estado, "cinza"];
    const mostrar = st.estado !== "TRABALHANDO" || st.noBerco;
    return `<dt>Turno</dt><dd>${mostrar ? `<span class="pilula ${cor === "roxo" ? "roxo" : cor}">${escaparHtml(st.estado === "TRABALHANDO" ? "No berço" : texto)}</span>` : (r.turno.ativo ? `${escaparHtml(r.turno.inicio)}–${escaparHtml(r.turno.fim)}` : "trabalhando")}</dd>`;
}

/* ---------------- conflito de berço compartilhado ---------------- */

function minutos(hhmm) {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

// O AGV está fora do turno nesse dia/minuto? null = sem horário (não dá para saber)
function foraDoTurno(rotina, dia, minuto) {
    const t = rotina.turno;
    if (!t.ativo) return null;
    const ini = minutos(t.inicio), fim = minutos(t.fim);
    const dias = new Set(t.dias || []);
    if (ini === null || fim === null || ini === fim) return true;
    let dentro;
    if (ini < fim) dentro = dias.has(dia) && minuto >= ini && minuto < fim;
    else dentro = (dias.has(dia) && minuto >= ini) || (dias.has((dia + 6) % 7) && minuto < fim);
    return !dentro;
}

// Dois AGVs do mesmo berço fora do turno ao mesmo tempo: um deles vai esperar num ponto de espera.
function conflitoBerco(a, b) {
    const ra = rotinaDoAGV(a), rb = rotinaDoAGV(b);
    for (let dia = 0; dia < 7; dia++) {
        for (let m = 0; m < 1440; m += 15) {
            const fa = foraDoTurno(ra, dia, m), fb = foraDoTurno(rb, dia, m);
            if (fa === null || fb === null) return { semHorario: true };
            if (fa && fb) {
                let fim = m;
                while (fim < 1440 && foraDoTurno(ra, dia, fim) && foraDoTurno(rb, dia, fim)) fim += 15;
                const hh = x => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
                return { dia, inicio: hh(m), fim: hh(Math.min(fim, 1439)) };
            }
        }
    }
    return null;
}

/* ---------------- tela ---------------- */

let mapaRotina = null;
const rascunhosRotina = {};   // agvId -> rotina em edição (antes de salvar)

function estadoRotinaHtml(agv) {
    if (!agv.online) return `<span class="pilula">offline</span>`;
    const st = agv.rotinaStatus;
    if (!st) return `<span class="pilula cinza" title="Firmware antigo (sem rotina) ou ainda sem resposta">sem rotina no AGV</span>`;
    const [texto, cor] = ESTADOS_ROTINA[st.estado] || [st.estado, "cinza"];
    const sincronizado = agv.rotina ? st.rev === pacoteRotina(agv).rev : true;
    return `<span class="pilula ${cor}">${escaparHtml(texto)}</span>` +
        (st.hora ? ` <span class="suave mono" title="Hora no relógio do AGV">${escaparHtml(st.hora)}</span>` : ` <span class="pilula ambar" title="O AGV ainda não acertou o relógio (NTP); o site manda a hora">sem relógio</span>`) +
        (sincronizado ? "" : ` <span class="pilula ambar">enviando…</span>`);
}

function htmlCartaoRotina(agv, bercos) {
    const r = rascunhosRotina[agv.id] || rotinaDoAGV(agv);
    const st = agv.rotinaStatus;
    const alterado = Boolean(rascunhosRotina[agv.id]);
    const pode = podeMexerNaRotina();
    const fimDeTurno = st?.fimDeTurno;
    const opcoes = [["", "— sem berço —"]].concat(bercos.map(b => [b.id, `${b.id}${b.nome ? " · " + b.nome : ""}`]));
    const bercoInexistente = r.berco && !bercos.some(b => b.id === r.berco);
    return `
            <div class="rotina-campos">
                <label class="campo"><span>Berço</span>
                    <select data-rotina="berco" ${pode ? "" : "disabled"}>${opcoes.map(([v, t]) => `<option value="${escaparHtml(v)}" ${v === r.berco ? "selected" : ""}>${escaparHtml(t)}</option>`).join("")}${bercoInexistente ? `<option value="${escaparHtml(r.berco)}" selected>${escaparHtml(r.berco)} (não existe na planta)</option>` : ""}</select>
                </label>
                <label class="campo rotina-check"><input type="checkbox" data-rotina="ativo" ${r.turno.ativo ? "checked" : ""} ${pode ? "" : "disabled"}><span>Turno por horário</span></label>
                <label class="campo"><span>Início</span><input type="time" data-rotina="inicio" value="${escaparHtml(r.turno.inicio)}" ${pode && r.turno.ativo ? "" : "disabled"}></label>
                <label class="campo"><span>Fim</span><input type="time" data-rotina="fim" value="${escaparHtml(r.turno.fim)}" ${pode && r.turno.ativo ? "" : "disabled"}></label>
                <div class="campo rotina-dias-campo"><span>Dias</span>
                    <div class="rotina-dias" role="group" aria-label="Dias do turno">${DIAS_SEMANA.map(([letra, nome], i) =>
                        `<button type="button" class="rotina-dia ${r.turno.dias.includes(i) ? "ativo" : ""}" data-rotina-dia="${i}" title="${nome}" aria-pressed="${r.turno.dias.includes(i)}" ${pode && r.turno.ativo ? "" : "disabled"}>${letra}</button>`).join("")}</div>
                </div>
                <label class="campo"><span>Parado sem missão, volta ao berço em</span>
                    <span class="rotina-unidade"><input type="number" min="0" max="3600" step="10" data-rotina="voltarApos" value="${Number(r.voltarApos) || 0}" ${pode ? "" : "disabled"}><em>s</em></span>
                </label>
            </div>
            ${!r.berco ? `<p class="rotina-aviso">Sem berço: no fim do turno o AGV fica onde estiver. Escolha um (pode ser o mesmo de um AGV de outro turno).</p>` : ""}
            ${r.turno.ativo && r.turno.inicio === r.turno.fim ? `<div class="missao-dica ambar">Início e fim iguais: o turno nunca começa.</div>` : ""}
            <div class="rotina-acoes">
                <button type="button" class="btn btn-primario" data-rotina-salvar ${alterado && pode ? "" : "disabled"}>${alterado ? "Salvar rotina" : "Salva"}</button>
                ${alterado ? `<button type="button" class="btn" data-rotina-descartar>Descartar</button>` : ""}
                <span class="rotina-acoes-espaco"></span>
                ${fimDeTurno
                    ? `<button type="button" class="btn" data-rotina-turno="INICIAR_TURNO" ${pode && agv.online ? "" : "disabled"}>Iniciar turno</button>`
                    : `<button type="button" class="btn btn-roxo" data-rotina-turno="FIM_TURNO" ${pode && agv.online && st ? "" : "disabled"}>Encerrar turno</button>`}
            </div>`;
}

function renderizarRotina(abrindo = false) {
    const caixa = document.getElementById("rotinaAgvs");
    const caixaBercos = document.getElementById("rotinaBercos");
    if (!caixa || !caixaBercos) return;
    // não redesenha por cima de um campo em uso
    if (!abrindo && caixa.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    const bercos = bercosDaPlanta();
    const lista = Object.values(agvs).sort((a, b) => String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }));
    // Estrutura por AGV só muda quando a frota muda; estado e campos são
    // atualizados separados (os campos não são recriados com dados chegando).
    const ids = lista.map(a => `${a.id}:${a.nome}:${a.virtual ? 1 : 0}`).join("|");
    if (caixa.dataset.ids !== ids) {
        caixa.dataset.ids = ids;
        caixa.innerHTML = lista.length ? lista.map(agv => `
            <article class="rotina-agv" data-rotina-agv="${escaparHtml(agv.id)}">
                <div class="rotina-agv-topo">
                    <div><strong>${escaparHtml(agv.id)}</strong> <span class="suave">${escaparHtml(agv.nome || "")}</span>${agv.virtual ? ` <span class="tag-virtual">VIRTUAL</span>` : ""}</div>
                    <div class="rotina-agv-estado"></div>
                </div>
                <div class="rotina-agv-corpo"></div>
            </article>`).join("") : `<p class="suave rotina-vazio">Nenhum AGV cadastrado.</p>`;
    }
    lista.forEach(agv => {
        const art = [...caixa.querySelectorAll("[data-rotina-agv]")].find(el => el.dataset.rotinaAgv === String(agv.id));
        if (!art) return;
        const estado = art.querySelector(".rotina-agv-estado"), corpo = art.querySelector(".rotina-agv-corpo");
        const htmlEstado = estadoRotinaHtml(agv), htmlCorpo = htmlCartaoRotina(agv, bercos);
        if (estado.innerHTML !== htmlEstado) estado.innerHTML = htmlEstado;
        if (corpo.dataset.html !== htmlCorpo) { corpo.dataset.html = htmlCorpo; corpo.innerHTML = htmlCorpo; }
    });

    // berços: de quem é cada um, quem está nele, conflitos
    const linhas = bercos.map(b => {
        const donos = lista.filter(a => rotinaDoAGV(a).berco === b.id);
        const ocupante = lista.find(a => a.online && a.posicaoConhecida && a.pontoAtual === b.id);
        let aviso = "";
        for (let i = 0; i < donos.length && !aviso; i++) {
            for (let k = i + 1; k < donos.length && !aviso; k++) {
                const c = conflitoBerco(donos[i], donos[k]);
                if (c?.semHorario) aviso = `${donos[i].id} e ${donos[k].id} dividem o berço; com algum deles sem horário, os dois podem precisar dele ao mesmo tempo (o segundo espera num ponto de espera).`;
                else if (c) aviso = `${donos[i].id} e ${donos[k].id} ficam fora do turno ao mesmo tempo (${NOMES_DIAS_CURTOS[c.dia]} ${c.inicio}–${c.fim}): um deles vai esperar num ponto de espera.`;
            }
        }
        const semTag = !b.rfid ? `<div class="suave">Sem tag RFID: o AGV não se reconhece no berço ao ligar.</div>` : "";
        return `<div class="rotina-berco">
            <div class="rotina-berco-topo"><span class="rotina-icone-berco" aria-hidden="true"></span><strong>${escaparHtml(b.id)}</strong> <span class="suave">${escaparHtml(b.nome || "")}</span>
                <span class="rotina-berco-ocupado">${ocupante ? `<span class="pilula roxo">${escaparHtml(ocupante.id)} está nele</span>` : `<span class="pilula">livre</span>`}</span></div>
            <div>${donos.length ? `Casa de ${donos.map(a => `<strong>${escaparHtml(a.id)}</strong>`).join(", ")}` : `<span class="suave">Nenhum AGV usa este berço.</span>`}</div>
            ${semTag}
            ${aviso ? `<div class="missao-dica ambar">${escaparHtml(aviso)}</div>` : ""}
        </div>`;
    }).join("");
    const semBerco = lista.filter(a => !rotinaDoAGV(a).berco).map(a => a.id);
    const htmlBercos = (bercos.length ? linhas : `<p class="suave rotina-vazio">A planta publicada não tem berços. Crie em Planta › ferramenta Berço (num ramal, fora do caminho) e publique.</p>`) +
        (semBerco.length && bercos.length ? `<p class="suave rotina-vazio">Sem berço: ${semBerco.map(escaparHtml).join(", ")}.</p>` : "");
    if (caixaBercos.innerHTML !== htmlBercos) caixaBercos.innerHTML = htmlBercos;

    // mapa com os berços em destaque
    const container = document.getElementById("mapaRotina");
    if (container) {
        if (!mapaRotina) {
            mapaRotina = MapaSVG.criar(container, { rota: false, rastro: false, outros: false, mostrarTags: false });
            mapaRotina.sobreposicao = desenharDonosBercos;
        }
        const planta = plantaPublicada();
        if (mapaRotina.planta !== planta || abrindo) {
            mapaRotina.ajustado = false;
            mapaRotina.definirPlanta(planta);
        } else {
            mapaRotina.desenhar();
        }
    }
}

// Rótulo "casa de V1, V2" embaixo de cada berço
function desenharDonosBercos(mapa, grupo, { Y, px, tema }) {
    const t = tema || MapaSVG.tema();
    bercosDaPlanta().forEach(b => {
        const donos = Object.values(agvs).filter(a => rotinaDoAGV(a).berco === b.id).map(a => a.id);
        const texto = donos.length ? `casa de ${donos.join(", ")}` : "sem AGV";
        const el = MapaSVG.el("text", {
            x: b.x, y: Y(b.y) + px(26), "text-anchor": "middle", "font-size": px(11), "font-weight": 600,
            fill: donos.length ? (t.purple || t.accent) : t.muted, "paint-order": "stroke", stroke: t.papel || "#fff",
            "stroke-width": px(3), "stroke-linejoin": "round", "pointer-events": "none"
        }, grupo);
        el.textContent = texto;
    });
}

/* ---------------- edição ---------------- */

function cartaoDe(elemento) {
    const cartao = elemento.closest("[data-rotina-agv]");
    return cartao ? cartao.dataset.rotinaAgv : null;
}

function editarRascunho(agvId, mudar) {
    const agv = agvs[agvId];
    if (!agv) return;
    const r = JSON.parse(JSON.stringify(rascunhosRotina[agvId] || rotinaDoAGV(agv)));
    mudar(r);
    r.turno.dias = [...new Set(r.turno.dias)].sort();
    if (JSON.stringify(r) === JSON.stringify(rotinaDoAGV(agv))) delete rascunhosRotina[agvId];
    else rascunhosRotina[agvId] = r;
}

document.getElementById("rotina")?.addEventListener("change", evento => {
    const alvo = evento.target;
    const campo = alvo.dataset.rotina;
    const id = cartaoDe(alvo);
    if (!campo || !id) return;
    editarRascunho(id, r => {
        if (campo === "berco") r.berco = alvo.value;
        if (campo === "ativo") r.turno.ativo = alvo.checked;
        if (campo === "inicio" && alvo.value) r.turno.inicio = alvo.value;
        if (campo === "fim" && alvo.value) r.turno.fim = alvo.value;
        if (campo === "voltarApos") r.voltarApos = Math.max(0, Math.min(3600, Math.round(Number(alvo.value) || 0)));
    });
    alvo.blur();
    renderizarRotina(true);
});

document.getElementById("rotina")?.addEventListener("click", async evento => {
    const alvo = evento.target.closest("button");
    if (!alvo) return;
    const id = cartaoDe(alvo);
    if (!id) return;
    if (alvo.dataset.rotinaDia !== undefined) {
        const dia = Number(alvo.dataset.rotinaDia);
        editarRascunho(id, r => { r.turno.dias = r.turno.dias.includes(dia) ? r.turno.dias.filter(d => d !== dia) : r.turno.dias.concat([dia]); });
        renderizarRotina(true);
    } else if (alvo.dataset.rotinaSalvar !== undefined) {
        const r = rascunhosRotina[id];
        if (!r) return;
        if (r.turno.ativo && !r.turno.dias.length) { ui.aviso("Marque pelo menos um dia do turno.", "aviso"); return; }
        delete rascunhosRotina[id];
        salvarRotinaAGV(id, r);
        ui.aviso(agvs[id].online ? `Rotina do AGV ${id} salva e enviada.` : `Rotina do AGV ${id} salva. Vai para o AGV quando ele conectar (com o site aberto).`, "sucesso");
        renderizarRotina(true);
    } else if (alvo.dataset.rotinaDescartar !== undefined) {
        delete rascunhosRotina[id];
        renderizarRotina(true);
    } else if (alvo.dataset.rotinaTurno) {
        const acao = alvo.dataset.rotinaTurno;
        if (acao === "FIM_TURNO" && !(await ui.confirmar({
            titulo: `Encerrar o turno do AGV ${id}?`,
            texto: "Se estiver em missão, ele termina a missão atual. Depois vai para o berço. O resto da fila fica guardado para o próximo turno.",
            confirmar: "Encerrar turno"
        }))) return;
        comandoTurno(id, acao);
    }
});
