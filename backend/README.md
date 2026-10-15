# Backend

API Ruby on Rails para o Food System.

## Rodar local

```bash
bundle install
cp .env.example .env
bin/rails db:prepare
bin/rails db:seed
bin/rails server
```

API local:

```text
http://localhost:3000/api/v1
```

Health check:

```text
http://localhost:3000/up
```

## Link com o frontend

Configure as origens do frontend em `CORS_ORIGINS`:

```env
CORS_ORIGINS=http://localhost:4173,http://127.0.0.1:4173,https://app.seu-dominio.com
```

Em producao, configure tambem:

```env
APP_HOSTS=api.seu-dominio.com
RAILS_ASSUME_SSL=true
```

O frontend deve apontar para esta API com:

```js
window.FOOD_SYSTEM_API_URL = "https://api.seu-dominio.com/api/v1";
```

## Contrato

- Este projeto nao serve o frontend.
- As rotas publicas e autenticadas ficam sob `/api/v1`.
- Cookies de sessao usam `SameSite=None; Secure` em producao para funcionar com frontend e backend em dominios diferentes.
