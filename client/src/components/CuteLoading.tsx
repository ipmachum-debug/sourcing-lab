import { CHARACTERS } from "@/lib/characters";

interface CuteLoadingProps {
  message?: string;
  size?: "sm" | "md" | "lg";
}

export function CuteLoading({ message = "로딩 중...", size = "md" }: CuteLoadingProps) {
  const sizeClasses = {
    sm: "w-24 h-24",
    md: "w-32 h-32",
    lg: "w-48 h-48",
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8">
      <div className={`${sizeClasses[size]} animate-bounce-slow`}>
        <img
          src={CHARACTERS.LOADING}
          alt="Loading"
          className="w-full h-full object-contain drop-shadow-lg"
        />
      </div>
      <p className="text-muted-foreground text-sm font-medium animate-pulse">
        {message}
      </p>
    </div>
  );
}
