/* ============================================================
   CALENDÁRIO DA FÁBRICA (0.20) — Frota › Turnos e berços
   ============================================================
   Um calendário só para a planta inteira (como a sinalização):
   - turnos:      { id, nome, inicio, fim, dias }
   - intervalos:  { id, nome, inicio, fim, dias, acao, postos }
                  acao: BERCO (a frota vai para o berço e volta sozinha),
                        TRABALHAR (continua), URGENTES (só pedidos urgentes)
                  postos: [] = a planta inteira; com postos escolhidos
                  (intervalo escalonado) a frota continua e só os pedidos
                  e a programação desses postos param.
   - paradas:     { id, nome, de, ate, acao, postos } por data
                  (feriado, inventário, "linha 2 parada até 15h")
                  acao: BERCO (frota no berço) | PROGRAMACAO (só a
                  programação desliga; pedidos à mão continuam)

   Cada Atta escolhe em quais turnos trabalha (Turnos e berços); o site
   monta a rotina dele (janelas, intervalos no berço, paradas) e manda
   para o AGV, que cumpre sozinho, sem o site aberto.

   Quem edita: administrador e líder (o líder também lança a parada do dia).
   Na nuvem fica em public.calendarios (uma linha por empresa); sem nuvem,
   no navegador (calendarioFabrica).
*/
const Calendario = (function () {
    const FUSO = "America/Sao_Paulo";
    const ACOES_INTERVALO = {
        BERCO: "Vai para o berço",
        TRABALHAR: "Continua trabalhando",
        URGENTES: "Só pedidos urgentes"
    };
    const ACOES_PARADA = {
        BERCO: "Frota no berço",
        PROGRAMACAO: "Só a programação para"
    };
    const LIMITES = { turnos: 6, intervalos: 10, paradas: 40, paradasNoAgv: 8, diasParadasNoAgv: 30 };
    const CORES_TURNO = ["#2F7BF6", "#16A34A", "#9333EA", "#EA580C", "#0891B2", "#DB2777"];

    const minutos = hhmm => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
        if (!m) return null;
        const h = Number(m[1]), mi = Number(m[2]);
        if (h > 24 || mi > 59 || (h === 24 && mi)) return null;
        return h * 60 + mi;
    };
    const hhmm = min => `${String(Math.floor(min / 60) % 25).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

    function vazio() { return { rev: 0, turnos: [], intervalos: [], paradas: [] }; }

    function normalizar(c) {
        const r = Object.assign(vazio(), c && typeof c === "object" ? c : {});
        const dias = d => [...new Set((Array.isArray(d) ? d : []).map(Number).filter(x => x >= 0 && x <= 6))].sort();
        r.turnos = (r.turnos || []).slice(0, LIMITES.turnos).map((t, i) => ({
            id: String(t.id || "T" + (i + 1)), nome: String(t.nome || `${i + 1}º turno`).slice(0, 30),
            inicio: minutos(t.inicio) !== null ? t.inicio : "07:00", fim: minutos(t.fim) !== null ? t.fim : "17:00", dias: dias(t.dias)
        }));
        r.intervalos = (r.intervalos || []).slice(0, LIMITES.intervalos).map((t, i) => ({
            id: String(t.id || "I" + (i + 1)), nome: String(t.nome || "Intervalo").slice(0, 30),
            inicio: minutos(t.inicio) !== null ? t.inicio : "11:00", fim: minutos(t.fim) !== null ? t.fim : "12:00", dias: dias(t.dias),
            acao: ACOES_INTERVALO[t.acao] ? t.acao : "BERCO", postos: Array.isArray(t.postos) ? t.postos.map(String) : []
        }));
        r.paradas = (r.paradas || []).slice(0, LIMITES.paradas).map((t, i) => ({
            id: String(t.id || "P" + (i + 1)), nome: String(t.nome || "Parada").slice(0, 60),
            de: String(t.de || ""), ate: String(t.ate || ""),
            acao: ACOES_PARADA[t.acao] ? t.acao : "BERCO", postos: Array.isArray(t.postos) ? t.postos.map(String) : [],
            por: String(t.por || "")
        })).filter(p => Number.isFinite(msLocal(p.de)) && Number.isFinite(msLocal(p.ate)));
        r.rev = Number(r.rev) || 0;
        return r;
    }

    /* ---------------- tempo (no fuso da fábrica) ---------------- */

    // dia da semana e minuto do dia no fuso
    function local(ms) {
        try {
            const p = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
                year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {});
            return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), min: Number(p.hour) * 60 + Number(p.minute), seg: Number(p.second),
                data: `${p.year}-${p.month}-${p.day}` };
        } catch (e) {
            const d = new Date(ms);
            return { dia: d.getDay(), min: d.getHours() * 60 + d.getMinutes(), seg: d.getSeconds(), data: d.toISOString().slice(0, 10) };
        }
    }
    // "2026-12-24T08:00" no fuso da fábrica → ms
    function msLocal(texto) {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(texto || ""));
        if (!m) return NaN;
        const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
        // ajusta pelo deslocamento do fuso naquele instante (duas passadas resolvem o horário de verão)
        let t = utc;
        for (let i = 0; i < 2; i++) {
            const l = local(t);
            const [y, mo, d] = l.data.split("-").map(Number);
            const visto = Date.UTC(y, mo - 1, d, Math.floor(l.min / 60), l.min % 60);
            t += utc - visto;
        }
        return t;
    }
    // ms do minuto "alvo" do dia local de "ms", deslocado em dias
    function noDia(ms, alvoMin, deslocDias = 0) {
        const l = local(ms);
        return ms - ((l.min - alvoMin) * 60 + l.seg) * 1000 - (ms % 1000) + deslocDias * 86400000;
    }

    // Uma janela {inicio, fim, dias} agora? → { dentro, inicioMs, fimMs }
    function naJanela(j, ms) {
        const ini = minutos(j.inicio), fim = minutos(j.fim);
        if (ini === null || fim === null || ini === fim || !(j.dias || []).length) return { dentro: false };
        const l = local(ms);
        const dias = j.dias;
        if (ini < fim) {
            if (dias.includes(l.dia) && l.min >= ini && l.min < fim) return { dentro: true, inicioMs: noDia(ms, ini), fimMs: noDia(ms, fim) };
            return { dentro: false };
        }
        // vira a noite: vale pelo dia em que começa
        if (dias.includes(l.dia) && l.min >= ini) return { dentro: true, inicioMs: noDia(ms, ini), fimMs: noDia(ms, fim, 1) };
        if (dias.includes((l.dia + 6) % 7) && l.min < fim) return { dentro: true, inicioMs: noDia(ms, ini, -1), fimMs: noDia(ms, fim) };
        return { dentro: false };
    }
    // próxima abertura de uma janela depois de ms (até 8 dias)
    function proximaAbertura(j, ms) {
        const ini = minutos(j.inicio);
        if (ini === null) return null;
        for (let d = 0; d <= 8; d++) {
            const t = noDia(ms, ini, d);
            if (t > ms && (j.dias || []).includes(local(t).dia)) return t;
        }
        return null;
    }

    const valePara = (item, posto) => !item.postos?.length || (posto != null && item.postos.includes(String(posto)));

    function turnoAgora(cal, ms) {
        const c = normalizar(cal);
        for (const t of c.turnos) { const j = naJanela(t, ms); if (j.dentro) return Object.assign({}, t, j); }
        return null;
    }
    // Intervalo valendo agora para o posto (posto null = só os da planta inteira)
    function intervaloAgora(cal, ms, posto = null) {
        const c = normalizar(cal);
        for (const t of c.intervalos) {
            if (posto === null ? t.postos.length : !valePara(t, posto)) continue;
            const j = naJanela(t, ms);
            if (j.dentro) return Object.assign({}, t, j);
        }
        return null;
    }
    function paradaAgora(cal, ms, posto = null) {
        const c = normalizar(cal);
        for (const p of c.paradas) {
            if (posto === null ? p.postos.length : !valePara(p, posto)) continue;
            const de = msLocal(p.de), ate = msLocal(p.ate);
            if (ms >= de && ms < ate) return Object.assign({}, p, { inicioMs: de, fimMs: ate });
        }
        return null;
    }
    // A janela dos turnos escolhidos (para a programação): { dentro, inicio, proxima }
    function janelaTurnos(cal, ids, ms) {
        const c = normalizar(cal);
        const ts = c.turnos.filter(t => (ids || []).includes(t.id));
        let dentro = false, inicio = null, proxima = null;
        ts.forEach(t => {
            const j = naJanela(t, ms);
            if (j.dentro && (!dentro || j.inicioMs < inicio)) { dentro = true; inicio = j.inicioMs; }
            const p = proximaAbertura(t, ms);
            if (p && (!proxima || p < proxima)) proxima = p;
        });
        // turnos colados (1º 06:00–14:20 e 2º 14:20–22:40): a janela começa no primeiro
        if (dentro) {
            let mudou = true;
            while (mudou) {
                mudou = false;
                ts.forEach(t => { const j = naJanela(t, inicio - 1000); if (j.dentro && j.inicioMs < inicio) { inicio = j.inicioMs; mudou = true; } });
            }
        }
        return { dentro, inicio, proxima };
    }

    /* ---------------- o que vai para o AGV ---------------- */

    // { janelas, pausas, paradas } da rotina do AGV (o firmware 0.20 entende)
    function pacoteAgv(cal, turnosIds, agoraMs = Date.now()) {
        const c = normalizar(cal);
        const janelas = c.turnos.filter(t => (turnosIds || []).includes(t.id)).map(t => ({ inicio: t.inicio, fim: t.fim, dias: t.dias.slice() }));
        // só os intervalos da planta inteira em que a frota vai para o berço
        const pausas = c.intervalos.filter(t => !t.postos.length && t.acao === "BERCO").map(t => ({ inicio: t.inicio, fim: t.fim, dias: t.dias.slice() }));
        const limite = agoraMs + LIMITES.diasParadasNoAgv * 86400000;
        const paradas = c.paradas.filter(p => !p.postos.length && p.acao === "BERCO")
            .map(p => ({ de: Math.floor(msLocal(p.de) / 1000), ate: Math.floor(msLocal(p.ate) / 1000) }))
            .filter(p => p.ate * 1000 > agoraMs && p.de * 1000 < limite)
            .sort((a, b) => a.de - b.de).slice(0, LIMITES.paradasNoAgv);
        return { janelas, pausas, paradas };
    }

    /* ---------------- migração e validação ---------------- */

    // Os horários que já estão nos AGVs viram turnos (iguais caem no mesmo turno)
    function migrar(cal, rotinas) {
        const c = normalizar(cal);
        const atribuicoes = {};
        if (c.turnos.length) return { calendario: c, atribuicoes, criados: 0 };
        let criados = 0;
        Object.entries(rotinas || {}).forEach(([id, r]) => {
            const t = r?.turno;
            if (!t?.ativo || minutos(t.inicio) === null || minutos(t.fim) === null) return;
            const dias = [...new Set(t.dias || [])].map(Number).sort();
            let turno = c.turnos.find(x => x.inicio === t.inicio && x.fim === t.fim && JSON.stringify(x.dias) === JSON.stringify(dias));
            if (!turno && c.turnos.length < LIMITES.turnos) {
                turno = { id: "T" + (c.turnos.length + 1), nome: `${c.turnos.length + 1}º turno`, inicio: t.inicio, fim: t.fim, dias };
                c.turnos.push(turno);
                criados++;
            }
            if (turno) atribuicoes[id] = [turno.id];
        });
        return { calendario: c, atribuicoes, criados };
    }

    function validar(cal) {
        const c = normalizar(cal);
        const erros = [], avisos = [];
        c.turnos.forEach(t => {
            if (t.inicio === t.fim) erros.push(`${t.nome}: início e fim iguais.`);
            if (!t.dias.length) erros.push(`${t.nome}: marque pelo menos um dia.`);
        });
        c.intervalos.forEach(t => {
            if (t.inicio === t.fim) erros.push(`${t.nome}: início e fim iguais.`);
            if (!t.dias.length) erros.push(`${t.nome}: marque pelo menos um dia.`);
            const ini = minutos(t.inicio), fim = minutos(t.fim);
            if (ini !== null && fim !== null && c.turnos.length) {
                const dentro = c.turnos.some(tu => t.dias.some(d => tu.dias.includes(d)) && dentroDoTurnoMin(tu, ini) && dentroDoTurnoMin(tu, (fim - 1 + 1440) % 1440));
                if (!dentro) avisos.push(`${t.nome} (${t.inicio}–${t.fim}) não fica dentro de nenhum turno.`);
            }
        });
        c.paradas.forEach(p => { if (msLocal(p.ate) <= msLocal(p.de)) erros.push(`${p.nome}: o fim tem que ser depois do começo.`); });
        return { erros, avisos };
    }
    function dentroDoTurnoMin(t, m) {
        const ini = minutos(t.inicio), fim = minutos(t.fim);
        return ini < fim ? m >= ini && m < fim : m >= ini || m < fim;
    }

    const NOMES_DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    function textoDias(d) {
        const s = [...(d || [])].sort().join(",");
        if (s === "1,2,3,4,5") return "seg a sex";
        if (s === "1,2,3,4,5,6") return "seg a sáb";
        if (s === "0,1,2,3,4,5,6") return "todos os dias";
        return (d || []).map(x => NOMES_DIAS[x]).join(", ");
    }

    const Nucleo = { FUSO, ACOES_INTERVALO, ACOES_PARADA, LIMITES, CORES_TURNO, vazio, normalizar, minutos, hhmm, local, msLocal, noDia, naJanela, proximaAbertura,
        turnoAgora, intervaloAgora, paradaAgora, janelaTurnos, pacoteAgv, migrar, validar, textoDias };
    if (typeof document === "undefined") return Nucleo;

    /* ========================================================
       NO SITE: guardar, carregar e a tela
       ======================================================== */
    const CHAVE = "calendarioFabrica";
    let atual = vazio(), rascunho = null, carregado = false, salvando = false, porNome = "", em = null;
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem && Nuvem.emNuvem());
    const podeEditar = () => !window.Nuvem || !naNuvem() || Nuvem.pode("calendario");

    function lerLocal() { try { return normalizar(JSON.parse(localStorage.getItem(CHAVE) || "null")); } catch (e) { return vazio(); } }
    function gravarLocal(c) { try { localStorage.setItem(CHAVE, JSON.stringify(c)); } catch (e) { /* ignora */ } }

    async function carregar() {
        if (naNuvem()) {
            try {
                const r = await Nuvem.cliente().from("calendarios").select("dados, rev, por_nome, atualizado_em").eq("empresa_id", Nuvem.empresa().id).maybeSingle();
                if (!r.error) {
                    atual = normalizar(Object.assign({}, r.data?.dados || {}, { rev: r.data?.rev || 0 }));
                    porNome = r.data?.por_nome || ""; em = r.data?.atualizado_em || null;
                }
            } catch (e) { /* mantém o que tem */ }
        } else {
            atual = lerLocal();
        }
        carregado = true;
        if (typeof salvarRotinaAGV === "function") migrarSeVazio();   // senão, o rotina.js chama quando carregar
        aoMudar();
        return atual;
    }

    // Sem turnos ainda: os horários dos AGVs viram turnos (uma vez)
    function migrarSeVazio() {
        if (atual.turnos.length || typeof agvs === "undefined" || !podeEditar()) return;
        const rotinas = {};
        Object.values(agvs).forEach(a => { if (a.rotina) rotinas[a.id] = a.rotina; });
        const m = migrar(atual, rotinas);
        if (!m.criados) return;
        salvar(m.calendario, { silencioso: true }).then(ok => {
            if (!ok) return;
            Object.entries(m.atribuicoes).forEach(([id, turnos]) => {
                const r = JSON.parse(JSON.stringify(agvs[id].rotina));
                r.turnos = turnos;
                r.turno = Object.assign({}, r.turno, { ativo: false });
                if (typeof salvarRotinaAGV === "function") salvarRotinaAGV(id, r);
            });
            ui.aviso(`Calendário da fábrica criado com os horários dos AGVs (${m.criados} turno${m.criados > 1 ? "s" : ""}).`, "info");
        });
    }

    async function salvar(cal, opcoes = {}) {
        if (!podeEditar()) { ui.aviso("Só o administrador e o líder mudam o calendário.", "aviso"); return false; }
        const c = normalizar(cal);
        const v = validar(c);
        if (v.erros.length) { ui.aviso(v.erros[0], "aviso"); return false; }
        salvando = true;
        try {
            if (naNuvem()) {
                const dados = { turnos: c.turnos, intervalos: c.intervalos, paradas: c.paradas };
                const r = await Nuvem.cliente().rpc("salvar_calendario", { p_empresa: Nuvem.empresa().id, p_dados: dados, p_rev: atual.rev });
                if (r.error) { ui.aviso(r.error.message || "Não foi possível salvar o calendário.", "erro"); await carregar(); return false; }
                c.rev = Number(r.data) || atual.rev + 1;
            } else {
                c.rev = atual.rev + 1;
                gravarLocal(c);
            }
            atual = c; rascunho = null;
            if (!opcoes.silencioso) ui.aviso("Calendário salvo. Os AGVs recebem a rotina nova.", "sucesso");
            if (typeof registrarAcaoSite === "function") registrarAcaoSite("", "configuracao", "CALENDARIO_SALVO", `rev ${c.rev}: ${c.turnos.length} turno(s), ${c.intervalos.length} intervalo(s), ${c.paradas.length} parada(s)`);
            aoMudar();
            return true;
        } finally { salvando = false; }
    }

    // A rotina de todos os AGVs muda junto (sincronizarRotina compara a rev)
    function aoMudar() {
        if (typeof agvs !== "undefined" && typeof sincronizarRotina === "function") Object.values(agvs).forEach(a => sincronizarRotina(a, true));
        if (document.getElementById("rotina")?.classList.contains("ativa")) renderizar(true);
        if (typeof agendarAtualizacaoTela === "function") agendarAtualizacaoTela();
    }

    /* ---------------- a tela ---------------- */

    const DIAS_LETRA = ["D", "S", "T", "Q", "Q", "S", "S"];
    const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    function botoesDias(lista, chave, pode) {
        return `<div class="rotina-dias" role="group">${DIAS_LETRA.map((l, i) =>
            `<button type="button" class="rotina-dia ${lista.includes(i) ? "ativo" : ""}" data-cal-dia="${i}" data-cal-item="${esc(chave)}" title="${NOMES_DIA[i]}" aria-pressed="${lista.includes(i)}" ${pode ? "" : "disabled"}>${l}</button>`).join("")}</div>`;
    }

    // Linha do tempo seg–dom: turnos em blocos, intervalos por cima
    function svgSemana(c) {
        const W = 720, H = 7 * 22 + 26, X0 = 34, LW = W - X0 - 6, x = m => X0 + m / 1440 * LW;
        const ordem = [1, 2, 3, 4, 5, 6, 0];
        let s = `<svg class="cal-semana" viewBox="0 0 ${W} ${H}" role="img" aria-label="Semana da fábrica">`;
        for (let h = 0; h <= 24; h += 2) s += `<line x1="${x(h * 60)}" x2="${x(h * 60)}" y1="14" y2="${H - 4}" class="cal-grade"/><text x="${x(h * 60)}" y="10" class="cal-hora">${h}h</text>`;
        const blocos = (item, dia, y, alt, cls, cor) => {
            const ini = minutos(item.inicio), fim = minutos(item.fim);
            if (ini === null || fim === null || ini === fim) return "";
            let r = "";
            const desenhar = (a, b) => { r += `<rect x="${x(a)}" y="${y}" width="${Math.max(1, x(b) - x(a))}" height="${alt}" rx="3" class="${cls}" ${cor ? `style="fill:${cor}"` : ""}><title>${esc(item.nome)} ${esc(item.inicio)}–${esc(item.fim)}</title></rect>`; };
            if (ini < fim) { if (item.dias.includes(dia)) desenhar(ini, fim); }
            else {
                if (item.dias.includes(dia)) desenhar(ini, 1440);
                if (item.dias.includes((dia + 6) % 7)) desenhar(0, fim);
            }
            return r;
        };
        ordem.forEach((dia, i) => {
            const y = 16 + i * 22;
            s += `<text x="0" y="${y + 14}" class="cal-dia">${NOMES_DIAS[dia]}</text><rect x="${X0}" y="${y}" width="${LW}" height="18" rx="3" class="cal-fundo"/>`;
            c.turnos.forEach((t, k) => { s += blocos(t, dia, y, 18, "cal-turno", CORES_TURNO[k % CORES_TURNO.length]); });
            c.intervalos.forEach(t => { s += blocos(t, dia, y + 3, 12, `cal-intervalo ${t.acao.toLowerCase()}${t.postos.length ? " escalonado" : ""}`); });
        });
        const l = local(Date.now());
        const yAgora = 16 + ordem.indexOf(l.dia) * 22;
        s += `<line x1="${x(l.min)}" x2="${x(l.min)}" y1="${yAgora - 2}" y2="${yAgora + 20}" class="cal-agora"/>`;
        return s + "</svg>";
    }

    function situacaoAgora(c) {
        const ms = Date.now();
        const p = paradaAgora(c, ms), i = intervaloAgora(c, ms), t = turnoAgora(c, ms);
        if (p) return `<span class="pilula vermelho">Parada planejada: ${esc(p.nome)}</span>`;
        if (i) return `<span class="pilula roxo">${esc(i.nome)} até ${hhmm(local(i.fimMs).min)} · ${esc(ACOES_INTERVALO[i.acao].toLowerCase())}</span>`;
        if (t) return `<span class="pilula verde">${esc(t.nome)} até ${esc(t.fim)}</span>`;
        return c.turnos.length ? `<span class="pilula">fora dos turnos</span>` : "";
    }

    function postosSelecao(item, chave, pode) {
        const postos = typeof Despacho !== "undefined" && Despacho.postos ? Despacho.postos() : [];
        if (!postos.length) return "";
        return `<details class="editor-mais cal-postos"${item.postos.length ? " open" : ""}><summary>${item.postos.length ? `Só ${item.postos.length} posto(s)` : "Planta inteira"} · escolher postos</summary>
            <div class="cal-postos-lista">${postos.map(p => `<label><input type="checkbox" data-cal-posto="${esc(p.id)}" data-cal-item="${esc(chave)}" ${item.postos.includes(p.id) ? "checked" : ""} ${pode ? "" : "disabled"}> ${esc(p.nome || p.id)}</label>`).join("")}</div>
            <small class="suave">Com postos escolhidos (intervalo escalonado), a frota continua trabalhando; só os pedidos e a programação desses postos param.</small></details>`;
    }

    function htmlCalendario() {
        const c = rascunho || atual;
        const pode = podeEditar();
        const v = validar(c);
        const alterado = Boolean(rascunho);
        const linhaTurno = (t, k) => `<div class="cal-linha" data-cal-linha="turnos:${esc(t.id)}">
            <span class="cal-cor" style="background:${CORES_TURNO[k % CORES_TURNO.length]}"></span>
            <input class="cal-nome" data-cal-campo="nome" data-cal-item="turnos:${esc(t.id)}" value="${esc(t.nome)}" maxlength="30" ${pode ? "" : "disabled"} aria-label="Nome do turno">
            <input type="time" data-cal-campo="inicio" data-cal-item="turnos:${esc(t.id)}" value="${esc(t.inicio)}" ${pode ? "" : "disabled"} aria-label="Início">
            <span class="suave">às</span>
            <input type="time" data-cal-campo="fim" data-cal-item="turnos:${esc(t.id)}" value="${esc(t.fim)}" ${pode ? "" : "disabled"} aria-label="Fim">
            ${botoesDias(t.dias, "turnos:" + t.id, pode)}
            ${pode ? `<button type="button" class="btn btn-mini btn-perigo" data-cal-remover="turnos:${esc(t.id)}" aria-label="Remover ${esc(t.nome)}">✕</button>` : ""}
        </div>`;
        const linhaIntervalo = t => `<div class="cal-linha cal-linha-intervalo" data-cal-linha="intervalos:${esc(t.id)}">
            <span class="cal-cor cal-cor-intervalo ${t.acao.toLowerCase()}"></span>
            <input class="cal-nome" data-cal-campo="nome" data-cal-item="intervalos:${esc(t.id)}" value="${esc(t.nome)}" maxlength="30" ${pode ? "" : "disabled"} aria-label="Nome do intervalo">
            <input type="time" data-cal-campo="inicio" data-cal-item="intervalos:${esc(t.id)}" value="${esc(t.inicio)}" ${pode ? "" : "disabled"} aria-label="Início">
            <span class="suave">às</span>
            <input type="time" data-cal-campo="fim" data-cal-item="intervalos:${esc(t.id)}" value="${esc(t.fim)}" ${pode ? "" : "disabled"} aria-label="Fim">
            ${botoesDias(t.dias, "intervalos:" + t.id, pode)}
            <select data-cal-campo="acao" data-cal-item="intervalos:${esc(t.id)}" ${pode ? "" : "disabled"} aria-label="O que a frota faz">${Object.entries(ACOES_INTERVALO).map(([k, n]) => `<option value="${k}" ${k === t.acao ? "selected" : ""}>${n}</option>`).join("")}</select>
            ${pode ? `<button type="button" class="btn btn-mini btn-perigo" data-cal-remover="intervalos:${esc(t.id)}" aria-label="Remover ${esc(t.nome)}">✕</button>` : ""}
            ${postosSelecao(t, "intervalos:" + t.id, pode)}
        </div>`;
        const agoraMs = Date.now();
        const paradas = c.paradas.slice().sort((a, b) => msLocal(a.de) - msLocal(b.de));
        const linhaParada = p => {
            const passou = msLocal(p.ate) <= agoraMs;
            return `<div class="cal-linha cal-linha-parada ${passou ? "passou" : ""}" data-cal-linha="paradas:${esc(p.id)}">
            <input class="cal-nome largo" data-cal-campo="nome" data-cal-item="paradas:${esc(p.id)}" value="${esc(p.nome)}" maxlength="60" ${pode ? "" : "disabled"} aria-label="Motivo da parada">
            <input type="datetime-local" data-cal-campo="de" data-cal-item="paradas:${esc(p.id)}" value="${esc(p.de)}" ${pode ? "" : "disabled"} aria-label="Começa">
            <span class="suave">até</span>
            <input type="datetime-local" data-cal-campo="ate" data-cal-item="paradas:${esc(p.id)}" value="${esc(p.ate)}" ${pode ? "" : "disabled"} aria-label="Termina">
            <select data-cal-campo="acao" data-cal-item="paradas:${esc(p.id)}" ${pode ? "" : "disabled"} aria-label="O que para">${Object.entries(ACOES_PARADA).map(([k, n]) => `<option value="${k}" ${k === p.acao ? "selected" : ""}>${n}</option>`).join("")}</select>
            ${pode ? `<button type="button" class="btn btn-mini btn-perigo" data-cal-remover="paradas:${esc(p.id)}" aria-label="Remover ${esc(p.nome)}">✕</button>` : ""}
            ${postosSelecao(p, "paradas:" + p.id, pode)}
            ${p.por ? `<small class="suave cal-por">lançada por ${esc(p.por)}</small>` : ""}
        </div>`;
        };
        return `
            <div class="cal-topo">
                <div class="cal-agora-texto">${situacaoAgora(c)}</div>
                <span class="suave">${atual.rev ? `rev ${atual.rev}${porNome ? " · " + esc(porNome) : ""}` : "ainda não salvo"}</span>
            </div>
            ${c.turnos.length || c.intervalos.length ? svgSemana(c) : `<p class="suave">Sem turnos: os AGVs trabalham o tempo todo (ou pelo horário próprio de cada um). Crie os turnos da fábrica e escolha, em cada AGV, em quais ele trabalha.</p>`}
            <div class="cal-bloco"><div class="cal-bloco-titulo">Turnos</div>
                ${c.turnos.map(linhaTurno).join("") || `<p class="suave">Nenhum turno.</p>`}
                ${pode && c.turnos.length < LIMITES.turnos ? `<button type="button" class="btn btn-mini" data-cal-novo="turnos">+ Turno</button>` : ""}
            </div>
            <div class="cal-bloco"><div class="cal-bloco-titulo">Intervalos <span class="suave">almoço, café, troca de turno</span></div>
                ${c.intervalos.map(linhaIntervalo).join("") || `<p class="suave">Nenhum intervalo: a frota trabalha direto do começo ao fim do turno.</p>`}
                ${pode && c.intervalos.length < LIMITES.intervalos ? `<button type="button" class="btn btn-mini" data-cal-novo="intervalos">+ Intervalo</button>` : ""}
            </div>
            <div class="cal-bloco"><div class="cal-bloco-titulo">Paradas planejadas <span class="suave">feriado, inventário, linha parada</span></div>
                ${paradas.map(linhaParada).join("") || `<p class="suave">Nenhuma parada.</p>`}
                ${pode ? `<div class="cal-acoes-paradas"><button type="button" class="btn btn-mini" data-cal-novo="paradas">+ Parada</button>
                    <button type="button" class="btn btn-mini" data-cal-novo="paradaHoje">+ Parada agora (até…)</button></div>` : ""}
            </div>
            ${v.erros.length ? `<div class="missao-dica vermelho">${v.erros.map(esc).join("<br>")}</div>` : ""}
            ${v.avisos.length ? `<div class="missao-dica ambar">${v.avisos.map(esc).join("<br>")}</div>` : ""}
            ${pode ? `<div class="rotina-acoes">
                <button type="button" class="btn btn-primario" data-cal-salvar ${alterado && !salvando ? "" : "disabled"}>${alterado ? "Salvar calendário" : "Salvo"}</button>
                ${alterado ? `<button type="button" class="btn" data-cal-descartar>Descartar</button>` : ""}
                <span class="suave cal-quem">Administrador e líder mudam o calendário.</span>
            </div>` : `<p class="suave">Só o administrador e o líder mudam o calendário.</p>`}`;
    }

    function renderizar(forcar = false) {
        const caixa = document.getElementById("calendarioFabrica");
        if (!caixa) return;
        if (!carregado) { carregar(); return; }
        if (!forcar && caixa.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
        const html = htmlCalendario();
        if (caixa.__html !== html) { caixa.__html = html; caixa.innerHTML = html; }
    }

    function editar(mudar) {
        const c = JSON.parse(JSON.stringify(rascunho || atual));
        mudar(c);
        const n = normalizar(Object.assign(c, { rev: atual.rev }));
        rascunho = JSON.stringify({ t: n.turnos, i: n.intervalos, p: n.paradas }) === JSON.stringify({ t: atual.turnos, i: atual.intervalos, p: atual.paradas }) ? null : n;
        renderizar(true);
    }
    const itemDe = (c, chave) => { const [lista, id] = String(chave).split(":"); return (c[lista] || []).find(x => x.id === id); };
    const proximoId = (lista, prefixo) => { let n = 1; while (lista.some(x => x.id === prefixo + n)) n++; return prefixo + n; };
    const dataHoraLocal = ms => { const l = local(ms); return `${l.data}T${hhmm(l.min)}`; };
    const nomeUsuario = () => (window.Nuvem && Nuvem.usuario && (Nuvem.usuario()?.nome || Nuvem.usuario()?.email)) || "";

    document.addEventListener("click", async e => {
        const caixa = document.getElementById("calendarioFabrica");
        if (!caixa || !caixa.contains(e.target)) return;
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.calDia !== undefined) {
            const dia = Number(b.dataset.calDia);
            editar(c => { const it = itemDe(c, b.dataset.calItem); if (it) it.dias = it.dias.includes(dia) ? it.dias.filter(d => d !== dia) : it.dias.concat([dia]); });
        } else if (b.dataset.calNovo) {
            const tipo = b.dataset.calNovo;
            editar(c => {
                if (tipo === "turnos") {
                    const ult = c.turnos[c.turnos.length - 1];
                    c.turnos.push({ id: proximoId(c.turnos, "T"), nome: `${c.turnos.length + 1}º turno`, inicio: ult ? ult.fim : "06:00", fim: ult ? hhmm((minutos(ult.fim) + 500) % 1440) : "14:20", dias: [1, 2, 3, 4, 5] });
                } else if (tipo === "intervalos") {
                    c.intervalos.push({ id: proximoId(c.intervalos, "I"), nome: c.intervalos.length ? "Café" : "Almoço", inicio: c.intervalos.length ? "09:00" : "11:00", fim: c.intervalos.length ? "09:15" : "12:00", dias: [1, 2, 3, 4, 5], acao: "BERCO", postos: [] });
                } else if (tipo === "paradas") {
                    const amanha = noDia(Date.now(), 0, 1);
                    c.paradas.push({ id: proximoId(c.paradas, "P"), nome: "Parada planejada", de: dataHoraLocal(amanha), ate: dataHoraLocal(amanha + 86400000), acao: "BERCO", postos: [], por: nomeUsuario() });
                } else if (tipo === "paradaHoje") {
                    const agora = Date.now() - Date.now() % 60000;
                    c.paradas.push({ id: proximoId(c.paradas, "P"), nome: "Linha parada", de: dataHoraLocal(agora), ate: dataHoraLocal(agora + 2 * 3600000), acao: "PROGRAMACAO", postos: [], por: nomeUsuario() });
                }
            });
        } else if (b.dataset.calRemover) {
            const [lista, id] = b.dataset.calRemover.split(":");
            editar(c => { c[lista] = c[lista].filter(x => x.id !== id); });
        } else if (b.dataset.calSalvar !== undefined && rascunho) {
            await salvar(rascunho);
        } else if (b.dataset.calDescartar !== undefined) {
            rascunho = null; renderizar(true);
        }
    });
    document.addEventListener("change", e => {
        const caixa = document.getElementById("calendarioFabrica");
        if (!caixa || !caixa.contains(e.target)) return;
        const t = e.target;
        if (t.dataset.calPosto) {
            editar(c => { const it = itemDe(c, t.dataset.calItem); if (it) it.postos = t.checked ? [...new Set(it.postos.concat([t.dataset.calPosto]))] : it.postos.filter(p => p !== t.dataset.calPosto); });
            return;
        }
        const campo = t.dataset.calCampo;
        if (!campo) return;
        editar(c => { const it = itemDe(c, t.dataset.calItem); if (it && (t.value || campo === "nome")) it[campo] = t.value; });
    });

    // outra aba ou outro usuário mudou: confere de tempos em tempos
    setInterval(() => { if (naNuvem() && !rascunho && document.visibilityState === "visible") carregar(); }, 60000);
    if (typeof window !== "undefined") window.addEventListener("storage", ev => { if (ev.key === CHAVE && !naNuvem()) { atual = lerLocal(); aoMudar(); } });

    carregar();
    return Object.assign({}, Nucleo, {
        carregar, salvar, renderizar, migrarSeVazio, atual: () => atual, rascunho: () => rascunho, podeEditar, carregado: () => carregado,
        intervaloDoPosto: (posto, ms = Date.now()) => intervaloAgora(atual, ms, posto),
        paradaDoPosto: (posto, ms = Date.now()) => paradaAgora(atual, ms, posto),
        janelaDosTurnos: (ids, ms = Date.now()) => janelaTurnos(atual, ids, ms),
        pacoteDoAgv: (turnos, ms = Date.now()) => pacoteAgv(atual, turnos, ms)
    });
})();
if (typeof module !== "undefined") module.exports = Calendario;
if (typeof window !== "undefined") window.Calendario = Calendario;
