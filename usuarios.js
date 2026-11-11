/* ============================================================
   USUÁRIOS (e EMPRESAS, para o fornecedor)
   ============================================================
   Tela "Usuários": quem acessa a empresa, convites, papéis.
   O fornecedor também vê as empresas: cria, suspende e troca.
   Tudo passa pelas funções do banco (convidar, alterar_papel...),
   que conferem a permissão de novo do lado do servidor.
*/
const Usuarios = (() => {
    "use strict";

    const esc = t => ui.escapar(String(t ?? ""));
    const PAPEIS_EMPRESA = [["admin", "Administrador"], ["operador", "Operador"], ["visualizador", "Visualizador"], ["lider", "Líder"], ["posto", "Posto (tablet)"], ["manutencao", "Manutenção"]];
    const TEM_PIN = ["admin", "operador", "lider"];
    let comPin = new Set();
    let carregando = false;

    function conteudo() {
        return document.getElementById("usuariosConteudo");
    }

    async function abrir() {
        const el = conteudo();
        if (!el) return;
        if (!window.Nuvem || !Nuvem.emNuvem()) {
            el.innerHTML = `<section class="card"><p class="suave">Usuários e empresas existem quando o site está ligado à nuvem (config.js). Neste modo, tudo fica só neste navegador.</p></section>`;
            return;
        }
        if (!Nuvem.pode("administrar")) {
            el.innerHTML = `<section class="card"><p class="suave">Só o administrador da empresa gerencia os usuários.</p></section>`;
            return;
        }
        if (carregando) return;
        carregando = true;
        if (!el.innerHTML.trim()) el.innerHTML = `<section class="card"><p class="suave">Carregando…</p></section>`;
        try {
            const db = Nuvem.cliente();
            const empresa = Nuvem.empresa();
            const fornecedor = Nuvem.perfil().papel === "fornecedor";
            const nada = Promise.resolve({ data: null });
            const [perfis, convites, empresas, mqtts, mqttAgvs, agvsDb, alertasCfg, linksDemo] = await Promise.all([
                db.from("perfis").select("usuario_id, email, nome, papel, criado_em").eq("empresa_id", empresa.id).order("email"),
                db.from("convites").select("email, papel, criado_em").eq("empresa_id", empresa.id).order("email"),
                fornecedor ? db.from("empresas").select("*").order("nome") : nada,
                fornecedor ? db.from("mqtt_empresas").select("*") : nada,
                fornecedor ? db.from("mqtt_agvs").select("*").eq("empresa_id", empresa.id).order("agv_id") : nada,
                fornecedor ? db.from("agvs").select("id, nome").eq("empresa_id", empresa.id).order("id") : nada,
                db.from("alertas_config").select("*").eq("empresa_id", empresa.id).maybeSingle(),
                fornecedor ? db.from("links_demo").select("*").order("criado_em", { ascending: false }).limit(40) : nada
            ]);
            [perfis, convites, empresas].forEach(r => { if (r.error) throw r.error; });
            const pins = await db.rpc("usuarios_com_pin", { p_empresa: empresa.id });
            comPin = new Set(pins.error ? [] : (pins.data || []).map(x => typeof x === "string" ? x : x.usuarios_com_pin));
            // Banco sem a parte 2 (01_esquema.sql antigo): segue sem a seção de MQTT.
            const semTabelasMqtt = [mqtts, mqttAgvs].some(r => r.error);
            if (semTabelasMqtt) console.warn("Tabelas de MQTT ausentes: rode o 01_esquema.sql novo.", mqtts.error || mqttAgvs.error);
            // o que a pessoa já digitou nos formulários não se perde quando a lista recarrega
            const digitado = [...el.querySelectorAll("form[data-form-usuarios] input[name], form[data-form-usuarios] select[name]")]
                .filter(c => !c.disabled && c.type !== "password" && c.type !== "checkbox" && c.value)
                .map(c => ({ form: c.form.dataset.formUsuarios, nome: c.name, valor: c.value, foco: c === document.activeElement }));
            el.innerHTML = html(empresa, perfis.data, convites.data, empresas.data, fornecedor) +
                htmlAlertas(alertasCfg.error ? null : (alertasCfg.data || {})) +
                (fornecedor ? htmlLinksDemo(linksDemo.error ? null : (linksDemo.data || [])) : "") +
                (fornecedor ? htmlMqtt(empresa, semTabelasMqtt ? null : mqtts.data, semTabelasMqtt ? null : mqttAgvs.data, agvsDb.data || []) : "");
            digitado.forEach(d => {
                const c = el.querySelector(`form[data-form-usuarios="${CSS.escape(d.form)}"] [name="${CSS.escape(d.nome)}"]`);
                if (!c) return;
                c.value = d.valor;
                if (d.foco) c.focus();
            });
        } catch (erro) {
            el.innerHTML = `<section class="card"><p class="entrada-erro">Não foi possível carregar: ${esc(Nuvem.traduzirErro(erro))}</p><button type="button" class="btn" data-usuarios="recarregar">Tentar de novo</button></section>`;
        } finally {
            carregando = false;
        }
    }

    function selectPapel(valor, extra = "") {
        return `<select ${extra}>${PAPEIS_EMPRESA.map(([v, r]) => `<option value="${v}" ${v === valor ? "selected" : ""}>${r}</option>`).join("")}</select>`;
    }

    function html(empresa, perfis, convites, empresas, fornecedor) {
        const eu = Nuvem.usuario().id;
        const linhas = perfis.map(u => `
            <tr>
                <td><strong>${esc(u.nome || "—")}</strong><div class="suave mono">${esc(u.email)}</div></td>
                <td>${u.usuario_id === eu
                    ? `<span class="pilula">${esc(Nuvem.nomePapel(u.papel))} · você</span>`
                    : selectPapel(u.papel, `data-papel="${esc(u.usuario_id)}" aria-label="Papel de ${esc(u.email)}"`)}</td>
                <td>${TEM_PIN.includes(u.papel)
                    ? `<button type="button" class="btn btn-mini" data-pin-usuario="${esc(u.usuario_id)}" data-email="${esc(u.email)}">${comPin.has(u.usuario_id) ? "Trocar PIN" : "Definir PIN"}</button>${comPin.has(u.usuario_id) ? "" : `<div class="suave">sem PIN</div>`}`
                    : u.papel === "posto" ? `<span class="suave">vincule em Operação › Postos</span>` : ""}</td>
                <td class="usuarios-acao">${u.usuario_id === eu ? "" : `<button type="button" class="btn btn-mini btn-perigo" data-remover="${esc(u.usuario_id)}" data-email="${esc(u.email)}">Remover</button>`}</td>
            </tr>`).join("");
        const pendentes = convites.map(c => `
            <tr class="usuarios-pendente">
                <td><span class="pilula ambar">convite pendente</span><div class="suave mono">${esc(c.email)}</div></td>
                <td>${esc(Nuvem.nomePapel(c.papel))}</td><td></td>
                <td class="usuarios-acao"><button type="button" class="btn btn-mini" data-cancelar="${esc(c.email)}">Cancelar</button></td>
            </tr>`).join("");
        const link = location.origin + location.pathname;

        return `
        <div class="usuarios-grade">
            <section class="card card-sem-padding">
                <div class="card-barra"><div><h2>Usuários · ${esc(empresa.nome)}</h2><div class="card-sub">${perfis.length} com acesso${convites.length ? ` · ${convites.length} convite(s) pendente(s)` : ""}</div></div></div>
                <div class="tabela-rolagem">
                    <table class="tabela-usuarios">
                        <thead><tr><th>Pessoa</th><th>Papel</th><th>PIN de urgente</th><th></th></tr></thead>
                        <tbody>${linhas}${pendentes}</tbody>
                    </table>
                </div>
            </section>

            <div class="usuarios-lateral">
                <section class="card">
                    <h2>Liberar acesso</h2>
                    <form class="usuarios-form" data-form-usuarios="convidar">
                        <label class="campo"><span>E-mail da pessoa</span><input name="email" type="email" required placeholder="nome@empresa.com"></label>
                        <label class="campo"><span>Papel</span>${selectPapel("operador", 'name="papel"')}</label>
                        <button type="submit" class="btn btn-primario">Liberar</button>
                    </form>
                    <p class="suave usuarios-dica">A pessoa cria a conta em <span class="mono">${esc(link)}</span> com este e-mail e já entra na ${esc(empresa.nome)}. Se ela já tiver conta, o acesso vale na hora.</p>
                </section>
                <section class="card">
                    <h2>O que cada papel faz</h2>
                    <table class="tabela-papeis">
                        <thead><tr><th></th><th>Admin.</th><th>Oper.</th><th>Manut.</th><th>Líder</th><th>Visual.</th><th>Posto</th></tr></thead>
                        <tbody>
                            <tr><td>Ver frota, mapa, sensores, histórico, indicadores</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>—</td></tr>
                            <tr><td>Comandar AGVs e rodar missões</td><td>✓</td><td>✓</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
                            <tr><td>Criar e editar missões</td><td>✓</td><td>✓</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
                            <tr><td>Pedir missões</td><td>✓</td><td>✓</td><td>—</td><td>—</td><td>—</td><td>só o seu posto</td></tr>
                            <tr><td>Marcar pedido urgente</td><td>✓</td><td>✓</td><td>—</td><td>✓</td><td>—</td><td>com PIN</td></tr>
                            <tr><td>Pôr e tirar da manutenção</td><td>✓</td><td>✓</td><td>✓</td><td>—</td><td>—</td><td>—</td></tr>
                            <tr><td>Manual, calibração, configuração, autoteste, cópias</td><td>✓</td><td>manual</td><td>✓</td><td>—</td><td>—</td><td>—</td></tr>
                            <tr><td>Documentação dos modelos</td><td>✓</td><td>—</td><td>✓</td><td>—</td><td>—</td><td>—</td></tr>
                            <tr><td>Planta, AGVs, postos, firmware</td><td>✓</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
                            <tr><td>Usuários e alertas</td><td>✓</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
                        </tbody>
                    </table>
                    <p class="suave usuarios-dica">Parar o AGV (STOP) é permitido para todos. O papel Posto é o tablet de um posto: só vê a tela do posto. O papel Manutenção não vê planta, missões, despacho, postos nem usuários. No tablet, “urgente” pede o PIN de um líder, operador ou administrador.</p>
                </section>
            </div>

            ${fornecedor ? htmlEmpresas(empresas, empresa) : ""}
        </div>`;
    }

    // Alertas por e-mail (0.14): o banco confere a cada minuto (03_alertas.sql)
    function htmlAlertas(cfg) {
        if (!cfg) {
            return `<section class="card usuarios-alertas"><h2>Alertas por e-mail</h2><p class="suave">Rode o <span class="mono">01_esquema.sql</span> da versão 0.14 no Supabase para ligar os alertas.</p></section>`;
        }
        return `
            <section class="card usuarios-alertas">
                <h2>Alertas por e-mail</h2>
                <p class="suave usuarios-dica">Um e-mail quando algo acontece e outro quando se resolve: AGV em emergência ou falha por mais de 2 min, sem sinal por mais de 3 min dentro do turno, pedido esperando demais e nenhuma tela despachando há 5 min. AGVs em manutenção não geram alerta. Precisa do <span class="mono">03_alertas.sql</span> rodado no Supabase.</p>
                <form class="usuarios-form" data-form-usuarios="alertas">
                    <label class="config-chave"><input type="checkbox" name="ativo" value="1" ${cfg.ativo ? "checked" : ""}><span>Mandar alertas</span></label>
                    <label class="campo"><span>E-mails (até 5, separados por vírgula)</span><input name="emails" value="${esc((cfg.emails || []).join(", "))}" placeholder="manutencao@empresa.com"></label>
                    <label class="campo"><span>Avisar quando um pedido esperar mais de (min)</span><input name="espera" type="number" min="2" max="240" value="${esc(cfg.pedido_espera_min || 10)}"></label>
                    <button type="submit" class="btn btn-primario">Salvar alertas</button>
                </form>
                <p class="suave usuarios-dica">Sem domínio próprio no Resend, os e-mails só chegam ao endereço da conta do Resend.</p>
            </section>`;
    }

    /* ---------------- links de demonstração (só fornecedor, 0.15) ---------------- */

    const linkDemo = codigo => `${location.origin}${location.pathname}?demo=${encodeURIComponent(codigo)}`;
    function htmlLinksDemo(links) {
        if (!links) return `<section class="card usuarios-demo"><h2>Links de demonstração</h2><p class="suave">Rode o <span class="mono">01_esquema.sql</span> da versão 0.15 no Supabase.</p></section>`;
        const data = v => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const situacao = l => l.cancelado ? `<span class="pilula">cancelado</span>` : Date.parse(l.expira_em) < Date.now() ? `<span class="pilula">expirou</span>` : `<span class="pilula verde">vale até ${esc(data(l.expira_em))}</span>`;
        return `
            <section class="card card-sem-padding usuarios-demo">
                <div class="card-barra"><div><h2>Links de demonstração</h2><div class="card-sub">Quem abre o link vê o Eciton com a planta e os dados de exemplo, sem conta e sem nada da sua empresa. O link para de funcionar no prazo ou quando você cancela.</div></div></div>
                <form class="usuarios-form usuarios-form-linha" data-form-usuarios="demo">
                    <label class="campo"><span>Para quem</span><input name="para" maxlength="80" required placeholder="Metalúrgica Beta · Carlos"></label>
                    <label class="campo"><span>Vale por (dias)</span><input name="dias" type="number" min="1" max="60" value="7" required></label>
                    <button type="submit" class="btn btn-primario">Criar link</button>
                </form>
                ${links.length ? `<div class="tabela-rolagem"><table class="tabela-usuarios">
                    <thead><tr><th>Para quem</th><th>Criado</th><th>Situação</th><th>Usos</th><th></th></tr></thead>
                    <tbody>${links.map(l => {
                        const vale = !l.cancelado && Date.parse(l.expira_em) > Date.now();
                        return `<tr>
                            <td><strong>${esc(l.para || "—")}</strong></td>
                            <td>${esc(data(l.criado_em))}</td>
                            <td>${situacao(l)}</td>
                            <td>${esc(l.usos)}${l.ultimo_uso ? `<br><small class="suave">último ${esc(data(l.ultimo_uso))}</small>` : ""}</td>
                            <td class="usuarios-acao">${vale ? `<button type="button" class="btn btn-mini" data-demo-copiar="${esc(l.codigo)}">Copiar link</button>
                                <button type="button" class="btn btn-mini btn-perigo" data-demo-cancelar="${esc(l.codigo)}" data-para="${esc(l.para)}">Cancelar</button>` : ""}</td>
                        </tr>`;
                    }).join("")}</tbody></table></div>` : `<p class="suave usuarios-dica">Nenhum link ainda.</p>`}
            </section>`;
    }
    async function copiarLinkDemo(codigo) {
        const url = linkDemo(codigo);
        try { await navigator.clipboard.writeText(url); ui.aviso("Link copiado. Mande para a pessoa.", "sucesso"); }
        catch (e) { await ui.confirmar({ titulo: "Link de demonstração", texto: url, confirmar: "OK" }); }
    }

    function htmlEmpresas(empresas, atual) {
        return `
            <section class="card card-sem-padding usuarios-empresas">
                <div class="card-barra"><div><h2>Empresas</h2><div class="card-sub">Só você (fornecedor) vê esta parte</div></div></div>
                <div class="tabela-rolagem">
                    <table class="tabela-usuarios">
                        <thead><tr><th>Empresa</th><th>Código</th><th>Situação</th><th></th></tr></thead>
                        <tbody>${empresas.map(e => `
                            <tr>
                                <td><strong>${esc(e.nome)}</strong>${e.id === atual.id ? ` <span class="pilula verde">aberta</span>` : ""}</td>
                                <td class="mono">${esc(e.codigo)}</td>
                                <td>${e.ativa ? `<span class="pilula verde">ativa</span>` : `<span class="pilula vermelho">suspensa</span>`}</td>
                                <td class="usuarios-acao">
                                    ${e.id === atual.id ? "" : `<button type="button" class="btn btn-mini" data-abrir-empresa="${esc(e.id)}">Abrir</button>`}
                                    <button type="button" class="btn btn-mini ${e.ativa ? "btn-perigo" : ""}" data-ativa="${esc(e.id)}" data-valor="${e.ativa ? "0" : "1"}" data-nome="${esc(e.nome)}">${e.ativa ? "Suspender" : "Reativar"}</button>
                                </td>
                            </tr>`).join("")}</tbody>
                    </table>
                </div>
                <form class="usuarios-form usuarios-form-linha" data-form-usuarios="empresa">
                    <label class="campo"><span>Nova empresa</span><input name="nome" required maxlength="80" placeholder="Metalúrgica Alfa"></label>
                    <label class="campo"><span>Código (tópicos MQTT)</span><input name="codigo" required maxlength="24" pattern="[a-z0-9][a-z0-9\\-]{1,23}" placeholder="alfa"></label>
                    <label class="campo"><span>E-mail do administrador</span><input name="email" type="email" placeholder="ti@cliente.com"></label>
                    <button type="submit" class="btn btn-primario">Criar</button>
                </form>
            </section>`;
    }

    /* ---------------- MQTT da empresa (só fornecedor) ---------------- */

    function senhaAleatoria() {
        const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
        const v = new Uint32Array(20);
        crypto.getRandomValues(v);
        return Array.from(v, n => letras[n % letras.length]).join("");
    }

    function htmlMqtt(empresa, mqtts, mqttAgvs, agvsDb) {
        if (mqtts === null) {
            return `<section class="card usuarios-mqtt"><h2>MQTT da empresa</h2>
                <p class="entrada-erro">O banco ainda não tem as tabelas da parte 2. Rode de novo o <span class="mono">backend/supabase/01_esquema.sql</span> inteiro no SQL Editor do Supabase e recarregue a página.</p></section>`;
        }
        const c = empresa.codigo;
        const atual = mqtts.find(m => m.empresa_id === empresa.id) || null;
        const urlPadrao = atual?.url || mqtts.find(m => m.url)?.url || "";
        // Um usuario para todos os AGVs da empresa (guardado como agv_id "TODOS"):
        // com o trafego, cada AGV le o estado dos outros da mesma empresa.
        const m = mqttAgvs.find(x => x.agv_id === "TODOS") || null;
        // endereço do broker para o firmware: wss://HOST:8084/mqtt -> HOST (o AGV usa a porta 8883)
        const hostBroker = (() => { try { return new URL(urlPadrao).hostname; } catch (e) { return ""; } })() || "SALVE-O-ENDERECO-NO-PASSO-1";
        const linhasAgv = !m ? "" : agvsDb.map(a => `<tr class="usuarios-mqtt-ficha"><td>
                <details>
                    <summary>Linhas do firmware do AGV <strong class="mono">${esc(a.id)}</strong> <span class="suave">${esc(a.nome)}</span></summary>
                    <pre class="usuarios-codigo" data-copiar>#define EMPRESA "${esc(c)}"
#define AGV_ID "${esc(a.id)}"
#define MQTT_HOST_PADRAO "${esc(hostBroker)}"
#define MQTT_USUARIO_PADRAO "${esc(m.usuario)}"
#define MQTT_SENHA_PADRAO "${esc(m.senha)}"</pre>
                    <button type="button" class="btn btn-mini" data-copiar-anterior>Copiar linhas</button>
                </details>
            </td></tr>`).join("");
        return `
        <section class="card usuarios-mqtt">
            <div class="usuarios-mqtt-topo">
                <div><h2>MQTT · ${esc(empresa.nome)}</h2><div class="card-sub">Só você (fornecedor) vê. Tópicos desta empresa: <code>agv/${esc(c)}/&lt;AGV&gt;/…</code></div></div>
                ${atual ? `<span class="pilula verde">configurado</span>` : `<span class="pilula ambar">não configurado</span>`}
            </div>

            <h3>1. Usuário do site (painel)</h3>
            <p class="suave usuarios-dica">Todas as telas abertas da ${esc(empresa.nome)} usam este usuário. No console do EMQX, abra o deployment › <em>Access Control</em>:</p>
            <ol class="usuarios-passos">
                <li><em>Authentication</em> › <em>Add</em>: Username <code>${esc(atual?.usuario || c + "-site")}</code> e a senha abaixo.</li>
                <li><em>Authorization</em> › <em>Username</em> › <em>Add</em>: o mesmo usuário, Topic <code>agv/${esc(c)}/#</code>, Action <em>Publish &amp; Subscribe</em>, Permission <em>Allow</em>.</li>
                <li>Uma vez só (vale para todas as empresas): <em>Authorization</em> › <em>All Users</em> › <em>Add</em>: Topic <code>#</code>, <em>Publish &amp; Subscribe</em>, <em>Deny</em>. Assim quem não tem regra não vê nada.</li>
                <li>Salve aqui com o endereço <code>wss://SEU-ENDERECO:8084/mqtt</code> (está em <em>Overview › Connection Information</em>). No EMQX vale na hora.</li>
            </ol>
            <form class="usuarios-form usuarios-form-mqtt" data-form-usuarios="mqtt">
                <label class="campo usuarios-campo-largo"><span>Endereço (WebSocket)</span><input name="url" required placeholder="wss://SEU-ENDERECO.emqxsl.com:8084/mqtt" value="${esc(urlPadrao)}" spellcheck="false"></label>
                <label class="campo"><span>Usuário</span><input name="usuario" required value="${esc(atual?.usuario || c + "-site")}" spellcheck="false"></label>
                <label class="campo"><span>Senha</span><span class="usuarios-senha"><input name="senha" required class="mono" value="${esc(atual?.senha || "")}" spellcheck="false" autocomplete="off"><button type="button" class="btn btn-mini" data-gerar-senha>Gerar</button></span></label>
                <details class="usuarios-campo-largo">
                    <summary>Usuário só de leitura para visualizadores (opcional)</summary>
                    <p class="suave usuarios-dica">Para os visualizadores só lerem, direto no broker: no EMQX, crie o usuário em <em>Authentication</em> e uma regra em <em>Authorization › Username</em> com Topic <code>agv/${esc(c)}/#</code>, Action <em>Subscribe</em>, <em>Allow</em>. Em branco, eles usam o usuário acima (o site continua bloqueando os comandos deles).</p>
                    <div class="usuarios-form-linha-simples">
                        <label class="campo"><span>Usuário de leitura</span><input name="leitura_usuario" value="${esc(atual?.leitura_usuario || "")}" spellcheck="false"></label>
                        <label class="campo"><span>Senha de leitura</span><input name="leitura_senha" class="mono" value="${esc(atual?.leitura_senha || "")}" spellcheck="false" autocomplete="off"></label>
                    </div>
                </details>
                <div class="usuarios-campo-largo"><button type="submit" class="btn btn-primario">Salvar MQTT da empresa</button></div>
            </form>

            <h3>2. Usuário dos AGVs (um para todos da empresa)</h3>
            <p class="suave usuarios-dica">Com o controle de tráfego, cada AGV lê o estado dos outros AGVs da mesma empresa, então o usuário dos AGVs enxerga <code>agv/${esc(c)}/#</code>. Outras empresas continuam separadas.</p>
            ${m ? `
            <ol class="usuarios-passos">
                <li>EMQX › <em>Access Control</em> › <em>Authentication</em> › <em>Add</em>: Username <code>${esc(m.usuario)}</code>, Password <code>${esc(m.senha)}</code>.</li>
                <li><em>Authorization</em> › <em>Username</em> › <em>Add</em>: Username <code>${esc(m.usuario)}</code>, Topic <code>agv/${esc(c)}/#</code>, <em>Publish &amp; Subscribe</em>, <em>Allow</em>.</li>
                <li>Em cada AGV, troque as 5 linhas do bloco <em>LINHAS DO SITE</em> (seção 2 do <span class="mono">AGV_FROTA.ino</span>) pelas dele, abaixo, e grave. Só o <code>AGV_ID</code> muda de um para outro. O AGV usa o mesmo endereço do site, na porta 8883, com o certificado do EMQX já no firmware.</li>
            </ol>
            ${agvsDb.length ? `<div class="tabela-rolagem"><table class="tabela-usuarios"><tbody>${linhasAgv}</tbody></table></div>` : `<p class="suave">Nenhum AGV cadastrado na frota desta empresa: cadastre na Frota para ver as linhas de cada um.</p>`}
            <div><button type="button" class="btn btn-mini" data-mqtt-agvs="1">Gerar outra senha</button></div>`
            : `<p class="suave usuarios-dica">Ainda não gerado.</p><div><button type="button" class="btn btn-primario" data-mqtt-agvs="0">Gerar usuário dos AGVs</button></div>`}
        </section>`;
    }

    async function executar(promessa, sucesso) {
        try {
            const { data, error } = await promessa;
            if (error) throw error;
            if (sucesso) ui.aviso(typeof sucesso === "function" ? sucesso(data) : sucesso, "sucesso");
            return true;
        } catch (erro) {
            ui.aviso(Nuvem.traduzirErro(erro), "erro");
            return false;
        } finally {
            abrir();
        }
    }

    document.addEventListener("submit", async evento => {
        const form = evento.target.closest("[data-form-usuarios]");
        if (!form) return;
        evento.preventDefault();
        const v = Object.fromEntries(new FormData(form));
        const db = Nuvem.cliente();
        form.querySelectorAll("button, input, select").forEach(c => { c.disabled = true; });
        if (form.dataset.formUsuarios === "convidar") {
            await executar(db.rpc("convidar", { p_email: v.email, p_papel: v.papel, p_empresa: Nuvem.empresa().id }),
                r => r === "convidado" ? `Acesso liberado para ${v.email}. Ela entra ao criar a conta.` : `${v.email} já tinha conta: acesso liberado agora.`);
        } else if (form.dataset.formUsuarios === "mqtt") {
            const url = v.url.trim();
            if (!/^wss?:\/\/[^/]+/i.test(url)) {
                ui.aviso("O endereço precisa começar com wss:// (ex.: wss://seu-endereco.emqxsl.com:8084/mqtt).", "erro");
                abrir();
                return;
            }
            const ok = await executar(db.from("mqtt_empresas").upsert({
                empresa_id: Nuvem.empresa().id, url, usuario: v.usuario.trim(), senha: v.senha,
                leitura_usuario: (v.leitura_usuario || "").trim() || null, leitura_senha: v.leitura_senha || null
            }), null);
            if (ok) Nuvem.avisoComAcao("MQTT da empresa salvo. Atualize a página para o site conectar com ele.", "Atualizar", () => location.reload());
        } else if (form.dataset.formUsuarios === "alertas") {
            const emails = String(v.emails || "").split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
            await executar(db.rpc("salvar_alertas_config", { p_empresa: Nuvem.empresa().id, p_ativo: v.ativo === "1", p_emails: emails, p_espera: Number(v.espera) || 10 }),
                v.ativo === "1" ? "Alertas ligados." : "Alertas salvos (desligados).");
        } else if (form.dataset.formUsuarios === "demo") {
            const { data, error } = await db.rpc("criar_link_demo", { p_para: v.para, p_dias: Number(v.dias) || 7 });
            if (error) { ui.aviso(Nuvem.traduzirErro(error), "erro"); abrir(); return; }
            await abrir();
            await copiarLinkDemo(data.codigo);
        } else if (form.dataset.formUsuarios === "empresa") {
            await executar(db.rpc("criar_empresa", { p_nome: v.nome, p_codigo: v.codigo, p_email_admin: v.email || "" }),
                `Empresa ${v.nome} criada.${v.email ? ` ${v.email} entra como administrador.` : ""}`);
        }
    });

    document.addEventListener("change", evento => {
        const select = evento.target.closest("[data-papel]");
        if (!select || !conteudo()?.contains(select)) return;
        executar(Nuvem.cliente().rpc("alterar_papel", { p_usuario: select.dataset.papel, p_papel: select.value }), "Papel alterado.");
    });

    document.addEventListener("click", async evento => {
        const el = conteudo();
        const alvo = evento.target.closest("button");
        if (alvo?.dataset.demoCopiar) { copiarLinkDemo(alvo.dataset.demoCopiar); return; }
        if (alvo?.dataset.demoCancelar) {
            if (!await ui.confirmar({ titulo: "Cancelar link", texto: `O link de ${alvo.dataset.para || "demonstração"} para de funcionar agora, inclusive para quem está com ele aberto.`, confirmar: "Cancelar link", perigo: true })) return;
            executar(Nuvem.cliente().rpc("cancelar_link_demo", { p_codigo: alvo.dataset.demoCancelar }), "Link cancelado.");
            return;
        }
        if (!alvo || !el || !el.contains(alvo)) return;
        const db = Nuvem.cliente();
        if (alvo.dataset.usuarios === "recarregar") abrir();
        else if (alvo.dataset.pinUsuario) {
            const pin = await pedirPin(alvo.dataset.email);
            if (pin) executar(db.rpc("definir_pin", { p_usuario: alvo.dataset.pinUsuario, p_pin: pin }), `PIN de ${alvo.dataset.email} definido.`);
        } else if (alvo.dataset.remover) {
            if (!(await ui.confirmar({ titulo: "Remover o acesso?", texto: `${alvo.dataset.email} deixa de acessar a ${Nuvem.empresa().nome}. A conta continua existindo e pode ser liberada de novo.`, confirmar: "Remover", perigo: true }))) return;
            executar(db.rpc("remover_da_empresa", { p_usuario: alvo.dataset.remover }), "Acesso removido.");
        } else if (alvo.dataset.cancelar) {
            executar(db.rpc("cancelar_convite", { p_email: alvo.dataset.cancelar }), "Convite cancelado.");
        } else if (alvo.dataset.gerarSenha !== undefined) {
            const campo = alvo.closest(".usuarios-senha")?.querySelector("input");
            if (campo) campo.value = senhaAleatoria();
        } else if (alvo.dataset.mqttAgvs !== undefined) {
            if (alvo.dataset.mqttAgvs === "1" && !(await ui.confirmar({ titulo: "Gerar outra senha para os AGVs?", texto: "Troque a senha também no EMQX (Authentication › editar) e grave todos os AGVs desta empresa com as linhas novas. Até lá eles não conectam.", confirmar: "Gerar" }))) return;
            const codigo = Nuvem.empresa().codigo;
            executar(db.from("mqtt_agvs").upsert({ empresa_id: Nuvem.empresa().id, agv_id: "TODOS", usuario: `${codigo}-agvs`, senha: senhaAleatoria() }),
                "Usuário dos AGVs gerado. Siga os passos logo abaixo.");
        } else if (alvo.dataset.copiarAnterior !== undefined) {
            const texto = alvo.previousElementSibling?.textContent || "";
            navigator.clipboard?.writeText(texto).then(() => ui.aviso("Linhas copiadas.", "sucesso"), () => ui.aviso("Selecione o texto e copie com Ctrl+C.", "info"));
        } else if (alvo.dataset.abrirEmpresa) {
            Nuvem.trocarEmpresa(alvo.dataset.abrirEmpresa);
        } else if (alvo.dataset.ativa) {
            const ativar = alvo.dataset.valor === "1";
            if (!ativar && !(await ui.confirmar({ titulo: `Suspender ${alvo.dataset.nome}?`, texto: "Os usuários dessa empresa perdem o acesso até você reativar. Nada é apagado.", confirmar: "Suspender", perigo: true }))) return;
            executar(db.from("empresas").update({ ativa: ativar }).eq("id", alvo.dataset.ativa), ativar ? "Empresa reativada." : "Empresa suspensa.");
        }
    });

    // Pede um PIN novo (duas vezes). Devolve o PIN ou null.
    async function pedirPin(quem) {
        const pin = await ui.perguntar({ titulo: `PIN de ${quem}`, texto: "4 a 8 números. Usado para autorizar pedido urgente no tablet do posto.", tipo: "password", inputmode: "numeric" });
        if (pin == null) return null;
        if (!/^[0-9]{4,8}$/.test(pin)) { ui.aviso("O PIN tem de 4 a 8 números.", "aviso"); return null; }
        const de_novo = await ui.perguntar({ titulo: "Repita o PIN", tipo: "password", inputmode: "numeric" });
        if (de_novo == null) return null;
        if (de_novo !== pin) { ui.aviso("Os dois PINs não batem.", "aviso"); return null; }
        return pin;
    }

    return { abrir, pedirPin };
})();
