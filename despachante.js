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
   6. (0.16) A rota é calculada pelo perfil do modelo (vazio/carregado:
      giro, lado, raio, guia) e a estação só recebe o módulo da carga dela.
      Cada botão do posto diz quem atende: modelos (obrigatório), Atta
      preferidos (vão primeiro; sem nenhum livre, depois de
      esperaPreferidoS vai outro dos modelos) e "só estes" (espera).
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
    // 0.20: vel = Modelos.velocidades() do AGV (m/s); sem ela, o firmware do protótipo
    const VEL_PROTOTIPO = { maxima: 0.10, cruzeiro: 0.06, aproximacao: 0.035, aceleracao: 0.20, lateral: 0.03 };
    function tempoEtapa(etapa, vel) {
        if (!etapa) return 0;
        const V = vel && vel.cruzeiro > 0 ? vel : VEL_PROTOTIPO;
        if (etapa.tipo === "MOVIMENTO") {
            let t = 0, frente = etapa.orientacaoInicial;
            (etapa.trechos || []).forEach(tr => {
                const lateral = tr.tipo === "LATERAL";
                const alvo = lateral ? tr.orientacao : tr.angulo;
                const giro = Math.abs(Planta.calcularGiro(frente, alvo));
                if (giro > 1) t += giro / 30;
                frente = alvo;
                // como o firmware: cruzeiro, limitado pelo trecho (zona lenta) e, na curva, a 70% da máxima
                let v = lateral ? V.lateral : Math.min(Number(tr.velocidade) > 0 ? Number(tr.velocidade) : V.cruzeiro, V.cruzeiro);
                if (tr.tipo === "CURVA") v = Math.min(v, V.maxima * 0.7);
                const L = Number(tr.comprimento) || 0;
                // acelerar e frear custam ~v/a; a faixa de pedestre: 1 s parado e devagar ao atravessar
                t += L / v + v / (V.aceleracao || 0.2) + 2;
                if (tr.faixa) t += 1 + Math.max(0, (Number(tr.faixa.ate) - Number(tr.faixa.parar)) || 0) * (1 / Math.max(0.01, V.aproximacao) - 1 / v);
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
    const tempoPacote = (pacote, vel) => (pacote?.etapas || []).reduce((s, e) => s + tempoEtapa(e, vel), 0);
    const metrosEtapa = etapa => (etapa?.trechos || []).reduce((s, t) => s + (Number(t.comprimento) || 0), 0);

    function pontoFinal(pacote) {
        const etapas = pacote?.etapas || [];
        for (let i = etapas.length - 1; i >= 0; i--) {
            if (etapas[i].tipo === "MOVIMENTO") return etapas[i].destino;
        }
        return null;
    }

    // Compila a missão saindo de um ponto: { ok, pacote, aproximacao (s), metros, tempo, inicio, fim, erro }
    // agv (0.16): { perfil: { vazio, carregado }, carregado } para a rota respeitar o modelo
    function prever(planta, missao, ponto, orientacao, agv = null) {
        const no = ponto ? Planta.noPorId(planta, ponto) : null;
        const ori = Number.isFinite(Number(orientacao)) && orientacao !== null ? Number(orientacao) : (no?.orientacaoChegada ?? 0);
        const r = Planta.compilarMissao(planta, missao, ponto ? { ponto, orientacao: ori } : null,
            agv && agv.perfil ? { perfil: agv.perfil, carregado: Boolean(agv.carregado) } : {});
        if (!r.sucesso) return { ok: false, erro: r.erro };
        const primeira = r.pacote.etapas.find(e => e.tipo === "MOVIMENTO");
        // 0.16: a ida até o início pode ter virado várias etapas (rota longa)
        const ida = primeira ? r.pacote.etapas.filter(e => e.tipo === "MOVIMENTO" && e.passo !== undefined && e.passo === primeira.passo) : [];
        const vel = agv?.perfil?.vazio?.velocidade || null;
        const somar = f => (ida.length > 1 ? ida : [primeira]).reduce((t, e) => t + (e ? f(e, vel) : 0), 0);
        const ultimaIda = ida.length > 1 ? ida[ida.length - 1] : primeira;
        return {
            ok: true,
            pacote: r.pacote,
            aproximacao: somar(tempoEtapa),
            metros: somar(metrosEtapa),
            vazia: !primeira || !(primeira.trechos || []).length,   // a missão começa onde o AGV está
            inicio: ultimaIda ? ultimaIda.destino : ponto,
            fim: pontoFinal(r.pacote) || ponto,
            tempo: tempoPacote(r.pacote, vel)
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

    // Regra do botão do posto (0.16): { modelos, preferidos, soEstes, esperaPreferidoS } ou null
    function regraDoBotao(postos, pedido) {
        if (!pedido.posto || !Array.isArray(postos)) return null;
        const posto = postos.find(p => String(p.id) === String(pedido.posto));
        const b = (posto?.botoes || []).find(x => String(x.missao) === String(pedido.missao));
        if (!b) return null;
        const lista = v => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
        return {
            modelos: lista(b.modelos), preferidos: lista(b.preferidos), soEstes: Boolean(b.soEstes) && lista(b.preferidos).length > 0,
            esperaPreferidoS: Math.max(0, Number(b.esperaPreferidoS ?? 120) || 0), rotulo: b.rotulo || ""
        };
    }
    // Por que o botão não aceita este AGV (null = aceita). Preferência não recusa.
    function recusaBotao(regra, agv) {
        if (!regra) return null;
        if (regra.modelos.length && !regra.modelos.includes(agv.modelo)) {
            return agv.modelo ? `${agv.modeloNome || agv.modelo} não foi escolhido para este botão` : "sem modelo, e o botão só aceita modelos escolhidos";
        }
        if (regra.soEstes && !regra.preferidos.includes(agv.id)) return "não é um dos Atta escolhidos para este botão";
        return null;
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
            const agvB = (entrada.agvs || []).find(x => x.id === agvId) || {};
            if (recusaBotao(regraDoBotao(entrada.postos, b), agvB)) return null;
            const p = prever(planta, mb, fimDeA, null, Object.assign({}, agvB, { carregado: false }));
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
                // AGV fixo: o modelo do botão vale (é físico); a preferência e o "só estes" não
                const regraFixo = regraDoBotao(entrada.postos, pedido);
                const naoServe = recusaModelo(planta, missao, agv) || recusaBotao(regraFixo && { modelos: regraFixo.modelos, preferidos: [], soEstes: false }, agv);
                if (naoServe) { espera[pedido.id] = `o AGV ${agv.id} não pode fazer esta missão: ${naoServe}`; continue; }
                const livreAgora = !agv.ocupado && !reservados.has(agv.id) && !usados.has(agv.id);
                const ponto = livreAgora ? (agv.posicaoConhecida ? agv.pontoAtual : null) : agv.fimPrevisto;
                if (!ponto) {
                    espera[pedido.id] = livreAgora ? `aguardando o AGV ${agv.id}: posição desconhecida` : `aguardando saber onde a missão atual do AGV ${agv.id} termina`;
                    continue;
                }
                const p = prever(planta, missao, ponto, livreAgora ? agv.orientacao : null, livreAgora ? agv : Object.assign({}, agv, { carregado: false }));
                if (!p.ok) { espera[pedido.id] = `AGV ${agv.id}: ${p.erro}`; continue; }
                const aviso = agv.impedimento && agv.impedimento !== "posição desconhecida" ? ` · vai esperar: ${agv.impedimento}` : "";
                pedido._feito = true;
                usados.add(agv.id);
                agv.fimPrevisto = p.fim;
                atribuicoes.push({ pedido, agv: agv.id, motivo: `AGV fixo${livreAgora ? "" : " · entra na fila do AGV"}${aviso}`, eta: Math.round(p.tempo + (livreAgora ? 0 : cfg.restantePadraoS)) });
                continue;
            }

            let melhor = null, melhorPreferido = null;
            const recusas = [];
            const regra = regraDoBotao(entrada.postos, pedido);
            const prefere = regra && regra.preferidos.length ? new Set(regra.preferidos) : null;
            for (const agv of agvs) {
                if (pedido.agvFixo && agv.id !== pedido.agvFixo) continue;
                if (usados.has(agv.id)) { recusas.push(`${agv.id} acabou de receber outro pedido`); continue; }
                if (agv.impedimento) { recusas.push(`${agv.id} ${agv.impedimento}`); continue; }
                const naoServe = recusaModelo(planta, missao, agv) || recusaBotao(regra, agv);
                if (naoServe) { recusas.push(`${agv.id}: ${naoServe}`); continue; }
                let custo, eta, motivo, p;
                if (agv.livre) {
                    p = prever(planta, missao, agv.pontoAtual, agv.orientacao, agv);
                    if (!p.ok) { recusas.push(`${agv.id}: ${p.erro}`); continue; }
                    custo = p.aproximacao + (agv.noBerco ? cfg.penalBercoS : 0) + (Number(agv.usoHoje) || 0) * cfg.penalUsoS;
                    eta = p.tempo;
                    const onde = agv.noBerco ? `no berço ${agv.pontoAtual}` : `em ${agv.pontoAtual}`;
                    motivo = p.vazia ? `livre ${onde}, já no ponto de partida` : `livre ${onde}, ${metrosTexto(p.metros)} até ${p.inicio} (${tempoTexto(p.aproximacao)})`;
                } else if (cfg.encadear && agv.ocupado && agv.filaVazia && agv.fimPrevisto && !reservados.has(agv.id)) {
                    // ocupado, mas termina exatamente onde este pedido começa
                    p = prever(planta, missao, agv.fimPrevisto, null, Object.assign({}, agv, { carregado: false }));
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
                if (prefere && prefere.has(agv.id) && (!melhorPreferido || custo < melhorPreferido.custo)) melhorPreferido = { agv, custo, eta, motivo: `preferido · ${motivo}`, p };
            }

            // Preferidos primeiro; sem nenhum disponível, espera um pouco e depois vai outro
            if (prefere && !regra.soEstes) {
                if (melhorPreferido) melhor = melhorPreferido;
                else if (melhor) {
                    const esperou = (agora - (pedido.criadoEm || agora)) / 1000;
                    if (esperou < regra.esperaPreferidoS) {
                        espera[pedido.id] = `aguardando os preferidos (${regra.preferidos.join(", ")}) · manda outro em ${tempoTexto(regra.esperaPreferidoS - esperou).replace("~", "")}`;
                        continue;
                    }
                    melhor = Object.assign({}, melhor, { motivo: `preferidos ocupados · ${melhor.motivo}` });
                }
            }

            if (!melhor && regra && regra.soEstes) {
                espera[pedido.id] = `aguardando um dos Atta escolhidos (${regra.preferidos.join(", ")})${recusas.length ? ": " + resumirRecusas(recusas.filter(r => regra.preferidos.some(id => r.startsWith(id)))) : ""}`;
                continue;
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
        tempoEtapa, tempoPacote, prever, impedimento, decidir, tempoTexto, metrosTexto, recusaModelo, estacoesRestritas,
        regraDoBotao, recusaBotao
    };
});
