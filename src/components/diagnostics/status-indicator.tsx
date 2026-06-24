import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

type StatusIndicatorProps = {
  status: "success" | "warning" | "error";
  text: string;
};

export function StatusIndicator({ status, text }: StatusIndicatorProps) {
  const icons = {
    success: CheckCircle2,
    warning: AlertTriangle,
    error: XCircle,
  };
  const colors = {
    success: "text-green-500",
    warning: "text-yellow-500",
    error: "text-destructive",
  };

  const Icon = icons[status];
  const color = colors[status];

  return (
    <div className="flex items-center gap-2">
      <Icon className={`size-5 shrink-0 ${color}`} />
      <span className="font-medium">{text}</span>
    </div>
  );
}
