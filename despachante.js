/* ============================================================
   DESPACHANTE — escolhe o AGV de cada pedido
   ============================================================
   Só a decisão, sem tela, sem MQTT e sem banco: recebe os pedidos,
   o estado dos AGVs e a planta e devolve quem faz o quê. Roda no
   navegador (window.Despachante, pela aba eleita líder) e no Node
   (require), para virar um serviço sem reescrever.

   Regras (0.13):
   1. Quem pode: online, automático, sem falha nem emergência, dentro
      do turno, bateria acima do mínimo, posição conhecida e livre
      (sem missão nem fila). Pedido com AGV fixo: só aquele AGV.
   2. Quem é melhor: menor custo = tempo até o início da missão pela
      planta + penalidade de estar no berço (carregando) + uso no dia.
   3. Ordem dos pedidos: prioridade da missão (urgente na frente),
      sobe um nível a cada N minutos esperando, depois quem pediu antes.
   4. Aproveitar a viagem: um pedido que começa exatamente onde outro
      termina vai para o mesmo AGV, em seguida (kit e vazio do posto).
   5. (0.14) AGV em manutenção não recebe. Estação com "Atendida por"
      (lista de modelos na planta) só recebe AGVs desses modelos.
*/
(function (raiz, fabrica) {
    if (typeof module === "object" && module.exports) module.exports = fabrica(require("./planta.js"));
    else raiz.Despachante = fabrica(raiz.Planta);
})(typeof self !== "undefined" ? self : this, function (Planta) {
    "use strict";

    const CONFIG_PADRAO = {
        subirAposS: 600,      // pedido esperando sobe um nível de prioridade a cada 10 min
        penalBercoS: 20,      // preferir quem não está no berço (carregando)
        penalUsoS: 3,         // por missão já feita no dia: equilibra o uso da frota
        bateriaMinima: 25,    // % (quando o AGV informar bateria)
        encadear: true,       // aproveitar a viagem
        restantePadraoS: 30   // quanto falta para terminar a missão atual, se não der para saber
    };

    const NOMES_PRIORIDADE = ["Baixa", "Normal", "Alta", "Urgente"];

    function configuracao(cfg) {
        return Object.assign({}, CONFIG_PADRAO, cfg || {});
    }

    // Prioridade usada na fila do Despacho (não muda o pedido nem o tráfego)
    function prioridadeEfetiva(pedido, agora, cfg) {
        const c = configuracao(cfg);
        if (pedido.urgente) return 4;
        const base = Math.max(0, Math.min(3, Number(pedido.prioridade ?? 1)));
        const espera = Math.max(0, (agora - (pedido.criadoEm || agora)) / 1000);
        const subiu = c.subirAposS > 0 ? Math.floor(espera / c.subirAposS) : 0;
        return Math.min(3, base + subiu);
    }

    function ordenar(pedidos, agora, cfg) {
        return pedidos.slice().sort((a, b) =>
            prioridadeEfetiva(b, agora, cfg) - prioridadeEfetiva(a, agora, cfg) ||
            (a.criadoEm || 0) - (b.criadoEm || 0) ||
            (Number(a.id) || 0) - (Number(b.id) || 0));
    }

    // Tempo estimado (s) de um pacote compilado: igual à estimativa da tela de missões
    function tempoEtapa(etapa) {
        if (!etapa) return 0;
        if (etapa.tipo === "MOVIMENTO") {
            let t = 0, frente = etapa.orientacaoInicial;
            (etapa.trechos || []).forEach(tr => {
                const lateral = tr.tipo === "LATERAL";
                const alvo = lateral ? tr.orientacao : tr.angulo;
                const giro = Math.abs(Planta.calcularGiro(frente, alvo));
                if (giro > 1) t += giro / 30;
                frente = alvo;
                const v = lateral ? 0.03 : (tr.velocidade || 0.06);
                t += (Number(tr.comprimento) || 0) / v + 2;
            });
            if (etapa.orientacaoChegada >= 0) {
                const g = Math.abs(Planta.calcularGiro(frente, etapa.orientacaoChegada));
                if (g > 1) t += g / 30;
            }
            return t;
        }
        if (etapa.tipo === "AGUARDAR") return Number(etapa.tempo) || 0;
        if (etapa.tipo === "CARREGAR" || etapa.tipo === "DESCARREGAR") return 8;
        if (etapa.tipo === "AGUARDAR_CONFIRMACAO") return 15;
        return 0;
    }
    const tempoPacote = pacote => (pacote?.etapas || []).reduce((s, e) => s + tempoEtapa(e), 0);
    const metrosEtapa = etapa => (etapa?.trechos || []).reduce((s, t) => s + (Number(t.comprimento) || 0), 0);

    function pontoFinal(pacote) {
        const etapas = pacote?.etapas || [];
        for (let i = etapas.length - 1; i >= 0; i--) {
            if (etapas[i].tipo === "MOVIMENTO") return etapas[i].destino;
        }
        return null;
    }

    // Compila a missão saindo de um ponto: { ok, pacote, aproximacao (s), metros, tempo, inicio, fim, erro }
    function prever(planta, missao, ponto, orientacao) {
        const no = ponto ? Planta.noPorId(planta, ponto) : null;
        const ori = Number.isFinite(Number(orientacao)) && orientacao !== null ? Number(orientacao) : (no?.orientacaoChegada ?? 0);
        const r = Planta.compilarMissao(planta, missao, ponto ? { ponto, orientacao: ori } : null);
        if (!r.sucesso) return { ok: false, erro: r.erro };
        const primeira = r.pacote.etapas.find(e => e.tipo === "MOVIMENTO");
        return {
            ok: true,
            pacote: r.pacote,
            aproximacao: tempoEtapa(primeira),
            metros: metrosEtapa(primeira),
            vazia: !primeira || !(primeira.trechos || []).length,   // a missão começa onde o AGV está
            inicio: primeira ? primeira.destino : ponto,
            fim: pontoFinal(r.pacote) || ponto,
            tempo: tempoPacote(r.pacote)
        };
    }

    // Por que um AGV não pode receber pedido agora (null = pode)
    function impedimento(agv, cfg) {
        if (agv.manutencao) return "em manutenção";
        if (!agv.online) return "offline";
        if (agv.semFila) return "com firmware sem fila (atualize)";
        if (agv.filaCheia) return "com a fila cheia";
        if (agv.emergencia) return "em emergência";
        if (agv.falha) return "com falha";
        if (agv.modo === "MANUAL") return "em manual";
        if (agv.turno === "fora") return "fora do turno";
        if (agv.bateria != null && Number(agv.bateria) < cfg.bateriaMinima) return `bateria baixa (${Math.round(agv.bateria)}%)`;
        if (!agv.posicaoConhecida || !agv.pontoAtual) return "posição desconhecida";
        return null;
    }

    // Estações da missão que limitam os modelos (planta › estação › "Atendida por")
    function estacoesRestritas(planta, missao) {
        const vistas = new Map();
        (missao?.etapas || []).filter(e => e.tipo === "IR_PARA" && e.destino).forEach(e => {
            const c = Planta.candidatosDestino(planta, e.destino);
            const est = c?.estacao;
            if (est && Array.isArray(est.modelos) && est.modelos.length) vistas.set(est.id, est);
        });
        return [...vistas.values()];
    }
    // Por que o modelo do AGV não serve para a missão (null = serve)
    function recusaModelo(planta, missao, agv) {
        const restritas = estacoesRestritas(planta, missao);
        if (!restritas.length) return null;
        const nomeEst = e => e.nome ? `${e.id} (${e.nome})` : e.id;
        if (!agv.modelo) return `sem modelo cadastrado, e ${nomeEst(restritas[0])} só aceita modelos escolhidos`;
        const nao = restritas.find(e => !e.modelos.includes(agv.modelo));
        return nao ? `${agv.modeloNome || agv.modelo} não atende ${nomeEst(nao)}` : null;
    }

    const tempoTexto = s => s < 90 ? `~${Math.max(1, Math.round(s))} s` : `~${Math.round(s / 60)} min`;
    const metrosTexto = m => m < 10 ? `${(Math.round(m * 10) / 10).toString().replace(".", ",")} m` : `${Math.round(m)} m`;

    /* --------------------------------------------------------
       DECIDIR
       --------------------------------------------------------
       entrada: {
         pedidos: [{ id, missao, posto, agvFixo, prioridade, urgente, estado, agv, vinculo, criadoEm, atribuidoEm, iniciadoEm, eta }],
         agvs: [{ id, online, modo, emergencia, falha, turno, bateria, posicaoConhecida, pontoAtual, orientacao,
                  ocupado, filaVazia, fimPrevisto, noBerco, usoHoje }],
         planta, missoes: [{ id, etapas, prioridade }], agora, config
       }
       saída: { atribuicoes: [{ pedido, agv, motivo, eta, encadeado }], espera: { pedidoId: motivo }, agvs: { id: situação } }
    */
    // "01 offline, 02 offline, V1 em manual" -> "V1 em manual · 2 offline"
    function resumirRecusas(recusas) {
        const offline = recusas.filter(r => / offline$/.test(r));
        const outras = recusas.filter(r => !/ offline$/.test(r));
        const partes = outras.slice(0, 3);
        if (outras.length > 3) partes.push(`+${outras.length - 3}`);
        if (offline.length) partes.push(offline.length === 1 ? offline[0] : `${offline.length} AGVs offline`);
        return partes.join(", ");
    }

    function decidir(entrada) {
        const cfg = configuracao(entrada.config);
        const agora = entrada.agora || Date.now();
        const planta = entrada.planta;
        const missoes = new Map((entrada.missoes || []).map(m => [String(m.id), m]));
        const pedidos = entrada.pedidos || [];
        const porId = new Map(pedidos.map(p => [String(p.id), p]));
        const atribuicoes = [];
        const espera = {};
        const situacao = {};

        // AGVs que já têm um pedido atribuído que ainda não começou: reservados
        const reservados = new Map();
        pedidos.filter(p => p.estado === "atribuido" && p.agv).forEach(p => reservados.set(p.agv, p));
        // Pedido em execução de cada AGV (para aproveitar a viagem)
        const emExecucao = new Map();
        pedidos.filter(p => p.estado === "em_execucao" && p.agv).forEach(p => emExecucao.set(p.agv, p));

        const agvs = (entrada.agvs || []).map(a => {
            const motivo = impedimento(a, cfg);
            const livre = !motivo && !a.ocupado && !reservados.has(a.id);
            situacao[a.id] = { livre, motivo: motivo || (reservados.has(a.id) ? `vai fazer o pedido #${reservados.get(a.id).id}` : a.ocupado ? "ocupado" : "livre") };
            return Object.assign({}, a, { impedimento: motivo, livre });
        });
        const usados = new Set();

        const pendentes = ordenar(pedidos.filter(p => p.estado === "pendente"), agora, cfg);

        // pedido B pode seguir A no mesmo AGV (aproveitar a viagem)?
        function encadeavel(b, fimDeA, agvId, aId) {
            if (!cfg.encadear || b.estado !== "pendente") return null;
            if (b.agvFixo && b.agvFixo !== agvId) return null;
            const mb = missoes.get(String(b.missao));
            if (!mb) return null;
            const p = prever(planta, mb, fimDeA, null);
            if (!p.ok) return null;
            const ligado = b.vinculo != null && String(b.vinculo) === String(aId);
            if (!ligado && !p.vazia) return null;
            return p;
        }

        function encadearDepois(a, agv, fimDeA, etaDeA) {
            const candidatos = pendentes.filter(b => b !== a && !b._feito);
            // primeiro o pedido ligado (levar o vazio na mesma viagem), depois quem começa ali
            candidatos.sort((x, y) => (String(y.vinculo) === String(a.id)) - (String(x.vinculo) === String(a.id)));
            for (const b of candidatos) {
                const p = encadeavel(b, fimDeA, agv.id, a.id);
                if (!p) continue;
                b._feito = true;
                atribuicoes.push({
                    pedido: b, agv: agv.id, encadeado: a.id,
                    motivo: String(b.vinculo) === String(a.id) ? `mesma viagem do pedido #${a.id}` : `aproveita a viagem: o pedido #${a.id} termina em ${fimDeA}`,
                    eta: Math.round(etaDeA + p.tempo)
                });
                return;
            }
        }

        for (const pedido of pendentes) {
            if (pedido._feito) continue;
            const missao = missoes.get(String(pedido.missao));
            if (!missao) { espera[pedido.id] = `a missão ${pedido.missao} não existe mais`; continue; }

            // pedido ligado a outro que ainda não saiu: espera ele
            if (pedido.vinculo != null) {
                const pai = porId.get(String(pedido.vinculo));
                if (pai && pai.estado === "pendente" && !pai._feito) { espera[pedido.id] = `vai junto com o pedido #${pai.id}`; continue; }
                // pai já com um AGV: só aquele AGV (na sequência)
                if (pai && ["atribuido", "em_execucao"].includes(pai.estado) && pai.agv) {
                    const agvPai = agvs.find(a => a.id === pai.agv);
                    const filaLivre = agvPai && !agvPai.impedimento && agvPai.filaVazia && !usados.has(agvPai.id);
                    const fim = agvPai?.fimPrevisto;
                    const p = filaLivre && fim ? encadeavel(pedido, fim, agvPai.id, pai.id) : null;
                    if (p) {
                        pedido._feito = true;
                        usados.add(agvPai.id);
                        atribuicoes.push({ pedido, agv: agvPai.id, encadeado: pai.id, motivo: `mesma viagem do pedido #${pai.id}`, eta: Math.round(restante(pai) + p.tempo) });
                    } else {
                        espera[pedido.id] = `espera o AGV ${pai.agv} terminar o pedido #${pai.id}`;
                    }
                    continue;
                }
            }

            // AGV fixo: vai para a fila dele mesmo se estiver ocupado (como o "+ Fila" do cartão)
            if (pedido.agvFixo) {
                const agv = agvs.find(a => a.id === pedido.agvFixo);
                if (!agv) { espera[pedido.id] = `o AGV ${pedido.agvFixo} não está cadastrado`; continue; }
                const barra = agv.manutencao ? "em manutenção" : !agv.online ? "offline" : agv.semFila ? "com firmware sem fila (atualize)" : agv.filaCheia ? "com a fila cheia" : null;
                if (barra) { espera[pedido.id] = `aguardando o AGV ${agv.id} ${barra}`; continue; }
                const naoServe = recusaModelo(planta, missao, agv);
                if (naoServe) { espera[pedido.id] = `o AGV ${agv.id} não pode fazer esta missão: ${naoServe}`; continue; }
                const livreAgora = !agv.ocupado && !reservados.has(agv.id) && !usados.has(agv.id);
                const ponto = livreAgora ? (agv.posicaoConhecida ? agv.pontoAtual : null) : agv.fimPrevisto;
                if (!ponto) {
                    espera[pedido.id] = livreAgora ? `aguardando o AGV ${agv.id}: posição desconhecida` : `aguardando saber onde a missão atual do AGV ${agv.id} termina`;
                    continue;
                }
                const p = prever(planta, missao, ponto, livreAgora ? agv.orientacao : null);
                if (!p.ok) { espera[pedido.id] = `AGV ${agv.id}: ${p.erro}`; continue; }
                const aviso = agv.impedimento && agv.impedimento !== "posição desconhecida" ? ` · vai esperar: ${agv.impedimento}` : "";
                pedido._feito = true;
                usados.add(agv.id);
                agv.fimPrevisto = p.fim;
                atribuicoes.push({ pedido, agv: agv.id, motivo: `AGV fixo${livreAgora ? "" : " · entra na fila do AGV"}${aviso}`, eta: Math.round(p.tempo + (livreAgora ? 0 : cfg.restantePadraoS)) });
                continue;
            }

            let melhor = null;
            const recusas = [];
            for (const agv of agvs) {
                if (pedido.agvFixo && agv.id !== pedido.agvFixo) continue;
                if (usados.has(agv.id)) { recusas.push(`${agv.id} acabou de receber outro pedido`); continue; }
                if (agv.impedimento) { recusas.push(`${agv.id} ${agv.impedimento}`); continue; }
                const naoServe = recusaModelo(planta, missao, agv);
                if (naoServe) { recusas.push(`${agv.id}: ${naoServe}`); continue; }
                let custo, eta, motivo, p;
                if (agv.livre) {
                    p = prever(planta, missao, agv.pontoAtual, agv.orientacao);
                    if (!p.ok) { recusas.push(`${agv.id}: ${p.erro}`); continue; }
                    custo = p.aproximacao + (agv.noBerco ? cfg.penalBercoS : 0) + (Number(agv.usoHoje) || 0) * cfg.penalUsoS;
                    eta = p.tempo;
                    const onde = agv.noBerco ? `no berço ${agv.pontoAtual}` : `em ${agv.pontoAtual}`;
                    motivo = p.vazia ? `livre ${onde}, já no ponto de partida` : `livre ${onde}, ${metrosTexto(p.metros)} até ${p.inicio} (${tempoTexto(p.aproximacao)})`;
                } else if (cfg.encadear && agv.ocupado && agv.filaVazia && agv.fimPrevisto && !reservados.has(agv.id)) {
                    // ocupado, mas termina exatamente onde este pedido começa
                    p = prever(planta, missao, agv.fimPrevisto, null);
                    if (!p.ok || !p.vazia) { recusas.push(`${agv.id} ocupado`); continue; }
                    const atual = emExecucao.get(agv.id);
                    const falta = atual ? restante(atual) : cfg.restantePadraoS;
                    custo = falta;
                    eta = falta + p.tempo;
                    motivo = `aproveita a viagem: termina a missão atual em ${agv.fimPrevisto}`;
                } else {
                    recusas.push(`${agv.id} ${situacao[agv.id]?.motivo || "ocupado"}`);
                    continue;
                }
                if (pedido.agvFixo) motivo = `AGV fixo · ${motivo}`;
                if (!melhor || custo < melhor.custo) melhor = { agv, custo, eta, motivo, p };
            }

            if (!melhor) {
                espera[pedido.id] = pedido.agvFixo
                    ? (recusas.length ? `aguardando o AGV ${recusas[0]}` : `o AGV ${pedido.agvFixo} não está cadastrado`)
                    : (recusas.length ? `aguardando AGV livre (${resumirRecusas(recusas)})` : "nenhum AGV cadastrado");
                continue;
            }
            pedido._feito = true;
            usados.add(melhor.agv.id);
            atribuicoes.push({ pedido, agv: melhor.agv.id, motivo: melhor.motivo, eta: Math.round(melhor.eta) });
            if (cfg.encadear) encadearDepois(pedido, melhor.agv, melhor.p.fim, melhor.eta);
        }

        function restante(p) {
            const base = p.iniciadoEm || p.atribuidoEm || agora;
            const eta = Number(p.eta) || cfg.restantePadraoS;
            return Math.max(5, eta - (agora - base) / 1000);
        }

        pendentes.forEach(p => { delete p._feito; });
        return { atribuicoes, espera, agvs: situacao };
    }

    return {
        CONFIG_PADRAO, NOMES_PRIORIDADE, configuracao, prioridadeEfetiva, ordenar,
        tempoEtapa, tempoPacote, prever, impedimento, decidir, tempoTexto, metrosTexto, recusaModelo, estacoesRestritas
    };
});
