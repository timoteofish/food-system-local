const parseSettings = (value) => {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

const safeColor = (value, fallback) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
const deliveryFee = (settings) => {
  const value = Number(settings.delivery_fee ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 99999999.99 && Number(value.toFixed(2)) === value
    ? Number(value.toFixed(2))
    : 0;
};

export const createPublicMenu = (business, sourceCategories, table = null) => {
  const settings = parseSettings(business.settings);
  const categories = (Array.isArray(sourceCategories) ? sourceCategories : []).map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description || "",
    position: Number(category.position) || 0,
    products: (Array.isArray(category.products) ? category.products : []).map((product) => ({
      id: product.id,
      category_id: category.id,
      category: category.name,
      name: product.name,
      description: product.description || "",
      price: Number(product.price),
      image_url: product.image_url || "",
      active: true,
    })),
  }));
  const categoryNames = new Set(categories.map((category) => category.name));
  const selectedCategories = Array.isArray(settings.selected_categories)
    ? [...new Set(settings.selected_categories.filter((name) => typeof name === "string" && categoryNames.has(name)))].slice(0, 100)
    : [];
  const angle = Number(settings.gradient_angle);

  return {
    business_id: business.id,
    business_name: business.name,
    menu_name: business.description || "",
    primary_color: safeColor(business.primary_color, "#b4232f"),
    style: settings.style === "clean" ? settings.style : "clean",
    gradient_start: safeColor(settings.gradient_start, safeColor(business.primary_color, "#b4232f")),
    gradient_end: safeColor(settings.gradient_end, "#252221"),
    gradient_angle: Number.isFinite(angle) && angle >= 0 && angle <= 360 ? angle : 140,
    menu_banner: typeof settings.menu_banner === "string" ? settings.menu_banner.slice(0, 500) : "",
    delivery_fee: deliveryFee(settings),
    show_all_products: typeof settings.show_all_products === "boolean" ? settings.show_all_products : true,
    selected_categories: selectedCategories,
    ...(table ? { table: { id: table.id, name: table.name } } : {}),
    categories,
    products: categories.flatMap((category) => category.products),
  };
};
