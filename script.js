/* ============================================================
   FROTA - DADOS DOS AGVS
   ============================================================ */

function criarAGV(id, nome) {

    return {

        // ========================================================
        // IDENTIFICAÇÃO
        // ========================================================

        id: id,
        nome: nome,

        // ========================================================
        // CONEXÃO / ESTADO
        // ========================================================

        ligado: "DESLIGADO",

        mqttConectado: false,
        online: false,
        demoOnline: false,

        // ========================================================
        // SEGURANÇA
        // ========================================================

        emergencia: false,
        aguardandoRearme: false,

        stop: "NORMAL",
        barreira: "LIVRE",

        // ========================================================
        // ESTADO DA MÁQUINA
        // ========================================================

        maquina: "DESLIGADO",
        modo: "AUTOMATICO",

        // ========================================================
        // POSIÇÃO / MOVIMENTO
        // ========================================================

        pontoAtual: null,
        estacaoAtual: null,
        destino: null,

        x: 0,
        y: 0,

        orientacao: 0,

        bateria: null,
        velocidade: 0,

        // ========================================================
        // MISSÃO
        // ========================================================

        estadoMissao: "AGUARDANDO",
        progresso: 0,

        heartbeat: 0,
        ultimoHeartbeat: null,

        // Missão selecionada pelo operador
        missaoSelecionada: null,

        // Missão carregada no ESP
        missaoCarregada: null,

        // Etapa informada pelo ESP
        etapaMissao: null,

        // Missão atualmente em execução
        missaoAtual: null,

        // Fila de missões do AGV
        filaMissoes: [],

        // ========================================================
        // SENSORES
        // ========================================================

        sensores: {

            vl53: {

                sensor1: {
                    distancia: 0,
                    estado: "LIVRE"
                },

                sensor2: {
                    distancia: 0,
                    estado: "LIVRE"
                }
            },

            qtr: {
    sensores: [],
    posicao: 0,
    erro: 0,
    correcao: 0,

    calibracao: {
        estado: "DESCONHECIDA",
        calibracaoValida: false,
        emAndamento: false,
        mensagem: "Aguardando informações do ESP32",
        ultimaAtualizacao: 0
     }
    },

            rfid: {

                status: "OFFLINE",
                ultimo: "--",
                horario: "--",
                resultado: "--",
                estacao: "--"
            }
        },

        // ========================================================
        // CONFIGURAÇÃO
        // ========================================================

        configuracao: {},

        // ========================================================
        // SISTEMA
        // ========================================================

        sistema: {},

        // ========================================================
        // HISTÓRICO
        // ========================================================

        historico: []
    };
}

const agvsSalvos = localStorage.getItem("agvsFrota");

const agvs = agvsSalvos
    ? JSON.parse(agvsSalvos)
    : {
        "01": criarAGV("01", "JOÃO"),
        "02": criarAGV("02", "DIOGO"),
        "03": criarAGV("03", "MARIA")
    };
// Com a nuvem, a frota é a cadastrada no banco para a empresa.
if (window.Nuvem) Nuvem.ajustarFrota(agvs, criarAGV);
Object.values(agvs).forEach(agv => {

    if (!Array.isArray(agv.filaMissoes)) {
        agv.filaMissoes = [];
    }

    if (!("missaoSelecionada" in agv)) {
        agv.missaoSelecionada = null;
    }

    if (!("missaoAtual" in agv)) {
        agv.missaoAtual = null;
    }

    if (!("pontoAtual" in agv)) {
        agv.pontoAtual = null;
    }
    if (!("missaoCarregada" in agv)) {
    agv.missaoCarregada = null;
}

if (!("etapaMissao" in agv)) {
    agv.etapaMissao = null;
}

if (!("orientacao" in agv)) {
    agv.orientacao = 0;
}

if (!("configuracao" in agv)) {
    agv.configuracao = {};
}

if (!("sistema" in agv)) {
    agv.sistema = {};
}

if (!Array.isArray(agv.historico)) {
    agv.historico = [];
}

if (agv.bateria === 100) {
    agv.bateria = null;
}

// Estados transitórios não devem sobreviver a um recarregamento.
agv.carregamentoPendente = null;
agv.online = false;
agv.autotesteRodando = null;
agv._poseDesenho = null;
agv.qtrCalibVisto = null;
if (!Array.isArray(agv.rfidHistorico)) agv.rfidHistorico = [];
if (!agv.sensores) {
    agv.sensores = {
        vl53: {
            sensor1: {
                distancia: 0,
                estado: "LIVRE"
            },
            sensor2: {
                distancia: 0,
                estado: "LIVRE"
            }
        },

        qtr: {
            sensores: [],
            posicao: 0,
            erro: 0,
            correcao: 0
        },

        rfid: {
            status: "OFFLINE",
            ultimo: "--",
            horario: "--",
            resultado: "--",
            estacao: "--"
        }
    };
}

});
/* ============================================================
   PLANTA
   ============================================================ */

let agvEmEdicao = null;
let agvSelecionado = null;
let clienteMQTT = null;
let joystickAtivo = false;
let rotacaoAtiva = false;
/* ============================================================
   MISSÕES
   ============================================================ */

let missaoEmEdicao = null;
let etapaEmEdicao = null;


/* ============================================================
   BANCO DE MISSÕES
   ============================================================ */

const missoesSalvas =
    localStorage.getItem("missoesAGV");


const missoes =
    missoesSalvas
        ? JSON.parse(missoesSalvas)
        : [];
// ============================================================
// EXECUÇÃO DAS MISSÕES
// ============================================================

// Cada AGV possui sua própria execução
const execucoesMissoes = {};

// ============================================================
// CONTROLE DE CANCELAMENTO DE MISSÕES
// ============================================================

const cancelamentosMissaoPendentes = {};

const TEMPO_LIMITE_CANCELAMENTO_MS = 10000;
// Grava no máximo uma vez por segundo: o ESP publica dezenas de
// mensagens por segundo e cada gravação serializa a frota inteira.
var timerSalvarAgvs = null;

// Grava na hora (ao fechar a página o temporizador não chegaria a rodar)
function salvarAgvsFrotaAgora() {
    if (timerSalvarAgvs) {
        clearTimeout(timerSalvarAgvs);
        timerSalvarAgvs = null;
    }
    try {
        localStorage.setItem("agvsFrota", JSON.stringify(agvs));
    } catch (erro) {
        console.error("Não foi possível salvar a frota:", erro);
    }
}

window.addEventListener("pagehide", salvarAgvsFrotaAgora);
window.addEventListener("beforeunload", salvarAgvsFrotaAgora);

function salvarAgvsFrota() {

    if (timerSalvarAgvs) {
        return;
    }

    timerSalvarAgvs = setTimeout(() => {

        timerSalvarAgvs = null;

        try {
            localStorage.setItem("agvsFrota", JSON.stringify(agvs));
        } catch (erro) {
            console.error("Não foi possível salvar a frota:", erro);
        }

    }, 1000);
}


function obterMissaoPorId(id) {

    if (!id) {
        return null;
    }

    const missoesSalvas =
        localStorage.getItem("missoesAGV");

    const missoesDisponiveis =
        missoesSalvas
            ? JSON.parse(missoesSalvas)
            : [];

    if (!Array.isArray(missoesDisponiveis)) {
        return null;
    }

    return (
        missoesDisponiveis.find(
            missao => missao.id === id
        ) || null
    );
}






function gerarIdMissao() {
    const numeros = missoes
        .map(missao => Number(String(missao.id).replace(/^M/, "")))
        .filter(numero => Number.isFinite(numero));
    const maior = numeros.length ? Math.max(...numeros) : 0;
    return `M${String(maior + 1).padStart(3, "0")}`;
}

function salvarMissoesNoNavegador() {
    try {
        localStorage.setItem("missoesAGV", JSON.stringify(missoes));
    } catch (erro) {
        ui.aviso("Não foi possível salvar as missões neste navegador (espaço cheio).", "erro");
    }
    if (window.Nuvem) Nuvem.salvarMissoes(missoes);
}


/* ============================================================
   DESCRIÇÃO E ESTIMATIVA DE UMA MISSÃO
   ============================================================ */

const ICONES_ETAPA = {
    IR_PARA: ["local", "cor-ir", "Ir para"],
    AGUARDAR: ["relogio", "cor-aguardar", "Aguardar"],
    AGUARDAR_CONFIRMACAO: ["confirmar", "cor-confirmar", "Confirmação"],
    CARREGAR: ["subir", "cor-carregar", "Carregar"],
    DESCARREGAR: ["descer", "cor-descarregar", "Descarregar"]
};

function nomeCurtoDestino(id) {
    const planta = plantaPublicada();
    const estacao = Planta.estacaoPorId(planta, id);
    if (estacao) return estacao.nome || estacao.id;
    const no = Planta.noPorId(planta, id);
    if (no) {
        const daEstacao = Planta.estacaoDoNo(planta, no);
        return daEstacao ? (daEstacao.nome || daEstacao.id) : (no.nome || no.id);
    }
    return id || "?";
}

function resumoMissao(missao) {
    const partes = (missao.etapas || []).map(e => {
        switch (e.tipo) {
            case "IR_PARA": return nomeCurtoDestino(e.destino);
            case "AGUARDAR": return `aguardar ${e.tempo} s`;
            case "AGUARDAR_CONFIRMACAO": return "confirmar";
            case "CARREGAR": return "carregar";
            case "DESCARREGAR": return "descarregar";
            default: return e.tipo;
        }
    });
    return partes.join(" → ") || "sem etapas";
}

// Ponto de partida para a estimativa: o AGV selecionado (se a posição é
// conhecida) ou o primeiro destino da missão.
function partidaEstimativa(missao) {
    const planta = plantaPublicada();
    const agv = agvAtual();
    if (agv && agv.posicaoConhecida && agv.pontoAtual && Planta.noPorId(planta, agv.pontoAtual)) {
        return { ponto: agv.pontoAtual, orientacao: Number(agv.orientacao) || 0, texto: `saindo de onde o AGV ${agv.id} está` };
    }
    const primeira = (missao.etapas || []).find(e => e.tipo === "IR_PARA");
    if (!primeira) return null;
    const candidatos = Planta.candidatosDestino(planta, primeira.destino);
    const no = candidatos?.nos?.[0];
    if (!no) return null;
    return { ponto: no.id, orientacao: no.orientacaoChegada ?? 0, texto: `a partir de ${nomeCurtoDestino(primeira.destino)}` };
}

function estimarMissao(missao) {
    const planta = plantaPublicada();
    const r = { distancia: 0, tempo: 0, manobras: 0, laterais: 0, zonasLentas: [], compilada: null, erro: "", partida: null, etapasCompiladas: [] };
    if (!missao || !(missao.etapas || []).length) return r;
    const anda = missao.etapas.some(e => e.tipo === "IR_PARA");
    const partida = anda ? partidaEstimativa(missao) : { ponto: null, orientacao: 0, texto: "" };
    r.partida = partida;
    if (anda && !partida) {
        r.erro = "Algum destino não existe na planta publicada.";
        return r;
    }
    const resultado = Planta.compilarMissao(planta, missao, partida);
    if (!resultado.sucesso) {
        r.erro = resultado.erro;
        return r;
    }
    r.compilada = resultado.pacote;
    const velocidadePadrao = 0.06;
    resultado.pacote.etapas.forEach(etapa => {
        if (etapa.tipo === "MOVIMENTO") {
            let frente = etapa.orientacaoInicial;
            etapa.trechos.forEach(t => {
                const lateral = t.tipo === "LATERAL";
                const alvo = lateral ? t.orientacao : t.angulo;
                if (Math.abs(Planta.calcularGiro(frente, alvo)) > 1) {
                    r.manobras++;
                    r.tempo += Math.abs(Planta.calcularGiro(frente, alvo)) / 30;
                }
                frente = alvo;
                r.distancia += Number(t.comprimento) || 0;
                const v = lateral ? 0.03 : (t.velocidade || velocidadePadrao);
                r.tempo += (Number(t.comprimento) || 0) / v + 2;
                if (lateral) r.laterais++;
                if (t.velocidade && t.velocidade < velocidadePadrao) r.zonasLentas.push(t.velocidade);
            });
            if (etapa.orientacaoChegada >= 0 && Math.abs(Planta.calcularGiro(frente, etapa.orientacaoChegada)) > 1) {
                r.manobras++;
                r.tempo += Math.abs(Planta.calcularGiro(frente, etapa.orientacaoChegada)) / 30;
            }
        } else if (etapa.tipo === "AGUARDAR") {
            r.tempo += Number(etapa.tempo) || 0;
        } else if (etapa.tipo === "CARREGAR" || etapa.tipo === "DESCARREGAR") {
            r.tempo += 8;
        }
        r.etapasCompiladas[etapa.indice] = etapa;
    });
    return r;
}

function formatarTempoEstimado(segundos) {
    if (!(segundos > 0)) return "--";
    if (segundos < 90) return `~${Math.round(segundos)} s`;
    return `~${Math.round(segundos / 60)} min`;
}

function usoDaMissao(id) {
    const usos = [];
    Object.values(agvs).forEach(agv => {
        if (agv.missaoAtual === id) usos.push(`em execução no AGV ${agv.id}`);
        else if (agv.missaoCarregada === id) usos.push(`carregada no AGV ${agv.id}`);
        else if ((agv.filaMissoes || []).includes(id)) usos.push(`na fila do AGV ${agv.id}`);
    });
    return usos;
}


/* ============================================================
   TELA DE MISSÕES
   ============================================================ */

let missaoListaSelecionada = null;
let mapaPreviaMissao = null;

function abrirTelaMissoes() {
    renderizarListaMissoes();
    if (missaoEmEdicao) renderizarEditorMissao();
    else {
        const id = missaoListaSelecionada && missoes.some(m => m.id === missaoListaSelecionada) ? missaoListaSelecionada : missoes[0]?.id;
        if (id) editarMissao(id);
        else mostrarEditorMissao(false);
    }
}

function mostrarEditorMissao(visivel) {
    const editor = document.getElementById("painelConstrutorMissao");
    const vazio = document.getElementById("missaoEditorVazio");
    if (editor) editor.style.display = visivel ? "flex" : "none";
    if (vazio) vazio.style.display = visivel ? "none" : "flex";
}

function missaoAlterada() {
    if (!missaoEmEdicao) return false;
    const salva = missoes.find(m => m.id === missaoEmEdicao.id);
    const nome = document.getElementById("nomeMissao")?.value.trim() ?? missaoEmEdicao.nome;
    const atual = Object.assign({}, missaoEmEdicao, { nome });
    return !salva || JSON.stringify(salva) !== JSON.stringify(atual);
}

async function podeTrocarDeMissao() {
    if (!missaoAlterada()) return true;
    return ui.confirmar({
        titulo: "Descartar alterações?",
        texto: `A missão ${missaoEmEdicao.id} tem alterações que ainda não foram salvas.`,
        confirmar: "Descartar", perigo: true
    });
}

async function abrirNovaMissao() {
    if (window.Nuvem && !Nuvem.exigir("operar", "criar missões")) return;
    if (!(await podeTrocarDeMissao())) return;
    missaoEmEdicao = { id: gerarIdMissao(), nome: "", etapas: [] };
    missaoListaSelecionada = missaoEmEdicao.id;
    document.getElementById("nomeMissao").value = "";
    renderizarListaMissoes();
    renderizarEditorMissao();
    setTimeout(() => document.getElementById("nomeMissao")?.focus(), 30);
}

async function editarMissao(id) {
    const missao = missoes.find(m => m.id === id);
    if (!missao) return;
    if (missaoEmEdicao && missaoEmEdicao.id !== id && !(await podeTrocarDeMissao())) return;
    missaoEmEdicao = JSON.parse(JSON.stringify(missao));
    missaoListaSelecionada = id;
    document.getElementById("nomeMissao").value = missao.nome || "";
    renderizarListaMissoes();
    renderizarEditorMissao();
}

function renderizarListaMissoes() {
    const lista = document.getElementById("listaMissoes");
    if (!lista) return;
    const busca = (document.getElementById("buscaMissoes")?.value || "").trim().toLowerCase();
    const resumo = document.getElementById("missoesResumo");
    const planta = plantaPublicada();
    if (resumo) resumo.textContent = `${missoes.length} miss${missoes.length === 1 ? "ão" : "ões"}` +
        (planta.nos.length ? ` · rotas calculadas na planta revisão ${planta.revisao || 0}` : " · publique a planta para calcular as rotas");

    const novaNaoSalva = missaoEmEdicao && !missoes.some(m => m.id === missaoEmEdicao.id);
    const todas = novaNaoSalva ? missoes.concat([missaoEmEdicao]) : missoes;
    const filtradas = todas.filter(m => !busca ||
        `${m.id} ${m.nome} ${resumoMissao(m)}`.toLowerCase().includes(busca));

    if (!todas.length) {
        lista.innerHTML = `<div class="vazio">Nenhuma missão cadastrada.<br>Use “+ Nova missão” para criar a primeira.</div>`;
        return;
    }
    if (!filtradas.length) {
        lista.innerHTML = `<div class="vazio">Nada encontrado para “${escaparHtml(busca)}”.</div>`;
        return;
    }
    ui.trocarHtml(lista, filtradas.map(m => {
        const fonte = missaoEmEdicao && missaoEmEdicao.id === m.id ? missaoEmEdicao : m;
        const est = estimarMissao(fonte);
        const usos = usoDaMissao(m.id);
        const selecionada = m.id === missaoListaSelecionada;
        return `
            <button type="button" class="missao-item ${selecionada ? "selecionada" : ""}" data-missao="${escaparHtml(m.id)}">
                <span class="missao-item-topo"><h3>${escaparHtml(fonte.nome || "Sem nome")}</h3><span class="mono">${escaparHtml(m.id)}</span></span>
                <span class="missao-item-resumo">${escaparHtml(resumoMissao(fonte))}</span>
                <span class="missao-item-dados">
                    ${est.erro ? `<span class="erro">rota com problema</span>` : `<span class="mono">${est.distancia ? ui.numero(est.distancia, 1) + " m" : est.compilada ? "0 m" : "—"}</span><span class="mono">${formatarTempoEstimado(est.tempo)}</span>`}
                    <span>${escaparHtml(usos.join(" · ") || (novaNaoSalva && m === missaoEmEdicao ? "não salva" : ""))}</span>
                </span>
            </button>`;
    }).join(""));
}

function renderizarEditorMissao() {
    if (!missaoEmEdicao) {
        mostrarEditorMissao(false);
        return;
    }
    mostrarEditorMissao(true);
    const nova = !missoes.some(m => m.id === missaoEmEdicao.id);
    const titulo = document.getElementById("tituloConstrutorMissao");
    if (titulo) {
        titulo.textContent = `${missaoEmEdicao.id} · ${nova ? "nova missão, ainda não salva" : missaoAlterada() ? "alterações não salvas" : "salva"}`;
        titulo.style.color = nova || missaoAlterada() ? "var(--amber)" : "";
    }
    ["btnDuplicarMissaoAtual", "btnExcluirMissaoAtual", "btnEnviarMissaoAGV"].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.disabled = nova;
    });
    renderizarEtapasMissao();
}

function renderizarEtapasMissao() {
    const lista = document.getElementById("listaEtapasMissao");
    const vazio = document.getElementById("estadoVazioMissao");
    if (!lista || !vazio || !missaoEmEdicao) return;

    const est = estimarMissao(missaoEmEdicao);
    const etapas = missaoEmEdicao.etapas;
    vazio.style.display = etapas.length ? "none" : "block";

    lista.innerHTML = etapas.map((etapa, indice) => {
        const [icone, classe, tipo] = ICONES_ETAPA[etapa.tipo] || ["info", "cor-aguardar", etapa.tipo];
        let tituloEtapa = "";
        let detalhe = "";
        let erro = false;
        switch (etapa.tipo) {
            case "IR_PARA": {
                tituloEtapa = obterNomeEstacao(etapa.destino);
                const c = est.etapasCompiladas[indice];
                if (c) {
                    const chegada = c.orientacaoChegada >= 0 ? c.orientacaoChegada : c.orientacaoFinal;
                    const acesso = c.destino && c.estacao && Planta.acessosDaEstacao(plantaPublicada(), c.estacao).length > 1 ? ` · pelo acesso ${c.destino}` : "";
                    detalhe = `chega virado para ${chegada}° (${ui.direcao(chegada)}) · ${c.trechos.length} trecho${c.trechos.length === 1 ? "" : "s"}${acesso}`;
                } else if (est.erro && !est.compilada) {
                    const m = /^Etapa (\d+):/.exec(est.erro);
                    if (!m || Number(m[1]) === indice + 1) { detalhe = est.erro.replace(/^Etapa \d+: /, ""); erro = true; }
                    else detalhe = "rota não calculada (veja a etapa com erro)";
                }
                break;
            }
            case "AGUARDAR": tituloEtapa = `Esperar ${etapa.tempo} s`; detalhe = "parado no lugar"; break;
            case "AGUARDAR_CONFIRMACAO": tituloEtapa = "Operador confirma"; detalhe = `“${etapa.mensagem || "Confirmar"}” · no site ou no botão START MISSÃO`; break;
            case "CARREGAR": tituloEtapa = "Erguer a garra"; detalhe = "curso inteiro"; break;
            case "DESCARREGAR": tituloEtapa = "Baixar a garra"; detalhe = "até a posição zero"; break;
        }
        return `
            <li class="etapa ${classe}">
                <div class="etapa-trilho"><span class="etapa-icone">${ui.icone(icone)}</span><span class="etapa-linha"></span></div>
                <div class="etapa-conteudo">
                    <div>
                        <div class="etapa-tipo">${indice + 1} · ${tipo}</div>
                        <div class="etapa-titulo">${escaparHtml(tituloEtapa)}</div>
                        <div class="etapa-detalhe ${erro ? "erro" : ""}">${escaparHtml(detalhe)}</div>
                    </div>
                    <span class="etapa-acoes">
                        ${["IR_PARA", "AGUARDAR", "AGUARDAR_CONFIRMACAO"].includes(etapa.tipo) ? `<button type="button" aria-label="Editar etapa ${indice + 1}" title="Editar" onclick="editarEtapaMissao(${indice})">✎</button>` : ""}
                        <button type="button" aria-label="Subir etapa ${indice + 1}" title="Mover para cima" onclick="moverEtapaMissao(${indice}, -1)" ${indice === 0 ? "disabled" : ""}>↑</button>
                        <button type="button" aria-label="Descer etapa ${indice + 1}" title="Mover para baixo" onclick="moverEtapaMissao(${indice}, 1)" ${indice === etapas.length - 1 ? "disabled" : ""}>↓</button>
                        <button type="button" class="remover" aria-label="Excluir etapa ${indice + 1}" title="Excluir" onclick="removerEtapaMissao(${indice})">×</button>
                    </span>
                </div>
            </li>`;
    }).join("");
    renderizarPreviaMissao(est);
}

function renderizarPreviaMissao(est) {
    const host = document.getElementById("missaoPreviaMapa");
    if (!host) return;
    const planta = plantaPublicada();
    if (!mapaPreviaMissao) {
        mapaPreviaMissao = MapaSVG.criar(host, { grade: false, rotulos: true, mostrarTags: false, rastro: false, zoomRoda: false });
    }
    if (mapaPreviaMissao.planta !== planta) {
        mapaPreviaMissao.ajustado = false;
        mapaPreviaMissao.definirPlanta(planta);
    }
    const trechos = [];
    const destinos = new Set();
    (est.compilada?.etapas || []).forEach(e => {
        if (e.tipo === "MOVIMENTO") {
            trechos.push(...e.trechos);
            if (e.destino) destinos.add(e.destino);
        }
    });
    mapaPreviaMissao.rota = trechos.length ? { trechos, atual: null } : null;
    mapaPreviaMissao.destinos = destinos;
    mapaPreviaMissao.desenhar();

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set("previaDistancia", est.distancia ? `${ui.numero(est.distancia, 1)} m` : "--");
    set("previaTempo", formatarTempoEstimado(est.tempo));
    set("previaManobras", est.compilada ? String(est.manobras) : "--");
    set("missaoPreviaOrigem", est.partida?.texto ? `estimativa ${est.partida.texto}` : "");

    const itens = [];
    const ok = texto => itens.push(`<li class="ok">${ui.icone("ok")}${escaparHtml(texto)}</li>`);
    const aviso = texto => itens.push(`<li class="aviso">${ui.icone("alerta")}${escaparHtml(texto)}</li>`);
    const erro = texto => itens.push(`<li class="erro">${ui.icone("erro")}${escaparHtml(texto)}</li>`);
    const etapas = missaoEmEdicao?.etapas || [];
    if (!planta.nos.length) aviso("Nenhuma planta publicada: desenhe a planta antes de usar IR PARA.");
    if (!etapas.length) aviso("A missão ainda não tem etapas.");
    if (est.erro) erro(est.erro);
    else if (etapas.some(e => e.tipo === "IR_PARA")) {
        ok("Todos os destinos existem na planta publicada");
        (est.compilada?.etapas || []).filter(e => e.tipo === "MOVIMENTO" && e.orientacaoChegada >= 0).forEach(e => {
            ok(`${nomeCurtoDestino(e.estacao || e.destino)}: chega virado para ${e.orientacaoChegada}° (${ui.direcao(e.orientacaoChegada)})`);
        });
    }
    if (est.zonasLentas.length) aviso(`Passa por zona lenta (${ui.numero(Math.min(...est.zonasLentas), 2)} m/s)`);
    if (est.laterais) ok(`${est.laterais} troca${est.laterais > 1 ? "s" : ""} de faixa lateral (anda de lado, sem fita)`);
    const ultima = etapas[etapas.length - 1];
    if (ultima && ultima.tipo === "CARREGAR") aviso("A missão termina com a garra erguida.");
    if (etapas.length > Planta.LIMITES.etapasPorMissao) erro(`Máximo de ${Planta.LIMITES.etapasPorMissao} etapas por missão.`);
    const caixa = document.getElementById("previaVerificacoes");
    if (caixa) caixa.innerHTML = itens.join("");
}

document.getElementById("listaMissoes")?.addEventListener("click", evento => {
    const item = evento.target.closest("[data-missao]");
    if (!item) return;
    const id = item.dataset.missao;
    if (missaoEmEdicao && missaoEmEdicao.id === id) return;
    if (!missoes.some(m => m.id === id)) return;
    editarMissao(id);
});
document.getElementById("buscaMissoes")?.addEventListener("input", renderizarListaMissoes);
document.getElementById("nomeMissao")?.addEventListener("input", () => {
    if (!missaoEmEdicao) return;
    renderizarEditorMissaoTitulo();
});

function renderizarEditorMissaoTitulo() {
    const titulo = document.getElementById("tituloConstrutorMissao");
    if (!titulo || !missaoEmEdicao) return;
    const nova = !missoes.some(m => m.id === missaoEmEdicao.id);
    const alterada = missaoAlterada();
    titulo.textContent = `${missaoEmEdicao.id} · ${nova ? "nova missão, ainda não salva" : alterada ? "alterações não salvas" : "salva"}`;
    titulo.style.color = nova || alterada ? "var(--amber)" : "";
}


/* ============================================================
   ETAPAS
   ============================================================ */

function adicionarEtapaMissao(tipo) {
    if (!missaoEmEdicao) return;
    if (tipo === "CARREGAR" || tipo === "DESCARREGAR") {
        missaoEmEdicao.etapas.push({ tipo });
        renderizarEditorMissao();
        return;
    }
    etapaEmEdicao = null;
    abrirModalEtapaMissao(tipo || "");
}

function abrirModalEtapaMissao(tipoInicial) {
    const modal = document.getElementById("modalEtapaMissao");
    const titulo = document.getElementById("tituloModalEtapa");
    const tipo = document.getElementById("tipoEtapaMissao");
    if (!modal || !tipo) return;
    const editando = etapaEmEdicao !== null;
    tipo.value = editando ? missaoEmEdicao.etapas[etapaEmEdicao].tipo : (tipoInicial || "");
    const nome = (ICONES_ETAPA[tipo.value] || [])[2];
    titulo.textContent = editando ? `Editar etapa ${etapaEmEdicao + 1}` : nome ? `Adicionar: ${nome}` : "Adicionar etapa";
    document.getElementById("campoTipoEtapa").hidden = Boolean(tipo.value);
    modal.hidden = false;
    atualizarConfiguracaoEtapa();
    setTimeout(() => modal.querySelector("#configuracaoEtapaMissao select, #configuracaoEtapaMissao input, #tipoEtapaMissao")?.focus(), 30);
}

function fecharModalEtapaMissao() {
    const modal = document.getElementById("modalEtapaMissao");
    if (modal) modal.hidden = true;
    etapaEmEdicao = null;
}

function atualizarConfiguracaoEtapa() {
    const tipo = document.getElementById("tipoEtapaMissao")?.value;
    const configuracao = document.getElementById("configuracaoEtapaMissao");
    if (!configuracao) return;
    const etapa = etapaEmEdicao !== null ? missaoEmEdicao.etapas[etapaEmEdicao] : {};

    if (tipo === "IR_PARA") {
        const destinos = destinosMissao();
        if (!destinos.length) {
            configuracao.innerHTML = `<div class="nota-ambar">Nenhuma estação publicada. Desenhe e publique a planta na tela Planta.</div>`;
            return;
        }
        const grupo = (tipoNo, rotulo) => {
            const itens = destinos.filter(d => d.tipo === tipoNo);
            if (!itens.length) return "";
            return `<optgroup label="${rotulo}">${itens.map(d => `<option value="${escaparHtml(d.id)}">${escaparHtml(d.nome ? `${d.nome} (${d.id})` : d.id)}${d.acessos > 1 ? ` · ${d.acessos} acessos` : ""}</option>`).join("")}</optgroup>`;
        };
        configuracao.innerHTML = `
            <label class="missao-label">Destino
                <select id="destinoEtapaMissao"><option value="">Escolha a estação</option>${grupo("ESTACAO", "Estações")}${grupo("ESPERA", "Pontos de espera")}</select>
            </label>
            <small>Estação com mais de um acesso: o AGV usa o caminho mais curto até um deles.</small>`;
        document.getElementById("destinoEtapaMissao").value = etapa.destino || "";
        return;
    }
    if (tipo === "AGUARDAR") {
        configuracao.innerHTML = `
            <label class="missao-label">Tempo de espera
                <div class="editor-com-unidade"><input type="number" id="tempoEtapaMissao" min="1" max="3600" step="1" placeholder="Ex.: 5"><em>s</em></div>
            </label>`;
        document.getElementById("tempoEtapaMissao").value = etapa.tempo || "";
        return;
    }
    if (tipo === "AGUARDAR_CONFIRMACAO") {
        configuracao.innerHTML = `
            <label class="missao-label">Mensagem para o operador
                <input type="text" id="mensagemEtapaMissao" maxlength="60" placeholder="Ex.: Kit conferido?">
            </label>
            <small>O operador confirma pelo site ou apertando START MISSÃO no AGV (a fita fica ciano piscando).</small>`;
        document.getElementById("mensagemEtapaMissao").value = etapa.mensagem || "";
        return;
    }
    configuracao.innerHTML = "";
}

function confirmarEtapaMissao() {
    const tipo = document.getElementById("tipoEtapaMissao")?.value;
    if (!tipo) {
        ui.aviso("Escolha o tipo de operação.", "aviso");
        return;
    }
    const etapa = { tipo };
    if (tipo === "IR_PARA") {
        const destino = document.getElementById("destinoEtapaMissao")?.value;
        if (!destino) { ui.aviso("Escolha o destino da etapa.", "aviso"); return; }
        etapa.destino = destino;
    }
    if (tipo === "AGUARDAR") {
        const tempo = Number(document.getElementById("tempoEtapaMissao")?.value);
        if (!Number.isFinite(tempo) || tempo <= 0) { ui.aviso("Informe um tempo de espera válido.", "aviso"); return; }
        etapa.tempo = Math.round(tempo);
    }
    if (tipo === "AGUARDAR_CONFIRMACAO") {
        const mensagem = document.getElementById("mensagemEtapaMissao")?.value.trim();
        if (!mensagem) { ui.aviso("Escreva a mensagem que o operador vai ver.", "aviso"); return; }
        etapa.mensagem = mensagem;
    }
    if (etapaEmEdicao === null) missaoEmEdicao.etapas.push(etapa);
    else missaoEmEdicao.etapas[etapaEmEdicao] = etapa;
    fecharModalEtapaMissao();
    renderizarEditorMissao();
    renderizarListaMissoes();
}

function editarEtapaMissao(indice) {
    if (!missaoEmEdicao || !missaoEmEdicao.etapas[indice]) return;
    etapaEmEdicao = indice;
    abrirModalEtapaMissao();
}

function moverEtapaMissao(indice, direcao) {
    if (!missaoEmEdicao) return;
    const novoIndice = indice + direcao;
    if (novoIndice < 0 || novoIndice >= missaoEmEdicao.etapas.length) return;
    const temp = missaoEmEdicao.etapas[indice];
    missaoEmEdicao.etapas[indice] = missaoEmEdicao.etapas[novoIndice];
    missaoEmEdicao.etapas[novoIndice] = temp;
    renderizarEditorMissao();
    renderizarListaMissoes();
}

function removerEtapaMissao(indice) {
    if (!missaoEmEdicao) return;
    missaoEmEdicao.etapas.splice(indice, 1);
    renderizarEditorMissao();
    renderizarListaMissoes();
}

function salvarMissao() {
    if (window.Nuvem && !Nuvem.exigir("operar", "salvar missões")) return;
    if (!missaoEmEdicao) return;
    const nome = document.getElementById("nomeMissao").value.trim();
    if (!nome) {
        ui.aviso("Dê um nome para a missão.", "aviso");
        document.getElementById("nomeMissao").focus();
        return;
    }
    if (!missaoEmEdicao.etapas.length) {
        ui.aviso("Adicione pelo menos uma etapa.", "aviso");
        return;
    }
    missaoEmEdicao.nome = nome;
    const copia = JSON.parse(JSON.stringify(missaoEmEdicao));
    const indice = missoes.findIndex(m => m.id === missaoEmEdicao.id);
    if (indice >= 0) missoes[indice] = copia;
    else missoes.push(copia);
    salvarMissoesNoNavegador();
    missaoListaSelecionada = copia.id;
    renderizarListaMissoes();
    renderizarEditorMissao();
    renderizarControleFilaAGV();
    ui.aviso(`Missão ${copia.id} salva.`, "sucesso");
}

async function descartarEdicaoMissao() {
    if (!missaoEmEdicao) return;
    if (missaoAlterada() && !(await ui.confirmar({ titulo: "Descartar alterações?", texto: "As mudanças feitas nesta missão serão perdidas.", confirmar: "Descartar", perigo: true }))) return;
    const salva = missoes.find(m => m.id === missaoEmEdicao.id);
    missaoEmEdicao = null;
    if (salva) editarMissao(salva.id);
    else {
        missaoListaSelecionada = missoes[0]?.id || null;
        if (missaoListaSelecionada) editarMissao(missaoListaSelecionada);
        else { renderizarListaMissoes(); mostrarEditorMissao(false); }
    }
}

function voltarListaMissoes() {
    descartarEdicaoMissao();
}

async function duplicarMissao(id) {
    const missao = missoes.find(m => m.id === id);
    if (!missao) return;
    if (window.Nuvem && !Nuvem.exigir("operar", "criar missões")) return;
    if (!(await podeTrocarDeMissao())) return;
    const copia = JSON.parse(JSON.stringify(missao));
    copia.id = gerarIdMissao();
    copia.nome = `${copia.nome} (cópia)`;
    missoes.push(copia);
    salvarMissoesNoNavegador();
    missaoEmEdicao = null;
    editarMissao(copia.id);
    ui.aviso(`Missão copiada como ${copia.id}.`, "sucesso");
}

async function excluirMissao(id) {
    const missao = missoes.find(m => m.id === id);
    if (!missao) return;
    if (window.Nuvem && !Nuvem.exigir("operar", "excluir missões")) return;
    const usos = usoDaMissao(id);
    const ok = await ui.confirmar({
        titulo: `Excluir ${missao.id}?`,
        texto: `“${missao.nome}” será apagada${window.Nuvem?.emNuvem() ? " para todos da empresa" : " deste navegador"}.${usos.length ? `\n\nAtenção: ${usos.join(", ")}.` : ""}`,
        confirmar: "Excluir", perigo: true
    });
    if (!ok) return;
    missoes.splice(missoes.findIndex(m => m.id === id), 1);
    salvarMissoesNoNavegador();
    if (missaoEmEdicao && missaoEmEdicao.id === id) missaoEmEdicao = null;
    missaoListaSelecionada = missoes[0]?.id || null;
    if (missaoListaSelecionada) editarMissao(missaoListaSelecionada);
    else { renderizarListaMissoes(); mostrarEditorMissao(false); }
    renderizarControleFilaAGV();
}

// Escolhe um AGV e carrega a missão nele (ou põe na fila se ele estiver ocupado)
async function enviarMissaoParaAGV() {
    if (!missaoEmEdicao) return;
    if (missaoAlterada()) {
        ui.aviso("Salve a missão antes de enviar.", "aviso");
        return;
    }
    const id = missaoEmEdicao.id;
    const lista = Object.values(agvs);
    if (!lista.length) { ui.aviso("Nenhum AGV cadastrado.", "aviso"); return; }
    const escolhido = await new Promise(resolver => {
        const fundo = document.createElement("div");
        fundo.className = "modal-overlay ativo";
        fundo.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="enviarMissaoTitulo">
                <div class="modal-cabecalho"><div><h2 id="enviarMissaoTitulo">Enviar ${escaparHtml(id)} para…</h2><p>Se o AGV estiver ocupado, a missão vai para a fila dele.</p></div></div>
                <div class="modal-corpo"><fieldset class="opcoes-radio">${lista.map((agv, i) => {
                    const cat = categoriaEstadoAGV(agv);
                    return `<label class="opcao-radio"><input type="radio" name="agvDestino" value="${escaparHtml(agv.id)}" ${i === 0 ? "checked" : ""}>
                        <span><strong>AGV ${escaparHtml(agv.id)} · ${escaparHtml(agv.nome)}</strong><small>${cat.texto}${agv.online ? " · " + escaparHtml(descreverPosicaoAGV(agv)) : ""}</small></span></label>`;
                }).join("")}</fieldset></div>
                <div class="modal-acoes"><button type="button" class="btn" data-r="0">Voltar</button><button type="button" class="btn btn-primario" data-r="1">Enviar</button></div>
            </div>`;
        const fechar = valor => { fundo.remove(); resolver(valor); };
        fundo.addEventListener("click", e => {
            if (e.target === fundo) fechar(null);
            const b = e.target.closest("[data-r]");
            if (b) fechar(b.dataset.r === "1" ? fundo.querySelector('input[name="agvDestino"]:checked')?.value : null);
        });
        document.body.appendChild(fundo);
    });
    if (!escolhido) return;
    const agv = agvs[escolhido];
    if (podeCarregarMissao(agv) && !["CARREGADA"].includes(agv.estadoMissao)) {
        if (iniciarMissaoPorId(agv.id, id)) ui.aviso(`Missão ${id} enviada ao AGV ${agv.id}. Aperte START MISSÃO no AGV para começar.`, "sucesso");
    } else {
        if (!(agv.filaMissoes || []).includes(id)) agv.filaMissoes.push(id);
        salvarAgvsFrota();
        ui.aviso(`AGV ${agv.id} ocupado: ${id} entrou na fila (posição ${agv.filaMissoes.length}).`, "info");
    }
    renderizarListaMissoes();
}

document.getElementById("btnNovaMissao")?.addEventListener("click", abrirNovaMissao);
document.getElementById("tipoEtapaMissao")?.addEventListener("change", atualizarConfiguracaoEtapa);
document.getElementById("btnConfirmarEtapa")?.addEventListener("click", confirmarEtapaMissao);
document.getElementById("btnCancelarEtapa")?.addEventListener("click", fecharModalEtapaMissao);
document.getElementById("btnFecharModalEtapa")?.addEventListener("click", fecharModalEtapaMissao);
document.getElementById("modalEtapaMissao")?.addEventListener("keydown", evento => {
    if (evento.key === "Enter" && evento.target.matches("input")) { evento.preventDefault(); confirmarEtapaMissao(); }
    if (evento.key === "Escape") fecharModalEtapaMissao();
});
document.getElementById("btnCancelarMissao")?.addEventListener("click", descartarEdicaoMissao);
document.getElementById("btnSalvarMissao")?.addEventListener("click", salvarMissao);
document.getElementById("btnDuplicarMissaoAtual")?.addEventListener("click", () => missaoEmEdicao && duplicarMissao(missaoEmEdicao.id));
document.getElementById("btnExcluirMissaoAtual")?.addEventListener("click", () => missaoEmEdicao && excluirMissao(missaoEmEdicao.id));
document.getElementById("btnEnviarMissaoAGV")?.addEventListener("click", enviarMissaoParaAGV);
document.getElementById("adicionarEtapa")?.addEventListener("click", evento => {
    const botao = evento.target.closest("[data-nova-etapa]");
    if (botao) adicionarEtapaMissao(botao.dataset.novaEtapa);
});


const STATUS_LIGADO = ["LIGADO", "DESLIGADO"];
const ESTADOS_MAQUINA = [
    "DESLIGADO",
    "PRONTO",
    "MANUAL",
    "AUTOMATICO",
    "MISSAO",
    "PARADO",
    "EMERGENCIA",
    "AGUARDANDO_REARME",
    "AGUARDANDO_OBSTACULO",
    "AGUARDANDO_MODO"
];
const MODOS = ["MANUAL", "AUTOMATICO"];
const ESTADOS_MISSAO = [
    "AGUARDANDO",
    "CARREGADA",
    "EM_EXECUCAO",
    "AGUARDANDO_CONFIRMACAO",
    "INTERROMPIDA",
    "CONCLUIDA",
    "CANCELADA",
    "ERRO"
];
const STATUS_STOP = ["NORMAL", "ACIONADO"];
const STATUS_EMERGENCIA = ["NORMAL", "ACIONADA"];
const STATUS_REARME = ["LIBERADO", "NECESSARIO"];
const STATUS_BARREIRA = ["LIVRE", "INVADIDA", "FALHA_LEITURA"];
const TOPICOS = {

    // ============================================================
    // ESP → FRONTEND
    // STATUS
    // ============================================================

    status: {

        ligado: "status/ligado",
        maquina: "status/maquina",
        modo: "status/modo",

        bateria: "status/bateria",
        velocidade: "status/velocidade",

        estacao: "status/estacao",
        destino: "status/destino",
    

        estadoMissao: "status/estado_missao",
        progresso: "status/progresso",
        heartbeat: "status/heartbeat",

        // --------------------------------------------------------
        // SEGURANÇA
        // --------------------------------------------------------

        seguranca: {

            stop: "status/seguranca/stop",
            emergencia: "status/seguranca/emergencia",
            rearme: "status/seguranca/rearme",
            barreira: "status/seguranca/barreira"
        },

        // --------------------------------------------------------
        // SENSORES
        // --------------------------------------------------------

        sensores: {

            vl53: {
                sensor1: "status/sensores/vl53/1",
                sensor2: "status/sensores/vl53/2"
            },

            qtr: "status/sensores/qtr",

            rfid: "status/sensores/rfid"
        },

        // --------------------------------------------------------
        // MISSÃO
        // --------------------------------------------------------

        missao: {

            id: "status/missao/id",
            etapa: "status/missao/etapa"
        },

        // --------------------------------------------------------
        // CONFIGURAÇÃO
        // --------------------------------------------------------

        configuracao: "status/configuracao"
    },

    // ============================================================
    // FRONTEND → ESP
    // COMANDOS
    // ============================================================

    
   comando: {
    start: "comando/start",
    stop: "comando/stop",
    rearme: "comando/rearme",
    modo: "comando/modo",
    manual: "comando/manual",

    configuracao: "comando/configuracao",

    garraMovimento: "comando/garra/movimento",
    garraParar: "comando/garra/parar",
    carregarMissao: "comando/carregar_missao",
    confirmarEtapa: "comando/confirmar_etapa",
    cancelarMissao: "comando/cancelar_missao",
    definirPosicao: "comando/definir_posicao",
    calibracaoQtr: "comando/calibracao_qtr",
    calibracaoMecanica: "comando/calibracao_mecanica",
    ota: "comando/ota",
    autoteste: "comando/autoteste"
   },


    // ============================================================
    // ESP → FRONTEND
    // EVENTOS
    // ============================================================

    evento: "evento",

    // ============================================================
    // ESP → FRONTEND
    // SISTEMA
    // ============================================================

    sistema: {

        versao: "sistema/versao",
        ip: "sistema/ip",
        uptime: "sistema/uptime"
    }
};
/*
   Coloque aqui as mesmas credenciais que você já usa no seu projeto.
   Elas ficam no navegador porque esta é uma aplicação web estática.
*/
const mqttConfig = {
    host: "f6ceab8162134aa0b1c56a36b2d292f2.s1.eu.hivemq.cloud",
    port: 8884,
    protocol: "wss",
    path: "/mqtt",
    username: "agvomni1",
    password: "agvomni1"
};


function agvAtual() {
    return agvs[agvSelecionado];
}

function gerarTopico(id, caminho) {
    return `agv/${id}/${caminho}`;
}

function marcarHeartbeat(id) {
    const agv = agvs[id];
    if (!agv) return;
    agv.ultimoHeartbeat = Date.now();
    agv.online = true;
}

function atualizarOnline() {
    const agora = Date.now();
    Object.values(agvs).forEach(agv => {
        if (agv.demoOnline) return;
        agv.online = agv.ultimoHeartbeat > 0 && (agora - agv.ultimoHeartbeat < 5000);
    });
    renderizarFrota();
    agendarAtualizacaoTela();
}

/* ============================================================
   MQTT DA FROTA
   ============================================================ */

function conectarMQTT() {

    if (!window.mqtt) {
        console.error("Biblioteca MQTT não carregada.");
        return;
    }

    clienteMQTT = mqtt.connect(
        `wss://${mqttConfig.host}:${mqttConfig.port}${mqttConfig.path}`,
        {
            username: mqttConfig.username,
            password: mqttConfig.password,
            clientId: `painel-frota-${Math.random().toString(16).slice(2)}`,
            reconnectPeriod: 3000
        }
    );

    clienteMQTT.on("connect", () => {

        console.log("MQTT conectado à frota.");

        atualizarIndicadorMQTT(true);

        // O ESP publica eventos em agv/<id>/evento/missao, por isso
        // a assinatura precisa do curinga "#" (antes era só agv/+/evento).
        [
            "agv/+/status/#",
            "agv/+/evento",
            "agv/+/evento/#",
            "agv/+/sistema/#"
        ].forEach(topico => {

            clienteMQTT.subscribe(topico, { qos: 1 }, erro => {
                if (erro) {
                    console.error("Erro na inscrição MQTT:", topico, erro);
                }
            });
        });

        atualizarPainelCalibracaoQTR();
    });

    clienteMQTT.on("message", (topico, mensagem) => {
        processarMensagemMQTT(topico, mensagem.toString());
    });

    clienteMQTT.on("error", erro => {
        console.error("Erro MQTT:", erro);
        atualizarIndicadorMQTT(false);
    });

    clienteMQTT.on("close", () => {
        atualizarIndicadorMQTT(false);
    });
}
function atualizarIndicadorMQTT(conectado) {
    const dot = document.getElementById("indicadorMqtt");
    const status = document.getElementById("statusMqtt");
    const sideDot = document.getElementById("sidebarMqttDot");
    const sideText = document.getElementById("sidebarMqtt");

    [dot, sideDot].forEach(el => {
        if (!el) return;
        el.classList.toggle("verde", conectado);
        el.classList.toggle("vermelho", !conectado);
    });
    if (status) status.textContent = conectado ? "CONECTADO" : "DESCONECTADO";
    if (sideText) sideText.textContent = conectado ? "MQTT conectado" : "MQTT desconectado";

    Object.values(agvs).forEach(agv => agv.mqttConectado = conectado);
    atualizarPainel();
    atualizarPainelCalibracaoQTR();
}

function processarMensagemMQTT(topico, valor) {

    const partes = topico.split("/");

    // agv/{id}/{caminho}
    if (partes.length < 3 || partes[0] !== "agv") {
        return;
    }

    const id = partes[1];
    const agv = agvs[id];

    if (!agv) {
        return;
    }

    const caminho = partes.slice(2).join("/");

    const lerJSON = () => {
        try {
            return JSON.parse(valor);
        } catch (_) {
            console.error("JSON inválido em", topico, valor);
            return null;
        }
    };


    // ========================================================
    // EVENTOS
    // ========================================================

    if (caminho === "evento" || caminho.startsWith("evento/")) {

        const eventoCancelamento =
            processarConfirmacaoCancelamentoMissao(agv.id, valor);

        if (!eventoCancelamento) {
            processarEventoMissao(agv.id, valor);
        }

        registrarEventoHistorico(agv.id, valor, caminho);
        try {
            processarEventoPainel(agv, JSON.parse(valor));
        } catch (_) {
            // evento em texto simples
        }
        agendarAtualizacaoTela();
        return;
    }


    // ========================================================
    // SISTEMA
    // ========================================================

    if (caminho.startsWith("sistema/")) {

        if (!agv.sistema) {
            agv.sistema = {};
        }

        agv.sistema[caminho.replace("sistema/", "")] = valor;

        salvarAgvsFrota();
        agendarAtualizacaoTela();
        return;
    }


    // ========================================================
    // STATUS
    // ========================================================

    switch (caminho) {

        case "status/conexao":

            agv.conexao = valor;

            // LWT: o broker avisa na hora quando o ESP cai.
            if (valor === "OFFLINE") {
                agv.online = false;
                agv.ultimoHeartbeat = 0;
            }

            break;


        case "status/ligado":

            if (STATUS_LIGADO.includes(valor)) {
                agv.ligado = valor;
            }

            break;


        case "status/maquina":

            if (ESTADOS_MAQUINA.includes(valor)) {
                agv.maquina = valor;
            }

            break;


        case "status/modo":

            if (MODOS.includes(valor)) {
                agv.modo = valor;
            }

            break;


        case "status/bateria":

            if (!isNaN(Number(valor))) {
                agv.bateria = Math.max(0, Math.min(100, Number(valor)));
            }

            break;


        case "status/velocidade":

            if (!isNaN(Number(valor))) {
                agv.velocidade = Math.max(0, Number(valor));
            }

            break;


        case "status/heartbeat":

            // O ESP envia o tempo ligado, em segundos.
            if (!isNaN(Number(valor))) {
                agv.heartbeat = Number(valor);
                agv.uptime = Number(valor);
                marcarHeartbeat(id);
            }

            break;


        case "status/missao":

            processarStatusMissao(agv, lerJSON());
            break;


        case "status/posicao":

            processarPosicaoAGV(agv, lerJSON());
            break;


        case "status/progresso":

            processarProgressoAGV(agv, lerJSON());
            agendarAtualizacaoTela();
            return;


        // Compatibilidade com firmwares antigos.
        case "status/estacao": {

            agv.estacaoAtual = valor;
            agv.pontoAtual = valor;
            agv.posicaoConhecida = Boolean(valor);
            break;
        }


        case "status/garra": {

            const garra = lerJSON();

            if (garra) {
                agv.garra = garra;
            }

            break;
        }


        // ====================================================
        // SEGURANÇA
        // ====================================================

        case "status/seguranca/stop":

            if (STATUS_STOP.includes(valor)) {
                agv.stop = valor;
            }

            break;


        case "status/seguranca/emergencia":

            if (STATUS_EMERGENCIA.includes(valor)) {
                const acionada = valor === "ACIONADA";
                if (acionada && !agv.emergencia) agv.emergenciaDesde = Date.now();
                if (!acionada) agv.emergenciaDesde = null;
                agv.emergencia = acionada;
            }

            break;


        case "status/seguranca/rearme":

            if (STATUS_REARME.includes(valor)) {
                agv.aguardandoRearme = valor === "NECESSARIO";
            }

            break;


        case "status/seguranca/barreira":

            if (STATUS_BARREIRA.includes(valor)) {
                agv.barreira = valor;
            }

            break;


        // ====================================================
        // CONFIGURAÇÃO
        // ====================================================

        case "status/configuracao":

            processarConfiguracaoESP(agv, lerJSON());
            break;


        case "status/configuracao/esquema":

            processarEsquemaESP(agv, lerJSON());
            break;


        // ====================================================
        // SENSORES
        // ====================================================

        case "status/sensores/qtr": {

            const dadosQTR = lerJSON();

            if (dadosQTR) {

                const calibracaoAtual =
                    agv.sensores.qtr?.calibracao || {
                        estado: "DESCONHECIDA",
                        calibracaoValida: false,
                        emAndamento: false,
                        mensagem: "Aguardando informações do ESP32",
                        ultimaAtualizacao: 0
                    };

                agv.sensores.qtr = {
                    ...agv.sensores.qtr,
                    ...dadosQTR,
                    calibracao: calibracaoAtual
                };
                registrarLeituraCalibracaoQTR(agv);
            }
            // leituras rápidas: só a tela aberta precisa redesenhar
            agendarAtualizacaoTela();
            return;

            break;
        }


        case "status/qtr/calibracao": {

            const dadosCalibracao = lerJSON();

            if (dadosCalibracao) {

                const estavaCalibrando = agv.sensores.qtr?.calibracao?.emAndamento === true;
                if (dadosCalibracao.emAndamento === true && (!estavaCalibrando || !agv.qtrCalibVisto)) {
                    agv.qtrCalibVisto = { min: Array(8).fill(4095), max: Array(8).fill(0), desde: Date.now() };
                }
                agv.sensores.qtr.calibracao = {
                    estado: String(dadosCalibracao.estado || "DESCONHECIDA"),
                    calibracaoValida: dadosCalibracao.calibracaoValida === true,
                    emAndamento: dadosCalibracao.emAndamento === true,
                    mensagem: String(dadosCalibracao.mensagem || "Status recebido do ESP32"),
                    ultimaAtualizacao: Date.now()
                };
            }

            break;
        }


        case "status/sensores/vl53": {

            const dadosVL53 = lerJSON();

            if (dadosVL53) {
                agv.sensores.vl53 = dadosVL53;
            }

            break;
        }


        case "status/sensores/rfid": {

            const dadosRFID = lerJSON();

            if (dadosRFID && dadosRFID.codigo) {

                const ponto = obterPontoPorRfid(dadosRFID.codigo);

                const nova = agv.sensores.rfid?.sequencia !== dadosRFID.sequencia || agv.sensores.rfid?.ultimo !== dadosRFID.codigo;
                agv.sensores.rfid = {
                    status: "ONLINE",
                    ultimo: dadosRFID.codigo,
                    sequencia: dadosRFID.sequencia,
                    horario: new Date().toLocaleTimeString("pt-BR"),
                    quando: Date.now(),
                    resultado: ponto ? "CADASTRADO" : "NÃO CADASTRADO",
                    estacao: ponto ? ponto.id : "--"
                };
                if (nova) {
                    if (!Array.isArray(agv.rfidHistorico)) agv.rfidHistorico = [];
                    agv.rfidHistorico.unshift({ codigo: dadosRFID.codigo, quando: Date.now() });
                    agv.rfidHistorico.length = Math.min(agv.rfidHistorico.length, 20);
                }
            }

            break;
        }


        // ====================================================
        // FIRMWARE 0.7: LEDS, PAINEL, DIAGNÓSTICO E AUTOTESTE
        // ====================================================

        case "status/leds":

            agv.leds = valor;
            break;


        case "status/entradas":

            agv.entradas = Number(valor);
            break;


        case "status/diagnostico": {

            const diagnostico = lerJSON();

            if (diagnostico) {
                agv.diagnostico = diagnostico;
                agv.diagnosticoRecebido = Date.now();
                guardarHistoricoDiagnostico(agv, diagnostico);
                if (typeof diagnostico.leds === "string") agv.leds = diagnostico.leds;
                if (typeof diagnostico.entradas === "number") agv.entradas = diagnostico.entradas;
            }

            break;
        }


        case "status/autoteste": {

            const autoteste = lerJSON();

            if (autoteste && Array.isArray(autoteste.itens)) {
                const esperado = Boolean(agv.autotesteRodando);
                agv.autoteste = Object.assign(autoteste, { recebido: Date.now() });
                agv.autotesteRodando = null;
                if (esperado) {
                    const r = autoteste.resultado;
                    ui.aviso(`Autoteste do AGV ${agv.id}: ${r === "FALHA" ? "reprovado" : r === "AVISO" ? "aprovado com avisos" : "aprovado"}.`,
                        r === "FALHA" ? "erro" : r === "AVISO" ? "aviso" : "sucesso");
                }
            }

            break;
        }


        default:
            break;
    }

    salvarAgvsFrota();
    agendarAtualizacaoTela();
}
function registrarEventoHistorico(agvId, mensagem, caminho = "evento") {

    const agv = agvs[agvId];

    if (!agv) {
        return;
    }

    if (!Array.isArray(agv.historico)) {
        agv.historico = [];
    }

    let dados = mensagem;

    try {
        dados = JSON.parse(mensagem);
    } catch (_) {
        // Evento simples em texto
    }

    // evento/seguranca -> "seguranca"; o firmware 0.6 também manda o campo "categoria"
    const categoria =
        (dados && typeof dados === "object" && dados.categoria) ||
        (caminho.startsWith("evento/") ? caminho.slice(7) : "missao");

    agv.historico.unshift({
        data: new Date().toISOString(),
        categoria,
        evento: dados
    });

    // Limita o histórico local para não crescer sem fim.
    if (agv.historico.length > 1000) {
        agv.historico.length = 1000;
    }

    salvarAgvsFrota();
}

// AGV virtual: comandos vão direto para o firmware simulado no navegador.
function canalDisponivel(agv) {
    return Boolean(agv && agv.virtual) || Boolean(clienteMQTT && clienteMQTT.connected);
}

function publicar(caminho, mensagem, id = agvSelecionado, qos = 1) {

    if (id && agvs[id]?.virtual && typeof AgvVirtual !== "undefined") {
        return AgvVirtual.receberComando(id, caminho, String(mensagem));
    }

    if (window.Nuvem && !Nuvem.podePublicar(caminho)) return false;

    if (!clienteMQTT || !clienteMQTT.connected || !id) {
        console.error(
            "MQTT não conectado ou AGV não selecionado."
        );
        return false;
    }

    const topico = gerarTopico(id, caminho);

    if (qos > 0) {
        console.log("PUBLICANDO:", topico, mensagem);
    }

    clienteMQTT.publish(
        topico,
        String(mensagem),
        { qos },
        erro => {

            if (erro) {
                console.error(
                    "Erro ao publicar MQTT:",
                    erro
                );
                return;
            }

        }
    );

    return true;
}




/* ============================================================
   ESTADO RESUMIDO DE UM AGV (cores da frota e do mapa)
   ============================================================ */

// chave: missao | pronto | atencao | falha | emergencia | offline | desligado
function categoriaEstadoAGV(agv) {
    if (!agv || !agv.online) {
        return { chave: "offline", texto: "OFFLINE", curto: "OFFLINE", filtro: "offline" };
    }
    if (agv.emergencia || agv.maquina === "EMERGENCIA") {
        return { chave: "emergencia", texto: "EMERGÊNCIA", curto: "EMERGÊNCIA", filtro: "falha" };
    }
    if (agv.maquina === "PARADO" || agv.barreira === "FALHA_LEITURA") {
        return { chave: "falha", texto: "FALHA", curto: "FALHA", filtro: "falha" };
    }
    if (agv.estadoMissao === "ERRO") {
        return { chave: "falha", texto: "ERRO NA MISSÃO", curto: "ERRO", filtro: "falha" };
    }
    if (agv.aguardandoRearme) {
        return { chave: "atencao", texto: "AGUARDANDO REARME", curto: "REARME", filtro: "atencao" };
    }
    if (agv.barreira === "INVADIDA" && (agv.estadoMissao === "EM_EXECUCAO" || agv.modo === "MANUAL")) {
        return { chave: "atencao", texto: "OBSTÁCULO", curto: "OBSTÁCULO", filtro: "atencao" };
    }
    if (agv.estadoMissao === "INTERROMPIDA") {
        return { chave: "atencao", texto: "MISSÃO PARADA", curto: "PARADA", filtro: "atencao" };
    }
    if (agv.estadoMissao === "AGUARDANDO_CONFIRMACAO") {
        return { chave: "atencao", texto: "AGUARDA CONFIRMAÇÃO", curto: "CONFIRMAR", filtro: "atencao" };
    }
    if (agv.estadoMissao === "EM_EXECUCAO") {
        return { chave: "missao", texto: "EM MISSÃO", curto: "EM MISSÃO", filtro: "missao" };
    }
    if (agv.estadoMissao === "CARREGADA") {
        return { chave: "missao", texto: "MISSÃO PRONTA", curto: "PRONTA", filtro: "missao" };
    }
    if (agv.ligado !== "LIGADO") {
        return { chave: "desligado", texto: "DESLIGADO", curto: "DESLIGADO", filtro: "pronto" };
    }
    if (agv.modo === "MANUAL") {
        return { chave: "pronto", texto: "MANUAL", curto: "MANUAL", filtro: "pronto" };
    }
    return { chave: "pronto", texto: "PRONTO", curto: "PRONTO", filtro: "pronto" };
}

const CLASSE_CARD_ESTADO = {
    missao: "estado-missao", pronto: "estado-pronto", atencao: "estado-atencao", falha: "estado-falha",
    emergencia: "estado-falha emergencia", offline: "estado-offline", desligado: "estado-offline"
};

function textoModoAGV(agv) {
    if (!agv.online) return agv.ultimoHeartbeat ? `visto ${tempoRelativo(agv.ultimoHeartbeat)}` : "nunca conectou";
    return agv.modo === "MANUAL" ? "Manual" : "Automático";
}

function tempoRelativo(instante) {
    const s = Math.max(0, Math.round((Date.now() - instante) / 1000));
    if (s < 5) return "agora";
    if (s < 60) return `há ${s} s`;
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`;
    return `há ${Math.round(s / 86400)} dias`;
}

function tempoDecorrido(instante) {
    const s = Math.max(0, Math.floor((Date.now() - instante) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function rotuloSinal(agv) {
    if (!agv.online || !agv.ultimoHeartbeat) return "--";
    const rssi = Number(agv.diagnostico?.rssi);
    const idade = ((Date.now() - agv.ultimoHeartbeat) / 1000).toFixed(1).replace(".", ",");
    return Number.isFinite(rssi) && rssi < 0 ? `${rssi} dBm · ${idade} s` : `${idade} s`;
}


/* ============================================================
   FROTA
   ============================================================ */

let filtroFrota = "todos";

function resumoMissaoCard(agv) {
    const missaoId = agv.missaoAtual || agv.missaoCarregada;
    if (!agv.online) return { titulo: "—", detalhe: agv.ultimoHeartbeat ? `Sem sinal ${tempoRelativo(agv.ultimoHeartbeat)}` : "Ainda não conectou ao broker", progresso: 0 };
    if (!missaoId) {
        const fila = (agv.filaMissoes || []).length;
        return { titulo: "Sem missão", detalhe: fila ? `${fila} na fila` : (agv.modo === "MANUAL" ? "Seletora em MANUAL" : "Pronto para receber missão"), progresso: 0 };
    }
    const missao = obterMissaoPorId(missaoId);
    const nome = missao?.nome ? `${missaoId} · ${missao.nome}` : missaoId;
    const total = agv.totalEtapasMissao || missao?.etapas?.length || 0;
    const indice = Number(agv.etapaMissao) || 0;
    const etapa = missao?.etapas?.[indice];
    let detalhe = total ? `Etapa ${Math.min(indice + 1, total)} de ${total}` : "";
    if (agv.estadoMissao === "CARREGADA") detalhe = "Esperando START MISSÃO no AGV";
    else if (etapa) detalhe += ` · ${descreverEtapaMissao(etapa)}`;
    if (agv.estadoMissao === "INTERROMPIDA") detalhe = `Parada: ${textoCausa(agv.causaInterrupcao)}`;
    return { titulo: nome, detalhe, progresso: agv.progresso || 0 };
}

function contarFiltrosFrota(lista) {
    const n = { todos: lista.length, missao: 0, pronto: 0, atencao: 0, falha: 0, offline: 0 };
    lista.forEach(agv => { n[categoriaEstadoAGV(agv).filtro]++; });
    return n;
}

function renderizarFiltrosFrota(lista) {
    const caixa = document.getElementById("filtrosFrota");
    if (!caixa) return;
    const n = contarFiltrosFrota(lista);
    const itens = [
        ["todos", "Todos", null], ["missao", "Em missão", "var(--accent)"], ["pronto", "Prontos", "var(--green)"],
        ["atencao", "Atenção", "var(--amber)"], ["falha", "Falha", "var(--red)"], ["offline", "Offline", "var(--muted)"]
    ];
    ui.trocarHtml(caixa, itens.map(([chave, nome, cor]) => `
        <button type="button" class="filtro ${filtroFrota === chave ? "ativo" : ""}" data-filtro="${chave}" aria-pressed="${filtroFrota === chave}">
            ${cor ? `<span class="ponto" style="color:${cor}"></span>` : ""}${nome} <span class="n">${n[chave]}</span>
        </button>`).join(""));
}

function renderizarFrota() {
    const grid = document.getElementById("fleetGrid");
    if (!grid) return;

    const ordem = { emergencia: 0, falha: 1, atencao: 2, missao: 3, pronto: 4, desligado: 5, offline: 6 };
    const todos = Object.values(agvs).sort((a, b) => {
        const ca = categoriaEstadoAGV(a).chave, cb = categoriaEstadoAGV(b).chave;
        return (ordem[ca] - ordem[cb]) || String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true });
    });
    renderizarFiltrosFrota(todos);
    const lista = todos.filter(agv => filtroFrota === "todos" || categoriaEstadoAGV(agv).filtro === filtroFrota);

    if (document.querySelector(".tela.ativa")?.id === "frota") {
        const planta = plantaPublicada();
        const sub = document.getElementById("subtituloTela");
        if (sub) sub.textContent = `${todos.length} AGV${todos.length === 1 ? "" : "s"} cadastrado${todos.length === 1 ? "" : "s"}` +
            (planta.nos.length ? ` · planta ${planta.nome || ""}, revisão ${planta.revisao || 0}` : " · nenhuma planta publicada");
    }

    if (!todos.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">Nenhum AGV cadastrado. Use “+ Adicionar AGV” (o ID é o AGV_ID do firmware) ou crie um AGV virtual para testar.</div>`;
        return;
    }
    if (!lista.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">Nenhum AGV neste filtro.</div>`;
        return;
    }

    ui.trocarHtml(grid, lista.map(agv => {
        const cat = categoriaEstadoAGV(agv);
        const m = resumoMissaoCard(agv);
        const id = escaparHtml(agv.id);
        const acao = !agv.online ? "Ver último estado" : cat.chave === "emergencia" ? "Abrir agora" : agv.virtual ? "Abrir painel" : "Abrir painel";
        return `
            <article class="agv-card ${CLASSE_CARD_ESTADO[cat.chave] || ""}" data-agv="${id}" tabindex="0" aria-label="AGV ${id} ${escaparHtml(agv.nome)}: ${cat.texto}">
                <div class="agv-card-faixa"></div>
                <div class="agv-card-corpo">
                    <div class="agv-card-topo">
                        <span class="agv-card-id">${id}</span>
                        <div style="min-width:0;flex:1">
                            <div class="agv-card-nome"><h2>${escaparHtml(agv.nome)}</h2>${agv.virtual ? `<span class="tag-virtual">VIRTUAL</span>` : ""}</div>
                            <div class="agv-card-modo">${escaparHtml(textoModoAGV(agv))}</div>
                        </div>
                        <span class="agv-card-estado">${cat.texto}</span>
                    </div>
                    <div class="agv-card-missao">
                        <strong>${escaparHtml(m.titulo)}</strong>
                        <div class="barra-progresso fina"><div style="width:${m.progresso}%"></div></div>
                        <div class="agv-card-detalhe">${escaparHtml(m.detalhe)}</div>
                    </div>
                    <dl class="lista-dl">
                        <dt>Posição</dt><dd>${escaparHtml(agv.online || agv.pontoAtual ? descreverPosicaoAGV(agv) : "--")}</dd>
                        <dt>Sinal</dt><dd class="mono">${escaparHtml(rotuloSinal(agv))}</dd>
                    </dl>
                    <div class="agv-card-acoes">
                        <button type="button" class="btn ${cat.chave === "emergencia" ? "btn-perigo-cheio" : ""}" data-abrir="${id}">${acao}</button>
                        <button type="button" class="btn btn-icone" data-editar="${id}" data-requer="administrar" title="Editar nome e ID" aria-label="Editar AGV ${id}">${ui.icone("lapis")}</button>
                        <button type="button" class="btn btn-icone btn-perigo" data-excluir="${id}" data-requer="administrar" title="Excluir da frota" aria-label="Excluir AGV ${id}">${ui.icone("lixo")}</button>
                    </div>
                </div>
            </article>`;
    }).join(""));
}

document.getElementById("filtrosFrota")?.addEventListener("click", evento => {
    const botao = evento.target.closest("[data-filtro]");
    if (!botao) return;
    filtroFrota = botao.dataset.filtro;
    renderizarFrota();
});

document.getElementById("fleetGrid")?.addEventListener("click", evento => {
    const editar = evento.target.closest("[data-editar]");
    if (editar) { abrirEdicaoAGV(editar.dataset.editar); return; }
    const excluir = evento.target.closest("[data-excluir]");
    if (excluir) { excluirAGV(excluir.dataset.excluir); return; }
    const card = evento.target.closest("[data-agv]");
    if (card) selecionarAGV(card.dataset.agv);
});

document.getElementById("fleetGrid")?.addEventListener("keydown", evento => {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    const card = evento.target.closest("[data-agv]");
    if (card && evento.target === card) {
        evento.preventDefault();
        selecionarAGV(card.dataset.agv);
    }
});

document.getElementById("frotaNovoVirtual")?.addEventListener("click", () => {
    AgvVirtual.criarNovo()
        .then(() => ui.aviso("AGV virtual criado e ligado. Ele já aparece na frota.", "sucesso"))
        .catch(e => ui.aviso("Não foi possível iniciar o AGV virtual: " + e.message, "erro"));
});


/* ============================================================
   ALERTA DE EMERGÊNCIA (qualquer tela)
   ============================================================ */

function renderizarAlertaGlobal() {
    const caixa = document.getElementById("alertaGlobal");
    if (!caixa) return;
    const emergencia = Object.values(agvs).filter(agv => agv.online && agv.emergencia);
    document.body.classList.toggle("emergencia-ativa", emergencia.length > 0);

    const badge = document.getElementById("menuBadgeFrota");
    if (badge) {
        badge.hidden = emergencia.length === 0;
        badge.textContent = emergencia.length;
    }

    if (!emergencia.length) {
        if (caixa.innerHTML) caixa.innerHTML = "";
        return;
    }
    const tela = document.querySelector(".tela.ativa")?.id;
    const selecionado = agvAtual();
    const principal = selecionado && selecionado.online && selecionado.emergencia && tela !== "frota" ? selecionado : null;

    if (principal) {
        const desde = principal.emergenciaDesde || Date.now();
        const missao = principal.missaoAtual ? ` Missão ${escaparHtml(principal.missaoAtual)} interrompida.` : "";
        const outros = emergencia.length > 1 ? ` · mais ${emergencia.length - 1} AGV em emergência` : "";
        caixa.innerHTML = `
            <div class="alerta-emergencia" role="alert">
                <span class="alerta-emergencia-icone">${ui.icone("alerta", "icone-g")}</span>
                <div class="alerta-emergencia-texto">
                    <div class="alerta-emergencia-titulo">EMERGÊNCIA ACIONADA · AGV ${escaparHtml(principal.id)} ${escaparHtml(principal.nome)}</div>
                    <div>Botão de emergência pressionado às ${new Date(desde).toLocaleTimeString("pt-BR")}.${missao}${outros}</div>
                </div>
                <ol>
                    <li>Verifique a área em volta do AGV</li>
                    <li>Solte o botão de emergência</li>
                    <li>Pressione REARME no painel do AGV</li>
                </ol>
                <span class="alerta-emergencia-tempo">há ${tempoDecorrido(desde)}</span>
            </div>`;
        return;
    }
    const primeiro = emergencia[0];
    const lista = emergencia.map(a => `AGV ${escaparHtml(a.id)} ${escaparHtml(a.nome)}`).join(", ");
    caixa.innerHTML = `
        <div class="alerta-emergencia" role="alert" style="padding:14px 18px">
            ${ui.icone("alerta", "icone-g")}
            <div class="alerta-emergencia-texto"><b style="font-size:16px">${emergencia.length} AGV${emergencia.length > 1 ? "s" : ""} em emergência</b> · ${lista}${primeiro.emergenciaDesde ? `, há ${tempoDecorrido(primeiro.emergenciaDesde)}` : ""}</div>
            <button type="button" class="btn" onclick="selecionarAGV('${escaparHtml(primeiro.id)}')">Abrir AGV ${escaparHtml(primeiro.id)}</button>
        </div>`;
}


/* ============================================================
   SELEÇÃO E NAVEGAÇÃO
   ============================================================ */

function selecionarAGV(id) {
    if (!agvs[id]) return;
    agvSelecionado = id;
    try { localStorage.setItem("agvSelecionado", id); } catch (e) { /* ignora */ }
    atualizarIdentificacaoAGV();
    mudarTela("visaoGeral");
    renderizarMapaVisaoGeral();
    atualizarPainel();
    renderizarControleFilaAGV();
    renderizarDadosTelaAtual();
}

function atualizarIdentificacaoAGV() {
    const agv = agvAtual();
    const set = (id, valor) => { const e = document.getElementById(id); if (e) e.textContent = valor; };
    set("agvSelecionadoBadge", agv ? agv.id : "--");
    set("agvSelecionadoNome", agv ? agv.nome : "Nenhum AGV");
    set("agvSelecionadoId", agv ? `AGV selecionado${agv.virtual ? " · virtual" : ""}` : "Escolha na frota");
    set("trocarAgvId", agv ? agv.id : "--");
    set("trocarAgvNome", agv ? agv.nome : "AGV");
    document.querySelectorAll(".agv-menu").forEach(item => item.classList.toggle("bloqueado", !agv));
}

function voltarFrota() {
    mudarTela("frota");
}

function selecionarProximoAGV() {
    const ids = Object.keys(agvs);
    if (!ids.length) return;
    const index = Math.max(0, ids.indexOf(agvSelecionado));
    selecionarAGV(ids[(index + 1) % ids.length]);
}

const informacoesTelas = {
    frota: ["Frota", "Selecione um AGV para abrir o painel"],
    visaoGeral: ["Visão geral", ""],
    controleManual: ["Controle manual", "segure para mover, solte para parar"],
    missoes: ["Missões", "Sequências de etapas que os AGVs executam"],
    sensores: ["Sensores", "leituras ao vivo"],
    diagnostico: ["Diagnóstico", "saúde do hardware, da comunicação e do firmware"],
    historico: ["Histórico", "eventos guardados neste navegador"],
    configuracoes: ["Configurações", "parâmetros salvos no próprio AGV"],
    controlePlanta: ["Planta", "Layout do galpão: linhas, estações, tags e zonas"],
    agvVirtual: ["AGV virtual", "O firmware real rodando no navegador, num mundo montado a partir da planta publicada"],
    usuarios: ["Usuários", "Quem acessa o sistema e o que cada um pode fazer"]
};

const TELAS_DO_AGV = ["visaoGeral", "controleManual", "sensores", "diagnostico", "historico", "configuracoes"];

function atualizarCabecalho(nomeTela) {
    const info = informacoesTelas[nomeTela];
    const agv = agvAtual();
    const doAgv = TELAS_DO_AGV.includes(nomeTela);
    if (info) {
        document.getElementById("tituloTela").textContent = info[0];
        let sub = info[1];
        if (doAgv && agv) sub = `AGV ${agv.id} · ${agv.nome}${sub ? " — " + sub : ""}`;
        if (nomeTela === "frota") sub = document.getElementById("subtituloTela").textContent || info[1];
        document.getElementById("subtituloTela").textContent = sub;
    }
    const trocar = document.getElementById("trocarAgv");
    if (trocar) trocar.hidden = !(doAgv && agv);
    ["pilulaOnline", "pilulaSinal", "pilulaFirmware"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.hidden = !(doAgv && agv);
    });
}

function mudarTela(nomeTela) {
    if (TELAS_DO_AGV.includes(nomeTela) && !agvSelecionado) {
        ui.aviso("Escolha um AGV na frota primeiro.", "aviso");
        nomeTela = "frota";
    }
    document.querySelectorAll(".tela").forEach(t => t.classList.remove("ativa"));
    document.getElementById(nomeTela)?.classList.add("ativa");
    document.querySelectorAll(".menu-item").forEach(item => {
        item.classList.toggle("ativo", item.dataset.tela === nomeTela);
        if (item.dataset.tela === nomeTela) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
    });
    document.body.classList.remove("menu-aberto");
    atualizarCabecalho(nomeTela);
    try { localStorage.setItem("telaAtual", nomeTela); } catch (e) { /* ignora */ }

    if (nomeTela === "controleManual") atualizarControleManual();
    if (nomeTela === "frota") renderizarFrota();
    if (nomeTela === "controlePlanta") EditorPlanta.abrir();
    if (nomeTela === "visaoGeral") renderizarMapaVisaoGeral();
    if (nomeTela === "agvVirtual") AgvVirtual.abrir();
    if (nomeTela === "missoes") abrirTelaMissoes();
    if (nomeTela === "usuarios" && typeof Usuarios !== "undefined") Usuarios.abrir();
    renderizarAlertaGlobal();
    renderizarDadosTelaAtual();
    window.scrollTo({ top: 0 });
}

document.querySelectorAll(".menu-item[data-tela]").forEach(item => {
    item.addEventListener("click", event => {
        event.preventDefault();
        mudarTela(item.dataset.tela);
    });
});

document.getElementById("agvAtualBotao")?.addEventListener("click", () => mudarTela("frota"));
document.getElementById("trocarAgv")?.addEventListener("click", () => mudarTela("frota"));
document.getElementById("vgVerHistorico")?.addEventListener("click", evento => { evento.preventDefault(); mudarTela("historico"); });
document.getElementById("btnMenuMovel")?.addEventListener("click", () => document.body.classList.toggle("menu-aberto"));
document.querySelectorAll("[data-acao-tema]").forEach(b => b.addEventListener("click", () => ui.alternarTema()));
ui.aplicarTema(ui.temaAtual());
document.getElementById("vgPosicao")?.addEventListener("toggle", evento => { evento.target.dataset.tocado = "1"; });
document.getElementById("btnVerFila")?.addEventListener("click", () => {
    const fila = document.getElementById("filaMissoesAGV");
    const botao = document.getElementById("btnVerFila");
    if (!fila) return;
    fila.hidden = !fila.hidden;
    botao.setAttribute("aria-expanded", String(!fila.hidden));
});


/* ============================================================
   PAINEL DO AGV SELECIONADO (cabeçalho e Visão Geral)
   ============================================================ */

const COR_ESTADO_PILULA = {
    missao: "var(--accent)", pronto: "var(--green)", atencao: "var(--amber)", falha: "var(--red)",
    emergencia: "var(--red)", offline: "var(--muted)", desligado: "var(--muted)"
};

function textoGarra(agv) {
    const g = agv.garra;
    if (!g) return "--";
    const nomes = {
        NAO_CONFIGURADA: "Desativada", MOVENDO_AVANCAR: "Subindo", MOVENDO_RECUAR: "Descendo",
        RECUADA: "Abaixada (vazia)", AVANCADA: "Erguida (carregada)", PARADA: "No meio do curso"
    };
    return nomes[g.estado] || g.estado || "--";
}

function definirTile(id, classe, texto) {
    const tile = document.getElementById(id);
    if (!tile) return;
    tile.className = `tile ${classe}`;
    const valor = tile.querySelector(".tile-valor");
    if (valor) valor.innerHTML = texto;
}

function atualizarPainel() {
    atualizarBotaoCancelarMissao();
    renderizarAlertaGlobal();
    const agv = agvAtual();
    if (!agv) {
        atualizarIdentificacaoAGV();
        atualizarPainelCalibracaoQTR(agv);
        return;
    }
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    atualizarIdentificacaoAGV();

    // cabeçalho
    const pilula = document.getElementById("pilulaOnline");
    if (pilula) pilula.className = `pilula ${agv.online ? "verde" : "vermelho"}`;
    set("statusOnlineTopo", agv.online ? "Online" : "Offline");
    set("heartbeat", rotuloSinal(agv));
    set("topoFirmware", agv.sistema?.versao || "--");
    const tela = document.querySelector(".tela.ativa")?.id;
    if (TELAS_DO_AGV.includes(tela)) atualizarCabecalho(tela);

    // estado
    const cat = categoriaEstadoAGV(agv);
    const estado = document.getElementById("vgEstadoPilula");
    if (estado) {
        estado.style.background = COR_ESTADO_PILULA[cat.chave];
        estado.classList.toggle("pulsando", cat.chave === "missao");
        estado.classList.toggle("alarme", cat.chave === "emergencia");
    }
    set("statusOnline", cat.texto);
    set("statusModo", agv.online ? (agv.modo === "MANUAL" ? "Manual" : "Automático") + (agv.ligado === "LIGADO" ? "" : " · desligado (STOP)") : "--");
    set("estacaoAtual", descreverPosicaoAGV(agv));
    const pose = poseEstimadaAGV(agv);
    set("vgOrientacao", pose ? `${Math.round(Planta.normalizarAngulo(pose.orientacao))}° · ${ui.direcao(pose.orientacao)}` : "--");
    set("velocidade", `${ui.numero(agv.velocidade || 0, 3)} m/s`);
    set("vgGarra", textoGarra(agv));

    // segurança
    definirTile("tileEmergencia", agv.emergencia ? "alarme" : agv.online ? "verde" : "", agv.emergencia ? "Acionada" : agv.online ? "Normal" : "--");
    const vl = agv.sensores?.vl53 || {};
    const menor = [vl.d1, vl.d2].filter(d => typeof d === "number" && d >= 0).sort((a, b) => a - b)[0];
    const distancia = typeof menor === "number" ? ` <span class="mono" style="font-weight:500;font-size:12px">${ui.numero(menor / 1000, 2)} m</span>` : "";
    if (agv.barreira === "INVADIDA") definirTile("tileBarreira", "vermelho", "Invadida" + distancia);
    else if (agv.barreira === "FALHA_LEITURA") definirTile("tileBarreira", "ambar", "Falha de leitura");
    else definirTile("tileBarreira", agv.online ? "verde" : "", agv.online ? "Livre" + distancia : "--");
    definirTile("tileRearme", agv.aguardandoRearme ? "ambar" : agv.online ? "verde" : "", agv.aguardandoRearme ? "Necessário" : agv.online ? "Liberado" : "--");

    preencherSelectPosicao(agv);
    atualizarControleManual();
    renderizarEventosRecentes(agv);
}

const TEXTOS_EVENTOS = {
    EMERGENCIA_ACIONADA: "Emergência acionada", EMERGENCIA_LIBERADA: "Emergência liberada", REARME_ACEITO: "Rearme aceito",
    REARME_LOCAL_OBRIGATORIO: "Rearme só no painel do AGV", STOP_ACIONADO: "STOP acionado", POTENCIA_HABILITADA: "AGV ligado (START)",
    BARREIRA_INVADIDA: "Barreira invadida", BARREIRA_LIVRE: "Barreira liberada", MODO_ALTERADO: "Seletora mudou de posição",
    FALHA_COMUNICACAO_PAINEL: "Falha de comunicação com o painel", COMUNICACAO_PAINEL_RESTAURADA: "Painel voltou a responder",
    FALHA_SENSORES_BARREIRA: "Falha nos sensores de distância", COMBINACAO_INVALIDA: "STOP e emergência incoerentes",
    MISSAO_CARREGADA: "Missão carregada", MISSAO_INICIADA: "Missão iniciada", MISSAO_CONCLUIDA: "Missão concluída",
    MISSAO_INTERROMPIDA: "Missão interrompida", MISSAO_RETOMADA: "Missão retomada", MISSAO_ERRO: "Erro na missão",
    MISSAO_CANCELADA: "Missão cancelada", CARREGAMENTO_REJEITADO: "Missão recusada pelo AGV", INICIO_REJEITADO: "START MISSÃO recusado",
    ETAPA_INICIADA: "Etapa iniciada", ETAPA_CONCLUIDA: "Etapa concluída", CONFIRMACAO_RECEBIDA: "Etapa confirmada",
    TAG_LIDA: "Tag RFID lida", TAG_NAO_LIDA: "Tag esperada não foi lida", POSICAO_DEFINIDA: "Posição definida",
    POSICAO_PERDIDA: "Posição perdida (movido no manual)", POSICAO_REJEITADA: "Posição recusada",
    AGV_REINICIOU: "AGV reiniciou", FALHA_HARDWARE: "Falha de hardware", AUTOTESTE_CONCLUIDO: "Autoteste concluído",
    AUTOTESTE_INICIADO: "Autoteste iniciado", AUTOTESTE_RECUSADO: "Autoteste recusado", TESTE_LEDS: "Teste dos LEDs",
    OTA_INICIADA: "Atualização iniciada", OTA_CONCLUIDA: "Atualização concluída", OTA_ERRO: "Erro na atualização",
    OTA_VALIDADA: "Versão nova confirmada", OTA_RECUSADA: "Atualização recusada",
    CONFIGURACAO_ALTERADA: "Parâmetros alterados", CONFIGURACAO_RESTAURADA: "Padrão de fábrica restaurado",
    CALIBRACAO_QTR_INICIADA: "Calibração do QTR iniciada", CALIBRACAO_QTR_CONCLUIDA: "Calibração do QTR salva",
    CALIBRACAO_QTR_CANCELADA: "Calibração do QTR cancelada", CALIBRACAO_QTR_ERRO: "Calibração do QTR recusada",
    MISSAO_ENVIADA: "Missão enviada", POSICAO_INFORMADA: "Posição informada", CONFIGURACAO_ENVIADA: "Parâmetros enviados"
};

function tituloEvento(dados) {
    if (!dados || typeof dados !== "object") return String(dados ?? "");
    const nome = dados.evento || dados.tipo || "";
    return (typeof NOMES_EVENTOS !== "undefined" && NOMES_EVENTOS[nome]) || TEXTOS_EVENTOS[nome] || String(nome).replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase());
}

function renderizarEventosRecentes(agv) {
    const caixa = document.getElementById("vgEventos");
    if (!caixa || !document.getElementById("visaoGeral")?.classList.contains("ativa")) return;
    const itens = (agv.historico || []).slice(0, 6);
    if (!itens.length) {
        caixa.innerHTML = `<span style="grid-column:1/-1;color:var(--muted)">Nenhum evento ainda.</span>`;
        return;
    }
    const nomesCategoria = { seguranca: "Segurança", missao: "Missão", sistema: "Sistema", configuracao: "Config", site: "Site" };
    ui.trocarHtml(caixa, itens.map(item => {
        const dados = item.evento;
        const categoria = typeof categoriaDoEvento === "function" ? categoriaDoEvento(item) : (item.categoria || "missao");
        const mensagem = typeof dados === "object" ? (dados.mensagem || "") : "";
        return `
            <span class="hora">${new Date(item.data).toLocaleTimeString("pt-BR")}</span>
            <span><span class="etiqueta ${categoria}">${nomesCategoria[categoria] || categoria}</span></span>
            <span>${escaparHtml(tituloEvento(dados))}${mensagem ? ` <span class="suave">— ${escaparHtml(mensagem)}</span>` : ""}</span>`;
    }).join(""));
}

function condicoesManual(agv) {
    return [
        { texto: "AGV online", ok: Boolean(agv && agv.online) },
        { texto: "Seletora em MANUAL", ok: Boolean(agv && agv.modo === "MANUAL") },
        { texto: "AGV ligado (START)", ok: Boolean(agv && agv.ligado === "LIGADO" && agv.stop === "NORMAL") },
        { texto: "Sem emergência nem rearme", ok: Boolean(agv && !agv.emergencia && !agv.aguardandoRearme && agv.maquina !== "EMERGENCIA") },
        { texto: "Frente livre", ok: Boolean(agv && agv.barreira !== "INVADIDA") }
    ];
}

function atualizarControleManual() {
    const agv = agvAtual();
    const joystick = document.getElementById("joystick");
    if (!agv || !joystick) return;
    const condicoes = condicoesManual(agv);
    const habilitado = condicoes.every(c => c.ok);
    joystick.classList.toggle("bloqueado", !habilitado);
    ["btnGiroAnti", "btnGiroHorario", "btnGarraSubir", "btnGarraDescer"].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.disabled = !habilitado;
    });
    const status = document.getElementById("manualStatus");
    if (status) {
        const enviando = habilitado && (joystickAtivo || rotacaoAtiva || garraMovimentoAtivo);
        status.className = `pilula ${enviando ? "azul" : habilitado ? "verde" : "cinza"}`;
        status.textContent = enviando ? "Enviando comando · 10× por segundo" : habilitado ? "Liberado" : "Bloqueado";
    }
    const lista = document.getElementById("manualCondicoes");
    if (lista) {
        const html = condicoes.map(c => `<li class="${c.ok ? "ok" : "nao"}">${ui.icone(c.ok ? "ok" : "x", "icone-p")}${c.texto}</li>`).join("");
        if (lista.innerHTML !== html) lista.innerHTML = html;
    }
    if (document.getElementById("controleManual")?.classList.contains("ativa")) {
        renderizarVl53Manual(agv);
        atualizarStatusGarraESP();
    }
}

// Leque dos dois VL53 à frente do AGV (tela de controle manual)
function renderizarVl53Manual(agv) {
    const caixa = document.getElementById("manualVl53");
    const pilula = document.getElementById("manualBarreira");
    if (!caixa) return;
    const vl = agv.sensores?.vl53 || {};
    const limite = Number(vl.limite) || 300;
    const alcance = 2000;
    const escala = d => 18 + Math.min(1, d / alcance) * 108;   // px a partir da base (y=140)
    const yLimite = 140 - escala(limite);
    const raio = 140 - yLimite;
    const sensor = (x, d, valido, lado) => {
        if (!valido) return `<text x="${x}" y="40" text-anchor="middle" font-size="12" font-family="IBM Plex Mono, ui-monospace, monospace" fill="var(--amber)">sem leitura</text>`;
        if (typeof d !== "number" || d < 0) {
            return `<path d="M${x} 18 V126" stroke="var(--muted)" stroke-width="2" stroke-dasharray="2 5"></path>
                <text x="${x + (lado < 0 ? -10 : 10)}" y="30" text-anchor="${lado < 0 ? "end" : "start"}" font-size="12" font-family="IBM Plex Mono, ui-monospace, monospace" fill="var(--muted)">livre</text>`;
        }
        const y = 140 - escala(d);
        const perto = d < limite;
        const cor = perto ? "var(--red)" : "var(--accent)";
        return `<path d="M${x} ${y} V126" stroke="${cor}" stroke-width="3" stroke-dasharray="2 4"></path>
            <circle cx="${x}" cy="${y}" r="6" fill="${cor}"></circle>
            <text x="${x + (lado < 0 ? -12 : 12)}" y="${Math.max(14, y - 8)}" text-anchor="${lado < 0 ? "end" : "start"}" font-size="12" font-family="IBM Plex Mono, ui-monospace, monospace" fill="var(--text)">${ui.numero(d / 1000, 2)} m</text>`;
    };
    ui.trocarHtml(caixa, `
        <svg viewBox="0 0 340 150" role="img" aria-label="Sensores de distância à frente: esquerdo ${vl.d1 ?? "--"} mm, direito ${vl.d2 ?? "--"} mm; barreira em ${limite} mm">
            <path d="M170 140 L40 20 A180 180 0 0 1 300 20 Z" fill="var(--green-soft)"></path>
            <path d="M170 140 L${170 - raio * 0.72} ${140 - raio * 0.69} A${raio} ${raio} 0 0 1 ${170 + raio * 0.72} ${140 - raio * 0.69} Z" fill="var(--amber-soft)" stroke="var(--amber)" stroke-dasharray="4 3"></path>
            <text x="170" y="${Math.min(128, yLimite + 22)}" text-anchor="middle" font-size="11" font-family="IBM Plex Sans, system-ui, sans-serif" font-weight="600" fill="var(--amber)">barreira ${ui.numero(limite / 1000, 2)} m</text>
            <rect x="138" y="126" width="64" height="20" rx="4" fill="var(--text)"></rect>
            ${sensor(156, vl.d1, vl.v1 !== false, -1)}
            ${sensor(184, vl.d2, vl.v2 !== false, 1)}
        </svg>`);
    if (pilula) {
        const estado = agv.barreira;
        pilula.className = `pilula ${estado === "INVADIDA" ? "vermelho" : estado === "FALHA_LEITURA" ? "ambar" : "verde"}`;
        pilula.textContent = estado === "INVADIDA" ? "Obstáculo" : estado === "FALHA_LEITURA" ? "Falha de leitura" : "Livre";
    }
}


/* ============================================================
   FILA E MISSÃO ATUAL (Visão Geral)
   ============================================================ */

function renderizarControleFilaAGV() {
    atualizarBotaoCancelarMissao();
    const select = document.getElementById("missaoSelecionadaAGV");
    const filaContainer = document.getElementById("filaMissoesAGV");
    const atualContainer = document.getElementById("missaoAtualAGV");
    const avisoContainer = document.getElementById("avisoMissaoAGV");
    if (!select) return;
    const agv = agvAtual();
    if (!agv) return;

    const missoesDisponiveis = Array.isArray(missoes) ? missoes : [];
    const assinatura = missoesDisponiveis.map(m => `${m.id}:${m.nome}`).join("|");
    if (select.dataset.assinatura !== assinatura) {
        select.innerHTML = `<option value="">${missoesDisponiveis.length ? "Escolha uma missão" : "Nenhuma missão cadastrada"}</option>`;
        missoesDisponiveis.forEach(missao => {
            const option = document.createElement("option");
            option.value = missao.id;
            option.textContent = `${missao.id} · ${missao.nome || "Sem nome"}`;
            select.appendChild(option);
        });
        select.dataset.assinatura = assinatura;
    }
    if (document.activeElement !== select) select.value = agv.missaoSelecionada || "";

    if (atualContainer) {
        const html = montarHtmlMissaoAtual(agv);
        if (atualContainer.innerHTML !== html) atualContainer.innerHTML = html;
    }

    if (avisoContainer) {
        const aviso = agv.avisoMissao;
        if (aviso && Date.now() - aviso.quando < 60000) {
            avisoContainer.hidden = false;
            avisoContainer.className = `aviso-missao-agv ${aviso.tipo}`;
            avisoContainer.textContent = aviso.texto;
        } else {
            avisoContainer.hidden = true;
        }
    }

    const fila = Array.isArray(agv.filaMissoes) ? agv.filaMissoes : [];
    const btnFila = document.getElementById("btnVerFila");
    if (btnFila) btnFila.textContent = `Fila (${fila.length})${agv.filaMissoesSuspensa ? " · suspensa" : ""}`;
    if (filaContainer) {
        let html = "";
        if (!fila.length) {
            html = `<div class="fila-vazia">Fila vazia. A próxima missão da fila é carregada sozinha quando a atual termina; o início continua no botão START MISSÃO.</div>`;
        } else {
            if (agv.filaMissoesSuspensa) {
                html += `<div class="fila-suspensa"><span>Fila suspensa depois de um cancelamento.</span><button type="button" class="btn btn-mini" onclick="retomarFilaMissoes()">Retomar fila</button></div>`;
            }
            html += fila.map((missaoId, indice) => {
                const missao = obterMissaoPorId(missaoId);
                return `
                    <div class="fila-missao-item">
                        <div class="fila-missao-info">
                            <span class="fila-missao-ordem">${indice + 1}</span>
                            <div><strong>${escaparHtml(missaoId)}</strong><small>${escaparHtml(missao ? missao.nome || "" : "Missão não encontrada")}</small></div>
                        </div>
                        <button type="button" class="btn-remover-fila" aria-label="Tirar da fila" onclick="removerMissaoFila(${indice})">×</button>
                    </div>`;
            }).join("");
        }
        if (filaContainer.innerHTML !== html) filaContainer.innerHTML = html;
    }

    const btnCarregar = document.getElementById("btnStart");
    const btnAdicionar = document.getElementById("btnAdicionarFilaAGV");
    if (btnCarregar) btnCarregar.disabled = !podeCarregarMissao(agv) || !agv.missaoSelecionada;
    if (btnAdicionar) btnAdicionar.disabled = !agv.missaoSelecionada;
}



/* ============================================================
   MISSÃO / SIMULAÇÃO LOCAL
   ============================================================ */
// ============================================================
// SISTEMA DE MISSÕES
// ============================================================


function iniciarMissao() {

    const agv = agvAtual();

    if (!agv) {
        return;
    }

    if (!agv.missaoSelecionada) {
        ui.aviso("Escolha uma missão para este AGV.", "aviso");
        return;
    }

    iniciarMissaoPorId(agv.id, agv.missaoSelecionada);
}

// Envia a missão ao ESP. O ESP valida e responde em status/missao
// (CARREGADA) ou com o evento CARREGAMENTO_REJEITADO. A execução só
// começa quando o operador pressiona START MISSÃO no painel do AGV.
function iniciarMissaoPorId(agvId, missaoId, silencioso = false) {

    const agv = agvs[agvId];

    if (!agv) {
        return false;
    }

    const falhar = mensagem => {
        definirAvisoMissao(agv, mensagem, "erro");
        if (!silencioso) {
            ui.aviso(mensagem, "erro");
        }
        agendarAtualizacaoTela();
        return false;
    };

    const missao = obterMissaoPorId(missaoId);

    if (!missao) {
        return falhar(`A missão "${missaoId}" não existe mais.`);
    }

    if (!Array.isArray(missao.etapas) || missao.etapas.length === 0) {
        return falhar(`A missão "${missaoId}" não possui etapas.`);
    }

    if (!podeCarregarMissao(agv)) {
        return falhar(
            "Não dá para carregar a missão agora: o AGV precisa estar online e sem missão em execução, " +
            "interrompida ou aguardando resposta."
        );
    }

    const resultado = prepararMissaoParaESP(agvId, missaoId);

    if (!resultado.sucesso) {
        return falhar("Não foi possível preparar a missão: " + resultado.erro);
    }

    const enviado = publicar(
        TOPICOS.comando.carregarMissao,
        JSON.stringify(resultado.pacote),
        agv.id
    );

    if (!enviado) {
        return falhar("MQTT desconectado: a missão não foi enviada.");
    }

    agv.missaoSelecionada = missaoId;
    agv.carregamentoPendente = { missaoId, quando: Date.now() };
    registrarAcaoSite(agv.id, "missao", "MISSAO_ENVIADA", `Missão ${missaoId} enviada para o AGV`);

    definirAvisoMissao(agv, `Missão ${missaoId} enviada. Aguardando validação do AGV...`, "info");

    // Sem resposta em 8 s: libera o painel e avisa.
    setTimeout(() => {

        const pendente = agv.carregamentoPendente;

        if (pendente && pendente.missaoId === missaoId &&
            Date.now() - pendente.quando >= 7900) {

            agv.carregamentoPendente = null;
            definirAvisoMissao(agv, `O AGV não respondeu ao carregamento da missão ${missaoId}.`, "erro");
            agendarAtualizacaoTela();
        }

    }, 8000);

    salvarAgvsFrota();
    agendarAtualizacaoTela();
    return true;
}

function adicionarMissaoFila() {

    const agv = agvAtual();

    if (!agv) {
        return;
    }

    const missaoId = agv.missaoSelecionada;

    if (!missaoId) {
        ui.aviso("Escolha uma missão primeiro.", "aviso");
        return;
    }
    const idMissao = String(missaoId);

const jaEstaNaFila = agv.filaMissoes.some(
    id => String(
        typeof id === "object" ? id.id : id
    ) === idMissao
);

const jaEstaCarregada =
    String(agv.missaoCarregada) === idMissao;

if (jaEstaNaFila || jaEstaCarregada) {
    ui.aviso("Essa missão já está na fila ou carregada no AGV.", "aviso");
    return;
}
    const missao = obterMissaoPorId(missaoId);

    if (!missao) {
        ui.aviso("A missão escolhida não existe.", "erro");
        return;
    }

    if (!Array.isArray(agv.filaMissoes)) {
        agv.filaMissoes = [];
    }

    agv.filaMissoes.push(missaoId);

    salvarAgvsFrota();

    renderizarControleFilaAGV();
    ui.aviso(`${missaoId} entrou na fila do AGV ${agv.id} (posição ${agv.filaMissoes.length}).`, "sucesso");
}




function iniciarProximaMissaoFila(agvId) {

    const agv = agvs[agvId];

    if (!agv) {
        return;
    }

    if (agv.filaMissoesSuspensa) {
        return;
    }

    if (cancelamentosMissaoPendentes[agvId] || agv.carregamentoPendente) {
        return;
    }

    if (["CARREGADA", "EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"]
            .includes(agv.estadoMissao)) {
        return;
    }

    if (!Array.isArray(agv.filaMissoes)) {
        agv.filaMissoes = [];
    }

    while (agv.filaMissoes.length > 0) {

        const proximaMissaoId = agv.filaMissoes[0];

        // Missão apagada: descarta só ela.
        if (!obterMissaoPorId(proximaMissaoId)) {
            agv.filaMissoes.shift();
            continue;
        }

        agv.missaoSelecionada = proximaMissaoId;

        // Sai da fila somente se o envio aconteceu.
        if (iniciarMissaoPorId(agvId, proximaMissaoId, true)) {
            agv.filaMissoes.shift();
        }

        break;
    }

    salvarAgvsFrota();
    agendarAtualizacaoTela();
}




function removerMissaoFila(indice) {

    const agv = agvAtual();

    if (!agv || !Array.isArray(agv.filaMissoes)) {
        return;
    }


    if (
        indice < 0 ||
        indice >= agv.filaMissoes.length
    ) {
        return;
    }


    agv.filaMissoes.splice(indice, 1);

    salvarAgvsFrota();

    renderizarControleFilaAGV();
}


function selecionarMissaoAGV(missaoId) {

    const agv = agvAtual();

    if (!agv) {
        return;
    }

    agv.missaoSelecionada = missaoId || null;

    salvarAgvsFrota();

    renderizarControleFilaAGV();
}


















// Eventos publicados pelo ESP em agv/<id>/evento/missao.
// O estado da missão em si vem de status/missao; aqui tratamos
// apenas as respostas e os avisos.
function processarEventoMissao(agvId, evento) {

    const agv = agvs[agvId];

    if (!agv) {
        return;
    }

    let dados;

    try {
        dados = JSON.parse(evento);
    } catch (_) {
        return;
    }

    const tipo = dados?.evento || dados?.tipo;
    const mensagem = dados?.mensagem || "";

    switch (tipo) {

        case "MISSAO_CARREGADA":
            agv.carregamentoPendente = null;
            definirAvisoMissao(agv, `${dados.missao}: ${mensagem}. Pressione START MISSÃO no AGV.`, "ok");
            break;

        case "CARREGAMENTO_REJEITADO":
            agv.carregamentoPendente = null;
            definirAvisoMissao(agv, `O AGV rejeitou a missão: ${mensagem}`, "erro");
            break;

        case "INICIO_REJEITADO":
            definirAvisoMissao(agv, `START MISSÃO recusado: ${mensagem}`, "erro");
            break;

        case "MISSAO_ERRO":
            definirAvisoMissao(agv, `Erro na missão ${dados.missao}: ${mensagem}`, "erro");
            break;

        case "MISSAO_CONCLUIDA":
            definirAvisoMissao(agv, `Missão ${dados.missao} concluída.`, "ok");
            break;

        case "CONFIRMACAO_ERRO":
            definirAvisoMissao(agv, `Confirmação recusada: ${mensagem}`, "erro");
            break;

        case "POSICAO_DEFINIDA":
            definirAvisoMissao(agv, `Posição definida no AGV: ${mensagem}`, "ok");
            break;

        case "POSICAO_REJEITADA":
            definirAvisoMissao(agv, `Posição recusada: ${mensagem}`, "erro");
            break;

        case "REARME_LOCAL_OBRIGATORIO":
            definirAvisoMissao(agv, mensagem, "info");
            break;

        case "POSICAO_PERDIDA":
            definirAvisoMissao(agv, `Posição perdida: ${mensagem || "o AGV foi movido no manual"}. Informe a posição antes da próxima missão.`, "aviso");
            break;

        case "TAG_NAO_LIDA":
            definirAvisoMissao(agv, `Tag esperada não foi lida: ${mensagem}. Confira a tag no chão.`, "aviso");
            break;

        default:
            break;
    }
}





// ============================================================
// SIMULAÇÃO DO AGV NA PLANTA REAL
// ============================================================














/* ============================================================
   JOYSTICK MANUAL
   ============================================================ */

// Limites físicos do AGV
const VX_MAX = 0.10;   // velocidade longitudinal máxima (m/s)
const VY_MAX = 0.10;   // velocidade lateral máxima (m/s)
const W_MAX = 0.524;   // velocidade angular máxima (rad/s) ≈ 30°/s

// Valores internos normalizados de -1 a +1
let comandoManual = { vx: 0, vy: 0, w: 0 };

function obterEscalaVelocidade() {
    const slider = document.getElementById("sliderVelocidade");
    return slider ? Number(slider.value) / 100 : 0.5;
}

function manualPermitido() {
    const agv = agvAtual();
    return Boolean(agv) && condicoesManual(agv).every(c => c.ok);
}

function iniciarJoystick(event) {
    if (!manualPermitido()) {
        if (agvAtual()) ui.aviso("Controle manual bloqueado: veja as condições no alto da tela.", "aviso");
        return;
    }
    joystickAtivo = true;
    const joystick = document.getElementById("joystick");
    joystick?.classList.add("ativo");
    try { joystick?.setPointerCapture(event.pointerId); } catch (e) { /* ignora */ }
    atualizarJoystick(event);
    atualizarControleManual();
}

function moverJoystick(event) {
    if (joystickAtivo) atualizarJoystick(event);
}

// Desenha o "botão" do joystick (coordenadas do SVG 300 × 300)
function desenharJoystick(dxNorm, dyNorm) {
    const raio = 108;
    const x = 150 + dxNorm * raio, y = 150 + dyNorm * raio;
    document.getElementById("joystickKnob")?.setAttribute("transform", `translate(${x} ${y})`);
    document.getElementById("joystickLinha")?.setAttribute("d", `M150 150 L${x} ${y}`);
}

function finalizarJoystick() {
    if (!joystickAtivo && !comandoManual.vx && !comandoManual.vy) return;
    const agv = agvAtual();
    joystickAtivo = false;
    comandoManual.vx = 0;
    comandoManual.vy = 0;
    document.getElementById("joystick")?.classList.remove("ativo");
    desenharJoystick(0, 0);
    // Parada como melhor esforço: o ESP para sozinho em 300 ms sem comando.
    if (agv && agv.online) {
        publicar("comando/manual", JSON.stringify({ vx: 0, vy: 0, w: Number((comandoManual.w * W_MAX * obterEscalaVelocidade()).toFixed(3)) }), agv.id);
    }
    atualizarValoresJoystick();
    atualizarControleManual();
}

function atualizarJoystick(event) {
    if (!manualPermitido()) {
        finalizarJoystick();
        return;
    }
    const joystick = document.getElementById("joystick");
    if (!joystick) return;
    const rect = joystick.getBoundingClientRect();
    const raioMax = rect.width / 2 * (108 / 150);
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const distancia = Math.hypot(dx, dy);
    if (distancia > raioMax) {
        dx = dx / distancia * raioMax;
        dy = dy / distancia * raioMax;
    }
    desenharJoystick(dx / raioMax, dy / raioMax);
    // Convenção do firmware (mecanum X): para cima +vx, esquerda +vy
    comandoManual.vx = -dy / raioMax;
    comandoManual.vy = -dx / raioMax;
    atualizarValoresJoystick();
    publicarManual();
}

function publicarManual() {
    const agv = agvAtual();
    if (!agv || !manualPermitido()) return;
    const escala = obterEscalaVelocidade();
    const comando = {
        vx: Number((comandoManual.vx * VX_MAX * escala).toFixed(3)),
        vy: Number((comandoManual.vy * VY_MAX * escala).toFixed(3)),
        w: Number((comandoManual.w * W_MAX * escala).toFixed(3))
    };
    publicar("comando/manual", JSON.stringify(comando), agv.id, 0);
}

function atualizarValoresJoystick() {
    const set = (id, valor) => { const e = document.getElementById(id); if (e) e.textContent = valor; };
    const escala = obterEscalaVelocidade();
    const sinal = n => (n > 0.0005 ? "+" : n < -0.0005 ? "−" : "") + ui.numero(Math.abs(n), 3);
    set("valorVx", sinal(comandoManual.vx * VX_MAX * escala));
    set("valorVy", sinal(comandoManual.vy * VY_MAX * escala));
    set("valorW", (comandoManual.w > 0 ? "+" : comandoManual.w < 0 ? "−" : "") + ui.numero(Math.abs(comandoManual.w * W_MAX * escala), 2));
    set("velocidadeManualTexto", `${Math.round(escala * 100)}% · ${ui.numero(VX_MAX * escala, 3)} m/s`);
}

function iniciarRotacao(sentido) {
    if (!manualPermitido()) return;
    rotacaoAtiva = true;
    // +1 = anti-horário (w positivo), -1 = horário
    comandoManual.w = sentido;
    document.getElementById(sentido > 0 ? "btnGiroAnti" : "btnGiroHorario")?.classList.add("ativo");
    publicarManual();
    atualizarValoresJoystick();
    atualizarControleManual();
}

function pararRotacao() {
    if (!rotacaoAtiva && comandoManual.w === 0) return;
    rotacaoAtiva = false;
    comandoManual.w = 0;
    document.getElementById("btnGiroAnti")?.classList.remove("ativo");
    document.getElementById("btnGiroHorario")?.classList.remove("ativo");
    const agv = agvAtual();
    if (agv && agv.online) {
        if (manualPermitido()) publicarManual();
        else {
            comandoManual.vx = 0;
            comandoManual.vy = 0;
            publicar("comando/manual", JSON.stringify({ vx: 0, vy: 0, w: 0 }), agv.id);
        }
    }
    atualizarValoresJoystick();
    atualizarControleManual();
}

document.getElementById("joystick")?.addEventListener("pointerdown", iniciarJoystick);
window.addEventListener("pointermove", moverJoystick);
window.addEventListener("pointerup", finalizarJoystick);
window.addEventListener("pointercancel", finalizarJoystick);
window.addEventListener("blur", () => { finalizarJoystick(); pararRotacao(); });

// Teclado: setas ou WASD movem, Q/E giram (só na tela de controle manual)
const teclasManual = new Set();
function comandoTeclado() {
    if (!document.getElementById("controleManual")?.classList.contains("ativa")) return;
    const vx = (teclasManual.has("frente") ? 1 : 0) - (teclasManual.has("re") ? 1 : 0);
    const vy = (teclasManual.has("esquerda") ? 1 : 0) - (teclasManual.has("direita") ? 1 : 0);
    const w = (teclasManual.has("anti") ? 1 : 0) - (teclasManual.has("horario") ? 1 : 0);
    const ativo = vx || vy || w;
    if (ativo && !manualPermitido()) return;
    comandoManual.vx = vx;
    comandoManual.vy = vy;
    comandoManual.w = w;
    joystickAtivo = Boolean(vx || vy);
    rotacaoAtiva = Boolean(w);
    desenharJoystick(-vy * 0.7, -vx * 0.7);
    atualizarValoresJoystick();
    if (ativo) publicarManual();
    else {
        const agv = agvAtual();
        if (agv && agv.online) publicar("comando/manual", JSON.stringify({ vx: 0, vy: 0, w: 0 }), agv.id);
    }
    atualizarControleManual();
}
const MAPA_TECLAS = { ArrowUp: "frente", w: "frente", ArrowDown: "re", s: "re", ArrowLeft: "esquerda", a: "esquerda", ArrowRight: "direita", d: "direita", q: "anti", e: "horario" };
document.addEventListener("keydown", evento => {
    if (!document.getElementById("controleManual")?.classList.contains("ativa")) return;
    if (evento.target.matches("input, select, textarea")) return;
    const acao = MAPA_TECLAS[evento.key.length === 1 ? evento.key.toLowerCase() : evento.key];
    if (!acao) return;
    evento.preventDefault();
    if (!teclasManual.has(acao)) {
        teclasManual.add(acao);
        comandoTeclado();
    }
});
document.addEventListener("keyup", evento => {
    const acao = MAPA_TECLAS[evento.key.length === 1 ? evento.key.toLowerCase() : evento.key];
    if (acao && teclasManual.delete(acao)) comandoTeclado();
});

// O ESP para os motores se ficar 300 ms sem comando: reenvia a cada 100 ms.
setInterval(() => {
    if ((joystickAtivo || rotacaoAtiva) && manualPermitido()) publicarManual();
    else if (joystickAtivo || rotacaoAtiva) { finalizarJoystick(); pararRotacao(); teclasManual.clear(); }
}, 100);

document.getElementById("sliderVelocidade")?.addEventListener("input", () => {
    atualizarValoresJoystick();
    if (joystickAtivo || rotacaoAtiva) publicarManual();
});


/* ============================================================
   RELÓGIO / CADASTRO DE AGVS
   ============================================================ */

function atualizarRelogio() {
    const relogio = document.getElementById("relogio");
    if (relogio) relogio.textContent = new Date().toLocaleTimeString("pt-BR");
    // contador "há mm:ss" do alerta de emergência
    if (document.body.classList.contains("emergencia-ativa")) renderizarAlertaGlobal();
}

function abrirCadastroAGV() {
    if (window.Nuvem && !Nuvem.exigir("administrar", "cadastrar AGVs")) return;
    agvEmEdicao = null;
    document.getElementById("tituloModalAgv").textContent = "Adicionar AGV";
    document.getElementById("novoAgvId").value = "";
    document.getElementById("novoAgvNome").value = "";
    document.getElementById("modalAdicionarAGV").classList.add("ativo");
    document.getElementById("novoAgvId").focus();
}

function fecharCadastroAGV() {
    agvEmEdicao = null;
    document.getElementById("modalAdicionarAGV").classList.remove("ativo");
}

function abrirEdicaoAGV(id) {
    const agv = agvs[id];
    if (!agv) return;
    if (!agv.virtual && window.Nuvem && !Nuvem.exigir("administrar", "editar AGVs")) return;
    agvEmEdicao = id;
    document.getElementById("tituloModalAgv").textContent = `Editar AGV ${agv.id}`;
    document.getElementById("novoAgvId").value = agv.id;
    document.getElementById("novoAgvNome").value = agv.nome;
    document.getElementById("modalAdicionarAGV").classList.add("ativo");
    document.getElementById("novoAgvNome").focus();
}

function adicionarAGV() {
    const id = document.getElementById("novoAgvId").value.trim();
    const nome = document.getElementById("novoAgvNome").value.trim();
    if (!id || !nome) {
        ui.aviso("Preencha o ID e o nome do AGV.", "aviso");
        return;
    }
    if (!/^[A-Za-z0-9_-]{1,12}$/.test(id)) {
        ui.aviso("O ID usa até 12 letras, números, _ ou - (o mesmo AGV_ID do firmware).", "aviso");
        return;
    }
    if (agvEmEdicao !== null) {
        const idAntigo = agvEmEdicao;
        if (id !== idAntigo && agvs[id]) {
            ui.aviso(`O AGV ${id} já está cadastrado.`, "erro");
            return;
        }
        const dadosAGV = agvs[idAntigo];
        delete agvs[idAntigo];
        dadosAGV.id = id;
        dadosAGV.nome = nome;
        agvs[id] = dadosAGV;
        if (agvSelecionado === idAntigo) agvSelecionado = id;
        if (window.Nuvem && !dadosAGV.virtual) Nuvem.salvarAgv(id, nome, idAntigo);
        agvEmEdicao = null;
        salvarAgvsFrotaAgora();
        renderizarFrota();
        atualizarPainel();
        fecharCadastroAGV();
        ui.aviso(`AGV ${id} atualizado.`, "sucesso");
        return;
    }
    if (agvs[id]) {
        ui.aviso(`O AGV ${id} já está cadastrado.`, "erro");
        return;
    }
    agvs[id] = criarAGV(id, nome);
    if (window.Nuvem) Nuvem.salvarAgv(id, nome);
    salvarAgvsFrotaAgora();
    renderizarFrota();
    fecharCadastroAGV();
    ui.aviso(`AGV ${id} cadastrado. Ele aparece online assim que o firmware conectar ao broker.`, "sucesso");
}

async function excluirAGV(id) {
    const agv = agvs[id];
    if (!agv) return;
    if (!agv.virtual && window.Nuvem && !Nuvem.exigir("administrar", "excluir AGVs")) return;
    const ok = await ui.confirmar({
        titulo: `Excluir o AGV ${agv.id}?`,
        texto: `“${agv.nome}” sai da frota${window.Nuvem?.emNuvem() && !agv.virtual ? " da empresa (para todos)" : " deste navegador, com o histórico guardado aqui"}.${agv.virtual ? "\n\nO AGV virtual será desligado." : "\n\nO AGV em si não é alterado."}`,
        confirmar: "Excluir", perigo: true
    });
    if (!ok) return;
    if (agv.virtual) AgvVirtual.desligar(id);
    else if (window.Nuvem) Nuvem.removerAgv(id);
    delete agvs[id];
    salvarAgvsFrotaAgora();
    if (agvSelecionado === id) {
        agvSelecionado = null;
        voltarFrota();
    }
    renderizarFrota();
    atualizarIdentificacaoAGV();
}

document.getElementById("modalAdicionarAGV")?.addEventListener("keydown", evento => {
    if (evento.key === "Enter") adicionarAGV();
    if (evento.key === "Escape") fecharCadastroAGV();
});
document.getElementById("modalAdicionarAGV")?.addEventListener("click", evento => {
    if (evento.target.id === "modalAdicionarAGV") fecharCadastroAGV();
});


/* ============================================================
   CONTROLE MANUAL DA GARRA
   ============================================================ */

let garraMovimentoAtivo = false;
let garraSentidoAtual = null;
let garraPonteiroId = null;


/* ============================================================
   VERIFICA SE A TELA ESTÁ VISÍVEL
   ============================================================ */

function garraTelaManualVisivel() {

    const tela = document.getElementById("controleManual");

    if (!tela) {
        return false;
    }

    return (
        tela.isConnected &&
        window.getComputedStyle(tela).display !== "none" &&
        tela.getClientRects().length > 0
    );
}


/* ============================================================
   ATUALIZA O ESTADO VISUAL
   ============================================================ */

function atualizarEstadoVisualGarra(estado, mensagem) {

    const elementoEstado =
        document.getElementById("garraEstadoManual");

    const elementoMensagem =
        document.getElementById("garraMensagem");

    const btnSubir =
        document.getElementById("btnGarraSubir");

    const btnDescer =
        document.getElementById("btnGarraDescer");

    if (elementoEstado) {
        const nomes = { SUBINDO: "Subindo", DESCENDO: "Descendo", PARADA: "Parada", BLOQUEADA: "Bloqueada", FALHA: "Falha" };
        elementoEstado.textContent = nomes[estado] || estado;
        elementoEstado.className = `pilula ${estado === "SUBINDO" || estado === "DESCENDO" ? "azul" : estado === "BLOQUEADA" || estado === "FALHA" ? "vermelho" : "verde"}`;
    }

    if (elementoMensagem) {
        elementoMensagem.textContent = mensagem;
    }

    if (btnSubir) {
        btnSubir.classList.toggle(
            "ativo",
            estado === "SUBINDO"
        );
    }

    if (btnDescer) {
        btnDescer.classList.toggle(
            "ativo",
            estado === "DESCENDO"
        );
    }
}


/* ============================================================
   INICIA O MOVIMENTO MANUAL
   ============================================================ */

function iniciarGarraManual(sentido) {

    if (
        sentido !== "SUBIR" &&
        sentido !== "DESCER"
    ) {
        return;
    }

    if (garraMovimentoAtivo) {
        return;
    }

    if (!garraTelaManualVisivel()) {
        return;
    }

    if (!manualPermitido()) {

        atualizarEstadoVisualGarra(
            "BLOQUEADA",
            "Movimento manual não autorizado"
        );

        return;
    }

    const publicado = publicar(
        TOPICOS.comando.garraMovimento,
        sentido
    );

    if (publicado === false) {

        atualizarEstadoVisualGarra(
            "FALHA",
            "Não foi possível publicar o comando"
        );

        return;
    }

    garraMovimentoAtivo = true;
    garraSentidoAtual = sentido;

    atualizarEstadoVisualGarra(
        sentido === "SUBIR" ? "SUBINDO" : "DESCENDO",
        "Movendo enquanto o botão estiver pressionado"
    );
}


/* ============================================================
   SOLICITA A PARADA
   ============================================================ */

function pararGarraManual(
    motivo = "Movimento interrompido"
) {

    const haviaMovimento = garraMovimentoAtivo;

    garraMovimentoAtivo = false;
    garraSentidoAtual = null;
    garraPonteiroId = null;

    if (!haviaMovimento) {
        return;
    }

    const publicado = publicar(
        TOPICOS.comando.garraParar,
        "PARAR"
    );

    if (publicado === false) {

        atualizarEstadoVisualGarra(
            "FALHA",
            "Parada não confirmada: verifique a comunicação"
        );

        return;
    }

    atualizarEstadoVisualGarra(
        "PARADA",
        motivo
    );
}


/* ============================================================
   CONFIGURA OS BOTÕES
   ============================================================ */

function configurarControleManualGarra() {

    const btnSubir =
        document.getElementById("btnGarraSubir");

    const btnDescer =
        document.getElementById("btnGarraDescer");

    if (!btnSubir || !btnDescer) {
        return;
    }

    if (btnSubir.dataset.garraConfigurada === "true") {
        return;
    }

    btnSubir.dataset.garraConfigurada = "true";
    btnDescer.dataset.garraConfigurada = "true";


    /* --------------------------------------------------------
       PRESSIONAR
       -------------------------------------------------------- */

    function pressionarBotaoGarra(evento) {

        evento.preventDefault();

        if (
            evento.pointerType === "mouse" &&
            evento.button !== 0
        ) {
            return;
        }

        if (garraMovimentoAtivo) {
            return;
        }

        const sentido =
            evento.currentTarget.id === "btnGarraSubir"
                ? "SUBIR"
                : "DESCER";

        garraPonteiroId = evento.pointerId;

        try {
            evento.currentTarget.setPointerCapture(
                evento.pointerId
            );
        } catch (erro) {
            // A soltura global também será monitorada.
        }

        iniciarGarraManual(sentido);
    }


    /* --------------------------------------------------------
       SOLTAR OU CANCELAR
       -------------------------------------------------------- */

    function soltarBotaoGarra(evento) {

        if (
            garraPonteiroId !== null &&
            evento.pointerId !== garraPonteiroId
        ) {
            return;
        }

        if (garraMovimentoAtivo) {

            pararGarraManual("Botão solto");

        } else {

            garraPonteiroId = null;

        }
    }


    /* --------------------------------------------------------
       EVENTOS DOS BOTÕES
       -------------------------------------------------------- */

    btnSubir.addEventListener(
        "pointerdown",
        pressionarBotaoGarra
    );

    btnDescer.addEventListener(
        "pointerdown",
        pressionarBotaoGarra
    );

    btnSubir.addEventListener(
        "pointerup",
        soltarBotaoGarra
    );

    btnDescer.addEventListener(
        "pointerup",
        soltarBotaoGarra
    );

    btnSubir.addEventListener(
        "pointercancel",
        soltarBotaoGarra
    );

    btnDescer.addEventListener(
        "pointercancel",
        soltarBotaoGarra
    );

    btnSubir.addEventListener(
        "lostpointercapture",
        soltarBotaoGarra
    );

    btnDescer.addEventListener(
        "lostpointercapture",
        soltarBotaoGarra
    );


    /* --------------------------------------------------------
       SOLTURA FORA DOS BOTÕES
       -------------------------------------------------------- */

    window.addEventListener(
        "pointerup",
        soltarBotaoGarra
    );

    window.addEventListener(
        "pointercancel",
        soltarBotaoGarra
    );


    /* --------------------------------------------------------
       PERDA DE FOCO
       -------------------------------------------------------- */

    window.addEventListener("blur", function () {

        pararGarraManual("Janela perdeu o foco");

    });


    /* --------------------------------------------------------
       PÁGINA OCULTA
       -------------------------------------------------------- */

    document.addEventListener(
        "visibilitychange",
        function () {

            if (document.hidden) {

                pararGarraManual(
                    "Página ficou oculta"
                );

            }

        }
    );


    /* --------------------------------------------------------
       ESTADO INICIAL
       -------------------------------------------------------- */

    atualizarEstadoVisualGarra(
        "PARADA",
        "Segure o botão para mover a garra."
    );
}


/* ============================================================
   WATCHDOG DO FRONTEND
   ============================================================ */

function verificarControleManualGarra() {

    if (!garraMovimentoAtivo) {
        return;
    }

    // Mantém o comando vivo no ESP (watchdog de 300 ms).
    if (garraSentidoAtual) {
        publicar(TOPICOS.comando.garraMovimento, garraSentidoAtual, agvSelecionado, 0);
    }

    if (
        document.hidden ||
        !garraTelaManualVisivel()
    ) {

        pararGarraManual(
            "Controle manual indisponível"
        );

        return;
    }

    if (!manualPermitido()) {

        pararGarraManual(
            "Permissão de movimento perdida"
        );

        return;
    }

    if (
        !canalDisponivel(agvAtual())
    ) {

        pararGarraManual(
            "Conexão MQTT perdida"
        );

    }
}

function atualizarBotaoCancelarMissao() {
    const botao = document.getElementById(
        "btnAbrirCancelamentoMissao"
    );

    if (!botao) {
        return;
    }

    const agv = agvs[agvSelecionado];

    if (!agv) {
        botao.disabled = true;
        return;
    }

    const temMissaoCancelavel = Boolean(
    agv.missaoAtual ||
    agv.missaoCarregada
);

    const cancelamentoPendente = Boolean(
        cancelamentosMissaoPendentes[agv.id]
    );

    botao.disabled =
        !temMissaoCancelavel ||
        cancelamentoPendente;
}

function abrirFormularioCancelamentoMissao() {
    const agv = agvs[agvSelecionado];

    if (!agv) {
        ui.aviso("Escolha um AGV.", "aviso");
        return;
    }

    const temMissaoCancelavel = Boolean(
    agv.missaoAtual ||
    agv.missaoCarregada ||
    execucoesMissoes[agv.id]
);

if (!temMissaoCancelavel) {
    ui.aviso("Este AGV não tem missão para cancelar.", "aviso");
    return;
}

    if (cancelamentosMissaoPendentes[agv.id]) {
        ui.aviso("Já existe um cancelamento aguardando resposta deste AGV.", "aviso");
        return;
    }

    document.getElementById("cancelamentoMissaoAgv").textContent =
        `${agv.id} — ${agv.nome || "AGV selecionado"}`;

    document.querySelector(
        'input[name="escopoCancelamentoMissao"][value="ATUAL"]'
    ).checked = true;

    document.getElementById(
        "opcoesCancelamentoMissao"
    ).hidden = false;

    document.getElementById(
        "confirmacaoFinalCancelamentoMissao"
    ).hidden = true;

    document.getElementById(
        "mensagemCancelamentoMissao"
    ).hidden = true;

    document.getElementById(
        "btnContinuarCancelamentoMissao"
    ).hidden = false;

    document.getElementById(
        "btnConfirmarCancelamentoMissao"
    ).hidden = true;

    document.getElementById(
        "btnVoltarCancelamentoMissao"
    ).disabled = false;

    document.getElementById(
        "modalCancelarMissao"
    ).hidden = false;
}


function fecharFormularioCancelamentoMissao() {
    const modal = document.getElementById("modalCancelarMissao");

    if (!modal) return;

    const agvId = agvSelecionado;

    // Não permita fechar e iniciar outra solicitação enquanto
    // aguardamos a confirmação do ESP32.
    if (cancelamentosMissaoPendentes[agvId]) {
        const mensagem = document.getElementById(
            "mensagemCancelamentoMissao"
        );

        mensagem.textContent =
            "Aguardando confirmação do ESP32. Não envie outro cancelamento.";

        mensagem.hidden = false;
        return;
    }

    modal.hidden = true;
}


function confirmarEscopoCancelamentoMissao() {
    const escopo = document.querySelector(
        'input[name="escopoCancelamentoMissao"]:checked'
    )?.value;

    if (!["ATUAL", "FILA"].includes(escopo)) {
        ui.aviso("Escolha o que cancelar.", "aviso");
        return;
    }

    const titulo = document.getElementById(
        "tituloConfirmacaoCancelamento"
    );

    const texto = document.getElementById(
        "textoConfirmacaoCancelamento"
    );

    if (escopo === "ATUAL") {
        titulo.textContent = "Confirmar cancelamento da missão atual";

        texto.textContent =
            "A missão atual será cancelada. A fila será preservada, " +
            "mas ficará suspensa até uma decisão explícita do operador.";
    } else {
        titulo.textContent = "Confirmar cancelamento da missão e da fila";

        texto.textContent =
            "A missão atual e todas as missões pendentes deste AGV " +
            "serão canceladas. A fila será apagada após a confirmação do ESP32.";
    }

    document.getElementById(
        "opcoesCancelamentoMissao"
    ).hidden = true;

    document.getElementById(
        "confirmacaoFinalCancelamentoMissao"
    ).hidden = false;

    document.getElementById(
        "btnContinuarCancelamentoMissao"
    ).hidden = true;

    document.getElementById(
        "btnConfirmarCancelamentoMissao"
    ).hidden = false;
}


function enviarCancelamentoMissao() {
    const agv = agvs[agvSelecionado];

    if (!agv) {
        ui.aviso("Nenhum AGV selecionado.", "aviso");
        return;
    }

    if (!canalDisponivel(agv)) {
        ui.aviso("MQTT desconectado: o cancelamento não foi enviado.", "erro");
        return;
    }

    if (cancelamentosMissaoPendentes[agv.id]) {
        ui.aviso("Já existe um cancelamento pendente para este AGV.");
        return;
    }

    const escopo = document.querySelector(
        'input[name="escopoCancelamentoMissao"]:checked'
    )?.value;

    if (!["ATUAL", "FILA"].includes(escopo)) {
        ui.aviso("Escopo de cancelamento inválido.");
        return;
    }

    const requestId =
        `${agv.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const pedido = {
        comando: "CANCELAR_MISSAO",
        requestId,
        escopo
    };

    const mensagem = document.getElementById(
        "mensagemCancelamentoMissao"
    );

    mensagem.textContent = "Enviando solicitação ao AGV...";
    mensagem.hidden = false;

    // Registrar antes da publicação para não perder uma resposta rápida.
    const timeoutId = setTimeout(() => {
        const pendente = cancelamentosMissaoPendentes[agv.id];

        if (!pendente || pendente.requestId !== requestId) {
            return;
        }

        delete cancelamentosMissaoPendentes[agv.id];

        mensagem.textContent =
            "Não recebemos a confirmação do ESP32 dentro do prazo. " +
            "O resultado do cancelamento é desconhecido. Verifique o AGV " +
            "antes de tentar novamente.";

        mensagem.hidden = false;

        document.getElementById(
            "btnVoltarCancelamentoMissao"
        ).disabled = false;

        document.getElementById(
            "btnConfirmarCancelamentoMissao"
        ).disabled = false;
    }, TEMPO_LIMITE_CANCELAMENTO_MS);

    cancelamentosMissaoPendentes[agv.id] = {
        requestId,
        escopo,
        timeoutId,
        missaoId: agv.missaoCarregada || agv.missaoAtual
    };

    const publicado = publicar(
        TOPICOS.comando.cancelarMissao,
        JSON.stringify(pedido),
        agv.id
    );

    if (publicado) {
        registrarAcaoSite(agv.id, "missao", "CANCELAMENTO_SOLICITADO", `Escopo ${escopo} · pedido ${requestId}`);
    }

    
if (!publicado) {
    clearTimeout(timeoutId);
    delete cancelamentosMissaoPendentes[agv.id];

    mensagem.textContent =
        "Não foi possível enviar o comando pelo MQTT.";

    mensagem.hidden = false;

    document.getElementById(
        "btnConfirmarCancelamentoMissao"
    ).disabled = false;

    document.getElementById(
        "btnVoltarCancelamentoMissao"
    ).disabled = false;

    return;
}


    mensagem.textContent =
        "Solicitação enviada. Aguardando confirmação do ESP32...";

    document.getElementById(
        "btnConfirmarCancelamentoMissao"
    ).disabled = true;

    document.getElementById(
        "btnVoltarCancelamentoMissao"
    ).disabled = true;
}


function processarConfirmacaoCancelamentoMissao(agvId, valor) {
    let evento;

    try {
        evento = JSON.parse(valor);
    } catch (_) {
        return false;
    }

    if (
        !evento ||
        ![
            "CANCELAMENTO_CONFIRMADO",
            "CANCELAMENTO_ERRO"
        ].includes(evento.evento)
    ) {
        return false;
    }

    const pendente = cancelamentosMissaoPendentes[agvId];

    // Ignora respostas sem solicitação correspondente.
    if (!pendente || evento.requestId !== pendente.requestId) {
        console.warn(
            "Resposta de cancelamento sem solicitação correspondente:",
            agvId,
            evento
        );

        return true;
    }

    const mensagem = document.getElementById(
        "mensagemCancelamentoMissao"
    );

    const btnConfirmar = document.getElementById(
        "btnConfirmarCancelamentoMissao"
    );

    const btnVoltar = document.getElementById(
        "btnVoltarCancelamentoMissao"
    );

    // O ESP32 informou que não conseguiu cancelar.
    if (evento.evento === "CANCELAMENTO_ERRO") {
        clearTimeout(pendente.timeoutId);
        delete cancelamentosMissaoPendentes[agvId];

        if (mensagem) {
            mensagem.textContent =
                "O ESP32 não confirmou o cancelamento: " +
                (evento.motivo || "motivo não informado.");

            mensagem.hidden = false;
        }

        if (btnConfirmar) btnConfirmar.disabled = false;
        if (btnVoltar) btnVoltar.disabled = false;

        return true;
    }

    // Não aplique uma confirmação referente a outro escopo.
    if (evento.escopo !== pendente.escopo) {
        console.error(
            "Escopo de cancelamento divergente.",
            {
                solicitado: pendente.escopo,
                recebido: evento.escopo
            }
        );

        if (mensagem) {
            mensagem.textContent =
                "A resposta do ESP32 diverge do pedido. " +
                "O resultado permanece sem confirmação válida. " +
                "Verifique o AGV antes de continuar.";

            mensagem.hidden = false;
        }

        // Mantém o pedido pendente até uma resposta válida
        // ou até o timeout já registrado.
        return true;
    }

    const agv = agvs[agvId];

    if (!agv) {
        clearTimeout(pendente.timeoutId);
        delete cancelamentosMissaoPendentes[agvId];

        if (mensagem) {
            mensagem.textContent =
                "O ESP32 confirmou o cancelamento, mas o AGV " +
                "não foi encontrado no estado local.";

            mensagem.hidden = false;
        }

        if (btnVoltar) btnVoltar.disabled = false;

        return true;
    }

    // A confirmação corresponde ao pedido. Encerra a espera.
    clearTimeout(pendente.timeoutId);
    delete cancelamentosMissaoPendentes[agvId];


    const execucao = execucoesMissoes[agvId];

    if (execucao) {
        execucao.cancelada = true;

        if (execucao.timer) {
            clearTimeout(execucao.timer);
        }

        if (execucao.timeout) {
            clearTimeout(execucao.timeout);
        }

        if (execucao.timeoutId) {
            clearTimeout(execucao.timeoutId);
        }

        delete execucoesMissoes[agvId];
    }

    agv.velocidade = 0;
    agv.progresso = 0;
    agv.estadoMissao = "CANCELADA";
    agv.missaoAtual = null;
    agv.missaoCarregada = null;
    agv.etapaMissao = null;

    if (!Array.isArray(agv.filaMissoes)) {
        agv.filaMissoes = [];
    }

    if (pendente.escopo === "FILA") {
        agv.filaMissoes = [];
        agv.filaMissoesSuspensa = false;
    } else {
        // Preserva a fila, mas impede seu início automático.
        agv.filaMissoesSuspensa = true;
    }

    salvarAgvsFrota();

    atualizarPainel();
    renderizarControleFilaAGV();
    renderizarFrota();

    if (mensagem) {
        mensagem.textContent =
            pendente.escopo === "FILA"
                ? "Cancelamento confirmado pelo ESP32. " +
                  "A missão atual e a fila foram canceladas."
                : "Cancelamento confirmado pelo ESP32. " +
                  "A fila foi preservada e está suspensa.";

        mensagem.hidden = false;
    }

    if (btnConfirmar) btnConfirmar.hidden = true;
    if (btnVoltar) btnVoltar.disabled = false;

    return true;
}




/* ============================================================

   MONITORAMENTO DO ESP32 (missão, posição, sensores)
   ============================================================ */

// Estado da missão publicado (retido) pelo ESP em status/missao.
function processarStatusMissao(agv, dados) {

    if (!dados || !ESTADOS_MISSAO.includes(dados.status)) {
        return;
    }

    const anterior = agv.estadoMissao;
    const status = dados.status;
    const missaoId = dados.missao || null;
    const total = Number(dados.etapas) || 0;
    const indice = Number(dados.indice) || 0;

    agv.estadoMissao = status;
    agv.etapaMissao = indice;
    agv.totalEtapasMissao = total;
    agv.trechoMissao = Number(dados.trecho) || 0;
    agv.faseMissao = dados.fase || null;
    agv.causaInterrupcao = dados.causa || "NENHUMA";

    switch (status) {

        case "CARREGADA":
            agv.missaoCarregada = missaoId;
            agv.missaoAtual = null;
            agv.progresso = 0;
            agv.carregamentoPendente = null;
            break;

        case "EM_EXECUCAO":
        case "AGUARDANDO_CONFIRMACAO":
        case "INTERROMPIDA":
            // o aviso "carregada, aperte START MISSÃO" deixa de valer
            if (anterior === "CARREGADA" && agv.avisoMissao && agv.avisoMissao.tipo !== "erro") agv.avisoMissao = null;
            agv.missaoCarregada = missaoId;
            agv.missaoAtual = missaoId;
            agv.progresso = total > 0 ? Math.round((indice / total) * 100) : 0;
            break;

        case "CONCLUIDA":
            agv.missaoAtual = null;
            agv.missaoCarregada = null;
            agv.progresso = 100;
            break;

        default:
            // AGUARDANDO, CANCELADA, ERRO
            agv.missaoAtual = null;
            agv.missaoCarregada = null;
            if (status !== "ERRO") {
                agv.progresso = 0;
            }
            break;
    }

    // Missão terminou: carrega a próxima da fila (o início continua
    // dependendo do botão START MISSÃO no AGV).
    if (status === "CONCLUIDA" && anterior !== "CONCLUIDA") {
        setTimeout(() => iniciarProximaMissaoFila(agv.id), 500);
    }
}




function podeCarregarMissao(agv) {

    return Boolean(
        agv &&
        canalDisponivel(agv) &&
        agv.online &&
        !agv.carregamentoPendente &&
        !cancelamentosMissaoPendentes[agv.id] &&
        !["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"].includes(agv.estadoMissao)
    );
}


function definirAvisoMissao(agv, texto, tipo = "info") {

    if (!agv) {
        return;
    }

    agv.avisoMissao = { texto, tipo, quando: Date.now() };
}


function confirmarEtapaAGV() {

    const agv = agvAtual();

    if (!agv || agv.estadoMissao !== "AGUARDANDO_CONFIRMACAO") {
        return;
    }

    const enviado = publicar(
        TOPICOS.comando.confirmarEtapa,
        JSON.stringify({
            comando: "CONFIRMAR_ETAPA",
            missao: agv.missaoAtual,
            indice: Number(agv.etapaMissao) || 0
        }),
        agv.id
    );

    if (!enviado) {
        ui.aviso("MQTT desconectado: a confirmação não foi enviada.", "erro");
    }
}


function retomarFilaMissoes() {

    const agv = agvAtual();

    if (!agv) {
        return;
    }

    agv.filaMissoesSuspensa = false;

    salvarAgvsFrota();
    iniciarProximaMissaoFila(agv.id);
    agendarAtualizacaoTela();
}




function escaparHtml(texto) {

    return String(texto ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}


// Junta várias mensagens MQTT em uma única atualização da interface.
var atualizacaoTelaAgendada = false;

function agendarAtualizacaoTela() {

    if (atualizacaoTelaAgendada) {
        return;
    }

    atualizacaoTelaAgendada = true;

    setTimeout(() => {

        atualizacaoTelaAgendada = false;

        const telaAtual = document.querySelector(".tela.ativa")?.id;

        if (telaAtual === "frota") {
            renderizarFrota();
        }

        atualizarPainel();
        if (telaAtual === "visaoGeral") {
            renderizarControleFilaAGV();
            renderizarAGVMapaVisaoGeral();
        }
        renderizarDadosTelaAtual();

    }, 150);
}


function renderizarDadosTelaAtual() {

    const telaAtual = document.querySelector(".tela.ativa")?.id;

    if (telaAtual === "sensores") renderizarSensores();
    if (telaAtual === "diagnostico") renderizarDiagnostico();
    if (telaAtual === "historico") renderizarHistorico();
    if (telaAtual === "configuracoes") renderizarConfiguracoes();
    if (telaAtual === "controleManual") atualizarStatusGarraESP();
    if (telaAtual === "missoes" && !document.querySelector("#modalEtapaMissao:not([hidden])")) renderizarListaMissoes();
}

/* ============================================================
   CALIBRAÇÃO DO QTR-8A
   ============================================================
   Enquanto o ESP calibra, o site guarda o mínimo e o máximo que
   cada sensor já viu (das leituras ao vivo) para mostrar quais
   sensores ainda precisam passar pela linha.
*/

const QTR_CONTRASTE_BOM = 1000;     // faixa que deixa o sensor "verde"
const QTR_CONTRASTE_MINIMO = 100;   // o firmware recusa abaixo disto

function obterCalibracaoQTR(agv) {
    if (!agv) return null;
    if (!agv.sensores) agv.sensores = {};
    if (!agv.sensores.qtr) agv.sensores.qtr = { sensores: [], posicao: 0, erro: 0, correcao: 0 };
    if (!agv.sensores.qtr.calibracao) {
        agv.sensores.qtr.calibracao = {
            estado: "DESCONHECIDA", calibracaoValida: false, emAndamento: false,
            mensagem: "Aguardando informações do AGV", ultimaAtualizacao: 0
        };
    }
    return agv.sensores.qtr.calibracao;
}

function registrarLeituraCalibracaoQTR(agv) {
    const calibracao = obterCalibracaoQTR(agv);
    const brutos = agv.sensores?.qtr?.sensores;
    if (!calibracao?.emAndamento || !Array.isArray(brutos) || brutos.length < 8) return;
    const visto = agv.qtrCalibVisto || (agv.qtrCalibVisto = { min: Array(8).fill(4095), max: Array(8).fill(0), desde: Date.now() });
    for (let i = 0; i < 8; i++) {
        const v = Number(brutos[i]);
        if (!Number.isFinite(v)) continue;
        visto.min[i] = Math.min(visto.min[i], v);
        visto.max[i] = Math.max(visto.max[i], v);
    }
}

function atualizarPainelCalibracaoQTR(agv = agvAtual()) {
    const estado = document.getElementById("qtrCalibracaoEstado");
    const validade = document.getElementById("qtrCalibracaoValidade");
    const mensagem = document.getElementById("qtrCalibracaoMensagem");
    const conexao = document.getElementById("qtrCalibracaoConexao");
    const grade = document.getElementById("qtrCalibGrade");
    const resumo = document.getElementById("qtrCalibResumo");
    const btnIniciar = document.getElementById("btnIniciarCalibracaoQTR");
    const btnFinalizar = document.getElementById("btnFinalizarCalibracaoQTR");
    const btnCancelar = document.getElementById("btnCancelarCalibracaoQTR");
    if (!estado || !mensagem) return;

    if (!agv) {
        estado.textContent = "Sem AGV";
        [btnIniciar, btnFinalizar, btnCancelar].forEach(b => { if (b) b.disabled = true; });
        return;
    }
    const calibracao = obterCalibracaoQTR(agv);
    const canal = canalDisponivel(agv);
    const emAndamento = calibracao.emAndamento === true;
    const valida = calibracao.calibracaoValida === true;
    const maquinaSegura = agv.emergencia !== true && Number(agv.velocidade || 0) === 0 &&
        !["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO"].includes(agv.estadoMissao);
    const podeEnviar = canal && agv.online && maquinaSegura;

    if (emAndamento) {
        const desde = agv.qtrCalibVisto?.desde || calibracao.ultimaAtualizacao || Date.now();
        estado.className = "pilula azul";
        estado.innerHTML = `<span class="ponto" style="animation:piscar 1s steps(1) infinite"></span>Calibrando · ${tempoDecorrido(desde)}`;
    } else {
        estado.className = `pilula ${valida ? "verde" : "ambar"}`;
        estado.textContent = valida ? "Calibrado" : "Sem calibração";
    }
    if (validade) validade.innerHTML = valida
        ? `<span class="texto-ok">Válida</span>`
        : `<span class="texto-aviso">Sem calibração</span>`;
    mensagem.textContent = calibracao.mensagem || "Aguardando informações do AGV.";
    mensagem.className = `missao-dica ${/erro|recus|inv[aá]lid/i.test(calibracao.mensagem || "") ? "vermelho" : emAndamento ? "azul" : ""}`;
    if (conexao) {
        conexao.textContent = !canal ? "MQTT desconectado." : !agv.online ? "AGV offline." :
            !maquinaSegura ? "Para calibrar, o AGV precisa estar parado, sem emergência e sem missão." : "";
    }

    // barras: faixa vista (durante a calibração) e leitura atual
    if (grade) {
        const brutos = agv.sensores?.qtr?.sensores || [];
        const visto = emAndamento ? agv.qtrCalibVisto : null;
        let prontos = 0, minimos = 0;
        let html = "";
        for (let i = 0; i < 8; i++) {
            const atual = Number(brutos[i]);
            const min = visto ? visto.min[i] : null, max = visto ? visto.max[i] : null;
            const faixa = visto && max >= min ? max - min : 0;
            const pronto = faixa >= QTR_CONTRASTE_BOM;
            if (pronto) prontos++;
            if (faixa >= QTR_CONTRASTE_MINIMO) minimos++;
            const base = v => `${Math.max(0, Math.min(100, v / 4095 * 100))}%`;
            const status = !visto ? "--" : pronto ? "pronto" : faixa >= QTR_CONTRASTE_MINIMO ? "fraco" : "falta linha";
            html += `
                <div class="qtr-calib ${pronto ? "pronto" : ""}">
                    <div class="qtr-calib-faixa">
                        ${visto && max >= min ? `<i style="bottom:${base(min)};height:calc(${base(max)} - ${base(min)})"></i>` : ""}
                        ${Number.isFinite(atual) ? `<b style="bottom:${base(atual)}"></b>` : ""}
                    </div>
                    <span>S${i}${visto ? " · " + status : ""}</span>
                    <small>${visto && max >= min ? `${min}–${max}` : Number.isFinite(atual) ? atual : "--"}</small>
                </div>`;
        }
        ui.trocarHtml(grade, html);
        if (resumo) {
            resumo.textContent = emAndamento
                ? `Barra colorida: faixa já vista por cada sensor (fundo até linha). Traço escuro: leitura agora. ${prontos} de 8 prontos.`
                : "Aperte “Iniciar calibração” e passe o AGV devagar sobre a linha, para os dois lados.";
        }
        if (btnFinalizar) btnFinalizar.title = emAndamento && minimos < 8 ? "Algum sensor ainda não viu a linha: o AGV vai recusar" : "";
    }

    if (btnIniciar) { btnIniciar.disabled = !podeEnviar || emAndamento; btnIniciar.hidden = emAndamento; }
    if (btnFinalizar) { btnFinalizar.disabled = !podeEnviar || !emAndamento; btnFinalizar.hidden = !emAndamento; }
    if (btnCancelar) { btnCancelar.disabled = !canal || !emAndamento; btnCancelar.hidden = !emAndamento; }
}

async function enviarComandoCalibracaoQTR(acao) {
    const agv = agvAtual();
    if (!agv) { ui.aviso("Escolha um AGV.", "aviso"); return; }
    if (!canalDisponivel(agv)) { ui.aviso("MQTT desconectado.", "erro"); return; }
    const calibracao = obterCalibracaoQTR(agv);
    if (acao === "INICIAR") {
        if (!agv.online) { ui.aviso("O AGV está offline.", "erro"); return; }
        if (agv.emergencia || Number(agv.velocidade || 0) !== 0 || ["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO"].includes(agv.estadoMissao)) {
            ui.aviso("A calibração exige o AGV parado, sem emergência e sem missão em execução.", "aviso");
            return;
        }
        if (calibracao.emAndamento) { ui.aviso("Já existe uma calibração em andamento.", "aviso"); return; }
    } else if (!calibracao.emAndamento) {
        ui.aviso("Não existe calibração em andamento.", "aviso");
        return;
    }
    const textos = {
        INICIAR: ["Calibrar o seguidor de linha?", "Depois de iniciar, passe o AGV devagar sobre a linha, para os dois lados, até todos os sensores ficarem verdes.", "Iniciar"],
        FINALIZAR: ["Salvar a calibração?", "O AGV confere se todos os sensores viram claro e escuro e grava a calibração na memória.", "Salvar"],
        CANCELAR: ["Cancelar a calibração?", "A calibração anterior continua valendo.", "Cancelar calibração"]
    };
    const [titulo, texto, botao] = textos[acao];
    if (!(await ui.confirmar({ titulo, texto, confirmar: botao, perigo: acao === "CANCELAR" }))) return;
    if (acao === "INICIAR") agv.qtrCalibVisto = { min: Array(8).fill(4095), max: Array(8).fill(0), desde: Date.now() };
    const enviado = publicar(TOPICOS.comando.calibracaoQtr, JSON.stringify({ acao }), agv.id);
    if (enviado === false) ui.aviso("Não foi possível enviar o comando.", "erro");
}

function iniciarCalibracaoQTR() { enviarComandoCalibracaoQTR("INICIAR"); }
function finalizarCalibracaoQTR() { enviarComandoCalibracaoQTR("FINALIZAR"); }
function cancelarCalibracaoQTR() { enviarComandoCalibracaoQTR("CANCELAR"); }


/* ============================================================
   MISSÃO ATUAL (Visão Geral)
   ============================================================ */

const TEXTOS_CAUSA = {
    STOP: "STOP acionado", EMERGENCIA: "emergência", BARREIRA: "obstáculo à frente",
    FALHA_MCP: "falha de comunicação do painel", FALHA_SENSOR: "falha dos sensores de distância",
    FALHA_TECNICA: "falha técnica", MUDANCA_MODO: "seletora foi para MANUAL", RFID: "RFID", NENHUMA: "—"
};

function textoCausa(causa) {
    return TEXTOS_CAUSA[causa] || String(causa || "").toLowerCase();
}

function descreverEtapaMissao(etapa) {
    if (!etapa) return "--";
    switch (etapa.tipo) {
        case "IR_PARA": return `Ir para ${nomeCurtoDestino(etapa.destino)}`;
        case "AGUARDAR": return `Aguardar ${etapa.tempo} s`;
        case "AGUARDAR_CONFIRMACAO": return "Aguardar confirmação";
        case "CARREGAR": return "Carregar";
        case "DESCARREGAR": return "Descarregar";
        default: return etapa.tipo;
    }
}

// Progresso fino: etapas feitas + fração do trecho atual
function progressoDetalhado(agv, missao) {
    const total = agv.totalEtapasMissao || missao?.etapas?.length || 0;
    if (!total) return 0;
    const indice = Number(agv.etapaMissao) || 0;
    let fracao = 0;
    const compilada = agv.missaoCompilada;
    const etapa = compilada && compilada.missao === (agv.missaoAtual || agv.missaoCarregada) ? compilada.etapas[indice] : null;
    if (agv.missaoAtual && etapa && etapa.tipo === "MOVIMENTO" && etapa.trechos.length) {
        const comprimentos = etapa.trechos.map(t => Number(t.comprimento) || 0);
        const soma = comprimentos.reduce((a, b) => a + b, 0) || 1;
        const t = Number(agv.trechoMissao) || 0;
        const feito = comprimentos.slice(0, t).reduce((a, b) => a + b, 0);
        const p = agv.progressoTrecho;
        const dentro = p && p.fase !== "ODOMETRIA" && p.trecho === t ? Math.min(comprimentos[t] || 0, p.distancia || 0) : 0;
        fracao = Math.max(0, Math.min(1, (feito + dentro) / soma));
    }
    return Math.max(0, Math.min(100, (indice + fracao) / total * 100));
}

function montarHtmlMissaoAtual(agv) {
    if (agv.carregamentoPendente) {
        return `
            <div class="missao-cabecalho"><div><h2>Missão</h2><div class="sub"><span class="mono">${escaparHtml(agv.carregamentoPendente.missaoId)}</span> · enviando</div></div></div>
            <div class="missao-dica azul" style="margin-top:12px">Aguardando o AGV validar a missão…</div>`;
    }
    const missaoId = agv.missaoAtual || agv.missaoCarregada;
    if (!missaoId) {
        const ultima = agv.estadoMissao === "CONCLUIDA" ? "Última missão concluída." : agv.estadoMissao === "ERRO" ? "A última missão terminou com erro." : agv.estadoMissao === "CANCELADA" ? "A última missão foi cancelada." : "";
        return `
            <div class="missao-cabecalho"><div><h2>Missão</h2><div class="sub">Nenhuma missão carregada</div></div></div>
            <div class="missao-vazia-vg" style="font-size:13px;margin-top:8px">${ultima} Escolha uma missão abaixo e carregue no AGV. O início é sempre no botão START MISSÃO do AGV.</div>`;
    }
    const missao = obterMissaoPorId(missaoId);
    const etapas = missao ? missao.etapas : [];
    const total = agv.totalEtapasMissao || etapas.length;
    const indice = Number(agv.etapaMissao) || 0;
    const estado = agv.estadoMissao;
    const carregada = estado === "CARREGADA";
    const progresso = carregada ? 0 : progressoDetalhado(agv, missao);

    const compilada = agv.missaoCompilada && agv.missaoCompilada.missao === missaoId ? agv.missaoCompilada : null;
    let extraAtual = "";
    let classeAtual = "";
    if (estado === "EM_EXECUCAO") {
        const ce = compilada?.etapas?.[indice];
        if (ce && ce.tipo === "MOVIMENTO" && ce.trechos.length) extraAtual = `trecho ${Math.min((Number(agv.trechoMissao) || 0) + 1, ce.trechos.length)} de ${ce.trechos.length}`;
        else if (etapas[indice]?.tipo === "AGUARDAR") extraAtual = `${etapas[indice].tempo} s`;
        else extraAtual = "agora";
    } else if (estado === "INTERROMPIDA") {
        extraAtual = textoCausa(agv.causaInterrupcao);
        classeAtual = agv.causaInterrupcao === "EMERGENCIA" ? "erro" : "pausa";
    } else if (estado === "AGUARDANDO_CONFIRMACAO") {
        extraAtual = "aguarda você";
        classeAtual = "pausa";
    }

    const itens = etapas.map((etapa, i) => {
        let classe = "", marca = String(i + 1), extra = "";
        if (!carregada && i < indice) { classe = "feita"; marca = ui.icone("ok", "icone-p"); }
        else if (!carregada && i === indice) { classe = `atual ${classeAtual}`; extra = extraAtual; }
        return `<li class="${classe}"><span class="marca-etapa">${marca}</span><span>${escaparHtml(descreverEtapaMissao(etapa))}</span>${extra ? `<span class="timeline-extra">${escaparHtml(extra)}</span>` : ""}</li>`;
    }).join("");

    let dica = "";
    switch (estado) {
        case "CARREGADA":
            dica = agv.modo === "AUTOMATICO"
                ? `<div class="missao-dica azul">Pronta. Aperte <b>START MISSÃO</b> no painel do AGV para começar.</div>`
                : `<div class="missao-dica ambar">Passe a seletora para <b>AUTOMÁTICO</b> e aperte <b>START MISSÃO</b> no AGV.</div>`;
            break;
        case "AGUARDANDO_CONFIRMACAO":
            dica = `<div class="missao-dica ciano"><b>${escaparHtml(etapas[indice]?.mensagem || "Confirmar etapa")}</b><br>Confirme aqui ou no botão START MISSÃO do AGV.</div>
                    <button type="button" class="btn btn-primario btn-confirmar-etapa" onclick="confirmarEtapaAGV()">Confirmar etapa</button>`;
            break;
        case "INTERROMPIDA":
            dica = agv.causaInterrupcao === "EMERGENCIA"
                ? `<div class="missao-dica vermelho">Parada por emergência. Libere o botão e aperte REARME no AGV; depois START MISSÃO para continuar.</div>`
                : agv.causaInterrupcao === "BARREIRA"
                    ? `<div class="missao-dica ambar">Obstáculo à frente. O AGV continua sozinho quando a frente ficar livre.</div>`
                    : `<div class="missao-dica ambar">Parada: ${escaparHtml(textoCausa(agv.causaInterrupcao))}. Resolva e aperte START MISSÃO no AGV para retomar.</div>`;
            break;
    }

    return `
        <div class="missao-cabecalho">
            <div><h2>Missão</h2><div class="sub"><span class="mono">${escaparHtml(missaoId)}</span>${missao?.nome ? ` · ${escaparHtml(missao.nome)}` : ""}</div></div>
            <span class="mono suave" style="font-size:13px">${carregada ? "carregada" : `etapa ${Math.min(indice + 1, total)} de ${total}`}</span>
        </div>
        <div class="barra-progresso" style="margin:12px 0"><div style="width:${progresso.toFixed(1)}%"></div></div>
        <ol class="timeline">${itens}</ol>
        ${dica ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">${dica}</div>` : ""}`;
}


/* ============================================================
   SENSORES
   ============================================================ */

const SINAIS_LED_SITE = {
    INICIANDO: ["#F2F4F7", "perseguicao", "Iniciando"],
    FALHA: ["#FF2FB9", "pisca", "Falha técnica ou erro na missão"],
    EMERGENCIA: ["#FF3B3B", "estrobo", "Emergência"],
    REARME: ["#FFB000", "pisca", "Aguardando rearme"],
    DESLIGADO: ["#8A939E", "respira", "Desligado (STOP)"],
    OBSTACULO: ["#FF6A1A", "respira-rapida", "Obstáculo à frente"],
    MANUTENCAO: ["#F2F4F7", "perseguicao", "Calibração, teste ou atualização"],
    MANUAL_PRONTO: ["#2F6BFF", "fixo", "Manual, parado"],
    MANUAL_ANDANDO: ["#2F6BFF", "perseguicao", "Manual, andando"],
    PASSAR_AUTOMATICO: ["#2F6BFF", "pisca", "Missão carregada: passe para AUTOMÁTICO"],
    AUTO_PRONTO: ["#22D35B", "fixo", "Automático, pronto"],
    APERTE_START: ["#22D35B", "pisca", "Missão pronta: aperte START MISSÃO"],
    MISSAO_ANDANDO: ["#22D35B", "perseguicao", "Em missão, andando"],
    MISSAO_PARADA: ["#22D35B", "respira", "Em missão, parado numa etapa"],
    CONFIRMACAO: ["#22D8FF", "pisca", "Aguardando confirmação do operador"],
    CONCLUIDA: ["#22D35B", "flash3", "Missão concluída"],
    TESTE_LEDS: ["#F2F4F7", "fixo", "Teste dos LEDs"]
};

const NOMES_EFEITO = { fixo: "aceso", pisca: "piscando", estrobo: "piscando rápido", respira: "respirando", "respira-rapida": "respirando rápido", perseguicao: "correndo", flash3: "3 piscadas" };

function fitaLedHtml(nome, quantidade = 5, classe = "") {
    const sinal = SINAIS_LED_SITE[nome];
    if (!sinal) return `<span class="fita-led ${classe}">${"<i></i>".repeat(quantidade)}</span>`;
    const [cor, efeito] = sinal;
    const leds = Array.from({ length: quantidade }, (_, i) =>
        `<i class="fx-${efeito}" style="--led:${cor};--i:${i};--n:${quantidade}"></i>`).join("");
    return `<span class="fita-led ${classe}">${leds}</span>`;
}

function renderizarSensores() {
    const agv = agvAtual();
    if (!agv) return;
    const set = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = valor; };
    const atualizado = agv.online ? "ao vivo" : "offline · últimos valores recebidos";
    const sub = document.getElementById("subtituloTela");
    if (sub) sub.textContent = `AGV ${agv.id} · ${agv.nome} — ${atualizado}`;

    // ---------------- QTR ----------------
    const qtr = agv.sensores?.qtr || {};
    const brutos = Array.isArray(qtr.sensores) ? qtr.sensores : [];
    const normalizados = Array.isArray(qtr.normalizados) ? qtr.normalizados : [];
    const caixa = document.getElementById("qtrSensores");
    if (caixa && !caixa.children.length) {
        caixa.innerHTML = Array.from({ length: 8 }, (_, i) =>
            `<div class="qtr-barra"><div class="qtr-coluna"><i id="qtrA${i}"></i></div><strong id="qtrValorA${i}">--</strong><span>S${i}</span></div>`).join("");
    }
    for (let i = 0; i < 8; i++) {
        const barra = document.getElementById(`qtrA${i}`);
        const bruto = brutos[i];
        const altura = qtr.calibrado ? (Number(normalizados[i]) || 0) / 10 : typeof bruto === "number" ? bruto / 4095 * 100 : 0;
        if (barra) {
            barra.style.height = `${Math.max(0, Math.min(100, altura))}%`;
            barra.classList.toggle("forte", altura > 60);
        }
        set(`qtrValorA${i}`, typeof bruto === "number" ? bruto : "--");
    }
    const pilula = document.getElementById("qtrPilula");
    if (pilula) {
        pilula.className = `pilula ${!agv.online ? "cinza" : qtr.linha ? "verde" : "ambar"}`;
        pilula.textContent = !agv.online ? "Sem dados" : qtr.linha ? "Linha detectada" : "Sem linha";
    }
    const posicao = document.getElementById("qtrLinhaPosicao");
    if (posicao) {
        // posição 0..7000 (sensor 0 à direita): 0 = direita
        const p = Number(qtr.posicao);
        const fracao = Number.isFinite(p) ? 1 - Math.max(0, Math.min(7000, p)) / 7000 : 0.5;
        posicao.classList.toggle("sem-linha", !qtr.linha);
        posicao.firstElementChild.style.left = `${(qtr.linha ? fracao : 0.5) * 100}%`;
    }
    set("qtrPosicao", qtr.linha ? qtr.posicao : "SEM LINHA");
    set("qtrErro", qtr.linha && typeof qtr.erro === "number" ? (qtr.erro > 0 ? "+" : "") + qtr.erro : "--");
    const qtrCorrecao = document.getElementById("qtrCorrecao");
    if (qtrCorrecao) qtrCorrecao.innerHTML = typeof qtr.correcao === "number" ? `${ui.numero(qtr.correcao, 2)} <span class="unidade">rad/s</span>` : "--";
    set("qtrSub", qtr.calibrado ? "Calibrado · sensor 0 à direita" : "Sem calibração: as barras mostram o valor bruto · sensor 0 à direita");
    atualizarPainelCalibracaoQTR(agv);

    // ---------------- VL53 ----------------
    const vl53 = agv.sensores?.vl53 || {};
    const limite = Number(vl53.limite) || 1000;
    const alcance = 2000;
    set("vl53Sub", `Os dois olham para a frente · limite atual ${ui.numero(limite / 1000, 2)} m (${agv.modo === "MANUAL" ? "manual" : "automático"})`);
    set("vl53EscalaLimite", `barreira ${ui.numero(limite / 1000, 2)} m`);
    [1, 2].forEach(n => {
        const d = vl53[`d${n}`];
        const valido = vl53[`v${n}`];
        const barra = document.getElementById(`vl53Barra${n}`);
        const marca = document.getElementById(`vl53Limite${n}`);
        if (marca) marca.style.left = `${Math.min(100, limite / alcance * 100)}%`;
        let texto = "--", largura = 0, perto = false, estado = "";
        if (typeof d === "number") {
            if (!valido) { texto = "sem leitura"; estado = "Sem leitura recente: o AGV para por segurança se durar mais de 0,3 s."; }
            else if (d < 0) { texto = "fora de alcance (livre)"; largura = 100; }
            else { texto = `${ui.numero(d / 1000, 2)} m`; largura = Math.min(100, d / alcance * 100); perto = d < limite; estado = perto ? "Objeto dentro da barreira" : ""; }
        }
        set(`vl53Valor${n}`, texto);
        set(`vl53Estado${n}`, estado);
        if (barra) { barra.style.width = `${largura}%`; barra.classList.toggle("perto", perto); }
    });
    const vlPilula = document.getElementById("vl53Pilula");
    if (vlPilula) {
        const b = agv.barreira;
        vlPilula.className = `pilula ${!agv.online ? "cinza" : b === "INVADIDA" ? "vermelho" : b === "FALHA_LEITURA" ? "ambar" : "verde"}`;
        vlPilula.textContent = !agv.online ? "Sem dados" : b === "INVADIDA" ? "Invadida" : b === "FALHA_LEITURA" ? "Falha de leitura" : "Livre";
    }

    // ---------------- RFID ----------------
    const rfid = agv.sensores?.rfid || {};
    const rfidStatus = document.getElementById("rfidStatus");
    if (rfidStatus) { rfidStatus.className = `pilula ${agv.online ? "verde" : "cinza"}`; rfidStatus.textContent = agv.online ? "Online" : "Offline"; }
    set("rfidUltimo", rfid.ultimo && rfid.ultimo !== "--" ? rfid.ultimo : "Nenhuma tag");
    set("rfidEstacao", descreverTag(rfid.ultimo));
    set("rfidHorario", rfid.quando ? tempoRelativo(rfid.quando) : rfid.horario || "--");
    set("rfidResultado", rfid.resultado || "--");
    const lista = document.getElementById("rfidLista");
    if (lista) {
        const itens = (agv.rfidHistorico || []).slice(0, 6);
        ui.trocarHtml(lista, itens.length ? itens.map(r =>
            `<li><span>${new Date(r.quando).toLocaleTimeString("pt-BR")}</span><span>${escaparHtml(r.codigo)}</span><span class="${descreverTag(r.codigo) === "fora da planta" ? "texto-aviso" : ""}">${escaparHtml(descreverTag(r.codigo))}</span></li>`).join("")
            : `<li><span></span><span class="suave">Nenhuma leitura ainda</span><span></span></li>`);
    }

    renderizarPainelEntradas(agv);
}

function descreverTag(codigo) {
    if (!codigo || codigo === "--") return "--";
    const achado = Planta.localizarRfid(plantaPublicada(), codigo);
    if (!achado) return "fora da planta";
    if (achado.tipo === "NO") return Planta.nomeDoPonto(plantaPublicada(), achado.no.id);
    return `tag do segmento ${achado.segmento.id}`;
}

// Entradas do MCP: bit 0 START, 1 REARME, 2 EMERGÊNCIA (1 = solta), 3 SELETORA (1 = AUTO),
// 4 STOP (1 = solto), 5 START MISSÃO
function renderizarPainelEntradas(agv) {
    const caixa = document.getElementById("painelEntradas");
    const luzes = document.getElementById("painelLuzes");
    if (!caixa || !luzes) return;
    const bits = Number(agv.entradas);
    const conhecido = agv.online && Number.isFinite(bits) && bits >= 0;
    const bit = n => Boolean(bits & (1 << n));
    const entrada = (nome, ativo, textoAtivo, textoNormal, perigo) => `
        <div class="entrada ${conhecido && ativo ? (perigo ? "perigo" : "ativa") : ""}"><i></i>
            <span><b>${nome}</b><small>${!conhecido ? "sem dados" : ativo ? textoAtivo : textoNormal}</small></span></div>`;
    ui.trocarHtml(caixa, [
        entrada("START", bit(0), "pressionado", "solto"),
        entrada("STOP", !bit(4), "acionado (travado)", "solto", true),
        entrada("EMERGÊNCIA", !bit(2), "acionada", "solta", true),
        entrada("REARME", bit(1), "pressionado", "solto"),
        entrada("START MISSÃO", bit(5), "pressionado", "solto"),
        entrada("SELETORA", !bit(3), "MANUAL", "AUTOMÁTICO")
    ].join(""));
    if (!conhecido && agv.online && bits === -1) caixa.insertAdjacentHTML("afterbegin", `<div class="missao-dica vermelho" style="grid-column:1/-1">O painel (MCP23017) não está respondendo.</div>`);

    const leds = agv.leds;
    const sinal = SINAIS_LED_SITE[leds];
    const startMissaoAceso = ["EM_EXECUCAO"].includes(agv.estadoMissao) && leds !== "APERTE_START" && leds !== "CONFIRMACAO";
    const startMissaoPisca = leds === "APERTE_START" || leds === "CONFIRMACAO";
    const rearmePisca = agv.aguardandoRearme && !agv.emergencia;
    const luz = (classeLed, cor, nome, texto) => `
        <div class="luz"><span class="luz-led ${classeLed}" style="--led:${cor}"></span><span><b>${nome}</b><small>${texto}</small></span></div>`;
    ui.trocarHtml(luzes, [
        luz(!agv.online ? "" : startMissaoPisca ? "pisca" : startMissaoAceso ? "aceso" : "", "var(--accent)", "START MISSÃO",
            !agv.online ? "sem dados" : startMissaoPisca ? (leds === "CONFIRMACAO" ? "piscando · confirma a etapa" : "piscando · missão pronta") : startMissaoAceso ? "aceso · missão em andamento" : "apagado"),
        luz(!agv.online ? "" : rearmePisca ? "pisca" : "", "#F0C419", "REARME", !agv.online ? "sem dados" : rearmePisca ? "piscando · aperte para rearmar" : "apagado"),
        `<div class="luz">${fitaLedHtml(agv.online ? leds : null, 5)}<span><b>Fitas de LED</b><small>${!agv.online ? "sem dados" : sinal ? `${NOMES_EFEITO[sinal[1]]} · ${sinal[2]}` : escaparHtml(leds || "--")}</small></span></div>`
    ].join(""));
}


/* ============================================================
   DIAGNÓSTICO
   ============================================================ */

function nivelPorErros(n) {
    return n > 0 ? "aviso" : "ok";
}

function itemAutoteste(agv, id) {
    return (agv.autoteste?.itens || []).find(i => i.id === id) || null;
}

function componentesDiagnostico(agv) {
    const d = agv.diagnostico || {};
    const e = d.erros || {};
    const conhecido = Boolean(agv.diagnostico);
    const hardwareFalha = agv.sistema?.hardware && agv.sistema.hardware !== "OK" ? agv.sistema.hardware : "";
    const lista = [];
    const add = (nome, detalhe, nivel, contagem, idAutoteste) => {
        const at = idAutoteste ? itemAutoteste(agv, idAutoteste) : null;
        if (at && at.nivel === "FALHA") { nivel = "falha"; detalhe = at.detalhe; }
        else if (at && at.nivel === "AVISO" && nivel === "ok") { nivel = "aviso"; detalhe = at.detalhe; }
        lista.push({ nome, detalhe, nivel: conhecido || at ? nivel : "", contagem: conhecido ? String(contagem ?? 0) : "--" });
    };
    add("Painel de botões (MCP23017)", d.entradas === -1 ? "Sem resposta no endereço 0x20" : "Respondendo · endereço 0x20",
        d.entradas === -1 || /MCP/i.test(hardwareFalha) ? "falha" : nivelPorErros(e.mcp), e.mcp, "mcp");
    add("Multiplexador I²C (TCA9548A)", "Endereço 0x70", /TCA/i.test(hardwareFalha) ? "falha" : nivelPorErros(e.tca), e.tca, "tca");
    add("Distância esquerdo (VL53L0X)", e.vl53_1 > 0 ? "Canal 0 · falhas de leitura (cabo ou conector?)" : "Canal 0", nivelPorErros(e.vl53_1), e.vl53_1, "vl53_1");
    add("Distância direito (VL53L0X)", e.vl53_2 > 0 ? "Canal 1 · falhas de leitura (cabo ou conector?)" : "Canal 1", nivelPorErros(e.vl53_2), e.vl53_2, "vl53_2");
    const calibrado = agv.sensores?.qtr?.calibrado;
    add("Seguidor de linha (QTR-8A)", `${calibrado ? "Calibrado" : "Sem calibração"} · linha perdida ${e.linhaPerdida ?? 0}×`,
        calibrado === false ? "aviso" : "ok", e.linhaPerdida, "qtr");
    add("Leitor RFID (RDM6300)", `${ui.milhar(d.rfidLeituras ?? 0)} leituras · ${e.rfidInvalidos ?? 0} quadros inválidos`,
        nivelPorErros(e.rfidInvalidos), e.rfidInvalidos, "rfid");
    const g = agv.garra;
    add("Garra (motor 5)", g ? (g.estado === "NAO_CONFIGURADA" ? "Desativada (GARRA_CURSO = 0)" : `Curso de ${g.curso} passos · em ${g.posicao}`) : "--", "ok", 0, "garra");
    const p = agv.parametros || {};
    add("Fitas de LED", `Fita 1: ${p.LEDS_FITA_ESTADO ?? "--"} LEDs · Fita 2: ${p.LEDS_FITA_COMUNICACAO ?? "--"} LEDs · ${SINAIS_LED_SITE[d.leds]?.[2] || d.leds || "--"}`, "ok", 0);
    add("Wi-Fi e broker", `${d.quedasWifi ?? 0} quedas do Wi-Fi · ${d.quedasMqtt ?? 0} do MQTT desde que ligou`,
        (d.quedasWifi || 0) + (d.quedasMqtt || 0) > 3 ? "aviso" : "ok", (d.quedasWifi || 0) + (d.quedasMqtt || 0), "wifi");
    add("Memória de configuração", agv.parametros ? `${Object.keys(agv.parametros).length} parâmetros recebidos` : "Aguardando parâmetros", "ok", 0, "braco");
    if (hardwareFalha) lista.unshift({ nome: "Inicialização do hardware", detalhe: hardwareFalha, nivel: "falha", contagem: "!" });
    return lista;
}

function guardarHistoricoDiagnostico(agv, dados) {
    const lista = agv.loopHistorico || (agv.loopHistorico = []);
    lista.push({ t: Date.now(), medio: Number(dados.loopMedioUs) || 0, max: Number(dados.loopMaxUs) || 0 });
    while (lista.length > 72) lista.shift();
}

function barrasWifi(rssi) {
    if (!Number.isFinite(rssi) || rssi >= 0) return 0;
    return rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -75 ? 2 : rssi >= -85 ? 1 : 0;
}

function renderizarDiagnostico() {
    const agv = agvAtual();
    if (!agv) return;
    const d = agv.diagnostico || {};
    const sistema = agv.sistema || {};
    const conhecido = Boolean(agv.diagnostico);

    // resumo
    const componentes = componentesDiagnostico(agv);
    const falhas = componentes.filter(c => c.nivel === "falha");
    const avisos = componentes.filter(c => c.nivel === "aviso");
    const resumo = document.getElementById("diagResumo");
    if (resumo) {
        const tipo = !agv.online && !conhecido ? "" : falhas.length ? "falha" : avisos.length ? "aviso" : conhecido ? "ok" : "";
        const pior = falhas[0] || avisos[0];
        resumo.className = `diag-resumo ${tipo}`;
        ui.trocarHtml(resumo, `
            <div style="display:flex;align-items:center;gap:14px">
                <span class="diag-resumo-icone">${ui.icone(tipo === "ok" ? "ok" : tipo ? "alerta" : "info", "icone-g")}</span>
                <div>
                    <div class="diag-resumo-titulo">${!conhecido ? (agv.online ? "Aguardando o primeiro diagnóstico" : "Sem dados") : falhas.length ? `${falhas.length} falha${falhas.length > 1 ? "s" : ""}` : avisos.length ? `${avisos.length} ponto${avisos.length > 1 ? "s" : ""} de atenção` : "Tudo certo"}</div>
                    <div class="suave">${conhecido ? `${componentes.length - falhas.length - avisos.length} de ${componentes.length} componentes sem problema` : agv.online ? "O AGV manda o diagnóstico a cada 5 s (firmware 0.7 ou mais novo)." : "O AGV está offline."}</div>
                </div>
            </div>
            <div class="diag-resumo-detalhe">${pior ? `<b>${escaparHtml(pior.nome)}</b>: ${escaparHtml(pior.detalhe)}` : ""}</div>`);
    }
    const badge = document.getElementById("menuBadgeDiag");
    if (badge) badge.hidden = !(falhas.length || avisos.length);

    const comp = document.getElementById("diagComponentes");
    if (comp) ui.trocarHtml(comp, componentes.map(c => `
        <div class="componente ${c.nivel}"><i></i><span><b>${escaparHtml(c.nome)}</b><small>${escaparHtml(c.detalhe)}</small></span><span class="contagem">${escaparHtml(c.contagem)}</span></div>`).join(""));

    // comunicação
    const rssi = Number(d.rssi);
    const barras = barrasWifi(rssi);
    const qualidade = !conhecido ? "--" : barras >= 4 ? "Sinal ótimo" : barras === 3 ? "Sinal bom" : barras === 2 ? "Sinal fraco" : "Sinal ruim";
    const classeSinal = barras >= 3 ? "" : barras === 2 ? "fraco" : "ruim";
    const resposta = agv.online && agv.ultimoHeartbeat ? `${ui.numero((Date.now() - agv.ultimoHeartbeat) / 1000, 1)} s` : "--";
    const com = document.getElementById("diagComunicacao");
    if (com) ui.trocarHtml(com, `
        <div class="card-header"><h2>Comunicação</h2><span class="pilula ${agv.online ? "verde" : "vermelho"}">${agv.online ? "Online" : "Offline"}</span></div>
        <div class="sinal-wifi ${classeSinal}">
            <svg width="56" height="44" viewBox="0 0 56 44" role="img" aria-label="Sinal Wi-Fi: ${barras} de 4 barras">
                ${[0, 1, 2, 3].map(i => `<rect x="${2 + i * 14}" y="${32 - i * 10}" width="10" height="${10 + i * 10}" rx="2" class="${i < barras ? "on" : ""}"></rect>`).join("")}
            </svg>
            <div>
                <div style="font-weight:700;font-size:17px">${qualidade} <span class="mono suave" style="font-weight:500;font-size:14px">${Number.isFinite(rssi) && conhecido ? rssi + " dBm" : ""}</span></div>
                <div class="suave" style="font-size:12.5px">IP ${escaparHtml(sistema.ip || "--")} · ${escaparHtml(sistema.ota_host || "")}</div>
            </div>
        </div>
        <dl class="tiles" style="margin:14px 0 0">
            <div class="tile"><dt>Última mensagem</dt><dd>${resposta}</dd></div>
            <div class="tile"><dt>Quedas</dt><dd>${conhecido ? (d.quedasWifi || 0) + (d.quedasMqtt || 0) : "--"} <span class="unidade">desde ligar</span></dd></div>
            <div class="tile"><dt>Na fila</dt><dd>${conhecido ? d.filaEventos ?? 0 : "--"} <span class="unidade">eventos</span></dd></div>
        </dl>
        ${d.erroMqtt && d.erroMqtt !== 0 ? `<p class="suave" style="font-size:12.5px;margin-top:8px">Último código de erro do MQTT: ${escaparHtml(d.erroMqtt)}</p>` : ""}`);

    // firmware
    const heap = Number(d.heap), heapMin = Number(d.heapMinimo);
    const heapPct = Number.isFinite(heap) ? Math.min(100, heap / 320000 * 100) : 0;
    const historico = agv.loopHistorico || [];
    const maxGrafico = Math.max(40000, ...historico.map(h => h.max));
    const pontos = historico.map((h, i) => `${historico.length > 1 ? (i / (historico.length - 1) * 300).toFixed(1) : 0},${(46 - h.max / maxGrafico * 42).toFixed(1)}`).join(" ");
    const y30 = (46 - 30000 / maxGrafico * 42).toFixed(1);
    const fw = document.getElementById("diagFirmwareCard");
    const segundos = Number(d.uptime ?? agv.uptime ?? sistema.uptime);
    if (fw) ui.trocarHtml(fw, `
        <div class="card-header"><h2>Firmware</h2><span class="pilula mono">${escaparHtml(sistema.versao || "--")}</span></div>
        <dl class="lista-dl">
            <dt>Ligado há</dt><dd class="mono">${agv.online && Number.isFinite(segundos) ? ui.duracao(segundos) : "--"}</dd>
            <dt>Último reinício</dt><dd>${escaparHtml(d.reinicio || "--")}</dd>
            <dt>Hardware</dt><dd>${escaparHtml(sistema.hardware || "--")}</dd>
        </dl>
        <div class="medidor" style="margin-top:14px">
            <div class="medidor-topo"><span>Memória livre</span><span>${Number.isFinite(heap) ? Math.round(heap / 1024) + " KB" : "--"} <span class="suave">${Number.isFinite(heapMin) ? `(mín. ${Math.round(heapMin / 1024)} KB)` : ""}</span></span></div>
            <div class="barra-progresso"><div style="width:${heapPct}%;background:${heap < 40000 ? "var(--amber)" : "var(--green)"}"></div></div>
        </div>
        <div class="medidor" style="margin-top:14px">
            <div class="medidor-topo"><span>Tempo de cada volta do programa</span><span>${conhecido ? ui.numero((d.loopMedioUs || 0) / 1000, 1) + " ms" : "--"} <span class="suave">${conhecido ? `(máx. ${ui.numero((d.loopMaxUs || 0) / 1000, 0)} ms)` : ""}</span></span></div>
            <svg class="grafico-loop" viewBox="0 0 300 48" preserveAspectRatio="none" role="img" aria-label="Tempo máximo do laço nos últimos minutos">
                <path d="M0 ${y30} H300" stroke="var(--amber)" stroke-dasharray="3 4" stroke-width="1" vector-effect="non-scaling-stroke"></path>
                ${historico.length > 1 ? `<polyline fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" points="${pontos}"></polyline>` : ""}
            </svg>
            <div class="suave" style="font-size:12px;margin-top:4px">Linha tracejada: 30 ms. Picos acontecem nas reconexões; os motores têm relógio próprio e não são afetados.</div>
        </div>`);

    // uso
    const u = d.uso || {};
    const km = Number(u.metros) / 1000;
    const manut = agv.manutencao || { intervaloKm: 50, ultimaKm: 0 };
    const desdeRevisao = Number.isFinite(km) ? Math.max(0, km - (manut.ultimaKm || 0)) : 0;
    const pctRevisao = Math.min(100, desdeRevisao / (manut.intervaloKm || 50) * 100);
    const usoCard = document.getElementById("diagUso");
    const valorUso = (v, f) => conhecido && v !== undefined ? f(v) : "--";
    if (usoCard) ui.trocarHtml(usoCard, `
        <div class="card-header"><h2>Uso e manutenção</h2><span>gravado no AGV</span></div>
        <div class="tiles">
            <div class="tile"><div class="tile-rotulo">Rodado</div><div class="tile-valor">${valorUso(u.metros, m => m >= 1000 ? ui.numero(m / 1000, 1) + " km" : ui.numero(m, 0) + " m")}</div></div>
            <div class="tile"><div class="tile-rotulo">Ligado</div><div class="tile-valor">${valorUso(u.horasLigado, h => ui.numero(h, h < 10 ? 1 : 0) + " h")}</div></div>
            <div class="tile"><div class="tile-rotulo">Energizado</div><div class="tile-valor">${valorUso(u.horasEnergizado, h => ui.numero(h, h < 10 ? 1 : 0) + " h")}</div></div>
            <div class="tile"><div class="tile-rotulo">Missões</div><div class="tile-valor">${valorUso(u.missoes, ui.milhar)}</div></div>
            <div class="tile"><div class="tile-rotulo">Com erro</div><div class="tile-valor">${valorUso(u.missoesErro, ui.milhar)}</div></div>
            <div class="tile"><div class="tile-rotulo">Emergências</div><div class="tile-valor">${valorUso(u.emergencias, ui.milhar)}</div></div>
        </div>
        <div class="editor-bloco" style="margin-top:12px">
            <div class="medidor-topo"><b>Revisão das rodas</b><span>${ui.numero(desdeRevisao, 1)} / ${ui.numero(manut.intervaloKm || 50, 0)} km</span></div>
            <div class="barra-progresso"><div style="width:${pctRevisao}%;background:${pctRevisao >= 85 ? "var(--amber)" : "var(--green)"}"></div></div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px" class="suave">
                <span style="flex:1 1 160px">${pctRevisao >= 100 ? "Revisão vencida." : `Faltam ~${ui.numero(Math.max(0, (manut.intervaloKm || 50) - desdeRevisao), 1)} km.`} ${u.reinicios !== undefined ? `· ${u.reinicios} reinícios no total` : ""}</span>
                <label class="editor-com-unidade" style="width:130px"><input type="number" id="diagIntervaloRevisao" min="1" max="2000" step="1" value="${manut.intervaloKm || 50}" aria-label="Intervalo de revisão"><em>km</em></label>
                <button type="button" class="btn btn-mini" id="diagRevisaoFeita" ${conhecido ? "" : "disabled"}>Revisão feita</button>
            </div>
        </div>`);

    // autoteste
    const at = agv.autoteste;
    const atCard = document.getElementById("diagAutotesteCard");
    if (atCard) {
        const itens = at?.itens || [];
        const okCount = itens.filter(i => i.nivel === "OK" || i.nivel === "INFO").length;
        const resultado = at?.resultado;
        const pilula = !at ? `<span class="pilula cinza">Nunca rodou</span>`
            : resultado === "FALHA" ? `<span class="pilula vermelho">REPROVADO</span>`
            : resultado === "AVISO" ? `<span class="pilula ambar">COM AVISOS ${okCount}/${itens.length}</span>`
            : `<span class="pilula verde">APROVADO ${okCount}/${itens.length}</span>`;
        const nomes = { mcp: "Painel", painel: "Fiação do painel", tca: "I²C", vl53_1: "Distância esq.", vl53_2: "Distância dir.", qtr: "QTR", qtr_calibracao: "Calibração QTR", rfid: "RFID", rfid_ruido: "Ruído RFID", wifi: "Wi-Fi", memoria: "Memória", loop: "Tempo do laço", braco: "Braço", garra: "Garra" };
        const problemas = itens.filter(i => i.nivel === "AVISO" || i.nivel === "FALHA" || i.nivel === "INFO");
        ui.trocarHtml(atCard, `
            <div class="card-header" style="margin-bottom:6px"><h2>Último autoteste</h2>${agv.autotesteRodando ? `<span class="pilula azul">Rodando…</span>` : pilula}</div>
            <div class="suave" style="font-size:13px;margin-bottom:10px">${at ? `${at.recebido ? new Date(at.recebido).toLocaleString("pt-BR") : ""} · firmware ${escaparHtml(at.versao || "--")} · com o AGV ligado há ${ui.duracao(at.uptime)}` : "Confere painel, sensores, Wi-Fi, memória e configuração em 2 segundos, com o AGV parado."}</div>
            <div class="autoteste-itens">${itens.map(i => `<span class="autoteste-item ${i.nivel.toLowerCase()}" title="${escaparHtml(i.detalhe)}">${ui.icone(i.nivel === "OK" ? "ok" : i.nivel === "INFO" ? "info" : "alerta", "icone-p")}${escaparHtml(nomes[i.id] || i.id)}</span>`).join("")}</div>
            ${problemas.length ? `<ul class="autoteste-detalhes" style="margin-top:12px">${problemas.map(i => `<li><b class="${i.nivel === "FALHA" ? "texto-erro" : i.nivel === "AVISO" ? "texto-aviso" : ""}">${escaparHtml(nomes[i.id] || i.id)}</b><span>${escaparHtml(i.detalhe)}</span></li>`).join("")}</ul>` : ""}`);
    }
    const at2 = document.getElementById("diagAtualizado");
    if (at2) at2.textContent = agv.diagnosticoRecebido ? `Atualizado ${tempoRelativo(agv.diagnosticoRecebido)}` : "";
    const btnAuto = document.getElementById("diagAutoteste");
    const btnLeds = document.getElementById("diagTestarLeds");
    const podeTestar = agv.online && canalDisponivel(agv) && !["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO"].includes(agv.estadoMissao);
    if (btnAuto) btnAuto.disabled = !podeTestar || agv.autotesteRodando;
    if (btnLeds) btnLeds.disabled = !podeTestar;
}

async function rodarAutoteste() {
    const agv = agvAtual();
    if (!agv) return;
    if (Number(agv.velocidade) > 0.001) { ui.aviso("Pare o AGV antes do autoteste.", "aviso"); return; }
    const ok = await ui.confirmar({ titulo: "Rodar o autoteste?", texto: "O AGV fica parado por 2 segundos lendo todos os sensores. Mantenha a frente livre.", confirmar: "Rodar" });
    if (!ok) return;
    if (publicar(TOPICOS.comando.autoteste, JSON.stringify({ acao: "INICIAR" }), agv.id)) {
        agv.autotesteRodando = Date.now();
        setTimeout(() => { if (agv.autotesteRodando && Date.now() - agv.autotesteRodando >= 7900) { agv.autotesteRodando = null; ui.aviso("O AGV não respondeu ao autoteste.", "erro"); agendarAtualizacaoTela(); } }, 8000);
        registrarAcaoSite(agv.id, "sistema", "AUTOTESTE_SOLICITADO", "");
        renderizarDiagnostico();
    } else ui.aviso("Não foi possível enviar o comando.", "erro");
}

function testarLeds() {
    const agv = agvAtual();
    if (!agv) return;
    if (publicar(TOPICOS.comando.autoteste, JSON.stringify({ acao: "LEDS" }), agv.id)) {
        ui.aviso("Teste dos LEDs: as duas fitas passam por vermelho, verde, azul e branco. Confira se as cores aparecem nessa ordem; senão, ajuste a ordem das cores em Configurações › LEDs.", "info");
        registrarAcaoSite(agv.id, "sistema", "TESTE_LEDS_SOLICITADO", "");
    } else ui.aviso("Não foi possível enviar o comando.", "erro");
}

function relatorioDiagnostico(agv) {
    const d = agv.diagnostico || {};
    const linhas = [
        `Relatório do AGV ${agv.id} (${agv.nome}) — ${new Date().toLocaleString("pt-BR")}`,
        `Firmware ${agv.sistema?.versao || "--"} · IP ${agv.sistema?.ip || "--"} · ${agv.online ? "online" : "offline"}`,
        `Sinal ${d.rssi ?? "--"} dBm · memória ${d.heap ?? "--"} B (mín. ${d.heapMinimo ?? "--"}) · laço ${d.loopMedioUs ?? "--"} µs (máx. ${d.loopMaxUs ?? "--"})`,
        `Último reinício: ${d.reinicio || "--"} · quedas Wi-Fi ${d.quedasWifi ?? "--"}, MQTT ${d.quedasMqtt ?? "--"}`,
        "", "Componentes:"
    ];
    componentesDiagnostico(agv).forEach(c => linhas.push(`- [${(c.nivel || "?").toUpperCase()}] ${c.nome}: ${c.detalhe} (erros: ${c.contagem})`));
    if (agv.autoteste) {
        linhas.push("", `Autoteste (${agv.autoteste.resultado}):`);
        agv.autoteste.itens.forEach(i => linhas.push(`- [${i.nivel}] ${i.id}: ${i.detalhe}`));
    }
    const u = d.uso || {};
    linhas.push("", `Uso: ${u.metros ?? "--"} m · ${u.horasLigado ?? "--"} h ligado · ${u.missoes ?? "--"} missões (${u.missoesErro ?? "--"} com erro) · ${u.emergencias ?? "--"} emergências · ${u.reinicios ?? "--"} reinícios`);
    return linhas.join("\n");
}

document.getElementById("diagAutoteste")?.addEventListener("click", rodarAutoteste);
document.getElementById("diagTestarLeds")?.addEventListener("click", testarLeds);
document.getElementById("diagCopiar")?.addEventListener("click", () => {
    const agv = agvAtual();
    if (!agv) return;
    const texto = relatorioDiagnostico(agv);
    (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject())
        .then(() => ui.aviso("Relatório copiado.", "sucesso"))
        .catch(() => ui.aviso("Não foi possível copiar automaticamente.", "erro"));
});
document.getElementById("diagUso")?.addEventListener("click", evento => {
    if (evento.target.id !== "diagRevisaoFeita") return;
    const agv = agvAtual();
    const km = Number(agv?.diagnostico?.uso?.metros) / 1000;
    if (!agv || !Number.isFinite(km)) return;
    agv.manutencao = Object.assign({ intervaloKm: 50 }, agv.manutencao, { ultimaKm: km, quando: Date.now() });
    salvarAgvsFrota();
    registrarAcaoSite(agv.id, "sistema", "REVISAO_REGISTRADA", `${ui.numero(km, 1)} km`);
    renderizarDiagnostico();
});
document.getElementById("diagUso")?.addEventListener("change", evento => {
    if (evento.target.id !== "diagIntervaloRevisao") return;
    const agv = agvAtual();
    const v = Number(evento.target.value);
    if (!agv || !(v > 0)) return;
    agv.manutencao = Object.assign({ ultimaKm: 0 }, agv.manutencao, { intervaloKm: v });
    salvarAgvsFrota();
    renderizarDiagnostico();
});


/* ============================================================
   GARRA (estado vindo do ESP)
   ============================================================ */

function atualizarStatusGarraESP() {
    const agv = agvAtual();
    if (!agv || !agv.garra) return;
    const g = agv.garra;
    const barra = document.getElementById("garraBarra");
    const posicao = document.getElementById("garraPosicao");
    const curso = Number(g.curso) || 0;
    if (barra) barra.style.height = curso ? `${Math.max(0, Math.min(100, g.posicao / curso * 100))}%` : "0%";
    document.getElementById("garraBarraRotulo")?.setAttribute("aria-label", `Posição da garra: ${g.posicao ?? "--"} de ${curso || "--"} passos`);
    if (posicao) posicao.innerHTML = g.estado === "NAO_CONFIGURADA" ? `— <span>desativada</span>` : `${g.posicao ?? "--"} <span>/ ${curso || "--"} passos</span>`;
    if (garraMovimentoAtivo) return;
    const estado = document.getElementById("garraEstadoManual");
    const mensagem = document.getElementById("garraMensagem");
    const nomes = { MOVENDO_AVANCAR: "Subindo", MOVENDO_RECUAR: "Descendo", RECUADA: "Embaixo", AVANCADA: "No topo", PARADA: "Parada", NAO_CONFIGURADA: "Desativada" };
    if (estado) {
        estado.className = `pilula ${/MOVENDO/.test(g.estado) ? "azul" : g.estado === "NAO_CONFIGURADA" ? "cinza" : "verde"}`;
        estado.textContent = nomes[g.estado] || g.estado || "--";
    }
    if (mensagem) mensagem.textContent = g.estado === "NAO_CONFIGURADA" ? "Curso da garra não configurado (GARRA_CURSO = 0)." : "Segure o botão para mover a garra.";
}




/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

configurarControleManualGarra();
setInterval(verificarControleManualGarra, 100);

(function iniciarSite() {
    // Volta para o AGV e a tela que estavam abertos
    let telaSalva = null, agvSalvo = null;
    try {
        telaSalva = localStorage.getItem("telaAtual");
        agvSalvo = localStorage.getItem("agvSelecionado");
    } catch (e) { /* sem armazenamento */ }
    if (agvSalvo && agvs[agvSalvo]) agvSelecionado = agvSalvo;
    atualizarIdentificacaoAGV();
    renderizarFrota();
    atualizarPainel();
    atualizarValoresJoystick();
    atualizarRelogio();
    AgvVirtual.ligarBotoes();
    AgvVirtual.retomar();
    try {
        conectarMQTT();
    } catch (erro) {
        // Sem a biblioteca MQTT (offline) o site ainda funciona com AGVs virtuais.
        console.error("MQTT indisponível:", erro);
    }
    setInterval(atualizarRelogio, 1000);
    setInterval(atualizarOnline, 2000);
    const telasValidas = Object.keys(informacoesTelas);
    if (telaSalva && telasValidas.includes(telaSalva) && (!TELAS_DO_AGV.includes(telaSalva) || agvSelecionado)) {
        mudarTela(telaSalva);
    } else {
        mudarTela("frota");
    }
})();
