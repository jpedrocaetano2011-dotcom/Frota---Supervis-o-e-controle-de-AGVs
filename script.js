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

        bateria: 100,
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
                correcao: 0
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

/* ============================================================
   PLANTA
   ============================================================ */

const plantaSalva = localStorage.getItem("plantaAGV");

const planta = plantaSalva
    ? JSON.parse(plantaSalva)
    : {
        pontos: [],
        conexoes: []
    };

const plantaOperacionalSalva =
    localStorage.getItem("plantaAGVOperacional");

const plantaOperacional = plantaOperacionalSalva
    ? JSON.parse(plantaOperacionalSalva)
    : JSON.parse(JSON.stringify(planta));
let agvEmEdicao = null;
let agvSelecionado = null;
let clienteMQTT = null;
let timerMissao = null;
let joystickAtivo = false;
let rotacaoAtiva = false;
let modoEdicaoPlanta = false;
let pontoArrastando = null;
let modoConexoesPlanta = false;
let pontoConexaoOrigem = null;
let conexaoEmConfiguracao = null;
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
    /* ============================================================
   FORMULÁRIOS DA PLANTA
   ============================================================ */

let rfidsEstacaoEmCadastro = [];
let rfidsReferenciaEmCadastro = [];
let pontoEmEdicao = null;
// ============================================================
// EXECUÇÃO DAS MISSÕES
// ============================================================

// Cada AGV possui sua própria execução
const execucoesMissoes = {};

// Simulações gráficas independentes por AGV
const simulacoesAGV = {};

// Velocidade visual da simulação.
// Unidade: aproximadamente % do mapa por segundo.
const VELOCIDADE_SIMULACAO_MAPA = 15;
function salvarAgvsFrota() {
    localStorage.setItem("agvsFrota", JSON.stringify(agvs));
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


function obterExecucaoAGV(agvId) {
    return execucoesMissoes[agvId] || null;
}


function obterPontoAtualDoAGV(agv) {

    if (!agv || !plantaOperacional) {
        return null;
    }

    if (agv.pontoAtual) {

        const ponto = plantaOperacional.pontos.find(
            p => p.id === agv.pontoAtual
        );

        if (ponto) {
            return ponto;
        }
    }

    // Compatibilidade com o sistema antigo
    if (typeof obterPontoEstacaoDoAGV === "function") {

        const ponto = obterPontoEstacaoDoAGV(agv);

        if (ponto) {
            return ponto;
        }
    }

    return null;
}


function atualizarPontoAtualAGV(agv, ponto) {

    if (!agv || !ponto) {
        return;
    }

    agv.pontoAtual = ponto.id;

    // Só estação altera a estação atual
    if (ponto.tipo === "ESTACAO") {
        agv.estacaoAtual = ponto.id;
    }

    if (typeof ponto.x === "number") {
        agv.x = ponto.x;
    }

    if (typeof ponto.y === "number") {
        agv.y = ponto.y;
    }
}

function gerarIdMissao() {

    if (missoes.length === 0) {
        return "M001";
    }

    const numeros =
        missoes
            .map(missao =>
                Number(
                    missao.id.replace("M", "")
                )
            )
            .filter(numero =>
                !Number.isNaN(numero)
            );

    const maior =
        Math.max(...numeros);

    return `M${String(maior + 1).padStart(3, "0")}`;
}
function abrirNovaMissao() {

    missaoEmEdicao = {
        id: gerarIdMissao(),
        nome: "",
        etapas: []
    };

    document.getElementById(
        "painelListaMissoes"
    ).style.display = "none";

    document.getElementById(
        "painelConstrutorMissao"
    ).style.display = "grid";

    document.getElementById(
        "tituloConstrutorMissao"
    ).textContent = "Nova missão";

    document.getElementById(
        "nomeMissao"
    ).value = "";

    renderizarEtapasMissao();
}
function renderizarEtapasMissao() {

    const lista = document.getElementById("listaEtapasMissao");
    const vazio = document.getElementById("estadoVazioMissao");

    if (!lista || !vazio || !missaoEmEdicao) return;

    lista.innerHTML = "";

    if (missaoEmEdicao.etapas.length === 0) {
        vazio.style.display = "flex";
        return;
    }

    vazio.style.display = "none";

    missaoEmEdicao.etapas.forEach((etapa, indice) => {

        const elemento = document.createElement("div");
        elemento.className = "missao-etapa";

        let icone = "⚙️";
        let tipo = "ETAPA";
        let descricao = "Etapa não configurada";

        switch (etapa.tipo) {

            case "IR_PARA":
                icone = "📍";
                tipo = "IR PARA";
                descricao = obterNomeEstacao(etapa.destino);
                break;

            case "AGUARDAR":
                icone = "⏱";
                tipo = "AGUARDAR";
                descricao = `${etapa.tempo} segundos`;
                break;

            case "AGUARDAR_CONFIRMACAO":
                icone = "✋";
                tipo = "AGUARDAR CONFIRMAÇÃO";
                descricao = etapa.mensagem || "Aguardar confirmação";
                break;

            case "CARREGAR":
    icone = "📦";
    tipo = "CARREGAR";
    descricao = "Acionar carregamento";
    break;

            case "DESCARREGAR":
    icone = "📤";
    tipo = "DESCARREGAR";
    descricao = "Descarregamento do kit";
    break;
        }

        elemento.innerHTML = `

            <div class="missao-etapa-icone">
                ${icone}
            </div>

            <div class="missao-etapa-numero">
                ${indice + 1}
            </div>

            <div class="missao-etapa-conteudo">

                <span class="missao-etapa-tipo">
                    ${tipo}
                </span>

                <span class="missao-etapa-descricao">
                    ${descricao}
                </span>

            </div>

            <div class="missao-etapa-acoes">

                <button
                    type="button"
                    title="Editar etapa"
                    onclick="editarEtapaMissao(${indice})"
                >
                    ✎
                </button>

                <button
                    type="button"
                    title="Mover para cima"
                    onclick="moverEtapaMissao(${indice}, -1)"
                >
                    ↑
                </button>

                <button
                    type="button"
                    title="Mover para baixo"
                    onclick="moverEtapaMissao(${indice}, 1)"
                >
                    ↓
                </button>

                <button
                    type="button"
                    class="remover"
                    title="Excluir etapa"
                    onclick="removerEtapaMissao(${indice})"
                >
                    ×
                </button>

            </div>
        `;

        lista.appendChild(elemento);
    });
}
function obterNomeEstacao(id) {

    const ponto =
        planta.pontos.find(
            ponto => ponto.id === id
        );

    if (!ponto) {
        return id || "Estação não encontrada";
    }

    return ponto.nome ||
        ponto.nomeEstacao ||
        ponto.id;
}
function adicionarEtapaMissao() {

    etapaEmEdicao = null;

    abrirModalEtapaMissao();

}
function abrirModalEtapaMissao() {

    const modal =
        document.getElementById(
            "modalEtapaMissao"
        );

    const titulo =
        document.getElementById(
            "tituloModalEtapa"
        );

    const tipo =
        document.getElementById(
            "tipoEtapaMissao"
        );

    const configuracao =
        document.getElementById(
            "configuracaoEtapaMissao"
        );

    if (!modal || !tipo || !configuracao) {
        return;
    }

    titulo.textContent =
        etapaEmEdicao === null
            ? "Adicionar etapa"
            : "Editar etapa";

    tipo.value =
        etapaEmEdicao === null
            ? ""
            : missaoEmEdicao.etapas[
                etapaEmEdicao
            ].tipo;

    configuracao.innerHTML = "";

    modal.hidden = false;

    atualizarConfiguracaoEtapa();
}
function fecharModalEtapaMissao() {

    const modal =
        document.getElementById(
            "modalEtapaMissao"
        );

    if (modal) {
        modal.hidden = true;
    }

    etapaEmEdicao = null;
}
function atualizarConfiguracaoEtapa() {

    const tipo =
        document.getElementById(
            "tipoEtapaMissao"
        )?.value;

    const configuracao =
        document.getElementById(
            "configuracaoEtapaMissao"
        );

    if (!configuracao) {
        return;
    }

    configuracao.innerHTML = "";


    /* ========================================================
       IR PARA
       ======================================================== */

    if (tipo === "IR_PARA") {

        const estacoes =
            planta.pontos.filter(
                ponto =>
                    ponto.tipo === "ESTACAO"
            );

        if (estacoes.length === 0) {

            configuracao.innerHTML = `
                <div class="missao-aviso">
                    Nenhuma estação foi cadastrada
                    na planta.
                </div>
            `;

            return;
        }

        const select =
            document.createElement("select");

        select.id =
            "destinoEtapaMissao";

        select.className =
            "missao-input";


        const opcaoInicial =
            document.createElement("option");

        opcaoInicial.value = "";

        opcaoInicial.textContent =
            "Selecione a estação";

        select.appendChild(
            opcaoInicial
        );


        estacoes.forEach(
            estacao => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    estacao.id;

                option.textContent =
                    obterNomeEstacao(
                        estacao.id
                    );

                select.appendChild(
                    option
                );
            }
        );


        configuracao.innerHTML = `
            <label class="missao-label">
                Destino
            </label>
        `;

        configuracao.appendChild(
            select
        );


        /* ---------------------------------------------
           RECUPERA VALOR DURANTE EDIÇÃO
           --------------------------------------------- */

        if (etapaEmEdicao !== null) {

            const etapa =
                missaoEmEdicao.etapas[
                    etapaEmEdicao
                ];

            select.value =
                etapa.destino || "";
        }

        return;
    }


    /* ========================================================
       AGUARDAR
       ======================================================== */

    if (tipo === "AGUARDAR") {

        configuracao.innerHTML = `

            <label class="missao-label">

                Tempo de espera

                <input
                    type="number"
                    id="tempoEtapaMissao"
                    min="1"
                    step="1"
                    placeholder="Ex.: 5"
                >

                <span>
                    segundos
                </span>

            </label>
        `;


        if (etapaEmEdicao !== null) {

            const etapa =
                missaoEmEdicao.etapas[
                    etapaEmEdicao
                ];

            document.getElementById(
                "tempoEtapaMissao"
            ).value =
                etapa.tempo || "";
        }

        return;
    }


    /* ========================================================
       AGUARDAR CONFIRMAÇÃO
       ======================================================== */

    if (
        tipo ===
        "AGUARDAR_CONFIRMACAO"
    ) {

        configuracao.innerHTML = `

            <label class="missao-label">

                Mensagem para o operador

                <input
                    type="text"
                    id="mensagemEtapaMissao"
                    placeholder="Ex.: Confirmar retirada da carga"
                >

            </label>
        `;


        if (etapaEmEdicao !== null) {

            const etapa =
                missaoEmEdicao.etapas[
                    etapaEmEdicao
                ];

            document.getElementById(
                "mensagemEtapaMissao"
            ).value =
                etapa.mensagem || "";
        }

        return;
    }


    /* ========================================================
       CARREGAR
       ======================================================== */

    if (tipo === "CARREGAR") {

        configuracao.innerHTML = `

            <div class="missao-operacao-info">

                <strong>
                    CARREGAR
                </strong>

                <span>
                    O AGV executará a operação
                    de carregamento.
                </span>

            </div>

        `;

        return;
    }


    /* ========================================================
       DESCARREGAR
       ======================================================== */

    if (tipo === "DESCARREGAR") {

        configuracao.innerHTML = `

            <div class="missao-operacao-info">

                <strong>
                    DESCARREGAR
                </strong>

                <span>
                    O AGV executará a operação
                    de descarregamento.
                </span>

            </div>

        `;

        return;
    }
}
function confirmarEtapaMissao() {

    const tipo =
        document.getElementById(
            "tipoEtapaMissao"
        )?.value;

    if (!tipo) {

        alert(
            "Selecione o tipo de operação."
        );

        return;
    }


    let etapa = {
        tipo: tipo
    };


    /* ========================================================
       IR PARA
       ======================================================== */

    if (tipo === "IR_PARA") {

        const destino =
            document.getElementById(
                "destinoEtapaMissao"
            )?.value;

        if (!destino) {

            alert(
                "Selecione o destino da etapa."
            );

            return;
        }

        etapa.destino = destino;
    }


    /* ========================================================
       AGUARDAR
       ======================================================== */

    if (tipo === "AGUARDAR") {

        const tempo =
            Number(
                document.getElementById(
                    "tempoEtapaMissao"
                )?.value
            );

        if (
            !Number.isFinite(tempo) ||
            tempo <= 0
        ) {

            alert(
                "Informe um tempo de espera válido."
            );

            return;
        }

        etapa.tempo = tempo;
    }


    /* ========================================================
       AGUARDAR CONFIRMAÇÃO
       ======================================================== */

    if (
        tipo ===
        "AGUARDAR_CONFIRMACAO"
    ) {

        const mensagem =
            document.getElementById(
                "mensagemEtapaMissao"
            )?.value.trim();

        if (!mensagem) {

            alert(
                "Informe a mensagem de confirmação."
            );

            return;
        }

        etapa.mensagem = mensagem;
    }


    /* ========================================================
       INSERE OU ALTERA
       ======================================================== */

    if (etapaEmEdicao === null) {

        missaoEmEdicao.etapas.push(
            etapa
        );

    } else {

        missaoEmEdicao.etapas[
            etapaEmEdicao
        ] = etapa;
    }


    fecharModalEtapaMissao();

    renderizarEtapasMissao();
}
function editarEtapaMissao(indice) {

    if (
        !missaoEmEdicao ||
        !missaoEmEdicao.etapas[indice]
    ) {
        return;
    }

    etapaEmEdicao = indice;

    abrirModalEtapaMissao();
}
function moverEtapaMissao(
    indice,
    direcao
) {

    if (!missaoEmEdicao) {
        return;
    }


    const novoIndice =
        indice + direcao;


    if (
        novoIndice < 0 ||
        novoIndice >=
            missaoEmEdicao.etapas.length
    ) {
        return;
    }


    const temp =
        missaoEmEdicao.etapas[indice];


    missaoEmEdicao.etapas[indice] =
        missaoEmEdicao.etapas[novoIndice];


    missaoEmEdicao.etapas[novoIndice] =
        temp;


    renderizarEtapasMissao();
}
function removerEtapaMissao(indice) {

    if (!missaoEmEdicao) {
        return;
    }


    missaoEmEdicao.etapas.splice(
        indice,
        1
    );


    renderizarEtapasMissao();
}
function salvarMissao() {

    if (!missaoEmEdicao) {
        return;
    }


    const nome =
        document.getElementById(
            "nomeMissao"
        ).value.trim();


    if (!nome) {

        alert(
            "Informe um nome para a missão."
        );

        return;
    }


    if (
        missaoEmEdicao.etapas.length === 0
    ) {

        alert(
            "Adicione pelo menos uma etapa."
        );

        return;
    }


    missaoEmEdicao.nome =
        nome;


    const indice =
        missoes.findIndex(
            missao =>
                missao.id ===
                missaoEmEdicao.id
        );


    if (indice >= 0) {

        missoes[indice] =
            JSON.parse(
                JSON.stringify(
                    missaoEmEdicao
                )
            );

    } else {

        missoes.push(
            JSON.parse(
                JSON.stringify(
                    missaoEmEdicao
                )
            )
        );
    }


    localStorage.setItem(
        "missoesAGV",
        JSON.stringify(missoes)
    );


    missaoEmEdicao = null;


    voltarListaMissoes();
}
function voltarListaMissoes() {

    missaoEmEdicao = null;

    document.getElementById(
        "painelConstrutorMissao"
    ).style.display = "none";

    document.getElementById(
        "painelListaMissoes"
    ).style.display = "block";

    renderizarListaMissoes();
}
function renderizarListaMissoes() {

    const lista =
        document.getElementById(
            "listaMissoes"
        );

    if (!lista) {
        return;
    }


    lista.innerHTML = "";


    if (missoes.length === 0) {

        lista.innerHTML = `

            <div class="card missao-vazia">

                <strong>
                    Nenhuma missão cadastrada
                </strong>

                <span>
                    Clique em "+ NOVA MISSÃO"
                    para criar a primeira.
                </span>

            </div>

        `;

        return;
    }


    missoes.forEach(missao => {

        const card =
            document.createElement("div");

        card.className =
            "missao-card";


        const sequencia =
            missao.etapas
                .map((etapa, indice) => {

                    let conteudo = "";


                    if (
                        etapa.tipo ===
                        "IR_PARA"
                    ) {

                        conteudo = `
                            <div class="missao-sequencia-ponto">
                                ${etapa.destino}
                            </div>
                        `;

                    } else if (
                        etapa.tipo ===
                        "AGUARDAR"
                    ) {

                        conteudo = `
                            <div
                                class="missao-sequencia-evento"
                                title="Aguardar ${etapa.tempo}s"
                            >
                                ⏱
                            </div>
                        `;

                    } else if (
                        etapa.tipo ===
                        "AGUARDAR_CONFIRMACAO"
                    ) {

                        conteudo = `
                            <div
                                class="missao-sequencia-evento"
                                title="${etapa.mensagem}"
                            >
                                ✓
                            </div>
                        `;
                    
                    } else if (
    etapa.tipo ===
    "CARREGAR")
 {

    conteudo = `
        <div
            class="missao-sequencia-evento"
            title="Carregar"
        >
            📦
        </div>
    `;

} else if (
    etapa.tipo ===
    "DESCARREGAR"
) {

    conteudo = `
        <div
            class="missao-sequencia-evento"
            title="Descarregar"
        >
            📤
        </div>
    `;
}


                    return `

                        <div class="missao-sequencia-item">

                            ${conteudo}

                            ${
                                indice <
                                missao.etapas.length - 1
                                    ? `<span class="missao-sequencia-seta">→</span>`
                                    : ""
                            }

                        </div>

                    `;
                })
                .join("");


        card.innerHTML = `

            <div class="missao-card-header">

                <div class="missao-card-identificacao">

                    <span class="missao-card-id">
                        ${missao.id}
                    </span>

                    <span class="missao-card-nome">
                        ${missao.nome}
                    </span>

                </div>

                <span class="missao-card-status">
                    CADASTRADA
                </span>

            </div>


            <div class="missao-sequencia">

                ${sequencia}

            </div>


            <div class="missao-card-acoes">

                <button
                    type="button"
                    onclick="editarMissao('${missao.id}')"
                >
                    EDITAR
                </button>

                <button
                    type="button"
                    onclick="duplicarMissao('${missao.id}')"
                >
                    DUPLICAR
                </button>

                <button
                    type="button"
                    class="excluir"
                    onclick="excluirMissao('${missao.id}')"
                >
                    EXCLUIR
                </button>

            </div>

        `;


        lista.appendChild(card);
    });
}
function editarMissao(id) {

    const missao =
        missoes.find(
            missao =>
                missao.id === id
        );

    if (!missao) {
        return;
    }


    missaoEmEdicao =
        JSON.parse(
            JSON.stringify(missao)
        );


    document.getElementById(
        "painelListaMissoes"
    ).style.display = "none";


    document.getElementById(
        "painelConstrutorMissao"
    ).style.display = "grid";


    document.getElementById(
        "tituloConstrutorMissao"
    ).textContent =
        `Editar missão ${missao.id}`;


    document.getElementById(
        "nomeMissao"
    ).value =
        missao.nome;


    renderizarEtapasMissao();
}
function duplicarMissao(id) {

    const missao =
        missoes.find(
            missao =>
                missao.id === id
        );

    if (!missao) {
        return;
    }


    const copia =
        JSON.parse(
            JSON.stringify(missao)
        );


    copia.id =
        gerarIdMissao();


    copia.nome =
        `${copia.nome} - CÓPIA`;


    missoes.push(copia);


    localStorage.setItem(
        "missoesAGV",
        JSON.stringify(missoes)
    );


    renderizarListaMissoes();
}
function excluirMissao(id) {

    const missao =
        missoes.find(
            missao =>
                missao.id === id
        );

    if (!missao) {
        return;
    }


    const confirmar =
        confirm(
            `Deseja excluir a missão ${missao.id} - ${missao.nome}?`
        );


    if (!confirmar) {
        return;
    }


    const indice =
        missoes.findIndex(
            missao =>
                missao.id === id
        );


    missoes.splice(
        indice,
        1
    );


    localStorage.setItem(
        "missoesAGV",
        JSON.stringify(missoes)
    );


    renderizarListaMissoes();
}
document.getElementById(
    "btnNovaMissao"
)?.addEventListener(
    "click",
    abrirNovaMissao
);
document
    .getElementById("tipoEtapaMissao")
    ?.addEventListener(
        "change",
        atualizarConfiguracaoEtapa
    );

document
    .getElementById("btnConfirmarEtapa")
    ?.addEventListener(
        "click",
        confirmarEtapaMissao
    );

document
    .getElementById("btnCancelarEtapa")
    ?.addEventListener(
        "click",
        fecharModalEtapaMissao
    );

document
    .getElementById("btnFecharModalEtapa")
    ?.addEventListener(
        "click",
        fecharModalEtapaMissao
    );


document.getElementById(
    "btnVoltarMissoes"
)?.addEventListener(
    "click",
    voltarListaMissoes
);


document.getElementById(
    "btnCancelarMissao"
)?.addEventListener(
    "click",
    voltarListaMissoes
);


document.getElementById(
    "btnAdicionarEtapa"
)?.addEventListener(
    "click",
    adicionarEtapaMissao
);


document.getElementById(
    "btnSalvarMissao"
)?.addEventListener(
    "click",
    salvarMissao
);
/* ============================================================
   ESTAÇÃO
   ============================================================ */

function abrirFormEstacao() {

    const formulario =
        document.getElementById("formEstacao");

    if (!formulario) return;

    pontoEmEdicao = null;

    formulario.hidden = false;

    document.getElementById("nomeEstacao").value = "";

    rfidsEstacaoEmCadastro = [];

    const botao =
        document.getElementById("cadastrarEstacao");

    if (botao) {
        botao.textContent = "CADASTRAR ESTAÇÃO";
    }

    renderizarRfidsEstacaoCadastro();

    document
        .getElementById("novoRfidEstacao")
        ?.focus();
}


function fecharFormEstacao() {

    const formulario =
        document.getElementById("formEstacao");

    if (!formulario) {
        return;
    }

    formulario.hidden = true;
}


/* ============================================================
   ADICIONAR RFID À ESTAÇÃO
   ============================================================ */

function adicionarRfidEstacao() {

    const input =
        document.getElementById("novoRfidEstacao");

    if (!input) {
        return;
    }

    const rfid =
        input.value.trim();

    if (!rfid) {

        alert("Informe o código RFID.");

        return;
    }

    const rfidExisteNaPlanta =
        planta.pontos.some(
            ponto =>
                obterRfidsPonto(ponto).includes(rfid)
        );

    if (rfidExisteNaPlanta) {

        alert(
            "Este código RFID já está cadastrado na planta."
        );

        return;
    }

    if (rfidsEstacaoEmCadastro.includes(rfid)) {

        alert(
            "Este RFID já foi adicionado à estação."
        );

        return;
    }

    rfidsEstacaoEmCadastro.push(rfid);

    input.value = "";

    renderizarRfidsEstacaoCadastro();

    input.focus();
}


/* ============================================================
   MOSTRAR RFIDS DA ESTAÇÃO DURANTE O CADASTRO
   ============================================================ */

function renderizarRfidsEstacaoCadastro() {

    const lista =
        document.getElementById("listaRfidsEstacao");

    if (!lista) {
        return;
    }

    lista.innerHTML = "";

    if (rfidsEstacaoEmCadastro.length === 0) {

        lista.innerHTML = `
            <div class="empty-state">
                Nenhum RFID adicionado.
            </div>
        `;

        return;
    }

    rfidsEstacaoEmCadastro.forEach(
        (rfid, indice) => {

            const item =
                document.createElement("div");

            item.className =
                "plant-rfid-item";

            item.innerHTML = `
                <span>${rfid}</span>

                <button
    type="button"
    class="btn-remover-rfid"
    data-indice="${indice}"
>
    REMOVER
</button>
            `;

            lista.appendChild(item);
        }
    );
}


/* ============================================================
   REFERÊNCIA
   ============================================================ */

function abrirFormReferencia() {

    const formulario =
        document.getElementById("formReferencia");

    if (!formulario) return;

    pontoEmEdicao = null;

    formulario.hidden = false;

    rfidsReferenciaEmCadastro = [];

    const botao =
        document.getElementById("cadastrarReferencia");

    if (botao) {
        botao.textContent = "CADASTRAR REFERÊNCIA";
    }

    renderizarRfidsReferenciaCadastro();

    document
        .getElementById("novoRfidReferencia")
        ?.focus();
}

function fecharFormReferencia() {

    const formulario =
        document.getElementById("formReferencia");

    if (!formulario) {
        return;
    }

    formulario.hidden = true;
}


/* ============================================================
   ADICIONAR RFID À REFERÊNCIA
   ============================================================ */

function adicionarRfidReferencia() {

    const input =
        document.getElementById("novoRfidReferencia");

    if (!input) {
        return;
    }

    const rfid =
        input.value.trim();

    if (!rfid) {

        alert("Informe o código RFID.");

        return;
    }

    const rfidExisteNaPlanta =
        planta.pontos.some(
            ponto =>
                obterRfidsPonto(ponto).includes(rfid)
        );

    if (rfidExisteNaPlanta) {

        alert(
            "Este código RFID já está cadastrado na planta."
        );

        return;
    }

    if (rfidsReferenciaEmCadastro.includes(rfid)) {

        alert(
            "Este RFID já foi adicionado à referência."
        );

        return;
    }

    rfidsReferenciaEmCadastro.push(rfid);

    input.value = "";

    renderizarRfidsReferenciaCadastro();

    input.focus();
}


/* ============================================================
   MOSTRAR RFIDS DA REFERÊNCIA DURANTE O CADASTRO
   ============================================================ */

function renderizarRfidsReferenciaCadastro() {

    const lista =
        document.getElementById("listaRfidsReferencia");

    if (!lista) {
        return;
    }

    lista.innerHTML = "";

    if (rfidsReferenciaEmCadastro.length === 0) {

        lista.innerHTML = `
            <div class="empty-state">
                Nenhum RFID adicionado.
            </div>
        `;

        return;
    }

    rfidsReferenciaEmCadastro.forEach(
        (rfid, indice) => {

            const item =
                document.createElement("div");

            item.className =
                "plant-rfid-item";

            item.innerHTML = `
                <span>${rfid}</span>

                <button
                    type="button"
                    class="btn-remover-rfid-referencia"
                    data-indice="${indice}"
                >
                    REMOVER
                </button>
            `;

            lista.appendChild(item);
        }
    );
}
document.addEventListener(
    "click",
    function(event) {

        // ====================================================
        // REMOVER RFID DE ESTAÇÃO
        // ====================================================

        const botaoEstacao =
            event.target.closest(".btn-remover-rfid");

        if (botaoEstacao) {

            const indice =
                Number(botaoEstacao.dataset.indice);

            removerRfidEstacao(indice);

            return;
        }


        // ====================================================
        // REMOVER RFID DE REFERÊNCIA
        // ====================================================

        const botaoReferencia =
            event.target.closest(
                ".btn-remover-rfid-referencia"
            );

        if (botaoReferencia) {

            const indice =
                Number(botaoReferencia.dataset.indice);

            removerRfidReferencia(indice);

            return;
        }

    }
);
function removerRfidEstacao(indice) {

    const rfid =
        rfidsEstacaoEmCadastro[indice];

    if (!rfid) {
        return;
    }

    if (rfidEstaEmUsoEmConexao(rfid)) {

        alert(
            `O RFID ${rfid} está sendo utilizado em uma conexão e não pode ser removido.`
        );

        return;
    }

    rfidsEstacaoEmCadastro.splice(
        indice,
        1
    );

    renderizarRfidsEstacaoCadastro();
}
function rfidEstaEmUsoEmConexao(rfid) {

    if (!planta || !Array.isArray(planta.conexoes)) {
        return false;
    }

    return planta.conexoes.some(conexao => {

        if (!conexao.rfids) {
            return false;
        }

        return Object.values(conexao.rfids).some(relacao => {

            if (!relacao) {
                return false;
            }

            return (
                relacao.origem === rfid ||
                relacao.destino === rfid
            );
        });
    });
}

/* ============================================================
   REMOVER RFID DA REFERÊNCIA
   ============================================================ */

function removerRfidReferencia(indice) {

    const rfid =
        rfidsReferenciaEmCadastro[indice];

    if (!rfid) {
        return;
    }

    if (rfidEstaEmUsoEmConexao(rfid)) {

        alert(
            `O RFID ${rfid} está sendo utilizado em uma conexão e não pode ser removido.`
        );

        return;
    }

    rfidsReferenciaEmCadastro.splice(
        indice,
        1
    );

    renderizarRfidsReferenciaCadastro();
}

/* ============================================================
   EDIÇÃO DE PONTO
   ============================================================ */

function abrirEdicaoPonto(id) {

    const ponto =
        planta.pontos.find(
            ponto => ponto.id === id
        );

    if (!ponto) return;

    pontoEmEdicao = id;

    if (ponto.tipo === "ESTACAO") {

        const formulario =
            document.getElementById("formEstacao");

        if (!formulario) return;

        formulario.hidden = false;

        document.getElementById("nomeEstacao").value =
            ponto.nome || "";

        rfidsEstacaoEmCadastro =
            [...obterRfidsPonto(ponto)];

        const botao =
            document.getElementById("cadastrarEstacao");

        if (botao) {
            botao.textContent =
                "SALVAR ALTERAÇÕES";
        }

        renderizarRfidsEstacaoCadastro();

        document
            .getElementById("novoRfidEstacao")
            ?.focus();

        return;
    }

    if (ponto.tipo === "REFERENCIA") {

        const formulario =
            document.getElementById("formReferencia");

        if (!formulario) return;

        formulario.hidden = false;

        rfidsReferenciaEmCadastro =
            [...obterRfidsPonto(ponto)];

        const botao =
            document.getElementById("cadastrarReferencia");

        if (botao) {
            botao.textContent =
                "SALVAR ALTERAÇÕES";
        }

        renderizarRfidsReferenciaCadastro();

        document
            .getElementById("novoRfidReferencia")
            ?.focus();
    }
}



function gerarNovoId(tipo) {
    const prefixo =
        tipo === "ESTACAO"
            ? "E"
            : "R";

    let numero = 1;

    while (
        planta.pontos.some(
            ponto =>
                ponto.id ===
                prefixo +
                numero.toString().padStart(2, "0")
        )
    ) {
        numero++;
    }

    return prefixo +
        numero.toString().padStart(2, "0");
}



function cadastrarEstacao() {

    const nome =
        document
            .getElementById("nomeEstacao")
            .value
            .trim();

    if (!nome) {
        alert("Informe o nome da estação.");
        return;
    }

    if (
        rfidsEstacaoEmCadastro.length === 0
    ) {
        alert("Adicione pelo menos um RFID.");
        return;
    }

    /* ========================================================
       MODO EDIÇÃO
       ======================================================== */

    if (pontoEmEdicao) {

        const ponto =
            planta.pontos.find(
                ponto =>
                    ponto.id === pontoEmEdicao
            );

        if (!ponto) return;

        ponto.nome = nome;

        ponto.rfids =
            [...rfidsEstacaoEmCadastro];

        localStorage.setItem(
            "plantaAGV",
            JSON.stringify(planta)
        );

        pontoEmEdicao = null;
        rfidsEstacaoEmCadastro = [];

        fecharFormEstacao();

        renderizarPontos();

        return;
    }

    /* ========================================================
       NOVO CADASTRO
       ======================================================== */

    const novaEstacao = {

        id: gerarNovoId("ESTACAO"),

        tipo: "ESTACAO",

        nome: nome,

        rfids:
            [...rfidsEstacaoEmCadastro],

        /*
         * Ainda não foi colocada no mapa.
         * O operador irá arrastá-la da lista.
         */
        x: null,
        y: null
    };

    planta.pontos.push(
        novaEstacao
    );

    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );

    fecharFormEstacao();

    rfidsEstacaoEmCadastro = [];

    renderizarPontos();
}
function cadastrarReferencia() {

    if (
        rfidsReferenciaEmCadastro.length === 0
    ) {

        alert("Adicione pelo menos um RFID.");

        return;
    }

    /* ========================================================
       MODO EDIÇÃO
       ======================================================== */

    if (pontoEmEdicao) {

        const ponto =
            planta.pontos.find(
                ponto =>
                    ponto.id === pontoEmEdicao
            );

        if (!ponto) return;

        ponto.rfids =
            [...rfidsReferenciaEmCadastro];

        localStorage.setItem(
            "plantaAGV",
            JSON.stringify(planta)
        );

        pontoEmEdicao = null;
        rfidsReferenciaEmCadastro = [];

        fecharFormReferencia();

        renderizarPontos();

        return;
    }

    /* ========================================================
       NOVO CADASTRO
       ======================================================== */

    const novaReferencia = {

        id: gerarNovoId("REFERENCIA"),

        tipo: "REFERENCIA",

        rfids:
            [...rfidsReferenciaEmCadastro],

        /*
         * Ainda não foi colocada no mapa.
         */
        x: null,
        y: null
    };

    planta.pontos.push(
        novaReferencia
    );

    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );

    fecharFormReferencia();

    rfidsReferenciaEmCadastro = [];

    renderizarPontos();
}
const btnEditarMapa =
    document.getElementById("btnEditarMapa");

btnEditarMapa?.addEventListener(
    "click",
    () => {

        if (modoEdicaoPlanta) {
            salvarMapa();
        } else {
            ativarEdicaoMapa();
        }

    }
);
const btnConexoes =
    document.getElementById("btnConexoes");

btnConexoes?.addEventListener(
    "click",
    ativarConexoesPlanta
);
document.addEventListener(
    "click",
    function(event) {


        if (
    event.target.closest(".btn-excluir-ponto")
) {
const id =
    event.target.closest(".btn-excluir-ponto").dataset.id;


            excluirPonto(id);

        }

    }
);
document.addEventListener("click", function(event) {

    const botao =
        event.target.closest(".btn-editar-ponto");

    if (!botao) {
        return;
    }

    const id =
        botao.dataset.id;

    abrirEdicaoPonto(id);
});

document.addEventListener("dragstart", function(event) {

    if (
        event.target.closest(".btn-editar-ponto") ||
        event.target.closest(".btn-excluir-ponto")
    ) {

        event.preventDefault();

    }
});
const btnCadastrarEstacao =
    document.getElementById("cadastrarEstacao");

const btnCadastrarReferencia =
    document.getElementById("cadastrarReferencia");


btnCadastrarEstacao?.addEventListener(
    "click",
    cadastrarEstacao
);

btnCadastrarReferencia?.addEventListener(
    "click",
    cadastrarReferencia
);
/* ============================================================
   EVENTOS DOS FORMULÁRIOS DA PLANTA
   ============================================================ */

const btnAdicionarEstacao =
    document.getElementById("btnAdicionarEstacao");

const btnAdicionarReferencia =
    document.getElementById("btnAdicionarReferencia");

const fecharFormEstacaoBtn =
    document.getElementById("fecharFormEstacao");

const cancelarFormEstacaoBtn =
    document.getElementById("cancelarFormEstacao");

const fecharFormReferenciaBtn =
    document.getElementById("fecharFormReferencia");

const cancelarFormReferenciaBtn =
    document.getElementById("cancelarFormReferencia");

const btnAdicionarRfidEstacao =
    document.getElementById("adicionarRfidEstacao");

const btnAdicionarRfidReferencia =
    document.getElementById("adicionarRfidReferencia");


/* ============================================================
   ABRIR FORMULÁRIOS
   ============================================================ */

btnAdicionarEstacao?.addEventListener(
    "click",
    abrirFormEstacao
);

btnAdicionarReferencia?.addEventListener(
    "click",
    abrirFormReferencia
);


/* ============================================================
   FECHAR FORMULÁRIO ESTAÇÃO
   ============================================================ */

fecharFormEstacaoBtn?.addEventListener(
    "click",
    fecharFormEstacao
);

cancelarFormEstacaoBtn?.addEventListener(
    "click",
    fecharFormEstacao
);


/* ============================================================
   FECHAR FORMULÁRIO REFERÊNCIA
   ============================================================ */

fecharFormReferenciaBtn?.addEventListener(
    "click",
    fecharFormReferencia
);

cancelarFormReferenciaBtn?.addEventListener(
    "click",
    fecharFormReferencia
);
const fecharFormConexaoBtn =
    document.getElementById(
        "fecharFormConexao"
    );

const cancelarFormConexaoBtn =
    document.getElementById(
        "cancelarFormConexao"
    );

const salvarFormConexaoBtn =
    document.getElementById(
        "salvarFormConexao"
    );

fecharFormConexaoBtn?.addEventListener(
    "click",
    fecharFormConexao
);

cancelarFormConexaoBtn?.addEventListener(
    "click",
    fecharFormConexao
);

salvarFormConexaoBtn?.addEventListener(
    "click",
    salvarConexaoConfigurada
);

document
    .querySelectorAll(
        'input[name="tipoConexao"]'
    )
    .forEach(
        radio => {

            radio.addEventListener(
                "change",
                function() {

                    if (
                        conexaoEmConfiguracao
                    ) {

                        conexaoEmConfiguracao.circulacao =
                            this.value;
                    }

                    atualizarConfiguracaoConexao();
                }
            );
        }
    );

/* ============================================================
   ADICIONAR RFID
   ============================================================ */

btnAdicionarRfidEstacao?.addEventListener(
    "click",
    adicionarRfidEstacao
);

btnAdicionarRfidReferencia?.addEventListener(
    "click",
    adicionarRfidReferencia
);
/* ============================================================
   DESENHAR CONEXÕES
   ============================================================ */

/* ============================================================
   CONEXÕES DA PLANTA
   ============================================================ */


/* ============================================================
   CRIAR SETA DA CONEXÃO
   ============================================================ */

function criarSetaConexao(
    linha,
    angulo,
    percentual
) {
    const seta = document.createElement("span");

    seta.className =
        "plant-connection-arrow";

    seta.textContent = "➤";

    /*
       Linha horizontal
    */
    if (
        linha.classList.contains(
            "conexao-horizontal"
        )
    ) {
        seta.style.left =
            `${percentual}%`;

        seta.style.top =
            "50%";
    }

    /*
       Linha vertical
    */
    else {
        seta.style.left =
            "50%";

        seta.style.top =
            `${percentual}%`;
    }

    seta.style.transform =
        `translate(-50%, -50%) rotate(${-angulo}deg)`;

    /*
       A seta não bloqueia o mouse.
       O evento será recebido pela linha.
    */
    seta.style.pointerEvents =
        "none";

    linha.appendChild(seta);
}


/* ============================================================
   CRIAR LINHA DA CONEXÃO
   ============================================================ */

function criarLinhaConexao(
    pontoA,
    pontoB,
    angulo,
    offset = 0
) {
    const linha =
        document.createElement("div");

    /*
       Verifica se a conexão é horizontal.
       Tolerância de 0.5% para pequenas diferenças.
    */
    const horizontal =
        Math.abs(
            pontoB.y - pontoA.y
        ) <= 0.5;


    /*
       Classe base + orientação
    */
    linha.className =
        "plant-connection-line " +
        (
            horizontal
                ? "conexao-horizontal"
                : "conexao-vertical"
        );


    /*
       Permite interação com o mouse.
    */
    linha.style.pointerEvents =
        "auto";

    linha.style.cursor =
        "pointer";


    /* ========================================================
       CONEXÃO HORIZONTAL
       ======================================================== */

    if (horizontal) {

        linha.style.left =
            `${Math.min(
                pontoA.x,
                pontoB.x
            )}%`;

        linha.style.top =
            `${pontoA.y + offset}%`;

        linha.style.width =
            `${Math.abs(
                pontoB.x - pontoA.x
            )}%`;

        linha.style.height =
            "2px";
    }


    /* ========================================================
       CONEXÃO VERTICAL
       ======================================================== */

    else {

        linha.style.left =
            `${pontoA.x + offset}%`;

        linha.style.top =
            `${Math.min(
                pontoA.y,
                pontoB.y
            )}%`;

        linha.style.width =
            "2px";

        linha.style.height =
            `${Math.abs(
                pontoB.y - pontoA.y
            )}%`;
    }


    /*
       Cria a seta central.
       Nas conexões de mão dupla e dupla faixa
       ela será complementada depois.
    */
    criarSetaConexao(
        linha,
        angulo,
        50
    );


    return linha;
}


/* ============================================================
   CRIAR BOTÃO REMOVER CONEXÃO
   ============================================================ */

function criarBotaoRemoverConexao(
    indice
) {
    const botao =
        document.createElement("button");

    botao.type =
        "button";

    botao.className =
    "btn-remover-conexao-mapa";

    botao.textContent =
        "×";

    botao.title =
        "Remover conexão";


    botao.addEventListener(
        "click",
        function (event) {

            /*
               Impede que o clique no botão
               seja interpretado como clique
               na conexão.
            */
            event.stopPropagation();

            excluirConexao(
                indice
            );
        }
    );


    return botao;
}


/* ============================================================
   RENDERIZAR CONEXÕES
   ============================================================ */

function renderizarConexoes() {

    const camada =
        document.getElementById("conexoesPlanta");

    const camadaPontos =
        document.getElementById("estacoesPlanta");

    if (!camada || !camadaPontos) {
        return;
    }


    // ========================================================
    // LIMPA AS CONEXÕES EXISTENTES
    // ========================================================

    camada.innerHTML = "";


    // ========================================================
    // TOOLTIP DAS CONEXÕES
    // ========================================================

    let tooltip =
        document.getElementById("tooltipConexaoPlanta");

    if (!tooltip) {

        tooltip =
            document.createElement("div");

        tooltip.id =
            "tooltipConexaoPlanta";

        tooltip.className =
            "tooltip-conexao-planta";

        document.body.appendChild(tooltip);
    }


    // ========================================================
    // CONFIGURA HOVER DA CONEXÃO
    // ========================================================

    function configurarHoverConexao(
        elemento,
        conexao,
        pontoA,
        pontoB
    ) {

        elemento.addEventListener(
            "mouseenter",
            function () {

                const circulacao =
                    conexao.circulacao ||
                    "NÃO CONFIGURADA";


                // ------------------------------------------------
                // NOME DO TIPO DE CONEXÃO
                // ------------------------------------------------

                let textoTipo;

                switch (circulacao) {

                    case "MAO_DUPLA":
                        textoTipo = "MÃO DUPLA";
                        break;

                    case "SENTIDO_UNICO":
                        textoTipo = "SENTIDO ÚNICO";
                        break;

                    case "DUPLA_FAIXA":
                        textoTipo = "DUPLA FAIXA";
                        break;

                    default:
                        textoTipo = circulacao;
                        break;
                }


                // ------------------------------------------------
                // RFID ORIGEM → DESTINO
                // ------------------------------------------------

                const relacaoOrigemDestino =
                    conexao.rfids?.origemDestino;


                // ------------------------------------------------
                // RFID DESTINO → ORIGEM
                // ------------------------------------------------

                const relacaoDestinoOrigem =
                    conexao.rfids?.destinoOrigem;


                let html = `
                    <div class="tooltip-conexao-titulo">
                        ${textoTipo}
                    </div>

                    <div class="tooltip-conexao-pontos">
                        ${pontoA.id} ↔ ${pontoB.id}
                    </div>
                `;


                // =================================================
                // MÃO DUPLA
                // =================================================

                if (circulacao === "MAO_DUPLA") {

                    html += `
                        <div class="tooltip-conexao-rfid">
                            <strong>${pontoA.id} → ${pontoB.id}</strong>
                            <span>
                                ${
                                    relacaoOrigemDestino
                                        ? `${relacaoOrigemDestino.origem} → ${relacaoOrigemDestino.destino}`
                                        : "RFID não configurado"
                                }
                            </span>
                        </div>

                        <div class="tooltip-conexao-rfid">
                            <strong>${pontoB.id} → ${pontoA.id}</strong>
                            <span>
                                ${
                                    relacaoDestinoOrigem
                                        ? `${relacaoDestinoOrigem.origem} → ${relacaoDestinoOrigem.destino}`
                                        : "RFID não configurado"
                                }
                            </span>
                        </div>
                    `;
                }


                // =================================================
                // SENTIDO ÚNICO
                // =================================================

                else if (circulacao === "SENTIDO_UNICO") {

                    const origemDestino =
                        conexao.sentidoUnico === "ORIGEM_DESTINO";


                    const relacao =
                        origemDestino
                            ? relacaoOrigemDestino
                            : relacaoDestinoOrigem;


                    const pontoOrigem =
                        origemDestino
                            ? pontoA
                            : pontoB;


                    const pontoDestino =
                        origemDestino
                            ? pontoB
                            : pontoA;


                    html += `
                        <div class="tooltip-conexao-rfid">
                            <strong>
                                ${pontoOrigem.id} → ${pontoDestino.id}
                            </strong>

                            <span>
                                ${
                                    relacao
                                        ? `${relacao.origem} → ${relacao.destino}`
                                        : "RFID não configurado"
                                }
                            </span>
                        </div>
                    `;
                }


                // =================================================
                // DUPLA FAIXA
                // =================================================

                else if (circulacao === "DUPLA_FAIXA") {

                    html += `
                        <div class="tooltip-conexao-rfid">
                            <strong>${pontoA.id} → ${pontoB.id}</strong>
                            <span>
                                ${
                                    relacaoOrigemDestino
                                        ? `${relacaoOrigemDestino.origem} → ${relacaoOrigemDestino.destino}`
                                        : "RFID não configurado"
                                }
                            </span>
                        </div>

                        <div class="tooltip-conexao-rfid">
                            <strong>${pontoB.id} → ${pontoA.id}</strong>
                            <span>
                                ${
                                    relacaoDestinoOrigem
                                        ? `${relacaoDestinoOrigem.origem} → ${relacaoDestinoOrigem.destino}`
                                        : "RFID não configurado"
                                }
                            </span>
                        </div>
                    `;
                }


                tooltip.innerHTML = html;

                tooltip.style.display = "block";
            }
        );


        elemento.addEventListener(
            "mousemove",
            function (event) {

                tooltip.style.left =
                    `${event.clientX + 15}px`;

                tooltip.style.top =
                    `${event.clientY + 15}px`;
            }
        );


        elemento.addEventListener(
            "mouseleave",
            function () {

                tooltip.style.display =
                    "none";
            }
        );
    }


    // ========================================================
    // DESENHA TODAS AS CONEXÕES
    // ========================================================

    planta.conexoes.forEach(
    function (conexao, indice) {

            // ----------------------------------------------------
            // LOCALIZA OS PONTOS
            // ----------------------------------------------------

            const pontoA =
                planta.pontos.find(
                    ponto =>
                        ponto.id === conexao.origem
                );


            const pontoB =
                planta.pontos.find(
                    ponto =>
                        ponto.id === conexao.destino
                );


            if (!pontoA || !pontoB) {
                return;
            }


            // ----------------------------------------------------
            // TIPO DE CONEXÃO
            // ----------------------------------------------------

            const tipo =
                conexao.circulacao ||
                "MAO_DUPLA";


            // ----------------------------------------------------
            // ÂNGULOS
            // ----------------------------------------------------

            const anguloOrigemDestino =
                Number(
                    conexao.anguloOrigemDestino ?? 0
                );


            const anguloDestinoOrigem =
                Number(
                    conexao.anguloDestinoOrigem ??
                    (anguloOrigemDestino + 180)
                );


            // ====================================================
            // MÃO DUPLA
            // ====================================================

            if (tipo === "MAO_DUPLA") {

                const linha =
                    criarLinhaConexao(
                        pontoA,
                        pontoB,
                        anguloOrigemDestino
                    );


                // Remove a seta automática criada
                linha.innerHTML = "";


                // Seta A → B
                criarSetaConexao(
                    linha,
                    anguloOrigemDestino,
                    35
                );


                // Seta B → A
                criarSetaConexao(
                    linha,
                    anguloDestinoOrigem,
                    65
                );


                configurarHoverConexao(
                    linha,
                    conexao,
                    pontoA,
                    pontoB
                );


                camada.appendChild(linha);

/* -------------------------------------------------
   BOTÃO EXCLUIR CONEXÃO
   ------------------------------------------------- */

if (
    modoEdicaoPlanta &&
    !modoConexoesPlanta
) {

    const botao =
        criarBotaoRemoverConexao(
            indice
        );

    botao.style.left =
        `${(pontoA.x + pontoB.x) / 2}%`;

    botao.style.top =
        `${(pontoA.y + pontoB.y) / 2}%`;

    camadaPontos.appendChild(
        botao
    );
}

return;
            }


            // ====================================================
            // SENTIDO ÚNICO
            // ====================================================

            if (tipo === "SENTIDO_UNICO") {

                const linha =
                    criarLinhaConexao(
                        pontoA,
                        pontoB,
                        anguloOrigemDestino
                    );


                linha.innerHTML = "";


                const anguloSeta =
                    conexao.sentidoUnico ===
                    "ORIGEM_DESTINO"

                        ? anguloOrigemDestino

                        : anguloDestinoOrigem;


                criarSetaConexao(
                    linha,
                    anguloSeta,
                    50
                );


                configurarHoverConexao(
                    linha,
                    conexao,
                    pontoA,
                    pontoB
                );


                camada.appendChild(linha);

/* -------------------------------------------------
   BOTÃO EXCLUIR CONEXÃO
   ------------------------------------------------- */

if (
    modoEdicaoPlanta &&
    !modoConexoesPlanta
) {

    const botao =
        criarBotaoRemoverConexao(
            indice
        );

    botao.style.left =
        `${(pontoA.x + pontoB.x) / 2}%`;

    botao.style.top =
        `${(pontoA.y + pontoB.y) / 2}%`;

    camadaPontos.appendChild(
        botao
    );
}

return;
            }


            // ====================================================
            // DUPLA FAIXA
            // ====================================================

            if (tipo === "DUPLA_FAIXA") {

                // -----------------------------------------------
                // FAIXA A → B
                // -----------------------------------------------

                const linhaIda =
                    criarLinhaConexao(
                        pontoA,
                        pontoB,
                        anguloOrigemDestino,
                        -1
                    );


                // -----------------------------------------------
                // FAIXA B → A
                // -----------------------------------------------

                const linhaVolta =
                    criarLinhaConexao(
                        pontoA,
                        pontoB,
                        anguloDestinoOrigem,
                        1
                    );


                linhaIda.innerHTML = "";
                linhaVolta.innerHTML = "";


                // Seta A → B
                criarSetaConexao(
                    linhaIda,
                    anguloOrigemDestino,
                    50
                );


                // Seta B → A
                criarSetaConexao(
                    linhaVolta,
                    anguloDestinoOrigem,
                    50
                );


                configurarHoverConexao(
                    linhaIda,
                    conexao,
                    pontoA,
                    pontoB
                );


                configurarHoverConexao(
                    linhaVolta,
                    conexao,
                    pontoA,
                    pontoB
                );


                camada.appendChild(linhaIda);
camada.appendChild(linhaVolta);

/* -------------------------------------------------
   BOTÃO EXCLUIR CONEXÃO
   ------------------------------------------------- */

if (
    modoEdicaoPlanta &&
    !modoConexoesPlanta
) {

    const botao =
        criarBotaoRemoverConexao(
            indice
        );

    botao.style.left =
        `${(pontoA.x + pontoB.x) / 2}%`;

    botao.style.top =
        `${(pontoA.y + pontoB.y) / 2}%`;

    camadaPontos.appendChild(
        botao
    );
}

return;
            }
        }
    );
}

/* ============================================================
   LISTA DE CONEXÕES
   ============================================================ */

function renderizarListaConexoes() {

    const lista =
        document.getElementById(
            "listaConexoes"
        );

    const contador =
        document.getElementById(
            "contadorConexoes"
        );

    if (!lista || !contador) {
        return;
    }

    contador.textContent =
        planta.conexoes.length;

    lista.innerHTML = "";

    if (
        planta.conexoes.length === 0
    ) {

        lista.innerHTML = `
            <div class="empty-state">
                Nenhuma conexão cadastrada.
            </div>
        `;

        return;
    }

    planta.conexoes.forEach(
        (conexao, indice) => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "plant-connection-item";

            const circulacao =
                conexao.circulacao ||
                "NÃO CONFIGURADA";

            const seta =
                circulacao ===
                    "SENTIDO_UNICO"
                    ? (
                        conexao.sentidoUnico ===
                        "ORIGEM_DESTINO"
                            ? "→"
                            : "←"
                    )
                    : "↔";

            item.innerHTML = `

                <div>

                    <div class="plant-connection-points">

                        <strong>
                            ${conexao.origem}
                        </strong>

                        <span>
                            ${seta}
                        </span>

                        <strong>
                            ${conexao.destino}
                        </strong>

                    </div>

                    <div class="plant-connection-details">

                        <span>
                            ${circulacao}
                        </span>

                        <span>
                            ${conexao.anguloOrigemDestino ?? "--"}°
                            /
                            ${conexao.anguloDestinoOrigem ?? "--"}°
                        </span>

                    </div>

                </div>

                <button
                    type="button"
                    class="btn-excluir-conexao"
                    data-indice="${indice}"
                >
                    EXCLUIR
                </button>
            `;

            lista.appendChild(
                item
            );
        }
    );
}
function excluirConexao(indice) {

    const conexao =
        planta.conexoes[indice];

    if (!conexao) {
        return;
    }

    const confirmar =
        confirm(
            `Deseja excluir a conexão ` +
            `${conexao.origem} ↔ ${conexao.destino}?`
        );

    if (!confirmar) {
        return;
    }

    planta.conexoes.splice(
        indice,
        1
    );

    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );

    renderizarPontos();
}


document.addEventListener(
    "click",
    function(event) {

        const botao =
            event.target.closest(
                ".btn-excluir-conexao"
            );

        if (!botao) {
            return;
        }

        excluirConexao(
            Number(
                botao.dataset.indice
            )
        );
    }
);
function excluirPonto(id) {

    const ponto = planta.pontos.find(
        ponto => ponto.id === id
    );

    if (!ponto) {
        return;
    }

    const confirmar = confirm(
        `Deseja realmente excluir o ponto ${ponto.id}?`
    );

    if (!confirmar) {
        return;
    }

    // Remove o ponto
    planta.pontos = planta.pontos.filter(
        ponto => ponto.id !== id
    );

    // Remove todas as conexões desse ponto
    planta.conexoes = planta.conexoes.filter(
        conexao =>
            conexao.origem !== id &&
            conexao.destino !== id
    );

    // Se esse ponto estava selecionado para criar conexão,
    // limpa a seleção
    if (
        pontoConexaoOrigem &&
        pontoConexaoOrigem.id === id
    ) {
        pontoConexaoOrigem = null;
    }

    // Salva a nova planta
    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );

    // Atualiza a tela
    renderizarPontos();
}
/* ============================================================
   REMOVER PONTO DO MAPA
   ============================================================ */

function removerPontoDoMapa(id) {

    const ponto =
        planta.pontos.find(
            ponto => ponto.id === id
        );

    if (!ponto) {
        return;
    }

    /* --------------------------------------------------------
       VERIFICA SE O PONTO POSSUI CONEXÕES
       -------------------------------------------------------- */

    const possuiConexoes =
        planta.conexoes.some(
            conexao =>
                conexao.origem === id ||
                conexao.destino === id
        );

    /* --------------------------------------------------------
       CONFIRMA A REMOÇÃO DAS CONEXÕES
       -------------------------------------------------------- */

    if (possuiConexoes) {

        const confirmar =
            confirm(
                `O ponto ${ponto.id} possui conexões.\n\n` +
                `Ao removê-lo do mapa, essas conexões também serão removidas.\n\n` +
                `Deseja continuar?`
            );

        if (!confirmar) {
            return;
        }

        planta.conexoes =
            planta.conexoes.filter(
                conexao =>
                    conexao.origem !== id &&
                    conexao.destino !== id
            );
    }

    /* --------------------------------------------------------
       REMOVE APENAS A POSIÇÃO DO MAPA
       -------------------------------------------------------- */

    ponto.x = null;
    ponto.y = null;

    /* --------------------------------------------------------
       LIMPA SELEÇÃO DE CONEXÃO, SE NECESSÁRIO
       -------------------------------------------------------- */

    if (
        pontoConexaoOrigem &&
        pontoConexaoOrigem.id === id
    ) {
        pontoConexaoOrigem = null;
    }

    /* --------------------------------------------------------
       SALVA A PLANTA EM EDIÇÃO
       -------------------------------------------------------- */

    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );

    /* --------------------------------------------------------
       ATUALIZA O MAPA
       -------------------------------------------------------- */

    renderizarPontos();
}

function renderizarPontos() {

    const listaEstacoes =
        document.getElementById("listaEstacoes");

    const listaReferencias =
        document.getElementById("listaReferencias");

    const mapa =
        document.getElementById("estacoesPlanta");

    const contadorEstacoes =
        document.getElementById("contadorEstacoes");

    const contadorReferencias =
        document.getElementById("contadorReferencias");


    if (
        !listaEstacoes ||
        !listaReferencias ||
        !mapa ||
        !contadorEstacoes ||
        !contadorReferencias
    ) {
        return;
    }


    /* ========================================================
       SEPARA OS PONTOS POR TIPO
       ======================================================== */

    const estacoes =
        planta.pontos.filter(
            ponto => ponto.tipo === "ESTACAO"
        );


    const referencias =
        planta.pontos.filter(
            ponto => ponto.tipo === "REFERENCIA"
        );


    /* ========================================================
       ATUALIZA OS CONTADORES
       ======================================================== */

    contadorEstacoes.textContent =
        estacoes.length;


    contadorReferencias.textContent =
        referencias.length;


    /* ========================================================
       LIMPA AS LISTAS
       ======================================================== */

    listaEstacoes.innerHTML = "";

    listaReferencias.innerHTML = "";


        /* ========================================================
       LISTA DE ESTAÇÕES
       ======================================================== */

    if (estacoes.length === 0) {

        listaEstacoes.innerHTML = `
            <div class="empty-state">
                Nenhuma estação cadastrada.
            </div>
        `;

    } else {

        estacoes.forEach(estacao => {

            const item = document.createElement("div");

item.className = "station-item";

item.draggable = true;

item.dataset.id = estacao.id;
item.addEventListener(
    "dragstart",
    iniciarArrasteLista
);

item.addEventListener(
    "dragend",
    () => {
        item.classList.remove("arrastando");
    }
);

item.innerHTML = `
    <div class="station-info">

        <strong>${estacao.id}</strong>

        <span>${estacao.nome}</span>

        <small>
            ${obterRfidsPonto(estacao).join(", ")}
        </small>

        <small>
            ESTAÇÃO
        </small>

    </div>

    <div class="station-actions">

        <button
            type="button"
            class="btn-editar-ponto"
            data-id="${estacao.id}"
        >
            EDITAR
        </button>

        <button
            type="button"
            class="btn-excluir-ponto"
            data-id="${estacao.id}"
        >
            EXCLUIR
        </button>

    </div>
`;
            listaEstacoes.appendChild(item);

        });

    }


    /* ========================================================
       LISTA DE REFERÊNCIAS
       ======================================================== */

    if (referencias.length === 0) {

        listaReferencias.innerHTML = `
            <div class="empty-state">
                Nenhuma referência cadastrada.
            </div>
        `;

    } else {

        referencias.forEach(referencia => {

            const item = document.createElement("div");

item.className = "station-item";

item.draggable = true;

item.dataset.id = referencia.id;
item.addEventListener(
    "dragstart",
    iniciarArrasteLista
);

item.addEventListener(
    "dragend",
    () => {
        item.classList.remove("arrastando");
    }
);

item.innerHTML = `
    <div class="station-info">

        <strong>${referencia.id}</strong>

        <span>
            RFID: ${obterRfidsPonto(referencia).join(", ")}
        </span>

        <small>
            REFERÊNCIA
        </small>

    </div>

    <div class="station-actions">

        <button
            type="button"
            class="btn-editar-ponto"
            data-id="${referencia.id}"
        >
            EDITAR
        </button>

        <button
            type="button"
            class="btn-excluir-ponto"
            data-id="${referencia.id}"
        >
            EXCLUIR
        </button>

    </div>
`;

            listaReferencias.appendChild(item);

        });

    }
    /* ========================================================
       RENDERIZAÇÃO DOS PONTOS NO MAPA
       ======================================================== */

    mapa.innerHTML = "";


    planta.pontos.forEach(ponto => {

        if (
            ponto.x === null ||
            ponto.y === null
        ) {
            return;
        }


        const elemento =
            document.createElement("div");


        elemento.className =
            ponto.tipo === "ESTACAO"
                ? "plant-station"
                : "plant-reference";


        elemento.dataset.id =
            ponto.id;
    if (
    modoEdicaoPlanta &&
    !modoConexoesPlanta
) {    

    elemento.addEventListener(
        "pointerdown",
        iniciarArrastePonto
    );

    elemento.addEventListener(
        "pointermove",
        moverPonto
    );

    elemento.addEventListener(
        "pointerup",
        finalizarArrastePonto
    );

}

if (modoConexoesPlanta) {

    elemento.addEventListener(
        "click",
        selecionarPontoConexao
    );

}


        elemento.style.left =
            `${ponto.x}%`;


        elemento.style.top =
            `${ponto.y}%`;
        elemento.innerHTML = `
    <span>${ponto.id}</span>
`;

if (
    modoEdicaoPlanta &&
    !modoConexoesPlanta
) {

    const botaoRemover =
        document.createElement("button");

    botaoRemover.type = "button";

    botaoRemover.className =
        "btn-remover-ponto-mapa";

    botaoRemover.dataset.id =
        ponto.id;

    botaoRemover.textContent = "×";

    botaoRemover.addEventListener(
        "pointerdown",
        event => {
            event.stopPropagation();
        }
    );

    botaoRemover.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            removerPontoDoMapa(
                ponto.id
            );
        }
    );

    elemento.appendChild(
        botaoRemover
    );
}

mapa.appendChild(elemento);

    });
renderizarConexoes();
renderizarListaConexoes();
}
function renderizarMapaVisaoGeral() {

    const containerPontos = document.getElementById("pontosMapaVisaoGeral");
    const containerConexoes = document.getElementById("conexoesMapaVisaoGeral");

    if (!containerPontos || !containerConexoes) return;

    containerPontos.innerHTML = "";
    containerConexoes.innerHTML = "";

    if (
        !plantaOperacional ||
        !Array.isArray(plantaOperacional.pontos) ||
        !Array.isArray(plantaOperacional.conexoes)
    ) {
        return;
    }

    /* ============================================================
       PONTOS DA PLANTA
       ============================================================ */

    plantaOperacional.pontos.forEach(ponto => {

        if (ponto.x === null || ponto.y === null) return;

        const elemento = document.createElement("div");

        if (ponto.tipo === "ESTACAO") {
            elemento.className = "plant-station";
        } else {
            elemento.className = "plant-reference";
        }

        elemento.style.left = `${ponto.x}%`;
        elemento.style.top = `${ponto.y}%`;

        elemento.innerHTML = `
            <span>${ponto.id}</span>
        `;

        containerPontos.appendChild(elemento);
    });


    /* ============================================================
       CONEXÕES DA PLANTA
       ============================================================ */

    plantaOperacional.conexoes.forEach(conexao => {

        const pontoA = plantaOperacional.pontos.find(
            ponto => ponto.id === conexao.origem
        );

        const pontoB = plantaOperacional.pontos.find(
            ponto => ponto.id === conexao.destino
        );

        if (!pontoA || !pontoB) return;

        if (
            pontoA.x === null ||
            pontoA.y === null ||
            pontoB.x === null ||
            pontoB.y === null
        ) {
            return;
        }

        const angulo = conexao.anguloOrigemDestino;

        /* ========================================================
           DUPLA FAIXA
           ======================================================== */

        if (conexao.circulacao === "DUPLA_FAIXA") {

            criarLinhaConexaoVisaoGeral(
                pontoA,
                pontoB,
                angulo,
                -0.8,
                containerConexoes
            );

            criarLinhaConexaoVisaoGeral(
                pontoA,
                pontoB,
                angulo,
                0.8,
                containerConexoes
            );

            criarSetaConexaoVisaoGeral(
                pontoA,
                pontoB,
                angulo,
                65,
                containerConexoes
            );

            criarSetaConexaoVisaoGeral(
                pontoB,
                pontoA,
                conexao.anguloDestinoOrigem,
                65,
                containerConexoes
            );

            return;
        }


        /* ========================================================
           SENTIDO ÚNICO
           ======================================================== */

        if (conexao.circulacao === "SENTIDO_UNICO") {

            criarLinhaConexaoVisaoGeral(
                pontoA,
                pontoB,
                angulo,
                0,
                containerConexoes
            );

            if (conexao.sentidoUnico === "ORIGEM_DESTINO") {

                criarSetaConexaoVisaoGeral(
                    pontoA,
                    pontoB,
                    conexao.anguloOrigemDestino,
                    65,
                    containerConexoes
                );

            } else {

                criarSetaConexaoVisaoGeral(
                    pontoB,
                    pontoA,
                    conexao.anguloDestinoOrigem,
                    65,
                    containerConexoes
                );
            }

            return;
        }


        /* ========================================================
           MÃO DUPLA
           ======================================================== */

        criarLinhaConexaoVisaoGeral(
            pontoA,
            pontoB,
            angulo,
            0,
            containerConexoes
        );

        criarSetaConexaoVisaoGeral(
            pontoA,
            pontoB,
            conexao.anguloOrigemDestino,
            65,
            containerConexoes
        );

        criarSetaConexaoVisaoGeral(
            pontoB,
            pontoA,
            conexao.anguloDestinoOrigem,
            35,
            containerConexoes
        );
    });


    /* ============================================================
       AGV SELECIONADO
       ============================================================ */

    renderizarAGVMapaVisaoGeral();
}
function criarLinhaConexaoVisaoGeral(
    pontoA,
    pontoB,
    angulo,
    offset = 0,
    container
) {

    const linha = document.createElement("div");

    linha.className = "plant-connection-line";

    const x1 = pontoA.x;
    const y1 = pontoA.y;

    const x2 = pontoB.x;
    const y2 = pontoB.y;

    if (
        Math.abs(y1 - y2) < 0.5
    ) {

        const esquerda = Math.min(x1, x2);
        const largura = Math.abs(x2 - x1);

        linha.style.left = `${esquerda}%`;
        linha.style.top = `calc(${y1}% + ${offset}px)`;
        linha.style.width = `${largura}%`;
        linha.style.height = "2px";

    } else {

        const topo = Math.min(y1, y2);
        const altura = Math.abs(y2 - y1);

        linha.style.left = `calc(${x1}% + ${offset}px)`;
        linha.style.top = `${topo}%`;
        linha.style.width = "2px";
        linha.style.height = `${altura}%`;
    }

    container.appendChild(linha);
}
function criarSetaConexaoVisaoGeral(
    pontoA,
    pontoB,
    angulo,
    percentual,
    container
) {

    const seta = document.createElement("div");

    seta.className = "plant-connection-arrow";

    const x = pontoA.x + (pontoB.x - pontoA.x) * (percentual / 100);
    const y = pontoA.y + (pontoB.y - pontoA.y) * (percentual / 100);

    seta.style.left = `${x}%`;
    seta.style.top = `${y}%`;

    seta.style.transform = `translate(-50%, -50%) rotate(${-angulo}deg)`;

    container.appendChild(seta);
}
function renderizarAGVMapaVisaoGeral() {

    const container =
        document.getElementById("agvsMapaVisaoGeral");

    if (!container) {
        return;
    }


    if (!agvSelecionado) {

        container.innerHTML = "";

        return;
    }


    const agv =
        agvs[agvSelecionado];


    if (!agv) {
        return;
    }


    if (
        typeof agv.x !== "number" ||
        typeof agv.y !== "number"
    ) {
        return;
    }


    // --------------------------------------------------------
    // Procura AGV já desenhado
    // --------------------------------------------------------

    let elemento =
        container.querySelector(".mapa-agv");


    // --------------------------------------------------------
    // Cria somente se ainda não existir
    // --------------------------------------------------------

    if (!elemento) {

        elemento =
            document.createElement("div");


        elemento.className =
            "mapa-agv selecionado";


        elemento.innerHTML = `

            <div class="mapa-agv-corpo">

                <div class="mapa-agv-frente"></div>

                <div class="mapa-agv-cabeca">
                    AGV
                </div>

                <div class="mapa-agv-id"></div>

            </div>

        `;


        elemento.addEventListener(
            "click",
            () => selecionarAGV(agv.id)
        );


        container.appendChild(elemento);
    }


    // --------------------------------------------------------
    // Atualiza dados
    // --------------------------------------------------------

    elemento.dataset.id =
        agv.id;


    elemento.style.left =
        `${agv.x}%`;


    elemento.style.top =
        `${agv.y}%`;


    const elementoId =
        elemento.querySelector(".mapa-agv-id");


    if (elementoId) {

        elementoId.textContent =
            agv.id;
    }
}
/* ============================================================
   MODO DE EDIÇÃO DA PLANTA
   ============================================================ */

function ativarEdicaoMapa() {

    /* =========================================
       SE JÁ ESTÁ EDITANDO:
       O BOTÃO AGORA É "SALVAR MAPA"
       ========================================= */

    if (modoEdicaoPlanta) {

        salvarMapa();

        return;
    }


    /* =========================================
       ENTRAR NO MODO DE EDIÇÃO
       ========================================= */

    modoEdicaoPlanta = true;
    modoConexoesPlanta = false;
    pontoConexaoOrigem = null;


    const mapa =
        document.getElementById("mapaPlanta");

    const botao =
        document.getElementById("btnEditarMapa");

    const botaoConexoes =
        document.getElementById("btnConexoes");

    const modo =
        document.getElementById("modoPlanta");


    if (!mapa || !botao) {
        return;
    }


    /* =========================================
       MAPA
       ========================================= */

    mapa.classList.add(
        "modo-edicao"
    );

    mapa.classList.remove(
        "modo-conexoes"
    );


    /* =========================================
       BOTÃO PRINCIPAL
       ========================================= */

    botao.textContent =
        "SALVAR MAPA";


    /* =========================================
       BOTÃO CONEXÕES
       ========================================= */

    if (botaoConexoes) {

        botaoConexoes.disabled = false;

        botaoConexoes.textContent =
            "CONEXÕES";

    }


    /* =========================================
       TEXTO DO MODO
       ========================================= */

    if (modo) {

        modo.textContent =
            "EDITANDO MAPA";

    }


    renderizarPontos();
}
/* ============================================================
   MODO DE CONEXÕES
   ============================================================ */

function ativarConexoesPlanta() {

    /*
     * CONEXÕES só pode ser ativado
     * dentro do modo de edição.
     */

    if (!modoEdicaoPlanta) {
        return;
    }

    modoConexoesPlanta =
        !modoConexoesPlanta;

    pontoConexaoOrigem = null;

    const mapa =
        document.getElementById("mapaPlanta");

    const botao =
        document.getElementById("btnConexoes");

    const modo =
        document.getElementById("modoPlanta");

    if (!mapa || !botao) {
        return;
    }

    mapa.classList.toggle(
        "modo-conexoes",
        modoConexoesPlanta
    );

    botao.textContent =
        modoConexoesPlanta
            ? "SAIR DAS CONEXÕES"
            : "CONEXÕES";

    if (modo) {

        modo.textContent =
            modoConexoesPlanta
                ? "EDITANDO CONEXÕES"
                : "EDITANDO MAPA";
    }

    renderizarPontos();
}
/* ============================================================
   SELEÇÃO DE PONTOS PARA CONEXÃO
   ============================================================ */

function selecionarPontoConexao(event) {

    if (!modoConexoesPlanta) {
        return;
    }

    const elemento =
        event.currentTarget;

    const id =
        elemento.dataset.id;

    const ponto =
        planta.pontos.find(
            p => p.id === id
        );

    if (!ponto) {
        return;
    }

    /* PRIMEIRO PONTO */

    if (!pontoConexaoOrigem) {

        pontoConexaoOrigem = ponto;

        elemento.classList.add(
            "conexao-selecionada"
        );

        return;
    }

    /* CLICOU NOVAMENTE NO MESMO PONTO */

    if (
        pontoConexaoOrigem.id === ponto.id
    ) {

        pontoConexaoOrigem = null;

        elemento.classList.remove(
            "conexao-selecionada"
        );

        return;
    }

    /* SEGUNDO PONTO */

    criarConexao(
        pontoConexaoOrigem,
        ponto
    );
}
function obterRfidsPonto(ponto) {
    if (Array.isArray(ponto.rfids)) {
        return ponto.rfids;
    }

    if (ponto.rfid) {
        return [ponto.rfid];
    }

    return [];
}
/* ============================================================
   CRIAÇÃO DE CONEXÃO
   ============================================================ */
function calcularAnguloConexao(pontoA, pontoB) {

    const dx = pontoB.x - pontoA.x;
    const dy = pontoB.y - pontoA.y;

    const tolerancia = 0.5;

    const horizontal =
        Math.abs(dy) <= tolerancia;

    const vertical =
        Math.abs(dx) <= tolerancia;

    if (horizontal) {

        return dx > 0
            ? 0
            : 180;
    }

    if (vertical) {

        return dy < 0
            ? 90
            : 270;
    }

    return null;
}


/* ============================================================
   RFIDS LIVRES
   ============================================================ */

function obterRfidsUsados() {

    const usados = new Set();

    planta.conexoes.forEach(conexao => {

        if (!conexao.rfids) {
            return;
        }

        Object.values(conexao.rfids).forEach(relacao => {

            if (!relacao) {
                return;
            }

            if (relacao.origem) {
                usados.add(relacao.origem);
            }

            if (relacao.destino) {
                usados.add(relacao.destino);
            }

        });

    });

    return usados;
}


function obterRfidsLivresPonto(ponto) {

    return obterRfidsPonto(ponto);

}
function contarRfidsLivresPonto(ponto) {
    return obterRfidsLivresPonto(ponto).length;
}

/* ============================================================
   CRIAÇÃO DE CONEXÃO
   ============================================================ */

function criarConexao(pontoA, pontoB) {

    const dx =
        pontoB.x - pontoA.x;

    const dy =
        pontoB.y - pontoA.y;

    const tolerancia = 0.5;

    const horizontal =
        Math.abs(dy) <= tolerancia;

    const vertical =
        Math.abs(dx) <= tolerancia;

    if (!horizontal && !vertical) {

        alert(
            "Conexão inválida.\n\n" +
            "Os pontos precisam estar " +
            "alinhados horizontalmente " +
            "ou verticalmente."
        );

        pontoConexaoOrigem = null;

        renderizarPontos();

        return;
    }

    const conexaoExiste =
        planta.conexoes.some(
            conexao =>
                (
                    conexao.origem === pontoA.id &&
                    conexao.destino === pontoB.id
                ) ||
                (
                    conexao.origem === pontoB.id &&
                    conexao.destino === pontoA.id
                )
        );

    if (conexaoExiste) {

        alert(
            "Essa conexão já existe."
        );

        pontoConexaoOrigem = null;

        renderizarPontos();

        return;
    }

    const anguloOrigemDestino =
        calcularAnguloConexao(
            pontoA,
            pontoB
        );

    const anguloDestinoOrigem =
        calcularAnguloConexao(
            pontoB,
            pontoA
        );

    conexaoEmConfiguracao = {

        origem: pontoA.id,

        destino: pontoB.id,

        tipo:
            horizontal
                ? "HORIZONTAL"
                : "VERTICAL",

        anguloOrigemDestino:
            anguloOrigemDestino,

        anguloDestinoOrigem:
            anguloDestinoOrigem,

        circulacao: "MAO_DUPLA",

        sentidoUnico:
            "ORIGEM_DESTINO",

        rfids: {

            origemDestino: null,

            destinoOrigem: null

        }

    };

    pontoConexaoOrigem = null;

    renderizarPontos();

    abrirFormConexao();
}
/* ============================================================
   FORMULÁRIO DE CONFIGURAÇÃO DA CONEXÃO
   ============================================================ */

function abrirFormConexao() {

    const formulario =
        document.getElementById("formConexao");

    if (
        !formulario ||
        !conexaoEmConfiguracao
    ) {
        return;
    }

    const pontoA =
        planta.pontos.find(
            ponto =>
                ponto.id ===
                conexaoEmConfiguracao.origem
        );

    const pontoB =
        planta.pontos.find(
            ponto =>
                ponto.id ===
                conexaoEmConfiguracao.destino
        );

    if (!pontoA || !pontoB) {
        return;
    }


    /* ========================================================
       IDENTIFICAÇÃO DOS PONTOS
       ======================================================== */

    document.getElementById(
        "conexaoPontoA"
    ).textContent = pontoA.id;

    document.getElementById(
        "conexaoPontoB"
    ).textContent = pontoB.id;

    document.getElementById(
        "conexaoPontoBResumo"
    ).textContent = pontoB.id;


    /* ========================================================
       ÂNGULOS
       ======================================================== */

    document.getElementById(
        "conexaoAnguloAB"
    ).textContent =
        conexaoEmConfiguracao
            .anguloOrigemDestino + "°";

    document.getElementById(
        "conexaoAnguloBA"
    ).textContent =
        conexaoEmConfiguracao
            .anguloDestinoOrigem + "°";


    /* ========================================================
       RFIDS LIVRES
       ======================================================== */

    const rfidsA =
        obterRfidsLivresPonto(pontoA);

    const rfidsB =
        obterRfidsLivresPonto(pontoB);


    /* ========================================================
       DISPONIBILIDADE
       ======================================================== */

    const disponibilidade =
        document.getElementById(
            "disponibilidadeRfidsConexao"
        );

    if (disponibilidade) {

        disponibilidade.textContent =
            `${pontoA.id}: ${rfidsA.length} RFID(s) livre(s) | ` +
            `${pontoB.id}: ${rfidsB.length} RFID(s) livre(s)`;

        disponibilidade.classList.toggle(
            "rfid-insuficiente",
            rfidsA.length < 1 ||
            rfidsB.length < 1
        );
    }


    /* ========================================================
       VERIFICA DUPLA FAIXA
       ======================================================== */

    const radioDuplaFaixa =
        document.querySelector(
            'input[name="tipoConexao"][value="DUPLA_FAIXA"]'
        );

    const labelDuplaFaixa =
        document.querySelector(
            'label[for="tipoDuplaFaixa"]'
        );

    const duplaFaixaDisponivel =
        rfidsA.length >= 2 &&
        rfidsB.length >= 2;


    if (radioDuplaFaixa) {

        radioDuplaFaixa.disabled =
            !duplaFaixaDisponivel;

        if (
            !duplaFaixaDisponivel &&
            conexaoEmConfiguracao.circulacao ===
                "DUPLA_FAIXA"
        ) {

            conexaoEmConfiguracao.circulacao =
                "MAO_DUPLA";
        }
    }


    if (labelDuplaFaixa) {

        labelDuplaFaixa.classList.toggle(
            "opcao-desabilitada",
            !duplaFaixaDisponivel
        );
    }


    /* ========================================================
       VERIFICA SE EXISTE RFID PARA A CONEXÃO
       ======================================================== */

    if (
        rfidsA.length < 1 ||
        rfidsB.length < 1
    ) {

        if (disponibilidade) {

            disponibilidade.textContent +=
                " — Não há RFID livre suficiente para criar esta conexão.";
        }
    }


    /* ========================================================
       TIPO DA CONEXÃO
       ======================================================== */

    const radioSelecionado =
        document.querySelector(
            `input[name="tipoConexao"][value="${conexaoEmConfiguracao.circulacao}"]`
        );

    if (radioSelecionado) {
        radioSelecionado.checked = true;
    }


    /* ========================================================
       SENTIDO ÚNICO
       ======================================================== */

    document.querySelectorAll(
        'input[name="sentidoUnico"]'
    ).forEach(
        radio => {

            radio.checked =
                radio.value ===
                conexaoEmConfiguracao.sentidoUnico;
        }
    );


    /* ========================================================
       MOSTRA O FORMULÁRIO
       ======================================================== */

    formulario.hidden = false;

    atualizarConfiguracaoConexao();
}


function atualizarConfiguracaoConexao() {

    if (!conexaoEmConfiguracao) {
        return;
    }

    const tipo =
        document.querySelector(
            'input[name="tipoConexao"]:checked'
        )?.value;

    if (!tipo) {
        return;
    }

    conexaoEmConfiguracao.circulacao =
        tipo;

    const blocoSentido =
        document.getElementById(
            "blocoSentidoUnico"
        );

    if (blocoSentido) {

        blocoSentido.hidden =
            tipo !== "SENTIDO_UNICO";
    }

    renderizarRfidsConexao();
}


/* ============================================================
   RFIDS DA CONEXÃO
   ============================================================ */

function criarSelectRfid(
    id,
    label,
    rfids,
    valorSelecionado
) {

    const valor =
        valorSelecionado &&
        rfids.includes(valorSelecionado)
            ? valorSelecionado
            : (rfids[0] || "");

    return `
        <label
            class="conexao-rfid-field"
            for="${id}"
        >
            <span>${label}</span>

            <select
                id="${id}"
                data-rfid-conexao="true"
            >
                <option value="">
                    Selecione
                </option>

                ${rfids.map(rfid => `
                    <option
                        value="${rfid}"
                        ${rfid === valor ? "selected" : ""}
                    >
                        ${rfid}
                    </option>
                `).join("")}

            </select>
        </label>
    `;
}


function renderizarRfidsConexao() {

    const container =
        document.getElementById(
            "rfidConfiguracaoConexao"
        );

    if (
        !container ||
        !conexaoEmConfiguracao
    ) {
        return;
    }

    const pontoA =
        planta.pontos.find(
            ponto =>
                ponto.id ===
                conexaoEmConfiguracao.origem
        );

    const pontoB =
        planta.pontos.find(
            ponto =>
                ponto.id ===
                conexaoEmConfiguracao.destino
        );

    if (!pontoA || !pontoB) {
        return;
    }

    const rfidsA =
        obterRfidsLivresPonto(pontoA);

    const rfidsB =
        obterRfidsLivresPonto(pontoB);

    const tipo =
        conexaoEmConfiguracao.circulacao;

    if (tipo === "DUPLA_FAIXA") {

        container.innerHTML = `

            <div class="conexao-faixa">

                <strong>FAIXA 1 — A → B</strong>

                <div class="conexao-rfid-grid">

                    ${criarSelectRfid(
                        "rfidFaixa1A",
                        pontoA.id,
                        rfidsA,
                        conexaoEmConfiguracao
                            .rfids
                            .origemDestino
                            ?.origem
                    )}

                    ${criarSelectRfid(
                        "rfidFaixa1B",
                        pontoB.id,
                        rfidsB,
                        conexaoEmConfiguracao
                            .rfids
                            .origemDestino
                            ?.destino
                    )}

                </div>

            </div>

            <div class="conexao-faixa">

                <strong>FAIXA 2 — B → A</strong>

                <div class="conexao-rfid-grid">

                    ${criarSelectRfid(
                        "rfidFaixa2B",
                        pontoB.id,
                        rfidsB,
                        conexaoEmConfiguracao
                            .rfids
                            .destinoOrigem
                            ?.origem
                    )}

                    ${criarSelectRfid(
                        "rfidFaixa2A",
                        pontoA.id,
                        rfidsA,
                        conexaoEmConfiguracao
                            .rfids
                            .destinoOrigem
                            ?.destino
                    )}

                </div>

            </div>
        `;

        return;
    }

    container.innerHTML = `

        <div class="conexao-faixa">

            <strong>
                RFID DA CONEXÃO
            </strong>

            <div class="conexao-rfid-grid">

                ${criarSelectRfid(
                    "rfidConexaoA",
                    pontoA.id,
                    rfidsA,
                    conexaoEmConfiguracao
                        .rfids
                        .origemDestino
                        ?.origem
                )}

                ${criarSelectRfid(
                    "rfidConexaoB",
                    pontoB.id,
                    rfidsB,
                    conexaoEmConfiguracao
                        .rfids
                        .origemDestino
                        ?.destino
                )}

            </div>

            <small>
                O mesmo par de RFIDs será utilizado
                nos dois sentidos.
            </small>

        </div>
    `;
}


/* ============================================================
   SALVAR CONEXÃO
   ============================================================ */

function salvarConexaoConfigurada() {

    if (!conexaoEmConfiguracao) {
        return;
    }


    /* ========================================================
       TIPO DA CONEXÃO
       ======================================================== */

    const tipo =
        document.querySelector(
            'input[name="tipoConexao"]:checked'
        )?.value;

    if (!tipo) {

        alert(
            "Selecione o tipo da conexão."
        );

        return;
    }


    /* ========================================================
       LOCALIZA OS PONTOS
       ======================================================== */

    const pontoA =
        planta.pontos.find(
            ponto =>
                ponto.id ===
                conexaoEmConfiguracao.origem
        );

    const pontoB =
        planta.pontos.find(
            ponto =>
                ponto.id ===
                conexaoEmConfiguracao.destino
        );

    if (!pontoA || !pontoB) {
        return;
    }


    /* ========================================================
       RFIDS LIVRES
       ======================================================== */

    const rfidsA =
        obterRfidsLivresPonto(pontoA);

    const rfidsB =
        obterRfidsLivresPonto(pontoB);


    /* ========================================================
       REGRA MÍNIMA
       
       Toda conexão precisa de pelo menos:
       - 1 RFID livre em A
       - 1 RFID livre em B
       ======================================================== */

    if (
        rfidsA.length < 1 ||
        rfidsB.length < 1
    ) {

        alert(
            `Não é possível criar a conexão.\n\n` +
            `${pontoA.id}: ${rfidsA.length} RFID(s) livre(s)\n` +
            `${pontoB.id}: ${rfidsB.length} RFID(s) livre(s)\n\n` +
            `É necessário pelo menos 1 RFID livre em cada ponto.`
        );

        return;
    }


    /* ========================================================
       DUPLA FAIXA
       
       Precisa de:
       - 2 RFIDs em A
       - 2 RFIDs em B
       ======================================================== */

    if (tipo === "DUPLA_FAIXA") {

        if (
            rfidsA.length < 2 ||
            rfidsB.length < 2
        ) {

            alert(
                `Não é possível criar uma conexão de dupla faixa.\n\n` +
                `${pontoA.id}: ${rfidsA.length} RFID(s) livre(s)\n` +
                `${pontoB.id}: ${rfidsB.length} RFID(s) livre(s)\n\n` +
                `São necessários pelo menos 2 RFIDs livres em cada ponto.`
            );

            return;
        }


        const a1 =
            document.getElementById(
                "rfidFaixa1A"
            )?.value;

        const b1 =
            document.getElementById(
                "rfidFaixa1B"
            )?.value;

        const b2 =
            document.getElementById(
                "rfidFaixa2B"
            )?.value;

        const a2 =
            document.getElementById(
                "rfidFaixa2A"
            )?.value;


        if (
            !a1 ||
            !b1 ||
            !b2 ||
            !a2
        ) {

            alert(
                "Selecione os quatro RFIDs da dupla faixa."
            );

            return;
        }


        /* ----------------------------------------------------
           IMPOSSIBILITA REUTILIZAÇÃO NO MESMO PONTO
           ---------------------------------------------------- */

        if (a1 === a2) {

            alert(
                `Os dois sentidos não podem usar ` +
                `o mesmo RFID de ${pontoA.id}.`
            );

            return;
        }


        if (b1 === b2) {

            alert(
                `Os dois sentidos não podem usar ` +
                `o mesmo RFID de ${pontoB.id}.`
            );

            return;
        }


        conexaoEmConfiguracao.rfids = {

            origemDestino: {

                origem: a1,
                destino: b1

            },

            destinoOrigem: {

                origem: b2,
                destino: a2

            }

        };
    }


    /* ========================================================
       MÃO DUPLA / SENTIDO ÚNICO
       ======================================================== */

    else {

        const rfidA =
            document.getElementById(
                "rfidConexaoA"
            )?.value;

        const rfidB =
            document.getElementById(
                "rfidConexaoB"
            )?.value;


        if (
            !rfidA ||
            !rfidB
        ) {

            alert(
                "Selecione os RFIDs dos dois pontos."
            );

            return;
        }


        conexaoEmConfiguracao.rfids = {

            origemDestino: {

                origem: rfidA,
                destino: rfidB

            },

            destinoOrigem: {

                origem: rfidB,
                destino: rfidA

            }

        };
    }


    /* ========================================================
       SENTIDO ÚNICO
       ======================================================== */

    if (tipo === "SENTIDO_UNICO") {

        const sentidoSelecionado =
            document.querySelector(
                'input[name="sentidoUnico"]:checked'
            )?.value;


        if (!sentidoSelecionado) {

            alert(
                "Selecione o sentido da conexão."
            );

            return;
        }


        conexaoEmConfiguracao.sentidoUnico =
            sentidoSelecionado;


        if (
            sentidoSelecionado ===
            "ORIGEM_DESTINO"
        ) {

            conexaoEmConfiguracao.rfids.destinoOrigem =
                null;

        } else {

            conexaoEmConfiguracao.rfids.origemDestino =
                null;
        }

    } else {

        conexaoEmConfiguracao.sentidoUnico =
            null;
    }


    /* ========================================================
       SALVA O TIPO
       ======================================================== */

    conexaoEmConfiguracao.circulacao =
        tipo;


    /* ========================================================
       ADICIONA À PLANTA
       ======================================================== */

    planta.conexoes.push(
        conexaoEmConfiguracao
    );


    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );


    /* ========================================================
       FECHA E ATUALIZA
       ======================================================== */

    fecharFormConexao();

    renderizarPontos();
}


/* ============================================================
   FECHAR FORMULÁRIO
   ============================================================ */

function fecharFormConexao() {

    const formulario =
        document.getElementById(
            "formConexao"
        );

    if (formulario) {
        formulario.hidden = true;
    }

    conexaoEmConfiguracao = null;

    pontoConexaoOrigem = null;
}

function construirGrafoPlanta() {

    const grafo = {};

    plantaOperacional.pontos.forEach(
        ponto => {

            grafo[ponto.id] = [];
        }
    );

    plantaOperacional.conexoes.forEach(
        conexao => {

            const origem =
                conexao.origem;

            const destino =
                conexao.destino;

            const circulacao =
                conexao.circulacao ||
                "MAO_DUPLA";

            /* ---------------------------------------------
               SENTIDO ÚNICO
               --------------------------------------------- */

            if (
                circulacao ===
                "SENTIDO_UNICO"
            ) {

                if (
                    conexao.sentidoUnico ===
                    "ORIGEM_DESTINO"
                ) {

                    grafo[origem].push(
                        destino
                    );

                } else {

                    grafo[destino].push(
                        origem
                    );
                }

                return;
            }

            /* ---------------------------------------------
               MÃO DUPLA / DUPLA FAIXA
               --------------------------------------------- */

            grafo[origem].push(
                destino
            );

            grafo[destino].push(
                origem
            );
        }
    );

    return grafo;
}
function calcularRota(origem, destino) {

    const grafo = construirGrafoPlanta();

    // Verifica se origem e destino existem
    if (
        !grafo[origem] ||
        !grafo[destino]
    ) {
        return null;
    }

    // Se origem e destino forem iguais
    if (origem === destino) {
        return [origem];
    }

    // Fila de pontos que serão visitados
    const fila = [origem];

    // Registra os pontos já visitados
    const visitados = new Set();

    visitados.add(origem);

    // Guarda de onde cada ponto foi alcançado
    const anterior = {};

    // Busca em Largura (BFS)
    while (fila.length > 0) {

        const pontoAtual = fila.shift();

        // Percorre os vizinhos do ponto atual
        for (
            const vizinho of grafo[pontoAtual]
        ) {

            // Ignora pontos já visitados
            if (visitados.has(vizinho)) {
                continue;
            }

            visitados.add(vizinho);

            anterior[vizinho] = pontoAtual;

            // Encontrou o destino
            if (vizinho === destino) {

                const rota = [];
                let ponto = destino;

                // Reconstrói a rota de trás para frente
                while (ponto !== undefined) {

                    rota.unshift(ponto);

                    ponto = anterior[ponto];

                }

                return rota;
            }

            // Adiciona o vizinho à fila
            fila.push(vizinho);
        }
    }

    // Não existe caminho entre origem e destino
    return null;
}
/* ============================================================
   CONEXÃO ENTRE DOIS PONTOS
   ============================================================ */

/* ============================================================
   CONEXÃO ENTRE DOIS PONTOS — PLANTA OPERACIONAL
   ============================================================ */

function obterConexaoEntre(
    pontoA,
    pontoB
) {

    return plantaOperacional.conexoes.find(
        conexao => {

            const mesmaDirecao =
                conexao.origem === pontoA &&
                conexao.destino === pontoB;

            const direcaoContraria =
                conexao.origem === pontoB &&
                conexao.destino === pontoA;

            if (
                !mesmaDirecao &&
                !direcaoContraria
            ) {
                return false;
            }

            if (
                conexao.circulacao ===
                "SENTIDO_UNICO"
            ) {

                if (
                    conexao.sentidoUnico ===
                    "ORIGEM_DESTINO"
                ) {

                    return mesmaDirecao;

                } else {

                    return direcaoContraria;
                }
            }

            return true;
        }
    );
}


/* ============================================================
   ÂNGULO DO SENTIDO DA CONEXÃO
   ============================================================ */

function obterAnguloPercurso(
    conexao,
    pontoA,
    pontoB
) {

    if (
        conexao.origem === pontoA &&
        conexao.destino === pontoB
    ) {

        return conexao
            .anguloOrigemDestino;
    }

    return conexao
        .anguloDestinoOrigem;
}


/* ============================================================
   NORMALIZAR ÂNGULO
   ============================================================ */

function normalizarAngulo(angulo) {

    return (
        (angulo % 360) + 360
    ) % 360;
}


/* ============================================================
   MANOBRA ENTRE DUAS ORIENTAÇÕES
   ============================================================ */

function calcularManobra(anguloEntrada, anguloSaida) {
    const delta =
        normalizarAngulo(anguloSaida - anguloEntrada + 180) - 180;

    if (delta === 0) {
        return null;
    }

    if (delta === 90) {
        return {
            tipo: "ESQUERDA",
            giro: 90
        };
    }

    if (delta === -90) {
        return {
            tipo: "DIREITA",
            giro: -90
        };
    }

    if (Math.abs(delta) === 180) {
        return {
            tipo: "RETORNO",
            giro: 180
        };
    }

    return {
        tipo: "ROTACAO",
        giro: delta
    };
}


/* ============================================================
   GERAR ETAPAS DE UMA ROTA
   ============================================================ */

function gerarEtapasRota(rota, orientacaoInicial = null) {

    if (!Array.isArray(rota) || rota.length < 2) {
        return [];
    }

    const etapas = [];

    for (let i = 0; i < rota.length - 1; i++) {

        const pontoAtual = rota[i];
        const proximoPonto = rota[i + 1];

        const conexao = obterConexaoEntre(
            pontoAtual,
            proximoPonto
        );

        if (!conexao) {
            return null;
        }

        const angulo = obterAnguloPercurso(
            conexao,
            pontoAtual,
            proximoPonto
        );

        etapas.push({
            pontoSaida: pontoAtual,
            pontoChegada: proximoPonto,
            conexao: conexao,
            angulo: normalizarAngulo(angulo),
            manobra: null
        });
    }

    /*
     * PRIMEIRO TRECHO
     *
     * Agora usamos a orientação real/lógica
     * do AGV como entrada.
     */
    if (orientacaoInicial !== null) {

        const primeiraManobra = calcularManobra(
            normalizarAngulo(orientacaoInicial),
            etapas[0].angulo
        );

        etapas[0].manobra = primeiraManobra;
    }

    /*
     * DEMAIS TRECHOS
     *
     * A orientação de entrada passa a ser
     * o ângulo do trecho anterior.
     */
    for (let i = 1; i < etapas.length; i++) {

        const entrada = etapas[i - 1].angulo;
        const saida = etapas[i].angulo;

        etapas[i].manobra =
            calcularManobra(entrada, saida);
    }

    return etapas;
}
function obterPontoEstacaoDoAGV(agv) {

    if (!agv || !agv.estacaoAtual) {
        return null;
    }

    const valor = String(agv.estacaoAtual);

    let ponto = plantaOperacional.pontos.find(
        ponto => ponto.id === valor
    );

    if (ponto) {
        return ponto;
    }

    ponto = plantaOperacional.pontos.find(
        ponto =>
            ponto.tipo === "ESTACAO" &&
            (
                ponto.rfid === valor ||
                (Array.isArray(ponto.rfids) &&
                 ponto.rfids.includes(valor))
            )
    );

    if (ponto) {
        return ponto;
    }

    const numero = valor.replace(/\D/g, "");

    if (numero) {

        ponto = plantaOperacional.pontos.find(
            ponto =>
                ponto.tipo === "ESTACAO" &&
                String(ponto.id)
                    .replace(/\D/g, "") === numero
        );

        if (ponto) {
            return ponto;
        }
    }

    return null;
}
function atualizarEstacaoAGV(agv, ponto) {

    if (!agv || !ponto) {
        return;
    }

    agv.estacaoAtual = ponto.id;

    if (ponto.x !== undefined) {
        agv.x = ponto.x;
    }

    if (ponto.y !== undefined) {
        agv.y = ponto.y;
    }
}
function calcularOrientacaoFinal(
    orientacaoInicial,
    etapasRota
) {

    if (
        !Array.isArray(etapasRota) ||
        etapasRota.length === 0
    ) {
        return normalizarAngulo(orientacaoInicial);
    }

    return normalizarAngulo(
        etapasRota[etapasRota.length - 1].angulo
    );
}
function gerarInstrucaoMovimento(
    rota,
    orientacaoInicial
) {

    const etapasRota = gerarEtapasRota(
        rota,
        orientacaoInicial
    );

    if (!etapasRota) {
        return null;
    }

    const rfids = [];

    etapasRota.forEach((etapa) => {

        const rfidsPercurso =
            obterRfidsPercurso(etapa);

        if (!rfidsPercurso) {
            return;
        }

        rfidsPercurso.forEach(rfid => {

            if (
                rfids.length === 0 ||
                rfids[rfids.length - 1] !== rfid
            ) {
                rfids.push(rfid);
            }
        });
    });

    const manobras = etapasRota
        .filter(etapa => etapa.manobra !== null)
        .map(etapa => ({
            ponto: etapa.pontoSaida,
            tipo: etapa.manobra.tipo,
            giro: etapa.manobra.giro
        }));


    /*
     * ============================================================
     * TRECHOS DA ROTA
     * ============================================================
     *
     * Cada conexão da rota vira um trecho.
     *
     * Exemplo:
     *
     * E01 → R01
     *
     * RFID origem  = RFID de E01
     * RFID destino = RFID de R01
     *
     * Depois:
     *
     * R01 → R02
     *
     * RFID origem  = RFID de R01
     * RFID destino = RFID de R02
     */

    const trechos = etapasRota.map(etapa => {

        const rfidsTrecho =
            obterRfidsPercurso(etapa);

        let rfidOrigem = null;
        let rfidDestino = null;

        if (
            Array.isArray(rfidsTrecho) &&
            rfidsTrecho.length >= 2
        ) {

            rfidOrigem = rfidsTrecho[0];
            rfidDestino = rfidsTrecho[1];
        }

        return {

            origem: etapa.pontoSaida,

            destino: etapa.pontoChegada,

            angulo: etapa.angulo,

            rfidOrigem: rfidOrigem,

            rfidDestino: rfidDestino,

            manobraAntes:
                etapa.manobra
                    ? {
                        tipo: etapa.manobra.tipo,
                        giro: etapa.manobra.giro
                    }
                    : null
        };
    });


    return {

        tipo: "MOVIMENTO",

        rota: rota,

        trechos: trechos,

        /*
         * Mantemos temporariamente os campos antigos.
         *
         * Eles serão removidos depois que confirmarmos
         * que o novo formato está funcionando.
         */
        rfids: rfids,

        etapasRota: etapasRota,

        manobras: manobras,

        orientacaoInicial:
            normalizarAngulo(orientacaoInicial),

        orientacaoFinal:
            calcularOrientacaoFinal(
                orientacaoInicial,
                etapasRota
            )
    };
}
function obterRfidsPercurso(etapa) {

    if (!etapa || !etapa.conexao) {
        return null;
    }

    const conexao = etapa.conexao;

    if (
        conexao.origem === etapa.pontoSaida &&
        conexao.destino === etapa.pontoChegada
    ) {

        if (!conexao.rfids?.origemDestino) {
            return null;
        }

        return [
            conexao.rfids.origemDestino.origem,
            conexao.rfids.origemDestino.destino
        ].filter(Boolean);
    }

    if (
        conexao.origem === etapa.pontoChegada &&
        conexao.destino === etapa.pontoSaida
    ) {

        if (!conexao.rfids?.destinoOrigem) {
            return null;
        }

        return [
            conexao.rfids.destinoOrigem.origem,
            conexao.rfids.destinoOrigem.destino
        ].filter(Boolean);
    }

    return null;
}

function prepararEtapaIrPara(agv, etapaMissao) {

    if (!agv || !etapaMissao) {
        return {
            sucesso: false,
            erro: "AGV ou etapa inválida."
        };
    }

    const destino = etapaMissao.destino;

    const pontoAtual =
        obterPontoEstacaoDoAGV(agv);

    if (!pontoAtual) {
        return {
            sucesso: false,
            erro: "Não foi possível identificar a estação atual do AGV."
        };
    }

    const pontoDestino =
        plantaOperacional.pontos.find(
            ponto => ponto.id === destino
        );

    if (!pontoDestino) {
        return {
            sucesso: false,
            erro: `Estação de destino não encontrada: ${destino}`
        };
    }

    /*
     * Já está no destino.
     */
    if (pontoAtual.id === pontoDestino.id) {

        return {
            sucesso: true,
            concluidaImediatamente: true,

            contexto: {
                origem: pontoAtual.id,
                destino: pontoDestino.id,
                rota: [pontoAtual.id],
                orientacaoInicial: agv.orientacao,
                orientacaoFinal: agv.orientacao
            }
        };
    }

    const rota = calcularRota(
        pontoAtual.id,
        pontoDestino.id
    );

    if (!rota) {

        return {
            sucesso: false,
            erro:
                `Não existe rota entre ${pontoAtual.id} e ${pontoDestino.id}.`
        };
    }

    const instrucao =
        gerarInstrucaoMovimento(
            rota,
            agv.orientacao
        );

    if (!instrucao) {

        return {
            sucesso: false,
            erro:
                "Não foi possível gerar a instrução física da rota."
        };
    }

    return {
        sucesso: true,

        concluidaImediatamente: false,

        contexto: {
            origem: pontoAtual.id,
            destino: pontoDestino.id,
            rota: rota,

            instrucao: instrucao,

            orientacaoInicial:
                agv.orientacao,

            orientacaoFinal:
                instrucao.orientacaoFinal
        }
    };
}

/* ============================================================
   DRAG & DROP — LISTA LATERAL → MAPA
   ============================================================ */

function iniciarArrasteLista(event) {

    if (
        !modoEdicaoPlanta ||
        modoConexoesPlanta
    ) {
        event.preventDefault();
        return;
    }

    const item = event.currentTarget;
    const id = item.dataset.id;

    if (!id) {
        event.preventDefault();
        return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);

    item.classList.add("arrastando");
}


/* ============================================================
   PERMITIR SOLTAR NO MAPA
   ============================================================ */

function permitirDropMapa(event) {

    if (
        !modoEdicaoPlanta ||
        modoConexoesPlanta
    ) {
        return;
    }

    event.preventDefault();

    event.dataTransfer.dropEffect = "move";
}


/* ============================================================
   SOLTAR PONTO NO MAPA
   ============================================================ */

function soltarPontoMapa(event) {

    if (
        !modoEdicaoPlanta ||
        modoConexoesPlanta
    ) {
        return;
    }

    event.preventDefault();

    const id =
        event.dataTransfer.getData("text/plain");

    if (!id) {
        return;
    }

    const ponto =
        planta.pontos.find(
            p => p.id === id
        );

    if (!ponto) {
        return;
    }

    const mapa =
        document.getElementById("mapaPlanta");

    if (!mapa) {
        return;
    }

    const rect =
        mapa.getBoundingClientRect();


    /* --------------------------------------------------------
       CONVERTE A POSIÇÃO DO MOUSE PARA %
       -------------------------------------------------------- */

    let x =
        ((event.clientX - rect.left) /
            rect.width) * 100;

    let y =
        ((event.clientY - rect.top) /
            rect.height) * 100;


    /* --------------------------------------------------------
       LIMITA O PONTO DENTRO DO MAPA
       -------------------------------------------------------- */

    x = Math.max(2, Math.min(98, x));
    y = Math.max(2, Math.min(98, y));


    /* --------------------------------------------------------
       SALVA A POSIÇÃO DO PONTO
       -------------------------------------------------------- */

    ponto.x = x;
    ponto.y = y;


    /* --------------------------------------------------------
       PERSISTÊNCIA
       -------------------------------------------------------- */

    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );


    /* --------------------------------------------------------
       ATUALIZA A PLANTA
       -------------------------------------------------------- */

    renderizarPontos();
}
/* ============================================================
   INÍCIO DO ARRASTE
   ============================================================ */

function iniciarArrastePonto(event) {

    if (!modoEdicaoPlanta) {
        return;
    }

    const elemento = event.currentTarget;

    const id = elemento.dataset.id;

    const ponto = planta.pontos.find(
        p => p.id === id
    );

    if (!ponto) {
        return;
    }

    pontoArrastando = ponto;

    elemento.setPointerCapture(event.pointerId);

    event.preventDefault();
}


/* ============================================================
   MOVIMENTO DO PONTO
   ============================================================ */

function moverPonto(event) {

    if (
        !modoEdicaoPlanta ||
        !pontoArrastando
    ) {
        return;
    }

    const mapa =
        document.getElementById("mapaPlanta");

    if (!mapa) {
        return;
    }

    const rect =
        mapa.getBoundingClientRect();

    let x =
        ((event.clientX - rect.left) / rect.width) * 100;

    let y =
        ((event.clientY - rect.top) / rect.height) * 100;


    /* --------------------------------------------------------
       LIMITA O PONTO DENTRO DO MAPA
       -------------------------------------------------------- */

    x = Math.max(2, Math.min(98, x));
    y = Math.max(2, Math.min(98, y));


    pontoArrastando.x = x;
    pontoArrastando.y = y;


    /* --------------------------------------------------------
       ATUALIZA A POSIÇÃO VISUAL
       -------------------------------------------------------- */

    const elemento =
        document.querySelector(
            `[data-id="${pontoArrastando.id}"]`
        );

    if (elemento) {

        elemento.style.left =
            `${x}%`;

        elemento.style.top =
            `${y}%`;

    }
}

/* ============================================================
   VALIDAR CONEXÕES APÓS MOVER UM PONTO
   ============================================================ */

function validarConexoes() {

    const tolerancia = 0.5;

    planta.conexoes =
        planta.conexoes.filter(
            conexao => {

                const pontoA =
                    planta.pontos.find(
                        ponto =>
                            ponto.id ===
                            conexao.origem
                    );

                const pontoB =
                    planta.pontos.find(
                        ponto =>
                            ponto.id ===
                            conexao.destino
                    );

                if (!pontoA || !pontoB) {
                    return false;
                }

                const dx =
                    pontoB.x - pontoA.x;

                const dy =
                    pontoB.y - pontoA.y;

                const horizontal =
                    Math.abs(dy) <= tolerancia;

                const vertical =
                    Math.abs(dx) <= tolerancia;

                if (
                    !horizontal &&
                    !vertical
                ) {

                    return false;
                }

                conexao.tipo =
                    horizontal
                        ? "HORIZONTAL"
                        : "VERTICAL";

                conexao.anguloOrigemDestino =
                    calcularAnguloConexao(
                        pontoA,
                        pontoB
                    );

                conexao.anguloDestinoOrigem =
                    calcularAnguloConexao(
                        pontoB,
                        pontoA
                    );

                return true;
            }
        );

    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );
}
/* ============================================================
   FINALIZA O ARRASTE
   ============================================================ */

function finalizarArrastePonto() {

    if (!pontoArrastando) {
        return;
    }

    validarConexoes();

    pontoArrastando = null;

    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );

    renderizarPontos();
}





const STATUS_LIGADO = ["LIGADO", "DESLIGADO"];
const ESTADOS_MAQUINA = ["DESLIGADO", "PRONTO", "MANUAL", "AUTOMATICO", "MISSAO", "PARADO", "EMERGENCIA", "AGUARDANDO_REARME", "AGUARDANDO_OBSTACULO"];
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
const STATUS_BARREIRA = ["LIVRE", "INVADIDA"];
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

        rearme: "comando/rearme",

        carregarMissao: "comando/carregar_missao",

        manual: "comando/manual",

        configuracao: "comando/configuracao"
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
    atualizarPainel();
    renderizarAGVMapaVisaoGeral();
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
            clientId: `painel-frota-${Math.random().toString(16).slice(2)}`
        }
    );

    clienteMQTT.on("connect", () => {

        console.log("MQTT conectado à frota.");

        atualizarIndicadorMQTT(true);


        // ========================================================
        // STATUS
        // ========================================================

        clienteMQTT.subscribe(
            "agv/+/status/#",
            erro => {

                if (erro) {

                    console.error(
                        "Erro na inscrição MQTT de status:",
                        erro
                    );

                } else {

                    console.log(
                        "Inscrito em agv/+/status/#"
                    );
                }
            }
        );


        // ========================================================
        // EVENTOS
        // ========================================================

        clienteMQTT.subscribe(
            "agv/+/evento",
            erro => {

                if (erro) {

                    console.error(
                        "Erro na inscrição MQTT de eventos:",
                        erro
                    );

                } else {

                    console.log(
                        "Inscrito em agv/+/evento"
                    );
                }
            }
        );


        // ========================================================
        // SISTEMA
        // ========================================================

        clienteMQTT.subscribe(
            "agv/+/sistema/#",
            erro => {

                if (erro) {

                    console.error(
                        "Erro na inscrição MQTT de sistema:",
                        erro
                    );

                } else {

                    console.log(
                        "Inscrito em agv/+/sistema/#"
                    );
                }
            }
        );

    });


    // ============================================================
    // MENSAGENS RECEBIDAS
    // ============================================================

    clienteMQTT.on("message", (topico, mensagem) => {

        processarMensagemMQTT(
            topico,
            mensagem.toString()
        );
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
    if (sideText) sideText.textContent = conectado ? "MQTT CONECTADO" : "MQTT DESCONECTADO";

    Object.values(agvs).forEach(agv => agv.mqttConectado = conectado);
    atualizarPainel();
}

function processarMensagemMQTT(topico, valor) {

    const partes = topico.split("/");

    // agv/{id}/{caminho}
    if (
        partes.length < 3 ||
        partes[0] !== "agv"
    ) {
        return;
    }

    const id = partes[1];
    const agv = agvs[id];

    if (!agv) {
        return;
    }

    const caminho = partes.slice(2).join("/");


    // ========================================================
    // EVENTOS
    // ========================================================

    if (caminho === "evento") {

        processarEventoMissao(
            agv.id,
            valor
        );

        registrarEventoHistorico(
            agv.id,
            valor
        );

        return;
    }


    // ========================================================
    // SISTEMA
    // ========================================================

    if (caminho.startsWith("sistema/")) {

        const parametro =
            caminho.replace("sistema/", "");

        if (!agv.sistema) {
            agv.sistema = {};
        }

        agv.sistema[parametro] = valor;

        salvarAgvsFrota();

        return;
    }


    // ========================================================
    // STATUS
    // ========================================================

    switch (caminho) {

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

                agv.bateria =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            Number(valor)
                        )
                    );
            }

            break;


        case "status/velocidade":

            if (!isNaN(Number(valor))) {

                agv.velocidade =
                    Math.max(
                        0,
                        Number(valor)
                    );
            }

            break;


        case "status/estacao": {

    agv.estacaoAtual = valor;
    agv.pontoAtual = valor;

    const ponto = plantaOperacional.pontos.find(
        p => p.id === valor
    );

    if (ponto) {

        agv.x = ponto.x;
        agv.y = ponto.y;

        renderizarAGVMapaVisaoGeral();
    }

    break;
}


        case "status/destino":

            agv.destino = valor;

            break;


        case "status/heartbeat":

            if (!isNaN(Number(valor))) {

                agv.heartbeat =
                    Number(valor);

                marcarHeartbeat(id);
            }

            break;


        case "status/progresso":

            if (!isNaN(Number(valor))) {

                agv.progresso =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            Number(valor)
                        )
                    );
            }

            break;


        case "status/estado_missao":

            if (ESTADOS_MISSAO.includes(valor)) {

                agv.estadoMissao = valor;

                // Quando o ESP confirma que a missão
                // terminou, não mantemos a missão como atual.
                if (valor === "CONCLUIDA") {

                    agv.missaoAtual = null;
                }
            }

            break;


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

                agv.emergencia =
                    valor === "ACIONADA";
            }

            break;


        case "status/seguranca/rearme":

            if (STATUS_REARME.includes(valor)) {

                agv.aguardandoRearme =
                    valor === "NECESSARIO";
            }

            break;


        case "status/seguranca/barreira":

            if (STATUS_BARREIRA.includes(valor)) {

                agv.barreira = valor;
            }

            break;


        // ====================================================
        // POSIÇÃO
        // ====================================================

        


        // ====================================================
        // MISSÃO
        // ====================================================

        case "status/missao/id":

            agv.missaoCarregada = valor;

            break;


        case "status/missao/etapa":

            agv.etapaMissao = valor;

            break;


        // ====================================================
        // CONFIGURAÇÃO
        // ====================================================

        case "status/configuracao":

    try {

        const configuracao =
            JSON.parse(valor);


        // ====================================================
        // ESP CONFIRMOU A CONFIGURAÇÃO
        // ====================================================

        if (
            configuracao.status === "OK"
        ) {

            agv.configuracao = {

                kpQtr:
                    Number(
                        configuracao.kpQtr
                    ),

                kiQtr:
                    Number(
                        configuracao.kiQtr
                    ),

                kdQtr:
                    Number(
                        configuracao.kdQtr
                    ),

                velocidadeMaxima:
                    Number(
                        configuracao.velocidadeMaxima
                    )
            };


            salvarAgvsFrota();


            // Atualiza os campos somente
            // com o valor confirmado pelo ESP.

            if (
                id === agvSelecionado
            ) {

                atualizarCamposConfiguracao();
            }


            console.log(
                "Configuração confirmada pelo ESP:",
                agv.configuracao
            );

        }


        // ====================================================
        // ESP REJEITOU A CONFIGURAÇÃO
        // ====================================================

        else if (
            configuracao.status === "ERRO"
        ) {

            console.error(
                "ESP rejeitou configuração:",
                configuracao
            );


            alert(
                "O ESP rejeitou a alteração de configuração.\n\n" +
                "Parâmetro: " +
                (configuracao.parametro || "--") +
                "\nMotivo: " +
                (configuracao.motivo || "Erro desconhecido.")
            );

        }


        // ====================================================
        // FORMATO DESCONHECIDO
        // ====================================================

        else {

            console.warn(
                "Status de configuração desconhecido:",
                configuracao
            );
        }

    } catch (_) {

        console.error(
            "Configuração MQTT inválida:",
            valor
        );
    }

    break;


        // ====================================================
        // SENSORES
        // ====================================================

        case "status/sensores/qtr":

            try {

                agv.sensores.qtr =
                    JSON.parse(valor);

            } catch (_) {

                console.error(
                    "Dados QTR inválidos:",
                    valor
                );
            }

            break;


        case "status/sensores/vl53/1":

            agv.sensores.vl53.sensor1 =
                Number(valor);

            break;


        case "status/sensores/vl53/2":

            agv.sensores.vl53.sensor2 =
                Number(valor);

            break;


        case "status/sensores/rfid":

            try {

                agv.sensores.rfid =
                    JSON.parse(valor);

            } catch (_) {

                console.error(
                    "Dados RFID inválidos:",
                    valor
                );
            }

            break;


        default:
            break;
    }


    // ========================================================
    // ATUALIZA INTERFACE
    // ========================================================

    salvarAgvsFrota();

    if (id === agvSelecionado) {

        atualizarPainel();

        renderizarControleFilaAGV();
    }

    renderizarFrota();
}
function registrarEventoHistorico(agvId, mensagem) {

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

    agv.historico.unshift({
        data: new Date().toISOString(),
        evento: dados
    });

    // Limita o histórico local
    // para evitar crescimento infinito.
    if (agv.historico.length > 500) {

        agv.historico =
            agv.historico.slice(0, 500);
    }

    salvarAgvsFrota();

    console.log(
        "Evento registrado no histórico:",
        agvId,
        dados
    );
}

function publicar(caminho, mensagem, id = agvSelecionado) {

    if (!clienteMQTT || !clienteMQTT.connected || !id) {
        console.error(
            "MQTT não conectado ou AGV não selecionado."
        );
        return false;
    }

    const topico = gerarTopico(id, caminho);

    console.log("PUBLICANDO:");
    console.log("Tópico:", topico);
    console.log("Mensagem:", mensagem);

    clienteMQTT.publish(
        topico,
        String(mensagem),
        { qos: 1 },
        erro => {

            if (erro) {
                console.error(
                    "Erro ao publicar MQTT:",
                    erro
                );
                return;
            }

            console.log(
                "Publicação MQTT concluída pelo cliente:",
                topico
            );
        }
    );

    return true;
}



/* ============================================================
   FROTA / SELEÇÃO
   ============================================================ */

function renderizarFrota() {
    const grid = document.getElementById("fleetGrid");
    if (!grid) return;

    const lista = Object.values(agvs);

    document.getElementById("fleetCount").textContent = `${lista.length} AGVs`;

    grid.innerHTML = lista.map(agv => {

        const online = agv.online;
        const emergencia = agv.emergencia;
        const barreira = agv.barreira === "INVADIDA";

        const classesCard = [
            "fleet-card",
            online ? "online" : "offline",
            emergencia ? "emergencia" : "",
            barreira ? "barreira" : ""
        ].filter(Boolean).join(" ");

        const alertas = `
            ${emergencia ? `
                <div class="fleet-alert emergencia">
                    EMERGÊNCIA ATIVA — MOVIMENTAÇÃO BLOQUEADA
                </div>
            ` : ""}

            ${barreira ? `
                <div class="fleet-alert barreira">
                    BARREIRA INVADIDA — MOVIMENTAÇÃO BLOQUEADA
                </div>
            ` : ""}
        `;

        return `
            <article
                class="${classesCard}"
                onclick="selecionarAGV('${agv.id}')"
            >

                <div class="fleet-card-head">

                    <div>
                        <div class="fleet-id">
                            AGV ${agv.id}
                        </div>

                        <div class="fleet-name">
                            ${agv.nome}
                        </div>
                    </div>

                    <div class="fleet-status ${online ? "online" : "offline"}">

                        <span class="status-dot ${online ? "verde" : "vermelho"}"></span>

                        ${online ? "ONLINE" : "OFFLINE"}

                    </div>

                </div>


                <div class="fleet-data">

                    <div>
                        <span>Máquina</span>
                        <strong>${agv.maquina}</strong>
                    </div>

                    <div>
                        <span>Modo</span>
                        <strong>${agv.modo}</strong>
                    </div>

                    <div>
                        <span>Bateria</span>
                        <strong>
                            ${online ? agv.bateria + "%" : "--"}
                        </strong>
                    </div>

                    <div>
                        <span>Missão</span>
                        <strong>${agv.estadoMissao}</strong>
                    </div>

                </div>


                ${alertas}
                <div class="fleet-actions-card">

    <button
        type="button"
        onclick="event.stopPropagation(); abrirEdicaoAGV('${agv.id}')"
    >
        EDITAR
    </button>

    <button
        type="button"
        class="btn-excluir-agv"
        onclick="event.stopPropagation(); excluirAGV('${agv.id}')"
    >
        EXCLUIR
    </button>

</div>

                <div class="fleet-open">
                    ${online ? "ABRIR PAINEL →" : "AGV NÃO DISPONÍVEL"}
                </div>

            </article>
        `;

    }).join("");
}
function renderizarControleFilaAGV() {

    const select =
        document.getElementById(
            "missaoSelecionadaAGV"
        );

    const filaContainer =
        document.getElementById(
            "filaMissoesAGV"
        );

    const atualContainer =
        document.getElementById(
            "missaoAtualAGV"
        );


    if (!select) {
        return;
    }


    const agv =
        agvAtual();


    if (!agv) {
        return;
    }


    // ========================================================
// MISSÕES DISPONÍVEIS
// ========================================================

const missoesSalvas =
    localStorage.getItem("missoesAGV");

const missoesDisponiveis =
    missoesSalvas
        ? JSON.parse(missoesSalvas)
        : [];


select.innerHTML = `

    <option value="">
        SELECIONE UMA MISSÃO
    </option>

`;


if (Array.isArray(missoesDisponiveis)) {

    missoesDisponiveis.forEach(missao => {

        const option =
            document.createElement("option");

        option.value =
            missao.id;

        option.textContent =
            `${missao.id} — ${missao.nome || "Sem nome"}`;

        select.appendChild(option);

    });
}


    select.value =
        agv.missaoSelecionada || "";


    // ========================================================
    // MISSÃO ATUAL
    // ========================================================

    if (atualContainer) {

        if (agv.missaoAtual) {

            const missaoAtual =
                obterMissaoPorId(
                    agv.missaoAtual
                );


            atualContainer.innerHTML = `

                <span class="missao-atual-label">
                    EM EXECUÇÃO
                </span>

                <strong>
                    ${agv.missaoAtual}
                </strong>

                ${
                    missaoAtual
                        ? ` — ${missaoAtual.nome || ""}`
                        : ""
                }

            `;

        } else {

            atualContainer.innerHTML = `
                <span class="missao-atual-vazia">
                    Nenhuma missão em execução
                </span>
            `;
        }
    }


    // ========================================================
    // FILA
    // ========================================================

    if (!filaContainer) {
        return;
    }


    filaContainer.innerHTML = "";


    if (
    !Array.isArray(agv.filaMissoes) ||
    agv.filaMissoes.length === 0
) {

    filaContainer.innerHTML = `

        <div class="fila-vazia">
            FILA VAZIA
        </div>

    `;
    
} else {

    



    agv.filaMissoes.forEach(
        (missaoId, indice) => {

            const missao =
                obterMissaoPorId(
                    missaoId
                );


            const item =
                document.createElement("div");


            item.className =
                "fila-missao-item";


            item.innerHTML = `

                <div class="fila-missao-info">

                    <span class="fila-missao-ordem">
                        ${indice + 1}
                    </span>

                    <div>

                        <strong>
                            ${missaoId}
                        </strong>

                        <small>
                            ${
                                missao
                                    ? missao.nome || ""
                                    : "Missão não encontrada"
                            }
                        </small>

                    </div>

                </div>


                <button
                    type="button"
                    class="btn-remover-fila"
                    onclick="removerMissaoFila(${indice})"
                >
                    ×
                </button>

            `;


            filaContainer.appendChild(item);

        }
    );
}


    // ========================================================
    // BOTÕES
    // ========================================================

    const btnIniciar =
        document.getElementById(
            "btnStart"
        );


    const btnFila =
        document.getElementById(
            "btnAdicionarFilaAGV"
        );


    const seguro =
        agv.online &&
        agv.ligado === "LIGADO" &&
        !agv.emergencia &&
        !agv.aguardandoRearme &&
        agv.stop === "NORMAL" &&
        agv.barreira === "LIVRE";


    if (btnIniciar) {

        btnIniciar.disabled =
            !seguro ||
            !agv.missaoSelecionada ||
            agv.estadoMissao === "EM_EXECUCAO";
    }


    if (btnFila) {

        btnFila.disabled =
            !agv.missaoSelecionada;
    }
}
function selecionarAGV(id) {
    if (!agvs[id]) return;
    agvSelecionado = id;
    document.getElementById("agvSelecionadoNome").textContent = agvs[id].nome;
    document.getElementById("agvSelecionadoId").textContent = `AGV ${id}`;
    atualizarCamposConfiguracao();
    mudarTela("visaoGeral");
    renderizarMapaVisaoGeral();
    atualizarPainel();
    renderizarControleFilaAGV();
}

function voltarFrota() {
    mudarTela("frota");
}

function selecionarProximoAGV() {
    const ids = Object.keys(agvs);
    const index = Math.max(0, ids.indexOf(agvSelecionado));
    selecionarAGV(ids[(index + 1) % ids.length]);
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */

const informacoesTelas = {
    frota: ["Controle da Frota", "Selecione um AGV para acessar o painel operacional"],
    visaoGeral: ["Visão Geral", "Monitoramento e controle do AGV selecionado"],
    controleManual: ["Controle Manual", "Comando direto e movimentação do AGV selecionado"],
    missoes: ["Missões", "Gerenciamento das missões da frota"],
    sensores: ["Sensores", "Monitoramento dos sensores do AGV selecionado"],
    diagnostico: ["Diagnóstico", "Estado dos sistemas e componentes"],
    historico: ["Histórico", "Registro de eventos do AGV selecionado"],
    configuracoes: ["Configurações", "Parâmetros do AGV selecionado"],
    controlePlanta: ["Controle da Planta", "Cadastro e configuração da planta do AGV"]
};
function mudarTela(nomeTela) {

    if (
    nomeTela !== "frota" &&
    nomeTela !== "controlePlanta" &&
    nomeTela !== "missoes" &&
    !agvSelecionado
) {
    alert("Selecione um AGV primeiro.");
    return;
}

    document.querySelectorAll(".tela").forEach(t => {
        t.classList.remove("ativa");
    });

    document.getElementById(nomeTela)?.classList.add("ativa");

    document.querySelectorAll(".menu-item").forEach(item => {
        item.classList.remove("ativo");
    });

    if (nomeTela === "frota") {

        document.getElementById("menuFrota")?.classList.add("ativo");

    } else {

        document
            .querySelector(`.menu-item[data-tela="${nomeTela}"]`)
            ?.classList.add("ativo");
    }

    const info = informacoesTelas[nomeTela];

    if (info) {
        document.getElementById("tituloTela").textContent = info[0];
        document.getElementById("subtituloTela").textContent = info[1];
    }
if (nomeTela === "controleManual") {
    atualizarControleManual();
}

if (nomeTela === "frota") {
    renderizarFrota();
}

if (nomeTela === "controlePlanta") {
    renderizarPontos();
}
if (nomeTela === "missoes") {
    renderizarListaMissoes();
}
}
/* ============================================================
   MENU - FROTA
   ============================================================ */

const menuFrota = document.getElementById("menuFrota");
const submenuFrota = document.getElementById("submenuFrota");

menuFrota.addEventListener("click", () => {

    const aberto = submenuFrota.classList.toggle("aberto");

    menuFrota.classList.toggle("expandido", aberto);

    // Abre também a tela principal da Frota
    mudarTela("frota");

});

document.querySelectorAll(".menu-item:not(.menu-pai)").forEach(item => {
    item.addEventListener("click", event => {
        event.preventDefault();
        mudarTela(item.dataset.tela);
    });
});

/* ============================================================
   PAINEL DO AGV SELECIONADO
   ============================================================ */

function atualizarPainel() {
    const agv = agvAtual();

    if (!agv) {
    document.getElementById("indicadorAgv").className =
        "status-dot vermelho";

    document.getElementById("statusAgv").textContent =
        "NENHUM";

    const indicadorOnline =
        document.getElementById("indicadorOnline");

    const statusOnlineTopo =
        document.getElementById("statusOnlineTopo");

    if (indicadorOnline) {
        indicadorOnline.classList.remove("verde");
        indicadorOnline.classList.add("vermelho");
    }

    if (statusOnlineTopo) {
        statusOnlineTopo.textContent = "OFFLINE";
    }

    return;
}

    document.getElementById("indicadorAgv").className = `status-dot ${agv.ligado === "LIGADO" ? "verde" : "vermelho"}`;
    document.getElementById("statusAgv").textContent =
    agv.ligado;
    const indicadorOnline = document.getElementById("indicadorOnline");
const statusOnlineTopo = document.getElementById("statusOnlineTopo");

if (indicadorOnline) {
    indicadorOnline.classList.toggle("verde", agv.online);
    indicadorOnline.classList.toggle("vermelho", !agv.online);
}

if (statusOnlineTopo) {
    statusOnlineTopo.textContent =
        agv.online ? "ONLINE" : "OFFLINE";
}
    document.getElementById("heartbeat").textContent = agv.online ? `${agv.heartbeat.toFixed(1).replace(".", ",")} s` : "--";
    document.getElementById("agvSelecionadoNome").textContent = agv.nome;
    document.getElementById("agvSelecionadoId").textContent = `AGV ${agv.id}`;

    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set("vgNome", agv.nome); set("vgId", `AGV ${agv.id}`); set("manualAgvNome", `${agv.nome} • AGV ${agv.id}`);
    set(
    "statusOnline",
    agv.online ? "ONLINE" : "OFFLINE"
);
const statusOnline = document.getElementById("statusOnline");

if (statusOnline) {
    statusOnline.style.color =
        agv.online ? "var(--green)" : "var(--red)";
}
    set("statusMaquina", agv.maquina); set("statusModo", agv.modo); set("estacaoAtual", agv.estacaoAtual); set("destino", agv.destino);
    set("estadoMissao", agv.estadoMissao); set("progressoTexto", `${agv.progresso}%`); set("missaoAtualBadge", agv.estadoMissao);
    set("missaoProgresso", `${agv.progresso}%`); set("missaoDestino", agv.destino); set("diagMqtt", agv.mqttConectado ? "CONECTADO" : "DESCONECTADO"); set("diagHeartbeat", agv.online ? `${agv.heartbeat.toFixed(1)} s` : "--");
set("bateria", `${agv.bateria}%`);
set(
    "velocidade",
    `${agv.velocidade.toFixed(2).replace(".", ",")} m/s`
);
    const barraProgresso = document.getElementById("barraProgresso");

if (barraProgresso) {
    barraProgresso.style.width = `${agv.progresso}%`;
}
    const missaoProgressBar = document.getElementById("missaoProgressBar");

if (missaoProgressBar) {
    missaoProgressBar.style.width = `${agv.progresso}%`;
}

    const statusEmergencia = document.getElementById("statusEmergencia");
    statusEmergencia.textContent = agv.emergencia ? "ACIONADA" : "NORMAL";
    statusEmergencia.className = `seguranca-status ${agv.emergencia ? "perigo" : "normal"}`;

    const statusRearme = document.getElementById("statusRearme");
    statusRearme.textContent = agv.aguardandoRearme ? "NECESSÁRIO" : "LIBERADO";
    statusRearme.className = `seguranca-status ${agv.aguardandoRearme ? "alerta" : "normal"}`;

    const statusBarreira = document.getElementById("statusBarreira");
    statusBarreira.textContent = agv.barreira;
    statusBarreira.className = `seguranca-status ${agv.barreira === "INVADIDA" ? "perigo" : "normal"}`;

    document.getElementById("indicadorRearme").textContent = agv.aguardandoRearme ? "REARME NECESSÁRIO" : "REARME LIBERADO";
    document.getElementById("indicadorRearme").classList.toggle("ativo", agv.aguardandoRearme);
    const telaAtual = document.querySelector(".tela.ativa");

const estaNaFrota =
    telaAtual && telaAtual.id === "frota";

const main = document.querySelector(".main");

if (telaAtual && !estaNaFrota) {

    main.classList.toggle(
        "main-emergencia",
        agv.emergencia
    );

    document.getElementById("bannerEmergencia").classList.toggle(
        "ativo",
        agv.emergencia
    );

    document.getElementById("bannerBarreira").classList.toggle(
        "ativo",
        agv.barreira === "INVADIDA"
    );

} else {

    main.classList.remove("main-emergencia");

    document.getElementById("bannerEmergencia").classList.remove("ativo");
    document.getElementById("bannerBarreira").classList.remove("ativo");
}
const podeIniciar =
    agv.online &&
    agv.ligado === "LIGADO" &&
    !agv.emergencia &&
    !agv.aguardandoRearme &&
    agv.stop === "NORMAL" &&
    agv.barreira === "LIVRE" &&
    agv.estadoMissao !== "EM_EXECUCAO";
document.getElementById("btnStart").disabled = !podeIniciar;
document.getElementById("btnRearme").disabled =
    !(agv.online && agv.aguardandoRearme);
    atualizarControleManual();
}

function atualizarControleManual() {
    const agv = agvAtual();
    const joystick = document.getElementById("joystick");
    if (!agv || !joystick) return;

const habilitado =
    agv.online &&
    agv.ligado === "LIGADO" &&
    agv.modo === "MANUAL" &&
    agv.maquina !== "EMERGENCIA" &&
    agv.stop === "NORMAL" &&
    !agv.aguardandoRearme &&
    agv.barreira !== "INVADIDA";    joystick.classList.toggle("bloqueado", !habilitado);
    document.getElementById("manualStatus").textContent = habilitado ? "MANUAL HABILITADO" : "MANUAL BLOQUEADO";
    document.getElementById("manualStatus").style.color = habilitado ? "var(--green)" : "var(--muted)";
}
function salvarMapa() {

    // ========================================================
    // 1. VERIFICA PONTOS SEM POSIÇÃO
    // ========================================================

    const pontosSemPosicao = planta.pontos.filter(
        ponto =>
            ponto.x === null ||
            ponto.y === null
    );

    if (pontosSemPosicao.length > 0) {

        const ids = pontosSemPosicao
            .map(ponto => ponto.id)
            .join(", ");

        alert(
            "Não é possível salvar a planta.\n\n" +
            "Os seguintes pontos ainda não foram posicionados no mapa:\n" +
            ids
        );

        return;
    }


    // ========================================================
    // 2. VERIFICA PONTOS SEM CONEXÃO
    // ========================================================

    const pontosSemConexao = planta.pontos.filter(ponto => {

        return !planta.conexoes.some(
            conexao =>
                conexao.origem === ponto.id ||
                conexao.destino === ponto.id
        );

    });

    if (pontosSemConexao.length > 0) {

        const ids = pontosSemConexao
            .map(ponto => ponto.id)
            .join(", ");

        alert(
            "Não é possível salvar a planta.\n\n" +
            "Os seguintes pontos não possuem nenhuma conexão:\n" +
            ids
        );

        return;
    }


    // ========================================================
    // 3. VERIFICA CONEXÕES INVÁLIDAS
    // ========================================================

    for (const conexao of planta.conexoes) {

        const origem = planta.pontos.find(
            ponto => ponto.id === conexao.origem
        );

        const destino = planta.pontos.find(
            ponto => ponto.id === conexao.destino
        );

        if (!origem || !destino) {

            alert(
                "Não é possível salvar a planta.\n\n" +
                "Existe uma conexão vinculada a um ponto que não existe mais."
            );

            return;
        }
    }


    // ========================================================
    // 4. SALVA A PLANTA EDITÁVEL
    // ========================================================

    localStorage.setItem(
        "plantaAGV",
        JSON.stringify(planta)
    );


    // ========================================================
    // 5. ATUALIZA A PLANTA OPERACIONAL
    // ========================================================

    const novaPlantaOperacional =
        JSON.parse(JSON.stringify(planta));

    plantaOperacional.pontos =
        novaPlantaOperacional.pontos;

    plantaOperacional.conexoes =
        novaPlantaOperacional.conexoes;


    localStorage.setItem(
        "plantaAGVOperacional",
        JSON.stringify(plantaOperacional)
    );


    // ========================================================
    // 6. FINALIZA O MODO DE EDIÇÃO
    // ========================================================

  modoEdicaoPlanta = false;
modoConexoesPlanta = false;

pontoArrastando = null;
pontoConexaoOrigem = null;
conexaoEmConfiguracao = null;
// ========================================================
// 6.1 RESTAURA O BOTÃO PARA EDITAR MAPA
// ========================================================

const btnEditarMapa =
    document.getElementById("btnEditarMapa");

if (btnEditarMapa) {
    btnEditarMapa.textContent = "EDITAR MAPA";
}


    // ========================================================
    // 7. ATUALIZA O MAPA
    // ========================================================

    renderizarPontos();


    // ========================================================
    // 8. CONFIRMAÇÃO
    // ========================================================

    alert("Mapa salvo com sucesso.");
}

function atualizarCamposConfiguracao() {

    const agv = agvAtual();

    if (!agv) {
        return;
    }


    // ========================================================
    // IDENTIFICAÇÃO
    // ========================================================

    const campoNome =
        document.getElementById("configNome");

    const campoId =
        document.getElementById("configId");


    if (campoNome) {
        campoNome.value = agv.nome || "";
    }

    if (campoId) {
        campoId.value = agv.id || "";
    }


    // ========================================================
    // CONFIGURAÇÃO DO QTR
    // ========================================================

    const configuracao =
        agv.configuracao || {};


    const campoKp =
        document.getElementById("configKpQtr");

    const campoKi =
        document.getElementById("configKiQtr");

    const campoKd =
        document.getElementById("configKdQtr");

    const campoVelocidade =
        document.getElementById(
            "configVelocidadeMaxima"
        );


    if (campoKp) {

        campoKp.value =
            configuracao.kpQtr ?? 1.2;
    }


    if (campoKi) {

        campoKi.value =
            configuracao.kiQtr ?? 0.05;
    }


    if (campoKd) {

        campoKd.value =
            configuracao.kdQtr ?? 0.8;
    }


    if (campoVelocidade) {

        campoVelocidade.value =
            configuracao.velocidadeMaxima ?? 0.1;
    }


    // ========================================================
    // OPERAÇÃO
    // ========================================================

    const campoEstacao =
        document.getElementById(
            "configEstacaoAtual"
        );

    const campoModo =
        document.getElementById(
            "configModoAtual"
        );

    const campoMaquina =
        document.getElementById(
            "configMaquinaAtual"
        );


    if (campoEstacao) {
        campoEstacao.textContent =
            agv.estacaoAtual || "--";
    }

    if (campoModo) {
        campoModo.textContent =
            agv.modo || "--";
    }

    if (campoMaquina) {
        campoMaquina.textContent =
            agv.maquina || "--";
    }
}
function confirmarConfiguracoesAGV() {

    const agv = agvAtual();

    if (!agv) {
        alert("Nenhum AGV selecionado.");
        return;
    }


    // ========================================================
    // VERIFICA MQTT
    // ========================================================

    if (
        !clienteMQTT ||
        !clienteMQTT.connected
    ) {

        alert(
            "Não é possível alterar a configuração.\n\n" +
            "O MQTT está desconectado."
        );

        return;
    }


    // ========================================================
    // LÊ OS CAMPOS
    // ========================================================

    const campoKp =
        document.getElementById("configKpQtr");

    const campoKi =
        document.getElementById("configKiQtr");

    const campoKd =
        document.getElementById("configKdQtr");

    const campoVelocidade =
        document.getElementById(
            "configVelocidadeMaxima"
        );


    const kp =
        Number(campoKp.value);

    const ki =
        Number(campoKi.value);

    const kd =
        Number(campoKd.value);

    const velocidadeMaxima =
        Number(campoVelocidade.value);


    // ========================================================
    // VALIDAÇÃO BÁSICA
    // ========================================================

    if (
        !Number.isFinite(kp) ||
        !Number.isFinite(ki) ||
        !Number.isFinite(kd) ||
        !Number.isFinite(velocidadeMaxima)
    ) {

        alert(
            "Todos os parâmetros devem possuir valores numéricos."
        );

        return;
    }


    if (
        kp < 0 ||
        ki < 0 ||
        kd < 0 ||
        velocidadeMaxima <= 0
    ) {

        alert(
            "Os valores informados são inválidos."
        );

        return;
    }


    // ========================================================
    // CONFIGURAÇÃO CONFIRMADA ANTERIORMENTE PELO ESP
    // ========================================================

    const configuracaoAnterior =
        agv.configuracao || {};


    // ========================================================
    // LISTA DE ALTERAÇÕES
    // ========================================================

    const alteracoes = [];


    if (
        Number(configuracaoAnterior.kpQtr) !== kp
    ) {

        alteracoes.push({
            parametro: "KP_QTR",
            valor: kp
        });
    }


    if (
        Number(configuracaoAnterior.kiQtr) !== ki
    ) {

        alteracoes.push({
            parametro: "KI_QTR",
            valor: ki
        });
    }


    if (
        Number(configuracaoAnterior.kdQtr) !== kd
    ) {

        alteracoes.push({
            parametro: "KD_QTR",
            valor: kd
        });
    }


    if (
        Number(configuracaoAnterior.velocidadeMaxima) !==
        velocidadeMaxima
    ) {

        alteracoes.push({
            parametro: "VELOCIDADE_MAXIMA",
            valor: velocidadeMaxima
        });
    }


    // ========================================================
    // NADA FOI ALTERADO
    // ========================================================

    if (alteracoes.length === 0) {

        alert(
            "Nenhuma alteração foi realizada."
        );

        return;
    }


    // ========================================================
    // CONFIRMA COM O OPERADOR
    // ========================================================

    const confirmar =
        confirm(
            `Deseja enviar ${alteracoes.length} alteração(ões) ` +
            `para o AGV ${agv.id}?`
        );


    if (!confirmar) {
        return;
    }


    // ========================================================
    // PUBLICA CADA ALTERAÇÃO
    // ========================================================

    alteracoes.forEach(
        alteracao => {

            const payload = {

                tipo:
                    "ALTERAR_CONFIGURACAO",

                parametro:
                    alteracao.parametro,

                valor:
                    alteracao.valor
            };


            publicar(
                TOPICOS.comando.configuracao,

                JSON.stringify(payload),

                agv.id
            );

        }
    );


    console.log(
        "Alterações de configuração enviadas:",
        alteracoes
    );
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

        alert("Selecione uma missão para este AGV.");

        return;
    }

    if (agv.estadoMissao === "EM_EXECUCAO") {

        alert(
            "Este AGV já está executando uma missão.\n\n" +
            "Use ADICIONAR À FILA para colocar outra missão na sequência."
        );

        return;
    }

    iniciarMissaoPorId(
        agv.id,
        agv.missaoSelecionada
    );
}

function iniciarMissaoPorId(agvId, missaoId) {

    const agv = agvs[agvId];

    if (!agv) {
        return false;
    }

    const missao = obterMissaoPorId(missaoId);

    if (!missao) {
        alert(`A missão "${missaoId}" não existe mais.`);
        return false;
    }

    if (!Array.isArray(missao.etapas) || missao.etapas.length === 0) {
        alert(`A missão "${missaoId}" não possui etapas.`);
        return false;
    }

    // --------------------------------------------------------
    // Segurança
    // --------------------------------------------------------

    if (!verificarSegurancaDuranteMissao(agvId)) {

        alert(
            "Não é possível carregar a missão.\n\n" +
            "Verifique se o AGV está ligado, online e sem condição de segurança ativa."
        );

        return false;
    }

    // --------------------------------------------------------
    // Prepara missão para o ESP
    // --------------------------------------------------------

    const resultado = prepararMissaoParaESP(
        agvId,
        missaoId
    );

    if (!resultado.sucesso) {

        alert(
            "Não foi possível preparar a missão.\n\n" +
            resultado.erro
        );

        return false;
    }

    // --------------------------------------------------------
    // Envia missão para o ESP
    // --------------------------------------------------------

    publicar(
        TOPICOS.comando.carregarMissao,
        JSON.stringify(resultado.pacote),
        agv.id
    );

    // --------------------------------------------------------
    // Missão apenas CARREGADA
    // --------------------------------------------------------

    agv.missaoSelecionada = missaoId;
    agv.missaoCarregada = missaoId;
    agv.estadoMissao = "CARREGADA";
    agv.progresso = 0;

    salvarAgvsFrota();

    atualizarPainel();
    renderizarControleFilaAGV();

    console.log(
        "Missão carregada no AGV:",
        agv.id,
        missaoId
    );

    return true;
}

function adicionarMissaoFila() {

    const agv = agvAtual();

    if (!agv) {
        return;
    }

    const missaoId = agv.missaoSelecionada;

    if (!missaoId) {
        alert("Selecione uma missão primeiro.");
        return;
    }

    const missao = obterMissaoPorId(missaoId);

    if (!missao) {
        alert("A missão selecionada não existe.");
        return;
    }

    if (!Array.isArray(agv.filaMissoes)) {
        agv.filaMissoes = [];
    }

    agv.filaMissoes.push(missaoId);

    salvarAgvsFrota();

    renderizarControleFilaAGV();
}


function iniciarProximaMissaoFila(agvId) {

    const agv = agvs[agvId];

    if (!agv) {
        return;
    }


    if (execucoesMissoes[agvId]) {
        return;
    }


    if (!Array.isArray(agv.filaMissoes)) {
        agv.filaMissoes = [];
    }


    while (agv.filaMissoes.length > 0) {

        const proximaMissaoId = agv.filaMissoes.shift();

        const missao = obterMissaoPorId(proximaMissaoId);

        // Missão apagada → ignora e procura a próxima
        if (!missao) {
            continue;
        }


        agv.missaoSelecionada = proximaMissaoId;

        salvarAgvsFrota();

        renderizarControleFilaAGV();


        const iniciou = iniciarMissaoPorId(
            agvId,
            proximaMissaoId
        );


        if (iniciou) {
            return;
        }
    }


    salvarAgvsFrota();

    renderizarControleFilaAGV();
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


function executarProximaEtapaMissao(agvId) {

    const agv = agvs[agvId];

    const execucao = execucoesMissoes[agvId];

    if (!agv || !execucao) {
        return;
    }


    // --------------------------------------------------------
    // Segurança
    // --------------------------------------------------------

    if (!verificarSegurancaDuranteMissao(agvId)) {

        agv.estadoMissao = "AGUARDANDO_REARME";
        agv.maquina = "AGUARDANDO_REARME";
        agv.velocidade = 0;

        cancelarSimulacaoAGV(agvId);

        atualizarPainel();

        return;
    }


    const missao = obterMissaoPorId(execucao.missaoId);

    if (!missao) {

        finalizarMissaoComErro(
            agvId,
            "A missão não foi encontrada."
        );

        return;
    }


    // --------------------------------------------------------
    // Fim da missão
    // --------------------------------------------------------

    if (
        execucao.indiceEtapa >=
        missao.etapas.length
    ) {

        finalizarMissao(agvId);

        return;
    }


    const etapa =
        missao.etapas[execucao.indiceEtapa];


    execucao.etapaAtual = etapa;


    // --------------------------------------------------------
    // Atualiza progresso
    // --------------------------------------------------------

    agv.progresso =
        Math.round(
            (execucao.indiceEtapa /
            missao.etapas.length) * 100
        );


    atualizarPainel();


    // --------------------------------------------------------
    // Executa tipo da etapa
    // --------------------------------------------------------

    switch (etapa.tipo) {

        case "IR_PARA":
            executarEtapaIrPara(agvId, etapa);
            break;

        case "AGUARDAR":
            executarEtapaAguardar(agvId, etapa);
            break;

        case "AGUARDAR_CONFIRMACAO":
            executarEtapaAguardarConfirmacao(agvId, etapa);
            break;

        case "CARREGAR":
            executarEtapaCarregar(agvId, etapa);
            break;

        case "DESCARREGAR":
            executarEtapaDescarregar(agvId, etapa);
            break;

        default:

            finalizarMissaoComErro(
                agvId,
                `Tipo de etapa desconhecido: ${etapa.tipo}`
            );

            break;
    }
}
function prepararMissaoParaESP(agvId, missaoId) {

    const agv = agvs[agvId];

    if (!agv) {
        return {
            sucesso: false,
            erro: "AGV não encontrado."
        };
    }

    const missao =
        obterMissaoPorId(missaoId);

    if (!missao) {
        return {
            sucesso: false,
            erro: `Missão "${missaoId}" não encontrada.`
        };
    }

    if (
        !Array.isArray(missao.etapas) ||
        missao.etapas.length === 0
    ) {
        return {
            sucesso: false,
            erro: `A missão "${missaoId}" não possui etapas.`
        };
    }

    /*
     * Descobre o ponto físico inicial do AGV.
     */
    let pontoAtualSimulado =
        obterPontoEstacaoDoAGV(agv);

    if (!pontoAtualSimulado) {

        return {
            sucesso: false,
            erro:
                "Não foi possível identificar a estação atual do AGV."
        };
    }

    /*
     * A orientação começa exatamente como a orientação
     * atual do AGV.
     */
    let orientacaoSimulada =
        normalizarAngulo(agv.orientacao);

    const etapasPreparadas = [];

    for (
        let indice = 0;
        indice < missao.etapas.length;
        indice++
    ) {

        const etapa =
            missao.etapas[indice];

        if (etapa.tipo === "IR_PARA") {

            /*
             * Criamos uma cópia temporária do AGV.
             *
             * IMPORTANTE:
             * agora usamos explicitamente o ID do ponto
             * físico atual.
             */
            const agvTemporario = {

                ...agv,

                estacaoAtual:
                    pontoAtualSimulado.id,

                pontoAtual:
                    pontoAtualSimulado.id,

                orientacao:
                    orientacaoSimulada
            };

            const resultado =
                prepararEtapaIrPara(
                    agvTemporario,
                    etapa
                );

            if (!resultado || !resultado.sucesso) {

                return {
                    sucesso: false,

                    erro:
                        resultado?.erro ||
                        `Não foi possível preparar a etapa ${indice}.`
                };
            }

            /*
             * Caso origem e destino sejam iguais.
             */
            if (resultado.concluidaImediatamente) {

                etapasPreparadas.push({

                    indice: indice,

                    tipo: "MOVIMENTO",

                    origem:
                        resultado.contexto.origem,

                    destino:
                        resultado.contexto.destino,

                    rota:
                        resultado.contexto.rota,

                    trechos: [],

                    orientacaoInicial:
                        resultado.contexto.orientacaoInicial,

                    orientacaoFinal:
                        resultado.contexto.orientacaoFinal
                });

                /*
                 * Atualiza o ponto físico simulado.
                 */
                pontoAtualSimulado =
                    plantaOperacional.pontos.find(
                        ponto =>
                            ponto.id ===
                            resultado.contexto.destino
                    );

                orientacaoSimulada =
                    normalizarAngulo(
                        resultado.contexto.orientacaoFinal
                    );

                continue;
            }

            const instrucao =
                resultado.contexto.instrucao;

            etapasPreparadas.push({

                indice: indice,

                tipo: "MOVIMENTO",

                origem:
                    resultado.contexto.origem,

                destino:
                    resultado.contexto.destino,

                rota:
                    resultado.contexto.rota,

                trechos:
                    instrucao.trechos,

                orientacaoInicial:
                    instrucao.orientacaoInicial,

                orientacaoFinal:
                    instrucao.orientacaoFinal
            });

            /*
             * =====================================================
             * ATUALIZAÇÃO DO ESTADO SIMULADO
             * =====================================================
             *
             * A etapa terminou no destino.
             *
             * Exemplo:
             *
             * E01 → E03
             *
             * Agora o AGV simulado está em E03.
             */
            pontoAtualSimulado =
                plantaOperacional.pontos.find(
                    ponto =>
                        ponto.id ===
                        resultado.contexto.destino
                );

            if (!pontoAtualSimulado) {

                return {
                    sucesso: false,

                    erro:
                        `Ponto de destino "${resultado.contexto.destino}" ` +
                        `não encontrado na planta operacional.`
                };
            }

            /*
             * A orientação final desta etapa passa a ser
             * a orientação inicial da próxima.
             */
            orientacaoSimulada =
                normalizarAngulo(
                    instrucao.orientacaoFinal
                );

            continue;
        }

        /*
         * Outras etapas permanecem preservadas.
         */
        etapasPreparadas.push({

            indice: indice,

            ...etapa
        });
    }

    return {

        sucesso: true,

        pacote: {

            tipo: "CARREGAR_MISSAO",

            missao:
                missao.id,

            etapas:
                etapasPreparadas
        }
    };
}
function enviarMissaoParaESP(agvId, missaoId) {

    const agv = agvs[agvId];

    if (!agv) {
        console.error("AGV não encontrado:", agvId);
        return;
    }

    /*
     * 1. Verifica a conexão MQTT
     */
    if (
        !clienteMQTT ||
        !clienteMQTT.connected
    ) {
        console.error(
            "Não é possível enviar a missão: MQTT desconectado."
        );

        return;
    }

    /*
     * 2. Prepara a missão completa
     */
    const resultado =
        prepararMissaoParaESP(
            agvId,
            missaoId
        );

    if (!resultado.sucesso) {

        console.error(
            "Erro ao preparar missão:",
            resultado.erro
        );

        return;
    }

    /*
     * 3. Converte o pacote para JSON
     */
    const payload =
        JSON.stringify(
            resultado.pacote
        );

    /*
     * 4. Publica no tópico do AGV
     */
    console.log(
        "Publicando missão:",
        missaoId
    );

    publicar(
        "comando/carregar_missao",
        payload,
        agv.id
    );

    /*
     * 5. Mostra o conteúdo preparado
     */
    console.log(
        "Pacote preparado para publicação:",
        JSON.parse(payload)
    );
}
function executarEtapaIrPara(agvId, etapa) {

    const agv = agvs[agvId];

    const execucao = execucoesMissoes[agvId];

    if (!agv || !execucao) {
        return;
    }


    const resultado =
    prepararEtapaIrPara(
        agv,
        etapa
    );


    if (!resultado) {

        finalizarMissaoComErro(
            agvId,
            `Não foi possível calcular a rota até ${etapa.destino}.`
        );

        return;
    }


    execucao.contextoMovimento =
        resultado.contexto;


    agv.destino =
        resultado.contexto.destino;


    atualizarPainel();


    // --------------------------------------------------------
    // Comando MQTT
    // --------------------------------------------------------

    if (!agv.demoOnline) {

        publicar(
            "comando/etapa",

            JSON.stringify({

                tipo: "MOVIMENTO",

                missao: execucao.missaoId,

                etapa: execucao.indiceEtapa,

                destino:
                    resultado.contexto.destino,

                rota:
                    resultado.contexto.rota,

                rfids:
                    resultado.contexto.instrucao.rfids,

                manobras:
                    resultado.contexto.instrucao.manobras,

                orientacaoInicial:
                    resultado.contexto.orientacaoInicial,

                orientacaoFinal:
                    resultado.contexto.orientacaoFinal
            }),

            agv.id
        );
    }


    // --------------------------------------------------------
    // SIMULAÇÃO LOCAL
    // --------------------------------------------------------

    if (agv.demoOnline) {

        simularMovimentoRota(
            agvId,
            resultado.contexto,
            () => {

                concluirEtapaMissao(agvId);
            }
        );

        return;
    }


    // --------------------------------------------------------
    // MODO REAL
    //
    // O ESP executará a rota e depois enviará
    // ETAPA_CONCLUIDA.
    // --------------------------------------------------------
}


function executarEtapaAguardar(agvId, etapa) {

    const execucao = execucoesMissoes[agvId];

    if (!execucao) {
        return;
    }


    const tempo =
        Number(etapa.tempo || etapa.duracao || 0);


    execucao.aguardando = true;



    execucoesMissoes[agvId].timer =
    setTimeout(() => {

        execucoesMissoes[agvId].timer = null;

        if (!verificarSegurancaDuranteMissao(agvId)) {
            return;
        }

        concluirEtapaMissao(agvId);

    }, Math.max(0, tempo * 1000));
}


function executarEtapaAguardarConfirmacao(agvId, etapa) {

    const execucao = execucoesMissoes[agvId];

    if (!execucao) {
        return;
    }

    execucao.aguardandoConfirmacao = true;

    atualizarPainel();
}


function executarEtapaCarregar(agvId, etapa) {

    const agv = agvs[agvId];

    if (!agv) {
        return;
    }


    if (!agv.demoOnline) {

        publicar(
            "comando/etapa",

            JSON.stringify({

                tipo: "CARREGAR",

                missao:
                    execucoesMissoes[agvId].missaoId,

                etapa:
                    execucoesMissoes[agvId].indiceEtapa
            }),

            agv.id
        );

        return;
    }


    const execucao = execucoesMissoes[agvId];

if (!execucao) {
    return;
}

execucao.timer = setTimeout(() => {

    execucao.timer = null;

    if (!verificarSegurancaDuranteMissao(agvId)) {
        return;
    }

    concluirEtapaMissao(agvId);

}, 1000);
}


function executarEtapaDescarregar(agvId, etapa) {

    const agv = agvs[agvId];

    if (!agv) {
        return;
    }


    if (!agv.demoOnline) {

        publicar(
            "comando/etapa",

            JSON.stringify({

                tipo: "DESCARREGAR",

                missao:
                    execucoesMissoes[agvId].missaoId,

                etapa:
                    execucoesMissoes[agvId].indiceEtapa
            }),

            agv.id
        );

        return;
    }


    const execucao = execucoesMissoes[agvId];

if (!execucao) {
    return;
}

execucao.timer = setTimeout(() => {

    execucao.timer = null;

    if (!verificarSegurancaDuranteMissao(agvId)) {
        return;
    }

    concluirEtapaMissao(agvId);

}, 1000);
}


function confirmarExecucaoEtapaMissao() {

    const agv = agvAtual();

    if (!agv) {
        return;
    }

    const execucao =
        execucoesMissoes[agv.id];

    if (!execucao) {
        return;
    }

    if (!execucao.aguardandoConfirmacao) {
        return;
    }

    execucao.aguardandoConfirmacao = false;

    concluirEtapaMissao(agv.id);
}

function concluirEtapaMissao(agvId) {

    const agv = agvs[agvId];

    const execucao =
        execucoesMissoes[agvId];


    if (!agv || !execucao) {
        return;
    }


    const etapa = execucao.etapaAtual;


    // --------------------------------------------------------
    // Se terminou um IR_PARA
    // --------------------------------------------------------

    if (
        etapa &&
        etapa.tipo === "IR_PARA" &&
        execucao.contextoMovimento
    ) {

        const destinoId =
            execucao.contextoMovimento.destino;


        const pontoDestino =
            plantaOperacional.pontos.find(
                p => p.id === destinoId
            );


        if (pontoDestino) {

            atualizarPontoAtualAGV(
                agv,
                pontoDestino
            );
        }


        agv.orientacao =
            execucao.contextoMovimento.orientacaoFinal;


        agv.velocidade = 0;


        execucao.contextoMovimento = null;
    }


    if (execucao.timer) {

        clearTimeout(execucao.timer);

        execucao.timer = null;
    }


    execucao.aguardando = false;
    execucao.aguardandoConfirmacao = false;


    execucao.indiceEtapa++;


    const missao = obterMissaoPorId(execucao.missaoId);

if (!missao) {
    finalizarMissaoComErro(
        agvId,
        "A missão em execução não existe mais."
    );
    return;
}
agv.progresso =
    Math.round(
        (execucao.indiceEtapa / missao.etapas.length) * 100
    );


    atualizarPainel();


    executarProximaEtapaMissao(agvId);
}


function processarEventoMissao(agvId, evento) {

    const agv = agvs[agvId];

    const execucao =
        execucoesMissoes[agvId];


    if (!agv || !execucao) {
        return;
    }


    // Demo não depende do ESP para concluir etapas
    if (agv.demoOnline) {
        return;
    }


    if (evento === "ETAPA_CONCLUIDA") {

        concluirEtapaMissao(agvId);

        return;
    }


    if (
        evento === "ETAPA_ERRO" ||
        evento === "MISSAO_ERRO"
    ) {

        finalizarMissaoComErro(
            agvId,
            "O ESP informou erro na execução da missão."
        );
    }
}


function finalizarMissao(agvId) {

    const agv = agvs[agvId];

    const execucao =
        execucoesMissoes[agvId];


    if (!agv || !execucao) {
        return;
    }


    cancelarSimulacaoAGV(agvId);


    if (execucao.timer) {

        clearTimeout(execucao.timer);

        execucao.timer = null;
    }


    agv.velocidade = 0;

    agv.progresso = 100;

    agv.estadoMissao = "CONCLUIDA";

    agv.maquina = "PRONTO";

    agv.missaoAtual = null;


   


    delete execucoesMissoes[agvId];


    salvarAgvsFrota();

    atualizarPainel();

    renderizarControleFilaAGV();


    // --------------------------------------------------------
    // Próxima missão automaticamente
    // --------------------------------------------------------

    if (
        Array.isArray(agv.filaMissoes) &&
        agv.filaMissoes.length > 0
    ) {

        setTimeout(() => {

            iniciarProximaMissaoFila(agvId);

        }, 100);
    }
}


function finalizarMissaoComErro(agvId, mensagem) {

    const agv = agvs[agvId];

    const execucao =
        execucoesMissoes[agvId];


    if (!agv) {
        return;
    }


    cancelarSimulacaoAGV(agvId);


    if (execucao && execucao.timer) {

        clearTimeout(execucao.timer);

        execucao.timer = null;
    }


    agv.velocidade = 0;

    agv.estadoMissao = "ERRO";

    agv.maquina = "PRONTO";

    agv.missaoAtual = null;


    


    delete execucoesMissoes[agvId];


    salvarAgvsFrota();

    atualizarPainel();

    renderizarControleFilaAGV();


    if (mensagem) {
        alert(mensagem);
    }
}


function verificarSegurancaDuranteMissao(agvId) {

    const agv = agvs[agvId];

    if (!agv) {
        return false;
    }


    if (!agv.online) {
        return false;
    }


    if (agv.ligado !== "LIGADO") {
        return false;
    }


    if (agv.emergencia) {
        return false;
    }


    if (agv.stop !== "NORMAL") {
        return false;
    }


    if (agv.barreira === "INVADIDA") {
        return false;
    }


    return true;
}
// ============================================================
// SIMULAÇÃO DO AGV NA PLANTA REAL
// ============================================================


function cancelarSimulacaoAGV(agvId) {

    const simulacao =
        simulacoesAGV[agvId];

    if (!simulacao) {
        return;
    }


    if (simulacao.animationFrame) {

        cancelAnimationFrame(
            simulacao.animationFrame
        );
    }


    delete simulacoesAGV[agvId];
}


function simularMovimentoRota(
    agvId,
    contexto,
    aoConcluir
) {

    const agv = agvs[agvId];

    if (!agv || !contexto) {
        return;
    }


    const rota =
        contexto.rota;


    if (
        !Array.isArray(rota) ||
        rota.length === 0
    ) {

        aoConcluir();

        return;
    }


    // --------------------------------------------------------
    // Cancela uma simulação anterior
    // --------------------------------------------------------

    cancelarSimulacaoAGV(agvId);


    // --------------------------------------------------------
    // Localiza pontos da rota
    // --------------------------------------------------------

    const pontosRota =
        rota
            .map(id =>
                plantaOperacional.pontos.find(
                    p => p.id === id
                )
            )
            .filter(Boolean);


    if (pontosRota.length === 0) {

        aoConcluir();

        return;
    }


    // --------------------------------------------------------
    // Posiciona o AGV no primeiro ponto
    // --------------------------------------------------------

    const pontoInicial =
        pontosRota[0];


    atualizarPontoAtualAGV(
        agv,
        pontoInicial
    );


    agv.orientacao =
        contexto.orientacaoInicial;


    renderizarAGVMapaVisaoGeral();


    // --------------------------------------------------------
    // Caso origem == destino
    // --------------------------------------------------------

    if (pontosRota.length === 1) {

        agv.velocidade = 0;

        setTimeout(() => {

            aoConcluir();

        }, 300);

        return;
    }


    // --------------------------------------------------------
    // Estado da animação
    // --------------------------------------------------------

    const simulacao = {

        pontos: pontosRota,

        indiceTrecho: 0,

        progressoTrecho: 0,

        animationFrame: null,

        inicioTrecho: null
    };


    simulacoesAGV[agvId] =
        simulacao;


    executarTrechoSimulado(
        agvId,
        contexto,
        aoConcluir
    );
}


function executarTrechoSimulado(
    agvId,
    contexto,
    aoConcluir
) {

    const agv = agvs[agvId];

    const simulacao =
        simulacoesAGV[agvId];


    if (!agv || !simulacao) {
        return;
    }


    // --------------------------------------------------------
    // Segurança a cada frame
    // --------------------------------------------------------

    if (!verificarSegurancaDuranteMissao(agvId)) {

        if (simulacao.animationFrame) {

            cancelAnimationFrame(
                simulacao.animationFrame
            );
        }


        const pontoAtual =
            simulacao.pontos[
                simulacao.indiceTrecho
            ];


        // Para o AGV no último ponto conhecido
        if (pontoAtual) {

            atualizarPontoAtualAGV(
                agv,
                pontoAtual
            );
        }


        agv.velocidade = 0;

        agv.estadoMissao =
            "AGUARDANDO_REARME";

        agv.maquina =
            "AGUARDANDO_REARME";

        simulacao.animationFrame = null;


        renderizarAGVMapaVisaoGeral();

        atualizarPainel();

        return;
    }


    // --------------------------------------------------------
    // Verifica se terminou todos os trechos
    // --------------------------------------------------------

    if (
        simulacao.indiceTrecho >=
        simulacao.pontos.length - 1
    ) {

        const ultimoPonto =
            simulacao.pontos[
                simulacao.pontos.length - 1
            ];


        atualizarPontoAtualAGV(
            agv,
            ultimoPonto
        );


        agv.orientacao =
            contexto.orientacaoFinal;


        agv.velocidade = 0;


        renderizarAGVMapaVisaoGeral();


        delete simulacoesAGV[agvId];


        setTimeout(() => {

            aoConcluir();

        }, 100);


        return;
    }


    const pontoA =
        simulacao.pontos[
            simulacao.indiceTrecho
        ];


    const pontoB =
        simulacao.pontos[
            simulacao.indiceTrecho + 1
        ];


    // --------------------------------------------------------
    // Define direção do trecho
    // --------------------------------------------------------

    const dx =
        pontoB.x - pontoA.x;

    const dy =
        pontoB.y - pontoA.y;


    let angulo;


    if (Math.abs(dx) >= Math.abs(dy)) {

        angulo =
            dx >= 0 ? 0 : 180;

    } else {

        angulo =
            dy < 0 ? 90 : 270;
    }


    agv.orientacao = angulo;


    // --------------------------------------------------------
    // Distância do trecho
    // --------------------------------------------------------

    const distancia =
        Math.sqrt(
            Math.pow(dx, 2) +
            Math.pow(dy, 2)
        );


    const duracao =
        Math.max(
            700,
            (distancia /
            VELOCIDADE_SIMULACAO_MAPA) *
            1000
        );


    if (simulacao.inicioTrecho === null) {

        simulacao.inicioTrecho =
            performance.now();

        simulacao.progressoTrecho = 0;
    }


    const agora =
        performance.now();


    const decorrido =
        agora -
        simulacao.inicioTrecho;


    let progresso =
        decorrido / duracao;


    progresso =
        Math.max(
            0,
            Math.min(1, progresso)
        );


    // --------------------------------------------------------
    // Interpolação da posição
    // --------------------------------------------------------

    agv.x =
        pontoA.x +
        ((pontoB.x - pontoA.x) *
        progresso);


    agv.y =
        pontoA.y +
        ((pontoB.y - pontoA.y) *
        progresso);


    agv.velocidade = 0.10;


    renderizarAGVMapaVisaoGeral();


    // --------------------------------------------------------
    // Chegou ao ponto
    // --------------------------------------------------------

    if (progresso >= 1) {

        agv.x = pontoB.x;
        agv.y = pontoB.y;


        atualizarPontoAtualAGV(
            agv,
            pontoB
        );


        agv.orientacao = angulo;


        simulacao.indiceTrecho++;

        simulacao.inicioTrecho = null;

        simulacao.progressoTrecho = 0;


        renderizarAGVMapaVisaoGeral();

    }


    simulacao.animationFrame =
        requestAnimationFrame(() => {

            executarTrechoSimulado(
                agvId,
                contexto,
                aoConcluir
            );

        });
}

function executarRearme() {

    const agv = agvAtual();

    if (!agv) {
        return;
    }

    if (
        !agv.online ||
        !agv.aguardandoRearme
    ) {
        return;
    }

    const enviado = publicar(
        TOPICOS.comando.rearme,
        "REARME",
        agv.id
    );

    if (!enviado) {
        console.error(
            "Não foi possível enviar o rearme."
        );

        return;
    }

    console.log(
        "Solicitação de REARME enviada ao AGV:",
        agv.id
    );
}

/* ============================================================
   JOYSTICK MANUAL
   ============================================================ */

// ============================================================
// LIMITES FÍSICOS DO AGV
// ============================================================

const VX_MAX = 0.10;   // velocidade longitudinal máxima (m/s)
const VY_MAX = 0.10;   // velocidade lateral máxima (m/s)
const W_MAX  = 0.524;  // velocidade angular máxima (rad/s)
// 0.524 rad/s ≈ 30°/s
// 90° ≈ 3 segundos


// ============================================================
// COMANDO MANUAL
// ============================================================

// Valores internos normalizados:
// vx = -1 até +1
// vy = -1 até +1
// w  = -1 até +1

let comandoManual = {
    vx: 0,
    vy: 0,
    w: 0
};




// ============================================================
// ESCALA DO SLIDER
// ============================================================

function obterEscalaVelocidade() {

    const slider = document.getElementById("sliderVelocidade");

    if (!slider) {
        return 0.5;
    }

    return Number(slider.value) / 100;
}


// ============================================================
// VERIFICA SE O CONTROLE MANUAL ESTÁ LIBERADO
// ============================================================

function manualPermitido() {

    const agv = agvAtual();

    if (!agv) {
        return false;
    }

    return (
    agv.online &&
    agv.ligado === "LIGADO" &&
    agv.modo === "MANUAL" &&
    agv.maquina !== "EMERGENCIA" &&
    agv.stop === "NORMAL" &&
    !agv.aguardandoRearme &&
    agv.barreira !== "INVADIDA"
);
}


// ============================================================
// INÍCIO DO JOYSTICK
// ============================================================

function iniciarJoystick(event) {

    if (!manualPermitido()) {
        return;
    }

    joystickAtivo = true;

    const joystick = document.getElementById("joystick");

    if (joystick) {
        joystick.setPointerCapture(event.pointerId);
    }

    atualizarJoystick(event);
}


// ============================================================
// MOVIMENTO DO JOYSTICK
// ============================================================

function moverJoystick(event) {

    if (!joystickAtivo) {
        return;
    }

    atualizarJoystick(event);
}


// ============================================================
// FINALIZAÇÃO DO JOYSTICK
// ============================================================

function finalizarJoystick() {
    if (!manualPermitido()) {

    comandoManual.vx = 0;
    comandoManual.vy = 0;
    comandoManual.w = 0;

    publicar(
        "comando/manual",
        JSON.stringify({
            vx: 0,
            vy: 0,
            w: 0
        })
    );

    rotacaoAtiva = false;

    return;
}

    if (!joystickAtivo) {
        return;
    }

    joystickAtivo = false;

    // Ao soltar o joystick,
    // as velocidades de translação voltam para zero.
    comandoManual.vx = 0;
    comandoManual.vy = 0;

    // Volta o botão para o centro
    const centro = document.getElementById("joystickCentro");

    if (centro) {
        centro.style.left = "50%";
        centro.style.top = "50%";
    }

    publicarManual();
    atualizarValoresJoystick();
}


// ============================================================
// CALCULA A POSIÇÃO DO JOYSTICK
// ============================================================

function atualizarJoystick(event) {

    if (!manualPermitido()) {

        finalizarJoystick();

        return;
    }

    const joystick = document.getElementById("joystick");
    const centro = document.getElementById("joystickCentro");

    if (!joystick || !centro) {
        return;
    }


    // --------------------------------------------------------
    // DIMENSÕES DO JOYSTICK
    // --------------------------------------------------------

    const rect = joystick.getBoundingClientRect();

    const centroX = rect.left + rect.width / 2;
    const centroY = rect.top + rect.height / 2;


    // --------------------------------------------------------
    // DISTÂNCIA DO DEDO/MOUSE ATÉ O CENTRO
    // --------------------------------------------------------

    let dx = event.clientX - centroX;
    let dy = event.clientY - centroY;


    // --------------------------------------------------------
    // LIMITE DO MOVIMENTO
    // --------------------------------------------------------

    const raioMax = rect.width / 2 - 35;

    const distancia = Math.sqrt(
        dx * dx +
        dy * dy
    );


    // Se ultrapassar o limite,
    // mantém o joystick na borda.

    if (distancia > raioMax) {

        dx = (dx / distancia) * raioMax;
        dy = (dy / distancia) * raioMax;

    }


    // --------------------------------------------------------
    // MOVE O BOTÃO VISUAL
    // --------------------------------------------------------

    centro.style.left =
        `calc(50% + ${dx}px)`;

    centro.style.top =
        `calc(50% + ${dy}px)`;


    // --------------------------------------------------------
    // CONVERSÃO PARA VALORES NORMALIZADOS
    // --------------------------------------------------------

    // Para cima  -> +VX
    // Para baixo -> -VX
    // Direita    -> +VY
    // Esquerda   -> -VY

    comandoManual.vx = -dy / raioMax;

    comandoManual.vy = dx / raioMax;


    // --------------------------------------------------------
    // ATUALIZA INTERFACE
    // --------------------------------------------------------

    atualizarValoresJoystick();


    // --------------------------------------------------------
    // ENVIA PARA O MQTT
    // --------------------------------------------------------

    publicarManual();
}


// ============================================================
// PUBLICAÇÃO DO COMANDO MANUAL
// ============================================================

function publicarManual() {

    if (!manualPermitido()) {
        return;
    }


    // --------------------------------------------------------
    // ESCALA DO SLIDER
    // --------------------------------------------------------

    const escala = obterEscalaVelocidade();


    // --------------------------------------------------------
    // CONVERSÃO:
    //
    // NORMALIZADO (-1 ... +1)
    //          ↓
    // VELOCIDADE FÍSICA
    // --------------------------------------------------------

    const vx =
        comandoManual.vx *
        VX_MAX *
        escala;

    const vy =
        comandoManual.vy *
        VY_MAX *
        escala;

    const w =
        comandoManual.w *
        W_MAX *
        escala;


    // --------------------------------------------------------
    // OBJETO QUE SERÁ ENVIADO AO ESP32
    // --------------------------------------------------------

    const comando = {

        vx: Number(vx.toFixed(3)),
        vy: Number(vy.toFixed(3)),
        w: Number(w.toFixed(3))

    };


    // --------------------------------------------------------
    // MQTT
    // --------------------------------------------------------

    publicar(
        "comando/manual",
        JSON.stringify(comando)
    );
}


// ============================================================
// ATUALIZA OS VALORES MOSTRADOS NA TELA
// ============================================================

function atualizarValoresJoystick() {

    const set = (id, valor) => {

        const elemento =
            document.getElementById(id);

        if (elemento) {
            elemento.textContent = valor;
        }

    };


    // --------------------------------------------------------
    // VALORES NORMALIZADOS
    // --------------------------------------------------------

    set(
        "valorVx",
        comandoManual.vx.toFixed(2)
    );

    set(
        "valorVy",
        comandoManual.vy.toFixed(2)
    );

    set(
        "valorW",
        comandoManual.w.toFixed(2)
    );


    // --------------------------------------------------------
    // VELOCIDADES FÍSICAS
    // --------------------------------------------------------

    const escala =
        obterEscalaVelocidade();


    const vx =
        comandoManual.vx *
        VX_MAX *
        escala;

    const vy =
        comandoManual.vy *
        VY_MAX *
        escala;

    const w =
        comandoManual.w *
        W_MAX *
        escala;


    set(
        "comandoVx",
        vx.toFixed(3) + " m/s"
    );

    set(
        "comandoVy",
        vy.toFixed(3) + " m/s"
    );

    set(
        "comandoW",
        w.toFixed(3) + " rad/s"
    );
}


// ============================================================
// BOTÃO DE ROTAÇÃO
// ============================================================

function iniciarRotacao(sentido) {

    if (!manualPermitido()) {
        return;
    }

    rotacaoAtiva = true;


    // sentido:
    // -1 = anti-horário
    // +1 = horário

    comandoManual.w = sentido;


    publicarManual();
    atualizarValoresJoystick();


    // Atualiza seta visual

    const seta =
        document.getElementById("rotacaoSeta");

    if (seta) {

        seta.style.transform =
            `rotate(${sentido < 0 ? -90 : 90}deg)`;

    }
}


// ============================================================
// PARAR ROTAÇÃO
// ============================================================

function pararRotacao() {

    rotacaoAtiva = false;

    comandoManual.w = 0;

    publicarManual();
    atualizarValoresJoystick();


    const seta =
        document.getElementById("rotacaoSeta");

    if (seta) {

        seta.style.transform =
            "rotate(0deg)";

    }
}


// ============================================================
// EVENTOS DO JOYSTICK
// ============================================================

document
    .getElementById("joystick")
    ?.addEventListener(
        "pointerdown",
        iniciarJoystick
    );


window.addEventListener(
    "pointermove",
    moverJoystick
);


window.addEventListener(
    "pointerup",
    finalizarJoystick
);


// ============================================================
// SLIDER DE VELOCIDADE
// ============================================================

document
    .getElementById("sliderVelocidade")
    ?.addEventListener(
        "input",
        function () {

            const texto =
                document.getElementById(
                    "velocidadeManualTexto"
                );

            if (texto) {

                texto.textContent =
                    this.value + "%";

            }


            atualizarValoresJoystick();


            // Se estiver movimentando,
            // envia imediatamente o novo valor.

            if (joystickAtivo || rotacaoAtiva) {

                publicarManual();

            }

        }
    );
/* ============================================================
   RELÓGIO / INICIALIZAÇÃO
   ============================================================ */

function atualizarRelogio() {
    const agora = new Date();
    document.getElementById("relogio").textContent = agora.toLocaleTimeString("pt-BR");
}

renderizarFrota();
atualizarPainel();
atualizarValoresJoystick();
atualizarRelogio();
conectarMQTT();
setInterval(atualizarRelogio, 1000);
setInterval(atualizarOnline, 2000);

function abrirCadastroAGV() {
    document.getElementById("modalAdicionarAGV").classList.add("ativo");

    document.getElementById("novoAgvId").value = "";
    document.getElementById("novoAgvNome").value = "";

    document.getElementById("novoAgvId").focus();
}

function fecharCadastroAGV() {
    document.getElementById("modalAdicionarAGV").classList.remove("ativo");
}
function abrirEdicaoAGV(id) {

    const agv = agvs[id];

    if (!agv) return;

    agvEmEdicao = id;

    document.getElementById("novoAgvId").value = agv.id;
    document.getElementById("novoAgvNome").value = agv.nome;

    document.getElementById("modalAdicionarAGV").classList.add("ativo");

    document.getElementById("novoAgvId").focus();
}
function adicionarAGV() {

    const id = document.getElementById("novoAgvId").value.trim();
    const nome = document.getElementById("novoAgvNome").value.trim();

    if (!id || !nome) {
        alert("Preencha o ID e o nome do AGV.");
        return;
    }

    // =========================
    // MODO EDIÇÃO
    // =========================

    if (agvEmEdicao !== null) {

        const idAntigo = agvEmEdicao;

        if (id !== idAntigo && agvs[id]) {
            alert(`O AGV ${id} já está cadastrado.`);
            return;
        }

        const dadosAGV = agvs[idAntigo];

        delete agvs[idAntigo];

        dadosAGV.id = id;
        dadosAGV.nome = nome;

        agvs[id] = dadosAGV;

        if (agvSelecionado === idAntigo) {
            agvSelecionado = id;
        }

        agvEmEdicao = null;

        localStorage.setItem(
            "agvsFrota",
            JSON.stringify(agvs)
        );

        renderizarFrota();
        atualizarPainel();
        fecharCadastroAGV();

        console.log("AGV editado:", agvs[id]);

        return;
    }

    // =========================
    // MODO ADIÇÃO
    // =========================

    if (agvs[id]) {
        alert(`O AGV ${id} já está cadastrado.`);
        return;
    }

    agvs[id] = criarAGV(id, nome);

    localStorage.setItem(
        "agvsFrota",
        JSON.stringify(agvs)
    );

    renderizarFrota();

    fecharCadastroAGV();

    console.log("Novo AGV cadastrado:", agvs[id]);
}
function excluirAGV(id) {

    const agv = agvs[id];

    if (!agv) return;

    const confirmar = confirm(
        `Deseja realmente excluir o AGV ${agv.id} — ${agv.nome}?`
    );

    if (!confirmar) return;

    delete agvs[id];

    localStorage.setItem(
        "agvsFrota",
        JSON.stringify(agvs)
    );

    if (agvSelecionado === id) {
        agvSelecionado = null;
        voltarFrota();
    }

    renderizarFrota();

    console.log("AGV excluído:", id);
}
/* ============================================================
   DRAG & DROP — SIDEBAR → MAPA
   ============================================================ */

const mapaPlanta =
    document.getElementById("mapaPlanta");

mapaPlanta?.addEventListener(
    "dragover",
    permitirDropMapa
);

mapaPlanta?.addEventListener(
    "drop",
    soltarPontoMapa
);