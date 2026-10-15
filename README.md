# Food System

## Edição local para Windows

Esta edição será distribuída como um aplicativo instalável para um computador da empresa. O sistema funcionará localmente, sem exigir login, internet, Firebase, Supabase ou assinatura online. O backend Rails continuará sendo executado localmente e o banco será instalado/configurado na própria máquina.

### Arquitetura planejada

- Aplicativo desktop Tauri, empacotado como instalador Windows.
- Frontend HTML/CSS/JavaScript atual, reaproveitado e adaptado para o desktop.
- Backend Node.js local, substituindo gradualmente o backend Rails.
- Banco MySQL local, instalado/configurado pelo instalador.
- Acesso opcional pela rede local para celulares e QR Codes.
- Backup automático, restauração e atualização remota via AnyDesk.
- Compatibilidade prioritária com Windows 10/11; Windows 7/8.1 dependerá de testes com versões congeladas das dependências.

### Estrutura de transição

```text
food-system/
├── frontend/       # interface atual, que será adaptada para o Tauri
├── backend/        # Rails legado, mantido durante a migração
├── backend-node/   # nova API Node.js
├── desktop/        # futuro aplicativo Tauri
└── installer/      # futuro instalador Windows
```

### Escopo da primeira etapa

1. Retirar do fluxo local a dependência de Supabase, Firebase/Google e pagamentos/planos online.
2. Criar o modo local sem login obrigatório.
3. Fazer a entrada do frontend abrir diretamente o painel.
4. Criar o backend Node.js com API local e MySQL.
5. Migrar gradualmente as rotas e regras do Rails.
6. Criar o aplicativo Tauri e o instalador Windows.

O backend Rails será mantido até a API Node.js cobrir as funcionalidades necessárias. Depois: criar o instalador, registrar o backend como serviço, configurar rede local, backups e atualizações.

Sistema web para restaurantes, lanchonetes e operacoes de alimentacao criarem um cardapio digital por QR Code, receberem pedidos por mesa e acompanharem a operacao pelo painel.

O foco atual do projeto e sair de MVP para uma base SaaS mais segura:

- login e cadastro do restaurante;
- cadastro de categorias e produtos;
- configuracao do cardapio exibido no QR;
- geracao de QR Code por mesa com token publico seguro;
- pagina publica para o cliente fazer o pedido;
- painel de pedidos;
- controle basico de caixa;
- planos, assinatura e webhook de pagamento;
- controle de equipe por papeis.

## Estrutura
------
```text
food-system/
├── frontend/
│   ├── index.html
│   ├── entry/
│   ├── pages/
│   ├── shared/
│   └── styles/
└── backend/
    ├── app/
    ├── config/
    ├── db/
    ├── test/
    └── Gemfile
```

## Frontend

O frontend e feito com HTML, CSS e JavaScript puro.

Entrada principal:

```text
frontend/index.html
```

Telas principais:

- `frontend/pages/auth/login/`: login;
- `frontend/pages/auth/register/`: cadastro;
- `frontend/pages/checkout/plans/`: escolha de plano;
- `frontend/pages/checkout/payment/`: checkout de plano;
- `frontend/pages/app/dashboard/`: painel inicial;
- `frontend/pages/app/products/`: produtos e categorias;
- `frontend/pages/app/menu/`: configuracao do cardapio e QR por mesa;
- `frontend/pages/app/orders/`: pedidos;
- `frontend/pages/app/cashier/`: caixa;
- `frontend/pages/qr-code-final/`: cardapio publico do cliente.

Configuracao da API:

- `window.FOOD_SYSTEM_API_URL`;
- ou `localStorage["food-system-api-url"]`;
- fallback local: `http://localhost:3000/api/v1`;
- em dominio hospedado, a URL da API deve ser configurada explicitamente.

Arquivos:

```text
frontend/shared/api/config.js
frontend/env.example.js
```

Se o frontend e a API ficarem em dominios diferentes, crie um arquivo `frontend/env.js` baseado em `frontend/env.example.js`. As paginas carregam esse arquivo antes dos scripts de aplicacao. Em ambiente hospedado, a API, Supabase Database, HTTPS e secrets fortes sao obrigatorios. O `localStorage` fica apenas para preferencias e dados temporarios, nao para token de autenticacao.

## Backend

O backend e uma API Ruby on Rails usando Supabase Database, que e PostgreSQL gerenciado, linkado via `DATABASE_URL`.

Stack atual:

- Ruby on Rails 8.1;
- Supabase Database como PostgreSQL gerenciado;
- cookie de sessao assinado/criptografado com JWT interno;
- Bcrypt;
- Rack CORS;
- Firebase/Google Auth para login social.

Setup local:

```bash
cd backend
bundle install
cp .env.example .env
bin/rails db:prepare
bin/rails db:seed
bin/rails server
```

O arquivo `.env` deve ter `DATABASE_URL` apontando para o Supabase Database linkado ao backend. O projeto nao depende de PostgreSQL local. O `db:seed` apenas sincroniza os planos padrao e nao cria usuarios, negocios ou produtos demo. Para rodar testes, configure tambem `TEST_DATABASE_URL` apontando para uma base remota separada, porque o Rails pode limpar/recriar tabelas no ambiente de teste.

Projeto Supabase atual:

- nome: `Food System`;
- ref/project id: `quxmxltqvkncxwbcoshv`;
- host: `db.quxmxltqvkncxwbcoshv.supabase.co`.

Use `backend/.env.production.example` como base para configurar as variaveis reais no provedor de hospedagem. Nunca commite a senha real do banco ou secrets reais.

API local:

```text
http://localhost:3000/api/v1
```

Variaveis principais:

- `DATABASE_URL`;
- `TEST_DATABASE_URL`, obrigatoria para rodar testes em uma base remota separada;
- `JWT_SECRET_KEY`;
- `SECRET_KEY_BASE`;
- `CORS_ORIGINS`;
- `APP_HOSTS`;
- `RAILS_ASSUME_SSL`;
- `PAYMENT_PROVIDER`;
- `PAYMENT_WEBHOOK_SECRET`;
- `ALLOW_SIMULATED_CHECKOUT`;
- `ALLOW_LEGACY_PUBLIC_MENU_BY_ID`;
- `FIREBASE_PROJECT_ID`;
- `FIREBASE_WEB_API_KEY`;
- `FIREBASE_AUTH_DOMAIN`;
- `FIREBASE_APP_ID`.

Em producao, `JWT_SECRET_KEY`, `SECRET_KEY_BASE` e `PAYMENT_WEBHOOK_SECRET` sao obrigatorios quando o checkout simulado esta desligado. Use `ALLOW_SIMULATED_CHECKOUT=false` para operacao real.

## Rotas Principais

Auth:

- `POST /api/v1/auth/register`;
- `POST /api/v1/auth/login`;
- `POST /api/v1/auth/firebase`;
- `GET /api/v1/auth/firebase/config`;
- `POST /api/v1/auth/logout`;
- `GET /api/v1/auth/profile`.

Negocio:

- `GET /api/v1/businesses/:id`;
- `GET /api/v1/businesses/:id/public`;
- `PATCH /api/v1/businesses/:id`;
- `GET /api/v1/businesses/:id/settings`.

O endpoint publico por `business_id` existe para compatibilidade local/legada. Em producao, mantenha `ALLOW_LEGACY_PUBLIC_MENU_BY_ID=false` e use `GET /api/v1/menu/:token`.

Produtos e categorias:

- `GET /api/v1/businesses/:business_id/categories`;
- `POST /api/v1/businesses/:business_id/categories`;
- `PATCH /api/v1/businesses/:business_id/categories/:id`;
- `DELETE /api/v1/businesses/:business_id/categories/:id`;
- `GET /api/v1/businesses/:business_id/products`;
- `GET /api/v1/businesses/:business_id/products/public`;
- `POST /api/v1/businesses/:business_id/products`;
- `PATCH /api/v1/businesses/:business_id/products/:id`;
- `DELETE /api/v1/businesses/:business_id/products/:id`.

Pedidos:

- `GET /api/v1/businesses/:business_id/orders`;
- `POST /api/v1/businesses/:business_id/orders`;
- `PATCH /api/v1/businesses/:business_id/orders/:id/update_status`;
- `GET /api/v1/businesses/:business_id/orders/today_stats`.

Mesas, equipe, caixa e planos:

- `GET /api/v1/menu/:token`;
- `GET /api/v1/businesses/:business_id/tables`;
- `POST /api/v1/businesses/:business_id/tables`;
- `POST /api/v1/businesses/:business_id/tables/:id/rotate_token`;
- `GET /api/v1/businesses/:business_id/team`;
- `POST /api/v1/businesses/:business_id/team`;
- `PATCH /api/v1/businesses/:business_id/team/:id`;
- `DELETE /api/v1/businesses/:business_id/team/:id`;
- `GET /api/v1/businesses/:business_id/cash_movements`;
- `POST /api/v1/businesses/:business_id/cash_movements`;
- `GET /api/v1/businesses/:business_id/payment_methods`;
- `POST /api/v1/businesses/:business_id/payment_methods`;
- `GET /api/v1/plans`;
- `GET /api/v1/subscription`;
- `POST /api/v1/subscription/checkout`;
- `POST /api/v1/payments/webhooks`.

## Como Testar Manualmente

Frontend estatico:

```bash
python -m http.server 4173
```

Abrir:

```text
http://127.0.0.1:4173/frontend/index.html
```

Backend:

```bash
cd backend
bin/rails server
```

Para executar separado:

- frontend: qualquer hospedagem estatica apontando para `frontend/`;
- backend: qualquer hospedagem Rails/Rack apontando para `backend/`;
- link entre eles: `frontend/env.js` com `FOOD_SYSTEM_API_URL` e `backend/.env` com `CORS_ORIGINS`.

## Estado Atual

Funciona ou esta preparado:

- autenticacao por e-mail e senha;
- login Google via Firebase com API ativa;
- sessao por cookie `HttpOnly` em vez de token persistido no navegador;
- cadastro inicial do negocio;
- categorias e produtos;
- cardapio publico por token de mesa;
- pedidos com identificacao real de mesa;
- pedidos publicos iniciando como pendentes, sem gerar caixa automaticamente;
- painel operacional de pedidos;
- caixa basico;
- planos com checkout pendente por padrao e webhook assinado para ativacao;
- equipe com papeis `owner`, `manager`, `cashier`, `kitchen` e `viewer`;
- protecoes contra acesso entre negocios;
- validacao basica contra XSS em renderizacoes dinamicas do frontend;
- dados de negocio vindos da API/Supabase.

Limpezas recentes:

- removida documentacao duplicada/desatualizada;
- removida a feature local de cupons, porque nao existia no backend;
- removidos assets e estilos nao referenciados;
- removidos produtos, pedidos, caixa, planos e usuario demo do storage local;
- removido seed destrutivo com usuario, negocio e produtos demo;
- mantido apenas este README como fonte principal do projeto.

## O Que Ainda Falta

1. Conectar um provedor de pagamento real no `SubscriptionsController` e mapear os IDs reais para `SubscriptionPayment`.
2. Validar Firebase/Google Auth ponta a ponta no dominio final autorizado no Firebase.
3. Rodar migrations e testes Rails em ambiente com Ruby/Rails instalado.
4. Melhorar logs, observabilidade, backup e rotina de rollback.
5. Trocar cache/rate limit em memoria por Redis quando houver multiplas instancias do backend.
6. Fazer QA visual em desktop/mobile no dominio final, principalmente fluxo cliente por QR.

## Observacoes

O projeto ainda nao usa Docker, Redis, Sidekiq, gateway de pagamento real ou sistema completo de observabilidade. Esses itens devem entrar apenas quando forem realmente implementados.
