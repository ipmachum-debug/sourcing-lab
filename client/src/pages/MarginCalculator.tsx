import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator,
  TrendingUp,
  Package,
  RotateCcw,
  Copy,
  Save,
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  History,
  ArrowDownToLine,
  DollarSign,
  Truck,
  Megaphone,
  ShieldCheck,
  ShieldX,
  CheckCircle,
  XCircle,
  Sparkles,
  Brain,
  Loader2,
  Target,
  Zap,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ============================================================
//  쿠팡 판매수수료 테이블 (카테고리별)
// ============================================================

const COUPANG_FEE_RATES: Record<string, { name: string; rate: number }> = {
  fashion: { name: "패션의류/잡화", rate: 10.8 },
  beauty: { name: "뷰티", rate: 10.8 },
  food: { name: "식품", rate: 10.8 },
  living: { name: "생활용품", rate: 10.8 },
  electronics: { name: "가전/디지털", rate: 9.8 },
  kitchen: { name: "주방용품", rate: 10.8 },
  sports: { name: "스포츠/레저", rate: 10.8 },
  baby: { name: "출산/유아", rate: 10.8 },
  pet: { name: "반려동물", rate: 10.8 },
  furniture: { name: "가구/인테리어", rate: 9.8 },
  auto: { name: "자동차용품", rate: 9.8 },
  toys: { name: "완구/문구", rate: 10.8 },
  health: { name: "건강/헬스", rate: 10.8 },
  etc: { name: "기타", rate: 10.8 },
};

// ============================================================
//  쿠팡 입출고비·배송비 프리셋 (사이즈별, VAT 별도)
// ============================================================

const FULFILLMENT_PRESETS: Record<
  string,
  { name: string; fulfillment: number; shipping: number }
> = {
  xs: { name: "극소형", fulfillment: 600, shipping: 1125 },
  small: { name: "소형", fulfillment: 650, shipping: 1250 },
  medium: { name: "중형", fulfillment: 1240, shipping: 1500 },
  large: { name: "대형", fulfillment: 1740, shipping: 2500 },
  xlarge: { name: "특대형", fulfillment: 2500, shipping: 5500 },
  custom: { name: "직접 입력", fulfillment: 0, shipping: 0 },
};

// ============================================================
//  포맷 유틸
// ============================================================

function formatKRW(n: number): string {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

function formatPercent(n: number): string {
  return n.toFixed(2) + "%";
}

// ============================================================
//  마진 계산기 컴포넌트
// ============================================================

export default function MarginCalculator() {
  // 입력값
  const [itemName, setItemName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");

  // 소싱 정보 (위안화/달러 → 원화 환산)
  const [sourceCurrency, setSourceCurrency] = useState<"KRW" | "CNY" | "USD">("CNY");
  const [sourcePrice, setSourcePrice] = useState("");
  const [exchangeRate, setExchangeRate] = useState("190");
  const [supplier, setSupplier] = useState("");
  const [intlShipping, setIntlShipping] = useState("0"); // 국제배송비
  const [costPriceDirect, setCostPriceDirect] = useState(""); // KRW 직접입력

  const [category, setCategory] = useState("living");
  const [sizePreset, setSizePreset] = useState("small");
  const [customFulfillment, setCustomFulfillment] = useState("");
  const [customShipping, setCustomShipping] = useState("");
  const [adRate, setAdRate] = useState("0"); // 광고비율 (%)
  const [expectedSales, setExpectedSales] = useState("100");
  const [returnRate, setReturnRate] = useState("0");
  const [returnCollectionFee, setReturnCollectionFee] = useState("0");

  // 이력 상태
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // AI 추천가 상태
  const [aiResult, setAiResult] = useState<any>(null);

  const utils = trpc.useUtils();

  const historyQuery = trpc.margin.list.useQuery(
    { page: historyPage, perPage: 15, search: historySearch },
    { placeholderData: prev => prev }
  );

  const saveMutation = trpc.margin.save.useMutation({
    onSuccess: () => {
      toast.success("이력이 저장되었습니다");
      utils.margin.list.invalidate();
    },
    onError: () => toast.error("저장에 실패했습니다"),
  });

  const deleteMutation = trpc.margin.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다");
      utils.margin.list.invalidate();
    },
  });

  const aiRecommendMut = trpc.margin.aiRecommend.useMutation({
    onSuccess: (res) => {
      if (res.success && res.data) {
        setAiResult(res.data);
        toast.success("AI 추천가 분석 완료");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const requestAiRecommend = () => {
    if (costPrice <= 0) {
      toast.error("원가를 먼저 입력하세요");
      return;
    }
    const preset = FULFILLMENT_PRESETS[sizePreset];
    aiRecommendMut.mutate({
      itemName,
      costPrice,
      feeRate,
      fulfillmentFee: sizePreset === "custom" ? (parseInt(customFulfillment) || 0) : (preset?.fulfillment ?? 0),
      shippingFee: sizePreset === "custom" ? (parseInt(customShipping) || 0) : (preset?.shipping ?? 0),
      adRate: parseFloat(adRate) || 0,
      category: COUPANG_FEE_RATES[category]?.name || "",
      supplier,
    });
  };

  // 환율 자동 변경
  const handleCurrencyChange = (val: "KRW" | "CNY" | "USD") => {
    setSourceCurrency(val);
    if (val === "CNY") setExchangeRate("190");
    else if (val === "USD") setExchangeRate("1350");
  };

  // 원가 계산
  const costPrice = useMemo(() => {
    if (sourceCurrency === "KRW") {
      return parseInt(costPriceDirect) || 0;
    }
    const sp = parseFloat(sourcePrice) || 0;
    const er = parseFloat(exchangeRate) || 0;
    const shipping = parseInt(intlShipping) || 0;
    return Math.round(sp * er) + shipping;
  }, [sourceCurrency, sourcePrice, exchangeRate, intlShipping, costPriceDirect]);

  // 계산
  const feeRate = COUPANG_FEE_RATES[category]?.rate ?? 10.8;

  const result = useMemo(() => {
    const sell = parseInt(sellingPrice) || 0;
    if (sell <= 0) return null;

    // 입출고비·배송비 (VAT 별도)
    const preset = FULFILLMENT_PRESETS[sizePreset];
    const fulfillment =
      sizePreset === "custom"
        ? parseInt(customFulfillment) || 0
        : preset?.fulfillment ?? 0;
    const shipping =
      sizePreset === "custom"
        ? parseInt(customShipping) || 0
        : preset?.shipping ?? 0;

    // 입출고비용 VAT (10%)
    const fulfillmentVat = Math.round((fulfillment + shipping) * 0.1);

    // 판매수수료
    const salesCommission = Math.round(sell * (feeRate / 100));
    // 판매수수료 VAT (10%)
    const salesCommissionVat = Math.round(salesCommission * 0.1);

    // 부가세 = 판매가 / 11
    const vatRounded = Math.round(sell / 11);

    // 광고비 = 판매가 × 광고비율
    const adRateNum = parseFloat(adRate) || 0;
    const adCost = Math.round(sell * (adRateNum / 100));

    // 총 차감액 (판매가에서 빠지는 모든 비용)
    const totalDeduction =
      costPrice +
      fulfillment +
      shipping +
      fulfillmentVat +
      salesCommission +
      salesCommissionVat +
      vatRounded +
      adCost;

    // 마진 = 판매가 - 총 차감액
    const margin = sell - totalDeduction;

    // 마진율
    const marginRate = sell > 0 ? (margin / sell) * 100 : 0;

    // 최소광고수익률(END ROAS) = 마진 > 0 ? 판매가 / 마진 * 100 : 0
    // 광고비 제외 마진으로 계산 (광고 전 마진 기준)
    const marginBeforeAd = margin + adCost;
    const minAdRoi = marginBeforeAd > 0 ? (sell / marginBeforeAd) * 100 : 0;

    // 예상판매량 기반 총마진
    const sales = parseInt(expectedSales) || 0;
    const retRate = parseFloat(returnRate) || 0;
    const retFee = parseInt(returnCollectionFee) || 0;
    const returnCost = Math.round(sales * (retRate / 100) * retFee);
    const totalMargin = margin * sales - returnCost;

    // 마진 등급
    let grade: string;
    let gradeColor: string;
    if (marginRate >= 40) {
      grade = "매우 좋음";
      gradeColor = "text-green-600 bg-green-50";
    } else if (marginRate >= 25) {
      grade = "좋음";
      gradeColor = "text-blue-600 bg-blue-50";
    } else if (marginRate >= 15) {
      grade = "보통";
      gradeColor = "text-amber-600 bg-amber-50";
    } else if (marginRate >= 0) {
      grade = "낮음";
      gradeColor = "text-orange-600 bg-orange-50";
    } else {
      grade = "적자";
      gradeColor = "text-red-600 bg-red-50";
    }

    // 소싱 원칙 체크
    const sourcingMarginPass = marginRate >= 45;
    const sourcingRoasPass = minAdRoi > 0 && minAdRoi <= 250;
    const sourcingPass = sourcingMarginPass && sourcingRoasPass;

    // 적정 판매가 역산 (비용 기반)
    // sell = fixedCosts / (1 - targetMargin - feeRate*1.1/100 - 1/11 - adRate/100)
    const fixedCosts = costPrice + fulfillment + shipping + fulfillmentVat;
    const variableRatio = (fr: number, ar: number, tm: number) =>
      1 - tm / 100 - (fr * 1.1) / 100 - 1 / 11 - ar / 100;

    const ratio30 = variableRatio(feeRate, adRateNum, 30);
    const ratio45 = variableRatio(feeRate, adRateNum, 45);
    const breakEvenRatio = variableRatio(feeRate, adRateNum, 0);

    const recommendedPrice30 = ratio30 > 0 ? Math.ceil(fixedCosts / ratio30 / 100) * 100 : 0;
    const recommendedPrice45 = ratio45 > 0 ? Math.ceil(fixedCosts / ratio45 / 100) * 100 : 0;
    const breakEvenPrice = breakEvenRatio > 0 ? Math.ceil(fixedCosts / breakEvenRatio / 100) * 100 : 0;

    return {
      fulfillment,
      shipping,
      fulfillmentVat,
      salesCommission,
      salesCommissionVat,
      vat: vatRounded,
      adCost,
      totalDeduction,
      margin,
      marginRate,
      minAdRoi,
      totalMargin,
      returnCost,
      grade,
      gradeColor,
      sourcingMarginPass,
      sourcingRoasPass,
      sourcingPass,
      recommendedPrice30,
      recommendedPrice45,
      breakEvenPrice,
    };
  }, [
    sellingPrice,
    costPrice,
    category,
    sizePreset,
    customFulfillment,
    customShipping,
    adRate,
    expectedSales,
    returnRate,
    returnCollectionFee,
    feeRate,
  ]);

  const resetForm = () => {
    setItemName("");
    setSellingPrice("");
    setSourcePrice("");
    setCostPriceDirect("");
    setIntlShipping("0");
    setSupplier("");
    setAdRate("0");
    setExpectedSales("100");
    setReturnRate("0");
    setReturnCollectionFee("0");
    setCustomFulfillment("");
    setCustomShipping("");
  };

  const copyResult = () => {
    if (!result) return;
    const text = [
      `[마진 계산 결과]${itemName ? ` ${itemName}` : ""}`,
      supplier ? `공급처: ${supplier}` : null,
      `판매가: ${formatKRW(parseInt(sellingPrice))}`,
      `원가: ${formatKRW(costPrice)}${sourceCurrency !== "KRW" ? ` (${sourcePrice} ${sourceCurrency} × ${exchangeRate})` : ""}`,
      `입출고비: ${formatKRW(result.fulfillment)} / 배송비: ${formatKRW(result.shipping)} (VAT별도)`,
      `판매수수료: ${formatKRW(result.salesCommission)} (${feeRate}%)`,
      `광고비: ${formatKRW(result.adCost)} (${adRate}%)`,
      `부가세: ${formatKRW(result.vat)}`,
      `총 차감액: ${formatKRW(result.totalDeduction)}`,
      `마진: ${formatKRW(result.margin)} (${formatPercent(result.marginRate)})`,
      `END ROAS: ${formatPercent(result.minAdRoi)}`,
      `소싱원칙: ${result.sourcingPass ? "PASS ✓" : "FAIL ✗"}`,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(text);
    toast.success("계산 결과가 복사되었습니다");
  };

  const saveHistory = () => {
    if (!result) return;
    saveMutation.mutate({
      itemName,
      sellingPrice: parseInt(sellingPrice) || 0,
      costPrice,
      feeRate: feeRate.toString(),
      fulfillmentFee: result.fulfillment,
      shippingFee: result.shipping,
      expectedSales: parseInt(expectedSales) || 100,
      returnRate: (parseFloat(returnRate) || 0).toString(),
      returnCollectionFee: parseInt(returnCollectionFee) || 0,
      fulfillmentVat: result.fulfillmentVat,
      salesCommission: result.salesCommission,
      salesCommissionVat: result.salesCommissionVat,
      vat: result.vat,
      margin: result.margin,
      marginRate: result.marginRate.toFixed(2),
      minAdRoi: result.minAdRoi.toFixed(2),
      totalMargin: result.totalMargin,
    });
  };

  const loadFromHistory = (item: NonNullable<typeof historyQuery.data>["items"][number]) => {
    setItemName(item.itemName ?? "");
    setSellingPrice(item.sellingPrice.toString());
    // 이력 불러오기 시 원화 직접입력 모드로 전환
    setSourceCurrency("KRW");
    setCostPriceDirect(item.costPrice.toString());
    setExpectedSales(item.expectedSales.toString());
    setReturnRate(item.returnRate ?? "0");
    setReturnCollectionFee(item.returnCollectionFee.toString());

    const rate = parseFloat(item.feeRate ?? "10.8");
    const matchedCat = Object.entries(COUPANG_FEE_RATES).find(
      ([, v]) => v.rate === rate
    );
    if (matchedCat) setCategory(matchedCat[0]);

    const ff = item.fulfillmentFee;
    const sf = item.shippingFee;
    const matchedPreset = Object.entries(FULFILLMENT_PRESETS).find(
      ([k, v]) => k !== "custom" && v.fulfillment === ff && v.shipping === sf
    );
    if (matchedPreset) {
      setSizePreset(matchedPreset[0]);
    } else {
      setSizePreset("custom");
      setCustomFulfillment(ff.toString());
      setCustomShipping(sf.toString());
    }

    toast.success("이력을 불러왔습니다");
  };

  const handleSearch = () => {
    setHistorySearch(searchInput);
    setHistoryPage(1);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1800px] mx-auto">
        {/* 헤더 */}
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Calculator className="w-6 h-6 text-emerald-500" /> 마진 계산기
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            위안화/달러 환율 자동 계산 · 쿠팡 수수료·입출고비·배송비·광고비·부가세 자동 산출
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ========== 좌측: 입력 폼 ========== */}
          <div className="space-y-3">
            {/* 상품 기본정보 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="w-4 h-4 text-pink-500" /> 상품 정보
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      상품명
                    </label>
                    <Input
                      placeholder="이력 검색용"
                      value={itemName}
                      onChange={e => setItemName(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      판매가 (원)
                    </label>
                    <Input
                      type="number"
                      placeholder="19,900"
                      value={sellingPrice}
                      onChange={e => setSellingPrice(e.target.value)}
                      className="h-8 text-xs font-bold"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 소싱 정보 (환율 계산) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-500" /> 소싱 정보
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">
                    공급처
                  </label>
                  <Input
                    placeholder="알리바바, 1688, 타오바오 등"
                    value={supplier}
                    onChange={e => setSupplier(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      통화
                    </label>
                    <Select
                      value={sourceCurrency}
                      onValueChange={v => handleCurrencyChange(v as "KRW" | "CNY" | "USD")}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CNY">CNY (위안)</SelectItem>
                        <SelectItem value="USD">USD (달러)</SelectItem>
                        <SelectItem value="KRW">KRW (원화)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {sourceCurrency !== "KRW" ? (
                    <>
                      <div>
                        <label className="text-[10px] text-gray-500 mb-1 block">
                          소싱가 ({sourceCurrency})
                        </label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={sourcePrice}
                          onChange={e => setSourcePrice(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 mb-1 block">
                          환율 (원)
                        </label>
                        <Input
                          type="number"
                          value={exchangeRate}
                          onChange={e => setExchangeRate(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2">
                      <label className="text-[10px] text-gray-500 mb-1 block">
                        원가 (원)
                      </label>
                      <Input
                        type="number"
                        placeholder="5,000"
                        value={costPriceDirect}
                        onChange={e => setCostPriceDirect(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  )}
                </div>
                {sourceCurrency !== "KRW" && (
                  <>
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">
                        국제배송비 (원)
                      </label>
                      <Input
                        type="number"
                        value={intlShipping}
                        onChange={e => setIntlShipping(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="text-[10px] text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 rounded">
                      환산 원가:{" "}
                      <span className="font-bold text-gray-700 dark:text-gray-200">
                        {formatKRW(costPrice)}
                      </span>
                      <span className="ml-1 text-gray-300">
                        ({sourcePrice || 0} × {exchangeRate} + 배송{intlShipping})
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* 수수료·비용 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-500" /> 쿠팡 수수료 · 비용
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      카테고리 (수수료율)
                    </label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(COUPANG_FEE_RATES).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v.name} ({v.rate}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      입출고배송비 (사이즈)
                    </label>
                    <Select value={sizePreset} onValueChange={setSizePreset}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FULFILLMENT_PRESETS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v.name}
                            {k !== "custom"
                              ? ` (${v.fulfillment.toLocaleString()}+${v.shipping.toLocaleString()})`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {sizePreset === "custom" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">
                        입출고비 (VAT별도)
                      </label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={customFulfillment}
                        onChange={e => setCustomFulfillment(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">
                        배송비 (VAT별도)
                      </label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={customShipping}
                        onChange={e => setCustomShipping(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                )}
                {sizePreset !== "custom" && (
                  <div className="text-[10px] text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 rounded">
                    입출고비{" "}
                    {FULFILLMENT_PRESETS[sizePreset]?.fulfillment.toLocaleString()}
                    원 + 배송비{" "}
                    {FULFILLMENT_PRESETS[sizePreset]?.shipping.toLocaleString()}
                    원 (VAT 별도)
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">
                    <Megaphone className="w-3 h-3 inline mr-1" />
                    광고비율 (%)
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="0"
                    value={adRate}
                    onChange={e => setAdRate(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </CardContent>
            </Card>

            {/* 판매 예측 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-amber-500" /> 판매 예측
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      예상판매량
                    </label>
                    <Input
                      type="number"
                      value={expectedSales}
                      onChange={e => setExpectedSales(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      반품률 (%)
                    </label>
                    <Input
                      type="number"
                      step="0.1"
                      value={returnRate}
                      onChange={e => setReturnRate(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      반품회수비
                    </label>
                    <Input
                      type="number"
                      value={returnCollectionFee}
                      onChange={e => setReturnCollectionFee(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={resetForm}
              >
                <RotateCcw className="w-3 h-3" /> 초기화
              </Button>
              {result && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={copyResult}
                  >
                    <Copy className="w-3 h-3" /> 결과 복사
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={saveHistory}
                    disabled={saveMutation.isPending}
                  >
                    <Save className="w-3 h-3" /> 이력 저장
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1 text-purple-600 border-purple-200 hover:bg-purple-50"
                onClick={requestAiRecommend}
                disabled={aiRecommendMut.isPending || costPrice <= 0}
              >
                {aiRecommendMut.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Brain className="w-3 h-3" />
                )}
                {aiRecommendMut.isPending ? "분석 중..." : "AI 추천가"}
              </Button>
            </div>
          </div>

          {/* ========== 중앙: 결과 ========== */}
          <div className="space-y-3">
            {result ? (
              <>
                {/* 마진 등급 + 소싱 원칙 통합 카드 */}
                <Card
                  className={`border-2 ${
                    result.sourcingPass
                      ? "border-emerald-300"
                      : result.margin >= 0
                        ? "border-green-200"
                        : "border-red-200"
                  }`}
                >
                  <CardContent className="pt-5 pb-5">
                    {/* 마진 등급 */}
                    <div className="text-center mb-4">
                      <Badge
                        className={`text-base px-3 py-0.5 ${result.gradeColor}`}
                      >
                        {result.grade}
                      </Badge>
                      <div
                        className={`text-2xl font-bold mt-2 ${result.margin >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {formatKRW(result.margin)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        마진율{" "}
                        <span className="font-bold">
                          {formatPercent(result.marginRate)}
                        </span>
                        {" / "}
                        END ROAS{" "}
                        <span className="font-bold">
                          {result.minAdRoi > 0
                            ? formatPercent(result.minAdRoi)
                            : "-"}
                        </span>
                      </div>
                    </div>

                    {/* 소싱 원칙 체크 */}
                    <div
                      className={`rounded-lg p-3 ${
                        result.sourcingPass
                          ? "bg-emerald-50 dark:bg-emerald-950/30"
                          : "bg-red-50/50 dark:bg-red-950/20"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-1.5">
                          {result.sourcingPass ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <ShieldX className="w-4 h-4 text-red-400" />
                          )}
                          <span className="text-xs font-bold">소싱 원칙</span>
                        </div>
                        <Badge
                          className={`text-[10px] px-2 ${
                            result.sourcingPass
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-red-100 text-red-600"
                          }`}
                        >
                          {result.sourcingPass ? "PASS" : "FAIL"}
                        </Badge>
                      </div>

                      <div className="space-y-3">
                        {/* 마진율 체크 */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 text-[11px]">
                              {result.sourcingMarginPass ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-400" />
                              )}
                              <span className="font-medium">마진율 ≥ 45%</span>
                            </div>
                            <span
                              className={`text-[11px] font-bold ${
                                result.sourcingMarginPass
                                  ? "text-emerald-600"
                                  : "text-red-600"
                              }`}
                            >
                              {formatPercent(result.marginRate)}
                            </span>
                          </div>
                          {/* 프로그레스 바 */}
                          <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                                result.sourcingMarginPass
                                  ? "bg-emerald-500"
                                  : "bg-red-400"
                              }`}
                              style={{
                                width: `${Math.min(100, Math.max(0, (result.marginRate / 45) * 100))}%`,
                              }}
                            />
                            {/* 45% 마커 */}
                            <div
                              className="absolute top-0 h-full w-0.5 bg-gray-500"
                              style={{ left: "100%" }}
                              title="목표: 45%"
                            />
                          </div>
                          {!result.sourcingMarginPass && (
                            <div className="text-[10px] text-red-500 mt-0.5">
                              {(45 - result.marginRate).toFixed(2)}%p 부족
                              {result.marginRate > 0 && (
                                <span className="text-gray-400 ml-1">
                                  · 45% 달성 판매가:{" "}
                                  {formatKRW(
                                    Math.round(
                                      result.totalDeduction /
                                        (1 - 0.45 - feeRate / 100 * 0.1 + result.marginRate / 100 - result.margin / (parseInt(sellingPrice) || 1)) *
                                        (1 / (1 - 0.45))
                                    ) || 0
                                  )}
                                </span>
                              )}
                            </div>
                          )}
                          {result.sourcingMarginPass && (
                            <div className="text-[10px] text-emerald-600 mt-0.5">
                              목표 초과 +{(result.marginRate - 45).toFixed(2)}%p
                            </div>
                          )}
                        </div>

                        {/* ROAS 체크 */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 text-[11px]">
                              {result.sourcingRoasPass ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-400" />
                              )}
                              <span className="font-medium">
                                END ROAS ≤ 250%
                              </span>
                            </div>
                            <span
                              className={`text-[11px] font-bold ${
                                result.sourcingRoasPass
                                  ? "text-emerald-600"
                                  : "text-red-600"
                              }`}
                            >
                              {result.minAdRoi > 0
                                ? formatPercent(result.minAdRoi)
                                : "-"}
                            </span>
                          </div>
                          {/* ROAS 프로그레스 (역방향: 낮을수록 좋음) */}
                          <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                                result.sourcingRoasPass
                                  ? "bg-emerald-500"
                                  : "bg-red-400"
                              }`}
                              style={{
                                width: `${Math.min(100, Math.max(0, result.minAdRoi > 0 ? ((500 - result.minAdRoi) / 500) * 100 : 0))}%`,
                              }}
                            />
                          </div>
                          {result.minAdRoi > 0 && !result.sourcingRoasPass && (
                            <div className="text-[10px] text-red-500 mt-0.5">
                              {(result.minAdRoi - 250).toFixed(2)}%p 초과 — 마진을 더 확보해야 합니다
                            </div>
                          )}
                          {result.minAdRoi > 0 && result.sourcingRoasPass && (
                            <div className="text-[10px] text-emerald-600 mt-0.5">
                              여유 {(250 - result.minAdRoi).toFixed(2)}%p — 광고 효율 여유 있음
                            </div>
                          )}
                          {result.minAdRoi <= 0 && (
                            <div className="text-[10px] text-red-500 mt-0.5">
                              마진이 0 이하로 ROAS 산출 불가
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 종합 평가 */}
                      <div
                        className={`mt-3 pt-2.5 border-t text-[10px] ${
                          result.sourcingPass
                            ? "border-emerald-200 text-emerald-700"
                            : "border-red-200 text-red-600"
                        }`}
                      >
                        {result.sourcingPass ? (
                          <span className="font-medium">
                            소싱 원칙 충족 — 광고 집행 시에도 안정적인 수익 확보 가능
                          </span>
                        ) : (
                          <span className="font-medium">
                            {!result.sourcingMarginPass && !result.sourcingRoasPass
                              ? "마진율과 ROAS 모두 기준 미달 — 원가를 낮추거나 판매가를 높여야 합니다"
                              : !result.sourcingMarginPass
                                ? "마진율 부족 — 원가 절감 또는 판매가 인상 필요"
                                : "ROAS 초과 — 광고 효율 대비 마진이 부족합니다"}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 비용 상세 */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">비용 상세 (판매가 차감 항목)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5 text-xs">
                      {[
                        {
                          label: "원가",
                          value: formatKRW(costPrice),
                          color: "text-blue-600",
                        },
                        {
                          label: "입출고비",
                          value: formatKRW(result.fulfillment),
                          color: "text-amber-600",
                        },
                        {
                          label: "배송비",
                          value: formatKRW(result.shipping),
                          color: "text-amber-600",
                        },
                        {
                          label: "입출고비용 VAT",
                          value: formatKRW(result.fulfillmentVat),
                          color: "text-purple-600",
                        },
                        {
                          label: `판매수수료 (${feeRate}%)`,
                          value: formatKRW(result.salesCommission),
                          color: "text-pink-600",
                        },
                        {
                          label: "판매수수료 VAT",
                          value: formatKRW(result.salesCommissionVat),
                          color: "text-purple-600",
                        },
                        {
                          label: "부가세",
                          value: formatKRW(result.vat),
                          color: "text-gray-600",
                        },
                        {
                          label: `광고비 (${adRate}%)`,
                          value: formatKRW(result.adCost),
                          color: "text-orange-600",
                        },
                      ].map((item, i) => (
                        <div
                          key={i}
                          className="flex justify-between items-center py-0.5 border-b border-gray-50"
                        >
                          <span className="text-gray-500">{item.label}</span>
                          <span className={`font-medium ${item.color}`}>
                            {item.value}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center pt-2 font-bold text-sm border-t">
                        <span className="text-red-500">총 차감액</span>
                        <span className="text-red-600">
                          {formatKRW(result.totalDeduction)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center font-bold text-sm">
                        <span>판매가</span>
                        <span className="text-blue-600">
                          {formatKRW(parseInt(sellingPrice) || 0)}
                        </span>
                      </div>
                      <div
                        className={`flex justify-between items-center font-bold text-sm pt-2 border-t-2 ${result.margin >= 0 ? "border-green-200" : "border-red-200"}`}
                      >
                        <span>마진</span>
                        <span
                          className={
                            result.margin >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }
                        >
                          {formatKRW(result.margin)} (
                          {formatPercent(result.marginRate)})
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 총마진 (예상판매량 기준) */}
                <Card className="bg-blue-50/50 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-500" /> 총마진
                      (예상판매량 {expectedSales}개 기준)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">
                          마진 × {expectedSales}개
                        </span>
                        <span className="font-bold">
                          {formatKRW(
                            result.margin * (parseInt(expectedSales) || 0)
                          )}
                        </span>
                      </div>
                      {result.returnCost > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">
                            반품 비용 (-{returnRate}%)
                          </span>
                          <span className="font-bold text-red-500">
                            -{formatKRW(result.returnCost)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-2 border-t font-bold text-sm">
                        <span>총마진</span>
                        <span
                          className={
                            result.totalMargin >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }
                        >
                          {formatKRW(result.totalMargin)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 적정 판매가 가이드 */}
                {costPrice > 0 && (
                  <Card className="bg-violet-50/50 border-violet-100 dark:bg-violet-950/20 dark:border-violet-900">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-violet-500" /> 적정 판매가 가이드
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-xs">
                        <p className="text-[10px] text-gray-400 mb-2">
                          현재 비용 기준으로 목표 마진율 달성에 필요한 판매가
                        </p>
                        {[
                          {
                            label: "손익분기 (0%)",
                            price: result.breakEvenPrice,
                            color: "text-red-500",
                            bgColor: "bg-red-50 dark:bg-red-950/30",
                          },
                          {
                            label: "30% 마진",
                            price: result.recommendedPrice30,
                            color: "text-amber-600",
                            bgColor: "bg-amber-50 dark:bg-amber-950/30",
                          },
                          {
                            label: "45% 마진 (소싱원칙)",
                            price: result.recommendedPrice45,
                            color: "text-emerald-600",
                            bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
                          },
                        ].map((item, i) => (
                          <div
                            key={i}
                            className={`flex justify-between items-center px-3 py-2 rounded-lg ${item.bgColor}`}
                          >
                            <span className="text-gray-600 font-medium">
                              {item.label}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className={`font-bold ${item.color}`}>
                                {item.price > 0
                                  ? formatKRW(item.price)
                                  : "산출불가"}
                              </span>
                              {item.price > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 px-1.5 text-[9px] text-violet-600 hover:text-violet-800"
                                  onClick={() =>
                                    setSellingPrice(item.price.toString())
                                  }
                                >
                                  적용
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center text-gray-400">
                  <Calculator className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">판매가를 입력하세요</p>
                  <p className="text-[10px] mt-1">
                    수수료·입출고비·배송비·광고비·부가세가 자동 산출됩니다
                  </p>
                </CardContent>
              </Card>
            )}

            {/* AI 추천가 카드 — result 유무 관계없이 항상 표시 */}
            {aiResult && (
              <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50/50 to-blue-50/50 dark:from-purple-950/20 dark:to-blue-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Brain className="w-4 h-4 text-purple-600" /> AI 추천 판매가
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {[
                    { key: "conservative", label: "보수적", icon: Shield, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200" },
                    { key: "balanced", label: "균형 (추천)", icon: Target, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200" },
                    { key: "aggressive", label: "공격적", icon: Zap, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200" },
                  ].map(({ key, label, icon: Icon, color, bg, border }) => {
                    const rec = aiResult[key];
                    if (!rec) return null;
                    const isPass = rec.marginRate >= 45 && rec.endRoas <= 250 && rec.endRoas > 0;
                    return (
                      <div key={key} className={`rounded-lg p-2.5 ${bg} border ${border}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <Icon className={`w-3.5 h-3.5 ${color}`} />
                            <span className={`text-xs font-bold ${color}`}>{label}</span>
                            {isPass && (
                              <Badge className="text-[8px] px-1 bg-emerald-100 text-emerald-700 border-emerald-200">PASS</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm font-bold ${color}`}>
                              {rec.price > 0 ? formatKRW(rec.price) : "산출불가"}
                            </span>
                            {rec.price > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-[9px] text-purple-600 hover:text-purple-800"
                                onClick={() => setSellingPrice(rec.price.toString())}
                              >
                                적용
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-3 text-[10px] text-gray-500">
                          <span>마진 <span className={rec.marginRate >= 45 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>{rec.marginRate}%</span></span>
                          <span>ROAS <span className={rec.endRoas <= 250 && rec.endRoas > 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>{rec.endRoas}%</span></span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">{rec.strategy}</p>
                      </div>
                    );
                  })}
                  {aiResult.tip && (
                    <div className="text-[10px] text-purple-700 bg-purple-50/50 dark:bg-purple-950/30 rounded p-2 mt-1 border border-purple-100">
                      <span className="font-semibold">💡 AI 조언:</span> {aiResult.tip}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ========== 우측: 이력 패널 ========== */}
          <div className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="w-4 h-4 text-violet-500" /> 계산 이력
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* 검색 */}
                <div className="flex gap-1">
                  <Input
                    placeholder="상품명 검색..."
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSearch()}
                    className="h-8 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 shrink-0"
                    onClick={handleSearch}
                  >
                    <Search className="w-3 h-3" />
                  </Button>
                </div>

                {/* 이력 리스트 */}
                {historyQuery.isLoading ? (
                  <div className="py-8 text-center text-xs text-gray-400">
                    불러오는 중...
                  </div>
                ) : !historyQuery.data?.items.length ? (
                  <div className="py-8 text-center text-xs text-gray-400">
                    {historySearch
                      ? "검색 결과가 없습니다"
                      : "저장된 이력이 없습니다"}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {historyQuery.data.items.map(item => (
                      <div
                        key={item.id}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
                        onClick={() => loadFromHistory(item)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">
                            {item.itemName || "이름 없음"}
                          </div>
                          <div className="text-[10px] text-gray-400 flex items-center gap-1.5">
                            <span>
                              {item.costPrice.toLocaleString()}→
                              {item.sellingPrice.toLocaleString()}
                            </span>
                            <span
                              className={`font-medium ${parseFloat(item.marginRate ?? "0") >= 0 ? "text-green-600" : "text-red-500"}`}
                            >
                              {item.marginRate}%
                            </span>
                          </div>
                          <div className="text-[9px] text-gray-300">
                            {item.createdAt?.toString().slice(0, 16)}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            title="불러오기"
                            onClick={e => {
                              e.stopPropagation();
                              loadFromHistory(item);
                            }}
                          >
                            <ArrowDownToLine className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                            title="삭제"
                            onClick={e => {
                              e.stopPropagation();
                              deleteMutation.mutate({ id: item.id });
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 페이지네이션 */}
                {historyQuery.data && historyQuery.data.totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage(p => p - 1)}
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </Button>
                    <span className="text-[10px] text-gray-500">
                      {historyPage} / {historyQuery.data.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={historyPage >= historyQuery.data.totalPages}
                      onClick={() => setHistoryPage(p => p + 1)}
                    >
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
