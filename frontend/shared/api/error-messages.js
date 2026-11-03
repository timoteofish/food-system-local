import { getLanguage } from "../i18n/i18n.js";

const portugueseMessages = {
  "Request failed": "Falha na solicitação",
  "The API URL is not configured. Set window.FOOD_SYSTEM_API_URL or localStorage['food-system-api-url']": "A URL da API não está configurada. Defina window.FOOD_SYSTEM_API_URL ou localStorage['food-system-api-url']",
  "Access denied": "Acesso negado",
  "The local administrator can only access the local Food System business": "O administrador local só pode acessar o estabelecimento local do Food System",
  "Local administrator authorization required": "A autorização de administrador local é necessária",
  "Business not found": "Estabelecimento não encontrado",
  "Business data must be an object": "Os dados do estabelecimento devem ser um objeto",
  "Business name must be text": "O nome do estabelecimento deve ser texto",
  "Business name must be between 2 and 160 characters": "O nome do estabelecimento deve ter de 2 a 160 caracteres",
  "Business description must be text no longer than 65535 bytes": "A descrição do estabelecimento deve ser texto com no máximo 65535 bytes",
  "Primary color must be a six-digit hexadecimal color": "A cor principal deve ser um código hexadecimal de seis dígitos",
  "Business settings must be a plain object": "As configurações do estabelecimento devem ser um objeto simples",
  "Business settings cannot exceed 32 KiB": "As configurações do estabelecimento não podem exceder 32 KiB",
  "Delivery fee must be a valid non-negative amount with at most 2 decimal places": "A taxa de entrega deve ser um valor não negativo válido com no máximo 2 casas decimais",
  "No business fields provided": "Nenhum campo do estabelecimento foi informado",
  "Team member fields have invalid types": "Os campos do membro da equipe têm tipos inválidos",
  "Local team roster does not use email accounts": "A equipe local não usa contas de email",
  "Local roster role must be staff or manager": "A função da equipe local deve ser funcionário ou gerente",
  "Name must be 2 to 160 characters": "O nome deve ter de 2 a 160 caracteres",
  "Email, name and password must be text": "Email, nome e senha devem ser texto",
  "Name must be 2 to 160 characters and email must be valid and no longer than 190 characters": "O nome deve ter de 2 a 160 caracteres e o email deve ser válido e ter no máximo 190 caracteres",
  "Team role must be text": "A função da equipe deve ser texto",
  "Invalid team role": "Função de equipe inválida",
  "Member not found or protected": "Membro não encontrado ou protegido",
  "Managers can remove staff members only": "Gerentes só podem remover funcionários",
  "Invalid session": "Sessão inválida",
  "Insufficient permissions": "Permissão insuficiente",
  "A valid email, a name between 2 and 120 characters, and a password between 8 and 1024 bytes are required": "Email válido, nome de 2 a 120 caracteres e senha de 8 a 1024 bytes são obrigatórios",
  "Email is already registered": "Email já cadastrado",
  "Invalid email or password": "Email ou senha inválidos",
  "Only an owner can invite managers or owners": "Somente um proprietário pode convidar gerentes ou proprietários",
  "The user must register before receiving an invitation": "O usuário precisa se cadastrar antes do convite",
  "The user already belongs to this business": "Usuário já pertence à empresa",
  "Only an owner can change team roles": "Somente um proprietário pode alterar funções da equipe",
  "Invalid role": "Papel inválido",
  "Team member not found": "Membro não encontrado",
  "The business must retain at least one owner": "O estabelecimento precisa manter pelo menos um proprietário",
  "The local API is not ready yet. Try again shortly.": "A API local ainda não está pronta. Tente novamente em instantes.",
};

export const localizeApiError = (message) => {
  if (getLanguage() !== "pt") return message;
  return portugueseMessages[message] || message;
};
