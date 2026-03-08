/**
 * 카테고리별 인기 상품 수집을 위한 카테고리 정의
 */

export interface CategoryDefinition {
  id: string;
  name: string;
  nameKo: string;
  aliexpressUrl: string;
  alibaba1688Url: string;
  icon: string;
}

export const PRODUCT_CATEGORIES: CategoryDefinition[] = [
  {
    id: "electronics",
    name: "Electronics",
    nameKo: "전자제품",
    aliexpressUrl: "https://www.aliexpress.com/category/44/consumer-electronics.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E7%94%B5%E5%AD%90%E4%BA%A7%E5%93%81&sortType=va_rmdarkgmv30rt",
    icon: "💻",
  },
  {
    id: "fashion_women",
    name: "Women's Fashion",
    nameKo: "여성 패션",
    aliexpressUrl: "https://www.aliexpress.com/category/200000345/women-clothing.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E5%A5%B3%E8%A3%85&sortType=va_rmdarkgmv30rt",
    icon: "👗",
  },
  {
    id: "fashion_men",
    name: "Men's Fashion",
    nameKo: "남성 패션",
    aliexpressUrl: "https://www.aliexpress.com/category/200000343/men-clothing.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E7%94%B7%E8%A3%85&sortType=va_rmdarkgmv30rt",
    icon: "👔",
  },
  {
    id: "home_decor",
    name: "Home & Garden",
    nameKo: "홈데코",
    aliexpressUrl: "https://www.aliexpress.com/category/15/home-garden.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E5%AE%B6%E5%B1%85%E7%94%A8%E5%93%81&sortType=va_rmdarkgmv30rt",
    icon: "🏠",
  },
  {
    id: "beauty",
    name: "Beauty & Health",
    nameKo: "뷰티",
    aliexpressUrl: "https://www.aliexpress.com/category/66/beauty-health.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E7%BE%8E%E5%AE%B9%E6%8A%A4%E8%82%A4&sortType=va_rmdarkgmv30rt",
    icon: "💄",
  },
  {
    id: "sports",
    name: "Sports & Outdoors",
    nameKo: "스포츠",
    aliexpressUrl: "https://www.aliexpress.com/category/200003494/sports-entertainment.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E8%BF%90%E5%8A%A8%E6%88%B7%E5%A4%96&sortType=va_rmdarkgmv30rt",
    icon: "⚽",
  },
  {
    id: "kitchen",
    name: "Kitchen & Dining",
    nameKo: "주방용품",
    aliexpressUrl: "https://www.aliexpress.com/category/200003655/kitchen-dining-bar.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E5%8E%A8%E6%88%BF%E7%94%A8%E5%93%81&sortType=va_rmdarkgmv30rt",
    icon: "🍳",
  },
  {
    id: "toys",
    name: "Toys & Hobbies",
    nameKo: "완구/취미",
    aliexpressUrl: "https://www.aliexpress.com/category/26/toys-hobbies.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E7%8E%A9%E5%85%B7&sortType=va_rmdarkgmv30rt",
    icon: "🎮",
  },
  {
    id: "accessories",
    name: "Jewelry & Accessories",
    nameKo: "주얼리/액세서리",
    aliexpressUrl: "https://www.aliexpress.com/category/1509/jewelry-accessories.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E9%A5%B0%E5%93%81%E9%85%8D%E4%BB%B6&sortType=va_rmdarkgmv30rt",
    icon: "💍",
  },
  {
    id: "auto",
    name: "Automobiles & Motorcycles",
    nameKo: "자동차/오토바이",
    aliexpressUrl: "https://www.aliexpress.com/category/34/automobiles-motorcycles.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E6%B1%BD%E8%BD%A6%E7%94%A8%E5%93%81&sortType=va_rmdarkgmv30rt",
    icon: "🚗",
  },
  {
    id: "phones",
    name: "Phones & Telecommunications",
    nameKo: "스마트폰/통신",
    aliexpressUrl: "https://www.aliexpress.com/category/509/cellphones-telecommunications.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E6%89%8B%E6%9C%BA%E9%85%8D%E4%BB%B6&sortType=va_rmdarkgmv30rt",
    icon: "📱",
  },
  {
    id: "bags",
    name: "Bags & Shoes",
    nameKo: "가방/신발",
    aliexpressUrl: "https://www.aliexpress.com/category/3/luggage-bags.html?sortType=total_tranpro_desc",
    alibaba1688Url: "https://s.1688.com/selloffer/offer_search.htm?keywords=%E7%AE%B1%E5%8C%85%E9%9E%8B%E5%AD%90&sortType=va_rmdarkgmv30rt",
    icon: "👜",
  },
];

export const CATEGORY_MAP = new Map(PRODUCT_CATEGORIES.map(c => [c.id, c]));

export function getCategoryById(id: string): CategoryDefinition | undefined {
  return CATEGORY_MAP.get(id);
}

export function getCategoryUrl(categoryId: string, platform: "aliexpress" | "1688"): string | undefined {
  const category = getCategoryById(categoryId);
  if (!category) return undefined;
  return platform === "aliexpress" ? category.aliexpressUrl : category.alibaba1688Url;
}
