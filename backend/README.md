# Backend

Local API for Food System. This service is being expanded to replace the previous backend while preserving the reusable behavior of the original system.

## Executar

```bash
npm install
copy .env.example .env
npm run dev
```

API: `http://127.0.0.1:3000`

O endpoint `/up` verifica o processo. O endpoint `/api/v1/health` verifica também a conexão com o MySQL.

## Primeira fatia migrada

O backend já contém a base MySQL para negócios, categorias e produtos. Depois de configurar o `.env`, execute `npm run db:init` para criar as tabelas.
