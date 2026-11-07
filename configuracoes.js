/* ============================================================
   CONFIGURAÇÕES, CALIBRAÇÃO, ATUALIZAÇÃO E HISTÓRICO
   ============================================================
   Os parâmetros, limites e valores padrão vêm do próprio AGV
   (status/configuracao/esquema). Aqui ficam só os nomes amigáveis,
   unidades, explicações e a organização em seções.
*/

const SECOES_CONFIG = [
    { id: "linha", titulo: "Seguidor de linha", descricao: "PID do QTR-8A e o que fazer quando a linha some." },
    { id: "movimento", titulo: "Movimento", descricao: "Velocidades, rampas e manobras." },
    { id: "mecanica", titulo: "Mecânica e cinemática", descricao: "Medidas do AGV e sentido de cada motor. Use o assistente de calibração." },
    { id: "seguranca", titulo: "Segurança e rota", descricao: "Barreira dos VL53 e limites dos trechos." },
    { id: "garra", titulo: "Garra", descricao: "Curso e velocidade do motor 5." },
    { id: "leds", titulo: "LEDs", descricao: "Quantidade, brilho e ordem das cores das duas fitas." },
    { id: "frota", titulo: "Frota e fila", descricao: "Partida automática da fila, saída do ponto para outro AGV e obstáculos na missão." }
];

const PARAMETROS_SITE = {
    KP_QTR: { secao: "linha", rotulo: "Kp", ajuda: "Ganho proporcional. Aumente se o AGV demora a voltar para a linha." },
    KI_QTR: { secao: "linha", rotulo: "Ki", ajuda: "Ganho integral. Normalmente pequeno ou zero." },
    KD_QTR: { secao: "linha", rotulo: "Kd", ajuda: "Ganho derivativo. Aumente se o AGV fica balançando na linha." },
    MODO_CORRECAO_QTR: { secao: "linha", rotulo: "Corrigir a linha com", tipo: "opcoes", opcoes: [[0, "Rotação (recomendado)"], [1, "Movimento lateral"], [2, "Rotação + lateral"]] },
    CORRECAO_ANGULAR_MAX: { secao: "linha", rotulo: "Correção angular máxima", unidade: "rad/s" },
    CORRECAO_LATERAL_MAX: { secao: "linha", rotulo: "Correção lateral máxima", unidade: "m/s" },
    SINAL_CORRECAO_QTR: { secao: "linha", rotulo: "Sentido da correção", tipo: "sinal", ajuda: "Inverta se o AGV foge da linha em vez de seguir (sensor montado ao contrário)." },
    LINHA_CLARA: { secao: "linha", rotulo: "Linha clara em piso escuro", tipo: "booleano" },
    TEMPO_MAX_SEM_LINHA_MS: { secao: "linha", rotulo: "Tempo máximo sem linha", unidade: "ms" },
    ERRO_LINHA_CENTRADA: { secao: "linha", rotulo: "Tolerância para linha centrada", unidade: "", ajuda: "Usada ao terminar uma manobra (0 a 3500)." },
    DISTANCIA_QTR_CENTRO: { secao: "linha", rotulo: "Distância QTR → centro do AGV", unidade: "m", ajuda: "Nos últimos centímetros do trecho o QTR já passou do ponto e pode não ver linha." },

    VELOCIDADE_MAXIMA: { secao: "movimento", rotulo: "Velocidade máxima", unidade: "m/s" },
    FRACAO_CRUZEIRO: { secao: "movimento", rotulo: "Velocidade de cruzeiro", unidade: "× máx." },
    FRACAO_APROXIMACAO: { secao: "movimento", rotulo: "Velocidade de aproximação", unidade: "× máx.", ajuda: "Nos últimos 15 cm antes de um ponto." },
    W_MANOBRA: { secao: "movimento", rotulo: "Velocidade de giro", unidade: "rad/s" },
    W_BUSCA_LINHA: { secao: "movimento", rotulo: "Giro procurando a linha", unidade: "rad/s" },
    ACELERACAO_LINEAR: { secao: "movimento", rotulo: "Aceleração linear", unidade: "m/s²", ajuda: "Rampa de partida e parada normal. Paradas de segurança são sempre imediatas." },
    ACELERACAO_ANGULAR: { secao: "movimento", rotulo: "Aceleração angular", unidade: "rad/s²" },
    FRACAO_MANUAL_LATERAL_RE: { secao: "movimento", rotulo: "Lateral e ré no manual", unidade: "× comando", ajuda: "Os VL53 só olham para a frente: lateral e ré ficam mais lentas." },
    BUSCAR_LINHA_MANOBRA: { secao: "movimento", rotulo: "Terminar a manobra pela linha", tipo: "booleano", ajuda: "Gira até o QTR encontrar a linha nova (recomendado)." },

    BRACO_ROTACIONAL: { secao: "mecanica", rotulo: "Braço rotacional", unidade: "m", ajuda: "(Distância entre eixos + bitola) / 2. Calibre com o GIRO 360°." },
    RAIO_RODA: { secao: "mecanica", rotulo: "Raio da roda", unidade: "m", ajuda: "Calibre com a RETA de 1 m." },
    MICROSTEP: { secao: "mecanica", rotulo: "Microstep dos drivers", tipo: "opcoes", opcoes: [[1, "1 (passo cheio)"], [2, "1/2"], [4, "1/4"], [8, "1/8"], [16, "1/16"]] },
    INVERTER_M1: { secao: "mecanica", rotulo: "Inverter M1 (frente-dir.)", tipo: "booleano" },
    INVERTER_M2: { secao: "mecanica", rotulo: "Inverter M2 (frente-esq.)", tipo: "booleano" },
    INVERTER_M3: { secao: "mecanica", rotulo: "Inverter M3 (trás-dir.)", tipo: "booleano" },
    INVERTER_M4: { secao: "mecanica", rotulo: "Inverter M4 (trás-esq.)", tipo: "booleano" },
    M1_VX: { secao: "mecanica", rotulo: "M1 · frente", tipo: "sinal", avancado: true },
    M1_VY: { secao: "mecanica", rotulo: "M1 · lateral", tipo: "sinal", avancado: true },
    M1_W: { secao: "mecanica", rotulo: "M1 · giro", tipo: "sinal", avancado: true },
    M2_VX: { secao: "mecanica", rotulo: "M2 · frente", tipo: "sinal", avancado: true },
    M2_VY: { secao: "mecanica", rotulo: "M2 · lateral", tipo: "sinal", avancado: true },
    M2_W: { secao: "mecanica", rotulo: "M2 · giro", tipo: "sinal", avancado: true },
    M3_VX: { secao: "mecanica", rotulo: "M3 · frente", tipo: "sinal", avancado: true },
    M3_VY: { secao: "mecanica", rotulo: "M3 · lateral", tipo: "sinal", avancado: true },
    M3_W: { secao: "mecanica", rotulo: "M3 · giro", tipo: "sinal", avancado: true },
    M4_VX: { secao: "mecanica", rotulo: "M4 · frente", tipo: "sinal", avancado: true },
    M4_VY: { secao: "mecanica", rotulo: "M4 · lateral", tipo: "sinal", avancado: true },
    M4_W: { secao: "mecanica", rotulo: "M4 · giro", tipo: "sinal", avancado: true },

    DISTANCIA_BARREIRA: { secao: "seguranca", rotulo: "Barreira em automático", unidade: "mm", ajuda: "Estações e trechos do mapa podem usar uma distância própria." },
    DISTANCIA_BARREIRA_MANUAL: { secao: "seguranca", rotulo: "Barreira no manual", unidade: "mm", ajuda: "Campo reduzido para tirar o AGV de perto de uma máquina." },
    FATOR_TOLERANCIA_TRECHO: { secao: "seguranca", rotulo: "Tolerância do comprimento do trecho", unidade: "×", ajuda: "Se a tag de chegada não aparecer até comprimento × fator + 10 cm, o AGV para com erro." },
    TEMPO_MAX_TRECHO_S: { secao: "seguranca", rotulo: "Tempo máximo por trecho", unidade: "s" },
    AVANCO_APOS_RFID: { secao: "seguranca", rotulo: "Avanço depois da tag", unidade: "m", ajuda: "Para compensar se o leitor detecta a tag antes do centro." },
    IGNORAR_RFID_SAIDA: { secao: "seguranca", rotulo: "Ignorar tags na saída do ponto", unidade: "m" },

    GARRA_CURSO: { secao: "garra", rotulo: "Curso da garra", unidade: "passos", ajuda: "0 = garra desativada." },
    GARRA_FREQUENCIA: { secao: "garra", rotulo: "Velocidade da garra", unidade: "passos/s" },

    VELOCIDADE_LATERAL: { secao: "movimento", rotulo: "Velocidade da troca lateral", unidade: "m/s", ajuda: "Na troca de faixa sem fita o AGV anda de lado, sem os sensores de distância: mantenha devagar." },
    PERDER_POSICAO_MANUAL: { secao: "seguranca", rotulo: "Esquecer a posição ao mover no manual", tipo: "booleano", ajuda: "Recomendado. Mover mais de 3 cm ou 3° no manual deixa a posição desconhecida até informar de novo." },

    LEDS_FITA_ESTADO: { secao: "leds", rotulo: "LEDs da fita 1 (pino 15)", unidade: "LEDs", ajuda: "As duas fitas mostram a mesma cor. Reinicia o AGV para valer." },
    LEDS_FITA_COMUNICACAO: { secao: "leds", rotulo: "LEDs da fita 2 (pino 26)", unidade: "LEDs", ajuda: "Mesma cor da fita 1. Reinicia o AGV para valer." },
    LEDS_BRILHO: { secao: "leds", rotulo: "Brilho", unidade: "0–255", ajuda: "As fitas consomem bastante: 80 já é bem visível no galpão." },
    LEDS_ORDEM_CORES: { secao: "leds", rotulo: "Ordem das cores da fita", tipo: "opcoes", opcoes: [[0, "RGB"], [1, "GRB (WS2812B comum)"], [2, "BRG"], [3, "RBG"], [4, "GBR"], [5, "BGR"]], ajuda: "Use Diagnóstico › Testar LEDs: as fitas devem mostrar vermelho, verde, azul e branco, nessa ordem." },
    AVISO_PARTIDA_S: { secao: "frota", rotulo: "Aviso antes de partir sozinho", unidade: "s", ajuda: "Ao terminar uma missão com outra na fila (ou ao sair para liberar o ponto), a fita pisca em verde por esse tempo e o AGV parte. START MISSÃO parte na hora." },
    LIBERAR_PONTO: { secao: "frota", rotulo: "Liberar o ponto para outro AGV", tipo: "booleano", ajuda: "Parado sem missão num ponto que outro AGV precisa, vai sozinho para um ponto de espera livre (depois do aviso). Desligado: fica e o site avisa." },
    RETOMAR_APOS_OBSTACULO_S: { secao: "frota", rotulo: "Retomar depois de obstáculo", unidade: "s", ajuda: "Obstáculo na frente durante a missão pausa; com o caminho livre por esse tempo, segue sozinho. 0 = interrompe e espera START MISSÃO." },
    LEDS_EFEITOS: { secao: "leds", rotulo: "Animações", tipo: "booleano", ajuda: "Desligado: respirar e correr viram luz fixa (piscar continua)." }
};

// Rascunho de alterações por AGV: { "01": { KP_QTR: 1.4 } }
const rascunhosConfig = {};
let mostrarAvancadoConfig = false;


/* ============================================================
   MENSAGENS DO ESP
   ============================================================ */

function processarConfiguracaoESP(agv, dados) {
    if (!dados) {
        return;
    }
    if (dados.status === "OK" && dados.parametros) {
        agv.parametros = dados.parametros;
        agv.configuracaoRecebidaEm = Date.now();
        // Compatibilidade com o painel antigo
        agv.configuracao = {
            kpQtr: dados.parametros.KP_QTR,
            kiQtr: dados.parametros.KI_QTR,
            kdQtr: dados.parametros.KD_QTR,
            velocidadeMaxima: dados.parametros.VELOCIDADE_MAXIMA,
            bracoRotacional: dados.parametros.BRACO_ROTACIONAL
        };
        // Alterações que o AGV já aplicou saem do rascunho
        const rascunho = rascunhosConfig[agv.id];
        if (rascunho) {
            Object.keys(rascunho).forEach(nome => {
                if (mesmoValor(rascunho[nome], dados.parametros[nome])) delete rascunho[nome];
            });
        }
        if (agv.envioConfigPendente) {
            agv.envioConfigPendente = false;
            agv.erroConfiguracao = null;
        }
        // cópia da configuração (0.14): guarda se mudou
        if (typeof Copias !== "undefined") Copias.aoReceber(agv);
    } else if (dados.status === "OK") {
        // firmware antigo (0.5): campos soltos
        agv.configuracao = {
            kpQtr: Number(dados.kpQtr), kiQtr: Number(dados.kiQtr), kdQtr: Number(dados.kdQtr),
            velocidadeMaxima: Number(dados.velocidadeMaxima), bracoRotacional: Number(dados.bracoRotacional ?? 0)
        };
    } else if (dados.status === "ERRO") {
        agv.erroConfiguracao = {
            parametro: dados.parametro || "",
            motivo: dados.motivo || dados.mensagem || "Erro desconhecido",
            quando: Date.now()
        };
        agv.envioConfigPendente = false;
        registrarAcaoSite(agv.id, "configuracao", "CONFIGURACAO_REJEITADA",
            `${dados.parametro || "?"}: ${agv.erroConfiguracao.motivo}`, false);
    }
    if (agv.id === agvSelecionado) renderizarConfiguracoes();
}

function processarEsquemaESP(agv, dados) {
    if (!dados || typeof dados !== "object") {
        return;
    }
    const esquema = {};
    Object.entries(dados).forEach(([nome, v]) => {
        if (!Array.isArray(v)) return;
        esquema[nome] = { minimo: v[0], maximo: v[1], padrao: v[2], inteiro: v[3] === 1, emMissao: v[4] === 1 };
    });
    agv.esquemaConfig = esquema;
    if (agv.id === agvSelecionado) renderizarConfiguracoes();
}

// Eventos do ESP que mexem nos cartões desta tela
function processarEventoPainel(agv, dados) {
    if (!dados || typeof dados !== "object") {
        return;
    }
    const evento = dados.evento || dados.tipo;
    if (/^TESTE_MECANICO_/.test(evento)) {
        agv.ultimoTesteMecanico = Object.assign({ quando: Date.now() }, dados);
    }
    if (/^OTA_/.test(evento)) {
        agv.ultimaOta = Object.assign({ quando: Date.now() }, dados);
    }
    if (agv.id === agvSelecionado && document.getElementById("configuracoes")?.classList.contains("ativa")) {
        renderizarCalibracao();
        renderizarOta();
    }
}

function mesmoValor(a, b) {
    return Math.abs(Number(a) - Number(b)) < 1e-6;
}


/* ============================================================
   TELA DE CONFIGURAÇÕES
   ============================================================ */

function missaoAtivaAGV(agv) {
    return ["EM_EXECUCAO", "AGUARDANDO_CONFIRMACAO", "INTERROMPIDA"].includes(agv.estadoMissao);
}

function formatarNumero(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return "--";
    return String(Math.round(n * 10000) / 10000);
}

function campoParametro(agv, nome, def, esquema, valorAgv, valorEditado, bloqueado) {
    const valor = valorEditado !== undefined ? valorEditado : valorAgv;
    const alterado = valorEditado !== undefined && !mesmoValor(valorEditado, valorAgv);
    const atributos = `data-param="${nome}" ${bloqueado ? "disabled" : ""}`;
    let entrada;
    if (def.tipo === "booleano") {
        entrada = `<label class="config-chave"><input type="checkbox" ${atributos} ${Number(valor) > 0.5 ? "checked" : ""}><span>${Number(valor) > 0.5 ? "Sim" : "Não"}</span></label>`;
    } else if (def.tipo === "sinal") {
        entrada = `<select ${atributos}><option value="1" ${Number(valor) > 0 ? "selected" : ""}>+1</option><option value="-1" ${Number(valor) < 0 ? "selected" : ""}>−1</option></select>`;
    } else if (def.tipo === "opcoes") {
        entrada = `<select ${atributos}>${def.opcoes.map(([v, t]) => `<option value="${v}" ${mesmoValor(v, valor) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
    } else {
        const passo = esquema.inteiro ? 1 : (esquema.maximo - esquema.minimo) > 10 ? 0.1 : 0.001;
        entrada = `<input type="number" ${atributos} value="${formatarNumero(valor)}" min="${esquema.minimo}" max="${esquema.maximo}" step="${passo}">`;
    }
    const padrao = def.tipo === "booleano" ? (esquema.padrao > 0.5 ? "SIM" : "NÃO")
        : def.tipo === "opcoes" ? (def.opcoes.find(([v]) => mesmoValor(v, esquema.padrao))?.[1] || esquema.padrao)
        : formatarNumero(esquema.padrao);
    const noAgv = def.tipo === "booleano" ? (valorAgv > 0.5 ? "SIM" : "NÃO")
        : def.tipo === "opcoes" ? (def.opcoes.find(([v]) => mesmoValor(v, valorAgv))?.[1] || valorAgv)
        : formatarNumero(valorAgv);
    const faixa = def.tipo ? "" : ` · ${formatarNumero(esquema.minimo)} a ${formatarNumero(esquema.maximo)}`;
    return `
        <div class="config-param ${alterado ? "alterado" : ""} ${bloqueado ? "bloqueado" : ""}">
            <div class="config-param-nome">
                <strong>${def.rotulo}</strong>
                <small>${nome}${def.unidade ? ` · ${def.unidade}` : ""}${faixa}</small>
                ${def.ajuda ? `<small class="config-ajuda">${def.ajuda}</small>` : ""}
            </div>
            <div class="config-param-valor">
                ${entrada}
                <small>${alterado ? `no AGV: ${noAgv}` : `padrão: ${padrao}`}</small>
            </div>
            <button type="button" class="btn btn-mini config-reset" data-reset="${nome}" title="Voltar ao valor padrão" ${bloqueado || mesmoValor(valor, esquema.padrao) ? "disabled" : ""}>↺</button>
        </div>`;
}

function renderizarConfiguracoes(forcar = false) {
    const agv = agvAtual();
    const secoes = document.getElementById("configSecoes");
    if (!agv || !secoes) {
        return;
    }

    const nome = document.getElementById("configNome");
    const id = document.getElementById("configId");
    if (nome && document.activeElement !== nome) nome.value = agv.nome || "";
    if (id) id.value = agv.id;
    const resumo = document.getElementById("configResumo");
    if (resumo) {
        resumo.textContent = `Firmware ${agv.sistema?.versao || "--"} · ${agv.online ? "online" : "offline"}`;
    }

    const esquema = agv.esquemaConfig;
    const valores = agv.parametros;
    const rascunho = rascunhosConfig[agv.id] || {};
    const aviso = document.getElementById("configAviso");
    const sincronia = document.getElementById("configSincronia");

    // Copiar de outro AGV
    const copiar = document.getElementById("configCopiarDe");
    if (copiar) {
        const outros = Object.values(agvs).filter(a => a.id !== agv.id && a.parametros);
        const assinatura = outros.map(a => a.id).join(",");
        if (copiar.dataset.assinatura !== assinatura) {
            copiar.innerHTML = `<option value="">outro AGV...</option>` +
                outros.map(a => `<option value="${a.id}">AGV ${a.id} — ${escaparHtml(a.nome || "")}</option>`).join("");
            copiar.dataset.assinatura = assinatura;
        }
    }

    if (!esquema || !valores) {
        secoes.innerHTML = `<div class="empty-state">${agv.online
            ? "Aguardando os parâmetros do AGV (firmware 0.6 ou mais novo)."
            : "AGV offline. Os parâmetros aparecem quando ele conectar."}</div>`;
        if (sincronia) sincronia.textContent = "Sem dados do AGV";
        renderizarNavConfig([]);
        renderizarPendentesConfig(agv, []);
        atualizarBotoesConfig(agv, 0);
        renderizarCalibracao();
        renderizarOta();
        return;
    }

    const ativa = missaoAtivaAGV(agv);
    const pendentes = Object.keys(rascunho).filter(n => !mesmoValor(rascunho[n], valores[n]));
    renderizarNavConfig(pendentes);
    renderizarPendentesConfig(agv, pendentes);

    if (aviso) {
        const partes = [];
        if (ativa) partes.push("Missão em andamento: só os ganhos do PID podem ser alterados agora.");
        if (agv.erroConfiguracao && Date.now() - agv.erroConfiguracao.quando < 60000) {
            partes.push(`O AGV recusou ${agv.erroConfiguracao.parametro || "a alteração"}: ${agv.erroConfiguracao.motivo}.`);
        }
        aviso.hidden = partes.length === 0;
        aviso.innerHTML = partes.map(escaparHtml).join("<br>");
    }
    if (sincronia) {
        sincronia.textContent = agv.envioConfigPendente ? "Enviando…"
            : pendentes.length ? `${pendentes.length} alteração(ões) não enviada(s)` : "Igual ao que está no AGV";
        sincronia.className = pendentes.length ? "texto-aviso" : "texto-ok";
    }

    // Preserva o foco ao redesenhar
    const foco = document.activeElement?.dataset?.param;
    const abertas = new Set([...secoes.querySelectorAll("details[open]")].map(d => d.dataset.secao));
    const primeira = !secoes.dataset.montado;

    let html = SECOES_CONFIG.map(secao => {
        const nomes = Object.keys(PARAMETROS_SITE).filter(n => PARAMETROS_SITE[n].secao === secao.id && esquema[n] && valores[n] !== undefined);
        const normais = nomes.filter(n => !PARAMETROS_SITE[n].avancado);
        const avancados = nomes.filter(n => PARAMETROS_SITE[n].avancado);
        const alteradosSecao = nomes.filter(n => pendentes.includes(n)).length;
        const linhas = (lista) => lista.map(n => campoParametro(agv, n, PARAMETROS_SITE[n], esquema[n], valores[n], rascunho[n],
            !agv.online || (ativa && !esquema[n].emMissao))).join("");
        const aberta = primeira ? secao.id === "linha" : abertas.has(secao.id) || alteradosSecao > 0;
        return `
            <details class="config-secao" id="secaoConfig-${secao.id}" data-secao="${secao.id}" ${aberta ? "open" : ""}>
                <summary>
                    <span>${secao.titulo}<small style="display:block">${secao.descricao}</small></span>
                    ${alteradosSecao ? `<span class="pilula ambar" style="margin-left:auto">${alteradosSecao} alterado(s)</span>` : ""}
                </summary>
                ${linhas(normais)}
                ${avancados.length ? `
                    <div class="config-avancado">
                        <button type="button" class="btn btn-mini" data-acao-config="avancado">${mostrarAvancadoConfig ? "Ocultar" : "Mostrar"} tabela da cinemática</button>
                        ${mostrarAvancadoConfig ? `<p class="editor-texto suave">Sinal de vx, vy e giro em cada roda. Padrão da mecanum X: M1 = vx+vy+r · M2 = vx−vy−r · M3 = vx−vy+r · M4 = vx+vy−r. Só mexa se a montagem das rodas for diferente.</p>${linhas(avancados)}` : ""}
                    </div>` : ""}
            </details>`;
    }).join("");

    // Parâmetros que o site ainda não conhece (firmware mais novo)
    const desconhecidos = Object.keys(esquema).filter(n => !PARAMETROS_SITE[n]);
    if (desconhecidos.length) {
        html += (`
            <details class="config-secao" id="secaoConfig-outros" data-secao="outros" ${abertas.has("outros") ? "open" : ""}>
                <summary><span>Outros</span><small>Parâmetros novos do firmware</small></summary>
                ${desconhecidos.map(n => campoParametro(agv, n, { rotulo: n }, esquema[n], valores[n], rascunho[n], !agv.online || (ativa && !esquema[n].emMissao))).join("")}
            </details>`);
    }
    // Só redesenha se algo mudou e se ninguém está mexendo num campo
    // (senão o menu de um select fecha sozinho a cada mensagem do AGV).
    const trocou = ui.trocarHtml(secoes, html, forcar);
    secoes.dataset.montado = "1";
    if (trocou && foco) secoes.querySelector(`[data-param="${foco}"]`)?.focus();
    atualizarBotoesConfig(agv, pendentes.length);
    renderizarCalibracao();
    renderizarOta();
    if (typeof Copias !== "undefined") Copias.desenhar();
}

function renderizarNavConfig(pendentes) {
    const nav = document.getElementById("configNav");
    if (!nav) return;
    const contagem = id => pendentes.filter(n => PARAMETROS_SITE[n]?.secao === id).length;
    const html = SECOES_CONFIG.map(s => {
        const n = contagem(s.id);
        return `<a href="#secaoConfig-${s.id}" data-ir-secao="${s.id}">${s.titulo}${n ? `<b>${n}</b>` : ""}</a>`;
    }).join("");
    if (nav.innerHTML !== html) nav.innerHTML = html;
}

function renderizarPendentesConfig(agv, pendentes) {
    const barra = document.getElementById("configPendente");
    const texto = document.getElementById("configPendenteTexto");
    if (!barra || !texto) return;
    barra.hidden = !pendentes.length && !agv.envioConfigPendente;
    const nomes = pendentes.map(n => PARAMETROS_SITE[n]?.rotulo || n);
    texto.innerHTML = agv.envioConfigPendente
        ? "<b>Enviando ao AGV…</b>"
        : `<b>${pendentes.length} alteraç${pendentes.length === 1 ? "ão ainda não enviada" : "ões ainda não enviadas"}</b> <span class="suave">· ${escaparHtml(nomes.slice(0, 4).join(", "))}${nomes.length > 4 ? "…" : ""}</span>`;
}

function atualizarBotoesConfig(agv, pendentes) {
    const enviar = document.getElementById("configEnviar");
    const descartar = document.getElementById("configDescartar");
    const restaurar = document.getElementById("configRestaurar");
    if (enviar) {
        enviar.disabled = !pendentes || !agv.online || agv.envioConfigPendente;
        enviar.textContent = agv.envioConfigPendente ? "Enviando…" : "Enviar ao AGV";
    }
    if (descartar) descartar.disabled = !pendentes;
    if (restaurar) restaurar.disabled = !agv.online || !agv.esquemaConfig || missaoAtivaAGV(agv);
}

function aoEditarParametro(evento) {
    const alvo = evento.target;
    const nome = alvo.dataset.param;
    const agv = agvAtual();
    if (!nome || !agv || !agv.esquemaConfig) {
        return;
    }
    const esquema = agv.esquemaConfig[nome];
    let valor;
    if (alvo.type === "checkbox") valor = alvo.checked ? 1 : 0;
    else valor = Number(alvo.value);
    if (!Number.isFinite(valor)) {
        renderizarConfiguracoes(true);
        return;
    }
    if (esquema) {
        valor = Math.min(esquema.maximo, Math.max(esquema.minimo, valor));
        if (esquema.inteiro) valor = Math.round(valor);
    }
    const rascunho = rascunhosConfig[agv.id] || (rascunhosConfig[agv.id] = {});
    if (mesmoValor(valor, agv.parametros?.[nome])) delete rascunho[nome];
    else rascunho[nome] = valor;
    renderizarConfiguracoes(true);
}

async function enviarAlteracoesConfig() {
    const agv = agvAtual();
    const rascunho = rascunhosConfig[agv?.id] || {};
    const valores = {};
    Object.keys(rascunho).forEach(n => {
        if (!mesmoValor(rascunho[n], agv.parametros?.[n])) valores[n] = rascunho[n];
    });
    const nomes = Object.keys(valores);
    if (!nomes.length) {
        return;
    }
    const lista = nomes.map(n => `• ${PARAMETROS_SITE[n]?.rotulo || n}: ${formatarNumero(agv.parametros?.[n])} → ${formatarNumero(valores[n])}`).join("\n");
    if (!(await ui.confirmar({ titulo: `Enviar ao AGV ${agv.id}?`, texto: `${lista}\n\nO AGV aplica tudo ou nada.`, confirmar: "Enviar" }))) {
        return;
    }
    const ok = publicar(TOPICOS.comando.configuracao, JSON.stringify({ tipo: "ALTERAR_CONFIGURACOES", valores }), agv.id);
    if (!ok) {
        ui.aviso("MQTT desconectado: nada foi enviado.");
        return;
    }
    agv.envioConfigPendente = true;
    agv.erroConfiguracao = null;
    registrarAcaoSite(agv.id, "configuracao", "CONFIGURACAO_ENVIADA", nomes.join(", "));
    setTimeout(() => {
        if (agv.envioConfigPendente) {
            agv.envioConfigPendente = false;
            agv.erroConfiguracao = { parametro: "", motivo: "o AGV não respondeu", quando: Date.now() };
            if (agv.id === agvSelecionado) renderizarConfiguracoes();
        }
    }, 6000);
    renderizarConfiguracoes(true);
}

function enviarParametrosDireto(agv, valores, descricao) {
    const ok = publicar(TOPICOS.comando.configuracao, JSON.stringify({ tipo: "ALTERAR_CONFIGURACOES", valores }), agv.id);
    if (!ok) {
        ui.aviso("MQTT desconectado: nada foi enviado.");
        return false;
    }
    agv.envioConfigPendente = true;
    registrarAcaoSite(agv.id, "configuracao", "CONFIGURACAO_ENVIADA", descricao || Object.keys(valores).join(", "));
    renderizarConfiguracoes(true);
    return true;
}

async function restaurarPadraoConfig() {
    const agv = agvAtual();
    if (!agv) return;
    if (!(await ui.confirmar({
        titulo: "Restaurar o padrão de fábrica?",
        texto: `Todos os parâmetros do AGV ${agv.id} voltam ao padrão, inclusive as calibrações de braço, raio e sentido dos motores.`,
        confirmar: "Restaurar", perigo: true
    }))) {
        return;
    }
    if (publicar(TOPICOS.comando.configuracao, JSON.stringify({ tipo: "RESTAURAR_PADRAO" }), agv.id)) {
        delete rascunhosConfig[agv.id];
        registrarAcaoSite(agv.id, "configuracao", "RESTAURACAO_SOLICITADA", "Padrão de fábrica");
    }
}

function exportarConfig() {
    const agv = agvAtual();
    if (!agv?.parametros) {
        ui.aviso("Sem parâmetros do AGV para exportar.");
        return;
    }
    const dados = { tipo: "CONFIGURACAO_AGV", agv: agv.id, firmware: agv.sistema?.versao || "", data: new Date().toISOString(), parametros: agv.parametros };
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `config-agv-${agv.id}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Coloca valores no rascunho (importação ou cópia) para revisar antes de enviar
function carregarNoRascunho(agv, parametros, origem) {
    if (!agv.esquemaConfig || !agv.parametros) {
        ui.aviso("Conecte o AGV antes de importar parâmetros.");
        return;
    }
    const rascunho = rascunhosConfig[agv.id] || (rascunhosConfig[agv.id] = {});
    let quantos = 0;
    Object.entries(parametros || {}).forEach(([nome, valor]) => {
        const e = agv.esquemaConfig[nome];
        if (!e || !Number.isFinite(Number(valor))) return;
        const v = Math.min(e.maximo, Math.max(e.minimo, Number(valor)));
        if (!mesmoValor(v, agv.parametros[nome])) {
            rascunho[nome] = v;
            quantos++;
        }
    });
    renderizarConfiguracoes(true);
    ui.aviso(quantos ? `${quantos} parâmetro(s) de ${origem} prontos para revisar. Confira e clique em ENVIAR.` : `Os valores de ${origem} já são iguais aos do AGV.`);
}


/* ============================================================
   ASSISTENTE DE CALIBRAÇÃO MECÂNICA
   ============================================================ */

function podeCalibrar(agv) {
    return agv && agv.online && agv.modo === "MANUAL" && agv.maquina === "PRONTO" && !missaoAtivaAGV(agv);
}

function enviarTesteMecanico(comando, descricao) {
    const agv = agvAtual();
    if (!agv) return;
    if (comando.acao !== "PARAR" && !podeCalibrar(agv)) {
        ui.aviso("Para calibrar: seletora em MANUAL, AGV ligado (PRONTO) e sem missão.");
        return;
    }
    if (publicar(TOPICOS.comando.calibracaoMecanica, JSON.stringify(comando), agv.id)) {
        agv.testeEmAndamento = comando.acao === "PARAR" ? null : { comando, desde: Date.now() };
        if (comando.acao !== "PARAR") registrarAcaoSite(agv.id, "configuracao", "TESTE_SOLICITADO", descricao || comando.acao);
        renderizarCalibracao();
    }
}

function renderizarCalibracao() {
    const conteudo = document.getElementById("calibConteudo");
    const status = document.getElementById("calibStatus");
    const agv = agvAtual();
    if (!conteudo || !agv) {
        return;
    }
    const p = agv.parametros || {};
    const pronto = podeCalibrar(agv);
    const dis = pronto ? "" : "disabled";
    const ultimo = agv.ultimoTesteMecanico;

    if (conteudo.dataset.agv !== agv.id || conteudo.dataset.pronto !== String(pronto)) {
        conteudo.dataset.agv = agv.id;
        conteudo.dataset.pronto = String(pronto);
        conteudo.innerHTML = `
            ${pronto ? "" : `<div class="config-aviso">Coloque a seletora em MANUAL e ligue o AGV (START) para liberar os testes.</div>`}
            <details class="calib-passo" open>
                <summary><b class="id-badge" style="width:24px;height:24px">1</b> Sentido de cada motor <small>rodas suspensas</small></summary>
                <p class="editor-texto suave">Cada botão gira uma roda devagar por 1 s, "para a frente". Se ela girar para trás, marque INVERTER para aquele motor.</p>
                <div class="calib-motores">
                    ${[["1", "M1", "frente-direito"], ["2", "M2", "frente-esquerdo"], ["3", "M3", "trás-direito"], ["4", "M4", "trás-esquerdo"]].map(([n, m, onde]) => `
                        <div class="calib-motor">
                            <strong>${m}</strong><small>${onde}</small>
                            <button type="button" class="btn btn-mini" data-calib="motor" data-motor="${n}" ${dis}>Testar</button>
                            <label class="config-chave"><input type="checkbox" data-param="INVERTER_M${n}" ${Number((rascunhosConfig[agv.id] || {})["INVERTER_M" + n] ?? p["INVERTER_M" + n]) > 0.5 ? "checked" : ""} ${agv.online ? "" : "disabled"}><span>Inverter</span></label>
                        </div>`).join("")}
                </div>
            </details>
            <details class="calib-passo">
                <summary><b class="id-badge" style="width:24px;height:24px">2</b> Padrões de movimento <small>rodas suspensas</small></summary>
                <p class="editor-texto suave">Confira o sentido de todas as rodas juntas. FRENTE: as 4 para a frente. ESQUERDA: M1 e M4 para a frente, M2 e M3 para trás. GIRO ↺: M1 e M3 para a frente, M2 e M4 para trás.</p>
                <div class="calib-botoes">
                    <button type="button" class="btn btn-mini" data-calib="padrao" data-padrao="FRENTE" data-sentido="1" ${dis}>↑ Frente</button>
                    <button type="button" class="btn btn-mini" data-calib="padrao" data-padrao="FRENTE" data-sentido="-1" ${dis}>↓ Ré</button>
                    <button type="button" class="btn btn-mini" data-calib="padrao" data-padrao="LADO" data-sentido="1" ${dis}>← Esquerda</button>
                    <button type="button" class="btn btn-mini" data-calib="padrao" data-padrao="LADO" data-sentido="-1" ${dis}>→ Direita</button>
                    <button type="button" class="btn btn-mini" data-calib="padrao" data-padrao="GIRO" data-sentido="1" ${dis}>↺ Giro</button>
                    <button type="button" class="btn btn-mini" data-calib="padrao" data-padrao="GIRO" data-sentido="-1" ${dis}>↻ Giro</button>
                </div>
            </details>
            <details class="calib-passo">
                <summary><b class="id-badge" style="width:24px;height:24px">3</b> Braço rotacional <small>no chão</small></summary>
                <p class="editor-texto suave">Marque a frente do AGV no chão. Ele gira o ângulo pedido; meça quanto girou de verdade.</p>
                <div class="calib-linha">
                    <label class="editor-campo"><span>Girar</span><div class="editor-com-unidade"><input type="number" id="calibGiroGraus" value="360" min="45" max="1080" step="45"><em>°</em></div></label>
                    <button type="button" class="btn" data-calib="giro" ${dis}>Girar</button>
                </div>
                <div class="calib-linha">
                    <label class="editor-campo"><span>Girou de verdade</span><div class="editor-com-unidade"><input type="number" id="calibGiroMedido" placeholder="ex.: 342" step="1"><em>°</em></div></label>
                    <button type="button" class="btn btn-start" data-calib="aplicarBraco" ${agv.online ? "" : "disabled"}>Aplicar</button>
                </div>
                <p class="editor-texto suave" id="calibBracoPrevia">Braço atual: ${formatarNumero(p.BRACO_ROTACIONAL)} m</p>
            </details>
            <details class="calib-passo">
                <summary><b class="id-badge" style="width:24px;height:24px">4</b> Raio da roda <small>no chão</small></summary>
                <p class="editor-texto suave">O AGV anda em linha reta a distância pedida (sem rampa). Meça com uma trena.</p>
                <div class="calib-linha">
                    <label class="editor-campo"><span>Andar</span><div class="editor-com-unidade"><input type="number" id="calibRetaMetros" value="1" min="0.1" max="5" step="0.1"><em>m</em></div></label>
                    <button type="button" class="btn" data-calib="reta" ${dis}>Andar</button>
                </div>
                <div class="calib-linha">
                    <label class="editor-campo"><span>Andou de verdade</span><div class="editor-com-unidade"><input type="number" id="calibRetaMedida" placeholder="ex.: 0.97" step="0.005"><em>m</em></div></label>
                    <button type="button" class="btn btn-start" data-calib="aplicarRaio" ${agv.online ? "" : "disabled"}>Aplicar</button>
                </div>
                <p class="editor-texto suave" id="calibRaioPrevia">Raio atual: ${formatarNumero(p.RAIO_RODA)} m</p>
            </details>`;
    } else {
        const previaBraco = document.getElementById("calibBracoPrevia");
        const previaRaio = document.getElementById("calibRaioPrevia");
        if (previaBraco) previaBraco.textContent = `Braço atual: ${formatarNumero(p.BRACO_ROTACIONAL)} m`;
        if (previaRaio) previaRaio.textContent = `Raio atual: ${formatarNumero(p.RAIO_RODA)} m`;
        conteudo.querySelectorAll('[data-param^="INVERTER_M"]').forEach(caixa => {
            const nome = caixa.dataset.param;
            caixa.checked = Number((rascunhosConfig[agv.id] || {})[nome] ?? p[nome]) > 0.5;
        });
    }

    if (status) {
        if (agv.testeEmAndamento && (!ultimo || ultimo.quando < agv.testeEmAndamento.desde)) {
            status.innerHTML = `<span class="texto-aviso">Executando ${escaparHtml(agv.testeEmAndamento.comando.acao)}...</span>`;
        } else if (ultimo) {
            const titulo = { TESTE_MECANICO_CONCLUIDO: "Teste concluído", TESTE_MECANICO_INTERROMPIDO: "Teste interrompido", TESTE_MECANICO_RECUSADO: "Teste recusado", TESTE_MECANICO_INICIADO: "Teste iniciado" }[ultimo.evento] || ultimo.evento;
            const odometria = ultimo.teste === "GIRO" ? ` · odometria ${formatarNumero(ultimo.odometriaGraus)}°`
                : ultimo.teste === "RETA" ? ` · odometria ${formatarNumero(ultimo.odometriaMetros)} m` : "";
            status.innerHTML = `<span class="${/CONCLUIDO/.test(ultimo.evento) ? "texto-ok" : /INICIADO/.test(ultimo.evento) ? "texto-aviso" : "texto-erro"}">${escaparHtml(titulo)}</span> — ${escaparHtml(ultimo.mensagem || "")}${odometria}`;
        } else {
            status.textContent = "";
        }
    }
}

async function aoClicarCalibracao(evento) {
    const botao = evento.target.closest("[data-calib]");
    const agv = agvAtual();
    if (!botao || !agv) return;
    const p = agv.parametros || {};
    switch (botao.dataset.calib) {
        case "motor":
            enviarTesteMecanico({ acao: "TESTE_MOTOR", motor: Number(botao.dataset.motor), sentido: 1, duracaoMs: 1000 }, `Motor M${botao.dataset.motor}`);
            break;
        case "padrao":
            enviarTesteMecanico({ acao: "TESTE_PADRAO", padrao: botao.dataset.padrao, sentido: Number(botao.dataset.sentido), duracaoMs: 1500 }, `Padrão ${botao.dataset.padrao}`);
            break;
        case "giro": {
            const graus = Number(document.getElementById("calibGiroGraus")?.value) || 360;
            if (!(p.BRACO_ROTACIONAL > 0)) {
                ui.aviso("Informe primeiro um braço aproximado em Mecânica (ex.: (entre eixos + bitola) / 2).");
                return;
            }
            agv.ultimoGiroComandado = graus;
            enviarTesteMecanico({ acao: "GIRO", graus }, `Giro de ${graus}°`);
            break;
        }
        case "reta": {
            const metros = Number(document.getElementById("calibRetaMetros")?.value) || 1;
            agv.ultimaRetaComandada = metros;
            enviarTesteMecanico({ acao: "RETA", metros }, `Reta de ${metros} m`);
            break;
        }
        case "aplicarBraco": {
            const medido = Number(document.getElementById("calibGiroMedido")?.value);
            const comandado = agv.ultimoGiroComandado || Number(document.getElementById("calibGiroGraus")?.value) || 360;
            if (!(medido > 0)) { ui.aviso("Informe quantos graus o AGV girou de verdade."); return; }
            if (!(p.BRACO_ROTACIONAL > 0)) { ui.aviso("O braço atual é zero: informe um valor aproximado em Mecânica e faça o giro."); return; }
            const novo = calcularNovoBraco(p.BRACO_ROTACIONAL, comandado, medido);
            if (!(await ui.confirmar({ titulo: "Aplicar o braço novo?", texto: `Braço rotacional: ${formatarNumero(p.BRACO_ROTACIONAL)} → ${formatarNumero(novo)} m\n(pedido ${comandado}°, girou ${medido}°)`, confirmar: "Aplicar" }))) return;
            enviarParametrosDireto(agv, { BRACO_ROTACIONAL: novo }, `Calibração do braço: ${formatarNumero(novo)} m`);
            break;
        }
        case "aplicarRaio": {
            const medido = Number(document.getElementById("calibRetaMedida")?.value);
            const comandado = agv.ultimaRetaComandada || Number(document.getElementById("calibRetaMetros")?.value) || 1;
            if (!(medido > 0)) { ui.aviso("Informe a distância que o AGV andou de verdade."); return; }
            const novo = calcularNovoRaio(p.RAIO_RODA, comandado, medido);
            if (!(await ui.confirmar({ titulo: "Aplicar o raio novo?", texto: `Raio da roda: ${formatarNumero(p.RAIO_RODA)} → ${formatarNumero(novo)} m\n(pedido ${comandado} m, andou ${medido} m)`, confirmar: "Aplicar" }))) return;
            enviarParametrosDireto(agv, { RAIO_RODA: novo }, `Calibração do raio: ${formatarNumero(novo)} m`);
            break;
        }
    }
}

// Girou menos que o pedido -> o braço real é maior que o configurado
function calcularNovoBraco(bracoAtual, grausPedidos, grausMedidos) {
    return Math.round(bracoAtual * grausPedidos / grausMedidos * 10000) / 10000;
}

// Andou mais que o pedido -> a roda real é maior que a configurada
function calcularNovoRaio(raioAtual, metrosPedidos, metrosMedidos) {
    return Math.round(raioAtual * metrosMedidos / metrosPedidos * 100000) / 100000;
}


/* ============================================================
   ATUALIZAÇÃO DE FIRMWARE (OTA)
   ============================================================ */

function renderizarOta() {
    const conteudo = document.getElementById("otaConteudo");
    const agv = agvAtual();
    if (!conteudo || !agv) {
        return;
    }
    const versao = agv.sistema?.versao || "--";
    const host = agv.sistema?.ota_host || `agv-${agv.id}`;
    const ultima = agv.ultimaOta;
    const desligado = agv.ligado === "DESLIGADO" || agv.ligado === false;
    if (!conteudo.dataset.montado) {
        conteudo.dataset.montado = "1";
        conteudo.innerHTML = `
            <p class="editor-texto">Versão instalada: <strong id="otaVersao"></strong></p>
            <div class="ota-bloco">
                <span class="editor-subtitulo">Pela Arduino IDE</span>
                <p class="editor-texto suave">Com o computador na mesma rede, a porta de rede <strong id="otaHost"></strong> aparece em Ferramentas › Porta. A senha é a OTA_SENHA do firmware.</p>
            </div>
            <div class="ota-bloco">
                <span class="editor-subtitulo">Por um link (.bin)</span>
                <label class="editor-campo"><span>Endereço do arquivo</span><input id="otaUrl" placeholder="https://.../AGV_FROTA.ino.bin" spellcheck="false"></label>
                <label class="editor-campo"><span>Versão</span><input id="otaVersaoNova" placeholder="ex.: 0.7.4"></label>
                <button type="button" class="btn btn-start" id="otaEnviar">Atualizar</button>
                <p class="editor-texto suave">O AGV precisa estar parado, sem missão e com STOP acionado. Se a versão nova não conectar no MQTT em 3 minutos, ele volta sozinho para a anterior.</p>
            </div>
            <div id="otaStatus" class="calib-status"></div>`;
    }
    document.getElementById("otaVersao").textContent = versao;
    document.getElementById("otaHost").textContent = host;
    const botao = document.getElementById("otaEnviar");
    if (botao) {
        botao.disabled = !agv.online || missaoAtivaAGV(agv);
        botao.title = desligado ? "" : "Acione o STOP do AGV antes de atualizar";
    }
    const status = document.getElementById("otaStatus");
    if (status) {
        if (ultima) {
            const classe = /CONCLUIDA|VALIDADA/.test(ultima.evento) ? "texto-ok" : /INICIADA/.test(ultima.evento) ? "texto-aviso" : "texto-erro";
            status.innerHTML = `<span class="${classe}">${escaparHtml(ultima.evento)}</span> — ${escaparHtml(ultima.mensagem || "")}`;
        } else {
            status.textContent = "";
        }
    }
}

async function enviarOta() {
    const agv = agvAtual();
    if (!agv) return;
    const url = document.getElementById("otaUrl")?.value.trim();
    const versao = document.getElementById("otaVersaoNova")?.value.trim() || "?";
    if (!/^https:\/\/\S+$/.test(url || "")) {
        ui.aviso("Informe um endereço https:// para o arquivo .bin.");
        return;
    }
    if (!(await ui.confirmar({ titulo: `Atualizar o AGV ${agv.id}?`, texto: `Versão ${versao}. O AGV vai baixar o arquivo e reiniciar. Confira se ele está parado e com STOP acionado.`, confirmar: "Atualizar" }))) {
        return;
    }
    if (publicar(TOPICOS.comando.ota, JSON.stringify({ url, versao }), agv.id)) {
        agv.ultimaOta = { evento: "OTA_SOLICITADA", mensagem: `Versão ${versao}`, quando: Date.now() };
        registrarAcaoSite(agv.id, "sistema", "OTA_SOLICITADA", `${versao} · ${url}`);
        renderizarOta();
    }
}


/* ============================================================
   HISTÓRICO
   ============================================================ */

let filtroHistorico = "todos";

const NOMES_EVENTOS = {
    EMERGENCIA_ACIONADA: "Emergência acionada",
    EMERGENCIA_LIBERADA: "Emergência liberada",
    REARME_ACEITO: "Rearme aceito",
    POTENCIA_HABILITADA: "Potência habilitada (START)",
    STOP_ACIONADO: "STOP acionado",
    BARREIRA_INVADIDA: "Barreira invadida",
    BARREIRA_LIVRE: "Barreira livre",
    FALHA_SENSORES_BARREIRA: "Falha nos sensores da barreira",
    FALHA_COMUNICACAO_PAINEL: "Falha de comunicação com o painel",
    COMUNICACAO_PAINEL_RESTAURADA: "Comunicação com o painel restaurada",
    COMBINACAO_INVALIDA: "Combinação inválida STOP/emergência",
    MODO_ALTERADO: "Modo alterado",
    REARME_LOCAL_OBRIGATORIO: "Rearme remoto recusado",
    AGV_REINICIOU: "AGV reiniciou",
    FALHA_HARDWARE: "Falha de hardware",
    MISSAO_CARREGADA: "Missão carregada",
    MISSAO_INICIADA: "Missão iniciada",
    MISSAO_CONCLUIDA: "Missão concluída",
    MISSAO_INTERROMPIDA: "Missão interrompida",
    MISSAO_RETOMADA: "Missão retomada",
    MISSAO_ERRO: "Erro na missão",
    CARREGAMENTO_REJEITADO: "Missão rejeitada pelo AGV",
    CANCELAMENTO_CONFIRMADO: "Cancelamento confirmado",
    TRECHO_CONCLUIDO: "Trecho concluído",
    MANOBRA_INICIADA: "Manobra",
    GIRO_CHEGADA: "Giro de chegada",
    CHECKPOINT: "Tag intermediária",
    CONFIGURACAO_ALTERADA: "Parâmetro alterado",
    CONFIGURACAO_RESTAURADA: "Configuração restaurada",
    OTA_INICIADA: "Atualização iniciada",
    OTA_CONCLUIDA: "Atualização concluída",
    OTA_ERRO: "Erro na atualização",
    OTA_RECUSADA: "Atualização recusada",
    OTA_VALIDADA: "Versão nova validada",
    OTA_SOLICITADA: "Atualização solicitada",
    CONFIGURACAO_ENVIADA: "Configuração enviada",
    CONFIGURACAO_REJEITADA: "Configuração recusada pelo AGV",
    RESTAURACAO_SOLICITADA: "Restauração de fábrica solicitada",
    TESTE_SOLICITADO: "Teste de calibração solicitado",
    TESTE_MECANICO_INICIADO: "Teste de calibração iniciado",
    TESTE_MECANICO_CONCLUIDO: "Teste de calibração concluído",
    TESTE_MECANICO_INTERROMPIDO: "Teste de calibração interrompido",
    TESTE_MECANICO_RECUSADO: "Teste de calibração recusado",
    CALIBRACAO_QTR_INICIADA: "Calibração do QTR iniciada",
    CALIBRACAO_QTR_CONCLUIDA: "Calibração do QTR concluída",
    CALIBRACAO_QTR_CANCELADA: "Calibração do QTR cancelada",
    CALIBRACAO_QTR_ERRO: "Erro na calibração do QTR",
    CALIBRACAO_QTR_RECUSADA: "Calibração do QTR recusada",
    MISSAO_ENVIADA: "Missão enviada",
    CANCELAMENTO_SOLICITADO: "Cancelamento solicitado",
    POSICAO_INFORMADA: "Posição informada",
    POSICAO_DEFINIDA: "Posição aceita pelo AGV",
    POSICAO_REJEITADA: "Posição recusada",
    INICIO_REJEITADO: "Início recusado",
    ETAPA_INICIADA: "Etapa iniciada",
    ETAPA_CONCLUIDA: "Etapa concluída",
    ETAPA_AGUARDANDO_CONFIRMACAO: "Aguardando confirmação",
    CONFIRMACAO_RECEBIDA: "Confirmação recebida",
    CONFIRMACAO_ERRO: "Confirmação recusada",
    RFID_ESPERADO: "Tag de chegada lida",
    TAG_NAO_LIDA: "Tag esperada não foi lida",
    POSICAO_PERDIDA: "Posição perdida (movido no manual)",
    AUTOTESTE_INICIADO: "Autoteste iniciado",
    AUTOTESTE_CONCLUIDO: "Autoteste concluído",
    AUTOTESTE_RECUSADO: "Autoteste recusado",
    AUTOTESTE_SOLICITADO: "Autoteste solicitado",
    TESTE_LEDS: "Teste dos LEDs",
    TESTE_LEDS_SOLICITADO: "Teste dos LEDs solicitado",
    REVISAO_REGISTRADA: "Revisão registrada",
    MISSAO_CANCELADA: "Missão cancelada"
};

function categoriaDoEvento(item) {
    const e = item.evento;
    if (item.categoria) return item.categoria;
    if (e && typeof e === "object" && e.categoria) return e.categoria;
    return "missao";
}

// Ações feitas no site (quem enviou o quê) também vão para o histórico
function registrarAcaoSite(agvId, categoria, evento, mensagem, origemSite = true) {
    const agv = agvs[agvId];
    if (!agv) return;
    if (!Array.isArray(agv.historico)) agv.historico = [];
    agv.historico.unshift({
        data: new Date().toISOString(),
        categoria: origemSite ? "site" : categoria,
        evento: { evento, mensagem, categoria: origemSite ? "site" : categoria, origem: origemSite ? "SITE" : "AGV" }
    });
    if (agv.historico.length > 1000) agv.historico.length = 1000;
    salvarAgvsFrota();
    if (agvId === agvSelecionado && document.getElementById("historico")?.classList.contains("ativa")) {
        renderizarHistorico();
    }
}

function itensHistoricoFiltrados(agv) {
    const busca = (document.getElementById("historicoBusca")?.value || "").trim().toLowerCase();
    return (Array.isArray(agv.historico) ? agv.historico : []).filter(item => {
        const cat = categoriaDoEvento(item);
        if (filtroHistorico !== "todos" && cat !== filtroHistorico) return false;
        if (!busca) return true;
        return JSON.stringify(item.evento).toLowerCase().includes(busca) ||
               (NOMES_EVENTOS[item.evento?.evento] || "").toLowerCase().includes(busca);
    });
}

const ICONES_HISTORICO = {
    EMERGENCIA_ACIONADA: "alerta", BARREIRA_INVADIDA: "alerta", FALHA_SENSORES_BARREIRA: "alerta", FALHA_COMUNICACAO_PAINEL: "alerta",
    COMBINACAO_INVALIDA: "alerta", MISSAO_ERRO: "alerta", FALHA_HARDWARE: "alerta", CARREGAMENTO_REJEITADO: "alerta", TAG_NAO_LIDA: "alerta",
    EMERGENCIA_LIBERADA: "escudoOk", BARREIRA_LIVRE: "escudoOk", REARME_ACEITO: "escudoOk", COMUNICACAO_PAINEL_RESTAURADA: "escudoOk",
    STOP_ACIONADO: "escudo", POTENCIA_HABILITADA: "liga", AGV_REINICIOU: "liga", MODO_ALTERADO: "ajuste",
    MISSAO_CONCLUIDA: "ok", ETAPA_CONCLUIDA: "ok", CONFIRMACAO_RECEBIDA: "ok", AUTOTESTE_CONCLUIDO: "ok", CALIBRACAO_QTR_CONCLUIDA: "ok",
    CHECKPOINT: "tag", RFID_ESPERADO: "tag", MANOBRA_INICIADA: "giro", GIRO_CHEGADA: "giro",
    MISSAO_ENVIADA: "enviar", CONFIGURACAO_ENVIADA: "enviar", OTA_SOLICITADA: "enviar", POSICAO_INFORMADA: "local", POSICAO_DEFINIDA: "local",
    CONFIGURACAO_ALTERADA: "ajuste", CONFIGURACAO_RESTAURADA: "ajuste", TESTE_LEDS: "led", TESTE_LEDS_SOLICITADO: "led"
};
const DESTAQUE_HISTORICO = new Set(["EMERGENCIA_ACIONADA", "MISSAO_ERRO", "FALHA_HARDWARE", "COMBINACAO_INVALIDA"]);

function resumoDoDiaHistorico(agv) {
    const caixa = document.getElementById("historicoResumo");
    if (!caixa) return;
    const hoje = new Date().toDateString();
    const doDia = (agv.historico || []).filter(item => new Date(item.data).toDateString() === hoje);
    const conta = nome => doDia.filter(i => (i.evento?.evento || i.evento?.tipo) === nome).length;
    const iniciadas = conta("MISSAO_INICIADA"), concluidas = conta("MISSAO_CONCLUIDA"), erros = conta("MISSAO_ERRO");
    // tempo médio parado por barreira: pares INVADIDA -> LIVRE
    let paradas = 0, soma = 0, inicio = null;
    [...doDia].reverse().forEach(i => {
        const e = i.evento?.evento;
        if (e === "BARREIRA_INVADIDA") { inicio = new Date(i.data).getTime(); paradas++; }
        if (e === "BARREIRA_LIVRE" && inicio) { soma += new Date(i.data).getTime() - inicio; inicio = null; }
    });
    const ultimoErro = doDia.find(i => i.evento?.evento === "MISSAO_ERRO");
    caixa.innerHTML = `
        <div><div class="rotulo">Missões hoje</div><div class="valor">${Math.max(iniciadas, concluidas + erros)} <small class="verde">${concluidas} concluída${concluidas === 1 ? "" : "s"}</small></div></div>
        <div><div class="rotulo">Paradas por barreira</div><div class="valor">${paradas} <small>${paradas && soma ? `média ${Math.round(soma / paradas / 1000)} s` : ""}</small></div></div>
        <div><div class="rotulo">Emergências</div><div class="valor ${conta("EMERGENCIA_ACIONADA") ? "vermelho" : ""}">${conta("EMERGENCIA_ACIONADA")}</div></div>
        <div><div class="rotulo">Erros de missão</div><div class="valor">${erros} <small>${ultimoErro ? escaparHtml(String(ultimoErro.evento.mensagem || "").slice(0, 28)) : ""}</small></div></div>`;
}

let limiteHistorico = 150;

function renderizarHistorico() {
    const agv = agvAtual();
    const lista = document.getElementById("listaHistorico");
    if (!agv || !lista) {
        return;
    }
    resumoDoDiaHistorico(agv);
    const todos = Array.isArray(agv.historico) ? agv.historico : [];
    const status = document.getElementById("historicoStatus");
    if (status) status.textContent = `${todos.length} eventos neste navegador (até 1.000 por AGV)`;
    const itens = itensHistoricoFiltrados(agv);
    const contagem = document.getElementById("historicoContagem");
    if (contagem) contagem.textContent = `${itens.length} de ${todos.length}`;
    // contagem por categoria nos filtros
    document.querySelectorAll("#historicoFiltros [data-categoria]").forEach(botao => {
        const cat = botao.dataset.categoria;
        const n = cat === "todos" ? todos.length : todos.filter(i => categoriaDoEvento(i) === cat).length;
        let marca = botao.querySelector(".n");
        if (!marca) { marca = document.createElement("span"); marca.className = "n"; botao.appendChild(marca); }
        marca.textContent = ` ${n}`;
    });

    if (!itens.length) {
        lista.innerHTML = `<div class="empty-state">${todos.length ? "Nenhum evento com esse filtro." : "Nenhum evento registrado ainda."}</div>`;
        return;
    }
    const rotulos = { seguranca: "Segurança", missao: "Missão", sistema: "Sistema", configuracao: "Config", site: "Site" };
    const hoje = new Date().toDateString();
    const ontem = new Date(Date.now() - 86400000).toDateString();
    let diaAnterior = "";
    const html = itens.slice(0, limiteHistorico).map(item => {
        const data = new Date(item.data);
        const chaveDia = data.toDateString();
        const dia = chaveDia === hoje ? `Hoje · ${data.toLocaleDateString("pt-BR")}` : chaveDia === ontem ? `Ontem · ${data.toLocaleDateString("pt-BR")}` : data.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
        const e = item.evento;
        const cat = categoriaDoEvento(item);
        const codigo = typeof e === "object" && e ? (e.evento || e.tipo || "EVENTO") : String(e);
        const titulo = NOMES_EVENTOS[codigo] || codigo.replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase());
        const detalhes = typeof e === "object" && e
            ? [e.missao ? `Missão ${e.missao}` : "", e.mensagem, e.requestId ? `pedido ${e.requestId}` : ""].filter(Boolean).join(" · ")
            : "";
        const cabecalhoDia = chaveDia !== diaAnterior ? `<div class="historico-dia">${escaparHtml(dia)}</div>` : "";
        diaAnterior = chaveDia;
        const icone = ICONES_HISTORICO[codigo] || (cat === "seguranca" ? "escudo" : cat === "missao" ? "missoes" : cat === "configuracao" ? "ajuste" : cat === "site" ? "enviar" : "info");
        return `${cabecalhoDia}
            <div class="historico-item ${DESTAQUE_HISTORICO.has(codigo) ? "destaque" : ""}">
                <span class="historico-hora">${data.toLocaleTimeString("pt-BR")}</span>
                <span class="historico-icone ${cat}">${ui.icone(icone)}</span>
                <span class="historico-texto"><b>${escaparHtml(titulo)}</b>${detalhes ? `<small>${escaparHtml(detalhes)}</small>` : ""}</span>
                <span class="etiqueta ${cat}">${rotulos[cat] || cat}</span>
            </div>`;
    }).join("");
    ui.trocarHtml(lista, html + (itens.length > limiteHistorico
        ? `<button type="button" class="btn historico-mais" id="historicoMais">Carregar mais (${itens.length - limiteHistorico})</button>` : ""));
}

function exportarHistoricoCSV() {
    const agv = agvAtual();
    if (!agv) return;
    const itens = itensHistoricoFiltrados(agv);
    const linhas = [["data", "hora", "categoria", "evento", "missao", "mensagem"]];
    itens.forEach(item => {
        const d = new Date(item.data);
        const e = typeof item.evento === "object" && item.evento ? item.evento : { evento: String(item.evento) };
        linhas.push([d.toLocaleDateString("pt-BR"), d.toLocaleTimeString("pt-BR"), categoriaDoEvento(item), e.evento || e.tipo || "", e.missao || "", e.mensagem || ""]);
    });
    const csv = "﻿" + linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historico-agv-${agv.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/* ============================================================
   LIGAÇÕES DOS BOTÕES (o DOM já existe: script no fim do body)
   ============================================================ */

(function ligarTelaConfiguracoes() {
    const secoes = document.getElementById("configSecoes");
    secoes?.addEventListener("change", aoEditarParametro);
    secoes?.addEventListener("click", evento => {
        const reset = evento.target.closest("[data-reset]");
        const agv = agvAtual();
        if (reset && agv?.esquemaConfig) {
            const nome = reset.dataset.reset;
            const rascunho = rascunhosConfig[agv.id] || (rascunhosConfig[agv.id] = {});
            const padrao = agv.esquemaConfig[nome].padrao;
            if (mesmoValor(padrao, agv.parametros[nome])) delete rascunho[nome];
            else rascunho[nome] = padrao;
            renderizarConfiguracoes(true);
        }
        if (evento.target.closest('[data-acao-config="avancado"]')) {
            mostrarAvancadoConfig = !mostrarAvancadoConfig;
            renderizarConfiguracoes(true);
        }
    });
    document.getElementById("configNav")?.addEventListener("click", evento => {
        const link = evento.target.closest("[data-ir-secao]");
        if (!link) return;
        evento.preventDefault();
        const secao = document.getElementById(`secaoConfig-${link.dataset.irSecao}`);
        if (!secao) return;
        secao.open = true;
        secao.scrollIntoView({ behavior: "smooth", block: "start" });
        document.querySelectorAll("#configNav a").forEach(a => a.classList.toggle("ativo", a === link));
    });
    document.getElementById("calibConteudo")?.addEventListener("change", aoEditarParametro);
    document.getElementById("calibConteudo")?.addEventListener("click", aoClicarCalibracao);
    document.getElementById("calibParar")?.addEventListener("click", () => enviarTesteMecanico({ acao: "PARAR" }));
    document.getElementById("configEnviar")?.addEventListener("click", enviarAlteracoesConfig);
    document.getElementById("configDescartar")?.addEventListener("click", () => {
        const agv = agvAtual();
        if (agv) delete rascunhosConfig[agv.id];
        renderizarConfiguracoes(true);
    });
    document.getElementById("configRestaurar")?.addEventListener("click", restaurarPadraoConfig);
    document.getElementById("configExportar")?.addEventListener("click", exportarConfig);
    document.getElementById("configImportar")?.addEventListener("click", () => document.getElementById("configArquivo")?.click());
    document.getElementById("configArquivo")?.addEventListener("change", evento => {
        const arquivo = evento.target.files[0];
        evento.target.value = "";
        if (!arquivo) return;
        arquivo.text().then(texto => {
            try {
                const dados = JSON.parse(texto);
                const alvoImportar = agvAtual();
                if (alvoImportar) alvoImportar.restauracao = { origem: "importada", ate: Date.now() + 10 * 60000 };
                carregarNoRascunho(alvoImportar, dados.parametros || dados, "arquivo");
            } catch (erro) {
                ui.aviso("Arquivo inválido.");
            }
        });
    });
    document.getElementById("configCopiarDe")?.addEventListener("change", evento => {
        const origem = agvs[evento.target.value];
        evento.target.value = "";
        if (origem?.parametros) carregarNoRascunho(agvAtual(), origem.parametros, `AGV ${origem.id}`);
    });
    document.getElementById("configSalvarNome")?.addEventListener("click", () => {
        const agv = agvAtual();
        const nome = document.getElementById("configNome")?.value.trim();
        if (!agv || !nome) return;
        agv.nome = nome;
        salvarAgvsFrota();
        renderizarFrota();
        atualizarPainel();
    });
    document.getElementById("cardOta")?.addEventListener("click", evento => {
        if (evento.target.id === "otaEnviar") enviarOta();
    });

    document.getElementById("historicoFiltros")?.addEventListener("click", evento => {
        const botao = evento.target.closest("[data-categoria]");
        if (!botao) return;
        filtroHistorico = botao.dataset.categoria;
        document.querySelectorAll("#historicoFiltros [data-categoria]").forEach(b => b.classList.toggle("ativo", b === botao));
        renderizarHistorico();
    });
    document.getElementById("historicoBusca")?.addEventListener("input", () => { limiteHistorico = 150; renderizarHistorico(); });
    document.getElementById("listaHistorico")?.addEventListener("click", evento => {
        if (evento.target.id !== "historicoMais") return;
        limiteHistorico += 150;
        renderizarHistorico();
    });
    document.getElementById("historicoExportar")?.addEventListener("click", exportarHistoricoCSV);
    document.getElementById("historicoLimpar")?.addEventListener("click", () => {
        const agv = agvAtual();
        if (!agv) return;
        ui.confirmar({ titulo: "Apagar o histórico?", texto: `Os eventos do AGV ${agv.id} guardados neste navegador serão apagados. O AGV não é afetado.`, confirmar: "Apagar", perigo: true }).then(ok => {
            if (!ok) return;
            agv.historico = [];
            salvarAgvsFrota();
            renderizarHistorico();
        });
        return;
        agv.historico = [];
        salvarAgvsFrota();
        renderizarHistorico();
    });
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = { calcularNovoBraco, calcularNovoRaio };
}
