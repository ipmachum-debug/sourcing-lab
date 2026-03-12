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
  const [costPrice, setCostPrice] = useState("");
  const [category, setCategory] = useState("living");
  const [sizePreset, setSizePreset] = useState("small");
  const [customFulfillment, setCustomFulfillment] = useState("");
  const [customShipping, setCustomShipping] = useState("");
  const [expectedSales, setExpectedSales] = useState("100");
  const [returnRate, setReturnRate] = useState("0");
  const [returnCollectionFee, setReturnCollectionFee] = useState("0");

  // 이력 상태
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const utils = trpc.useUtils();

  // 이력 쿼리
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

  // 계산
  const feeRate = COUPANG_FEE_RATES[category]?.rate ?? 10.8;

  const result = useMemo(() => {
    const sell = parseInt(sellingPrice) || 0;
    const cost = parseInt(costPrice) || 0;

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

    // 부가세 = 판매가의 10/110 (내부 부가세)
    const vat = Math.round((sell / 11) * 10) / 10;
    const vatRounded = Math.round(sell / 11);

    // 마진 = 판매가 - 원가 - 입출고비 - 배송비 - 입출고VAT - 판매수수료 - 판매수수료VAT - 부가세
    const margin =
      sell -
      cost -
      fulfillment -
      shipping -
      fulfillmentVat -
      salesCommission -
      salesCommissionVat -
      vatRounded;

    // 마진율
    const marginRate = sell > 0 ? (margin / sell) * 100 : 0;

    // 최소광고수익률 = 마진율 > 0 ? 판매가 / 마진 * 100 : 0
    const minAdRoi = margin > 0 ? (sell / margin) * 100 : 0;

    // 예상판매량 기반 총마진
    const sales = parseInt(expectedSales) || 0;
    const retRate = parseFloat(returnRate) || 0;
    const retFee = parseInt(returnCollectionFee) || 0;

    // 반품 비용 = 예상판매량 × 반품률/100 × 반품회수비
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

    return {
      fulfillment,
      shipping,
      fulfillmentVat,
      salesCommission,
      salesCommissionVat,
      vat: vatRounded,
      margin,
      marginRate,
      minAdRoi,
      totalMargin,
      returnCost,
      grade,
      gradeColor,
    };
  }, [
    sellingPrice,
    costPrice,
    category,
    sizePreset,
    customFulfillment,
    customShipping,
    expectedSales,
    returnRate,
    returnCollectionFee,
    feeRate,
  ]);

  const resetForm = () => {
    setItemName("");
    setSellingPrice("");
    setCostPrice("");
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
      `판매가: ${formatKRW(parseInt(sellingPrice))}`,
      `원가: ${formatKRW(parseInt(costPrice) || 0)}`,
      `입출고비: ${formatKRW(result.fulfillment)} / 배송비: ${formatKRW(result.shipping)} (VAT별도)`,
      `판매수수료: ${formatKRW(result.salesCommission)} (${feeRate}%)`,
      `부가세: ${formatKRW(result.vat)}`,
      `마진: ${formatKRW(result.margin)} (${formatPercent(result.marginRate)})`,
      `최소광고수익률: ${formatPercent(result.minAdRoi)}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    toast.success("계산 결과가 복사되었습니다");
  };

  const saveHistory = () => {
    if (!result) return;
    saveMutation.mutate({
      itemName,
      sellingPrice: parseInt(sellingPrice) || 0,
      costPrice: parseInt(costPrice) || 0,
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
    setCostPrice(item.costPrice.toString());
    setExpectedSales(item.expectedSales.toString());
    setReturnRate(item.returnRate ?? "0");
    setReturnCollectionFee(item.returnCollectionFee.toString());

    // 수수료율로 카테고리 매칭
    const rate = parseFloat(item.feeRate ?? "10.8");
    const matchedCat = Object.entries(COUPANG_FEE_RATES).find(
      ([, v]) => v.rate === rate
    );
    if (matchedCat) setCategory(matchedCat[0]);

    // 입출고비/배송비로 프리셋 매칭
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
            쿠팡 판매 마진을 자동 계산합니다 (입출고비·배송비 VAT 별도)
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
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">
                    상품명
                  </label>
                  <Input
                    placeholder="상품명 (이력 검색용)"
                    value={itemName}
                    onChange={e => setItemName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
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
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">
                      원가 (원)
                    </label>
                    <Input
                      type="number"
                      placeholder="5,000"
                      value={costPrice}
                      onChange={e => setCostPrice(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 수수료·비용 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-500" /> 수수료 ·
                  비용
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

            <div className="flex gap-2">
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
            </div>
          </div>

          {/* ========== 중앙: 결과 ========== */}
          <div className="space-y-3">
            {result ? (
              <>
                {/* 마진 등급 카드 */}
                <Card
                  className={`border-2 ${result.margin >= 0 ? "border-green-200" : "border-red-200"}`}
                >
                  <CardContent className="pt-5 pb-5 text-center">
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
                      {result.minAdRoi > 0 && (
                        <>
                          {" / "}
                          최소광고수익률{" "}
                          <span className="font-bold">
                            {formatPercent(result.minAdRoi)}
                          </span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* 원가 상세 */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">비용 상세</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5 text-xs">
                      {[
                        {
                          label: "원가",
                          value: formatKRW(parseInt(costPrice) || 0),
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
                      <div className="flex justify-between items-center pt-2 font-bold text-sm">
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
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center text-gray-400">
                  <Calculator className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">판매가를 입력하세요</p>
                  <p className="text-[10px] mt-1">
                    수수료·입출고비·배송비가 자동으로 계산됩니다
                  </p>
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
