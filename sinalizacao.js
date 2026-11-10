/* ============================================================
   SINALIZAÇÃO DO ATTA (0.20) — Frota › Sinalização
   ============================================================
   A legenda das luzes (todo mundo vê) e a configuração da empresa
   (só o administrador muda). Uma tabela só para a planta inteira:
   vai retida em agv/<empresa>/frota/sinais e todos os Atta usam a
   mesma (cada um informa a revisão em status/sinais).

   Dois níveis:
   - SEGURANÇA, travados (emergência, rearme, falha, obstáculo, faixa,
     "vai partir", teste das luzes): ninguém muda, nem no site nem no
     firmware. Seguem a convenção de cores de sinalização de máquinas
     (IEC 60073: vermelho perigo, amarelo/âmbar atenção) e os avisos
     de movimento do veículo autônomo (ISO 3691-4).
   - OPERAÇÃO: cor e efeito configuráveis, com regras: vermelho, âmbar,
     laranja e magenta são reservados; sem estroboscópico; dois sinais
     não podem ficar iguais (mesma cor e mesmo efeito).
*/
const Sinalizacao = (function () {
    const GRUPOS = [
        ["trabalhando", "Trabalhando"],
        ["voce", "Esperando você"],
        ["sozinho", "Parado, segue sozinho"],
        ["alguem", "Precisa de alguém"],
        ["berco", "Berço e turno"],
        ["manutencao", "Manutenção e sistema"]
    ];
    // nome do firmware → { grupo, o que fazer, quem resolve, pede ação, travado (motivo) }
    const META = {
        AUTO_PRONTO: { grupo: "trabalhando", fazer: "Nada: ele espera o próximo pedido.", quem: "—" },
        MISSAO_ANDANDO: { grupo: "trabalhando", fazer: "Nada. Não fique no caminho da fita.", quem: "—" },
        MISSAO_PARADA: { grupo: "trabalhando", fazer: "Nada: ele está numa etapa (pegando, entregando ou esperando passagem).", quem: "—" },
        CONCLUIDA: { grupo: "trabalhando", fazer: "Nada: a missão terminou.", quem: "—" },
        APERTE_START: { grupo: "voce", fazer: "Aperte START MISSÃO no Atta (ou confirme pelo site).", quem: "Operador", acao: true },
        CONFIRMACAO: { grupo: "voce", fazer: "Confirme a etapa no posto ou no botão do Atta quando terminar de carregar ou descarregar.", quem: "Operador do posto", acao: true },
        PASSAR_AUTOMATICO: { grupo: "voce", fazer: "Gire a seletora para AUTOMÁTICO.", quem: "Operador", acao: true },
        MANUAL_PRONTO: { grupo: "voce", fazer: "Ele está no manual. Para trabalhar sozinho, gire a seletora para AUTOMÁTICO.", quem: "Operador", acao: true },
        MANUAL_ANDANDO: { grupo: "voce", fazer: "Alguém está manobrando pelo controle manual.", quem: "Operador" },
        OBSTACULO: { grupo: "sozinho", fazer: "Nada: ele segue sozinho quando liberar. Se demorar, veja o que está na frente.", quem: "—", trava: "Sinal de segurança: avisa quem está perto." },
        FAIXA: { grupo: "sozinho", fazer: "Ele parou 1 s antes da faixa e atravessa devagar. Dê passagem ou espere.", quem: "—", trava: "Sinal de segurança: faixa de pedestre." },
        PARTINDO: { grupo: "sozinho", fazer: "Ele vai partir sozinho em instantes. Afaste-se.", quem: "—", trava: "Aviso de movimento (ISO 3691-4)." },
        PARTINDO_BERCO: { grupo: "berco", fazer: "Ele vai partir para o berço em instantes. Afaste-se.", quem: "—", trava: "Aviso de movimento (ISO 3691-4)." },
        FALHA: { grupo: "alguem", fazer: "Veja o erro no Eciton (Frota ou Diagnóstico) e resolva no local.", quem: "Manutenção", acao: true, trava: "Sinal de segurança: falha." },
        REARME: { grupo: "alguem", fazer: "Confira que é seguro e aperte REARME.", quem: "Operador", acao: true, trava: "Sinal de segurança: rearme." },
        EMERGENCIA: { grupo: "alguem", fazer: "Alguém apertou a emergência ou bateu. Confira no local, solte a emergência e rearme.", quem: "Operador ou manutenção", acao: true, trava: "Emergência: sempre vermelho (IEC 60073)." },
        INDO_BERCO: { grupo: "berco", fazer: "Nada: ele está indo para o berço.", quem: "—" },
        TURNO_ENCERRADO: { grupo: "berco", fazer: "Nada: turno encerrado ou intervalo. Ele volta sozinho no próximo turno.", quem: "—" },
        EM_MANUTENCAO: { grupo: "manutencao", fazer: "Ele está em manutenção e não aceita missão. Tire da manutenção no Eciton quando terminar.", quem: "Manutenção" },
        MANUTENCAO: { grupo: "manutencao", fazer: "Calibração, teste ou atualização em andamento: não mexa.", quem: "Manutenção" },
        INICIANDO: { grupo: "manutencao", fazer: "Ele está ligando. Espere.", quem: "—" },
        DESLIGADO: { grupo: "manutencao", fazer: "STOP acionado. Para ligar, solte o STOP.", quem: "Operador", acao: true },
        TESTE_LEDS: { grupo: "manutencao", fazer: "Teste das luzes pelo Diagnóstico.", quem: "Manutenção", trava: "Usado pelo teste das luzes." }
    };
    const TRAVADOS = Object.keys(META).filter(k => META[k].trava);

    // padrão E4M (o mesmo do firmware)
    const PADRAO = {
        INICIANDO: ["FFFFFF", "CORRE"], FALHA: ["FF00B4", "PISCA"], EMERGENCIA: ["FF0000", "ESTROBO"], REARME: ["FFB000", "PISCA"],
        DESLIGADO: ["505050", "RESPIRA"], OBSTACULO: ["FF4A00", "RESPIRA_RAPIDA"], MANUTENCAO: ["FFFFFF", "CORRE"],
        MANUAL_PRONTO: ["0040FF", "FIXO"], MANUAL_ANDANDO: ["0040FF", "CORRE"], PASSAR_AUTOMATICO: ["0040FF", "PISCA"],
        AUTO_PRONTO: ["00FF28", "FIXO"], APERTE_START: ["00FF28", "PISCA"], MISSAO_ANDANDO: ["00FF28", "CORRE"], MISSAO_PARADA: ["00FF28", "RESPIRA"],
        CONFIRMACAO: ["00D8FF", "PISCA"], CONCLUIDA: ["00FF28", "FLASH3"], TESTE_LEDS: ["FFFFFF", "FIXO"], PARTINDO: ["00FF28", "ESTROBO"],
        PARTINDO_BERCO: ["7A00FF", "PISCA"], INDO_BERCO: ["7A00FF", "CORRE"], TURNO_ENCERRADO: ["7A00FF", "RESPIRA"], EM_MANUTENCAO: ["FFFFFF", "FIXO"],
        FAIXA: ["FFB000", "PISCA"]
    };
    // cores que o administrador pode usar (nenhuma reservada à segurança)
    const CORES = [
        ["00FF28", "#22D35B", "Verde"], ["00FFA0", "#2EE6A8", "Verde-água"], ["00D8FF", "#22D8FF", "Ciano"],
        ["3C9BFF", "#5AA8FF", "Azul-claro"], ["0040FF", "#2F6BFF", "Azul"], ["7A00FF", "#9B5CFF", "Roxo"],
        ["B070FF", "#C08BFF", "Lilás"], ["FFFFFF", "#F2F4F7", "Branco"]
    ];
    const CORES_SEGURANCA = { FF0000: "#FF3B3B", FFB000: "#FFB000", FF4A00: "#FF6A1A", FF00B4: "#FF2FB9", "505050": "#8A939E" };
    const EFEITOS = { FIXO: "aceso", PISCA: "piscando", CORRE: "correndo", RESPIRA: "respirando", FLASH3: "3 piscadas" };
    const EFEITOS_TODOS = Object.assign({ ESTROBO: "piscando rápido", RESPIRA_RAPIDA: "respirando rápido" }, EFEITOS);
    // efeito do firmware → classe da animação do site (fitaLedHtml)
    const CLASSE_EFEITO = { FIXO: "fixo", PISCA: "pisca", CORRE: "perseguicao", RESPIRA: "respira", FLASH3: "flash3", ESTROBO: "estrobo", RESPIRA_RAPIDA: "respira-rapida" };
    const corTela = fw => (CORES.find(c => c[0] === fw) || [])[1] || CORES_SEGURANCA[fw] || "#" + fw;
    const nomeCor = fw => (CORES.find(c => c[0] === fw) || [])[2] || ({ FF0000: "Vermelho", FFB000: "Âmbar", FF4A00: "Laranja", FF00B4: "Magenta", "505050": "Cinza" })[fw] || "#" + fw;

    function vazio() { return { rev: 0, sinais: {} }; }
    function normalizar(c) {
        const r = { rev: Number(c?.rev) || 0, sinais: {} };
        Object.entries(c?.sinais || {}).forEach(([k, v]) => {
            if (!PADRAO[k] || TRAVADOS.includes(k)) return;
            const cor = String(v?.cor || "").toUpperCase(), ef = String(v?.efeito || "");
            if (CORES.some(x => x[0] === cor) && EFEITOS[ef]) r.sinais[k] = { cor, efeito: ef };
        });
        return r;
    }
    // a tabela em uso: padrão + o que a empresa mudou
    function efetiva(c) {
        const n = normalizar(c);
        const r = {};
        Object.keys(PADRAO).forEach(k => {
            const [cor, efeito] = PADRAO[k];
            r[k] = n.sinais[k] && !TRAVADOS.includes(k) ? Object.assign({}, n.sinais[k]) : { cor, efeito };
        });
        return r;
    }
    function validar(c) {
        const erros = [], avisos = [];
        const t = efetiva(c), p = efetiva(vazio());
        const chave = s => s.cor + "|" + s.efeito;
        Object.keys(t).forEach(k => {
            if (!normalizar(c).sinais[k]) return;
            const igual = Object.keys(t).filter(o => o !== k && chave(t[o]) === chave(t[k]) && chave(p[o]) !== chave(p[k]));
            if (igual.length) erros.push(`${texto(k)} ficou igual a ${igual.map(texto).join(", ")} (${nomeCor(t[k].cor).toLowerCase()} ${EFEITOS_TODOS[t[k].efeito]}): ninguém distingue um do outro.`);
        });
        return { erros: [...new Set(erros)], avisos };
    }
    const texto = k => (typeof SINAIS_LED_SITE !== "undefined" && SINAIS_LED_SITE[k]?.[2]) || k;

    const Nucleo = { GRUPOS, META, TRAVADOS, PADRAO, CORES, EFEITOS, vazio, normalizar, efetiva, validar };
    if (typeof document === "undefined") return Nucleo;

    /* ========================================================
       NO SITE
       ======================================================== */
    const CHAVE = "sinalizacaoFrota";
    let atual = vazio(), rascunho = null, carregado = false, porNome = "", busca = "", soAcao = false;
    const esc = t => String(t ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const naNuvem = () => Boolean(window.Nuvem && Nuvem.emNuvem && Nuvem.emNuvem());
    const podeEditar = () => !naNuvem() || Nuvem.pode("administrar");

    // a legenda do site (cartões, sensores, 3D, Atta virtual) usa a tabela da empresa
    function aplicarNaTela() {
        if (typeof SINAIS_LED_SITE === "undefined") return;
        const t = efetiva(atual);
        Object.entries(t).forEach(([k, s]) => {
            if (!SINAIS_LED_SITE[k]) return;
            SINAIS_LED_SITE[k][0] = corTela(s.cor);
            SINAIS_LED_SITE[k][1] = CLASSE_EFEITO[s.efeito] || "fixo";
        });
    }

    async function carregar() {
        if (naNuvem()) {
            try {
                const r = await Nuvem.cliente().from("sinalizacao").select("dados, rev, por_nome").eq("empresa_id", Nuvem.empresa().id).maybeSingle();
                if (!r.error) { atual = normalizar(Object.assign({}, r.data?.dados || {}, { rev: r.data?.rev || 0 })); porNome = r.data?.por_nome || ""; }
            } catch (e) { /* mantém */ }
        } else {
            try { atual = normalizar(JSON.parse(localStorage.getItem(CHAVE) || "null")); } catch (e) { atual = vazio(); }
        }
        carregado = true;
        aplicarNaTela();
        // os Atta virtuais recebem como se fosse a mensagem retida do broker
        if (atual.rev && typeof AgvVirtual !== "undefined" && AgvVirtual.publicarFrota) AgvVirtual.publicarFrota("frota/sinais", JSON.stringify({ rev: atual.rev, sinais: normalizar(atual).sinais }));
        renderizar(true);
        return atual;
    }

    // vai retida para a frota inteira (e para os Atta virtuais)
    function enviarParaFrota() {
        const msg = JSON.stringify({ rev: atual.rev, sinais: normalizar(atual).sinais });
        let ok = false;
        try {
            if (typeof clienteMQTT !== "undefined" && clienteMQTT && clienteMQTT.connected && typeof mqttEmpresa !== "undefined") {
                clienteMQTT.publish(`agv/${mqttEmpresa}/frota/sinais`, msg, { qos: 1, retain: true });
                ok = true;
            }
        } catch (e) { /* sem broker */ }
        if (typeof AgvVirtual !== "undefined" && AgvVirtual.publicarFrota) { AgvVirtual.publicarFrota("frota/sinais", msg); ok = true; }
        return ok;
    }

    async function salvar(c) {
        if (!podeEditar()) { ui.aviso("Só o administrador muda a sinalização.", "aviso"); return false; }
        const n = normalizar(c);
        const v = validar(n);
        if (v.erros.length) { ui.aviso(v.erros[0], "aviso"); return false; }
        if (naNuvem()) {
            const r = await Nuvem.cliente().rpc("salvar_sinalizacao", { p_empresa: Nuvem.empresa().id, p_dados: { sinais: n.sinais }, p_rev: atual.rev });
            if (r.error) { ui.aviso(r.error.message || "Não foi possível salvar a sinalização.", "erro"); await carregar(); return false; }
            n.rev = Number(r.data) || atual.rev + 1;
        } else {
            n.rev = atual.rev + 1;
            try { localStorage.setItem(CHAVE, JSON.stringify(n)); } catch (e) { /* ignora */ }
        }
        atual = n; rascunho = null;
        aplicarNaTela();
        const enviou = enviarParaFrota();
        if (typeof registrarAcaoSite === "function") registrarAcaoSite("", "configuracao", "SINALIZACAO_SALVA", `rev ${n.rev}: ${Object.keys(n.sinais).length} sinal(is) diferente(s) do padrão E4M`);
        ui.aviso(enviou ? "Sinalização salva e enviada para a frota inteira." : "Sinalização salva. Vai para os Atta quando o site conectar ao broker.", "sucesso");
        renderizar(true);
        if (typeof agendarAtualizacaoTela === "function") agendarAtualizacaoTela();
        return true;
    }

    /* ---------------- a tela ---------------- */

    function fita(k, s, n = 8, classe = "") {
        const cor = corTela(s.cor), ef = CLASSE_EFEITO[s.efeito] || "fixo";
        return `<span class="fita-led ${classe}" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="fx-${ef}" style="--led:${cor};--i:${i};--n:${n}"></i>`).join("")}</span>`;
    }
    function frotaRev() {
        const lista = typeof agvs !== "undefined" ? Object.values(agvs).filter(a => a.online) : [];
        const com = lista.filter(a => Number(a.sinaisRev ?? -1) === atual.rev).length;
        return { total: lista.length, com, antigos: lista.filter(a => a.sinaisRev === undefined).map(a => a.id) };
    }

    function htmlTela() {
        const c = rascunho || atual;
        const t = efetiva(c);
        const pode = podeEditar();
        const v = validar(c);
        const fr = frotaRev();
        const q = busca.trim().toLowerCase();
        const linhas = GRUPOS.map(([g, nomeGrupo]) => {
            const ks = Object.keys(META).filter(k => META[k].grupo === g)
                .filter(k => !soAcao || META[k].acao)
                .filter(k => !q || (texto(k) + " " + nomeCor(t[k].cor) + " " + EFEITOS_TODOS[t[k].efeito] + " " + META[k].fazer).toLowerCase().includes(q));
            if (!ks.length) return "";
            return `<section class="sin-grupo"><h3>${esc(nomeGrupo)}</h3>${ks.map(k => {
                const m = META[k], s = t[k], mudou = Boolean(normalizar(c).sinais[k]);
                const editavel = pode && !m.trava;
                return `<div class="sin-linha ${m.trava ? "travado" : ""} ${mudou ? "mudou" : ""}" data-sinal="${k}">
                    ${fita(k, s)}
                    <div class="sin-texto"><b>${esc(texto(k))}</b><small>${esc(nomeCor(s.cor))} ${esc(EFEITOS_TODOS[s.efeito])}${mudou ? " · mudado pela empresa" : ""}</small></div>
                    <div class="sin-fazer">${esc(m.fazer)}${m.quem && m.quem !== "—" ? `<small>Quem resolve: ${esc(m.quem)}</small>` : ""}</div>
                    <div class="sin-editar">${m.trava ? `<span class="sin-cadeado" title="${esc(m.trava)}">🔒 ${esc(m.trava)}</span>`
                        : editavel ? `<select data-sin-cor="${k}" aria-label="Cor de ${esc(texto(k))}">${CORES.map(([fw, , nome]) => `<option value="${fw}" ${fw === s.cor ? "selected" : ""}>${nome}</option>`).join("")}</select>
                          <select data-sin-efeito="${k}" aria-label="Efeito de ${esc(texto(k))}">${Object.entries(EFEITOS).map(([e, nome]) => `<option value="${e}" ${e === s.efeito ? "selected" : ""}>${nome}</option>`).join("")}</select>
                          ${mudou ? `<button type="button" class="btn btn-mini" data-sin-padrao="${k}" title="Voltar ao padrão E4M">↺</button>` : ""}` : ""}</div>
                </div>`;
            }).join("")}</section>`;
        }).join("");
        return `
            <section class="card sin-topo">
                <div class="sin-topo-linha">
                    <div><h2>Sinais do Atta</h2><p class="suave">O que cada luz quer dizer e o que fazer. Uma tabela só para a planta inteira: todos os Atta mostram as mesmas cores.</p></div>
                    <div class="sin-acoes">
                        <button type="button" class="btn" data-sin="imprimir">Imprimir cartaz</button>
                    </div>
                </div>
                <div class="sin-filtros">
                    <input type="search" id="sinBusca" placeholder="Buscar por cor ou situação (ex.: azul, piscando, obstáculo)" value="${esc(busca)}" aria-label="Buscar sinal">
                    <label class="rotina-check"><input type="checkbox" id="sinSoAcao" ${soAcao ? "checked" : ""}><span>Só os que pedem ação</span></label>
                    <span class="suave sin-rev">${atual.rev ? `rev ${atual.rev}${porNome ? " · " + esc(porNome) : ""}` : "padrão E4M"}${fr.total ? ` · ${fr.com} de ${fr.total} Atta com esta revisão` : ""}</span>
                </div>
                ${fr.antigos.length ? `<div class="missao-dica ambar">${esc(fr.antigos.join(", "))}: firmware sem sinalização configurável (antes da 0.20). Ele continua com o padrão E4M.</div>` : ""}
            </section>
            ${linhas || `<p class="suave">Nenhum sinal com esse filtro.</p>`}
            ${pode ? `<section class="card sin-rodape">
                ${v.erros.length ? `<div class="missao-dica vermelho">${v.erros.map(esc).join("<br>")}</div>` : ""}
                <div class="rotina-acoes">
                    <button type="button" class="btn btn-primario" data-sin="salvar" ${rascunho && !v.erros.length ? "" : "disabled"}>${rascunho ? "Salvar e enviar para a frota" : "Salvo"}</button>
                    ${rascunho ? `<button type="button" class="btn" data-sin="descartar">Descartar</button>` : ""}
                    ${Object.keys(atual.sinais).length || rascunho ? `<button type="button" class="btn" data-sin="padrao">Voltar ao padrão E4M</button>` : ""}
                    <button type="button" class="btn" data-sin="reenviar" title="Manda de novo a tabela para todos os Atta">Reenviar</button>
                </div>
                <p class="suave">Vermelho, âmbar, laranja e magenta são reservados à segurança, e o piscar rápido também. Os sinais com cadeado não mudam. A configuração usada fica no Histórico; registre-a na análise de risco (NR-12) do cliente.</p>
            </section>` : `<p class="suave">Só o administrador muda a sinalização.</p>`}`;
    }

    function renderizar(forcar = false) {
        const caixa = document.getElementById("sinalizacaoConteudo");
        if (!caixa || !document.getElementById("sinalizacao")?.classList.contains("ativa")) return;
        if (!carregado) { carregar(); return; }
        if (!forcar && caixa.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
        const html = htmlTela();
        if (caixa.__html !== html) { caixa.__html = html; caixa.innerHTML = html; }
    }

    function editar(mudar) {
        const c = JSON.parse(JSON.stringify(rascunho || atual));
        mudar(c);
        const n = normalizar(c);
        n.rev = atual.rev;
        rascunho = JSON.stringify(n.sinais) === JSON.stringify(normalizar(atual).sinais) ? null : n;
        renderizar(true);
    }

    function cartaz() {
        const t = efetiva(atual);
        const w = window.open("", "_blank");
        if (!w) { ui.aviso("O navegador bloqueou a janela do cartaz.", "aviso"); return; }
        const linhas = GRUPOS.map(([g, nome]) => {
            const ks = Object.keys(META).filter(k => META[k].grupo === g && k !== "TESTE_LEDS");
            return `<h2>${esc(nome)}</h2>${ks.map(k => `<div class="l"><span class="f">${Array.from({ length: 6 }, () => `<i style="background:${corTela(t[k].cor)}"></i>`).join("")}</span>
                <div><b>${esc(texto(k))}</b><em>${esc(nomeCor(t[k].cor))} ${esc(EFEITOS_TODOS[t[k].efeito])}</em><p>${esc(META[k].fazer)}</p></div></div>`).join("")}`;
        }).join("");
        w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sinais do Atta</title><style>
            @page { size: A4; margin: 12mm; } body { font: 11px/1.35 system-ui, sans-serif; color: #111; }
            h1 { font-size: 20px; margin: 0 0 2px; } .s { color: #555; margin: 0 0 8px; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 10px 0 4px; color: #333; border-bottom: 1px solid #ddd; }
            .g { columns: 2; column-gap: 10mm; } .l { display: flex; gap: 8px; break-inside: avoid; margin: 3px 0 6px; } .f { display: flex; gap: 2px; background: #111; padding: 4px; border-radius: 4px; height: 10px; flex: none; }
            .f i { width: 8px; height: 10px; border-radius: 2px; display: block; } b { display: block; } em { color: #555; font-style: normal; } p { margin: 1px 0 0; }
            .r { margin-top: 10px; color: #555; font-size: 10px; }</style></head><body>
            <h1>Sinais do Atta</h1><p class="s">O que cada luz quer dizer e o que fazer. Vermelho, âmbar e magenta são sempre de segurança.</p>
            <div class="g">${linhas}</div><p class="r">E4M · Eciton · sinalização ${atual.rev ? "da empresa, rev " + atual.rev : "padrão E4M"} · ${new Date().toLocaleDateString("pt-BR")}</p>
            <script>window.onload = () => setTimeout(() => window.print(), 200);<\/script></body></html>`);
        w.document.close();
    }

    document.addEventListener("click", async e => {
        const caixa = document.getElementById("sinalizacaoConteudo");
        if (caixa && caixa.contains(e.target)) {
            const b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.sinPadrao) editar(c => { delete c.sinais[b.dataset.sinPadrao]; });
            const a = b.dataset.sin;
            if (a === "salvar" && rascunho) await salvar(rascunho);
            if (a === "descartar") { rascunho = null; renderizar(true); }
            if (a === "padrao") editar(c => { c.sinais = {}; });
            if (a === "reenviar") ui.aviso(enviarParaFrota() ? "Sinalização reenviada para a frota." : "Sem conexão com o broker agora.", "info");
            if (a === "imprimir") cartaz();
            return;
        }
        // balão do cartão do Atta
        const fitaCartao = e.target.closest("[data-sinal-balao]");
        if (fitaCartao) { e.preventDefault(); e.stopPropagation(); abrirBalao(fitaCartao); return; }
        if (!e.target.closest("#sinalBalao")) fecharBalao();
    }, true);
    document.addEventListener("change", e => {
        const caixa = document.getElementById("sinalizacaoConteudo");
        if (!caixa || !caixa.contains(e.target)) return;
        const t = e.target;
        if (t.id === "sinSoAcao") { soAcao = t.checked; renderizar(true); return; }
        const k = t.dataset.sinCor || t.dataset.sinEfeito;
        if (!k) return;
        editar(c => {
            const s = efetiva(c)[k];
            const novo = { cor: t.dataset.sinCor ? t.value : s.cor, efeito: t.dataset.sinEfeito ? t.value : s.efeito };
            if (!EFEITOS[novo.efeito]) novo.efeito = "FIXO";
            if (!CORES.some(x => x[0] === novo.cor)) novo.cor = CORES[0][0];
            const [pc, pe] = PADRAO[k];
            if (novo.cor === pc && novo.efeito === pe) delete c.sinais[k]; else c.sinais[k] = novo;
        });
    });
    document.addEventListener("input", e => {
        if (e.target.id !== "sinBusca") return;
        busca = e.target.value;
        const pos = e.target.selectionStart;
        renderizar(true);
        const el = document.getElementById("sinBusca");
        if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { /* ignora */ } }
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") fecharBalao(); });

    /* ---------------- balão no cartão do Atta ---------------- */

    function linhaCartao(agv) {
        if (!agv?.online || !agv.leds || !META[agv.leds]) return "";
        const s = efetiva(atual)[agv.leds];
        return `<dt>Luzes</dt><dd><button type="button" class="sin-cartao" data-sinal-balao="${esc(agv.leds)}" aria-label="O que quer dizer: ${esc(texto(agv.leds))}">${fita(agv.leds, s, 5)}<span>${esc(texto(agv.leds))}</span></button></dd>`;
    }
    function abrirBalao(el) {
        const k = el.dataset.sinalBalao;
        if (!META[k]) return;
        fecharBalao();
        const s = efetiva(atual)[k];
        const div = document.createElement("div");
        div.id = "sinalBalao";
        div.className = "sin-balao";
        div.setAttribute("role", "dialog");
        div.innerHTML = `${fita(k, s, 10, "grande")}
            <b>${esc(texto(k))}</b><small class="suave">${esc(nomeCor(s.cor))} ${esc(EFEITOS_TODOS[s.efeito])}</small>
            <p><strong>O que fazer:</strong> ${esc(META[k].fazer)}</p>
            ${META[k].quem && META[k].quem !== "—" ? `<p class="suave">Quem resolve: ${esc(META[k].quem)}</p>` : ""}
            <a href="#" data-sin-ver-todos>Ver todos os sinais</a>`;
        document.body.appendChild(div);
        const r = el.getBoundingClientRect();
        const w = Math.min(320, window.innerWidth - 24);
        div.style.width = w + "px";
        div.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left)) + "px";
        const abaixo = r.bottom + 8 + div.offsetHeight < window.innerHeight;
        div.style.top = (abaixo ? r.bottom + 8 : Math.max(12, r.top - div.offsetHeight - 8)) + window.scrollY + "px";
        div.querySelector("[data-sin-ver-todos]").addEventListener("click", ev => { ev.preventDefault(); fecharBalao(); if (typeof mudarTela === "function") mudarTela("sinalizacao"); });
    }
    function fecharBalao() { document.getElementById("sinalBalao")?.remove(); }

    carregar();
    setInterval(() => { if (naNuvem() && !rascunho && document.visibilityState === "visible") carregar(); }, 120000);

    return Object.assign({}, Nucleo, { carregar, salvar, renderizar, linhaCartao, enviarParaFrota, atual: () => atual, rascunho: () => rascunho,
        abrir: () => { renderizar(true); }, carregado: () => carregado });
})();
if (typeof module !== "undefined") module.exports = Sinalizacao;
if (typeof window !== "undefined") window.Sinalizacao = Sinalizacao;
