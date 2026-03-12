import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Calculator, DollarSign, TrendingUp, Package, Truck, Shield,
  AlertTriangle, CheckCircle, Info, RotateCcw, Copy,
} from "lucide-react";
import { toast } from "sonner";

// ============================================================
//  쿠팡 수수료 테이블 (카테고리별)
// ============================================================

const COUPANG_FEE_RATES: Record<string, { name: string; rate: number }> = {
  fashion: { name: "패션의류/잡화", rate: 0.108 },
  beauty: { name: "뷰티", rate: 0.108 },
  food: { name: "식품", rate: 0.108 },
  living: { name: "생활용품", rate: 0.108 },
  electronics: { name: "가전/디지털", rate: 0.098 },
  kitchen: { name: "주방용품", rate: 0.108 },
  sports: { name: "스포츠/레저", rate: 0.108 },
  baby: { name: "출산/유아", rate: 0.108 },
  pet: { name: "반려동물", rate: 0.108 },
  furniture: { name: "가구/인테리어", rate: 0.098 },
  auto: { name: "자동차용품", rate: 0.098 },
  toys: { name: "완구/문구", rate: 0.108 },
  health: { name: "건강/헬스", rate: 0.108 },
  etc: { name: "기타", rate: 0.108 },
};

// ============================================================
//  배송비 프리셋
// ============================================================

const SHIPPING_PRESETS: Record<string, { name: string; cost: number }> = {
  light_small: { name: "소형 경량 (< 0.5kg)", cost: 3000 },
  medium: { name: "일반 (0.5~2kg)", cost: 5000 },
  heavy: { name: "중량 (2~5kg)", cost: 8000 },
  bulky: { name: "대형 (5kg+)", cost: 15000 },
  custom: { name: "직접 입력", cost: 0 },
};

// ============================================================
//  관부가세 계산
// ============================================================

/** 관세 + 부가세 계산 (150달러 이하 면세) */
function calcCustomsDuty(
  sourceCostKRW: number,
  shippingCostKRW: number,
  dutyRate: number,
): { dutyFree: boolean; customsDuty: number; vat: number; totalTax: number } {
  // 물품가 + 운송비 기준
  const cifValue = sourceCostKRW + shippingCostKRW * 0.5; // 해외 배송비의 약 50%를 CIF에 포함
  const threshold = 150 * 1350; // 약 $150 면세 한도 (환율 1350원 기준)

  if (cifValue <= threshold) {
    return { dutyFree: true, customsDuty: 0, vat: 0, totalTax: 0 };
  }

  const customsDuty = Math.round(cifValue * dutyRate);
  const vat = Math.round((cifValue + customsDuty) * 0.1);
  return { dutyFree: false, customsDuty, vat, totalTax: customsDuty + vat };
}

// ============================================================
//  포맷 유틸
// ============================================================

function formatKRW(n: number): string {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

function formatPercent(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

// ============================================================
//  마진 계산기 컴포넌트
// ============================================================

export default function MarginCalculator() {
  // 입력값
  const [sourceCurrency, setSourceCurrency] = useState<"CNY" | "USD">("CNY");
  const [sourcePrice, setSourcePrice] = useState("");
  const [exchangeRate, setExchangeRate] = useState(sourceCurrency === "CNY" ? "190" : "1350");
  const [sellingPrice, setSellingPrice] = useState("");
  const [category, setCategory] = useState("living");
  const [shippingPreset, setShippingPreset] = useState("medium");
  const [customShipping, setCustomShipping] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [dutyRate, setDutyRate] = useState("0.08"); // 기본 관세율 8%
  const [coupangShipping, setCoupangShipping] = useState("0"); // 쿠팡 내 배송비 (로켓그로스 등)
  const [packagingCost, setPackagingCost] = useState("500"); // 포장비

  // 환율 자동 변경
  const handleCurrencyChange = (val: "CNY" | "USD") => {
    setSourceCurrency(val);
    setExchangeRate(val === "CNY" ? "190" : "1350");
  };

  // 계산
  const result = useMemo(() => {
    const sp = parseFloat(sourcePrice) || 0;
    const er = parseFloat(exchangeRate) || 0;
    const sell = parseFloat(sellingPrice) || 0;
    const qty = parseInt(quantity) || 1;
    const dr = parseFloat(dutyRate) || 0;
    const cs = parseFloat(coupangShipping) || 0;
    const pkg = parseFloat(packagingCost) || 0;

    if (sp <= 0 || sell <= 0) return null;

    // 소싱가 (원화)
    const sourceCostKRW = sp * er;

    // 배송비
    const shippingCost = shippingPreset === "custom"
      ? (parseFloat(customShipping) || 0)
      : SHIPPING_PRESETS[shippingPreset]?.cost || 0;

    // 개당 배송비 (수량으로 나누기)
    const shippingPerUnit = shippingCost / qty;

    // 관부가세
    const tax = calcCustomsDuty(sourceCostKRW, shippingPerUnit, dr);

    // 쿠팡 수수료
    const feeRate = COUPANG_FEE_RATES[category]?.rate || 0.108;
    const coupangFee = Math.round(sell * feeRate);

    // 총 원가
    const totalCost = sourceCostKRW + shippingPerUnit + tax.totalTax + coupangFee + cs + pkg;

    // 순이익
    const profit = sell - totalCost;
    const profitRate = sell > 0 ? profit / sell : 0;
    const roi = totalCost > 0 ? profit / (sourceCostKRW + shippingPerUnit + tax.totalTax + pkg) : 0;

    // 마진 등급
    let grade: string;
    let gradeColor: string;
    if (profitRate >= 0.4) { grade = "매우 좋음"; gradeColor = "text-green-600 bg-green-50"; }
    else if (profitRate >= 0.25) { grade = "좋음"; gradeColor = "text-blue-600 bg-blue-50"; }
    else if (profitRate >= 0.15) { grade = "보통"; gradeColor = "text-amber-600 bg-amber-50"; }
    else if (profitRate >= 0) { grade = "낮음"; gradeColor = "text-orange-600 bg-orange-50"; }
    else { grade = "적자"; gradeColor = "text-red-600 bg-red-50"; }

    // 손익분기 판매가
    const breakEvenPrice = feeRate < 1
      ? Math.round((sourceCostKRW + shippingPerUnit + tax.totalTax + cs + pkg) / (1 - feeRate))
      : 0;

    // 추천 판매가 (30% 마진 기준)
    const recommendedPrice30 = feeRate < 1
      ? Math.round((sourceCostKRW + shippingPerUnit + tax.totalTax + cs + pkg) / (1 - feeRate - 0.3))
      : 0;

    return {
      sourceCostKRW,
      shippingPerUnit,
      tax,
      coupangFee,
      feeRate,
      totalCost,
      profit,
      profitRate,
      roi,
      grade,
      gradeColor,
      breakEvenPrice,
      recommendedPrice30,
      packagingCost: pkg,
      coupangShippingCost: cs,
    };
  }, [sourcePrice, exchangeRate, sellingPrice, category, shippingPreset, customShipping, quantity, dutyRate, coupangShipping, packagingCost]);

  const resetForm = () => {
    setSourcePrice("");
    setSellingPrice("");
    setQuantity("1");
    setCustomShipping("");
    setCoupangShipping("0");
    setPackagingCost("500");
  };

  const copyResult = () => {
    if (!result) return;
    const text = [
      `[마진 계산 결과]`,
      `소싱가: ${formatKRW(result.sourceCostKRW)}`,
      `판매가: ${formatKRW(parseFloat(sellingPrice))}`,
      `쿠팡 수수료: ${formatKRW(result.coupangFee)} (${formatPercent(result.feeRate)})`,
      `배송비: ${formatKRW(result.shippingPerUnit)}`,
      `관부가세: ${result.tax.dutyFree ? "면세" : formatKRW(result.tax.totalTax)}`,
      `순이익: ${formatKRW(result.profit)} (${formatPercent(result.profitRate)})`,
      `ROI: ${formatPercent(result.roi)}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    toast.success("계산 결과가 복사되었습니다");
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1200px] mx-auto">
        {/* 헤더 */}
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Calculator className="w-6 h-6 text-emerald-500" /> 마진 계산기
          </h2>
          <p className="text-xs text-gray-500 mt-1">소싱가 입력 → 쿠팡 수수료·배송비·관부가세 자동 계산 → 순이익률 확인</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 좌측: 입력 폼 */}
          <div className="space-y-4">
            {/* 소싱가 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-blue-500" /> 소싱 정보
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">통화</label>
                    <Select value={sourceCurrency} onValueChange={v => handleCurrencyChange(v as "CNY" | "USD")}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CNY">CNY (위안)</SelectItem>
                        <SelectItem value="USD">USD (달러)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">소싱가</label>
                    <Input type="number" placeholder="0" value={sourcePrice}
                      onChange={e => setSourcePrice(e.target.value)}
                      className="h-9 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">환율 (원)</label>
                    <Input type="number" placeholder="190" value={exchangeRate}
                      onChange={e => setExchangeRate(e.target.value)}
                      className="h-9 text-xs" />
                  </div>
                </div>
                {result && (
                  <div className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                    소싱가(원): <span className="font-bold text-gray-700">{formatKRW(result.sourceCostKRW)}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">주문 수량</label>
                    <Input type="number" min="1" value={quantity}
                      onChange={e => setQuantity(e.target.value)}
                      className="h-9 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">포장비 (원)</label>
                    <Input type="number" value={packagingCost}
                      onChange={e => setPackagingCost(e.target.value)}
                      className="h-9 text-xs" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 판매가 + 카테고리 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="w-4 h-4 text-pink-500" /> 쿠팡 판매 정보
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">쿠팡 판매가 (원)</label>
                    <Input type="number" placeholder="19900" value={sellingPrice}
                      onChange={e => setSellingPrice(e.target.value)}
                      className="h-9 text-xs font-bold" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">카테고리</label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(COUPANG_FEE_RATES).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.name} ({(v.rate * 100).toFixed(1)}%)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">쿠팡 내 배송비 (로켓그로스 등, 원)</label>
                  <Input type="number" value={coupangShipping}
                    onChange={e => setCoupangShipping(e.target.value)}
                    className="h-9 text-xs" />
                </div>
              </CardContent>
            </Card>

            {/* 배송비 + 관세 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Truck className="w-4 h-4 text-amber-500" /> 해외 배송 + 관세
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">해외 배송비 (총액, 원)</label>
                  <Select value={shippingPreset} onValueChange={setShippingPreset}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SHIPPING_PRESETS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v.name}{v.cost > 0 ? ` (${formatKRW(v.cost)})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {shippingPreset === "custom" && (
                    <Input type="number" placeholder="배송비 입력" value={customShipping}
                      onChange={e => setCustomShipping(e.target.value)}
                      className="h-9 text-xs mt-2" />
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">관세율 (%)</label>
                  <Select value={dutyRate} onValueChange={setDutyRate}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">면세 (0%)</SelectItem>
                      <SelectItem value="0.08">일반 (8%)</SelectItem>
                      <SelectItem value="0.13">의류/섬유 (13%)</SelectItem>
                      <SelectItem value="0.05">전자기기 (5%)</SelectItem>
                      <SelectItem value="0.20">농수산물 (20%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {result?.tax && (
                  <div className="text-[10px] text-gray-500 bg-gray-50 px-3 py-2 rounded-lg space-y-0.5">
                    {result.tax.dutyFree ? (
                      <div className="flex items-center gap-1 text-green-600 font-medium">
                        <CheckCircle className="w-3 h-3" /> 소액면세 적용 ($150 이하)
                      </div>
                    ) : (
                      <>
                        <div>관세: {formatKRW(result.tax.customsDuty)}</div>
                        <div>부가세: {formatKRW(result.tax.vat)}</div>
                        <div className="font-medium">합계: {formatKRW(result.tax.totalTax)}</div>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={resetForm}>
                <RotateCcw className="w-3 h-3" /> 초기화
              </Button>
              {result && (
                <Button variant="outline" size="sm" className="gap-1" onClick={copyResult}>
                  <Copy className="w-3 h-3" /> 결과 복사
                </Button>
              )}
            </div>
          </div>

          {/* 우측: 결과 */}
          <div className="space-y-4">
            {result ? (
              <>
                {/* 마진 등급 카드 */}
                <Card className={`border-2 ${result.profit >= 0 ? "border-green-200" : "border-red-200"}`}>
                  <CardContent className="pt-6 pb-6 text-center">
                    <Badge className={`text-lg px-4 py-1 ${result.gradeColor}`}>
                      {result.grade}
                    </Badge>
                    <div className={`text-3xl font-bold mt-3 ${result.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatKRW(result.profit)}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      순이익률 <span className="font-bold">{formatPercent(result.profitRate)}</span>
                      {" / "}
                      ROI <span className="font-bold">{formatPercent(result.roi)}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* 원가 상세 */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">원가 상세</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-xs">
                      {[
                        { label: "소싱가 (원화)", value: formatKRW(result.sourceCostKRW), color: "text-blue-600" },
                        { label: "해외 배송비 (개당)", value: formatKRW(result.shippingPerUnit), color: "text-amber-600" },
                        { label: "관부가세", value: result.tax.dutyFree ? "면세" : formatKRW(result.tax.totalTax), color: "text-purple-600" },
                        { label: `쿠팡 수수료 (${formatPercent(result.feeRate)})`, value: formatKRW(result.coupangFee), color: "text-pink-600" },
                        { label: "쿠팡 배송비", value: formatKRW(result.coupangShippingCost), color: "text-orange-600" },
                        { label: "포장비", value: formatKRW(result.packagingCost), color: "text-gray-600" },
                      ].map((item, i) => (
                        <div key={i} className="flex justify-between items-center py-1 border-b border-gray-50">
                          <span className="text-gray-500">{item.label}</span>
                          <span className={`font-medium ${item.color}`}>{item.value}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center pt-2 font-bold text-sm">
                        <span>총 원가</span>
                        <span className="text-red-600">{formatKRW(result.totalCost)}</span>
                      </div>
                      <div className="flex justify-between items-center font-bold text-sm">
                        <span>판매가</span>
                        <span className="text-blue-600">{formatKRW(parseFloat(sellingPrice))}</span>
                      </div>
                      <div className={`flex justify-between items-center font-bold text-sm pt-2 border-t-2 ${result.profit >= 0 ? "border-green-200" : "border-red-200"}`}>
                        <span>순이익</span>
                        <span className={result.profit >= 0 ? "text-green-600" : "text-red-600"}>
                          {formatKRW(result.profit)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 추천 판매가 */}
                <Card className="bg-blue-50/50 border-blue-100">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-500" /> 가격 가이드
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">손익분기 판매가</span>
                        <span className="font-bold text-red-500">{formatKRW(result.breakEvenPrice)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">30% 마진 판매가</span>
                        <span className="font-bold text-green-600">{formatKRW(result.recommendedPrice30)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 경고/팁 */}
                {result.profitRate < 0.15 && result.profitRate >= 0 && (
                  <Card className="border-amber-200 bg-amber-50/50">
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-start gap-2 text-[11px] text-amber-800">
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">마진율이 낮습니다</p>
                          <p className="mt-0.5">광고비, 반품/교환 비용을 고려하면 최소 20% 이상 마진을 확보하는 것을 권장합니다.</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {result.profit < 0 && (
                  <Card className="border-red-200 bg-red-50/50">
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-start gap-2 text-[11px] text-red-800">
                        <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">적자 상품입니다</p>
                          <p className="mt-0.5">판매가를 올리거나 소싱가를 낮추세요. 손익분기점: {formatKRW(result.breakEvenPrice)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-20 text-center text-gray-400">
                  <Calculator className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p className="text-sm font-medium">소싱가와 판매가를 입력하세요</p>
                  <p className="text-[10px] mt-2">수수료·배송비·관세가 자동으로 계산됩니다</p>
                </CardContent>
              </Card>
            )}

            {/* 도움말 */}
            <Card className="bg-gray-50">
              <CardContent className="pt-3 pb-3">
                <div className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1"><Info className="w-3 h-3" /> 계산 기준</div>
                <div className="space-y-1 text-[10px] text-gray-500">
                  <div><span className="font-medium">쿠팡 수수료</span>: 판매가 × 카테고리별 수수료율 (9.8~10.8%)</div>
                  <div><span className="font-medium">소액면세</span>: 물품가+운송비 $150 이하 시 관세/부가세 면세</div>
                  <div><span className="font-medium">관세</span>: CIF가격 × 관세율 (카테고리별 상이)</div>
                  <div><span className="font-medium">부가세</span>: (CIF + 관세) × 10%</div>
                  <div><span className="font-medium">ROI</span>: 순이익 / 투자비용 (수수료 제외 원가)</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
