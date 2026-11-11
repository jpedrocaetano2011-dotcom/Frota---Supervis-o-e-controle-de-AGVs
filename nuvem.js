/* ============================================================
   NUVEM — login, empresa e dados no Supabase
   ============================================================
   Três modos:
     local  config.js vazio: tudo fica neste navegador, sem login
            (como antes; usado também nos testes).
     nuvem  config.js com o projeto Supabase: login, empresa, papéis;
            AGVs, planta e missões ficam no banco.
     demo   "Ver demonstração" na tela de entrada: igual ao local,
            com a planta e as missões de exemplo, sem conta.

   O resto do site continua lendo os dados do localStorage (que vira
   uma cópia local do banco) e avisa a Nuvem quando grava:
     Nuvem.salvarMissoes(lista), Nuvem.salvarPlanta(rascunho, publicada),
     Nuvem.salvarAgv(id, nome, idAntigo), Nuvem.removerAgv(id)
   Permissões: Nuvem.pode("ver" | "operar" | "administrar" | "pedir" |
   "despachar" | "urgente"). Postos (0.13): Nuvem.postos(), salvarPosto,
   removerPosto; pedidos ficam no despacho.js (usa Nuvem.cliente()).
*/
(function (raiz) {
    "use strict";

    const cfg = Object.assign({}, raiz.CONFIG_NUVEM || {});
    // Aceita os enganos comuns no config.js: link do painel do Supabase,
    // barra ou /rest/v1 no fim, espaços.
    cfg.url = String(cfg.url || "").trim()
        .replace(/^https?:\/\/(?:app\.)?supabase\.com\/dashboard\/project\/([a-z0-9]+).*$/i, "https://$1.supabase.co")
        .replace(/\/(rest|auth)\/v1.*$/i, "")
        .replace(/\/+$/, "");
    cfg.chave = String(cfg.chave || "").trim();
    const CONFIGURADA = Boolean(cfg.url && cfg.chave);
    const URL_BIBLIOTECA = cfg.biblioteca || "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js";
    const CHAVES_DADOS = ["plantaAGV2", "plantaAGV2Publicada", "missoesAGV", "agvsFrota", "agvSelecionado", "telaAtual", "postosFrota", "pedidosFrota",
                          "manutencoesFrota", "copiasConfig", "historicoFrota"];
    const PAPEIS = { fornecedor: "Fornecedor", admin: "Administrador", operador: "Operador", lider: "Líder", posto: "Posto", manutencao: "Manutenção", visualizador: "Visualizador" };
    const NIVEIS = {
        ver: ["fornecedor", "admin", "operador", "lider", "posto", "manutencao", "visualizador"],
        operar: ["fornecedor", "admin", "operador"],
        administrar: ["fornecedor", "admin"],
        pedir: ["fornecedor", "admin", "operador", "posto"],
        despachar: ["fornecedor", "admin", "operador", "posto"],
        urgente: ["fornecedor", "admin", "operador", "lider"],
        // 0.14
        manutencao: ["fornecedor", "admin", "operador", "manutencao"],
        documentacao: ["fornecedor", "admin", "manutencao"],
        copiar_config: ["fornecedor", "admin", "operador", "posto", "manutencao"],
        // 0.19: fechar e reabrir corredores
        trafego: ["fornecedor", "admin", "operador", "lider"],
        // 0.20: calendário da fábrica (turnos, intervalos, paradas)
        calendario: ["fornecedor", "admin", "lider"],
        // 0.21: estudo de frota
        // 0.22: só a E4M (o cliente vê o relatório pelo link)
        estudo: ["fornecedor"],
        // 0.23: baterias (carregar agora, liberar o carregador, pular a fila)
        bateria: ["fornecedor", "admin", "operador", "lider"]
    };
    // Comandos que o despachante manda (o tablet do posto também despacha)
    // 0.23: a aba que despacha também manda a bateria (perfil, carregar) e o desvio automático
    const TOPICOS_DESPACHO = /^comando\/(fila|fila\/adicionar|saidas|bateria|desvio)$/;
    // Comandos que mudam o AGV em si (parâmetros, firmware, calibração): só admin.
    const TOPICOS_ADMIN = /^comando\/(broker|configuracao|ota|calibracao_qtr|calibracao_mecanica|trafego)$/;
    // Papel Manutenção (0.14): mexe no AGV (manual, calibração, configuração, autoteste), não roda missão
    const TOPICOS_MANUTENCAO = /^comando\/(manutencao|manual|garra\/movimento|garra\/parar|definir_posicao|calibracao_qtr|calibracao_mecanica|configuracao|autoteste|trafego)$/;

    let modo = "local";
    let cliente = null, usuario = null, perfil = null, empresa = null;
    let dados = null;
    let conexaoMqttEmpresa = null;
    let fotoMissoes = new Map();
    let revisaoNuvem = 0, publicando = 0, rascunhoNuvem = "null", timerRascunho = null, rascunhoPendente = null;
    let fila = Promise.resolve();
    let pendentes = 0;
    let carregado = false;
    let avisoRemoto = null, ultimoAvisoBloqueio = 0;
    let resolverPronto;
    const pronto = new Promise(r => { resolverPronto = r; });

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ler = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sem espaço */ } };
    const apagar = k => { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } };

    function limparCopiaLocal() {
        CHAVES_DADOS.forEach(apagar);
        apagar("cacheNuvem");
    }

    /* ========================================================
       INÍCIO
       ======================================================== */

    // Demonstração (0.15): só por link com prazo (?demo=código), conferido no banco
    // toda vez que o site abre. Sem botão público na entrada.
    let demoExpira = null, avisoDemo = "";
    async function conferirDemo() {
        const daUrl = new URLSearchParams(location.search).get("demo");
        if (daUrl) {
            try { sessionStorage.setItem("codigoDemo", daUrl); } catch (e) { /* ignora */ }
            const q = new URLSearchParams(location.search);
            q.delete("demo");
            history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
        }
        sessionStorage.removeItem("modoDemo");          // o botão antigo
        let codigo = null;
        try { codigo = sessionStorage.getItem("codigoDemo"); } catch (e) { /* ignora */ }
        if (!codigo) return false;
        try {
            if (!raiz.supabase) await carregarScript(URL_BIBLIOTECA);
            const anonimo = raiz.supabase.createClient(cfg.url, cfg.chave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
            const { data, error } = await anonimo.rpc("entrar_demo", { p_codigo: codigo, p_contar: Boolean(daUrl) });
            if (error) throw error;
            if (data?.ok) { demoExpira = Date.parse(data.expira_em); return true; }
            avisoDemo = data?.motivo === "expirado" ? "Este link de demonstração expirou. Peça um novo para a E4M."
                : data?.motivo === "cancelado" ? "Este link de demonstração foi cancelado." : "Link de demonstração inválido.";
        } catch (e) {
            avisoDemo = "Não deu para conferir o link de demonstração agora. Tente de novo em instantes.";
        }
        try { sessionStorage.removeItem("codigoDemo"); } catch (e) { /* ignora */ }
        return false;
    }

    async function iniciar(scripts) {
        try {
            if (!CONFIGURADA) {
                modo = "local";
            } else if (await conferirDemo()) {
                modo = "demo";
                // o fornecedor pode cancelar a qualquer hora: confere de novo de tempos em tempos
                setInterval(async () => { if (!(await conferirDemo())) { limparCopiaLocal(); location.reload(); } }, 5 * 60000);
            } else {
                modo = "nuvem";
                montarEntrada();
                await entrarNaNuvem();
            }
            aplicarPapel();
            await carregarScripts(scripts);
            carregado = true;
            desenharConta();
            esconderEntrada();
            if (modo === "nuvem") iniciarTempoReal();
            document.body.dataset.pronto = modo;
            resolverPronto(modo);
        } catch (erro) {
            console.error(erro);
            mostrarPainel("erro", { mensagem: traduzirErro(erro) });
        }
    }

    function carregarScript(src) {
        return new Promise((resolver, rejeitar) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = false;
            s.onload = () => resolver();
            s.onerror = () => rejeitar(new Error(`Não foi possível carregar ${src}.`));
            document.body.appendChild(s);
        });
    }

    function carregarScripts(lista) {
        // todos de uma vez, executados na ordem (async = false)
        return Promise.all(lista.map(carregarScript));
    }

    async function entrarNaNuvem() {
        mostrarPainel("carregando", { texto: "Conectando…" });
        if (!raiz.supabase) await carregarScript(URL_BIBLIOTECA);
        cliente = raiz.supabase.createClient(cfg.url, cfg.chave, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        let recuperacao = /type=recovery/.test(location.hash);
        cliente.auth.onAuthStateChange(evento => {
            if (evento === "PASSWORD_RECOVERY") recuperacao = true;
            if (evento === "SIGNED_OUT" && carregado) {
                limparCopiaLocal();
                location.reload();
            }
        });
        let { data: { session } } = await cliente.auth.getSession();
        if (session && recuperacao) {
            await pedirNovaSenha();
            history.replaceState(null, "", location.pathname + location.search);
        }
        for (;;) {
            if (!session) session = await pedirLogin();
            usuario = session.user;
            const resultado = await carregarPerfilEEmpresa();
            if (resultado === "ok") break;
            if (resultado === "sair") {
                await cliente.auth.signOut();
                session = null;
            }
            // "tentar": carrega de novo com a mesma sessão
        }
        const dono = `${usuario.id}:${empresa.id}`;
        if (ler("cacheNuvem") !== dono) {
            limparCopiaLocal();
            gravar("cacheNuvem", dono);
        }
        mostrarPainel("carregando", { texto: `Carregando ${empresa.nome}…` });
        await baixarDados();
    }

    async function carregarPerfilEEmpresa() {
        mostrarPainel("carregando", { texto: "Carregando o seu acesso…" });
        const { data: p, error } = await cliente.from("perfis").select("*").eq("usuario_id", usuario.id).maybeSingle();
        if (error) throw error;
        perfil = p;
        if (!p) return esperarPainel("semEmpresa");
        if (p.papel === "fornecedor") {
            const { data: lista, error: e2 } = await cliente.from("empresas").select("*").order("nome");
            if (e2) throw e2;
            empresa = lista.find(e => e.id === ler("empresaAtual")) || null;
            if (!empresa) {
                const escolha = await esperarPainel("escolherEmpresa", { lista });
                if (escolha === "sair" || escolha === "tentar") return escolha;
                empresa = escolha;
            }
        } else {
            if (!p.empresa_id) return esperarPainel("semEmpresa");
            const { data: e, error: e3 } = await cliente.from("empresas").select("*").eq("id", p.empresa_id).maybeSingle();
            if (e3) throw e3;
            if (!e) return esperarPainel("suspensa");
            empresa = e;
        }
        gravar("empresaAtual", empresa.id);
        return "ok";
    }

    async function baixarDados() {
        const id = empresa.id;
        const [a, p, m, po] = await Promise.all([
            cliente.from("agvs").select("id, nome, rotina, modelo, serie").eq("empresa_id", id).order("id")
                .then(r => r.error ? cliente.from("agvs").select("id, nome, rotina").eq("empresa_id", id).order("id") : r),
            cliente.from("plantas").select("rascunho, publicada, revisao").eq("empresa_id", id).maybeSingle(),
            cliente.from("missoes").select("id, nome, etapas, prioridade").eq("empresa_id", id).order("id"),
            cliente.from("postos").select("id, nome, ponto, botoes, permite_urgente, usuarios, pin_pessoal").eq("empresa_id", id).order("id")
        ]);
        [a, p, m].forEach(r => { if (r.error) throw r.error; });
        dados = {
            postos: po.error ? [] : po.data.map(postoDoBanco),
            agvs: a.data,
            planta: p.data || { rascunho: null, publicada: null, revisao: 0 },
            missoes: m.data.map(x => Object.assign({ id: x.id, nome: x.nome, etapas: x.etapas }, x.prioridade !== 1 && x.prioridade != null ? { prioridade: x.prioridade } : {}))
        };
        revisaoNuvem = dados.planta.revisao || 0;
        rascunhoNuvem = JSON.stringify(dados.planta.rascunho);
        fotoMissoes = new Map(dados.missoes.map(x => [x.id, fotoDaMissao(x)]));
        gravar("missoesAGV", JSON.stringify(dados.missoes));
        gravar("postosFrota", JSON.stringify(dados.postos));
        // Credencial MQTT da empresa (só chega depois do login; nunca fica no código).
        try {
            const r = await cliente.rpc("conexao_mqtt", { p_empresa: id });
            if (r.error) throw r.error;
            conexaoMqttEmpresa = r.data || null;
        } catch (erro) {
            console.warn("MQTT da empresa indisponível:", erro?.message || erro);
            conexaoMqttEmpresa = null;
        }
    }

    // Conexão MQTT para o script.js: { url, usuario, senha, empresa, nivel } ou null.
    // Sem nuvem, usa config.js › mqttLocal (opcional, para testes na bancada).
    function conexaoMqtt() {
        if (modo === "nuvem") return conexaoMqttEmpresa;
        const m = cfg.mqttLocal;
        if (m && m.url && m.empresa) return { url: m.url, usuario: m.usuario || "", senha: m.senha || "", empresa: m.empresa, nivel: "operacao" };
        return null;
    }


    /* ========================================================
       PAPEL / PERMISSÕES
       ======================================================== */

    function papel() {
        return modo === "nuvem" ? (perfil?.papel || "visualizador") : "admin";
    }

    function pode(nivel) {
        return (NIVEIS[nivel] || []).includes(papel());
    }

    function exigir(nivel, acao) {
        if (pode(nivel)) return true;
        if (raiz.ui) ui.aviso(`Seu perfil (${PAPEIS[papel()]}) não permite ${acao || "esta ação"}.`, "aviso");
        return false;
    }

    // Chamado pelo publicar() do script.js antes de mandar um comando ao AGV.
    function podePublicar(caminho) {
        if (modo !== "nuvem") return true;
        if (caminho === "comando/stop") return true;   // parar é sempre permitido
        if (TOPICOS_DESPACHO.test(caminho) && pode("despachar")) return true;
        if (caminho === "comando/manutencao" && pode("manutencao")) return true;
        if (papel() === "manutencao" && TOPICOS_MANUTENCAO.test(caminho)) return true;
        const nivel = TOPICOS_ADMIN.test(caminho) ? "administrar" : "operar";
        if (pode(nivel)) return true;
        if (Date.now() - ultimoAvisoBloqueio > 3000) {
            ultimoAvisoBloqueio = Date.now();
            ui.aviso(`Seu perfil (${PAPEIS[papel()]}) não permite ${nivel === "administrar" ? "alterar a configuração do AGV" : "comandar o AGV"}.`, "aviso");
        }
        return false;
    }

    function aplicarPapel() {
        const b = document.body.classList;
        b.toggle("modo-nuvem", modo === "nuvem");
        b.toggle("modo-demo", modo === "demo");
        b.toggle("sem-operar", !pode("operar"));
        b.toggle("sem-administrar", !pode("administrar"));
        b.toggle("sem-pedir", !pode("pedir"));
        b.toggle("sem-manutencao", !pode("manutencao"));
        Object.keys(PAPEIS).forEach(p => b.toggle("papel-" + p, papel() === p));
    }


    /* ========================================================
       LEITURA PELO RESTO DO SITE
       ======================================================== */

    // script.js, logo depois de ler a frota: deixa só os AGVs da empresa
    // (os virtuais são deste navegador e ficam).
    function ajustarFrota(agvs, criarAGV) {
        if (modo !== "nuvem" || !dados) return;
        const naNuvem = new Map(dados.agvs.map(a => [a.id, a]));
        Object.keys(agvs).forEach(id => {
            if (!agvs[id].virtual && !naNuvem.has(id)) delete agvs[id];
        });
        naNuvem.forEach((a, id) => {
            if (!agvs[id] || agvs[id].virtual) agvs[id] = criarAGV(id, a.nome);
            else agvs[id].nome = a.nome;
            agvs[id].rotina = a.rotina && Object.keys(a.rotina).length ? a.rotina : (agvs[id].rotina || null);
            agvs[id].modelo = a.modelo || null;
            agvs[id].serie = a.serie || "";
        });
    }

    // editor-planta.js: a planta vem do banco, não do navegador.
    function plantaDaNuvem() {
        if (modo !== "nuvem" || !dados) return null;
        return { rascunho: dados.planta.rascunho, publicada: dados.planta.publicada };
    }


    /* ========================================================
       GRAVAÇÃO
       ======================================================== */

    function enfileirar(tarefa, oQue) {
        pendentes++;
        desenharEstadoSalvamento();
        fila = fila.then(tarefa).then(() => {
            pendentes--;
            desenharEstadoSalvamento();
        }, erro => {
            pendentes--;
            desenharEstadoSalvamento(true);
            console.error(erro);
            ui.aviso(`Não foi possível salvar ${oQue} na nuvem: ${traduzirErro(erro)}`, "erro");
        });
        return fila;
    }

    const fotoDaMissao = m => JSON.stringify({ nome: m.nome || "", etapas: Array.isArray(m.etapas) ? m.etapas : [], prioridade: Number.isInteger(m.prioridade) ? m.prioridade : 1 });

    function salvarMissoes(lista) {
        if (modo !== "nuvem" || !pode("operar")) return;
        const atuais = new Map(lista.map(m => [m.id, fotoDaMissao(m)]));
        enfileirar(async () => {
            const mudadas = [...atuais].filter(([id, f]) => fotoMissoes.get(id) !== f)
                .map(([id, f]) => Object.assign({ empresa_id: empresa.id, id }, JSON.parse(f)));
            const removidas = [...fotoMissoes.keys()].filter(id => !atuais.has(id));
            if (mudadas.length) {
                const { error } = await cliente.from("missoes").upsert(mudadas);
                if (error) throw error;
                mudadas.forEach(m => fotoMissoes.set(m.id, atuais.get(m.id)));
            }
            if (removidas.length) {
                const { error } = await cliente.from("missoes").delete().eq("empresa_id", empresa.id).in("id", removidas);
                if (error) throw error;
                removidas.forEach(id => fotoMissoes.delete(id));
            }
        }, "as missões");
    }

    function salvarPlanta(rascunho, publicada) {
        if (modo !== "nuvem" || !pode("administrar")) return;
        const revisao = Number(publicada?.revisao) || 0;
        if (revisao > revisaoNuvem && revisao > publicando) {
            publicando = revisao;
            const copia = JSON.parse(JSON.stringify(publicada));
            enfileirar(async () => {
                try {
                    const { data, error } = await cliente.rpc("publicar_planta", { p_empresa: empresa.id, p_planta: copia });
                    if (error) throw error;
                    revisaoNuvem = data;
                } finally {
                    publicando = 0;
                }
            }, "a planta publicada");
        }
        const texto = JSON.stringify(rascunho);
        if (texto === rascunhoNuvem && !timerRascunho) return;
        rascunhoPendente = texto;
        clearTimeout(timerRascunho);
        timerRascunho = setTimeout(enviarRascunho, 1500);
    }

    function enviarRascunho() {
        clearTimeout(timerRascunho);
        timerRascunho = null;
        const texto = rascunhoPendente;
        rascunhoPendente = null;
        if (texto === null || texto === rascunhoNuvem) return;
        enfileirar(async () => {
            const { error } = await cliente.from("plantas").upsert({ empresa_id: empresa.id, rascunho: JSON.parse(texto) });
            if (error) throw error;
            rascunhoNuvem = texto;
        }, "o rascunho da planta");
    }

    function salvarAgv(id, nome, idAntigo, extra) {
        if (modo !== "nuvem" || !pode("administrar")) return;
        enfileirar(async () => {
            if (idAntigo && idAntigo !== id) {
                const { error } = await cliente.from("agvs").delete().eq("empresa_id", empresa.id).eq("id", idAntigo);
                if (error) throw error;
            }
            const linha = { empresa_id: empresa.id, id, nome };
            if (extra) { linha.modelo = extra.modelo || null; linha.serie = extra.serie || null; }
            const { error } = await cliente.from("agvs").upsert(linha);
            if (error) throw error;
        }, `o AGV ${id}`);
    }

    // Rotina (berço e turno) de um AGV: operador também pode
    function salvarRotina(id, rotina) {
        if (modo !== "nuvem" || !pode("operar")) return;
        enfileirar(async () => {
            const { error } = await cliente.rpc("salvar_rotina", { p_empresa: empresa.id, p_agv: id, p_rotina: rotina });
            if (error) throw error;
        }, `a rotina do AGV ${id}`);
    }

    /* ---------- postos (0.13) ---------- */
    function postoDoBanco(x) {
        return { id: x.id, nome: x.nome, ponto: x.ponto || "", botoes: Array.isArray(x.botoes) ? x.botoes : [],
                 permiteUrgente: Boolean(x.permite_urgente), usuarios: Array.isArray(x.usuarios) ? x.usuarios : [], pinPessoal: Boolean(x.pin_pessoal) };
    }
    function postos() {
        if (modo === "nuvem" && dados) return dados.postos;
        try { return JSON.parse(ler("postosFrota") || "[]"); } catch (e) { return []; }
    }
    function gravarPostosLocal(lista) {
        if (modo === "nuvem" && dados) dados.postos = lista;
        gravar("postosFrota", JSON.stringify(lista));
    }
    async function salvarPosto(posto, idAntigo) {
        const lista = postos().filter(p => p.id !== posto.id && p.id !== idAntigo).concat([posto]).sort((a, b) => a.id.localeCompare(b.id));
        if (modo === "nuvem") {
            if (!exigir("administrar", "configurar postos")) return false;
            if (idAntigo && idAntigo !== posto.id) {
                const { error } = await cliente.from("postos").delete().eq("empresa_id", empresa.id).eq("id", idAntigo);
                if (error) throw error;
            }
            const { error } = await cliente.from("postos").upsert({
                empresa_id: empresa.id, id: posto.id, nome: posto.nome, ponto: posto.ponto || "",
                botoes: posto.botoes || [], permite_urgente: Boolean(posto.permiteUrgente), usuarios: posto.usuarios || [],
                pin_pessoal: Boolean(posto.pinPessoal)
            });
            if (error) throw error;
        }
        gravarPostosLocal(lista);
        return true;
    }
    async function removerPosto(id) {
        if (modo === "nuvem") {
            if (!exigir("administrar", "configurar postos")) return false;
            const { error } = await cliente.from("postos").delete().eq("empresa_id", empresa.id).eq("id", id);
            if (error) throw error;
        }
        gravarPostosLocal(postos().filter(p => p.id !== id));
        return true;
    }
    async function recarregarPostos() {
        if (modo !== "nuvem") return postos();
        const r = await cliente.from("postos").select("id, nome, ponto, botoes, permite_urgente, usuarios, pin_pessoal").eq("empresa_id", empresa.id).order("id");
        if (!r.error) gravarPostosLocal(r.data.map(postoDoBanco));
        return postos();
    }

    function removerAgv(id) {
        if (modo !== "nuvem" || !pode("administrar")) return;
        enfileirar(async () => {
            const { error } = await cliente.from("agvs").delete().eq("empresa_id", empresa.id).eq("id", id);
            if (error) throw error;
        }, `a exclusão do AGV ${id}`);
    }

    // Termina o que está pendente (usado antes de sair ou recarregar).
    function terminarGravacoes() {
        if (timerRascunho) enviarRascunho();
        return fila;
    }

    addEventListener("beforeunload", evento => {
        if (modo !== "nuvem") return;
        if (timerRascunho) enviarRascunho();
        if (pendentes > 0) {
            evento.preventDefault();
            evento.returnValue = "";
        }
    });


    /* ========================================================
       TEMPO REAL: mudanças feitas por outra pessoa
       ======================================================== */

    function iniciarTempoReal() {
        if (cfg.tempoReal === false) return;
        try {
            const filtro = `empresa_id=eq.${empresa.id}`;
            cliente.channel(`empresa-${empresa.id}`)
                .on("postgres_changes", { event: "*", schema: "public", table: "missoes", filter: filtro }, ev => mudancaRemota("as missões", ev))
                .on("postgres_changes", { event: "*", schema: "public", table: "agvs", filter: filtro }, ev => mudancaRemota("a frota", ev))
                .on("postgres_changes", { event: "UPDATE", schema: "public", table: "plantas", filter: filtro }, ev => {
                    if ((ev.new?.revisao || 0) > revisaoNuvem && !publicando) mudancaRemota(`a planta (revisão ${ev.new.revisao} publicada)`, ev);
                })
                .on("postgres_changes", { event: "INSERT", schema: "public", table: "plantas", filter: filtro }, ev => mudancaRemota("a planta", ev))
                .on("postgres_changes", { event: "*", schema: "public", table: "postos", filter: filtro }, () => {
                    recarregarPostos().then(() => { if (typeof raiz.aoMudarPostos === "function") raiz.aoMudarPostos(); });
                })
                .subscribe();
        } catch (erro) {
            console.warn("Tempo real indisponível:", erro);
        }
    }

    function mudancaRemota(oQue, ev) {
        const autor = ev.new?.atualizado_por;
        if (ev.eventType !== "DELETE" && autor === usuario.id) return;
        if (ev.eventType === "DELETE" && pendentes > 0) return;
        if (avisoRemoto && document.body.contains(avisoRemoto)) return;
        avisoRemoto = avisoComAcao(`Outra pessoa alterou ${oQue}. Atualize para ver a versão nova.`, "Atualizar", async () => {
            await terminarGravacoes();
            location.reload();
        });
    }

    function avisoComAcao(texto, rotulo, aoClicar) {
        const el = ui.aviso(texto, "info");
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "btn btn-mini toast-acao";
        botao.textContent = rotulo;
        botao.addEventListener("click", aoClicar);
        el.querySelector("p").after(botao);
        el.classList.add("fixo");
        return el;
    }


    /* ========================================================
       CONTA (canto do menu) E SAIR
       ======================================================== */

    // Nome do cliente no topo do menu, embaixo da marca E4M (ex.: Scania)
    function desenharCliente() {
        const el = document.getElementById("marcaCliente");
        if (!el) return;
        const nome = modo === "nuvem" ? empresa?.nome : modo === "demo" ? "Demonstração" : "";
        el.textContent = nome || "";
        el.hidden = !nome;
        el.title = nome ? `Aplicação ${nome}` : "";
    }

    function desenharConta() {
        desenharCliente();
        const rodape = document.querySelector(".sidebar-footer");
        if (!rodape || modo === "local") return;
        let caixa = document.getElementById("nuvemConta");
        if (!caixa) {
            caixa = document.createElement("div");
            caixa.id = "nuvemConta";
            caixa.className = "conta";
            rodape.prepend(caixa);
        }
        if (modo === "demo") {
            caixa.innerHTML = `
                <div class="conta-nome">Demonstração</div>
                <div class="conta-detalhe">Nada é salvo na nuvem${demoExpira ? ` · link vale até ${new Date(demoExpira).toLocaleDateString("pt-BR")}` : ""}</div>
                <div class="conta-acoes"><button type="button" class="btn btn-mini" data-conta="sairDemo">Entrar com uma conta</button></div>`;
        } else {
            const fornecedor = perfil.papel === "fornecedor";
            caixa.innerHTML = `
                <div class="conta-nome" title="${esc(perfil.email)}">${esc(perfil.nome || perfil.email)}</div>
                <div class="conta-detalhe"><span class="conta-papel">${esc(PAPEIS[perfil.papel])}</span> · ${esc(empresa.nome)}</div>
                <div class="conta-salvo" id="nuvemSalvo">Salvo na nuvem</div>
                <div class="conta-acoes">
                    ${fornecedor ? `<button type="button" class="btn btn-mini" data-conta="trocar">Trocar empresa</button>` : ""}
                    <button type="button" class="btn btn-mini" data-conta="sair">Sair</button>
                </div>`;
        }
        caixa.onclick = evento => {
            const acao = evento.target.closest("[data-conta]")?.dataset.conta;
            if (acao === "sair") sair();
            if (acao === "trocar") trocarEmpresa(null);
            if (acao === "sairDemo") sairDaDemonstracao();
        };
        document.querySelectorAll(".so-nuvem").forEach(el => { el.hidden = modo !== "nuvem" || !pode("administrar"); });
    }

    function desenharEstadoSalvamento(falhou) {
        const el = document.getElementById("nuvemSalvo");
        if (!el) return;
        el.classList.toggle("salvando", pendentes > 0);
        el.classList.toggle("falhou", Boolean(falhou));
        el.textContent = pendentes > 0 ? "Salvando…" : falhou ? "Erro ao salvar" : "Salvo na nuvem";
    }

    async function sair() {
        await terminarGravacoes();
        carregado = false;
        await cliente.auth.signOut();
        limparCopiaLocal();
        location.reload();
    }

    async function trocarEmpresa(id) {
        await terminarGravacoes();
        if (id) gravar("empresaAtual", id);
        else apagar("empresaAtual");
        limparCopiaLocal();
        location.reload();
    }

    function sairDaDemonstracao() {
        sessionStorage.removeItem("modoDemo");
        sessionStorage.removeItem("codigoDemo");
        limparCopiaLocal();
        location.reload();
    }


    /* ========================================================
       TELA DE ENTRADA
       ======================================================== */

    let fundo = null, resolverPainel = null;

    function montarEntrada() {
        if (fundo) return;
        fundo = document.createElement("div");
        fundo.className = "tela-entrada";  // não "entrada": é a classe das entradas do painel (Sensores)
        fundo.id = "telaEntrada";
        fundo.innerHTML = `
            <div class="entrada-cartao" role="dialog" aria-modal="true" aria-labelledby="entradaTitulo">
                <div class="entrada-marca">
                    <img class="entrada-logo so-claro" src="img/e4m-entrada-claro.webp" alt="E4M · Engineering for Motion" width="240" height="102">
                    <img class="entrada-logo so-escuro" src="img/e4m-entrada-escuro.webp" alt="E4M · Engineering for Motion" width="240" height="104">
                    <div class="marca-sub">Supervisão de frota</div>
                </div>
                <div id="entradaConteudo"></div>
            </div>`;
        document.body.appendChild(fundo);
        document.body.classList.add("entrando");
        fundo.addEventListener("submit", evento => {
            evento.preventDefault();
            aoEnviar(evento.target);
        });
        fundo.addEventListener("click", evento => {
            const botao = evento.target.closest("[data-entrada]");
            if (botao) aoClicar(botao.dataset.entrada, botao);
        });
    }

    function esconderEntrada() {
        document.body.classList.remove("entrando");
        fundo?.remove();
        fundo = null;
    }

    const campo = (rotulo, nome, tipo, extra = "") =>
        `<label class="campo"><span>${rotulo}</span><input name="${nome}" type="${tipo}" ${extra}></label>`;

    function mostrarPainel(tipo, opcoes = {}) {
        if (!fundo) montarEntrada();
        const conteudo = fundo.querySelector("#entradaConteudo");
        const erro = opcoes.erro ? `<p class="entrada-erro" role="alert">${esc(opcoes.erro)}</p>` : "";
        const info = opcoes.info ? `<p class="entrada-info" role="status">${esc(opcoes.info)}</p>` : "";
        const demo = "";   // 0.15: a demonstração é só por link com prazo (Usuários › Links de demonstração)
        let html = "";
        switch (tipo) {
            case "carregando":
                html = `<div class="entrada-carregando"><span class="entrada-roda" aria-hidden="true"></span><p>${esc(opcoes.texto || "Carregando…")}</p></div>`;
                break;
            case "entrar":
                html = `<h1 id="entradaTitulo">Entrar</h1>${erro}${info}${avisoDemo ? `<p class="entrada-erro" role="alert">${esc(avisoDemo)}</p>` : ""}
                    <form data-form="entrar" class="entrada-form">
                        ${campo("E-mail", "email", "email", `autocomplete="username" required value="${esc(opcoes.email || "")}"`)}
                        ${campo("Senha", "senha", "password", 'autocomplete="current-password" required')}
                        <button type="submit" class="btn btn-primario">Entrar</button>
                    </form>
                    <div class="entrada-links">
                        <button type="button" class="btn-link" data-entrada="criar">Criar conta</button>
                        <button type="button" class="btn-link" data-entrada="esqueci">Esqueci a senha</button>
                    </div>${demo}`;
                break;
            case "criar":
                html = `<h1 id="entradaTitulo">Criar conta</h1>
                    <p class="entrada-texto">Use o e-mail que o administrador da sua empresa liberou. Assim você entra direto na empresa.</p>${erro}
                    <form data-form="criar" class="entrada-form">
                        ${campo("Nome", "nome", "text", 'autocomplete="name" required maxlength="80"')}
                        ${campo("E-mail", "email", "email", 'autocomplete="username" required')}
                        ${campo("Senha (mínimo 8 caracteres)", "senha", "password", 'autocomplete="new-password" required minlength="8"')}
                        <button type="submit" class="btn btn-primario">Criar conta</button>
                    </form>
                    <div class="entrada-links"><button type="button" class="btn-link" data-entrada="entrar">Já tenho conta</button></div>`;
                break;
            case "esqueci":
                html = `<h1 id="entradaTitulo">Esqueci a senha</h1>
                    <p class="entrada-texto">Enviamos um link para você criar uma senha nova.</p>${erro}${info}
                    <form data-form="esqueci" class="entrada-form">
                        ${campo("E-mail", "email", "email", 'autocomplete="username" required')}
                        <button type="submit" class="btn btn-primario">Enviar link</button>
                    </form>
                    <div class="entrada-links"><button type="button" class="btn-link" data-entrada="entrar">Voltar</button></div>`;
                break;
            case "novaSenha":
                html = `<h1 id="entradaTitulo">Nova senha</h1>${erro}
                    <form data-form="novaSenha" class="entrada-form">
                        ${campo("Nova senha (mínimo 8 caracteres)", "senha", "password", 'autocomplete="new-password" required minlength="8"')}
                        <button type="submit" class="btn btn-primario">Salvar senha</button>
                    </form>`;
                break;
            case "semEmpresa":
                html = `<h1 id="entradaTitulo">Aguardando liberação</h1>
                    <p class="entrada-texto">A conta <strong>${esc(usuario?.email)}</strong> ainda não está ligada a nenhuma empresa. Peça ao administrador da sua empresa para liberar este e-mail em <em>Usuários</em>.</p>
                    <div class="entrada-acoes">
                        <button type="button" class="btn" data-entrada="sair">Sair</button>
                        <button type="button" class="btn btn-primario" data-entrada="tentar">Já fui liberado</button>
                    </div>`;
                break;
            case "suspensa":
                html = `<h1 id="entradaTitulo">Acesso suspenso</h1>
                    <p class="entrada-texto">O acesso da sua empresa ao sistema está suspenso. Fale com o fornecedor.</p>
                    <div class="entrada-acoes">
                        <button type="button" class="btn" data-entrada="sair">Sair</button>
                        <button type="button" class="btn btn-primario" data-entrada="tentar">Tentar de novo</button>
                    </div>`;
                break;
            case "escolherEmpresa": {
                const lista = opcoes.lista || [];
                html = `<h1 id="entradaTitulo">Escolha a empresa</h1>${erro}
                    ${lista.length ? `<div class="entrada-lista">${lista.map(e => `
                        <button type="button" class="entrada-empresa" data-entrada="empresa" data-id="${esc(e.id)}">
                            <strong>${esc(e.nome)}</strong><span class="mono">${esc(e.codigo)}</span>${e.ativa ? "" : `<span class="pilula">suspensa</span>`}
                        </button>`).join("")}</div>` : `<p class="entrada-texto">Nenhuma empresa ainda. Crie a primeira (pode ser a sua, para testes e demonstração).</p>`}
                    <details class="entrada-nova" ${lista.length ? "" : "open"}>
                        <summary>Nova empresa</summary>
                        <form data-form="novaEmpresa" class="entrada-form">
                            ${campo("Nome", "nome", "text", 'required maxlength="80" placeholder="Metalúrgica Alfa"')}
                            ${campo("Código (vai nos tópicos MQTT)", "codigo", "text", 'required pattern="[a-z0-9][a-z0-9\\-]{1,23}" placeholder="alfa" maxlength="24"')}
                            ${campo("E-mail do administrador (opcional)", "email", "email", 'placeholder="ti@cliente.com"')}
                            <button type="submit" class="btn btn-primario">Criar empresa</button>
                        </form>
                    </details>
                    <div class="entrada-acoes"><button type="button" class="btn" data-entrada="sair">Sair</button></div>`;
                break;
            }
            case "erro":
                html = `<h1 id="entradaTitulo">Não foi possível abrir</h1>
                    <p class="entrada-erro" role="alert">${esc(opcoes.mensagem)}</p>
                    <p class="entrada-texto">Confira a internet e tente de novo.</p>
                    <div class="entrada-acoes"><button type="button" class="btn btn-primario" data-entrada="recarregar">Tentar de novo</button></div>${CONFIGURADA ? demo : ""}`;
                break;
        }
        conteudo.innerHTML = html;
        conteudo.dataset.painel = tipo;
        const primeiro = conteudo.querySelector("input:not([value]), input[value=''], input");
        if (primeiro && tipo !== "carregando") primeiro.focus();
    }

    function esperarPainel(tipo, opcoes) {
        mostrarPainel(tipo, opcoes);
        return new Promise(r => { resolverPainel = { tipo, r, opcoes }; });
    }

    function responder(valor) {
        const p = resolverPainel;
        resolverPainel = null;
        if (p) p.r(valor);
    }

    // Login: resolve com a sessão.
    function pedirLogin(opcoes) {
        return esperarPainel("entrar", opcoes);
    }

    function pedirNovaSenha() {
        return esperarPainel("novaSenha");
    }

    function ocupado(form, sim) {
        form.querySelectorAll("button, input").forEach(el => { el.disabled = sim; });
    }

    async function aoEnviar(form) {
        const v = Object.fromEntries(new FormData(form));
        const tipo = form.dataset.form;
        ocupado(form, true);
        try {
            if (tipo === "entrar") {
                const { data, error } = await cliente.auth.signInWithPassword({ email: v.email.trim(), password: v.senha });
                if (error) throw error;
                responder(data.session);
            } else if (tipo === "criar") {
                const { data, error } = await cliente.auth.signUp({
                    email: v.email.trim(), password: v.senha,
                    options: { data: { nome: v.nome.trim() }, emailRedirectTo: location.origin + location.pathname }
                });
                if (error) throw error;
                if (data.session) responder(data.session);
                else {
                    resolverPainel.tipo = "entrar";
                    mostrarPainel("entrar", { email: v.email.trim(), info: `Enviamos um e-mail para ${v.email.trim()}. Abra o link para confirmar a conta e depois entre aqui.` });
                }
            } else if (tipo === "esqueci") {
                const { error } = await cliente.auth.resetPasswordForEmail(v.email.trim(), { redirectTo: location.origin + location.pathname });
                if (error) throw error;
                mostrarPainel("esqueci", { info: `Se ${v.email.trim()} tiver conta, o link chega em alguns minutos.` });
            } else if (tipo === "novaSenha") {
                const { error } = await cliente.auth.updateUser({ password: v.senha });
                if (error) throw error;
                responder(true);
            } else if (tipo === "novaEmpresa") {
                const { data, error } = await cliente.rpc("criar_empresa", { p_nome: v.nome, p_codigo: v.codigo, p_email_admin: v.email || "" });
                if (error) throw error;
                const { data: e, error: e2 } = await cliente.from("empresas").select("*").eq("id", data).single();
                if (e2) throw e2;
                responder(e);
            }
        } catch (erro) {
            const painel = fundo.querySelector("#entradaConteudo").dataset.painel;
            mostrarPainel(painel, Object.assign({}, resolverPainel?.opcoes, { erro: traduzirErro(erro), email: v.email }));
        } finally {
            if (form.isConnected) ocupado(form, false);
        }
    }

    function aoClicar(acao, botao) {
        if (acao === "criar" || acao === "esqueci" || acao === "entrar") {
            if (resolverPainel) resolverPainel.tipo = acao;
            mostrarPainel(acao);
        } else if (acao === "sair" || acao === "tentar") {
            responder(acao);
        } else if (acao === "empresa") {
            const e = (resolverPainel?.opcoes?.lista || []).find(x => x.id === botao.dataset.id);
            if (e) responder(e);
        } else if (acao === "recarregar") {
            location.reload();
        }
    }

    function traduzirErro(erro) {
        const m = String(erro?.message || erro || "");
        if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
        if (/Email not confirmed/i.test(m)) return "Confirme o e-mail pelo link que enviamos antes de entrar.";
        if (/already registered|already been registered/i.test(m)) return "Este e-mail já tem conta. Use Entrar.";
        if (/Password should be at least|weak/i.test(m)) return "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.";
        if (/rate limit|too many/i.test(m)) return "Muitas tentativas agora. Espere alguns minutos e tente de novo.";
        if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sem conexão com o servidor.";
        if (/not valid JSON|Unexpected token/i.test(m)) return "O endereço do Supabase no config.js parece errado. Use a Project URL (https://xxxx.supabase.co).";
        if (/Invalid API key|No API key/i.test(m)) return "A chave no config.js não é deste projeto. Use a Publishable key (ou a anon key).";
        if (/row-level security|permission denied/i.test(m)) return "Sem permissão para isso.";
        if (/JWT expired/i.test(m)) return "Sua sessão expirou. Entre de novo.";
        return m || "Erro desconhecido.";
    }


    raiz.Nuvem = {
        iniciar, pronto,
        modo: () => modo,
        emNuvem: () => modo === "nuvem",
        pode, exigir, podePublicar, papel,
        nomePapel: p => PAPEIS[p] || p,
        PAPEIS,
        ajustarFrota, plantaDaNuvem, conexaoMqtt,
        salvarMissoes, salvarPlanta, salvarAgv, salvarRotina, removerAgv, terminarGravacoes,
        postos, salvarPosto, removerPosto, recarregarPostos,
        cliente: () => cliente,
        usuario: () => usuario,
        perfil: () => perfil,
        empresa: () => empresa,
        trocarEmpresa, sair,
        traduzirErro, avisoComAcao
    };
})(window);
