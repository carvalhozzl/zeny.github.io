# Zeny — assistente pessoal com IA

Você fala (ou escreve) e o Zeny entende, organiza e lembra:

- **Finanças**: entradas e saídas, contas pessoal e da empresa, categorias automáticas, metas de economia e assinaturas recorrentes.
- **Hábitos**: marcação diária, sequência (🔥) e calendário do mês.
- **Tarefas**: prioridade, prazo e horário, com aviso das tarefas do dia ao abrir o app.
- **Voz**: toque no 🎤 e fale em português. O Zeny também pode responder em voz alta.

## Estrutura

| Pasta | O que é |
|---|---|
| `web/` | O app (HTML, CSS e JS, sem build). É publicado no GitHub Pages e embutido no app Android. |
| `server/` | Servidor da IA (Cloudflare Worker). Guarda a chave da API do Claude em segredo. |
| `assets/` | Ícone e tela de abertura do app Android. |
| `scripts/` | Ajustes do projeto Android e configuração da URL do servidor. |
| `.github/workflows/` | Publicação automática do site, do servidor e do app Android. |

## Como funciona a IA

```
App (site ou Android) ──► Servidor Zeny (Cloudflare) ──► API do Claude
                          guarda a chave em segredo
```

O app nunca vê a chave. O servidor só aceita pedidos do site e do app Android, limita a 20 mensagens por minuto por pessoa e usa um prompt fixo do Zeny. Por isso ninguém consegue usar a sua chave para outra coisa.

Sem servidor configurado, o Zeny funciona no **modo local**. Ele entende comandos comuns em português direto no aparelho, sem internet e sem custo.

---

## Passo a passo

### 1. Site no GitHub Pages

1. No repositório, abra **Settings → Pages** e, em *Source*, escolha **GitHub Actions**.
2. Faça qualquer envio para a branch `main` (ou rode o workflow *Publicar site* em **Actions**).
3. O site fica em `https://carvalhozzl.github.io/zeny/`.

### 2. Servidor da IA (Cloudflare, plano gratuito)

1. Crie uma conta em [cloudflare.com](https://dash.cloudflare.com/sign-up) e uma chave da API em [console.anthropic.com](https://console.anthropic.com/).
2. No Cloudflare, crie um **API Token** com o modelo *Edit Cloudflare Workers* e copie também o seu **Account ID**.
3. No GitHub, abra **Settings → Secrets and variables → Actions**:
   - Em **Secrets**, adicione `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e `ANTHROPIC_API_KEY`.
   - Em **Variables**, adicione `DEPLOY_SERVER` = `true`.
4. Rode o workflow *Publicar servidor da IA* em **Actions**. No fim, o log mostra a URL, algo como `https://zeny-server.SEU-USUARIO.workers.dev`.
5. Em **Variables**, adicione `ZENY_SERVER_URL` com essa URL e rode de novo *Publicar site* e *App Android*.

Para publicar pelo computador, sem o GitHub Actions:

```bash
cd server
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Para mudar o modelo ou o limite de mensagens, edite `server/wrangler.toml`.

### 3. App Android

Cada envio para a `main` gera o app automaticamente em **Actions → App Android**:

- **`zeny-debug-apk`**: um APK para instalar direto no celular e testar.
- **`zeny-play-store-aab`**: o pacote para a Play Store. Ele só é gerado depois do passo abaixo.

#### Assinatura para a Play Store

1. Crie a chave de assinatura (uma vez só). **Guarde o arquivo e as senhas: sem eles você não consegue atualizar o app na loja.**
   ```bash
   keytool -genkey -v -keystore zeny.jks -alias zeny -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 zeny.jks > zeny.jks.base64
   ```
2. Em **Secrets**, adicione:
   - `ANDROID_KEYSTORE_BASE64`: o conteúdo de `zeny.jks.base64`
   - `ANDROID_KEYSTORE_PASSWORD`: a senha do keystore
   - `ANDROID_KEY_ALIAS`: `zeny`
   - `ANDROID_KEY_PASSWORD`: a senha da chave
3. Rode *App Android* e baixe o `zeny-play-store-aab`.

#### Publicar na Play Store

1. Crie uma conta de desenvolvedor no [Google Play Console](https://play.google.com/console) (taxa única de US$ 25).
2. Crie o app **Zeny** e envie o `.aab` em *Testes internos* primeiro, depois em *Produção*.
3. Preencha a ficha da loja (descrição, capturas de tela e o ícone `assets/icon-only.png`), a classificação de conteúdo e a **Política de privacidade**. O app usa o microfone e envia as mensagens ao servidor da IA.

#### Rodar o Android no computador

Precisa do Node 22, do Java 21 e do Android Studio.

```bash
npm install
npm run android:init    # cria a pasta android/
npm run android:open    # abre no Android Studio
```

## Desenvolvimento

```bash
npm run dev             # abre o app em http://localhost:8080
cd server && npm run dev  # servidor da IA local
```

Todos os dados do usuário ficam no aparelho (`localStorage`). Em Ajustes dá para exportar e importar backup.
