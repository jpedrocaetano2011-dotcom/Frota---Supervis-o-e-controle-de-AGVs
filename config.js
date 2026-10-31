/* ============================================================
   CONFIGURAÇÃO DA NUVEM (Supabase)
   ============================================================
   Vazio: o site funciona sem login e guarda tudo neste navegador
   (bom para testar e para demonstração).

   Preenchido: login, empresas e dados no banco. Pegue os dois valores
   no painel do Supabase › Project Settings › API (ou "Connect"):
     url   = Project URL          (https://xxxx.supabase.co)
     chave = anon / publishable key (pode ficar no site: é pública;
             quem protege os dados são as regras do banco)
   NUNCA coloque aqui a service_role / secret key.
*/
window.CONFIG_NUVEM = {
    url: "https://bxdlgchbqfxwisasolyx.supabase.co",
    chave: "sb_publishable_LW6lbl_ecxl-zzMuU72VBg_P1Y41sFN"
};
