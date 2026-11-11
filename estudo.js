/* ============================================================
   ESTUDO DE FROTA (0.21) — o motor (simulação rápida do turno)
   ============================================================
   Um Cenário = calendário + fluxos + premissas + frotas a testar.
   Para cada frota, o turno inteiro é simulado várias vezes (rodadas
   com variação aleatória) e sai uma faixa (P10, P50, P90).

   O que a simulação considera:
   - a rota de cada viagem (Planta.compilarMissao, a mesma do despacho)
     e o tempo de cada trecho na velocidade do modelo (Despachante),
     incluindo zona lenta, faixa de pedestre, curvas, giros;
   - as zonas de cruzamento: cada viagem reserva as zonas que pede e
     solta, e espera se outra viagem estiver usando (como o firmware);
   - o calendário: turnos, intervalos no berço (sem viagens novas e sem
     pedidos dos fluxos que pausam) e o pico de início de turno e de
     volta do intervalo;
   - o despacho: o pedido vai para o Atta livre, do modelo certo, que
     chega antes; prioridade primeiro;
   - um Atta em manutenção (premissa "indisponíveis").
   O que ela NÃO faz: rodar o firmware (isso é o Atta virtual, para
   conferir o cenário escolhido), bateria, falhas e gente no caminho.
*/
(function (raiz, fabrica) {
    if (typeof module === "object" && module.exports) module.exports = fabrica(raiz);
    else raiz.Estudo = fabrica(raiz);
})(typeof self !== "undefined" ? self : this, function (raiz) {
    const noNode = typeof module === "object" && module.exports && typeof require === "function";
    const P = () => raiz.Planta || (typeof Planta !== "undefined" ? Planta : noNode ? require("./planta.js") : null);
    const D = () => raiz.Despachante || (typeof Despachante !== "undefined" ? Despachante : noNode ? require("./despachante.js") : null);
    const M = () => raiz.Modelos || (typeof Modelos !== "undefined" ? Modelos : null);
    const C = () => raiz.Calendario || (typeof Calendario !== "undefined" ? Calendario : noNode ? require("./calendario.js") : null);

    const PREMISSAS_PADRAO = {
        crescimento: 0, variacao: 0.15, picoInicio: 0.5, picoVolta: 0.3, indisponiveis: 0,
        ocupacaoMax: 0.75, prazoAlvo: 0.95, rodadas: 8, dia: 1, semente: 7
    };
    const MAX_FROTAS = 30;
    const DEMANDAS = { porHora: "pedidos por hora", consumo: "pelo consumo", horarios: "horários fixos" };

    // números aleatórios repetíveis (a mesma semente dá o mesmo estudo)
    function aleatorio(semente) {
        let a = semente >>> 0;
        return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }
    const quantil = (lista, q) => {
        const v = lista.filter(Number.isFinite).slice().sort((a, b) => a - b);
        if (!v.length) return null;
        const i = (v.length - 1) * q, b = Math.floor(i);
        return v[b] + (v[Math.min(v.length - 1, b + 1)] - v[b]) * (i - b);
    };
    const faixa = lista => [quantil(lista, 0.1), quantil(lista, 0.5), quantil(lista, 0.9)];
    const min = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

    /* ---------------- fluxos ---------------- */

    // pedidos por hora de um fluxo (sem pico e sem crescimento)
    function taxaBase(f) {
        const d = f.demanda || {};
        if (d.tipo === "consumo") {
            const pv = Math.max(1, Number(d.porViagem) || 1);
            return Math.max(0, (Number(d.pecasHora) || 0) * (Number(d.consumoPeca) || 1) / pv);
        }
        if (d.tipo === "horarios") return (d.horarios || []).length / 16;
        return Math.max(0, Number(d.porHora) || 0);
    }

    // A missão de uma viagem do fluxo (da planta ou de → para)
    function missaoDoFluxo(f, missoes) {
        if (f.missao) {
            const m = (missoes || []).find(x => x.id === f.missao);
            if (m) return m;
        }
        if (f.de && f.para) return { id: "__F_" + f.id, nome: f.nome, etapas: [{ tipo: "IR_PARA", destino: f.de }, { tipo: "CARREGAR" }, { tipo: "IR_PARA", destino: f.para }, { tipo: "DESCARREGAR" }] };
        return null;
    }

    // "Importar da planta": um fluxo por botão de posto (e a programação, se houver).
    // O estudo planeja a frota de produção: o Atta E-O protótipo vira o Atta E-O.
    const PROTOTIPOS = { "atta-e-o": "atta-e-o-serie" };
    function fluxosDaPlanta(postos, programacoes, missoes) {
        const lista = [];
        (postos || []).forEach(p => (p.botoes || []).forEach(b => {
            if (!b.missao) return;
            const prog = (programacoes || []).find(x => x.posto === p.id && x.missao === b.missao && x.ativo !== false);
            const m = (missoes || []).find(x => x.id === b.missao);
            let demanda = { tipo: "porHora", porHora: 2 };
            if (prog?.modo === "consumo" && Number(prog.dura_min) > 0) demanda = { tipo: "porHora", porHora: Math.round(60 / Number(prog.dura_min) * 10) / 10 };
            else if (prog?.modo === "intervalo" && Number(prog.intervalo_min) > 0) demanda = { tipo: "porHora", porHora: Math.round(60 / Number(prog.intervalo_min) * 10) / 10 };
            else if (prog?.modo === "horarios") demanda = { tipo: "horarios", horarios: (prog.horarios || []).slice() };
            lista.push({
                id: `${p.id}:${b.missao}`, nome: `${p.nome || p.id} · ${b.rotulo || m?.nome || b.missao}`, posto: p.id, missao: b.missao,
                modelos: [...new Set((b.modelos || []).map(x => PROTOTIPOS[x] || x))], demanda, turnos: (prog?.turnos || []).slice(),
                pegarS: 30, entregarS: 30, prazoMin: 10, prioridade: Number(m?.prioridade) || 2, origem: "planta", pausaIntervalo: prog ? prog.pausar_intervalos !== false : true
            });
        }));
        return lista;
    }

    // "Repetir a demanda do dia X": pedidos de um dia → pedidos por hora de cada botão
    function fluxosDoDia(pedidos, base, diaTexto) {
        const C_ = C();
        const doDia = (pedidos || []).filter(p => p.criadoEm && C_ && C_.local(p.criadoEm).data === diaTexto && p.estado !== "cancelado");
        const porChave = {};
        doDia.forEach(p => { const k = `${p.posto}:${p.missao}`; (porChave[k] = porChave[k] || []).push(C_.local(p.criadoEm).min); });
        return (base || []).map(f => {
            const ms = porChave[f.id] || [];
            if (!ms.length) return Object.assign({}, f, { demanda: { tipo: "porHora", porHora: 0 }, origem: "dia " + diaTexto });
            return Object.assign({}, f, { demanda: { tipo: "horarios", horarios: ms.sort((a, b) => a - b).map(m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`) }, origem: "dia " + diaTexto });
        });
    }

    /* ---------------- o dia de trabalho (calendário) ---------------- */

    // janelas [ini, fim) em minutos do dia simulado; intervalos com ação
    function diaDeTrabalho(cal, dia) {
        const C_ = C();
        const c = C_ ? C_.normalizar(cal) : { turnos: [], intervalos: [] };
        const dentro = (t, d) => (t.dias || []).includes(d);
        const turnos = c.turnos.filter(t => dentro(t, dia)).map(t => {
            let a = min(t.inicio), b = min(t.fim);
            if (b <= a) b += 1440;
            return { id: t.id, nome: t.nome, a, b };
        }).sort((x, y) => x.a - y.a);
        const intervalos = c.intervalos.filter(t => dentro(t, dia)).map(t => {
            let a = min(t.inicio), b = min(t.fim);
            if (b <= a) b += 1440;
            return { id: t.id, nome: t.nome, a, b, acao: t.acao, postos: t.postos || [] };
        });
        if (!turnos.length) turnos.push({ id: "_", nome: "Dia", a: 6 * 60, b: 22 * 60 });
        return { turnos, intervalos, inicio: Math.min(...turnos.map(t => t.a)), fim: Math.max(...turnos.map(t => t.b)) };
    }
    const emTurno = (dt, m, ids) => dt.turnos.some(t => (!ids || !ids.length || ids.includes(t.id) || t.id === "_") && m >= t.a && m < t.b);
    const intervaloEm = (dt, m, posto) => dt.intervalos.find(i => m >= i.a && m < i.b && (!i.postos.length || (posto && i.postos.includes(posto))));
    const bercoEm = (dt, m) => dt.intervalos.find(i => m >= i.a && m < i.b && !i.postos.length && i.acao === "BERCO");

    // multiplicador de pico: 1ª hora do turno e 1ª meia hora depois de um intervalo
    function pico(dt, m, pr) {
        let x = 1;
        if (dt.turnos.some(t => m >= t.a && m < t.a + 60)) x += pr.picoInicio;
        if (dt.intervalos.some(i => m >= i.b && m < i.b + 30)) x += pr.picoVolta;
        return x;
    }

    // os pedidos de um fluxo no dia simulado (minutos)
    function gerarPedidos(f, dt, pr, rnd, fatorRodada) {
        const lista = [];
        const d = f.demanda || {};
        const valendo = m => emTurno(dt, m, f.turnos) && !(f.pausaIntervalo !== false && intervaloEm(dt, m, f.posto) && intervaloEm(dt, m, f.posto).acao !== "TRABALHAR");
        if (d.tipo === "horarios") {
            (d.horarios || []).forEach(h => { const m = min(h); if (m !== null && valendo(m)) lista.push(m + rnd() * 0.5); });
            // crescimento: pedidos a mais no meio dos horários
            const extra = Math.round(lista.length * pr.crescimento);
            for (let i = 0; i < extra; i++) { const m = dt.inicio + rnd() * (dt.fim - dt.inicio); if (valendo(m)) lista.push(m); }
            return lista.sort((a, b) => a - b);
        }
        const base = taxaBase(f) * (1 + pr.crescimento) * fatorRodada;
        if (base <= 0) return lista;
        if (d.tipo === "consumo") {
            // periódico, com um pouco de folga para cada lado
            const passo = 60 / base;
            for (let m = dt.inicio + rnd() * passo; m < dt.fim; m += passo / pico(dt, m, pr) * (1 + (rnd() - 0.5) * pr.variacao)) if (valendo(m)) lista.push(m);
            return lista;
        }
        // Poisson com a taxa da hora (pico incluído)
        let m = dt.inicio;
        while (m < dt.fim) {
            const taxa = base * pico(dt, m, pr) / 60;   // por minuto
            m += -Math.log(1 - rnd()) / Math.max(1e-6, taxa);
            if (m < dt.fim && valendo(m)) lista.push(m);
        }
        return lista;
    }

    /* ---------------- viagens (rota, tempo, zonas) ---------------- */

    // Cada viagem vira uma linha do tempo (s, a partir da saída): quando o Atta pede
    // zonas (todas de uma vez, como o firmware) e quando solta. O tempo de cada trecho
    // é o mesmo que o despacho usa (Despachante.tempoEtapa, na velocidade do modelo).
    function criarRotas(planta, missoes) {
        const cache = new Map();
        // { ok, dur, fim, aproximacao, passos: [{t, pedir|soltar: [zona]}], trechos: [seg], metros }
        return function viagem(missao, ponto, modeloId, opcoes = {}) {
            const chave = `${missao.id}|${ponto}|${modeloId}|${opcoes.pegarS ?? ""}|${opcoes.entregarS ?? ""}`;
            if (cache.has(chave)) return cache.get(chave);
            const m = M() ? M().porId(modeloId) : null;
            const perfil = m && M() ? M().perfil(m) : null;
            const r = D().prever(planta, missao, ponto, null, perfil ? { perfil } : null);
            let res;
            if (!r.ok) res = { ok: false, erro: r.erro };
            else {
                const vel = perfil?.vazio?.velocidade || null;
                const nomes = r.pacote.zonas || [];
                const daMascara = mask => nomes.filter((z, i) => mask & (1 << i));
                const passos = [], seguras = new Set();
                const pedir = (mask, t) => { const zs = daMascara(mask).filter(z => !seguras.has(z)); if (zs.length) { zs.forEach(z => seguras.add(z)); passos.push({ t, pedir: zs }); } };
                const soltar = (mask, t) => { const zs = daMascara(mask).filter(z => seguras.has(z)); if (zs.length) { zs.forEach(z => seguras.delete(z)); passos.push({ t, soltar: zs }); } };
                let t = 0, metros = 0;
                const trechos = [];
                pedir(r.pacote.zonasInicio || 0, 0);
                r.pacote.etapas.forEach(e => {
                    if (e.tipo === "MOVIMENTO") {
                        let frente = e.orientacaoInicial;
                        (e.trechos || []).forEach(tr => {
                            if (tr.pedir) pedir(tr.pedir, t);
                            t += D().tempoEtapa({ tipo: "MOVIMENTO", orientacaoInicial: frente, trechos: [tr] }, vel);
                            frente = tr.tipo === "LATERAL" ? tr.orientacao : tr.angulo;
                            metros += Number(tr.comprimento) || 0;
                            if (tr.segmento) trechos.push(tr.segmento);
                            if (tr.liberar) soltar(tr.liberar, t);
                        });
                        if (e.orientacaoChegada >= 0) { const g = Math.abs(P().calcularGiro(frente, e.orientacaoChegada)); if (g > 1) t += g / 30; }
                    } else if (e.tipo === "CARREGAR") t += Number(opcoes.pegarS ?? 30);
                    else if (e.tipo === "DESCARREGAR") t += Number(opcoes.entregarS ?? 30);
                    else t += D().tempoEtapa(e, vel);
                });
                if (seguras.size) passos.push({ t, soltar: [...seguras] });
                res = { ok: true, dur: t, fim: r.fim, inicio: r.inicio, aproximacao: r.aproximacao, passos, trechos, metros };
            }
            cache.set(chave, res);
            return res;
        };
    }

    // fila de eventos (heap pelo tempo; empate: quem entrou antes)
    function Eventos() {
        const h = [];
        let seq = 0;
        const menor = (i, j) => h[i][0] < h[j][0] || (h[i][0] === h[j][0] && h[i][1] < h[j][1]);
        return {
            por(t, fn) {
                h.push([t, seq++, fn]);
                for (let i = h.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!menor(i, p)) break; [h[i], h[p]] = [h[p], h[i]]; i = p; }
            },
            tirar() {
                const topo = h[0], ult = h.pop();
                if (h.length) {
                    h[0] = ult;
                    for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && menor(l, m)) m = l; if (r < h.length && menor(r, m)) m = r; if (m === i) break; [h[i], h[m]] = [h[m], h[i]]; i = m; }
                }
                return topo;
            },
            get tamanho() { return h.length; }
        };
    }

    /* ---------------- uma rodada (simulação por eventos) ---------------- */

    const DESTRAVAR_S = 600;   // esperando zona há 10 min: conta como travamento e segue

    function rodada(ctx, frota, pr, semente) {
        const { planta, missoes, fluxos, dt, viagem, bercos } = ctx;
        // 0.22: quantos Atta cabem na zona ao mesmo tempo (1 = como o firmware; 2 = segundo acesso no gargalo)
        const cabe = z => Math.max(1, Number(ctx.capacidade?.[z]) || 1);
        const rnd = aleatorio(semente);
        const fatorRodada = 1 + (rnd() - 0.5) * 2 * pr.variacao;
        // os Atta (os indisponíveis saem da conta)
        const atta = [];
        frota.forEach(g => { for (let i = 0; i < g.n; i++) atta.push({ id: `${g.modelo}#${i + 1}`, modelo: g.modelo }); });
        // indisponíveis: sai um do modelo que tem mais Atta
        for (let i = 0; i < pr.indisponiveis && atta.length; i++) {
            const conta = {};
            atta.forEach(a => { conta[a.modelo] = (conta[a.modelo] || 0) + 1; });
            const mod = Object.keys(conta).sort((x, y) => conta[y] - conta[x])[0];
            atta.splice(atta.map(a => a.modelo).lastIndexOf(mod), 1);
        }
        const pontoInicial = planta.nos.find(n => n.tipo === "ESTACAO")?.id || planta.nos[0]?.id;
        atta.forEach((a, i) => { a.berco = a.ponto = bercos.length ? bercos[i % bercos.length] : pontoInicial; a.livre = true; a.ocupado = 0; a.viagens = 0; a.metros = 0; a.porHora = {}; a.desde = 0; });
        // pedidos do dia
        const pedidos = [];
        fluxos.forEach(f => {
            const missao = missaoDoFluxo(f, missoes);
            if (!missao) return;
            gerarPedidos(f, dt, pr, rnd, fatorRodada).forEach(m => pedidos.push({ f, missao, criado: m * 60, prioridade: Number(f.prioridade) || 2 }));
        });
        pedidos.sort((a, b) => a.criado - b.criado);

        const ev = Eventos();
        const fim = dt.fim * 60, corte = fim + 1800;
        const dono = {}, esperando = [];
        const esperaZona = {}, passagens = {}, feitos = [], fila = [];
        let travamentos = 0;
        const disponivel = t => emTurno(dt, t / 60) && !bercoEm(dt, t / 60);
        const somarHoras = (a, t0, t1) => { for (let x = t0; x < t1;) { const h = Math.floor(x / 3600), y = Math.min(t1, (h + 1) * 3600); a.porHora[h] = (a.porHora[h] || 0) + (y - x); x = y; } };

        function agendar(v, t, forcar) {
            const tok = ++v.token;
            ev.por(t, agora => { if (tok === v.token) avancar(v, agora, forcar); });
        }
        function acordar(zonas, agora) {
            esperando.filter(w => w.aguardando && w.aguardando.zonas.some(z => zonas.includes(z)))
                .sort((x, y) => x.aguardando.desde - y.aguardando.desde)
                .forEach(w => agendar(w, agora, false));
        }
        function avancar(v, agora, forcar) {
            const passos = v.rota.passos;
            while (v.cursor < passos.length) {
                const ps = passos[v.cursor];
                const quando = v.base + ps.t;
                if (quando > agora + 1e-6) { agendar(v, quando); return; }
                if (ps.soltar) {
                    ps.soltar.forEach(z => { const d = dono[z]; const i = d ? d.indexOf(v) : -1; if (i >= 0) d.splice(i, 1); });
                    acordar(ps.soltar, agora);
                    v.cursor++;
                    continue;
                }
                const ocupadas = ps.pedir.filter(z => { const d = dono[z] || []; return !d.includes(v) && d.length >= cabe(z); });
                if (ocupadas.length && !forcar) {
                    if (!v.aguardando) { v.aguardando = { desde: agora, zonas: ps.pedir, zona: ocupadas[0] }; esperando.push(v); }
                    agendar(v, Math.max(agora, v.aguardando.desde + DESTRAVAR_S), true);
                    return;
                }
                if (ocupadas.length && forcar) travamentos++;
                ps.pedir.forEach(z => { const d = dono[z] = dono[z] || []; if (!d.includes(v) && d.length < cabe(z)) d.push(v); });
                if (v.aguardando) {
                    const w = agora - v.aguardando.desde;
                    v.base += w; v.espera += w;
                    esperaZona[v.aguardando.zona] = (esperaZona[v.aguardando.zona] || 0) + w;
                    esperando.splice(esperando.indexOf(v), 1);
                    v.aguardando = null;
                }
                forcar = false;
                v.cursor++;
            }
            const termina = v.base + v.rota.dur;
            if (termina > agora + 1e-6) { agendar(v, termina); return; }
            // chegou: o Atta fica livre onde terminou (ou volta para o berço)
            const a = v.a;
            a.livre = true; a.viagens++; a.metros += v.rota.metros; a.ocupado += agora - v.saiu;
            somarHoras(a, v.saiu, agora);
            a.ponto = disponivel(agora) ? (v.rota.fim || a.ponto) : a.berco;
            feitos.push({ p: v.p, inicio: v.saiu, espera: v.espera, termina: agora, atta: a.id, tempo: agora - v.p.criado });
            despachar(agora);
        }
        function despachar(agora) {
            if (!fila.length || !disponivel(agora)) return;
            fila.sort((a, b) => b.prioridade - a.prioridade || a.criado - b.criado);
            for (let k = 0; k < fila.length; k++) {
                const p = fila[k];
                const aptos = atta.filter(a => a.livre && (!p.f.modelos?.length || p.f.modelos.includes(a.modelo)));
                if (!aptos.length) continue;
                let melhor = null;
                aptos.forEach(a => {
                    const r = viagem(p.missao, a.ponto, a.modelo, p.f);
                    if (r.ok && (!melhor || r.aproximacao < melhor.r.aproximacao)) melhor = { a, r };
                });
                fila.splice(k, 1); k--;
                if (!melhor) { feitos.push({ p, falhou: true }); continue; }
                const { a, r } = melhor;
                a.livre = false;
                r.trechos.forEach(sg => { passagens[sg] = (passagens[sg] || 0) + 1; });
                const v = { a, p, rota: r, base: agora, saiu: agora, cursor: 0, espera: 0, aguardando: null, token: 0 };
                avancar(v, agora, false);
            }
        }
        // eventos: pedidos, viradas do calendário (fim do intervalo, começo do turno)
        pedidos.forEach(p => ev.por(p.criado, agora => { fila.push(p); despachar(agora); }));
        const viradas = new Set();
        dt.turnos.forEach(t => { viradas.add(t.a * 60); viradas.add(t.b * 60); });
        dt.intervalos.forEach(i => { viradas.add(i.a * 60); viradas.add(i.b * 60); });
        viradas.forEach(t => ev.por(t, agora => {
            // começou o intervalo no berço ou acabou o turno: quem está livre vai para o berço
            if (!disponivel(agora)) atta.forEach(a => { if (a.livre) a.ponto = a.berco; });
            despachar(agora);
        }));
        let guarda = 0;
        while (ev.tamanho && guarda++ < 2e6) {
            const [t, , fn] = ev.tirar();
            if (t > corte) break;
            fn(t);
        }
        fila.forEach(p => feitos.push({ p, naoAtendido: true }));

        // métricas
        const entregues = feitos.filter(x => x.termina !== undefined);
        const horasDisp = (() => { let s = 0; for (let m = dt.inicio; m < dt.fim; m++) if (disponivel(m * 60)) s++; return s / 60; })();
        const tempos = entregues.map(x => x.tempo / 60);
        const prazo = x => Number(x.p.f.prazoMin) || 10;
        const noPrazo = entregues.filter(x => x.tempo / 60 <= prazo(x)).length;
        const total = pedidos.length;
        const porHora = {};
        const hora = h => (porHora[h] = porHora[h] || { pedidos: 0, entregas: 0, ocupacao: 0 });
        pedidos.forEach(p => { hora(Math.floor(p.criado / 3600)).pedidos++; });
        entregues.forEach(x => { hora(Math.floor(x.termina / 3600)).entregas++; });
        Object.keys(porHora).forEach(h => { porHora[h].ocupacao = atta.length ? atta.reduce((s, a) => s + (a.porHora[h] || 0), 0) / (atta.length * 3600) : 0; });
        const porFluxo = {};
        feitos.forEach(x => {
            const r = porFluxo[x.p.f.id] = porFluxo[x.p.f.id] || { pedidos: 0, entregues: 0, noPrazo: 0, soma: 0 };
            r.pedidos++;
            if (x.termina !== undefined) { r.entregues++; r.soma += x.tempo / 60; if (x.tempo / 60 <= prazo(x)) r.noPrazo++; }
        });
        return {
            pedidos: total, entregas: entregues.length, naoAtendidos: total - entregues.length,
            entregasHora: horasDisp ? entregues.length / horasDisp : 0,
            noPrazo: total ? noPrazo / total : 1,
            tempoMedio: tempos.length ? tempos.reduce((s, x) => s + x, 0) / tempos.length : null,
            tempoP90: quantil(tempos, 0.9),
            ocupacao: atta.length && horasDisp ? atta.reduce((s, a) => s + a.ocupado, 0) / (atta.length * horasDisp * 3600) : 0,
            esperaTrafegoMin: Object.values(esperaZona).reduce((s, x) => s + x, 0) / 60,
            esperaViagemS: entregues.length ? entregues.reduce((s, x) => s + x.espera, 0) / entregues.length : 0,
            esperaViagemP90: quantil(entregues.map(x => x.espera), 0.9) || 0,
            esperaZona, passagens, porHora, porFluxo, travamentos,
            porAtta: atta.map(a => ({ id: a.id, modelo: a.modelo, viagens: a.viagens, km: a.metros / 1000, ocupacao: horasDisp ? a.ocupado / (horasDisp * 3600) : 0 })),
            horasDisp, falhas: feitos.filter(x => x.falhou).length
        };
    }

    /* ---------------- o estudo inteiro ---------------- */

    function frotasDoCenario(grupos) {
        let lista = [[]];
        (grupos || []).forEach(g => {
            const a = Math.max(0, Math.floor(Number(g.de) || 0)), b = Math.max(a, Math.floor(Number(g.ate) || a));
            const nova = [];
            lista.forEach(l => { for (let n = a; n <= b; n++) nova.push(l.concat([{ modelo: g.modelo, n }])); });
            lista = nova;
        });
        return lista.filter(l => l.reduce((s, g) => s + g.n, 0) > 0);
    }
    const nomeFrota = f => f.filter(g => g.n).map(g => `${g.n} ${M()?.porId(g.modelo)?.nome || g.modelo}`).join(" + ");

    function resumir(rodadas) {
        const k = ch => faixa(rodadas.map(r => r[ch]));
        const horas = {};
        rodadas.forEach(r => Object.entries(r.porHora).forEach(([h, v]) => { (horas[h] = horas[h] || []).push(v); }));
        const porHora = Object.keys(horas).map(Number).sort((a, b) => a - b).map(h => ({
            h, pedidos: quantil(horas[h].map(v => v.pedidos), 0.5), entregas: quantil(horas[h].map(v => v.entregas), 0.5), ocupacao: quantil(horas[h].map(v => v.ocupacao), 0.5)
        }));
        const somaMapa = ch => { const r = {}; rodadas.forEach(x => Object.entries(x[ch]).forEach(([z, v]) => { r[z] = (r[z] || 0) + v / rodadas.length; })); return r; };
        const fl = {};
        rodadas.forEach(x => Object.entries(x.porFluxo).forEach(([id, v]) => { const r = fl[id] = fl[id] || { pedidos: 0, entregues: 0, noPrazo: 0, soma: 0 }; Object.keys(v).forEach(c => { r[c] += v[c] / rodadas.length; }); }));
        const porAtta = rodadas[0] ? rodadas[0].porAtta.map((a, i) => ({ id: a.id, modelo: a.modelo, viagens: quantil(rodadas.map(r => r.porAtta[i]?.viagens), 0.5), km: quantil(rodadas.map(r => r.porAtta[i]?.km), 0.5), ocupacao: quantil(rodadas.map(r => r.porAtta[i]?.ocupacao), 0.5) })) : [];
        return {
            pedidos: k("pedidos"), entregas: k("entregas"), entregasHora: k("entregasHora"), noPrazo: k("noPrazo"),
            tempoMedio: k("tempoMedio"), tempoP90: k("tempoP90"), ocupacao: k("ocupacao"), esperaTrafegoMin: k("esperaTrafegoMin"), naoAtendidos: k("naoAtendidos"),
            porHora, esperaZona: somaMapa("esperaZona"), passagens: somaMapa("passagens"), porFluxo: fl, porAtta, horasDisp: rodadas[0]?.horasDisp || 0, falhas: Math.max(...rodadas.map(r => r.falhas), 0)
        };
    }

    function contexto(cenario, base) {
        const planta = base.planta;
        const dt = diaDeTrabalho(cenario.calendario, Number(cenario.premissas?.dia ?? 1));
        const bercos = planta.nos.filter(n => n.tipo === "BERCO").map(n => n.id);
        return { planta, missoes: base.missoes || [], fluxos: (cenario.fluxos || []).filter(f => f.ativo !== false), dt, viagem: criarRotas(planta, base.missoes || []), bercos, capacidade: cenario.capacidadeZonas || {} };
    }

    function rodarFrota(ctx, frota, pr) {
        const rodadas = [];
        for (let i = 0; i < pr.rodadas; i++) rodadas.push(rodada(ctx, frota, pr, (pr.semente || 7) * 1000 + i));
        return resumir(rodadas);
    }

    // Achar a frota: começa em "inicio" e põe um Atta de cada vez onde mais falta
    // (o modelo dos fluxos fora do prazo ou o mais ocupado), até atender ou acabar a faixa.
    // testar(frota, passo) roda a frota e devolve { r, atende }.
    // Sem achar, info diz por quê: "trafego" (mais Atta não melhora: os cruzamentos
    // seguram a frota, com a zona que mais segura) ou "faixa" (acabou a faixa).
    const gargaloDe = r => Object.entries(r?.esperaZona || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    async function acharFrota(ctx, pr, inicio, grupos, testar, info = {}) {
        let atual = inicio.map(g => ({ modelo: g.modelo, n: g.n }));
        const maxPassos = Math.min(MAX_FROTAS, grupos.reduce((s, g) => s + Math.max(0, g.ate - (atual.find(x => x.modelo === g.modelo)?.n || 0)), 0) + 1);
        const historico = [];
        info.motivo = "faixa";
        for (let passo = 0; passo < maxPassos; passo++) {
            const c = await testar(atual, passo);
            if (c.atende) { info.motivo = ""; return c; }
            historico.push(c);
            if (!info.melhor || c.r.noPrazo[1] > info.melhor.r.noPrazo[1]) info.melhor = c;
            // três Atta a mais sem ganhar 2 pontos no prazo, e a espera no tráfego subindo: travou
            if (historico.length >= 4) {
                const a = historico[historico.length - 4], b = c;
                if (b.r.noPrazo[1] - a.r.noPrazo[1] < 0.02 && b.r.esperaTrafegoMin[1] > a.r.esperaTrafegoMin[1] && b.r.ocupacao[1] <= pr.ocupacaoMax) {
                    info.motivo = "trafego"; info.gargalo = gargaloDe(b.r);
                    return null;
                }
            }
            const falta = {};
            ctx.fluxos.forEach(f => {
                const v = c.r.porFluxo[f.id];
                if (!v || !v.pedidos) return;
                const deficit = Math.max(0, pr.prazoAlvo - v.noPrazo / v.pedidos) * v.pedidos;
                const quem = atual.filter(g => !f.modelos?.length || f.modelos.includes(g.modelo));
                quem.forEach(g => { falta[g.modelo] = (falta[g.modelo] || 0) + deficit / quem.length; });
            });
            atual.forEach(g => {
                const oc = c.r.porAtta.filter(a => a.modelo === g.modelo).map(a => a.ocupacao);
                const media = oc.length ? oc.reduce((s, x) => s + x, 0) / oc.length : 0;
                if (media > pr.ocupacaoMax) falta[g.modelo] = (falta[g.modelo] || 0) + (media - pr.ocupacaoMax) * 100;
            });
            const cabe = atual.filter(g => g.n < (grupos.find(x => x.modelo === g.modelo)?.ate || 0) && falta[g.modelo] > 0);
            if (!cabe.length) { info.gargalo = gargaloDe(c.r); return null; }
            const escolhido = cabe.sort((x, y) => falta[y.modelo] - falta[x.modelo])[0];
            atual = atual.map(g => g.modelo === escolhido.modelo ? { modelo: g.modelo, n: g.n + 1 } : g);
        }
        return null;
    }

    // { cenarios: [{ frota, nome, total, r, atende, passo }], recomendado, sensibilidade, dia, avisos, viagens }
    // assíncrono: devolve o controle à tela entre uma frota e outra (a página não trava)
    const respirar = () => new Promise(r => setTimeout(r, 0));
    async function rodar(cenario, base, aoProgresso) {
        const pr = Object.assign({}, PREMISSAS_PADRAO, cenario.premissas || {});
        pr.rodadas = Math.max(1, Math.min(40, Math.floor(pr.rodadas)));
        const ctx = contexto(cenario, base);
        const avisos = [];
        ctx.fluxos.forEach(f => { if (!missaoDoFluxo(f, ctx.missoes)) avisos.push(`${f.nome}: sem missão nem de → para; ficou de fora.`); });
        // quanto cada fluxo leva sozinho (sem fila, sem tráfego), saindo de onde a missão começa
        const viagens = {};
        const modelosNaFrota = [...new Set((cenario.frotas || []).map(g => g.modelo))];
        ctx.fluxos.forEach(f => {
            const missao = missaoDoFluxo(f, ctx.missoes);
            if (!missao) return;
            const mod = (f.modelos || []).find(x => modelosNaFrota.includes(x)) || (f.modelos || [])[0] || modelosNaFrota[0];
            if (f.modelos?.length && !f.modelos.some(x => modelosNaFrota.includes(x))) avisos.push(`${f.nome}: nenhum Atta da frota atende (precisa de ${f.modelos.map(x => M()?.porId(x)?.nome || x).join(" ou ")}).`);
            const ini = (missao.etapas || []).find(e => e.tipo === "IR_PARA")?.destino;
            const r = ini && mod ? ctx.viagem(missao, ini, mod, f) : null;
            if (r?.ok) {
                viagens[f.id] = { min: (r.dur - r.aproximacao) / 60, metros: r.metros, modelo: mod };
                if (viagens[f.id].min > (Number(f.prazoMin) || 10)) avisos.push(`${f.nome}: só a viagem leva ${viagens[f.id].min.toFixed(1).replace(".", ",")} min, mais que o prazo de ${f.prazoMin} min.`);
            } else if (r && !r.ok) avisos.push(`${f.nome}: a rota não fecha para ${M()?.porId(mod)?.nome || mod} (${r.erro}).`);
        });
        const cenarios = [];
        const t0 = Date.now();
        // a menor frota que atende: no prazo (P50) ≥ alvo, ocupação (P50) ≤ máximo, sem pedido sobrando
        const atende = c => c.r.noPrazo[1] >= pr.prazoAlvo && c.r.ocupacao[1] <= pr.ocupacaoMax && c.r.naoAtendidos[1] <= 0.5;
        const testar = async (fr, passo) => {
            await respirar();
            const c = { frota: fr.map(g => ({ modelo: g.modelo, n: g.n })), nome: nomeFrota(fr), total: fr.reduce((s, g) => s + g.n, 0), r: rodarFrota(ctx, fr, pr), passo };
            c.atende = atende(c);
            cenarios.push(c);
            return c;
        };
        const grupos = (cenario.frotas || []).filter(g => g.modelo).map(g => ({ modelo: g.modelo, de: Math.max(0, Math.floor(Number(g.de) || 0)), ate: Math.max(Math.floor(Number(g.de) || 0), Math.floor(Number(g.ate) || 0)) }));
        let recomendado = null;
        const busca = {};
        if (cenario.busca === "todas") {
            // todas as combinações das faixas (as menores primeiro)
            let frotas = frotasDoCenario(grupos).sort((a, b) => a.reduce((s, g) => s + g.n, 0) - b.reduce((s, g) => s + g.n, 0));
            if (frotas.length > MAX_FROTAS) { avisos.push(`São ${frotas.length} combinações de frota; o estudo testou as ${MAX_FROTAS} menores. Estreite as faixas ou use "achar a frota".`); frotas = frotas.slice(0, MAX_FROTAS); }
            for (let i = 0; i < frotas.length; i++) { await testar(frotas[i]); if (aoProgresso) aoProgresso(0.7 * (i + 1) / frotas.length); }
            recomendado = cenarios.slice().sort((a, b) => a.total - b.total || a.r.ocupacao[1] - b.r.ocupacao[1]).find(c => c.atende) || null;
        } else {
            recomendado = await acharFrota(ctx, pr, grupos.map(g => ({ modelo: g.modelo, n: Math.max(g.de, 1) })), grupos, async (fr, passo) => {
                const c = await testar(fr, passo);
                if (aoProgresso) aoProgresso(Math.min(0.7, (passo + 1) / 12));
                return c;
            }, busca);
        }
        if (!recomendado && busca.motivo === "trafego") avisos.push(`Mais Atta não resolve: o tráfego trava antes${busca.gargalo ? ` (a zona que mais segura é ${busca.gargalo})` : ""}. Reveja o layout (outro corredor, mão única, outra estação) ou os prazos.`);
        else if (!recomendado && cenarios.length) avisos.push("Nenhuma frota testada atende o prazo e a ocupação: teste mais Atta ou revise a demanda.");
        // sensibilidade do recomendado: a mesma frota com mais demanda ou um Atta parado,
        // e (previsão) a frota que a demanda maior vai pedir
        const sensibilidade = [];
        if (recomendado) {
            const casos = [[0.25, 0, "+25% de demanda"], [0.5, 0, "+50% de demanda"], [1.0, 0, "+100% de demanda"], [0, 1, "1 Atta em manutenção"]];
            for (let j = 0; j < casos.length; j++) {
                const [cr, ind, nome] = casos[j];
                await respirar();
                const p2 = Object.assign({}, pr, { crescimento: (pr.crescimento || 0) + cr, indisponiveis: (pr.indisponiveis || 0) + ind });
                const r = rodarFrota(ctx, recomendado.frota, p2);
                const caso = { nome, crescimento: cr, indisponiveis: ind, r, atende: r.noPrazo[1] >= pr.prazoAlvo && r.ocupacao[1] <= pr.ocupacaoMax && r.naoAtendidos[1] <= 0.5 };
                if (!caso.atende) {
                    // quantos Atta a mais essa situação pede (até 6 a mais por modelo)
                    const limites = recomendado.frota.map(g => ({ modelo: g.modelo, de: g.n, ate: g.n + 6 }));
                    const motivo = {};
                    const precisa = await acharFrota(ctx, p2, recomendado.frota.map(g => ({ modelo: g.modelo, n: g.n })), limites, async fr => {
                        await respirar();
                        const c = { frota: fr.map(g => ({ modelo: g.modelo, n: g.n })), nome: nomeFrota(fr), total: fr.reduce((s, g) => s + g.n, 0), r: rodarFrota(ctx, fr, p2) };
                        c.atende = c.r.noPrazo[1] >= pr.prazoAlvo && c.r.ocupacao[1] <= pr.ocupacaoMax && c.r.naoAtendidos[1] <= 0.5;
                        return c;
                    }, motivo);
                    caso.precisa = precisa ? { frota: precisa.frota, nome: precisa.nome, total: precisa.total, r: precisa.r } : null;
                    if (!precisa) { caso.limite = motivo.motivo; caso.gargalo = motivo.gargalo || ""; if (motivo.melhor) caso.melhor = { nome: motivo.melhor.nome, total: motivo.melhor.total, noPrazo: motivo.melhor.r.noPrazo }; }
                }
                sensibilidade.push(caso);
                if (aoProgresso) aoProgresso(0.7 + 0.3 * (j + 1) / casos.length);
            }
        }
        return { cenarios, recomendado, sensibilidade, premissas: pr, dia: ctx.dt, avisos, fluxos: ctx.fluxos, viagens, limite: recomendado ? "" : busca.motivo || "", gargalo: busca.gargalo || "", ms: Date.now() - t0 };
    }

    // a demanda prevista hora a hora (sem simular a frota)
    function demandaPorHora(cenario) {
        const pr = Object.assign({}, PREMISSAS_PADRAO, cenario.premissas || {});
        const dt = diaDeTrabalho(cenario.calendario, Number(pr.dia));
        const rnd = aleatorio(pr.semente || 7);
        const horas = {};
        (cenario.fluxos || []).filter(f => f.ativo !== false).forEach(f => gerarPedidos(f, dt, pr, rnd, 1).forEach(m => { const h = Math.floor(m / 60); horas[h] = (horas[h] || 0) + 1; }));
        return Object.keys(horas).map(Number).sort((a, b) => a - b).map(h => ({ h, pedidos: horas[h] }));
    }

    return { PREMISSAS_PADRAO, DEMANDAS, MAX_FROTAS, rodar, rodada, contexto, rodarFrota, acharFrota, frotasDoCenario, nomeFrota, fluxosDaPlanta, fluxosDoDia, missaoDoFluxo, diaDeTrabalho, demandaPorHora, taxaBase, quantil, faixa, aleatorio, criarRotas };
});
