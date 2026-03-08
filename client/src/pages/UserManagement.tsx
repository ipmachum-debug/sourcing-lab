import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle, XCircle, Edit, Shield, Trash2, UserCog, Sparkles, Users, KeyRound, Copy } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


export default function UserManagement() {
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [adminMemo, setAdminMemo] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [toggleAdminDialogOpen, setToggleAdminDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<any>(null);
  const [userToToggle, setUserToToggle] = useState<any>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [userToReset, setUserToReset] = useState<any>(null);
  const [resetResult, setResetResult] = useState<{ tempPassword: string; email: string; name: string | null } | null>(null);

  const utils = trpc.useUtils();
  const { data: users, isLoading } = trpc.admin.listUsers.useQuery();

  const approveMutation = trpc.admin.approveUser.useMutation({
    onSuccess: () => { toast.success("사용자가 승인되었습니다! ✨"); utils.admin.listUsers.invalidate(); },
    onError: (error) => { toast.error(error.message || "승인에 실패했습니다."); },
  });

  const revokeMutation = trpc.admin.revokeUser.useMutation({
    onSuccess: () => { toast.success("사용자 승인이 취소되었습니다."); utils.admin.listUsers.invalidate(); },
    onError: (error) => { toast.error(error.message || "승인 취소에 실패했습니다."); },
  });

  const updateMemoMutation = trpc.admin.updateUserMemo.useMutation({
    onSuccess: () => { toast.success("관리자 메모가 업데이트되었습니다! ✨"); utils.admin.listUsers.invalidate(); setIsDialogOpen(false); setSelectedUser(null); setAdminMemo(""); },
    onError: (error) => { toast.error(error.message || "메모 업데이트에 실패했습니다."); },
  });

  const toggleSuperAdminMutation = trpc.admin.toggleSuperAdmin.useMutation({
    onSuccess: (data) => { toast.success(data.message); utils.admin.listUsers.invalidate(); setToggleAdminDialogOpen(false); setUserToToggle(null); },
    onError: (error) => { toast.error(error.message || "권한 변경에 실패했습니다."); },
  });

  const deleteUserMutation = trpc.admin.deleteUser.useMutation({
    onSuccess: (data) => { toast.success(data.message); utils.admin.listUsers.invalidate(); setDeleteDialogOpen(false); setUserToDelete(null); },
    onError: (error) => { toast.error(error.message || "사용자 삭제에 실패했습니다."); },
  });

  const deleteMultipleUsersMutation = trpc.admin.deleteMultipleUsers.useMutation({
    onSuccess: (data) => { toast.success(data.message); utils.admin.listUsers.invalidate(); setBulkDeleteDialogOpen(false); setSelectedUserIds([]); },
    onError: (error) => { toast.error(error.message || "일괄 삭제에 실패했습니다."); },
  });

  const resetPasswordMutation = trpc.admin.resetUserPassword.useMutation({
    onSuccess: (data) => { setResetResult(data); setResetPasswordDialogOpen(false); },
    onError: (error) => { toast.error(error.message || "비밀번호 리셋에 실패했습니다."); },
  });

  const handleToggleSelectUser = (userId: number) => {
    setSelectedUserIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  const handleSelectAll = () => {
    if (!users) return;
    setSelectedUserIds(selectedUserIds.length === users.length ? [] : users.map(u => u.id));
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="cute-dots"><div className="cute-dot" /><div className="cute-dot" /><div className="cute-dot" /></div>
          <p className="text-sm text-pink-400">로딩중...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
            <span className="text-2xl">👥</span>
            사용자 관리
          </h1>
          <p className="text-muted-foreground text-sm mt-1">시스템 사용자 목록 및 승인 관리 (슈퍼 어드민 전용)</p>
        </div>

        {/* Bulk actions */}
        {selectedUserIds.length > 0 && (
          <div className="flex items-center gap-4 p-3 bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl border border-pink-100/50">
            <Badge className="bg-pink-100 text-pink-700 border-pink-200">{selectedUserIds.length}명 선택됨</Badge>
            <Button size="sm" variant="destructive" onClick={() => setBulkDeleteDialogOpen(true)} disabled={deleteMultipleUsersMutation.isPending} className="rounded-xl">
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> 선택 삭제
            </Button>
          </div>
        )}

        {/* User table */}
        <Card className="pretty-card overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-pink-50/80 to-purple-50/80 border-b border-pink-100/50">
                    <TableHead className="w-12">
                      <input type="checkbox" checked={users && users.length > 0 && selectedUserIds.length === users.length} onChange={handleSelectAll} className="w-4 h-4 cursor-pointer rounded" />
                    </TableHead>
                    <TableHead className="text-pink-600/80 font-medium">이메일</TableHead>
                    <TableHead className="text-pink-600/80 font-medium">이름</TableHead>
                    <TableHead className="text-pink-600/80 font-medium w-[80px]">승인</TableHead>
                    <TableHead className="text-pink-600/80 font-medium w-[100px]">역할</TableHead>
                    <TableHead className="text-pink-600/80 font-medium">사용자 메모</TableHead>
                    <TableHead className="text-pink-600/80 font-medium">관리자 메모</TableHead>
                    <TableHead className="text-pink-600/80 font-medium w-[90px]">가입일</TableHead>
                    <TableHead className="text-right text-pink-600/80 font-medium">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users && users.length > 0 ? (
                    users.map((user) => (
                      <TableRow key={user.id} className="pretty-table-row border-b border-pink-50">
                        <TableCell>
                          <input type="checkbox" checked={selectedUserIds.includes(user.id)} onChange={() => handleToggleSelectUser(user.id)} className="w-4 h-4 cursor-pointer rounded" />
                        </TableCell>
                        <TableCell className="font-medium text-sm">{user.email}</TableCell>
                        <TableCell className="text-sm">{user.name || "-"}</TableCell>
                        <TableCell>
                          {user.approved ? (
                            <Badge className="bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-700 border-emerald-200 text-xs">
                              <CheckCircle className="w-3 h-3 mr-0.5" /> 승인
                            </Badge>
                          ) : (
                            <Badge className="bg-gradient-to-r from-red-100 to-rose-100 text-red-600 border-red-200 text-xs">
                              <XCircle className="w-3 h-3 mr-0.5" /> 미승인
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.isSuperAdmin ? (
                            <Badge className="bg-gradient-to-r from-purple-100 to-fuchsia-100 text-purple-700 border-purple-200 text-xs">
                              <Shield className="w-3 h-3 mr-0.5" /> 슈퍼
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">일반</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[120px] text-xs text-muted-foreground truncate">{user.userMemo || "-"}</TableCell>
                        <TableCell className="max-w-[120px] text-xs text-muted-foreground truncate">{user.adminMemo || "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{user.createdAt ? new Date(user.createdAt).toLocaleDateString("ko-KR") : "-"}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {user.approved ? (
                              <Button size="sm" variant="outline" onClick={() => revokeMutation.mutate({ userId: user.id })} disabled={revokeMutation.isPending} className="border-red-200 text-red-500 hover:bg-red-50 rounded-lg text-xs h-7 px-2">
                                취소
                              </Button>
                            ) : (
                              <Button size="sm" onClick={() => approveMutation.mutate({ userId: user.id })} disabled={approveMutation.isPending} className="bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white rounded-lg text-xs h-7 px-2">
                                승인
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => { setSelectedUser(user); setAdminMemo(user.adminMemo || ""); setIsDialogOpen(true); }} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-lg text-xs h-7 px-2">
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setUserToToggle(user); setToggleAdminDialogOpen(true); }} className="border-purple-200 text-purple-600 hover:bg-purple-50 rounded-lg text-xs h-7 px-2">
                              <UserCog className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setUserToReset(user); setResetPasswordDialogOpen(true); }} className="border-amber-200 text-amber-600 hover:bg-amber-50 rounded-lg text-xs h-7 px-2" title="비밀번호 리셋">
                              <KeyRound className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setUserToDelete(user); setDeleteDialogOpen(true); }} className="border-red-200 text-red-400 hover:bg-red-50 rounded-lg text-xs h-7 px-2">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12">
                        <Users className="h-10 w-10 mx-auto mb-3 text-pink-200" />
                        <p className="text-muted-foreground">등록된 사용자가 없습니다.</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Memo dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="rounded-2xl border-pink-100">
            <DialogHeader>
              <DialogTitle className="gradient-text flex items-center gap-2">
                <Edit className="h-4 w-4 text-pink-500" />
                관리자 메모 수정
              </DialogTitle>
              <DialogDescription className="text-pink-400/60">{selectedUser?.email}에 대한 관리자 메모를 작성하세요.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-600">관리자 메모</Label>
                <Textarea placeholder="특이사항, 승인 사유 등을 기록하세요..." value={adminMemo} onChange={(e) => setAdminMemo(e.target.value)} rows={5} maxLength={500} className="pretty-input rounded-xl resize-none" />
                <p className="text-xs text-muted-foreground">최대 500자까지 입력 가능합니다.</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setIsDialogOpen(false); setSelectedUser(null); setAdminMemo(""); }} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-xl">
                  취소
                </Button>
                <Button onClick={() => selectedUser && updateMemoMutation.mutate({ userId: selectedUser.id, adminMemo })} disabled={updateMemoMutation.isPending} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl">
                  <Sparkles className="h-4 w-4 mr-1" /> {updateMemoMutation.isPending ? "저장 중..." : "저장"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Toggle admin dialog */}
        <AlertDialog open={toggleAdminDialogOpen} onOpenChange={setToggleAdminDialogOpen}>
          <AlertDialogContent className="rounded-2xl border-pink-100">
            <AlertDialogHeader>
              <AlertDialogTitle className="gradient-text">권한 변경 확인</AlertDialogTitle>
              <AlertDialogDescription>
                {userToToggle && (
                  <span>
                    <strong>{userToToggle.name || userToToggle.email}</strong>님을{" "}
                    {userToToggle.isSuperAdmin ? (
                      <span className="text-orange-600 font-semibold">일반 사용자로 강등</span>
                    ) : (
                      <span className="text-purple-600 font-semibold">슈퍼 어드민으로 승격</span>
                    )}
                    하시겠습니까?
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-pink-200 rounded-xl">취소</AlertDialogCancel>
              <AlertDialogAction onClick={() => userToToggle && toggleSuperAdminMutation.mutate({ userId: userToToggle.id })} className="bg-gradient-to-r from-purple-500 to-fuchsia-500 hover:from-purple-600 hover:to-fuchsia-600 rounded-xl">
                확인
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete user dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent className="rounded-2xl border-pink-100">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-600">사용자 삭제 확인</AlertDialogTitle>
              <AlertDialogDescription>
                {userToDelete && (
                  <span>
                    <strong>{userToDelete.name || userToDelete.email}</strong>님을 삭제하시겠습니까?
                    <br />
                    <span className="text-red-600 font-semibold">이 작업은 취소할 수 없습니다.</span>
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-pink-200 rounded-xl">취소</AlertDialogCancel>
              <AlertDialogAction onClick={() => userToDelete && deleteUserMutation.mutate({ userId: userToDelete.id })} className="bg-red-500 hover:bg-red-600 rounded-xl">
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reset password confirm dialog */}
        <AlertDialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
          <AlertDialogContent className="rounded-2xl border-pink-100">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-amber-600 flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                비밀번호 리셋
              </AlertDialogTitle>
              <AlertDialogDescription>
                {userToReset && (
                  <span>
                    <strong>{userToReset.name || userToReset.email}</strong>님의 비밀번호를 임시 비밀번호로 리셋하시겠습니까?
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-pink-200 rounded-xl">취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => userToReset && resetPasswordMutation.mutate({ userId: userToReset.id })}
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-xl"
              >
                리셋
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reset password result dialog */}
        <Dialog open={!!resetResult} onOpenChange={() => setResetResult(null)}>
          <DialogContent className="rounded-2xl border-pink-100">
            <DialogHeader>
              <DialogTitle className="text-amber-600 flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                임시 비밀번호 발급 완료
              </DialogTitle>
              <DialogDescription>
                사용자에게 아래 임시 비밀번호를 전달해주세요. 로그인 후 비밀번호를 변경하도록 안내해주세요.
              </DialogDescription>
            </DialogHeader>
            {resetResult && (
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <p className="text-sm text-gray-500">대상: <strong>{resetResult.name || resetResult.email}</strong></p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-500">임시 비밀번호:</p>
                    <code className="bg-amber-50 border border-amber-200 text-amber-800 font-mono font-bold text-lg px-3 py-1 rounded-lg select-all">
                      {resetResult.tempPassword}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-200 text-amber-600 hover:bg-amber-50 rounded-lg h-8 px-2"
                      onClick={() => {
                        navigator.clipboard.writeText(resetResult.tempPassword);
                        toast.success("클립보드에 복사되었습니다!");
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <Button onClick={() => setResetResult(null)} className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl">
                  확인
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Bulk delete dialog */}
        <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
          <AlertDialogContent className="rounded-2xl border-pink-100">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-600">일괄 삭제 확인</AlertDialogTitle>
              <AlertDialogDescription>
                <span>
                  선택한 <strong>{selectedUserIds.length}명</strong>의 사용자를 삭제하시겠습니까?
                  <br />
                  <span className="text-red-600 font-semibold">이 작업은 취소할 수 없습니다.</span>
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-pink-200 rounded-xl">취소</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteMultipleUsersMutation.mutate({ userIds: selectedUserIds })} className="bg-red-500 hover:bg-red-600 rounded-xl">
                삭제 ({selectedUserIds.length}명)
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
