import { useState, useEffect, useRef } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import DashboardLayout from "../components/DashboardLayout";
import { toast } from "sonner";
import { User, Lock, Save, Sparkles, Shield, Mail, Camera, Trash2 } from "lucide-react";

export default function Profile() {
  const utils = trpc.useUtils();
  const { data: profile, isLoading, refetch } = trpc.profile.getProfile.useQuery();
  
  const [name, setName] = useState("");
  const [userMemo, setUserMemo] = useState("");
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setUserMemo(profile.userMemo || "");
    }
  }, [profile]);

  const updateProfile = trpc.profile.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("프로필이 업데이트되었습니다! ✨");
      refetch();
    },
    onError: (error) => {
      toast.error(`오류: ${error.message}`);
    },
  });

  const uploadImage = trpc.profile.uploadProfileImage.useMutation({
    onSuccess: () => {
      toast.success("프로필 사진이 변경되었습니다! 📸");
      refetch();
      // Also refresh the auth data so sidebar updates
      utils.auth.me.invalidate();
    },
    onError: (error) => {
      toast.error(`오류: ${error.message}`);
    },
  });

  const removeImage = trpc.profile.removeProfileImage.useMutation({
    onSuccess: () => {
      toast.success("프로필 사진이 삭제되었습니다.");
      refetch();
      utils.auth.me.invalidate();
    },
    onError: (error) => {
      toast.error(`오류: ${error.message}`);
    },
  });

  const changePassword = trpc.profile.changePassword.useMutation({
    onSuccess: () => {
      toast.success("비밀번호가 변경되었습니다! ✨");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error) => {
      toast.error(`오류: ${error.message}`);
    },
  });

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile.mutate({ name, userMemo });
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("비밀번호는 최소 8자 이상이어야 합니다.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    changePassword.mutate({ currentPassword, newPassword });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error("이미지 크기는 2MB 이하여야 합니다.");
      return;
    }

    // Read file and resize/compress as data URL
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Resize to max 256x256 for storage efficiency
        const canvas = document.createElement("canvas");
        const maxSize = 256;
        let w = img.width;
        let h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) {
            h = Math.round((h * maxSize) / w);
            w = maxSize;
          } else {
            w = Math.round((w * maxSize) / h);
            h = maxSize;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          uploadImage.mutate({ imageData: dataUrl });
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="cute-dots">
            <div className="cute-dot" />
            <div className="cute-dot" />
            <div className="cute-dot" />
          </div>
          <p className="text-sm text-pink-400">로딩중...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!profile) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-100 to-rose-100 flex items-center justify-center">
            <Shield className="h-7 w-7 text-red-400" />
          </div>
          <p className="text-red-500 font-medium">프로필을 불러올 수 없습니다.</p>
        </div>
      </DashboardLayout>
    );
  }

  const hasProfileImage = !!profile.profileImage;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
            <span className="text-2xl">👤</span>
            내 프로필
          </h1>
          <p className="text-muted-foreground text-sm mt-1">프로필 정보를 관리하세요</p>
        </div>

        {/* Profile avatar card — enlarged avatar (h-16 → h-[76px], roughly +20%) */}
        <Card className="pretty-card overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-pink-200/60 via-fuchsia-200/60 to-purple-200/60" />
          <CardContent className="pt-0 -mt-10 flex items-end gap-4 pb-5">
            {/* Avatar with upload overlay */}
            <div className="relative group">
              <div className="h-[76px] w-[76px] rounded-2xl overflow-hidden bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-3xl font-bold text-white shadow-lg shadow-pink-200/40 border-4 border-white">
                {hasProfileImage ? (
                  <img
                    src={profile.profileImage!}
                    alt="프로필"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  profile.name?.charAt(0).toUpperCase() || "U"
                )}
              </div>
              {/* Camera overlay on hover */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                title="프로필 사진 변경"
              >
                <Camera className="h-6 w-6 text-white" />
              </button>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              {/* Uploading indicator */}
              {uploadImage.isPending && (
                <div className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center">
                  <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <p className="font-semibold text-lg">{profile.name || "이름 미설정"}</p>
              <p className="text-sm text-pink-400/80">{profile.email}</p>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-100/50 rounded-xl p-1">
            <TabsTrigger value="profile" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-700 data-[state=active]:shadow-sm gap-1.5">
              <User className="h-3.5 w-3.5" />
              프로필 정보
            </TabsTrigger>
            <TabsTrigger value="password" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-700 data-[state=active]:shadow-sm gap-1.5">
              <Lock className="h-3.5 w-3.5" />
              비밀번호 변경
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-5">
            <Card className="pretty-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-pink-400" />
                  <span className="gradient-text-soft">프로필 정보</span>
                </CardTitle>
                <CardDescription className="text-pink-400/60">이름과 소속 정보를 수정할 수 있습니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  {/* Profile image section */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-pink-400" />
                      프로필 사진
                    </Label>
                    <div className="flex items-center gap-3">
                      <div className="h-14 w-14 rounded-xl overflow-hidden bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-xl font-bold text-white shrink-0">
                        {hasProfileImage ? (
                          <img src={profile.profileImage!} alt="" className="h-full w-full object-cover" />
                        ) : (
                          profile.name?.charAt(0).toUpperCase() || "U"
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadImage.isPending}
                          className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-lg text-xs"
                        >
                          <Camera className="h-3.5 w-3.5 mr-1" />
                          {uploadImage.isPending ? "업로드중..." : "사진 변경"}
                        </Button>
                        {hasProfileImage && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeImage.mutate()}
                            disabled={removeImage.isPending}
                            className="border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg text-xs"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            삭제
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">JPG, PNG 등 이미지 파일 (최대 2MB)</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-pink-400" />
                      이메일
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={profile.email || ""}
                      disabled
                      className="pretty-input rounded-xl bg-pink-50/40 opacity-60"
                    />
                    <p className="text-xs text-muted-foreground">이메일은 변경할 수 없습니다.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm font-medium text-gray-600">이름</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="이름을 입력하세요"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="pretty-input rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="userMemo" className="text-sm font-medium text-gray-600">소속 및 역할</Label>
                    <Input
                      id="userMemo"
                      type="text"
                      placeholder="예: 소속: OO회사, 역할: 구매담당자"
                      value={userMemo}
                      onChange={(e) => setUserMemo(e.target.value)}
                      className="pretty-input rounded-xl"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-xl shadow-md shadow-pink-200/40 transition-all hover:scale-[1.02]"
                    disabled={updateProfile.isPending}
                  >
                    <Save className="h-4 w-4 mr-1.5" />
                    {updateProfile.isPending ? "저장 중..." : "프로필 저장"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="password" className="mt-5">
            <Card className="pretty-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="h-4 w-4 text-pink-400" />
                  <span className="gradient-text-soft">비밀번호 변경</span>
                </CardTitle>
                <CardDescription className="text-pink-400/60">현재 비밀번호를 확인한 후 새 비밀번호로 변경할 수 있습니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword" className="text-sm font-medium text-gray-600">현재 비밀번호</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      placeholder="현재 비밀번호 입력"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      className="pretty-input rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newPassword" className="text-sm font-medium text-gray-600">새 비밀번호</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      placeholder="최소 8자 이상"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      className="pretty-input rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-600">새 비밀번호 확인</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="새 비밀번호 재입력"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="pretty-input rounded-xl"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-xl shadow-md shadow-pink-200/40 transition-all hover:scale-[1.02]"
                    disabled={changePassword.isPending}
                  >
                    <Lock className="h-4 w-4 mr-1.5" />
                    {changePassword.isPending ? "변경 중..." : "비밀번호 변경"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
