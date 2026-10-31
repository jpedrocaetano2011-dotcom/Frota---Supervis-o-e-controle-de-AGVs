/* ============================================================
   PLANTA NA OPERAÇÃO
   ============================================================
   Liga a planta publicada (planta.js / editor-planta.js) ao resto do
   site: posição dos AGVs, missões, mapa da Visão Geral.
   Carregado ANTES do script.js; as funções daqui usam variáveis do
   script.js (agvs, agvSelecionado, missoes, publicar...) só quando
   são chamadas.
*/

EditorPlanta.iniciar({
    aoPublicar: () => {
        renderizarMapaVisaoGeral();
        agendarAtualizacaoTela();
    },
    aoRenomearNo: (antigo, novo) => {
        let mudou = false;
        missoes.forEach(missao => (missao.etapas || []).forEach(etapa => {
            if (etapa.tipo === "IR_PARA" && etapa.destino === antigo) {
                etapa.destino = novo;
                mudou = true;
            }
        }));
        if (mudou) salvarMissoesNoNavegador();
    },
    aoCarregarExemplo: () => {
        // As missões de exemplo só entram se não houver nenhuma missão.
        if (missoes.length) return;
        missoes.push(...PlantaExemplo.missoes());
        salvarMissoesNoNavegador();
        if (typeof renderizarListaMissoes === "function") renderizarListaMissoes();
        ui.aviso("Missões de exemplo adicionadas. Publique a planta para usá-las.", "info");
    },
    ultimosRfids: () => Object.values(agvs)
        .filter(agv => /^[0-9A-F]{10}$/i.test(String(agv.sensores?.rfid?.ultimo || "")))
        .map(agv => ({ agv: agv.id, codigo: agv.sensores.rfid.ultimo })),
    missoesUsandoNo: id => missoes
        .filter(m => (m.etapas || []).some(e => e.tipo === "IR_PARA" && e.destino === id))
        .map(m => m.nome || m.id)
});

function plantaPublicada() {
    return EditorPlanta.publicada();
}

function normalizarAngulo(angulo) {
    return Planta.normalizarAngulo(angulo);
}


/* ============================================================
   PONTOS E POSIÇÃO
   ============================================================ */

// Nome amigável: "Montagem (E04)", "Montagem · acesso Norte (E04-2)"
function obterNomeEstacao(id) {
    const planta = plantaPublicada();
    if (!id) return "Ponto não encontrado";
    const estacao = Planta.estacaoPorId(planta, id);
    if (estacao) return estacao.nome ? `${estacao.nome} (${estacao.id})` : estacao.id;
    if (!Planta.noPorId(planta, id)) return `${id} (fora da planta)`;
    return Planta.nomeDoPonto(planta, id);
}

// Destinos possíveis para IR PARA: estações (o AGV escolhe o acesso) e pontos de espera
function destinosMissao() {
    const planta = plantaPublicada();
    const estacoes = (planta.estacoes || []).map(e => ({
        id: e.id, tipo: "ESTACAO", nome: e.nome || "",
        acessos: Planta.acessosDaEstacao(planta, e.id).length
    }));
    const espera = planta.nos.filter(no => no.tipo === "ESPERA").map(no => ({ id: no.id, tipo: "ESPERA", nome: no.nome || "" }));
    return estacoes.concat(espera);
}

function obterPontoPorRfid(codigo) {
    const achado = Planta.localizarRfid(plantaPublicada(), codigo);
    return achado && achado.tipo === "NO" ? achado.no : null;
}

function descreverPosicaoAGV(agv) {
    if (agv.poseOdometria && !agv.posicaoConhecida) {
        const base = agv.poseOdometria.base;
        return `Perto de ${Planta.nomeDoPonto(plantaPublicada(), base)} (estimada)`;
    }
    if (!agv.posicaoConhecida || !agv.pontoAtual) {
        return "Desconhecida";
    }
    const progresso = agv.progressoTrecho;
    if (progresso && progresso.fase !== "ODOMETRIA" && Date.now() - progresso.quando < 3000) {
        const trecho = trechoDoProgresso(agv, progresso);
        if (trecho) {
            return `${trecho.origem} → ${trecho.destino} · ${ui.numero(progresso.distancia, 2)} / ${ui.numero(trecho.comprimento, 2)} m`;
        }
    }
    return Planta.nomeDoPonto(plantaPublicada(), agv.pontoAtual);
}

function processarPosicaoAGV(agv, dados) {
    if (!dados) {
        return;
    }
    agv.posicaoConhecida = dados.conhecida === true;
    if (typeof dados.orientacao === "number") {
        agv.orientacao = normalizarAngulo(dados.orientacao);
    }
    if (!agv.posicaoConhecida) {
        agv.estacaoAtual = null;
        agv.pontoAtual = null;
        return;
    }
    agv.pontoAtual = dados.ponto;
    const no = Planta.noPorId(plantaPublicada(), dados.ponto);
    agv.estacaoAtual = no && no.tipo === "ESTACAO" ? (no.estacao || dados.ponto) : (!no ? dados.ponto : null);
    // chegou num ponto: o progresso no trecho e a odometria deixam de valer
    agv.progressoTrecho = null;
    agv.poseOdometria = null;
}

function processarProgressoAGV(agv, dados) {
    if (!dados) {
        return;
    }
    if (dados.fase === "ODOMETRIA") {
        agv.poseOdometria = {
            base: dados.base, baseOrientacao: Number(dados.baseOrientacao) || 0,
            dx: Number(dados.dx) || 0, dy: Number(dados.dy) || 0, dth: Number(dados.dth) || 0,
            conhecida: dados.conhecida === true, quando: Date.now()
        };
        agv.progressoTrecho = { fase: "ODOMETRIA", v: Number(dados.v) || 0, quando: Date.now() };
        return;
    }
    agv.poseOdometria = null;
    agv.progressoTrecho = {
        missao: dados.missao,
        indice: Number(dados.indice) || 0,
        trecho: Number(dados.trecho) || 0,
        fase: dados.fase,
        distancia: Number(dados.distancia) || 0,
        orientacao: typeof dados.orientacao === "number" ? dados.orientacao : null,
        giro: typeof dados.giro === "number" ? dados.giro : null,
        giroAlvo: typeof dados.giroAlvo === "number" ? dados.giroAlvo : null,
        v: Number(dados.v) || 0,
        quando: Date.now()
    };
}

function preencherSelectPosicao(agv) {
    const select = document.getElementById("posicaoPontoAGV");
    const sugestao = document.getElementById("posicaoSugestaoRfid");
    if (!select || !agv) {
        return;
    }
    const planta = plantaPublicada();
    const assinatura = `${planta.revisao}|` + planta.nos.map(n => `${n.id}:${n.nome}:${n.estacao || ""}`).join("|");
    if (select.dataset.assinatura !== assinatura) {
        const valorAnterior = select.value;
        select.innerHTML = `<option value="">Ponto</option>`;
        ["ESTACAO", "ESPERA", "REFERENCIA"].forEach(tipo => {
            const nos = planta.nos.filter(n => n.tipo === tipo);
            if (!nos.length) return;
            const grupo = document.createElement("optgroup");
            grupo.label = tipo === "ESTACAO" ? "Estações" : tipo === "ESPERA" ? "Espera" : "Referências";
            nos.forEach(no => {
                const option = document.createElement("option");
                option.value = no.id;
                option.textContent = Planta.nomeDoPonto(planta, no.id);
                grupo.appendChild(option);
            });
            select.appendChild(grupo);
        });
        select.value = valorAnterior;
        select.dataset.assinatura = assinatura;
    }
    const pontoRfid = obterPontoPorRfid(agv.sensores?.rfid?.ultimo);
    if (sugestao) {
        sugestao.textContent = pontoRfid
            ? `O último RFID lido (${agv.sensores.rfid.ultimo}) é do ponto ${pontoRfid.id}. Use-o só se o AGV não saiu dali.`
            : "";
    }
    // Só sugere o ponto em que o AGV sabe que está. O último RFID pode ser
    // antigo (o AGV pode ter sido movido no manual depois), então fica só
    // como dica acima.
    if (!select.value && document.activeElement !== select) {
        select.value = agv.pontoAtual || "";
        const no = Planta.noPorId(planta, select.value);
        const orientacao = document.getElementById("posicaoOrientacaoAGV");
        if (no && no.orientacaoChegada !== null && no.orientacaoChegada !== undefined && orientacao && document.activeElement !== orientacao) {
            orientacao.value = String(no.orientacaoChegada);
        }
    }
    const botao = document.getElementById("btnDefinirPosicao");
    if (botao) {
        botao.disabled =
            !agv.online ||
            ["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"].includes(agv.estadoMissao);
    }
    const detalhes = document.getElementById("vgPosicao");
    if (detalhes && !detalhes.dataset.tocado) {
        detalhes.open = agv.online && !agv.posicaoConhecida;
    }
}

async function enviarDefinirPosicao() {
    const agv = agvAtual();
    if (!agv) {
        return;
    }
    const ponto = document.getElementById("posicaoPontoAGV")?.value;
    const orientacao = normalizarAngulo(Number(document.getElementById("posicaoOrientacaoAGV")?.value) || 0);
    if (!ponto) {
        ui.aviso("Escolha o ponto onde o AGV está.", "aviso");
        return;
    }
    const planta = plantaPublicada();
    const no = Planta.noPorId(planta, ponto);
    const ok = await ui.confirmar({
        titulo: "Informar posição",
        texto: `O AGV ${agv.id} está mesmo em ${Planta.nomeDoPonto(planta, ponto)}, com a frente para ${orientacao}° (${ui.direcao(orientacao)})?\n\nUma posição errada faz o AGV seguir a rota errada.`,
        confirmar: "Sim, está aí"
    });
    if (!ok) {
        return;
    }
    const comando = { comando: "DEFINIR_POSICAO", ponto, orientacao };
    if (no && no.barreira > 0) {
        comando.barreira = no.barreira;
    }
    const enviado = publicar(TOPICOS.comando.definirPosicao, JSON.stringify(comando), agv.id);
    if (!enviado) {
        ui.aviso("MQTT desconectado: a posição não foi enviada.", "erro");
        return;
    }
    registrarAcaoSite(agv.id, "missao", "POSICAO_INFORMADA", `${ponto} · ${orientacao}°`);
    ui.aviso(`Posição enviada: ${ponto} · ${orientacao}°`, "sucesso");
}


/* ============================================================
   MISSÃO → PACOTE DO ESP
   ============================================================ */

function prepararMissaoParaESP(agvId, missaoId) {
    const agv = agvs[agvId];
    if (!agv) {
        return { sucesso: false, erro: "AGV não encontrado." };
    }
    const missao = obterMissaoPorId(missaoId);
    if (!missao) {
        return { sucesso: false, erro: `Missão "${missaoId}" não encontrada.` };
    }
    const planta = plantaPublicada();
    const posicao = agv.posicaoConhecida && agv.pontoAtual
        ? { ponto: agv.pontoAtual, orientacao: Number(agv.orientacao) || 0 }
        : null;
    const resultado = Planta.compilarMissao(planta, missao, posicao);
    if (!resultado.sucesso) {
        return resultado;
    }
    // Guarda a versão completa (com os segmentos) para desenhar a rota.
    agv.missaoCompilada = {
        missao: String(missao.id),
        revisao: planta.revisao,
        etapas: resultado.pacote.etapas
    };
    return { sucesso: true, pacote: Planta.pacoteParaESP(resultado.pacote) };
}


/* ============================================================
   POSE DO AGV NO MAPA
   ============================================================
   O ESP manda o progresso 5×/s andando. Entre uma mensagem e outra
   o site estima a posição pela velocidade (por no máximo 1 s) e o
   desenho desliza suavemente até a pose estimada.
*/

const EXTRAPOLAR_MAXIMO_MS = 1000;

function trechoDoProgresso(agv, progresso) {
    const compilada = agv.missaoCompilada;
    if (!compilada || !progresso || compilada.missao !== String(progresso.missao ?? agv.missaoAtual)) return null;
    const etapa = compilada.etapas[progresso.indice];
    return etapa?.trechos?.[progresso.trecho] || null;
}

// Pose "verdadeira" mais recente (sem suavização)
function poseEstimadaAGV(agv) {
    const planta = plantaPublicada();
    const progresso = agv.progressoTrecho;
    const agora = Date.now();

    // odometria fora de missão (manual ou posição perdida)
    if (agv.poseOdometria && agora - agv.poseOdometria.quando < 15000) {
        const o = agv.poseOdometria;
        const pose = Planta.poseOdometria(planta, o.base, o.baseOrientacao, o.dx, o.dy, o.dth);
        if (pose) return Object.assign(pose, { estimado: !o.conhecida });
    }

    const andando = ["EM_EXECUCAO", "INTERROMPIDA", "AGUARDANDO_CONFIRMACAO"].includes(agv.estadoMissao);
    if (andando && progresso && progresso.fase !== "ODOMETRIA" && agora - progresso.quando < 5000) {
        const trecho = trechoDoProgresso(agv, progresso);
        if (trecho) {
            const idade = Math.min(EXTRAPOLAR_MAXIMO_MS, agora - progresso.quando);
            const parado = agv.estadoMissao !== "EM_EXECUCAO";
            const extra = parado ? 0 : (progresso.v || 0) * idade / 1000;
            const resultado = { estimado: agora - progresso.quando > 1500 };
            if (progresso.fase === "SEGUIR_LINHA" || progresso.fase === "AVANCO_FINAL" || progresso.fase === "LATERAL") {
                const distancia = Math.min(trecho.comprimento || Infinity, progresso.distancia + extra);
                const pose = Planta.poseNoTrecho(planta, trecho, distancia, progresso.orientacao ?? undefined);
                if (pose) return Object.assign(pose, resultado);
            }
            const no = Planta.noPorId(planta, progresso.fase === "GIRO_FINAL" ? trecho.destino : trecho.origem);
            if (no) {
                return Object.assign({
                    x: no.x, y: no.y,
                    orientacao: progresso.orientacao ?? (progresso.fase === "GIRO_FINAL" ? trecho.frente ?? trecho.angulo : agv.orientacao),
                    giroAlvo: progresso.giroAlvo, giroFeito: progresso.giro
                }, resultado);
            }
        }
    }
    if (agv.posicaoConhecida && agv.pontoAtual) {
        const no = Planta.noPorId(planta, agv.pontoAtual);
        if (no) return { x: no.x, y: no.y, orientacao: Number(agv.orientacao) || 0, estimado: false };
    }
    return null;
}

// Suaviza a pose desenhada (anda até a estimada em ~150 ms)
function poseSuavizada(agv, alvo, dt) {
    if (!alvo) {
        agv._poseDesenho = null;
        return null;
    }
    const atual = agv._poseDesenho;
    if (!atual || Math.hypot(atual.x - alvo.x, atual.y - alvo.y) > 1.5) {
        agv._poseDesenho = Object.assign({}, alvo);
        return agv._poseDesenho;
    }
    const k = Math.min(1, dt / 150);
    const dAng = ((alvo.orientacao - atual.orientacao + 540) % 360) - 180;
    agv._poseDesenho = Object.assign({}, alvo, {
        x: atual.x + (alvo.x - atual.x) * k,
        y: atual.y + (alvo.y - atual.y) * k,
        orientacao: atual.orientacao + dAng * k
    });
    return agv._poseDesenho;
}

function rotaDoAGV(agv) {
    const compilada = agv?.missaoCompilada;
    if (!compilada) return null;
    const ativa = agv.missaoAtual === compilada.missao || agv.missaoCarregada === compilada.missao;
    if (!ativa) return null;
    const indice = agv.missaoAtual ? Number(agv.etapaMissao) || 0 : 0;
    for (let i = indice; i < compilada.etapas.length; i++) {
        const etapa = compilada.etapas[i];
        if (etapa.tipo === "MOVIMENTO" && etapa.trechos.length) {
            const emAndamento = i === indice && agv.missaoAtual;
            const atual = emAndamento ? (Number(agv.trechoMissao) || 0) : null;
            const andandoNoTrecho = emAndamento && ["SEGUIR_LINHA", "AVANCO_FINAL", "LATERAL"].includes(agv.progressoTrecho?.fase);
            return {
                trechos: etapa.trechos, atual, etapa: i, destino: etapa.destino,
                posicao: andandoNoTrecho ? agv._poseDesenho : null
            };
        }
    }
    return null;
}


/* ============================================================
   MAPA DA VISÃO GERAL
   ============================================================ */

let mapaVisaoGeral = null;
let animacaoMapa = null;
let ultimoQuadroMapa = 0;
const camadasMapa = { rotulos: true, mostrarTags: true, rota: true, rastro: true, outros: true, grade: false, zonas: true };

/* ------------------------------------------------------------
   TRAFEGO: zonas de conflito no mapa
   ------------------------------------------------------------ */

let cacheZonas = { planta: null, zonas: [] };
function zonasDaPlanta() {
    const planta = plantaPublicada();
    if (cacheZonas.planta !== planta) cacheZonas = { planta, zonas: Planta.zonasDeConflito(planta) };
    return cacheZonas.zonas;
}

// zona -> { ocupada: [ids], pedida: [ids] } a partir do status/trafego dos AGVs
function estadoTrafegoZonas() {
    const estado = new Map();
    const pegar = z => { if (!estado.has(z)) estado.set(z, { ocupada: [], pedida: [] }); return estado.get(z); };
    Object.values(agvs).forEach(agv => {
        const t = agv.trafego;
        if (!t) return;
        (t.o || []).forEach(z => pegar(z).ocupada.push(agv.id));
        [...(t.c || []), ...(t.p || [])].forEach(z => { const e = pegar(z); if (!e.pedida.includes(agv.id)) e.pedida.push(agv.id); });
    });
    return estado;
}

// Sobreposicao do mapa: zonas livres (contorno fraco), pedidas (ambar) e
// ocupadas (cor de destaque, com o AGV que esta nela).
function desenharZonasTrafego(mapa, grupo, { Y, px, tema }) {
    if (mapa.opcoes && mapa.opcoes.zonas === false) return;
    const planta = plantaPublicada();
    const el = MapaSVG.el;
    const t = tema || MapaSVG.tema();
    const estado = estadoTrafegoZonas();
    zonasDaPlanta().forEach(z => {
        const e = estado.get(z.id);
        const ocupada = e && e.ocupada.length > 0, pedida = e && e.pedida.length > 0;
        const cor = ocupada ? t.accent : pedida ? t.amber : t.muted;
        const opacidade = ocupada ? 0.28 : pedida ? 0.22 : 0.08;
        const g = el("g", { "pointer-events": "none", class: "zona-trafego" }, grupo);
        z.segmentos.forEach(id => {
            const s = Planta.segmentoPorId(planta, id);
            const a = s && Planta.noPorId(planta, s.a), b = s && Planta.noPorId(planta, s.b);
            if (!a || !b) return;
            el("line", { x1: a.x, y1: Y(a.y), x2: b.x, y2: Y(b.y), stroke: cor, "stroke-opacity": opacidade, "stroke-width": 0.5, "stroke-linecap": "round" }, g);
        });
        z.nos.forEach(id => {
            const n = Planta.noPorId(planta, id);
            if (!n) return;
            el("circle", { cx: n.x, cy: Y(n.y), r: 0.45, fill: cor, "fill-opacity": opacidade, stroke: cor, "stroke-opacity": ocupada || pedida ? 0.8 : 0.25, "stroke-width": 1, "stroke-dasharray": ocupada ? "" : "4 3", "vector-effect": "non-scaling-stroke" }, g);
        });
        if (ocupada || pedida) {
            const n = Planta.noPorId(planta, z.nos[0]) || null;
            if (!n) return;
            const texto = ocupada ? e.ocupada.join(", ") : "aguardando " + e.pedida.join(", ");
            const tam = px(11);
            const rotulo = el("text", { x: n.x + 0.5, y: Y(n.y) - 0.5, "font-size": tam, "font-weight": 600, fill: cor, "paint-order": "stroke", stroke: t.papel || "#fff", "stroke-width": px(3), "stroke-linejoin": "round" }, g);
            rotulo.textContent = `${z.id} · ${texto}`;
        }
    });
}

try {
    Object.assign(camadasMapa, JSON.parse(localStorage.getItem("camadasMapa") || "{}"));
} catch (e) { /* ignora */ }

function configurarCamadasMapa() {
    const botao = document.getElementById("mapaCamadasBotao");
    const caixa = document.getElementById("mapaCamadas");
    if (!botao || !caixa || botao.dataset.ok) return;
    botao.dataset.ok = "1";
    botao.addEventListener("click", evento => {
        evento.stopPropagation();
        caixa.hidden = !caixa.hidden;
        botao.setAttribute("aria-expanded", String(!caixa.hidden));
    });
    document.addEventListener("click", evento => {
        if (!caixa.hidden && !caixa.contains(evento.target)) {
            caixa.hidden = true;
            botao.setAttribute("aria-expanded", "false");
        }
    });
    caixa.querySelectorAll("[data-camada]").forEach(entrada => {
        entrada.checked = camadasMapa[entrada.dataset.camada] !== false;
        entrada.addEventListener("change", () => {
            camadasMapa[entrada.dataset.camada] = entrada.checked;
            try { localStorage.setItem("camadasMapa", JSON.stringify(camadasMapa)); } catch (e) { /* ignora */ }
            Object.assign(mapaVisaoGeral.opcoes, camadasMapa);
            mapaVisaoGeral.desenhar();
        });
    });
}

function renderizarMapaVisaoGeral() {
    const container = document.getElementById("mapaVisaoGeral");
    if (!container) {
        return;
    }
    if (!mapaVisaoGeral) {
        mapaVisaoGeral = MapaSVG.criar(container, Object.assign({}, camadasMapa));
        mapaVisaoGeral.sobreposicao = desenharZonasTrafego;
        document.getElementById("mapaZoomMais")?.addEventListener("click", () => mapaVisaoGeral.zoom(1 / 1.3));
        document.getElementById("mapaZoomMenos")?.addEventListener("click", () => mapaVisaoGeral.zoom(1.3));
        document.getElementById("mapaAjustar")?.addEventListener("click", () => mapaVisaoGeral.ajustar());
        configurarCamadasMapa();
    }
    const planta = plantaPublicada();
    if (mapaVisaoGeral.planta !== planta) {
        mapaVisaoGeral.ajustado = false;
        mapaVisaoGeral.definirPlanta(planta);
    }
    renderizarAGVMapaVisaoGeral();
    iniciarAnimacaoMapa();
}

function visaoGeralVisivel() {
    return document.getElementById("visaoGeral")?.classList.contains("ativa") && !document.hidden;
}

// Laço de animação: só roda com a Visão Geral aberta
function iniciarAnimacaoMapa() {
    if (animacaoMapa) return;
    const quadro = agora => {
        if (!visaoGeralVisivel() || !mapaVisaoGeral) {
            animacaoMapa = null;
            return;
        }
        const dt = ultimoQuadroMapa ? Math.min(200, agora - ultimoQuadroMapa) : 16;
        // ~20 quadros por segundo bastam para o AGV (no máximo 0,1 m/s)
        if (agora - ultimoQuadroMapa >= 48) {
            ultimoQuadroMapa = agora;
            desenharAGVsVisaoGeral(dt);
        }
        animacaoMapa = requestAnimationFrame(quadro);
    };
    animacaoMapa = requestAnimationFrame(quadro);
}

// Garra erguida (mais da metade do curso): desenha a caixa de carga
function garraCarregada(agv) {
    const g = agv && agv.garra;
    return Boolean(g && Number(g.curso) > 0 && Number(g.posicao) >= Number(g.curso) * 0.5);
}

function desenharAGVsVisaoGeral(dt = 50) {
    if (!mapaVisaoGeral) return;
    const selecionado = agvSelecionado ? agvs[agvSelecionado] : null;
    mapaVisaoGeral.agvs = Object.values(agvs)
        .map(agv => {
            const pose = poseSuavizada(agv, poseEstimadaAGV(agv), dt);
            if (!pose) return null;
            const categoria = typeof categoriaEstadoAGV === "function" ? categoriaEstadoAGV(agv) : { chave: "pronto", curto: "" };
            const andando = Number(agv.velocidade) > 0.002 || (agv.progressoTrecho && Date.now() - agv.progressoTrecho.quando < 1500 && agv.progressoTrecho.v > 0.002);
            if (andando) mapaVisaoGeral.registrarRastro(agv.id, pose.x, pose.y);
            return Object.assign({}, pose, {
                id: agv.id,
                rotulo: `AGV ${agv.id}${agv.id === agvSelecionado && categoria.curto ? " · " + categoria.curto : ""}`,
                destaque: agv.id === agvSelecionado,
                estado: categoria.chave,
                carga: garraCarregada(agv),
                cone: agv.online && (agv.id === agvSelecionado) ? agv.barreira : null
            });
        })
        .filter(Boolean)
        .sort((a, b) => (a.destaque ? 1 : 0) - (b.destaque ? 1 : 0));
    const rota = rotaDoAGV(selecionado);
    mapaVisaoGeral.rota = rota;
    mapaVisaoGeral.destinos = new Set(rota && rota.destino ? [rota.destino] : []);
    mapaVisaoGeral.desenhar();
}

function renderizarAGVMapaVisaoGeral() {
    if (!mapaVisaoGeral) {
        if (document.getElementById("visaoGeral")?.classList.contains("ativa")) renderizarMapaVisaoGeral();
        return;
    }
    desenharAGVsVisaoGeral();
    if (visaoGeralVisivel()) iniciarAnimacaoMapa();

    const selecionado = agvSelecionado ? agvs[agvSelecionado] : null;
    const legenda = document.getElementById("mapaLegenda");
    const caixa = document.getElementById("mapaAvisoCaixa");
    const estado = document.getElementById("mapaEstado");
    const planta = plantaPublicada();
    if (estado) {
        estado.textContent = planta.nos.length
            ? `${planta.nome || "Planta"} · revisão ${planta.revisao || 0} · ${ui.numero(planta.dimensoes.largura, 0)} × ${ui.numero(planta.dimensoes.altura, 0)} m`
            : "Sem planta publicada";
    }
    if (legenda && caixa) {
        let aviso = "";
        if (!planta.nos.length) {
            aviso = "Desenhe e publique a planta na tela Planta.";
        } else if (selecionado && !selecionado.online) {
            aviso = `AGV ${selecionado.id} offline: mostrando a última posição conhecida.`;
        } else if (selecionado && !poseEstimadaAGV(selecionado)) {
            aviso = `Posição do AGV ${selecionado.id} desconhecida: use “Informar posição”.`;
        } else if (selecionado && selecionado.poseOdometria && !selecionado.posicaoConhecida) {
            aviso = "Posição estimada pela odometria (contorno tracejado). Leve o AGV até um ponto e informe a posição.";
        }
        legenda.textContent = aviso;
        caixa.hidden = !aviso;
    }
}

document.addEventListener("visibilitychange", () => {
    if (visaoGeralVisivel()) iniciarAnimacaoMapa();
});
