/**
 * 소셜미디어 플랫폼 어댑터
 *
 * 각 플랫폼 공식 API를 사용한 게시물 발행/성과 수집
 * - Instagram: Graph API (Business/Creator 계정)
 * - YouTube: Data API v3
 * - TikTok: Content Posting API
 * - Naver Blog: 공유 API (반자동) + 블로그 글쓰기 API
 * - Kakao: 카카오채널 메시지 API
 */

// ======================== 공통 인터페이스 ========================

export interface PublishInput {
  title?: string;
  caption: string;
  description?: string;
  hashtags?: string[];
  mediaPaths?: string[];     // 로컬 파일 경로
  mediaUrls?: string[];      // 원격 URL
  scheduledAt?: string;      // 예약 시간
  privacy?: "public" | "private" | "unlisted";
}

export interface PublishResult {
  success: boolean;
  remotePostId?: string;
  remotePostUrl?: string;
  error?: string;
}

export interface AnalyticsResult {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  reach?: number;
  impressions?: number;
}

export interface PlatformAdapter {
  platform: string;
  validateCredentials(accessToken: string, meta?: any): Promise<{ valid: boolean; error?: string }>;
  publish(accessToken: string, input: PublishInput, meta?: any): Promise<PublishResult>;
  fetchAnalytics(accessToken: string, remotePostId: string, meta?: any): Promise<AnalyticsResult>;
}

// ======================== Instagram Graph API ========================

export class InstagramAdapter implements PlatformAdapter {
  platform = "instagram";
  private baseUrl = "https://graph.facebook.com/v19.0";

  async validateCredentials(accessToken: string, meta?: any): Promise<{ valid: boolean; error?: string }> {
    try {
      const igAccountId = meta?.igAccountId;
      if (!igAccountId) return { valid: false, error: "Instagram 비즈니스 계정 ID가 필요합니다." };

      const res = await fetch(`${this.baseUrl}/${igAccountId}?fields=id,username&access_token=${accessToken}`);
      if (!res.ok) return { valid: false, error: `API 오류: ${res.status}` };
      const data = await res.json();
      return { valid: !!data.id };
    } catch (e: any) {
      return { valid: false, error: e.message };
    }
  }

  async publish(accessToken: string, input: PublishInput, meta?: any): Promise<PublishResult> {
    try {
      const igAccountId = meta?.igAccountId;
      if (!igAccountId) return { success: false, error: "Instagram 비즈니스 계정 ID가 필요합니다." };

      const caption = this.buildCaption(input);
      const imageUrl = input.mediaUrls?.[0];
      if (!imageUrl) return { success: false, error: "이미지 URL이 필요합니다." };

      // Step 1: 미디어 컨테이너 생성
      const containerRes = await fetch(`${this.baseUrl}/${igAccountId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: accessToken,
        }),
      });
      if (!containerRes.ok) {
        const err = await containerRes.text();
        return { success: false, error: `컨테이너 생성 실패: ${err}` };
      }
      const container = await containerRes.json();

      // Step 2: 발행
      const publishRes = await fetch(`${this.baseUrl}/${igAccountId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: container.id,
          access_token: accessToken,
        }),
      });
      if (!publishRes.ok) {
        const err = await publishRes.text();
        return { success: false, error: `발행 실패: ${err}` };
      }
      const published = await publishRes.json();

      return {
        success: true,
        remotePostId: published.id,
        remotePostUrl: `https://www.instagram.com/p/${published.id}/`,
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async fetchAnalytics(accessToken: string, remotePostId: string): Promise<AnalyticsResult> {
    try {
      const res = await fetch(
        `${this.baseUrl}/${remotePostId}/insights?metric=impressions,reach,likes,comments,shares,saved&access_token=${accessToken}`
      );
      if (!res.ok) return this.emptyAnalytics();
      const data = await res.json();

      const metrics: Record<string, number> = {};
      for (const m of data.data || []) {
        metrics[m.name] = m.values?.[0]?.value || 0;
      }

      return {
        views: metrics.impressions || 0,
        likes: metrics.likes || 0,
        comments: metrics.comments || 0,
        shares: metrics.shares || 0,
        clicks: 0,
        reach: metrics.reach || 0,
        impressions: metrics.impressions || 0,
      };
    } catch {
      return this.emptyAnalytics();
    }
  }

  private buildCaption(input: PublishInput): string {
    let caption = input.caption || "";
    if (input.hashtags?.length) {
      caption += "\n\n" + input.hashtags.map(t => `#${t.replace(/^#/, "")}`).join(" ");
    }
    return caption.slice(0, 2200); // Instagram 캡션 제한
  }

  private emptyAnalytics(): AnalyticsResult {
    return { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  }
}

// ======================== YouTube Data API v3 ========================

export class YouTubeAdapter implements PlatformAdapter {
  platform = "youtube";
  private baseUrl = "https://www.googleapis.com/youtube/v3";
  private uploadUrl = "https://www.googleapis.com/upload/youtube/v3/videos";

  async validateCredentials(accessToken: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/channels?part=id&mine=true`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { valid: false, error: `API 오류: ${res.status}` };
      const data = await res.json();
      return { valid: (data.items?.length || 0) > 0 };
    } catch (e: any) {
      return { valid: false, error: e.message };
    }
  }

  async publish(accessToken: string, input: PublishInput): Promise<PublishResult> {
    try {
      const videoUrl = input.mediaUrls?.[0];
      if (!videoUrl) return { success: false, error: "영상 URL이 필요합니다." };

      // 영상 파일 가져오기
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) return { success: false, error: "영상 다운로드 실패" };
      const videoBuffer = await videoRes.arrayBuffer();

      const description = this.buildDescription(input);
      const tags = input.hashtags?.slice(0, 15) || [];

      // Resumable upload - Step 1: 메타데이터
      const metaRes = await fetch(
        `${this.uploadUrl}?uploadType=resumable&part=snippet,status`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": "video/*",
            "X-Upload-Content-Length": String(videoBuffer.byteLength),
          },
          body: JSON.stringify({
            snippet: {
              title: (input.title || input.caption).slice(0, 100),
              description,
              tags,
              categoryId: "22", // People & Blogs
            },
            status: {
              privacyStatus: input.privacy || "public",
              selfDeclaredMadeForKids: false,
            },
          }),
        }
      );

      if (!metaRes.ok) {
        const err = await metaRes.text();
        return { success: false, error: `업로드 초기화 실패: ${err}` };
      }

      const uploadUri = metaRes.headers.get("location");
      if (!uploadUri) return { success: false, error: "업로드 URI를 받지 못했습니다." };

      // Step 2: 실제 업로드
      const uploadRes = await fetch(uploadUri, {
        method: "PUT",
        headers: {
          "Content-Type": "video/*",
          "Content-Length": String(videoBuffer.byteLength),
        },
        body: videoBuffer,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return { success: false, error: `영상 업로드 실패: ${err}` };
      }

      const uploaded = await uploadRes.json();

      return {
        success: true,
        remotePostId: uploaded.id,
        remotePostUrl: `https://youtu.be/${uploaded.id}`,
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async fetchAnalytics(accessToken: string, remotePostId: string): Promise<AnalyticsResult> {
    try {
      const res = await fetch(
        `${this.baseUrl}/videos?part=statistics&id=${remotePostId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) return this.emptyAnalytics();
      const data = await res.json();
      const stats = data.items?.[0]?.statistics;
      if (!stats) return this.emptyAnalytics();

      return {
        views: Number(stats.viewCount) || 0,
        likes: Number(stats.likeCount) || 0,
        comments: Number(stats.commentCount) || 0,
        shares: 0, // YouTube API doesn't expose shares directly
        clicks: 0,
      };
    } catch {
      return this.emptyAnalytics();
    }
  }

  private buildDescription(input: PublishInput): string {
    let desc = input.description || input.caption || "";
    if (input.hashtags?.length) {
      desc += "\n\n" + input.hashtags.map(t => `#${t.replace(/^#/, "")}`).join(" ");
    }
    return desc.slice(0, 5000);
  }

  private emptyAnalytics(): AnalyticsResult {
    return { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  }
}

// ======================== TikTok Content Posting API ========================

export class TikTokAdapter implements PlatformAdapter {
  platform = "tiktok";
  private baseUrl = "https://open.tiktokapis.com/v2";

  async validateCredentials(accessToken: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/user/info/?fields=open_id,display_name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { valid: false, error: `API 오류: ${res.status}` };
      const data = await res.json();
      return { valid: data.data?.user?.open_id ? true : false };
    } catch (e: any) {
      return { valid: false, error: e.message };
    }
  }

  async publish(accessToken: string, input: PublishInput, meta?: any): Promise<PublishResult> {
    try {
      const videoUrl = input.mediaUrls?.[0];
      if (!videoUrl) return { success: false, error: "영상 URL이 필요합니다." };

      const caption = this.buildCaption(input);

      // Direct Post: video.publish 권한 필요
      // 또는 Upload to Inbox: creator.video.upload
      const initRes = await fetch(`${this.baseUrl}/post/publish/video/init/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: caption.slice(0, 150),
            privacy_level: meta?.privacyLevel || "SELF_ONLY", // 안전하게 기본값 비공개
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: videoUrl,
          },
        }),
      });

      if (!initRes.ok) {
        const err = await initRes.text();
        return { success: false, error: `TikTok 발행 실패: ${err}` };
      }

      const initData = await initRes.json();
      const publishId = initData.data?.publish_id;

      return {
        success: true,
        remotePostId: publishId || "",
        remotePostUrl: "", // TikTok은 발행 후 URL을 별도 조회해야 함
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async fetchAnalytics(accessToken: string, remotePostId: string): Promise<AnalyticsResult> {
    try {
      const res = await fetch(`${this.baseUrl}/video/query/?fields=id,like_count,comment_count,share_count,view_count`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters: { video_ids: [remotePostId] },
        }),
      });

      if (!res.ok) return this.emptyAnalytics();
      const data = await res.json();
      const video = data.data?.videos?.[0];
      if (!video) return this.emptyAnalytics();

      return {
        views: video.view_count || 0,
        likes: video.like_count || 0,
        comments: video.comment_count || 0,
        shares: video.share_count || 0,
        clicks: 0,
      };
    } catch {
      return this.emptyAnalytics();
    }
  }

  private buildCaption(input: PublishInput): string {
    let caption = input.caption || "";
    if (input.hashtags?.length) {
      caption += " " + input.hashtags.map(t => `#${t.replace(/^#/, "")}`).join(" ");
    }
    return caption.slice(0, 4000);
  }

  private emptyAnalytics(): AnalyticsResult {
    return { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  }
}

// ======================== Naver Blog (반자동 + 카페 API) ========================

export class NaverAdapter implements PlatformAdapter {
  platform = "naver";
  private cafeBaseUrl = "https://openapi.naver.com/v1/cafe";

  async validateCredentials(accessToken: string): Promise<{ valid: boolean; error?: string }> {
    try {
      // 네이버 프로필 조회로 토큰 검증
      const res = await fetch("https://openapi.naver.com/v1/nid/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { valid: false, error: `API 오류: ${res.status}` };
      const data = await res.json();
      return { valid: data.response?.id ? true : false };
    } catch (e: any) {
      return { valid: false, error: e.message };
    }
  }

  async publish(accessToken: string, input: PublishInput, meta?: any): Promise<PublishResult> {
    const subPlatform = meta?.subPlatform || "naver_blog";

    if (subPlatform === "naver_cafe") {
      return this.publishToCafe(accessToken, input, meta);
    }

    // 네이버 블로그 — 초안 생성 방식 (반자동)
    // 블로그 글쓰기 API가 공식적으로 제한적이므로, 본문을 생성하고 사용자가 최종 게시
    const content = this.buildBlogContent(input);
    return {
      success: true,
      remotePostId: `draft_${Date.now()}`,
      remotePostUrl: `https://blog.naver.com/PostWrite.naver`, // 사용자가 직접 게시
      error: `[반자동] 블로그 본문이 생성되었습니다. 복사하여 네이버 블로그에 붙여넣기하세요.\n\n제목: ${input.title || ""}\n\n${content.slice(0, 200)}...`,
    };
  }

  private async publishToCafe(accessToken: string, input: PublishInput, meta?: any): Promise<PublishResult> {
    try {
      const clubId = meta?.clubId;
      const menuId = meta?.menuId;
      if (!clubId || !menuId) {
        return { success: false, error: "카페 ID와 메뉴 ID가 필요합니다." };
      }

      const content = this.buildBlogContent(input);

      const formData = new URLSearchParams();
      formData.append("subject", input.title || input.caption.slice(0, 100));
      formData.append("content", content);

      const res = await fetch(`${this.cafeBaseUrl}/${clubId}/menu/${menuId}/articles`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: `카페 글쓰기 실패: ${err}` };
      }

      const data = await res.json();
      return {
        success: true,
        remotePostId: String(data.message?.result?.articleId || ""),
        remotePostUrl: data.message?.result?.articleUrl || "",
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async fetchAnalytics(_accessToken: string, _remotePostId: string): Promise<AnalyticsResult> {
    // 네이버는 외부에서 성과를 가져오는 공식 API가 제한적
    // 수동 입력 또는 네이버 애널리틱스 연동 필요
    return { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  }

  private buildBlogContent(input: PublishInput): string {
    let html = "";
    if (input.caption) {
      html += `<div class="se-main-container">\n`;
      // 본문을 단락별로 나누기
      const paragraphs = input.caption.split("\n").filter(Boolean);
      for (const p of paragraphs) {
        html += `<p>${p}</p>\n`;
      }
      html += `</div>\n`;
    }
    if (input.hashtags?.length) {
      html += `<p>${input.hashtags.map(t => `#${t.replace(/^#/, "")}`).join(" ")}</p>`;
    }
    return html;
  }
}

// ======================== Kakao Channel ========================

export class KakaoAdapter implements PlatformAdapter {
  platform = "kakao";
  private baseUrl = "https://kapi.kakao.com";

  async validateCredentials(accessToken: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { valid: false, error: `API 오류: ${res.status}` };
      const data = await res.json();
      return { valid: !!data.id };
    } catch (e: any) {
      return { valid: false, error: e.message };
    }
  }

  async publish(accessToken: string, input: PublishInput, meta?: any): Promise<PublishResult> {
    try {
      // 카카오톡 채널 메시지 발송 (나에게 보내기 or 채널 메시지)
      const templateObject = {
        object_type: "feed",
        content: {
          title: input.title || input.caption.slice(0, 50),
          description: input.caption.slice(0, 200),
          image_url: input.mediaUrls?.[0] || "",
          link: {
            web_url: meta?.landingUrl || "",
            mobile_web_url: meta?.landingUrl || "",
          },
        },
        buttons: meta?.landingUrl ? [
          {
            title: "자세히 보기",
            link: {
              web_url: meta.landingUrl,
              mobile_web_url: meta.landingUrl,
            },
          },
        ] : [],
      };

      const formData = new URLSearchParams();
      formData.append("template_object", JSON.stringify(templateObject));

      const res = await fetch(`${this.baseUrl}/v2/api/talk/memo/default/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: `카카오 발송 실패: ${err}` };
      }

      return {
        success: true,
        remotePostId: `kakao_${Date.now()}`,
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async fetchAnalytics(): Promise<AnalyticsResult> {
    // 카카오채널 메시지 성과는 별도 API 필요
    return { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  }
}

// ======================== 어댑터 레지스트리 ========================

const adapters: Record<string, PlatformAdapter> = {
  instagram: new InstagramAdapter(),
  youtube: new YouTubeAdapter(),
  tiktok: new TikTokAdapter(),
  naver_blog: new NaverAdapter(),
  naver_cafe: new NaverAdapter(),
  kakao: new KakaoAdapter(),
};

export function getAdapter(platform: string): PlatformAdapter | null {
  return adapters[platform] || null;
}

export function getAllAdapters(): Record<string, PlatformAdapter> {
  return { ...adapters };
}
