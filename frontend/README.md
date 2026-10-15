# Frontend

Aplicacao estatica em HTML, CSS e JavaScript puro.

## Rodar local

Na raiz do repositorio:

```bash
python -m http.server 4173
```

Abra:

```text
http://127.0.0.1:4173/frontend/index.html
```

Em localhost, o frontend usa automaticamente:

```text
http://localhost:3000/api/v1
```

## Link com o backend

Em hospedagem separada, configure a URL da API antes dos scripts da aplicacao:

```html
<script src="/env.js"></script>
```

O arquivo `env.js` deve definir:

```js
window.FOOD_SYSTEM_API_URL = "https://api.seu-dominio.com/api/v1";
```

Tambem e possivel configurar temporariamente no navegador:

```js
localStorage.setItem("food-system-api-url", "https://api.seu-dominio.com/api/v1");
```

Sem `FOOD_SYSTEM_API_URL` em ambiente hospedado, o frontend nao assume que a API esta no mesmo dominio.

## Contrato

- O frontend chama somente endpoints HTTP em `backend/config/routes.rb`.
- A sessao autenticada fica em cookie `HttpOnly` emitido pelo backend.
- `localStorage` guarda apenas estado de UI, carrinho, rascunhos e identificadores nao sensiveis.
