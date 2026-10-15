plans = [
  {
    name: "Degustação",
    slug: "gratis",
    price: 0.0,
    description: "Uma amostra gratuita da plataforma com sabores limitados",
    position: 1,
    features: [
      "Até 5 produtos no cardápio",
      "Até 20 pedidos por mês",
      "Sem relatórios de vendas",
      "Sem controle avançado de caixa",
      "Marca d'água 'Degustação' visível"
    ]
  },
  {
    name: "Simples",
    slug: "simples",
    price: 80.0,
    description: "Tudo o que você precisa para tirar sua operação do papel hoje",
    position: 2,
    features: [
      "Produtos ilimitados no cardápio",
      "Pedidos sem limite mensal",
      "Gestão de caixa com entradas e saídas",
      "Painel do operador para o dia a dia",
      "Cardápio digital pronto para o cliente"
    ]
  },
  {
    name: "Completo",
    slug: "completo",
    price: 120.0,
    description: "Controle total da franquia para quem quer escalar sem perder o ritmo",
    position: 3,
    features: [
      "Produtos ilimitados no cardápio",
      "Pedidos sem limite mensal",
      "Gestão de caixa com entradas e saídas",
      "Painel do operador para o dia a dia",
      "Cardápio digital pronto para o cliente",
      "Relatórios de vendas por período",
      "Controle avançado de caixa e fechamentos",
      "Histórico completo de pedidos e clientes",
      "Base pronta para múltiplos operadores"
    ]
  }
]

plans.each do |attrs|
  plan = Plan.find_or_initialize_by(slug: attrs[:slug])
  plan.assign_attributes(attrs)
  plan.save!
end

puts "Planos sincronizados: #{Plan.order(:position).pluck(:slug).join(', ')}"
